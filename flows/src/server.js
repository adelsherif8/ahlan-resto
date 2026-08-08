import express from "express";
import cors from "cors";
import { PORT, log, llmReady, PUBLIC_BASE } from "./config.js";
import { resolveRestaurant, resolveRestaurantByWpid, resolveRestaurantById, resolveRestaurantBySlug, resolveAllRestaurants } from "./services/tenant.js";
import { startFlushWorker, setTyping, bootSweep, drainAll } from "./services/buffer.js";
import { runFlow, listFlows, listExecutions, getExecution, listExecutionsDb, getExecutionDb } from "./engine/flow.js";
import { verifyHandshake, verifySignature, parseEnvelope } from "./services/whatsapp.js";
import { metrics } from "./services/metrics.js";
import { runRegression, regressionStatus } from "./services/regression.js";
import { handleFlushFailure, deliverStaffReply } from "./flows/buffering.js";
import { getSession, logMessage } from "./services/chatlog.js";
import { riderCopy } from "./services/ridercopy.js";
import { verifyBuildToken, renderBuilderPage, priceBuild, describeBuild, builderConfig, priceMeal, signBuildToken, signTrackToken, LAYERS as BUILDER_LAYERS, MODEL_BASE } from "./services/builder.js";
import { nextOrderCode } from "./services/ordercode.js";
import { renderDriverPage } from "./services/driverpage.js";
import { renderTrackPage } from "./services/trackpage.js";

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
// ?r=<slug> says WHICH restaurant's menu. Without it these links resolved the
// default restaurant, so a guest of any other one was handed a competitor's menu —
// a cross-tenant leak, not just a wrong answer. The bot always stamps its own slug.
async function tenantFromQuery(req) {
  const slug = String(req.query?.r || "").trim().toLowerCase();
  if (slug) return resolveRestaurantBySlug(slug);
  const all = await resolveAllRestaurants();
  if (all.length > 1) return null;      // ambiguous → refuse rather than guess wrong
  return all[0] || resolveRestaurant();
}

