import express from "express";
import cors from "cors";
import { PORT, log, llmReady } from "./config.js";
import { resolveRestaurant } from "./services/tenant.js";
import { startFlushWorker, setTyping, bootSweep, drainAll } from "./services/buffer.js";
import { runFlow, listFlows, listExecutions, getExecution, listExecutionsDb, getExecutionDb } from "./engine/flow.js";
import { verifyHandshake, verifySignature, parseEnvelope } from "./services/whatsapp.js";
import { metrics } from "./services/metrics.js";
import { runRegression, regressionStatus } from "./services/regression.js";
import { handleFlushFailure, deliverStaffReply } from "./flows/buffering.js";
import { getSession, logMessage } from "./services/chatlog.js";

// register flows
import "./flows/friendly.js";
import "./flows/reservation.js";
import "./flows/arrival.js";
import "./flows/order.js";
import "./flows/reminders.js";
import "./flows/master.js";
import "./flows/buffering.js";
import "./flows/janitor.js";

const app = express();
app.use(cors());
// keep raw body for WhatsApp signature verification
app.use(express.json({ limit: "4mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Branded short links — the guest-facing URL is pretty; the storage URL stays
// hidden behind a redirect. ahlan-resto.vercel.app proxies /menu.pdf and
// /receipt/:code here via vercel.json rewrites.
app.get("/pdf/menu", async (_req, res) => {
  try {
    const t = await resolveRestaurant();
    const { menuPdfUrl } = await import("./services/menupdf.js");
    const { data: rows } = await t.db.from("menu_items").select("*").order("sort_order");
    const menu = (rows || []).filter((m) => m.available);
    const pdf = t.config.menu_config?.pdf_url
      ? { url: t.config.menu_config.pdf_url }
      : await menuPdfUrl(t.db, {
          restaurant: t.config.name, menu,
          currency: t.config.payments?.currency || "EGP",
          accent: t.config.basic_info?.brand?.primary || "#111111",
          tagline: t.config.basic_info?.tagline || "",
          phone: t.config.basic_info?.phone || "",
          website: t.config.basic_info?.website || "",
        });
    if (!pdf?.url) return res.status(404).send("menu unavailable");
    res.redirect(302, pdf.url);
  } catch (e) { res.status(500).send(e.message); }
});

app.get("/pdf/receipt/:code", async (req, res) => {
  try {
    const t = await resolveRestaurant();
    const code = String(req.params.code || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);
    const { data } = await t.db.from("orders").select("receipt_url").eq("code", code).maybeSingle();
    if (!data?.receipt_url) return res.status(404).send("receipt not found");
    res.redirect(302, data.receipt_url);
  } catch (e) { res.status(500).send(e.message); }
});

app.get("/health", async (_req, res) => {
  try {
    const t = await resolveRestaurant();
    res.json({ ok: true, llm: llmReady, restaurant: t.record.name });
  } catch (e) {
    res.json({ ok: false, llm: llmReady, error: e.message });
  }
});

// ================= WhatsApp webhook (dormant until WA_TOKEN set) =================
app.get("/api/wa/webhook", (req, res) => {
  const challenge = verifyHandshake(req.query);
  if (challenge) return res.send(challenge);
  res.sendStatus(403);
});

app.post("/api/wa/webhook", async (req, res) => {
  res.sendStatus(200); // ack fast — Meta retries slow webhooks
  try {
    if (!verifySignature(req.rawBody, req.headers["x-hub-signature-256"])) {
      log("WA webhook: bad signature, dropped");
      return;
    }
    const { events, statuses } = parseEnvelope(req.body);
    if (statuses.length) log(`WA statuses: ${statuses.map((s) => s.status).join(",")}`);
    for (const event of events) {
      const tenant = await resolveRestaurant(); // v1 single-tenant; per-wpid routing when multi-restaurant
      const ctx = { sessionId: `+${event.from}`, tenant, channel: "whatsapp", trigger: "whatsapp" };
      await runFlow("ingest", ctx, { event });
    }
  } catch (e) {
    log("WA webhook error:", e.message);
  }
});

// ================= web live chat (ops test chat + future guest widget) =================
app.post("/api/web/send", async (req, res) => {
  try {
    const { sessionId, message } = req.body || {};
    if (!sessionId || !message) return res.status(400).json({ error: "sessionId and message required" });
    const tenant = await resolveRestaurant();
    const ctx = { sessionId, tenant, channel: "web", trigger: "web" };
    const { exec } = await runFlow("ingest", ctx, { message, messageId: req.body.messageId || null });
    res.json({ accepted: true, executionId: exec.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/web/typing", (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  setTyping(sessionId);
  res.json({ ok: true });
});

// Durable poll: reads chat_messages from the tenant DB (survives redeploys,
// shows the same thread the restaurant dashboard sees — incl. staff replies).
app.get("/api/web/poll", async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  try {
    const tenant = await resolveRestaurant();
    const { data, error } = await tenant.db
      .from("chat_messages")
      .select("sender,message,media_url,media_type,created_at")
      .eq("session_id", String(sessionId))
      .order("created_at", { ascending: true })
      .limit(60);
    if (error) throw new Error(error.message);
    res.json((data || []).map((m) => ({ sender: m.sender, message: m.message, at: m.created_at, media_url: m.media_url, media_type: m.media_type })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= staff reply relay (called by the restaurant backend) =================
// Delivers a dashboard staff reply to the guest's channel (WhatsApp when live; web needs
// no push — the durable poll reads chat_messages) and appends it to AI history so the
// bot knows what the team promised when it's handed back. Token-locked like ops.
app.post("/api/staff/reply", (req, res, next) => opsAuth(req, res, next), async (req, res) => {
  try {
    const { sessionId, message } = req.body || {};
    if (!sessionId || !message) return res.status(400).json({ error: "sessionId and message required" });
    const tenant = await resolveRestaurant();
    const session = await getSession(tenant.db, String(sessionId));
    const channel = session?.channel || (String(sessionId).startsWith("web:") ? "web" : "whatsapp");
    await deliverStaffReply({ sessionId: String(sessionId), tenant, channel }, String(message).slice(0, 3500));
    res.json({ delivered: true, channel });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Staff asks for a suggested reply — drafted from the same context the bot sees,
// but ALWAYS reviewed and edited by a human before it goes anywhere.
app.post("/api/ops/draft-reply", (req, res, next) => opsAuth(req, res, next), async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    const tenant = await resolveRestaurant();
    const { getHistory } = await import("./services/history.js");
    const { chatText } = await import("./services/llm.js");
    const { MODEL_FAST } = await import("./config.js");
    const history = await getHistory(tenant.db, String(sessionId));
    const recent = history.slice(-14).map((h) => `${h.role === "guest" ? "GUEST" : "US"}: ${h.message}`).join("\n");
    const { data: diner } = await tenant.db.from("diners").select("name,allergies,preferences").eq("phone_number", String(sessionId)).maybeSingle();
    const system = `You draft ONE short reply a restaurant staff member could send to a guest on WhatsApp. Restaurant: ${tenant.config.name}. Match the guest's language (Arabic/English/Franco). Warm, human, brief — 1-3 sentences. Never invent prices, availability or promises. If the situation needs a decision only staff can make, draft the honest holding line instead. Output ONLY the reply text.`;
    const user = `Guest${diner?.name ? ` (${diner.name})` : ""}${diner?.allergies?.length ? `, allergies: ${diner.allergies.join(", ")}` : ""}.\nConversation so far:\n${recent}\n\nDraft the staff reply:`;
    const r = await chatText(MODEL_FAST, system, user, { maxTokens: 200, flex: true });
    res.json({ draft: String(r?.value || "").trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Menu copy cleanup — LLM PROPOSES fixes (typos, truncations, consistency);
// a human approves each one in the dashboard before anything is written.
// POS conversational entry: the cashier types the order as spoken ("2 iconic
// meals no pickles and a sprite", Arabic/Franco welcome) — the SAME extraction
// brain as the WhatsApp bot, so both fronts understand identical language.
// LLM extracts; CODE matches names to the menu and prices nothing here.
app.post("/api/ops/pos-extract", (req, res, next) => opsAuth(req, res, next), async (req, res) => {
  try {
    const text = String(req.body?.text || "").slice(0, 400);
    if (!text.trim()) return res.status(400).json({ error: "text required" });
    const tenant = await resolveRestaurant();
    const { chatJSON } = await import("./services/llm.js");
    const { MODEL_FAST } = await import("./config.js");
    const { getMenu } = await import("./services/menucache.js");
    const menu = (await getMenu(tenant.db)).filter((m) => m.available);
    const sys = `Extract a food order typed by a CASHIER at a fast-casual restaurant. MENU (only these exist): ${menu.map((m) => m.name).join(" | ")}
Return JSON only: {"items":[{"name":"<closest MENU name>","qty":number,"notes":"<modifiers for THIS item like 'no onion'>"|null}]}
Rules: qty defaults 1; ONLY names from MENU (closest match); Arabic/Franco input is normal; anything that matches nothing gets skipped.`;
    const r = await chatJSON(MODEL_FAST, sys, text, { temperature: 0, maxTokens: 220 });
    const normName = (x) => String(x || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    const lines = [];
    const unknown = [];
    for (const w of (r.value?.items || []).slice(0, 12)) {
      const n = normName(w.name);
      const hit = menu.find((m) => normName(m.name) === n) ||
                  menu.find((m) => normName(m.name).includes(n) || n.includes(normName(m.name)));
      if (!hit) { if (w.name) unknown.push(String(w.name)); continue; }
      lines.push({ id: hit.id, name: hit.name, qty: Math.min(Math.max(Math.round(Number(w.qty) || 1), 1), 20), notes: (w.notes || "").trim() || null });
    }
    res.json({ lines, unknown });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ops/tidy-menu", (req, res, next) => opsAuth(req, res, next), async (req, res) => {
  try {
    const tenant = await resolveRestaurant();
    const { chatJSON } = await import("./services/llm.js");
    const { MODEL_FAST } = await import("./config.js");
    const { data: menu } = await tenant.db.from("menu_items").select("id,name,description").order("sort_order");
    const list = (menu || []).map((m) => ({ id: m.id, name: m.name, description: m.description || "" }));
    const system = `You clean up restaurant menu copy. For each item, fix ONLY: spelling/typos ("Pickels"→"Pickles"), truncated endings ("+ Fri"→"+ Fries"), casing and punctuation consistency. NEVER change what the dish IS, never add or remove ingredients, never translate, never rewrite style. Return JSON {"fixes":[{"id","description"}]} containing ONLY items that need a change.`;
    const r = await chatJSON(MODEL_FAST, system, JSON.stringify(list), { maxTokens: 2000, flex: true });
    const fixes = (r?.value?.fixes || []).filter((f) => f.id && typeof f.description === "string");
    const byId = new Map(list.map((m) => [m.id, m]));
    res.json({
      fixes: fixes
        .filter((f) => byId.has(f.id) && byId.get(f.id).description !== f.description)
        .map((f) => ({ id: f.id, name: byId.get(f.id).name, before: byId.get(f.id).description, after: f.description })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= order status push (called by the backend on status change) =================
// Staff tap a ticket → the guest gets the right message for their order type.
app.post("/api/order/status", (req, res, next) => opsAuth(req, res, next), async (req, res) => {
  try {
    const { code, status } = req.body || {};
    if (!code || !status) return res.status(400).json({ error: "code and status required" });
    const tenant = await resolveRestaurant();
    const { data: order } = await tenant.db.from("orders").select("*").eq("code", code).maybeSingle();
    if (!order) return res.status(404).json({ error: "order not found" });
    if (!order.phone_number || String(order.phone_number).startsWith("walkin:")) return res.json({ skipped: "no guest channel" });
    if (order.notified_status === status) return res.json({ skipped: "already notified" });

    const branches = (tenant.config.basic_info?.branches || []).filter((b) => b?.key);
    const br = branches.find((b) => b.key === order.branch) || null;
    const brName = br?.name || "";
    const maps = br?.lat && br?.lng ? `https://maps.google.com/?q=${br.lat},${br.lng}` : null;
    const type = order.order_type;

    const MESSAGES = {
      preparing: type === "dine_in"
        ? `👨‍🍳 Your order ${order.code} is being prepared — coming to table ${order.table_number || "you"} shortly!`
        : `👨‍🍳 Your order ${order.code} is being prepared${brName ? ` at ${brName}` : ""}. We'll ping you the moment it's done!`,
      ready: type === "dine_in"
        ? `🍔 Order ${order.code} is ready — it's on its way to your table!`
        : type === "pickup"
        ? `✅ Order ${order.code} is READY to pick up${brName ? ` from ${brName}` : ""}!${maps ? `\n📍 ${maps}` : ""}`
        : `✅ Order ${order.code} is ready — your rider is picking it up now!`,
      out_for_delivery: `🛵 Order ${order.code} is ON ITS WAY${order.courier_name ? ` with ${order.courier_name}` : ""}${order.address ? ` to ${order.address}` : ""}!`,
      served: type === "delivery"
        ? `🛵 Order ${order.code} is ON ITS WAY${brName ? ` from ${brName}` : ""}${order.address ? ` to ${order.address}` : ""}.${maps ? `\n📍 Coming from: ${maps}` : ""}`
        : null,
      delivered: `🎉 Order ${order.code} delivered — enjoy! Tell us how it was 🙌`,
      cancelled: `Order ${order.code} was cancelled. If that's a surprise, message us and we'll sort it 🙏`,
    };
    const text = MESSAGES[status];
    if (!text) return res.json({ skipped: `no message for ${status}` });

    const ctx = { sessionId: order.phone_number, tenant, channel: String(order.phone_number).startsWith("web:") ? "web" : "whatsapp" };
    await deliverStaffReply(ctx, text); // same channel delivery + enters AI history
    await logMessage(tenant.db, order.phone_number, "ai", text, ctx.channel); // visible in Chats + web poll
    await tenant.db.from("orders").update({ notified_status: status }).eq("code", code).then(() => {}, () => {});
    res.json({ sent: true, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= driver page (token IS the auth — no login, no ops token) =================
// The kitchen sends the courier one link: order details, guest address + maps,
// the money to collect, and four buttons that message the guest on WhatsApp.

// everything guest- or staff-typed gets escaped before it touches driver HTML —
// the address comes verbatim from a WhatsApp message and the token is the auth
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeHttpUrl = (u) => {
  const s = String(u || "");
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? escHtml(s) : null;
};
const FLOWS_PUBLIC = process.env.FLOWS_PUBLIC_URL || "https://flows-production-e528.up.railway.app";

async function driverOrder(token) {
  if (!token || !/^[a-z2-9]{16,30}$/.test(String(token))) return null;
  const tenant = await resolveRestaurant();
  const { data: order } = await tenant.db.from("orders").select("*").eq("courier_token", String(token)).maybeSingle();
  if (!order || order.status === "cancelled") return null;
  return { tenant, order };
}

async function pushGuest(tenant, order, text) {
  if (!order.phone_number || String(order.phone_number).startsWith("walkin:")) return;
  const ctx = { sessionId: order.phone_number, tenant, channel: String(order.phone_number).startsWith("web:") ? "web" : "whatsapp" };
  await deliverStaffReply(ctx, text).catch(() => {});
  await logMessage(tenant.db, order.phone_number, "ai", text, ctx.channel).catch(() => {});
}

app.get("/driver/:token", async (req, res) => {
  try {
    const hit = await driverOrder(req.params.token);
    if (!hit) return res.status(404).send("<h3 style=\"font-family:sans-serif\">Link expired or order not found.</h3>");
    const { tenant, order } = hit;
    const branches = (tenant.config.basic_info?.branches || []).filter((b) => b?.key);
    const br = branches.find((b) => b.key === order.branch) || null;
    const guestMaps = safeHttpUrl(order.map_link)
      || (order.lat && order.lng ? `https://maps.google.com/?q=${Number(order.lat)},${Number(order.lng)}` : `https://maps.google.com/?q=${encodeURIComponent(order.address || "")}`);
    const brMaps = br?.lat && br?.lng ? `https://maps.google.com/?q=${Number(br.lat)},${Number(br.lng)}` : null;
    const cod = order.payment_method === "cash" ? Number(order.total) : 0;
    const items = (order.items || []).map((i) => `<div class="it"><b>${escHtml(i.qty)}× ${escHtml(i.name)}</b></div>`).join("");
    const phone = String(order.phone_number || "").replace(/[^+\d]/g, "");
    const accent = /^#[0-9a-f]{6}$/i.test(tenant.config.basic_info?.brand?.primary || "") ? tenant.config.basic_info.brand.primary : "#ea0000";
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(order.code)} — delivery</title><style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f4f1;margin:0;padding:16px;color:#1c1917}
  .card{background:#fff;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  h1{font-size:30px;letter-spacing:3px;text-align:center;margin:4px 0}
  .sub{text-align:center;color:#78716c;font-size:13px;margin-bottom:4px}
  .it{padding:3px 0;font-size:14px}
  .row{display:flex;justify-content:space-between;font-size:14px;padding:2px 0}
  .cod{background:#fef3c7;border:1px solid #f59e0b;border-radius:12px;padding:10px;text-align:center;font-weight:700;font-size:17px;margin-top:8px}
  a.link{display:block;background:#fff;border:1.5px solid #d6d3d1;border-radius:12px;padding:12px;text-align:center;font-weight:600;color:#1c1917;text-decoration:none;margin-bottom:8px}
  button{width:100%;border:0;border-radius:12px;padding:14px;font-size:15px;font-weight:700;margin-bottom:8px;cursor:pointer}
  .primary{background:${accent};color:#fff}
  .ghost{background:#fff;border:1.5px solid #d6d3d1;color:#1c1917}
  .ok{background:#059669;color:#fff}
  #msg{text-align:center;color:#059669;font-weight:600;min-height:20px;font-size:13px}
  .muted{color:#78716c;font-size:12px;text-align:center}
</style></head><body>
  <div class="card">
    <div class="sub">${escHtml(tenant.config.name)} — delivery</div>
    <h1>${escHtml(order.code)}</h1>
    <div class="sub">${order.status === "delivered" ? "DELIVERED ✅" : String(order.status).replace(/_/g, " ").toUpperCase()}</div>
    ${items}
    <div class="row"><span>Total</span><b>EGP ${Number(order.total).toLocaleString()}</b></div>
    ${cod ? `<div class="cod">COLLECT CASH: EGP ${cod.toLocaleString()}</div>` : `<div class="row"><span>Payment</span><b>${String(order.payment_method || "paid").toUpperCase()} — nothing to collect</b></div>`}
  </div>
  <div class="card">
    <div style="font-size:13px;color:#78716c;margin-bottom:6px">DELIVER TO</div>
    <div style="font-size:15px;font-weight:600;margin-bottom:10px">${escHtml(order.address || "—")}</div>
    <a class="link" href="${escHtml(guestMaps)}" target="_blank" rel="noopener">🗺 Open guest location</a>
    ${phone && !phone.startsWith("web") ? `<a class="link" href="tel:${escHtml(phone)}">📞 Call guest</a>` : ""}
    ${brMaps ? `<a class="link" href="${escHtml(brMaps)}" target="_blank" rel="noopener">🏪 Pickup from ${escHtml(br.name)}</a>` : ""}
  </div>
  <div class="card">
    <button class="primary" onclick="act('out')">🛵 On my way</button>
    <button class="ghost" onclick="act('near')">📍 I'm 2 minutes away</button>
    <button class="ghost" onclick="act('arrived')">🚪 I've arrived</button>
    <button class="ghost" onclick="act('delay')">⏳ Running ~10 min late</button>
    <button class="ok" onclick="if(confirm('Mark ${escHtml(order.code)} as DELIVERED?'))act('delivered')">✅ Delivered</button>
    <div id="msg"></div>
    <div class="muted">Each button sends the guest a WhatsApp update. Location sharing helps the restaurant see where you are.</div>
  </div>
<script>
  const T = ${JSON.stringify(String(req.params.token))};
  const API = ${JSON.stringify(FLOWS_PUBLIC)};
  async function act(action){
    const r = await fetch(API+'/api/driver/'+T+'/action', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});
    const j = await r.json().catch(()=>({}));
    document.getElementById('msg').textContent = j.ok ? (j.note || 'Guest notified ✓') : (j.error || 'Failed — try again');
    if(action==='delivered' && j.ok) setTimeout(()=>location.reload(), 800);
  }
  // best-effort breadcrumb so the kitchen can see where the rider is
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition((p) => {
      fetch(API+'/api/driver/'+T+'/loc', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lat:p.coords.latitude,lng:p.coords.longitude})}).catch(()=>{});
    }, () => {}, { enableHighAccuracy: false, maximumAge: 30000 });
  }
</script></body></html>`);
  } catch (e) {
    res.status(500).send("error");
  }
});

app.post("/api/driver/:token/action", async (req, res) => {
  try {
    const hit = await driverOrder(req.params.token);
    if (!hit) return res.status(404).json({ error: "not found" });
    const { tenant, order } = hit;
    const action = String(req.body?.action || "");
    const db = tenant.db;
    if (action === "out") {
      await db.from("orders").update({ status: "out_for_delivery", out_at: new Date().toISOString(), notified_status: "out_for_delivery" }).eq("id", order.id)
        .then((r2) => r2.error ? db.from("orders").update({ status: "out_for_delivery" }).eq("id", order.id) : r2);
      await pushGuest(tenant, order, `🛵 Order ${order.code} is ON ITS WAY${order.address ? ` to ${order.address}` : ""}!`);
      return res.json({ ok: true, note: "Guest told it's on the way ✓" });
    }
    if (action === "near") {
      await pushGuest(tenant, order, `📍 Your rider is 2 minutes away with order ${order.code} — see you in a moment!`);
      return res.json({ ok: true, note: "Guest told you're near ✓" });
    }
    if (action === "arrived") {
      // the RESTAURANT's number tells the guest — the rider never messages from his own
      await db.from("orders").update({ courier_arrived_at: new Date().toISOString() }).eq("id", order.id).then(() => {}, () => {});
      await pushGuest(tenant, order, `🚪 Your rider has ARRIVED with order ${order.code} — he's at your door now!${order.payment_method === "cash" ? ` Cash to have ready: EGP ${Number(order.total).toLocaleString()}.` : ""}`);
      return res.json({ ok: true, note: "Guest told you've arrived ✓" });
    }
    if (action === "delay") {
      const extra = (Number(order.eta_extra_min) || 0) + 10;
      await db.from("orders").update({ eta_extra_min: extra }).eq("id", order.id).then(() => {}, () => {});
      await pushGuest(tenant, order, `⏳ Quick heads-up — order ${order.code} is running about 10 minutes behind. Sorry, and thanks for the patience 🙏`);
      return res.json({ ok: true, note: "Guest told about the delay ✓" });
    }
    if (action === "delivered") {
      const patch = { status: "delivered", delivered_at: new Date().toISOString(), notified_status: "delivered" };
      if (order.payment_method === "cash") patch.payment_status = "paid"; // COD collected at the door
      await db.from("orders").update(patch).eq("id", order.id)
        .then((r2) => r2.error ? db.from("orders").update({ status: "delivered", ...(order.payment_method === "cash" ? { payment_status: "paid" } : {}) }).eq("id", order.id) : r2);
      await pushGuest(tenant, order, `🎉 Order ${order.code} delivered — enjoy! How was everything? A quick rating from 1–5 helps us a lot 🙌`);
      return res.json({ ok: true, note: "Delivered — guest thanked ✓" });
    }
    res.status(400).json({ error: "unknown action" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/driver/:token/loc", async (req, res) => {
  try {
    const hit = await driverOrder(req.params.token);
    if (!hit) return res.status(404).json({ error: "not found" });
    const { lat, lng } = req.body || {};
    if (typeof lat !== "number" || typeof lng !== "number") return res.status(400).json({ error: "lat/lng required" });
    await hit.tenant.db.from("orders")
      .update({ courier_lat: lat, courier_lng: lng, courier_seen_at: new Date().toISOString() })
      .eq("id", hit.order.id).then(() => {}, () => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= ops console (internal — token locked) =================
const OPS_TOKEN = process.env.OPS_TOKEN || "";
function opsAuth(req, res, next) {
  if (!OPS_TOKEN) return next(); // dev mode
  if (req.headers["x-ops-token"] === OPS_TOKEN) return next();
  res.status(401).json({ error: "ops token required" });
}
app.get("/api/ops/verify", opsAuth, (_req, res) => res.json({ ok: true }));
app.get("/api/metrics", opsAuth, async (_req, res) => {
  const m = metrics();
  // messages where a fast path ALMOST fired — the to-do list for new phrasings
  try {
    const { recentNearMisses } = await import("./services/fastpaths.js");
    m.fastpath_near_misses = recentNearMisses();
  } catch {}
  // conversation outcomes from the tenant DB (supabase-js returns errors, doesn't throw —
  // a count is just null until the relevant migration has run)
  try {
    const t = await resolveRestaurant();
    const cnt = async (table, apply) => {
      let q = t.db.from(table).select("id", { count: "exact", head: true });
      if (apply) q = apply(q);
      const { count } = await q;
      return count ?? 0;
    };
    m.sessions_total = await cnt("chat_sessions");
    m.handoffs_open = await cnt("chat_sessions", (q) => q.eq("needs_attention", true));
    m.staff_takeovers = await cnt("chat_sessions", (q) => q.eq("ai_enabled", false));
    m.replies_rated_up = await cnt("chat_messages", (q) => q.eq("rating", 1));
    m.replies_rated_down = await cnt("chat_messages", (q) => q.eq("rating", -1));
  } catch {}
  res.json(m);
});

app.post("/api/ops/run-regression", opsAuth, (req, res) => {
  // {only: ["menudoc","photo"]} re-runs just those cases — cheap targeted verify
  const only = Array.isArray(req.body?.only) && req.body.only.length ? req.body.only : undefined;
  runRegression({ only }); // async — poll status
  res.json({ started: true, only: only || "all" });
});
app.get("/api/ops/regression", opsAuth, (_req, res) => res.json(regressionStatus()));

app.post("/api/ops/run-reminders", opsAuth, async (_req, res) => {
  try {
    const tenant = await resolveRestaurant();
    const { exec } = await runFlow("reminders", { sessionId: "reminders", tenant, trigger: "manual" }, {});
    res.json({ ok: exec.status === "ok", executionId: exec.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ops/run-janitor", opsAuth, async (_req, res) => {
  try {
    const tenant = await resolveRestaurant();
    const { exec } = await runFlow("janitor", { sessionId: "janitor", tenant, trigger: "manual" }, {});
    res.json({ ok: exec.status === "ok", executionId: exec.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/flows", opsAuth, (_req, res) => {
  const flows = listFlows();
  const execs = listExecutions({ limit: 300 });
  res.json(
    flows.map((fl) => {
      const runs = execs.filter((e) => e.flow === fl.name);
      const ok = runs.filter((r) => r.status === "ok").length;
      const errors = runs.filter((r) => r.status === "error").length;
      const cost = runs.reduce((s, r) => s + r.cost_usd, 0);
      const avgMs = runs.length ? Math.round(runs.reduce((s, r) => s + (r.duration_ms || 0), 0) / runs.length) : 0;
      return { ...fl, runs: runs.length, ok, errors, cost_usd: Math.round(cost * 1e6) / 1e6, avg_ms: avgMs };
    })
  );
});

app.get("/api/executions", opsAuth, async (req, res) => {
  const flow = req.query.flow ? String(req.query.flow) : undefined;
  const limit = Number(req.query.limit) || 50;
  const mem = listExecutions({ flow, limit });
  let merged = mem;
  try {
    const tenant = await resolveRestaurant();
    const dbRows = await listExecutionsDb(tenant.db, { flow, limit });
    const seen = new Set(mem.map((e) => e.id));
    merged = [...mem, ...dbRows.filter((e) => !seen.has(e.id))]
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
      .slice(0, limit);
  } catch {}
  res.json(merged);
});

// HEALTH — what's breaking, grouped, so a recurring bug reads as one line and not
// fifty. Covers node-level failures too: a step can fail and be recovered by a
// fallback, and that's exactly the kind of thing that hides until someone looks.
app.get("/api/ops/health", opsAuth, async (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 24 * 14);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  try {
    const tenant = await resolveRestaurant();
    const { data, error } = await tenant.db
      .from("flow_executions")
      .select("id,flow,session_id,trigger,status,error,started_at,duration_ms,nodes")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(1000);
    // migration 003 not run → say so plainly rather than render a fake all-clear
    if (error) return res.json({ available: false, reason: error.message, runs: 0, groups: [], recent: [] });

    const rows = data || [];
    const failures = [];
    for (const r of rows) {
      const nodes = (Array.isArray(r.nodes) ? r.nodes : [])
        .filter((n) => n?.status === "error" || n?.error)
        .map((n) => ({ node: n.name, error: String(n.error || "unknown").slice(0, 600), ms: n.ms ?? null, model: n.model || null }));
      if (r.status !== "error" && !nodes.length) continue;
      failures.push({
        id: r.id, flow: r.flow, session_id: r.session_id, trigger: r.trigger,
        at: r.started_at, duration_ms: r.duration_ms,
        fatal: r.status === "error", // false = a step failed but the run recovered
        error: String(r.error || nodes[0]?.error || "unknown").slice(0, 600),
        nodes,
      });
    }

    const groups = new Map();
    for (const f of failures) {
      const key = `${f.flow}|${f.nodes[0]?.node || "-"}|${f.error.slice(0, 120)}`;
      const g = groups.get(key);
      if (g) { g.count++; if (f.at > g.last_at) g.last_at = f.at; }
      else groups.set(key, { key, flow: f.flow, node: f.nodes[0]?.node || null, error: f.error, count: 1, last_at: f.at, fatal: f.fatal });
    }

    res.json({
      available: true,
      window_hours: hours,
      runs: rows.length,
      failed_runs: failures.length,
      error_rate: rows.length ? Math.round((failures.length / rows.length) * 1000) / 10 : 0,
      groups: [...groups.values()].sort((a, b) => b.count - a.count || (a.last_at < b.last_at ? 1 : -1)),
      recent: failures.slice(0, 60),
    });
  } catch (e) {
    res.json({ available: false, reason: e.message, runs: 0, groups: [], recent: [] });
  }
});

app.get("/api/executions/:id", opsAuth, async (req, res) => {
  let e = getExecution(req.params.id);
  if (!e) {
    try {
      const tenant = await resolveRestaurant();
      e = await getExecutionDb(tenant.db, req.params.id);
    } catch {}
  }
  if (!e) return res.status(404).json({ error: "Not found" });
  res.json(e);
});

// ================= workers =================
async function flushHandler(sessionId, channel = "web") {
  const tenant = await resolveRestaurant();
  const ctx = { sessionId, tenant, channel, trigger: "buffer-flush" };
  const { error } = await runFlow("respond", ctx, {});
  if (error) await handleFlushFailure(ctx, error);
}

startFlushWorker(flushHandler);

// hourly janitor
setInterval(async () => {
  try {
    const tenant = await resolveRestaurant();
    await runFlow("janitor", { sessionId: "janitor", tenant, trigger: "schedule" }, {});
  } catch (e) {
    log("janitor error:", e.message);
  }
}, 3600_000);

// reservation reminders every 15 min (T-3h window, WA-window aware)
setInterval(async () => {
  try {
    const tenant = await resolveRestaurant();
    await runFlow("reminders", { sessionId: "reminders", tenant, trigger: "schedule" }, {});
  } catch (e) {
    log("reminders error:", e.message);
  }
}, 900_000);

// boot sweep: flush bursts stranded by a previous restart
resolveRestaurant()
  .then(async (t) => {
    bootSweep(t.db, flushHandler);
    // a deploy can kill a regression mid-run before its cleanup — sweep orphans here
    try {
      for (const pat of ["web:regress-%", "web:convo-%"]) {
        for (const [tb, col] of [["chat_messages", "session_id"], ["chat_sessions", "session_id"], ["message_full", "phone_number"], ["diners", "phone_number"], ["waitlist", "phone_number"], ["feedback", "phone_number"], ["temp_reservation", "phone_number"]])
          await t.db.from(tb).delete().like(col, pat);
        await t.db.from("orders").delete().like("phone_number", pat);
        await t.db.from("reservations").delete().like("diner_phone", pat);
        await t.db.from("notifications").delete().like("ref_id", pat);
      }
      log("boot: orphaned test sessions swept");
    } catch (e) { log("boot sweep of test sessions failed:", e.message); }
  })
  .catch((e) => log("boot sweep skipped:", e.message));

// graceful drain on redeploy
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    log(`${sig} — draining pending bursts…`);
    await drainAll(flushHandler).catch(() => {});
    process.exit(0);
  });
}

app.listen(PORT, () => log(`ahlan-resto flows on :${PORT} (llm: ${llmReady ? "ready" : "MISSING KEY"})`));