app.get("/pdf/menu", async (req, res) => {
  try {
    const t = await tenantFromQuery(req);
    if (!t) return res.status(404).send("menu unavailable");
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

// Order codes are per-restaurant daily sequences, so the SAME code can exist in two
// restaurants — ?r=<slug> is what keeps a guest from being shown someone else's receipt.
app.get("/pdf/receipt/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);
    const slug = String(req.query?.r || "").trim().toLowerCase();
    // SECURITY: with no slug this used to scan EVERY restaurant and redirect to the
    // first match — order codes are per-restaurant daily sequences, so two restaurants
    // routinely share the same code, and a stripped/dropped ?r= silently handed a guest
    // a STRANGER's receipt (name, address, phone, items). Now refuses to guess when the
    // tenant is ambiguous, matching /pdf/menu's tenantFromQuery.
    let tenants;
    if (slug) tenants = [await resolveRestaurantBySlug(slug)];
    else {
      const all = await resolveAllRestaurants();
      if (all.length > 1) return res.status(404).send("receipt not found");
      tenants = all;
    }
    for (const t of tenants) {
      const { data } = await t.db.from("orders").select("receipt_url").eq("code", code).maybeSingle();
      if (data?.receipt_url) return res.redirect(302, data.receipt_url);
    }
    res.status(404).send("receipt not found");
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
      // WHOSE restaurant is this? The number the guest wrote to decides it.
      // An unknown number is dropped rather than answered by the default
      // restaurant — a cross-tenant reply is worse than no reply.
      let tenant;
      try {
        tenant = await resolveRestaurantByWpid(event.phoneNumberId);
      } catch (e) {
        log(`WA webhook: no restaurant for phone_number_id ${event.phoneNumberId} — dropped (${e.message})`);
        continue;
      }
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
    // optional ?restaurant=<slug> lets the ops console drive any tenant's bot
    const tenant = req.body.restaurant
      ? await resolveRestaurantBySlug(String(req.body.restaurant))
      : await resolveRestaurant(req.body.wpid || null);
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
    const tenant = req.query.restaurant ? await resolveRestaurantBySlug(String(req.query.restaurant)) : await resolveRestaurant();
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
      out_for_delivery: riderCopy.out(order),
      served: type === "delivery"
        ? `🛵 Order ${order.code} is ON ITS WAY${brName ? ` from ${brName}` : ""}${order.address ? ` to ${order.address}` : ""}.${maps ? `\n📍 Coming from: ${maps}` : ""}`
        : null,
      delivered: riderCopy.delivered(order),
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

// The token IS the auth and it carries no restaurant, so the only honest lookup is
// to ask every tenant. Resolving a single restaurant here silently 404'd the driver
// page for every order belonging to any other one.
async function driverOrder(token) {
  if (!token || !/^[a-z2-9]{16,30}$/.test(String(token))) return null;
  for (const tenant of await resolveAllRestaurants()) {
    const { data: order } = await tenant.db.from("orders").select("*").eq("courier_token", String(token)).maybeSingle();
    if (order && order.status !== "cancelled") return { tenant, order };
  }
  return null;
}

async function pushGuest(tenant, order, text) {
  if (!order.phone_number || String(order.phone_number).startsWith("walkin:")) return;
  const ctx = { sessionId: order.phone_number, tenant, channel: String(order.phone_number).startsWith("web:") ? "web" : "whatsapp" };
  await deliverStaffReply(ctx, text).catch(() => {});
  await logMessage(tenant.db, order.phone_number, "ai", text, ctx.channel).catch(() => {});
}

// ---- build your own sandwich -------------------------------------------
// The signed token says who the guest is and which restaurant they're ordering
// from, so the page never has to be trusted for either.
app.get("/build/:token", async (req, res) => {
  try {
    const claim = verifyBuildToken(req.params.token);
    if (!claim) return res.status(404).send("<h3 style=\"font-family:sans-serif\">This build link has expired.</h3>");
    const tenant = await resolveRestaurantBySlug(claim.slug);
    // category is needed for "make it a meal" — without it nothing could ever match
    const { data: menu } = await tenant.db.from("menu_items").select("name,price,available,category,photo_url").limit(120);

    // "Most ordered" from REAL builds. No builder orders yet means no trending list —
    // the page simply doesn't offer one rather than showing a made-up ranking.
    let popular = [];
    try {
      const { data: past } = await tenant.db.from("orders")
        .select("items").order("created_at", { ascending: false }).limit(300);
      const tally = new Map();
      for (const o of past || []) {
        for (const it of o.items || []) {
          if (!it?.build) continue;
          for (const [id, q] of Object.entries(it.build)) tally.set(id, (tally.get(id) || 0) + (Number(q) || 0));
        }
      }
      popular = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
    } catch { /* trending is a nicety — never break the builder over it */ }

    res.type("html").send(renderBuilderPage(tenant, req.params.token, {
      popular,
      preview: claim.preview,
      lite: req.query?.lite === "1",
      menu: (menu || []).filter((m) => m.available !== false),
    }));
  } catch (e) {
    log("build page:", e.message);
    res.status(500).send("builder unavailable");
  }
});

app.post("/api/build/:token/submit", async (req, res) => {
  try {
    const claim = verifyBuildToken(req.params.token);
    if (!claim) return res.status(401).json({ error: "link expired" });
    // the staff preview shows unpriced ingredients — it must never reach the kitchen
    if (claim.preview) return res.json({ ok: true, preview: true, note: "Preview only — no ticket was sent to the kitchen." });
    const tenant = await resolveRestaurantBySlug(claim.slug);
    const { config, db } = tenant;

    // The page sends WHICH layers, never what they cost. Anything it claims about
    // price is discarded here and recomputed from the restaurant's own config.
    const picked = {};
    for (const it of Array.isArray(req.body?.items) ? req.body.items : []) {
      if (it?.id) picked[String(it.id)] = Number(it.quantity) || 0;
    }
    const priced = priceBuild(config, picked);
    if (!priced.lines.length) return res.status(400).json({ error: "nothing on the sandwich" });

    const name = describeBuild(priced.lines);
    // doneness/sauce/allergies and the customer's own name for the build belong on the
    // ticket — the kitchen needs them as much as the layer list
    const x = req.body?.extras || {};
    const notes = [
      name,
      x.doneness ? String(x.doneness).slice(0, 20) : null,
      x.sauce ? String(x.sauce).slice(0, 20) : null,
      // was .slice(0,5) on the ARRAY only — an individual entry had no length cap, so a
      // single multi-megabyte string could still land in this stored field
      Array.isArray(x.avoid) && x.avoid.length
        ? `NO ${x.avoid.slice(0, 5).map((a) => String(a).slice(0, 20)).join(", ").toUpperCase()}`
        : null,
      x.kids ? "kids portion" : null,
    ].filter(Boolean).join(" · ");

    const item = {
      name: x.name ? String(x.name).slice(0, 32) : "Build Your Own",
      qty: 1,
      unit_price: priced.total,
      notes,
      options: priced.lines.map((l) => `${l.qty}× ${l.name}`).join(" · "),
      // the exact ingredient ids, so "most ordered" is counted from what people
      // actually built rather than parsed back out of a display string
      build: Object.fromEntries(priced.lines.map((l) => [l.id, l.qty])),
    };

    // SECURITY/CORRECTNESS: the checkout's "make it a meal" step shows and totals real
    // menu prices for the sides/drinks picked, then sent their NAMES here — which used
    // to be read nowhere. The customer was shown and told a price that included the
    // meal; the order and kitchen ticket reflected only the sandwich. Priced here from
    // the restaurant's own current menu (never a client-sent price) and added as their
    // own line items so the kitchen actually sees them, not just a total.
    const { data: mealMenu } = await db.from("menu_items").select("name,price,available,category,photo_url").limit(120);
    const meal = priceMeal(mealMenu, x.meal);
    const mealItems = meal.lines.map((l) => ({ name: l.name, qty: 1, unit_price: l.price }));

    // WHERE DID THIS BUILD COME FROM?
    // A link the bot sent belongs to a conversation — the build must return to that
    // conversation so the customer picks delivery/pickup, address and payment where
    // they already are, not get fired straight at the kitchen with none of it decided.
    const fromChat = /^\+/.test(String(claim.sessionId));

    const grandTotal = priced.total + meal.total;
    const mealLine = meal.lines.length ? `\n+ ${meal.lines.map((l) => l.name).join(", ")}` : "";

    if (fromChat) {
      const { data: diner } = await db.from("diners").select("id,preferences,name")
        .eq("phone_number", claim.sessionId).maybeSingle();
      const built = {
        name: item.name, qty: 1, unit_price: priced.total, notes: item.notes,
        options: item.options, build: item.build,
      };
      if (diner?.id) {
        const pending = diner.preferences?.pending_order || {};
        const preferences = {
          ...(diner.preferences || {}),
          // meal items ride along as their OWN pending-order lines, priced from the
          // menu just like the sandwich — this is the fix: they used to be shown and
          // totalled on the checkout screen and then read nowhere on this side.
          pending_order: { ...pending, items: [...(pending.items || []), built, ...mealItems], at: new Date().toISOString() },
          // saved builds live against the number, so the bot can offer "your usual"
          builds: [{ name: item.name, layers: item.build, total: priced.total, at: new Date().toISOString() },
                   ...((diner.preferences?.builds || []).slice(0, 4))],
        };
        await db.from("diners").update({ preferences }).eq("id", diner.id);
      }
      await pushGuest(tenant, { phone_number: claim.sessionId },
        `Your build is in 🍔\n${item.name === "Build Your Own" ? name : `${item.name} — ${name}`}${mealLine}\n${priced.currency} ${grandTotal}\n\nHow would you like it — dine-in, pickup or delivery?`,
      ).catch(() => {});
      return res.json({ ok: true, handoff: "whatsapp", total: grandTotal, currency: priced.currency, summary: name });
    }

    // Walk-up / QR / kiosk: no conversation to return to, so we need a number —
    // the receipt tells them to message that number to track the order.
    const cust = req.body?.customer || {};
    const phone = String(cust.phone || "").replace(/[^+\d]/g, "").slice(0, 20);
    if (phone.replace(/\D/g, "").length < 8) {
      return res.status(400).json({ error: "phone required", need: "customer" });
    }
    const custName = String(cust.name || "").trim().slice(0, 40) || null;

    // remember them, so a later WhatsApp message from this number finds their order
    try {
      const { data: d } = await db.from("diners").select("id,preferences").eq("phone_number", phone).maybeSingle();
      const builds = [{ name: item.name, layers: item.build, total: priced.total, at: new Date().toISOString() },
                      ...((d?.preferences?.builds || []).slice(0, 4))];
      if (d?.id) await db.from("diners").update({ preferences: { ...(d.preferences || {}), builds }, ...(custName ? { name: custName } : {}) }).eq("id", d.id);
      else await db.from("diners").insert({ phone_number: phone, name: custName, preferences: { builds } });
    } catch { /* the order matters more than the CRM row */ }

    const code = await nextOrderCode(db, config);
    const row = {
      code,
      phone_number: phone,
      diner_name: custName,
      order_type: "pickup",          // the guest picks how to get it in chat, where that flow already lives
      items: [item, ...mealItems],
      subtotal: grandTotal,
      total: grandTotal,
      status: "pending",
      source: "builder",
    };
    // supabase-js RETURNS errors rather than throwing, so a missing column has to be
    // handled on the result — not in a catch that never fires. `source` only exists
    // once its migration has run; the ticket matters more than the provenance column.
    let order = await db.from("orders").insert(row).select().single();
    if (order.error && /source/.test(order.error.message)) {
      delete row.source;
      order = await db.from("orders").insert(row).select().single();
    }
    if (order.error) throw new Error(order.error.message);

    // the board hears about it like any other ticket
    await db.from("notifications").insert({
      type: "order",
      title: `Custom sandwich ${code}`,
      body: `${name}${mealLine.replace(/^\n/, " ")} · ${priced.currency} ${grandTotal}`,
      ref_id: code,
    }).then(() => {}, () => {});

    // BUG FIX: this pushed to claim.sessionId — for a walk-up/QR/share link that is an
    // internal token string like "web:share-xxxxx", never the phone number the customer
    // just typed into the checkout form. The confirmation was silently going nowhere;
    // every walk-up order's WhatsApp receipt never arrived. `phone` (validated above) is
    // the number that was actually collected.
    // The ticket already went to the kitchen as pickup (order_type is fixed above, not
    // asked) — the message says so instead of asking a question this flow has no way to
    // receive an answer to (no pending_order/session state exists for a fresh walk-up
    // number to route a reply through).
    await pushGuest(
      tenant,
      { phone_number: phone },
      `Your custom sandwich is in — ${code}.\n${name}${mealLine}\nTotal: ${priced.currency} ${grandTotal}\n\nWe've got it as pickup — message us here with this code any time to check on it.`,
    ).catch(() => {});

    res.json({ ok: true, code, total: grandTotal, currency: priced.currency, summary: name });
  } catch (e) {
    log("build submit:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Staff preview: the dashboard mints a short-lived link to try the builder without
// waiting for a customer to ask. Session is marked web:test- so it is filtered from
// stats and swept by the janitor like any other test traffic.
app.post("/api/ops/build-link", opsAuth, async (req, res) => {
  try {
    const slug = String(req.body?.restaurant || "").trim().toLowerCase();
    if (!slug) return res.status(400).json({ error: "restaurant required" });
    const tenant = await resolveRestaurantBySlug(slug);
    const bc = builderConfig(tenant.config);
    const token = signBuildToken({ sessionId: `web:test-preview-${Date.now()}`, slug, ttlMs: 3600_000, preview: true });
    // the dashboard renders its price fields FROM this list, so the two can never
    // drift out of sync the way a second hard-coded copy would
    res.json({
      url: `${PUBLIC_BASE}/build/${token}`,
      enabled: bc.enabled,
      reason: bc.reason,
      priced: bc.layers.length,
      catalog: BUILDER_LAYERS.map((l) => ({ key: l.key, name: l.name, category: l.category })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Share a build. The link must NOT carry the sharer's token — that token is tied to
// their phone number and their pending order, so a friend opening it would be ordering
// as them. A fresh, anonymous token is minted instead: whoever opens it is treated as a
// walk-up and asked for their own name and number.
app.post("/api/build/:token/share", async (req, res) => {
  try {
    const claim = verifyBuildToken(req.params.token);
    if (!claim) return res.status(401).json({ error: "link expired" });
    const picked = {};
    for (const it of Array.isArray(req.body?.items) ? req.body.items : []) {
      if (it?.id) picked[String(it.id)] = Math.max(0, Math.min(9, Number(it.quantity) || 0));
    }
    if (!Object.keys(picked).length) return res.status(400).json({ error: "nothing to share" });

    const token = signBuildToken({
      sessionId: `web:share-${Math.random().toString(36).slice(2, 10)}`,
      slug: claim.slug,
      ttlMs: 7 * 24 * 3600_000,       // a shared build is worth keeping alive for a week
    });
    const b = Object.entries(picked).map(([id, q]) => `${id}:${q}`).join(",");
    res.json({ url: `${PUBLIC_BASE}/build/${token}?b=${encodeURIComponent(b)}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// the page asks for models on a path relative to itself
app.get("/build/Burger1/:file", (req, res) => {
  const f = String(req.params.file || "").replace(/[^\w.-]/g, "");
  res.redirect(302, `${MODEL_BASE}/${f}`);
});

// ---- customer order tracking ------------------------------------------
// Signed like the build link, so there is no new column and a link that leaks later
// has already expired. The rider had a live page; the person waiting for the food
// had nothing but text messages.
async function trackedOrder(token) {
  const claim = verifyBuildToken(token);
  if (!claim) return null;
  const tenant = await resolveRestaurantBySlug(claim.slug);
  const { data: order } = await tenant.db.from("orders").select("*").eq("code", claim.sessionId).maybeSingle();
  if (!order) return null;
  let courier = null;
  if (order.courier_id) {
    const { data: c } = await tenant.db.from("couriers").select("name,phone_number,vehicle").eq("id", order.courier_id).maybeSingle();
    courier = c || null;
  }
  if (!courier && order.courier_name) courier = { name: order.courier_name, phone_number: order.courier_phone || null, vehicle: null };
  return { tenant, order, courier };
}

app.get("/track/:token", async (req, res) => {
  try {
    const hit = await trackedOrder(req.params.token);
    if (!hit) return res.status(404).send("<h3 style=\"font-family:sans-serif\">This tracking link has expired.</h3>");
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.send(renderTrackPage({
      config: hit.tenant.config,
      brand: hit.tenant.config.basic_info?.brand || {},
      order: hit.order, courier: hit.courier,
      apiBase: FLOWS_PUBLIC, token: req.params.token,
    }));
  } catch (e) {
    log("track page:", e.message);
    res.status(500).send("error");
  }
});

// polled by the page so a waiting customer never has to refresh
app.get("/api/track/:token/state", async (req, res) => {
  try {
    const hit = await trackedOrder(req.params.token);
    if (!hit) return res.json({ ok: false });
    const o = hit.order;
    const fresh = o.courier_seen_at && Date.now() - new Date(o.courier_seen_at).getTime() < 15 * 60_000;
    res.json({
      ok: true,
      status: o.status,
      delivered: o.status === "delivered",
      status_changed: req.query.s ? String(req.query.s) !== String(o.status) : false,
      rider: fresh && Number.isFinite(Number(o.courier_lat))
        ? { lat: Number(o.courier_lat), lng: Number(o.courier_lng) } : null,
    });
  } catch (e) {
    res.json({ ok: false });
  }
});

app.get("/driver/:token", async (req, res) => {
  try {
    const hit = await driverOrder(req.params.token);
    if (!hit) return res.status(404).send("<h3 style=\"font-family:sans-serif\">Link expired or order not found.</h3>");
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.send(renderDriverPage({ tenant: hit.tenant, order: hit.order, token: req.params.token, apiBase: FLOWS_PUBLIC }));
  } catch (e) {
    log("driver page:", e.message);
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
      const trackUrl = `${PUBLIC_BASE}/track/${signTrackToken({ code: order.code, slug: tenant.config.slug })}`;
      await pushGuest(tenant, order, riderCopy.out(order, trackUrl));
      return res.json({ ok: true, note: "Customer told it's on the way" });
    }
    if (action === "near") {
      await pushGuest(tenant, order, riderCopy.near(order));
      return res.json({ ok: true, note: "Customer told you're near" });
    }
    if (action === "arrived") {
      // the RESTAURANT's number tells the guest — the rider never messages from his own
      await db.from("orders").update({ courier_arrived_at: new Date().toISOString() }).eq("id", order.id).then(() => {}, () => {});
      await pushGuest(tenant, order, riderCopy.arrived(order));
      return res.json({ ok: true, note: "Customer told you've arrived" });
    }
    if (action === "delay") {
      const extra = (Number(order.eta_extra_min) || 0) + 10;
      await db.from("orders").update({ eta_extra_min: extra }).eq("id", order.id).then(() => {}, () => {});
      await pushGuest(tenant, order, riderCopy.delay(order, 10));
      return res.json({ ok: true, note: "Customer told about the delay" });
    }
    if (action === "delivered") {
      const patch = { status: "delivered", delivered_at: new Date().toISOString(), notified_status: "delivered" };
      if (order.payment_method === "cash") patch.payment_status = "paid"; // COD collected at the door
      await db.from("orders").update(patch).eq("id", order.id)
        .then((r2) => r2.error ? db.from("orders").update({ status: "delivered", ...(order.payment_method === "cash" ? { payment_status: "paid" } : {}) }).eq("id", order.id) : r2);
      await pushGuest(tenant, order, riderCopy.delivered(order));
      return res.json({ ok: true, note: "Delivered — customer thanked" });
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

// Manual triggers mirror the schedulers: no restaurant named = run for EVERY tenant,
// so a hand-run never silently skips a restaurant the way the old single-slug version did.
async function runForTenants(flowName, slug) {
  const tenants = slug ? [await resolveRestaurantBySlug(slug)] : await resolveAllRestaurants();
  const runs = [];
  for (const tenant of tenants) {
    try {
      const { exec } = await runFlow(flowName, { sessionId: flowName, tenant, trigger: "manual" }, {});
      runs.push({ restaurant: tenant.record.slug, ok: exec.status === "ok", executionId: exec.id });
    } catch (e) {
      runs.push({ restaurant: tenant.record.slug, ok: false, error: e.message });
    }
  }
  return runs;
}

app.post("/api/ops/run-reminders", opsAuth, async (req, res) => {
  try {
    const runs = await runForTenants("reminders", req.body?.restaurant);
    res.json({ ok: runs.every((r) => r.ok), runs, executionId: runs[0]?.executionId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ops/run-janitor", opsAuth, async (req, res) => {
  try {
    const runs = await runForTenants("janitor", req.body?.restaurant);
    res.json({ ok: runs.every((r) => r.ok), runs, executionId: runs[0]?.executionId });
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
// Buffer keys are "<restaurantId>|<sessionId>" so two restaurants can never
// share a burst — the same guest phone may talk to both, and their messages
// must stay in separate conversations.
async function flushHandler(bufferKey, channel = "web") {
  const sep = String(bufferKey).indexOf("|");
  const restaurantId = sep > 0 ? bufferKey.slice(0, sep) : null;
  const sessionId = sep > 0 ? bufferKey.slice(sep + 1) : bufferKey;
  const tenant = restaurantId ? await resolveRestaurantById(restaurantId) : await resolveRestaurant();
  const ctx = { sessionId, bufferKey, tenant, channel, trigger: "buffer-flush" };
  const { error } = await runFlow("respond", ctx, {});
  if (error) await handleFlushFailure(ctx, error);
}

startFlushWorker(flushHandler);

// hourly janitor
setInterval(async () => {
  try {
    for (const tenant of await resolveAllRestaurants()) {
      await runFlow("janitor", { sessionId: "janitor", tenant, trigger: "schedule" }, {}).catch((e) => log(`janitor ${tenant.record.slug}:`, e.message));
    }
  } catch (e) {
    log("janitor error:", e.message);
  }
}, 3600_000);

// reservation reminders every 15 min (T-3h window, WA-window aware)
setInterval(async () => {
  try {
    for (const tenant of await resolveAllRestaurants()) {
      await runFlow("reminders", { sessionId: "reminders", tenant, trigger: "schedule" }, {}).catch((e) => log(`reminders ${tenant.record.slug}:`, e.message));
    }
  } catch (e) {
    log("reminders error:", e.message);
  }
}, 900_000);

// boot sweep: flush bursts stranded by a previous restart
resolveRestaurant()
  .then(async (t) => {
    bootSweep(t.db, flushHandler, t.record.id);
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
