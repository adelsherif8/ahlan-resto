import { orderedCategories } from "./services/categories.js";
import express from "express";
import cors from "cors";
import { PORT, log, llmReady, PUBLIC_BASE } from "./config.js";
import { resolveRestaurant, resolveRestaurantByWpid, resolveRestaurantById, resolveRestaurantBySlug, resolveAllRestaurants, recordServiceBoot, listServiceBoots, upsertCostDaily, readCostDaily } from "./services/tenant.js";
import { startFlushWorker, setTyping, bootSweep, drainAll } from "./services/buffer.js";
import { runFlow, listFlows, listExecutions, getExecution, listExecutionsDb, getExecutionDb, isTestSession } from "./engine/flow.js";
import { verifyHandshake, verifySignature, parseEnvelope } from "./services/whatsapp.js";
import { metrics, bump } from "./services/metrics.js";
import { runRegression, regressionStatus, loadLastRegression } from "./services/regression.js";
import { handleFlushFailure, deliverStaffReply } from "./flows/buffering.js";
import { TRACE_MAX_AGE_D as TRACE_RETENTION_D, TRACE_ERROR_MAX_AGE_D as TRACE_ERROR_RETENTION_D } from "./flows/janitor.js";
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
const IS_PROD = process.env.RAILWAY_ENVIRONMENT === "production" || process.env.NODE_ENV === "production";
import nodeCrypto from "node:crypto";

// CORS allowlist — the driver/track/build pages and the dashboard live on PUBLIC_BASE
// (Vercel); the ops console runs on localhost in dev. Requests with NO Origin header
// (Meta's webhook, server-to-server, curl) are always allowed — CORS only gates browsers.
const ALLOWED_ORIGINS = new Set([PUBLIC_BASE, "https://ahlan-resto.vercel.app", "https://app.munadim.com", "https://munadim-dashboard.pages.dev", "https://ahlan-ops.vercel.app"]);
// The internal ops console lives on Vercel — its per-deploy preview URLs rotate
// (ahlan-<hash>-adelsherif8s-projects.vercel.app), so they're matched by shape.
const OPS_CONSOLE_ORIGIN = /^https:\/\/ahlan-(ops-)?[a-z0-9]+-adelsherif8s-projects\.vercel\.app$/;
app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.has(origin) || OPS_CONSOLE_ORIGIN.test(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    cb(null, false); // unknown browser origin: no CORS headers -> browser blocks the response
  },
}));

// Tiny in-memory rate limiter for the PUBLIC endpoints (webhook, driver, builder).
// Fixed window per key; buckets swept each window. Not distributed — this service is a
// single instance, and the goal is stopping abuse/floods, not precise quotas.
const rlBuckets = new Map(); // key -> { n, resetAt }
setInterval(() => { const now = Date.now(); for (const [k, b] of rlBuckets) if (b.resetAt < now) rlBuckets.delete(k); }, 60_000).unref?.();
function rateLimit(name, max, windowMs, keyFn = (req) => req.ip) {
  return (req, res, next) => {
    const key = `${name}:${keyFn(req)}`;
    const now = Date.now();
    let b = rlBuckets.get(key);
    if (!b || b.resetAt < now) { b = { n: 0, resetAt: now + windowMs }; rlBuckets.set(key, b); }
    if (++b.n > max) { bump("rate_limited"); return res.status(429).json({ error: "too many requests — slow down" }); }
    next();
  };
}

// keep raw body for WhatsApp signature verification
app.use(express.json({ limit: "4mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Branded short links — the guest-facing URL is pretty; the storage URL stays
// hidden behind a redirect. the dashboard host used to proxy /menu.pdf and
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

// Both spellings are served here. Bills, receipt QRs and older WhatsApp messages
// carry /menu.pdf and /receipt/:code — those used to reach us through the Vercel
// dashboard's rewrites, so once PUBLIC_BASE moved onto this service directly they
// 404'd for guests. The pretty paths are permanent guest-facing URLs; they must
// resolve wherever PUBLIC_BASE points.
app.get(["/pdf/menu", "/menu.pdf"], async (req, res) => {
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
          categories: orderedCategories(menu, t.config).map((c) => c.name),
          currency: t.config.payments?.currency || "EGP",
          accent: t.config.basic_info?.brand?.primary || "#111111",
          tagline: t.config.basic_info?.tagline || "",
          phone: t.config.basic_info?.phone || "",
          website: t.config.basic_info?.website || "",
          logoUrl: t.config.basic_info?.brand?.logo_url || null,
        });
    if (!pdf?.url) return res.status(404).send("menu unavailable");
    res.redirect(302, pdf.url);
  } catch (e) { res.status(500).send(e.message); }
});

// Order codes are per-restaurant daily sequences, so the SAME code can exist in two
// restaurants — ?r=<slug> is what keeps a guest from being shown someone else's receipt.
app.get(["/pdf/receipt/:code", "/receipt/:code"], async (req, res) => {
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

app.post("/api/wa/webhook", rateLimit("wa", 600, 60_000), async (req, res) => {
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
app.post("/api/web/send", opsAuth, rateLimit("websend", 60, 60_000), async (req, res) => {
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

app.post("/api/web/typing", opsAuth, (req, res) => {
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

// Arabic menu copy on demand — the dashboard's ✨ button. Stateless: takes the
// English name/ingredients, returns the Egyptian-menu Arabic for both. Staff
// review it in the form and can edit before saving; nothing is written here.
// Dish names are TRANSLITERATED the way Cairo menus print them (Classic Burger →
// كلاسيك برجر), never translated into meaning; ingredients are translated.
app.post("/api/ops/arabize-item", opsAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 120);
    const ingredients = String(req.body?.ingredients || req.body?.description || "").trim().slice(0, 600);
    if (!name) return res.status(400).json({ error: "name required" });
    const { chatJSON } = await import("./services/llm.js");
    const { MODEL_FAST } = await import("./config.js");
    const system = `You write Arabic menu copy for a Cairo restaurant, the way printed Egyptian menus do.
name_ar: TRANSLITERATE the dish name into Arabic letters as Egyptian menus print it — brand-style words stay as sounds ("Classic Burger" → "كلاسيك برجر", "Chicken Tenders 3 Pcs Nashville" → "تشيكن تندرز ناشفيل ٣ قطع", "Loaded Fries" → "لودد فرايز"); counts become Arabic numerals (3 → ٣). Never translate the meaning of a dish name.
ingredients_ar: TRANSLATE the ingredient list into everyday Egyptian Arabic food words (Beef Patty → قطعة لحم بقري, American Cheese → جبنة أمريكاني, Pickles → مخلل, Lettuce → خس, Brioche Bun → عيش بريوش, Sauce → صوص). Keep the same order and separators. Empty string if no ingredients were given.
Return JSON {"name_ar": string, "ingredients_ar": string}. Nothing else.`;
    const r = await chatJSON(MODEL_FAST, system, JSON.stringify({ name, ingredients }), { temperature: 0, maxTokens: 300 });
    const v = r?.value || {};
    res.json({ name_ar: String(v.name_ar || "").trim().slice(0, 120), ingredients_ar: String(v.ingredients_ar || "").trim().slice(0, 600) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// COVERAGE MAP — see a restaurant's delivery boundary, branch pin and landmarks on a
// real map. Read-only, ops-token protected (query param so it opens in a tab):
//   /api/ops/coverage-map?slug=luciz&token=<ops token>
// Leaflet + OpenStreetMap tiles, no key. The editable version lives in the dashboard.
app.get("/api/ops/coverage-map", async (req, res) => {
  const tok = String(req.query.token || req.headers["x-ops-token"] || "");
  if (!OPS_TOKEN || tok !== OPS_TOKEN) return res.status(401).send("invalid token");
  try {
    const slug = String(req.query.slug || "luciz");
    const tenant = await resolveRestaurantBySlug(slug);
    const cfg = tenant.config || {};
    const d = cfg.delivery || cfg.basic_info?.delivery || {};
    const branches = (cfg.basic_info?.branches || []).filter((b) => typeof b?.lat === "number");
    const zones = (d.zones || []).map((z) => ({ area: z.area, polygon: z.polygon || null, lat: z.lat ?? null, lng: z.lng ?? null, radius_km: z.radius_km ?? null }));
    const landmarks = (d.landmarks || []).filter((l) => typeof l?.lat === "number").map((l) => ({ name: l.name, lat: l.lat, lng: l.lng, kind: l.kind || "place" }));
    const pricing = d.pricing || {};
    const data = JSON.stringify({ name: cfg.name || slug, zones, branches: branches.map((b) => ({ name: b.name, lat: b.lat, lng: b.lng })), landmarks, pricing });
    res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>${cfg.name || slug} — delivery coverage</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#map{height:100%;margin:0}#legend{position:absolute;z-index:1000;top:10px;left:50px;background:#18181b;color:#e4e4e7;font:13px system-ui;padding:10px 12px;border-radius:10px;max-width:340px;box-shadow:0 4px 20px rgba(0,0,0,.4)}#legend b{color:#fbbf24}.sw{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}</style></head>
<body><div id="map"></div><div id="legend"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const D=${data};
const map=L.map('map');
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
const layers=[];
for(const z of D.zones){
  if(z.polygon&&z.polygon.length>=3){const p=L.polygon(z.polygon,{color:'#f59e0b',weight:2,fillColor:'#f59e0b',fillOpacity:.15}).addTo(map).bindPopup('<b>'+z.area+'</b><br>'+z.polygon.length+' points');layers.push(p);}
  else if(z.lat!=null){const c=L.circle([z.lat,z.lng],{radius:(z.radius_km||5)*1000,color:'#f59e0b',weight:2,fillOpacity:.12}).addTo(map).bindPopup('<b>'+z.area+'</b><br>'+(z.radius_km||5)+' km circle');layers.push(c);}
}
for(const b of D.branches){const m=L.circleMarker([b.lat,b.lng],{radius:9,color:'#fff',weight:2,fillColor:'#ef4444',fillOpacity:1}).addTo(map).bindPopup('<b>Branch: '+b.name+'</b>');layers.push(m);
  if(D.pricing&&D.pricing.mode==='distance'){const km=Number(D.pricing.base_km)||0;if(km>0)L.circle([b.lat,b.lng],{radius:km*1000/(Number(D.pricing.road_factor)||1.3),color:'#22c55e',weight:1,dashArray:'4 4',fillOpacity:.04}).addTo(map).bindPopup('≈ '+km+' km road → base fee '+D.pricing.base_fee+' EGP');}}
for(const l of D.landmarks){const m=L.circleMarker([l.lat,l.lng],{radius:l.kind==='area'?6:5,color:l.kind==='area'?'#38bdf8':'#a78bfa',weight:2,fillColor:l.kind==='area'?'#38bdf8':'#a78bfa',fillOpacity:.9}).addTo(map).bindTooltip(l.name,{direction:'top',opacity:.9});layers.push(m);}
if(layers.length){map.fitBounds(L.featureGroup(layers).getBounds().pad(.08));}else map.setView([30.03,31.47],12);
const P=D.pricing||{};
document.getElementById('legend').innerHTML='<b>'+D.name+' — delivery coverage</b><br>'+
'<span class="sw" style="background:#f59e0b"></span>covered area ('+D.zones.map(z=>z.area).join(', ')+')<br>'+
'<span class="sw" style="background:#ef4444"></span>branch'+(D.branches.length?' — '+D.branches.map(b=>b.name).join(', '):' (no pin!)')+'<br>'+
(P.mode==='distance'?'<span class="sw" style="background:#22c55e"></span>base '+P.base_fee+' EGP up to '+P.base_km+' km, +'+P.per_km+'/km, round '+(P.round_km||'up')+'<br>':'<span class="sw" style="background:#22c55e"></span>pricing: '+(P.mode||'zone_fixed')+'<br>')+
'<span class="sw" style="background:#38bdf8"></span>district / axis ('+D.landmarks.filter(l=>l.kind==='area').length+') &nbsp; <span class="sw" style="background:#a78bfa"></span>landmark ('+D.landmarks.filter(l=>l.kind!=='area').length+')<br>'+
'<span style="color:#a1a1aa">hover a dot for its name · read-only (edit in Settings)</span>';
</script></body></html>`);
  } catch (e) { res.status(500).send(String(e.message)); }
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
    // Founder rule (2026-08-12): NO proactive status messages — the tracking page is
    // the single source of progress. Exceptions that still send: a cancellation
    // (guest must know) and pickup-READY (the guest is literally waiting on it).
    const critical = status === "cancelled" || (status === "ready" && order.order_type === "pickup");
    if (tenant.config.ai?.status_updates !== "messages" && !critical) {
      await tenant.db.from("orders").update({ notified_status: status }).eq("id", order.id).then(() => {}, () => {});
      return res.json({ skipped: "silent mode — the tracking page carries status" });
    }

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

app.post("/api/build/:token/submit", rateLimit("bsubmit", 20, 60_000, (req) => req.params.token), async (req, res) => {
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
app.post("/api/build/:token/share", rateLimit("bshare", 10, 60_000, (req) => req.params.token), async (req, res) => {
  try {
    const claim = verifyBuildToken(req.params.token);
    if (!claim) return res.status(401).json({ error: "link expired" });
    // A staff PREVIEW token is for looking only — the submit endpoint refuses it. But
    // /share minted a fresh token WITHOUT the preview flag, so a preview could be
    // laundered into a real, orderable, week-long link. Refuse: a preview is not a
    // source of shareable real-order links.
    if (claim.preview) return res.status(403).json({ error: "preview links can't be shared" });
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

app.post("/api/driver/:token/action", rateLimit("dact", 30, 60_000, (req) => req.params.token), async (req, res) => {
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
      // silent by design: the guest's track page shows the delay — no WhatsApp message
      return res.json({ ok: true, note: "Delay shown on the guest's tracking page" });
    }
    if (action === "pod") {
      // Proof of delivery: the rider snaps a photo at the door (page downscales it to
      // ~1280px JPEG before upload). Stored in tenant storage; pod_url on the order is
      // best-effort (migration 028) so a pre-migration DB still keeps the photo.
      const dataUrl = String(req.body?.photo || "");
      const m = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
      if (!m) return res.status(400).json({ error: "photo (data URL) required" });
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 3_500_000) return res.status(413).json({ error: "photo too large" });
      const BUCKET = "pod";
      const path = `${order.code}.jpg`;
      let up = await db.storage.from(BUCKET).upload(path, buf, { contentType: "image/jpeg", upsert: true });
      if (up.error) {
        await db.storage.createBucket(BUCKET, { public: true }).catch(() => {});
        up = await db.storage.from(BUCKET).upload(path, buf, { contentType: "image/jpeg", upsert: true });
      }
      if (up.error) return res.status(500).json({ error: up.error.message });
      const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
      const pod_url = `${pub.publicUrl}?v=${Date.now()}`;
      await db.from("orders").update({ pod_url }).eq("id", order.id).then(() => {}, () => {});
      return res.json({ ok: true, url: pod_url, note: "Proof of delivery saved 📸" });
    }
    if (action === "cod") {
      // Rider records the cash he actually received; change is computed here, not typed —
      // one less place for a tired rider to make math at a doorstep. Stored on the order
      // (best-effort columns) AND appended to notes so it shows on tickets/back-office
      // even before any migration adds the columns.
      const received = Math.max(0, Number(req.body?.received) || 0);
      if (!received) return res.status(400).json({ error: "received amount required" });
      const change = Math.max(0, received - (Number(order.total) || 0));
      const codNote = `COD: received ${received}, change ${change}`;
      const notes = [String(order.notes || "").replace(/COD: received \d+(?:\.\d+)?, change \d+(?:\.\d+)?/g, "").trim() || null, codNote].filter(Boolean).join(" · ");
      await db.from("orders").update({ cod_received: received, cod_change: change, notes }).eq("id", order.id)
        .then((r2) => r2.error ? db.from("orders").update({ notes }).eq("id", order.id) : r2);
      return res.json({ ok: true, note: `Recorded — change to give: EGP ${change.toLocaleString()}` });
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

app.post("/api/driver/:token/loc", rateLimit("dloc", 240, 60_000, (req) => req.params.token), async (req, res) => {
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
  // FAIL CLOSED in production: an unset OPS_TOKEN must never mean "everything open".
  if (!OPS_TOKEN) {
    if (IS_PROD) return res.status(401).json({ error: "ops token not configured" });
    return next(); // local dev without a token
  }
  const given = Buffer.from(String(req.headers["x-ops-token"] || ""));
  const want = Buffer.from(OPS_TOKEN);
  if (given.length === want.length && nodeCrypto.timingSafeEqual(given, want)) return next();
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
app.get("/api/ops/regression", opsAuth, async (_req, res) => {
  const live = regressionStatus();
  if (live.status !== "idle") return res.json(live);
  // nothing running: show the last persisted run (survives deploys/restarts)
  try { const t = await resolveRestaurant(); await loadLastRegression(t.db); } catch {}
  res.json(regressionStatus());
});

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

// Small TTL memo for ops reads that are expensive and don't need to be to-the-second.
// The console polls on a timer; serving a 30-second-old count is indistinguishable to
// a human and turns three database sweeps a minute into one.
// Migration 033 adds SQL aggregate functions per tenant schema. They may not be there
// (a fresh restaurant, or 033 not run yet), so every call is attempted once and the
// answer remembered — never retried per request, never assumed present.
const rpcAvailable = new Map(); // `${schema}:${fn}` -> boolean
// The v1 aggregate functions (033/034) summed flow_executions.cost_usd, which double
// counts: a parent's cost already includes its children's and both rows are stored.
// 035 fixes them and stamps ops_agg_version() = 2. Any RPC that reports MONEY is only
// trusted at >= 2; otherwise we fall back to counting root rows in JS. Reporting 3x the
// real spend confidently is worse than being slow.
const AGG_MIN_VERSION = 2;
const aggVersion = new Map(); // schema -> number
async function costRpcTrusted(t) {
  if (aggVersion.has(t.schema)) return aggVersion.get(t.schema) >= AGG_MIN_VERSION;
  const { data, error } = await t.db.rpc("ops_agg_version");
  const v = error ? 0 : Number(Array.isArray(data) ? data[0] : data) || 0;
  aggVersion.set(t.schema, v);
  if (v < AGG_MIN_VERSION) {
    log(`ops: ${t.schema} aggregate functions are v${v} — cost figures fall back to root-row summing. Run migration 035.`);
  }
  return v >= AGG_MIN_VERSION;
}
async function tryRpc(t, fn, args) {
  const key = `${t.schema}:${fn}`;
  if (rpcAvailable.get(key) === false) return null;
  const { data, error } = await t.db.rpc(fn, args);
  if (error) {
    // Distinguish "this function does not exist" (permanent — stop asking) from
    // "it took too long" or a connection blip (transient — ask again next time).
    // Caching a timeout as unavailable silently downgraded the busiest schema for the
    // whole life of the process.
    const msg = String(error.message || "");
    const permanent = /Could not find the function|does not exist|schema cache/i.test(msg);
    if (permanent) rpcAvailable.set(key, false);
    if (!tryRpc.warned?.has?.(key)) {
      (tryRpc.warned ||= new Set()).add(key);
      log(`ops: ${fn} ${permanent ? "unavailable" : "failed"} on ${t.schema} (${msg}) — using the row-reading fallback${permanent ? ". Run migration 033/035." : " for this call."}`);
    }
    return null;
  }
  rpcAvailable.set(key, true);
  return data;
}

const memo = new Map(); // key -> { at, value, inflight }
async function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (hit?.inflight) return hit.inflight;      // collapse concurrent callers onto one read
  const inflight = (async () => {
    try {
      const value = await fn();
      memo.set(key, { at: Date.now(), value });
      return value;
    } catch (e) {
      if (hit) { memo.set(key, { at: Date.now(), value: hit.value }); return hit.value; } // serve stale over failing
      memo.delete(key);
      throw e;
    }
  })();
  memo.set(key, { ...(hit || {}), inflight });
  return inflight;
}

app.get("/api/flows", opsAuth, async (_req, res) => {
  const flows = listFlows();
  // The in-memory ring dies with every deploy — the DB rows are the real history.
  // Merge memory (has the just-finished runs) with every tenant's persisted runs,
  // or the cards read "0 runs" after each release and the console looks dead.
  //
  // The DB half is cached: it was re-reading 300 rows PER TENANT on every 15s poll —
  // 600+ rows and ~1.6s — to render "426 runs · $0.69" on the flow cards. The memory
  // half is not cached, so a run that just finished still appears immediately.
  const mem = listExecutions({ limit: 300 });
  let execs = mem;
  try {
    const dbRows = await cached("flows:dbrows", 30_000, async () => {
      const tenants = await resolveAllRestaurants();
      const perTenant = await Promise.all(tenants.map(async (t) => {
        // Two reads on purpose. The newest 300 rows are almost entirely OURS — five suite
        // passes a day at ~700 runs each bury real guests entirely, so a real-only slice
        // is fetched as well or the cards would show 0 real runs while real ones existed.
        const [recent, realOnly] = await Promise.all([
          listExecutionsDb(t.db, { limit: 300 }).catch(() => []),
          t.db.from("flow_executions")
            .select("id,flow,session_id,trigger,status,error,started_at,duration_ms,tokens_in,tokens_out,cost_usd,parent_id")
            .not("session_id", "like", "web:%")
            .not("session_id", "like", "+201555%")
            .order("started_at", { ascending: false }).limit(300)
            .then(({ data }) => (data || []).map((e) => ({ ...e, is_test: false, nodes: [] })))
            .catch(() => []),
        ]);
        const seen = new Set(recent.map((e) => e.id));
        return [...recent, ...realOnly.filter((e) => !seen.has(e.id))];
      }));
      return perTenant.flat();
    });
    const seen = new Set(mem.map((e) => e.id));
    execs = [...mem, ...dbRows.filter((e) => !seen.has(e.id))];
  } catch {}
  // Split real guests from our own traffic. The top-level fields stay where every caller
  // expects them but now mean REAL ONLY — showing a cumulative figure that is 99% test
  // made the friendly card read $6.35 when guests had cost $0.01.
  const stats = (rows) => {
    const n = rows.length;
    const sum = (f) => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0);
    const cost = sum("cost_usd");
    return {
      runs: n,
      ok: rows.filter((r) => r.status === "ok").length,
      errors: rows.filter((r) => r.status === "error").length,
      cost_usd: Math.round(cost * 1e6) / 1e6,
      avg_ms: n ? Math.round(sum("duration_ms") / n) : 0,
      avg_cost_per_run: n ? Math.round((cost / n) * 1e6) / 1e6 : 0,
      avg_tokens_in: n ? Math.round(sum("tokens_in") / n) : 0,
      avg_tokens_out: n ? Math.round(sum("tokens_out") / n) : 0,
    };
  };
  res.json(
    flows.map((fl) => {
      const mine = execs.filter((e) => e.flow === fl.name);
      const real = stats(mine.filter((e) => !(e.is_test ?? isTestSession(e.session_id))));
      const test = stats(mine.filter((e) => (e.is_test ?? isTestSession(e.session_id))));
      return { ...fl, ...real, real, test };
    })
  );
});

app.get("/api/executions", opsAuth, async (req, res) => {
  const flow = req.query.flow ? String(req.query.flow) : undefined;
  const limit = Number(req.query.limit) || 50;
  // `since` = only runs newer than this ISO timestamp. Live tail polls every 3s and was
  // refetching all 100 rows each time; with `since` a quiet poll returns [].
  const since = req.query.since ? String(req.query.since) : null;
  const restaurant = req.query.restaurant ? String(req.query.restaurant) : null;
  const status = req.query.status ? String(req.query.status) : null;
  const search = req.query.q ? String(req.query.q).trim() : null;

  // the in-memory ring gets the same filters, so a just-finished run isn't shown when it
  // doesn't match (and isn't hidden when it does)
  const mem = listExecutions({ flow, limit })
    .filter((e) => !since || e.started_at > since)
    .filter((e) => !status || e.status === status)
    .filter((e) => !search || [e.session_id, e.id, e.error].some((v) => String(v || "").toLowerCase().includes(search.toLowerCase())));
  let merged = mem;
  try {
    // EVERY restaurant's executions, not just the default tenant's — tests and
    // guests run on different schemas, and reading one blinded ops to the rest.
    const all = await resolveAllRestaurants();
    // one restaurant selected → don't even open the other schemas
    const tenants = restaurant ? all.filter((t) => (t.config?.slug || null) === restaurant) : all;
    const perTenant = await Promise.all(tenants.map((t) =>
      listExecutionsDb(t.db, { flow, limit, since, status, q: search })
        .then((rows) => rows.map((e) => ({ ...e, restaurant: t.config?.slug || null })))
        .catch(() => [])));
    const seen = new Set(mem.map((e) => e.id));
    merged = [...mem.filter((e) => !restaurant || e.restaurant === restaurant), ...perTenant.flat().filter((e) => !seen.has(e.id))]
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
      .slice(0, limit);
  } catch {}
  res.json(merged.map((e) => ({ ...e, is_test: e.is_test ?? isTestSession(e.session_id) })));
});

// PostgREST returns at most 1000 rows per request, silently. Every ops read that
// can exceed that has to page, or it reports a confident wrong number.
const PAGE = 1000;
async function pageAll(query, cap = 5000) {
  const rows = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) return { rows, error, capped: false };
    rows.push(...(data || []));
    if ((data || []).length < PAGE) return { rows, error: null, capped: false };
  }
  return { rows, error: null, capped: true };
}

// HEALTH — what's breaking, grouped, so a recurring bug reads as one line and not
// fifty. Covers node-level failures too: a step can fail and be recovered by a
// fallback, and that's exactly the kind of thing that hides until someone looks.
app.get("/api/ops/health", opsAuth, async (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 24 * TRACE_ERROR_RETENTION_D); // failures are kept longer than successes
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  try {
    // health spans EVERY tenant — an error that only happens on one restaurant's
    // schema must still show up here.
    //
    // This used to be one `.limit(1000)` per tenant that then got sliced to 1000
    // overall. PostgREST caps a response at 1000 rows anyway, so on any busy window
    // BOTH the denominator and the failure list were quietly cut short: the error
    // rate was computed against "1000 runs" no matter how many really ran, and the
    // oldest failures in the window simply vanished. Two changes fix it:
    //   1. `runs` is now an exact COUNT, never a row tally.
    //   2. we fetch FAILURES only, not every run — so the heavy `nodes` column is
    //      read for the handful of rows that actually broke.
    // A node's `error` is only ever set together with status "error" (engine/flow.js),
    // so the jsonb containment filter below catches every node-level failure exactly.
    const tenants = await resolveAllRestaurants();
    const results = await Promise.all(tenants.map(async (t) => {
      const slug = t.config?.slug || null;
      const tag = (rows) => (rows || []).map((r) => ({ ...r, restaurant: slug }));
      const COLS = "id,flow,session_id,trigger,status,error,started_at,duration_ms,nodes";
      const base = () => t.db.from("flow_executions").select(COLS).gte("started_at", since);

      const total = await t.db.from("flow_executions")
        .select("id", { count: "exact", head: true }).gte("started_at", since);
      if (total.error) return { error: total.error, runs: 0, rows: [] };

      const fatal = await pageAll((from, to) =>
        base().eq("status", "error").order("started_at", { ascending: false }).range(from, to));

      // runs that finished ok but had a step fail and recover — the class of problem
      // that hides until someone looks
      // the filter value must be a JSON *string*: handing supabase-js an array makes it
      // emit PostgREST's array literal (`cs.{...}`) and Postgres rejects it as invalid json
      let recovered = await pageAll((from, to) =>
        base().neq("status", "error").contains("nodes", JSON.stringify([{ status: "error" }]))
          .order("started_at", { ascending: false }).range(from, to));
      if (recovered.error) recovered = { rows: [], error: null, degraded: recovered.error }; // no jsonb filter → skip, don't fake

      return {
        error: fatal.error || null,
        degraded: recovered.degraded || null,
        runs: total.count ?? 0,
        capped: fatal.capped || recovered.capped || false,
        rows: [...tag(fatal.rows), ...tag(recovered.rows)],
      };
    }));
    // migration 003 not run anywhere → say so plainly rather than render a fake all-clear
    if (results.length && results.every((x) => x.error)) return res.json({ available: false, reason: results[0].error.message, runs: 0, groups: [], recent: [] });

    const totalRuns = results.reduce((s, x) => s + (x.runs || 0), 0);
    const rows = results.flatMap((x) => x.rows).sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    const failures = [];
    for (const r of rows) {
      const nodes = (Array.isArray(r.nodes) ? r.nodes : [])
        .filter((n) => n?.status === "error" || n?.error)
        .map((n) => ({ node: n.name, error: String(n.error || "unknown").slice(0, 600), ms: n.ms ?? null, model: n.model || null }));
      if (r.status !== "error" && !nodes.length) continue;
      failures.push({
        id: r.id, flow: r.flow, session_id: r.session_id, trigger: r.trigger, restaurant: r.restaurant || null,
        is_test: isTestSession(r.session_id),   // so Health can default to real guests too
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
      runs: totalRuns,                 // exact count over the window, not a row tally
      failed_runs: failures.length,
      error_rate: totalRuns ? Math.round((failures.length / totalRuns) * 1000) / 10 : 0,
      // if either is set the numbers are a floor, and the console says so
      capped: results.some((x) => x.capped),
      degraded: results.find((x) => x.degraded)?.degraded?.message || null,
      groups: [...groups.values()].sort((a, b) => b.count - a.count || (a.last_at < b.last_at ? 1 : -1)),
      recent: failures.slice(0, 60),
    });
  } catch (e) {
    res.json({ available: false, reason: e.message, runs: 0, groups: [], recent: [] });
  }
});

// ROLLUP — what the platform costs and where the time goes, across EVERY tenant.
// Two queries per restaurant on purpose: the cheap one (no `nodes`) carries the
// money/latency aggregates over a wide window, and a small sampled one pulls
// `nodes` for per-model and per-step stats. `nodes` holds every input/output
// snapshot, so selecting it for thousands of rows would move megabytes to answer
// a question about averages. Anything we cap is reported, never silently trimmed.
const ROLLUP_ROWS = 20000;  // per tenant, aggregate query — a real ceiling, paged to
const ROLLUP_PAGE = 1000;   // PostgREST caps a single response at 1000 rows
const ROLLUP_SAMPLE = 400;  // per tenant, node-level query
/**
 * The rollup, computed in Postgres. Replaces the row-paging path whenever every tenant
 * has the v2 aggregates (migrations 033 + 035).
 *
 * The paging path had a hard ceiling of ROLLUP_ROWS per restaurant, and the busy schema
 * blew straight through it: "read 25,907 of 46,492 runs" — so the headline was a floor,
 * missing more than half the runs, and it read tens of thousands of rows to get there.
 * These functions return one row per bucket and no cap at all.
 *
 * Returns null if ANY tenant lacks trusted aggregates: mixing an exact tenant with a
 * capped one produces a total that is wrong in a way nobody can see.
 */
async function rollupViaSql(tenants, since, until = null) {
  // Previous-period comparison comes free: ask ops_rollup_days for a window twice as long
  // and split it in JS. "$26.70" alone says nothing; "$26.70, +18% on the previous 14
  // days" is the number someone can act on. No extra round trip.
  const spanMs = (until ? new Date(until) : new Date()).getTime() - new Date(since).getTime();
  const prevSince = new Date(new Date(since).getTime() - spanMs).toISOString();
  const sinceDay = since.slice(0, 10);
  // `until` trims the tail client-side: the SQL functions take a start only, and adding a
  // second parameter would mean re-running 033/035/037. Day buckets make this exact.
  const inRange = (day) => !until || String(day) <= until.slice(0, 10);
  const failures = [];   // why the exact path could not be used, per tenant
  const per = await mapLimit(tenants, 6, async (t) => {
    if (!(await costRpcTrusted(t))) { failures.push(`${t.schema}: aggregates are v1 or missing (run migrations 033/035)`); return null; }
    const slug = t.config?.slug || null;
    let [days, flows, slowest, costliest] = await Promise.all([
      tryRpc(t, "ops_rollup_days", { p_since: since }).catch(() => null),
      tryRpc(t, "ops_rollup_flows", { p_since: since }).catch(() => null),
      // top-N needs real rows, but only ten of them
      t.db.from("flow_executions").select("id,flow,session_id,duration_ms,cost_usd,started_at")
        .gte("started_at", since).order("duration_ms", { ascending: false }).limit(10),
      t.db.from("flow_executions").select("id,flow,session_id,duration_ms,cost_usd,started_at")
        .gte("started_at", since).order("cost_usd", { ascending: false }).limit(10),
    ]);
    // Per-model and per-step used to load here. They expand `nodes` jsonb and cost 5.2s
    // and 6.4s on the busy schema — 11.6 of the page's ~15 seconds — to fill a table
    // behind a tab and a table behind a collapsed section. They now live on
    // /api/ops/breakdown and are fetched only when something actually shows them.
    if (!days || !flows) {
      failures.push(`${t.schema}: ${!days ? "ops_rollup_days" : "ops_rollup_flows"} did not return (usually a statement timeout on a large window)`);
      return null;
    }
    // Totals are SUMMED FROM THE DAY BUCKETS rather than fetched from ops_rollup_totals.
    // That call was the one thing on this endpoint that timed out on the busy schema — a
    // single global percentile_cont sorts every row and count(distinct session_id) hashes
    // all of them, with no GROUP BY to divide the work. It took the whole exact path down
    // with it and the page silently showed the capped $13 instead of $27.
    // Money, runs, errors and tokens sum exactly. Sessions are the sum of per-day distinct
    // counts, so a conversation spanning midnight is counted twice — flagged, not hidden.
    const nn = (x) => Number(x) || 0;
    const sumDays = (rows) => {
      const runs = rows.reduce((a, d) => a + nn(d.runs), 0);
      return {
        runs,
        errors: rows.reduce((a, d) => a + nn(d.errors), 0),
        sessions: rows.reduce((a, d) => a + nn(d.sessions), 0),
        cost_usd: rows.reduce((a, d) => a + nn(d.cost_usd), 0),
        tokens_in: rows.reduce((a, d) => a + nn(d.tokens_in), 0),
        tokens_out: rows.reduce((a, d) => a + nn(d.tokens_out), 0),
        avg_ms: runs ? Math.round(rows.reduce((a, d) => a + nn(d.avg_ms) * nn(d.runs), 0) / runs) : 0,
        p95_ms: rows.reduce((mx, d) => Math.max(mx, nn(d.p95_ms)), 0),
      };
    };
    let totals = sumDays(days.filter((d) => String(d.day) >= sinceDay));
    // …and fetch the comparison window SEPARATELY, tolerating failure. Folding it into
    // the main call doubled the range, which was slow enough on the busy schema to fail —
    // and because the main path is all-or-nothing, a missing comparison silently dropped
    // the whole rollup back to the capped row-reading fallback ($13.11 for a $26.74
    // window). A nice-to-have must never be able to break the primary number.
    const prevRows = await tryRpc(t, "ops_rollup_days", { p_since: prevSince }).catch(() => null);
    const prevDays = Array.isArray(prevRows) ? prevRows.filter((d) => String(d.day) < sinceDay) : null;
    if (until) {
      days = days.filter((d) => inRange(d.day));
      totals = sumDays(days);      // a bounded range must never report the open-ended total
    }
    return {
      slug, name: t.config?.name || slug, totals, days, flows,
      prevDays,
      slowest: (slowest.data || []).map((r) => ({ ...r, restaurant: slug })),
      costliest: (costliest.data || []).map((r) => ({ ...r, restaurant: slug })),
    };
  });
  // Deliberately all-or-nothing: mixing one exact tenant with one capped tenant yields a
  // total that is neither, and nobody could tell from looking. But the caller is told
  // exactly what failed, so the console can name it instead of blaming a stale deploy.
  if (per.some((p) => !p)) return { failed: true, reason: failures.join(" · ") || "unknown" };

  const num = (x) => (typeof x === "number" && isFinite(x) ? x : Number(x) || 0);
  const money = (x) => Math.round(x * 1e6) / 1e6;
  // avg is run-weighted (exact); p95 CANNOT be merged across tenants, so the platform
  // figure is the worst tenant's and is labelled as such rather than silently averaged
  const merge = (rows, keyOf, extra = {}) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      let b = m.get(k);
      if (!b) m.set(k, (b = { key: k, runs: 0, errors: 0, sessions: 0, cost_usd: 0, tokens_in: 0, tokens_out: 0, msWeighted: 0, p95_ms: 0, last_at: null, ...extra }));
      b.runs += num(r.runs); b.errors += num(r.errors); b.sessions += num(r.sessions);
      b.cost_usd += num(r.cost_usd);
      b.tokens_in += num(r.tokens_in); b.tokens_out += num(r.tokens_out);
      b.msWeighted += num(r.avg_ms) * num(r.runs);
      b.p95_ms = Math.max(b.p95_ms, num(r.p95_ms));
      if (r.last_at && (!b.last_at || r.last_at > b.last_at)) b.last_at = r.last_at;
    }
    return [...m.values()].map((b) => ({
      ...b, cost_usd: money(b.cost_usd),
      avg_ms: b.runs ? Math.round(b.msWeighted / b.runs) : 0,
      msWeighted: undefined,
    }));
  };

  const allTotals = per.map((p) => p.totals);
  const t = merge(allTotals, () => "all")[0] || { runs: 0, errors: 0, sessions: 0, cost_usd: 0, tokens_in: 0, tokens_out: 0, avg_ms: 0, p95_ms: 0 };

  const prev = merge(per.flatMap((p) => p.prevDays || []), () => "prev")[0] || null;
  const byDay = merge(per.flatMap((p) => p.days), (r) => String(r.day))
    .map((b) => ({ ...b, day: b.key })).sort((a, b) => (a.day < b.day ? 1 : -1));
  const byFlow = merge(per.flatMap((p) => p.flows), (r) => r.flow)
    .map((b) => ({ ...b, flow: b.key })).sort((a, b) => b.cost_usd - a.cost_usd || b.runs - a.runs);
  const byRestaurant = per.map((p) => {
    const b = merge([p.totals], () => p.slug)[0];
    return { restaurant: p.slug, name: p.name, readable: true, reason: null, counted: num(p.totals.runs), capped: false, ...b };
  }).sort((a, b) => b.cost_usd - a.cost_usd);

  const p95 = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]); };

  const sumBy = (rows, keyFields, numFields) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFields.map((f) => r[f]).join("|");
      let b = m.get(k);
      if (!b) { b = {}; for (const f of keyFields) b[f] = r[f]; for (const f of numFields) b[f] = 0; b._calls = 0; b._msW = 0; b.p95_ms = 0; m.set(k, b); }
      for (const f of numFields) b[f] += num(r[f]);
      b._calls += num(r.calls);
      b._msW += num(r.avg_ms) * num(r.calls);
      b.p95_ms = Math.max(b.p95_ms, num(r.p95_ms));
    }
    return [...m.values()].map((b) => ({ ...b, avg_ms: b._calls ? Math.round(b._msW / b._calls) : 0, _calls: undefined, _msW: undefined }));
  };
  const lead = (rows) => rows.map((r) => ({ id: r.id, flow: r.flow, restaurant: r.restaurant, session_id: r.session_id, duration_ms: r.duration_ms, cost_usd: r.cost_usd, started_at: r.started_at }));

  return {
    aggregated: true,
    truncated: false,          // no cap on this path — that was the whole point
    counted: num(t.runs),
    totals: {
      runs: num(t.runs), errors: num(t.errors),
      cost_usd: money(t.cost_usd),
      tokens_in: num(t.tokens_in), tokens_out: num(t.tokens_out),
      sessions: num(t.sessions),
      sessions_approx: true,   // summed per-day distincts; a midnight-spanning chat counts twice
      cost_per_session: t.sessions ? money(t.cost_usd / t.sessions) : 0,
      avg_ms: num(t.avg_ms), p95_ms: num(t.p95_ms),
    },
    // A comparison is only offered when the previous window is actually comparable.
    // Traces are purged, so asking for "the 14 days before last" returns the handful of
    // error rows that survive — $0.0005 against $26.74, which rendered as "+5,025,386%".
    // Thin coverage means NO delta and a stated reason, never a spectacular fiction.
    previous: (() => {
      const curDays = byDay.length;
      const prevDayCount = new Set(per.flatMap((p) => (p.prevDays || []).map((d) => String(d.day)))).size;
      void 0;
      const anyPrevRead = per.some((p) => Array.isArray(p.prevDays));
      if (!anyPrevRead) return { comparable: false, reason: "the previous period took too long to read" };
      if (!prev || prev.runs <= 0) return null;
      if (curDays && prevDayCount < curDays * 0.6) {
        return { comparable: false, reason: `only ${prevDayCount} of ~${curDays} days survive in the previous period (traces are purged)` };
      }
      if (num(prev.runs) < num(t.runs) * 0.05) {
        return { comparable: false, reason: "the previous period has too few runs to compare against" };
      }
      return {
        comparable: true,
        cost_usd: money(prev.cost_usd), runs: num(prev.runs), sessions: num(prev.sessions),
        days: prevDayCount, from: prevSince.slice(0, 10), to: sinceDay,
      };
    })(),
    by_day: byDay, by_flow: byFlow, by_restaurant: byRestaurant,
    // fetched separately, on demand — see /api/ops/breakdown
    by_model: null,
    slow_steps: null,
    slowest: lead(per.flatMap((p) => p.slowest)).sort((a, b) => num(b.duration_ms) - num(a.duration_ms)).slice(0, 10),
    costliest: lead(per.flatMap((p) => p.costliest)).sort((a, b) => num(b.cost_usd) - num(a.cost_usd)).slice(0, 10),
  };
}

app.get("/api/ops/rollup", opsAuth, async (req, res) => {
  // Capped at the janitor's trace retention (TRACE_MAX_AGE_D = 14). Asking for 30 days
  // returned 14 days of rows under a 30-day label — the exact silent truncation this
  // endpoint reports elsewhere. `retention_days` is echoed so the UI can say why.
  // `from`/`to` (YYYY-MM-DD) win over `hours`, so the console can offer real date ranges
  // and calendar months rather than only rolling windows.
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? String(req.query.from) : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? String(req.query.to) : null;
  const hours = Math.min(Number(req.query.hours) || 24, 24 * TRACE_RETENTION_D);
  const since = from ? `${from}T00:00:00.000Z` : new Date(Date.now() - hours * 3600_000).toISOString();
  const until = to ? `${to}T23:59:59.999Z` : null;
  try {
    const tenants = await resolveAllRestaurants();

    // Preferred path: Postgres does the arithmetic, with no row cap. The paging path
    // below stays as the fallback for a schema without the v2 aggregates — it works,
    // but it truncates at ROLLUP_ROWS per restaurant and says so.
    const sql = await cached(`rollup:sql:${since}:${until || ""}`, 45_000, () => rollupViaSql(tenants, since, until));
    if (sql?.failed) log(`ops rollup: exact path unavailable — ${sql.reason}`);
    if (sql && !sql.failed) {
      return res.json({
        available: true,
        window_hours: hours,
        from: from || since.slice(0, 10), to: to || null,   // what was actually queried
        retention_days: TRACE_RETENTION_D,
        row_cap: null,
        ...sql,
      });
    }

    const per = await Promise.all(tenants.map(async (t) => {
      const slug = t.config?.slug || t.record?.slug || null;
      const name = t.config?.name || slug;
      // Paged, because PostgREST truncates any single response to 1000 rows: a plain
      // .limit(5000) came back with exactly 1000 per tenant and the totals read as a
      // confident, wrong number ($2.13 for a week that actually cost $38).
      // Count first, then pull the pages in parallel — sequential paging took 10s.
      const head = await t.db.from("flow_executions")
        .select("id", { count: "exact", head: true }).gte("started_at", since);
      if (head.error) return { slug, name, error: head.error.message, counted: 0, capped: false, rows: [], sample: [] };

      const counted = head.count ?? 0;
      const toRead = Math.min(counted, ROLLUP_ROWS);
      const pages = Array.from({ length: Math.ceil(toRead / ROLLUP_PAGE) }, (_, i) => i * ROLLUP_PAGE);
      const rows = [];
      let error = null;
      for (let i = 0; i < pages.length; i += 8) { // 8 at a time: fast without hammering PostgREST
        const batch = await Promise.all(pages.slice(i, i + 8).map((from) =>
          t.db.from("flow_executions")
            // parent_id is required, not cosmetic: cost must only be charged to root
            // rows, or every nested sub-flow counts the same money again (see 035)
            .select("id,flow,session_id,status,started_at,duration_ms,tokens_in,tokens_out,cost_usd,parent_id")
            .gte("started_at", since)
            .order("started_at", { ascending: false })
            .range(from, from + ROLLUP_PAGE - 1)));
        for (const b of batch) {
          if (b.error) { error = b.error.message; continue; }
          rows.push(...(b.data || []).map((r) => ({ ...r, restaurant: slug })));
        }
      }
      const sample = await t.db.from("flow_executions")
        .select("flow,nodes")
        .gte("started_at", since).order("started_at", { ascending: false }).limit(ROLLUP_SAMPLE);
      return { slug, name, error, counted, capped: counted > ROLLUP_ROWS, rows, sample: sample.data || [] };
    }));

    // migration 003 nowhere → say so plainly rather than render a fake $0
    if (per.length && per.every((p) => p.error)) {
      return res.json({ available: false, reason: per[0].error, window_hours: hours, tenants: [] });
    }

    const rows = per.flatMap((p) => p.rows);
    const truncated = per.some((p) => p.capped);
    const num = (x) => (typeof x === "number" && isFinite(x) ? x : 0);
    const money = (x) => Math.round(x * 1e6) / 1e6;
    const p95 = (xs) => {
      if (!xs.length) return 0;
      const s = [...xs].sort((a, b) => a - b);
      return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]);
    };

    const bucket = (list, keyOf, init) => {
      const m = new Map();
      for (const r of list) {
        const k = keyOf(r);
        if (k == null) continue;
        let b = m.get(k);
        if (!b) m.set(k, (b = init(k, r)));
        b.runs++;
        if (r.status === "error") b.errors++;
        // A parent execution's cost_usd already CONTAINS its children's (engine/flow.js
        // rolls sub-flow cost up), and both rows are persisted. Summing every row counted
        // the same LLM call once per nesting level — $78.81 for a month that cost $26.18.
        // Only root rows are charged; migration 035 does this properly, per node, in SQL.
        if (!r.parent_id) {
          b.cost_usd += num(r.cost_usd);
          b.tokens_in += num(r.tokens_in);
          b.tokens_out += num(r.tokens_out);
        }
        b.ms.push(num(r.duration_ms));
        if (r.session_id) b.sessions.add(r.session_id);
        if (!b.last_at || r.started_at > b.last_at) b.last_at = r.started_at;
      }
      return m;
    };
    const seed = (k) => ({ key: k, runs: 0, errors: 0, cost_usd: 0, tokens_in: 0, tokens_out: 0, ms: [], sessions: new Set(), last_at: null });
    const shape = (b, extra = {}) => ({
      runs: b.runs, errors: b.errors, cost_usd: money(b.cost_usd),
      tokens_in: b.tokens_in, tokens_out: b.tokens_out,
      sessions: b.sessions.size,
      avg_ms: b.runs ? Math.round(b.ms.reduce((s, x) => s + x, 0) / b.runs) : 0,
      p95_ms: p95(b.ms), last_at: b.last_at, ...extra,
    });

    const byDay = [...bucket(rows, (r) => String(r.started_at).slice(0, 10), seed).entries()]
      .map(([day, b]) => ({ day, ...shape(b) })).sort((a, b) => (a.day < b.day ? 1 : -1));
    // Per-flow cost is deliberately NULL here. A flow's own spend lives in its nodes,
    // which this path never reads; charging root rows instead put the whole chain on
    // `respond` and printed "$0.0000" against master/order/friendly. A missing number
    // the UI explains beats a confident wrong one. The SQL path (035) attributes properly.
    const byFlow = [...bucket(rows, (r) => r.flow, seed).entries()]
      .map(([flow, b]) => ({ flow, ...shape(b), cost_usd: null })).sort((a, b) => b.runs - a.runs);
    const byRestaurantRuns = bucket(rows, (r) => r.restaurant, seed);
    // the roster lists EVERY tenant, including ones with no runs in the window —
    // a restaurant that went quiet is exactly what you want to notice here
    const byRestaurant = per.map((p) => {
      const b = byRestaurantRuns.get(p.slug);
      return {
        restaurant: p.slug, name: p.name, readable: !p.error, reason: p.error,
        counted: p.counted, capped: p.capped, // counted = what the window really holds
        ...(b ? shape(b) : shape(seed(p.slug))),
      };
    }).sort((a, b) => b.cost_usd - a.cost_usd || b.runs - a.runs);

    // per-model and per-step: sampled rows only
    const models = new Map();
    const steps = new Map();
    let sampled = 0;
    for (const p of per) {
      for (const r of p.sample) {
        sampled++;
        for (const n of Array.isArray(r.nodes) ? r.nodes : []) {
          if (!n?.name) continue;
          const sk = `${r.flow}|${n.name}`;
          let s = steps.get(sk);
          if (!s) steps.set(sk, (s = { flow: r.flow, node: n.name, calls: 0, ms: [], cost_usd: 0, errors: 0 }));
          s.calls++; s.ms.push(num(n.ms)); s.cost_usd += num(n.cost_usd);
          if (n.status === "error" || n.error) s.errors++;
          if (!n.model) continue;
          let mm = models.get(n.model);
          if (!mm) models.set(n.model, (mm = { model: n.model, calls: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0, ms: [] }));
          mm.calls++; mm.tokens_in += num(n.tokens_in); mm.tokens_out += num(n.tokens_out);
          mm.cost_usd += num(n.cost_usd); mm.ms.push(num(n.ms));
        }
      }
    }

    const rootRows = rows.filter((r) => !r.parent_id);   // see the note in bucket()
    const totalCost = rootRows.reduce((s, r) => s + num(r.cost_usd), 0);
    const sessions = new Set(rows.map((r) => r.session_id).filter(Boolean));

    res.json({
      available: true,
      window_hours: hours,
      aggregated: false,
      aggregate_error: sql?.failed ? sql.reason : null,   // why, so the UI stops guessing
      flow_cost_available: false,          // see byFlow above
      retention_days: TRACE_RETENTION_D,   // why a longer window isn't offered
      truncated,
      row_cap: ROLLUP_ROWS,
      counted: per.reduce((s, p) => s + (p.counted || 0), 0), // what exists vs what we read
      sampled_runs: sampled,
      totals: {
        runs: rows.length,
        errors: rows.filter((r) => r.status === "error").length,
        cost_usd: money(totalCost),
        tokens_in: rootRows.reduce((s, r) => s + num(r.tokens_in), 0),
        tokens_out: rootRows.reduce((s, r) => s + num(r.tokens_out), 0),
        sessions: sessions.size,
        cost_per_session: sessions.size ? money(totalCost / sessions.size) : 0,
        avg_ms: rows.length ? Math.round(rows.reduce((s, r) => s + num(r.duration_ms), 0) / rows.length) : 0,
        p95_ms: p95(rows.map((r) => num(r.duration_ms))),
      },
      by_day: byDay,
      by_flow: byFlow,
      by_restaurant: byRestaurant,
      by_model: [...models.values()]
        .map((m) => ({ ...m, cost_usd: money(m.cost_usd), avg_ms: m.calls ? Math.round(m.ms.reduce((s, x) => s + x, 0) / m.calls) : 0, ms: undefined }))
        .sort((a, b) => b.cost_usd - a.cost_usd),
      slow_steps: [...steps.values()]
        .map((s) => ({ flow: s.flow, node: s.node, calls: s.calls, errors: s.errors, cost_usd: money(s.cost_usd), avg_ms: Math.round(s.ms.reduce((x, y) => x + y, 0) / (s.calls || 1)), p95_ms: p95(s.ms) }))
        .sort((a, b) => b.avg_ms - a.avg_ms).slice(0, 12),
      slowest: [...rows].sort((a, b) => num(b.duration_ms) - num(a.duration_ms)).slice(0, 10)
        .map((r) => ({ id: r.id, flow: r.flow, restaurant: r.restaurant, session_id: r.session_id, duration_ms: r.duration_ms, cost_usd: r.cost_usd, started_at: r.started_at })),
      costliest: [...rows].sort((a, b) => num(b.cost_usd) - num(a.cost_usd)).slice(0, 10)
        .map((r) => ({ id: r.id, flow: r.flow, restaurant: r.restaurant, session_id: r.session_id, duration_ms: r.duration_ms, cost_usd: r.cost_usd, started_at: r.started_at })),
    });
  } catch (e) {
    res.json({ available: false, reason: e.message, window_hours: hours, tenants: [] });
  }
});

// PLANS — the billing side of the same coin as /api/ops/rollup: how many orders each
// restaurant put through this calendar month, what those orders were worth, and how
// many branches they run. Deliberately returns FACTS only — the rate card (plan prices,
// included orders, overage) lives in the console so a price change is a static redeploy,
// not a flows deploy.
//
// Month-to-date is calendar-based, not a rolling window, because that is how the plans
// bill. There is no plan/tier column on `restaurants`, so the plan is read from
// basic_info.billing.plan and is simply null until someone sets it.
app.get("/api/ops/plans", opsAuth, async (_req, res) => {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const prevWeekStart = new Date(now.getTime() - 14 * 86400_000).toISOString();
  try {
    const tenants = await resolveAllRestaurants();
    const rows = await Promise.all(tenants.map(async (t) => {
      const slug = t.config?.slug || null;
      const bi = t.config?.basic_info || {};
      // the plan column (migration 032) is authoritative; basic_info.billing is the
      // no-migration fallback, so this works either way round
      const rec = t.record || {};
      const base = {
        restaurant: slug,
        name: t.config?.name || slug,
        plan: rec.plan || bi.billing?.plan || null,     // "start" | "grow" | "chain"
        plan_since: rec.plan_since || bi.billing?.since || null,
        plan_notes: rec.plan_notes || null,
        branches: Array.isArray(bi.branches) ? bi.branches.length : null,
      };
      // Fast path (migration 033): Postgres returns one row of totals instead of every
      // order. Falls back to reading the rows when the function isn't there.
      const agg = await tryRpc(t, "ops_order_stats", { p_since: monthStart }).catch(() => null);
      const aggRow = Array.isArray(agg) ? agg[0] : agg;

      // order rows carry the money, so they're read rather than counted
      const mtd = aggRow
        ? { rows: null, error: null, capped: false }
        : await pageAll((from, to) => t.db.from("orders")
            .select("id,total,status,created_at").gte("created_at", monthStart)
            .order("created_at", { ascending: false }).range(from, to));
      if (mtd.error) return { ...base, readable: false, reason: mtd.error.message };

      // month-before, plus two 7-day windows so the console can show a trend rather
      // than a single number with nothing to compare it to
      const [prev, week, prevWeek] = await Promise.all([
        t.db.from("orders").select("id", { count: "exact", head: true })
          .gte("created_at", prevStart).lt("created_at", monthStart),
        t.db.from("orders").select("id", { count: "exact", head: true })
          .gte("created_at", weekStart).neq("status", "cancelled"),
        t.db.from("orders").select("id", { count: "exact", head: true })
          .gte("created_at", prevWeekStart).lt("created_at", weekStart).neq("status", "cancelled"),
      ]);

      // A cancelled order is neither billable nor a real sale, so counts and money are
      // reported on the SAME basis. Returning only an all-orders total invited the
      // caller to divide the value of every order by the billable count and call the
      // result AOV — 320 EGP where the true figure was 300.
      const round2 = (x) => Math.round(x * 100) / 100;
      let ordersAll, byStatus = {}, value = 0, billableValue = 0, billableCount = 0;
      if (aggRow) {
        ordersAll = Number(aggRow.orders_all) || 0;
        billableCount = Number(aggRow.orders_billable) || 0;
        value = Number(aggRow.value_all) || 0;
        billableValue = Number(aggRow.value_billable) || 0;
        // only the split the console actually uses survives the aggregate path
        byStatus = { cancelled: Number(aggRow.cancelled) || 0 };
      } else {
        const orders = mtd.rows || [];
        ordersAll = orders.length;
        for (const o of orders) {
          const s = String(o.status || "unknown");
          byStatus[s] = (byStatus[s] || 0) + 1;
          const total = Number(o.total) || 0;
          value += total;
          if (s !== "cancelled") { billableValue += total; billableCount++; }
        }
      }
      return {
        ...base,
        readable: true,
        aggregated: !!aggRow,                // true = computed in Postgres (migration 033)
        month_start: monthStart,
        orders_mtd: ordersAll,               // everything, cancellations included
        orders_billable: billableCount,      // what the plan's allowance counts
        orders_prev_month: prev.count ?? null,
        orders_7d: week.count ?? null,       // billable only, so it compares to the above
        orders_prev_7d: prevWeek.count ?? null,
        server_now: now.toISOString(),       // the console projects month-end from this
        by_status: byStatus,
        order_value_mtd: round2(value),
        order_value_billable: round2(billableValue),
        aov: billableCount ? round2(billableValue / billableCount) : 0,
        capped: mtd.capped || false,
      };
    }));
    res.json({ available: true, month_start: monthStart, restaurants: rows });
  } catch (e) {
    res.json({ available: false, reason: e.message, restaurants: [] });
  }
});

// INSIGHTS — the questions the console couldn't answer: does the bot sell, what does
// an order cost us, how long does a guest actually wait, do guests come back, when do
// they order, what language do they speak, and who got no reply at all.
//
// Everything here is derived from tables that already exist. Cached, because none of it
// changes second to second and several of these are full-window reads.
// INSIGHTS — two shapes on purpose, because a platform with a hundred restaurants
// cannot answer "how is everyone doing" the same way it answers "how is THIS one doing".
//
//   no ?restaurant       -> one cheap aggregate row per restaurant (2-3 one-row RPC calls
//                           each) for the roster/ranking table and the profit totals
//   ?restaurant=<slug>   -> the full detail set, computed for that ONE tenant only
//
// The old version computed every expensive metric for every tenant on every call: six
// queries each, ~25k rows, and it would have made 600 queries at a hundred restaurants.
app.get("/api/ops/insights", opsAuth, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), TRACE_ERROR_RETENTION_D);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const want = req.query.restaurant ? String(req.query.restaurant) : null;

  try {
    const out = await cached(`insights:${days}:${want || "all"}`, 60_000, async () => {
      const tenants = await resolveAllRestaurants();

      // ---- the roster: cheap enough to run for every restaurant ----
      const roster = await mapLimit(tenants, 8, async (t) => {
        const slug = t.config?.slug || null;
        const trusted = await costRpcTrusted(t);
        // NOTE: no month-window ops_rollup_totals here. On the busy schema it hit the 8s
        // statement timeout (one global percentile + count(distinct) over 41k rows), and
        // ops_spend_split already returns the month's cost — one call instead of two.
        const [win, mtdSplit, mtdOrders, dl, oldest, waiting] = await Promise.all([
          trusted ? oneRow(tryRpc(t, "ops_rollup_totals", { p_since: since })) : null,
          // migration 034: guest spend vs our own test spend. Profit must not be charged
          // for the regression suite — on the pilot that is 94% of the bill.
          trusted ? oneRow(tryRpc(t, "ops_spend_split", { p_since: monthStart })) : null,
          oneRow(tryRpc(t, "ops_order_stats", { p_since: monthStart })),
          // head counts: a number for the table, never the list (that's the drill-down)
          t.db.from("routing_failures").select("id", { count: "exact", head: true }).gte("created_at", since),
          // The oldest trace that still exists. The janitor purges successful runs at
          // TRACE_MAX_AGE_D, so on the 17th nothing before the 3rd survives — a
          // month-to-date cost is a FLOOR, and saying otherwise cost real credibility
          // (reported $26.68 against a real OpenAI bill of $33.57 for August).
          t.db.from("flow_executions").select("started_at").order("started_at", { ascending: true }).limit(1),
          t.db.from("chat_sessions").select("id", { count: "exact", head: true }).eq("needs_attention", true),
        ]);
        // fallback when migration 033 isn't in: counts only, no row-scanning fan-out
        const fb = win ? null : await fallbackTotals(t, since, monthStart);
        return {
          restaurant: slug,
          name: t.config?.name || slug,
          plan: t.record?.plan || t.config?.basic_info?.billing?.plan || null,
          branches: Array.isArray(t.config?.basic_info?.branches) ? t.config.basic_info.branches.length : null,
          aggregated: !!win,
          window: win ? {
            runs: Number(win.runs) || 0, errors: Number(win.errors) || 0,
            sessions: Number(win.sessions) || 0, cost_usd: round6(Number(win.cost_usd) || 0),
            avg_ms: Number(win.avg_ms) || 0, p95_ms: Number(win.p95_ms) || 0,
          } : fb.window,
          dead_letters: dl.count ?? 0,
          handoffs_open: waiting.count ?? 0,
          traces_from: oldest.data?.[0]?.started_at || null,   // cost before this is deleted
          retention_days: TRACE_RETENTION_D,
          mtd: {
            cost_usd: round6(Number(mtdSplit?.cost_total ?? fb?.mtdCost ?? 0)),
            // when 034 isn't in, guest cost is unknown rather than zero — the console
            // says so instead of quietly reporting a flattering margin
            cost_guest_usd: mtdSplit ? round6(Number(mtdSplit.cost_guest) || 0) : null,
            cost_test_usd: mtdSplit ? round6((Number(mtdSplit.cost_regression) || 0) + (Number(mtdSplit.cost_web) || 0)) : null,
            runs_guest: mtdSplit ? Number(mtdSplit.runs_guest) || 0 : null,
            sessions_guest: mtdSplit ? Number(mtdSplit.sessions_guest) || 0 : null,
            orders_all: Number(mtdOrders?.orders_all ?? fb?.ordersAll ?? 0),
            orders_billable: Number(mtdOrders?.orders_billable ?? fb?.ordersBillable ?? 0),
            value_billable: round2(Number(mtdOrders?.value_billable ?? fb?.valueBillable ?? 0)),
            aov: round2(Number(mtdOrders?.aov ?? fb?.aov ?? 0)),
          },
        };
      });

      if (!want || want === "all") {
        return { available: true, mode: "all", window_days: days, month_start: monthStart, restaurants: roster, detail: null };
      }

      const t = tenants.find((x) => (x.config?.slug || null) === want);
      if (!t) return { available: true, mode: "detail", window_days: days, month_start: monthStart, restaurants: roster, detail: null, reason: `unknown restaurant '${want}'` };

      return {
        available: true, mode: "detail", window_days: days, month_start: monthStart,
        restaurants: roster,
        detail: await tenantDetail(t, since, days),
      };
    });
    res.json(out);
  } catch (e) {
    res.json({ available: false, reason: e.message, window_days: days, restaurants: [], detail: null });
  }
});

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const round2 = (x) => Math.round(x * 100) / 100;
async function oneRow(p) {
  const d = await p.catch(() => null);
  return Array.isArray(d) ? d[0] : d;
}
/** Bounded concurrency — a hundred restaurants must not open a hundred sockets at once. */
async function mapLimit(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return out;
}
/**
 * Used when the SQL aggregates are absent or still v1. Counts come from head requests;
 * money is summed from ROOT rows only (`parent_id is null`), because a parent's cost
 * already contains its children's. Reporting 0 here — as an earlier version did — is
 * just a different wrong number, so the rows get read.
 */
async function fallbackTotals(t, since, monthStart) {
  const cnt = async (table, col, from, extra) => {
    let q = t.db.from(table).select("id", { count: "exact", head: true }).gte(col, from);
    if (extra) q = extra(q);
    const { count } = await q;
    return count ?? 0;
  };
  const rootCost = async (from) => {
    const r = await pageAll((a, b) => t.db.from("flow_executions")
      .select("cost_usd,tokens_in,tokens_out")
      .is("parent_id", null)                      // filtered in Postgres, not in JS
      .gte("started_at", from)
      .order("started_at", { ascending: false }).range(a, b), 30000);
    return {
      cost: r.rows.reduce((s, x) => s + (Number(x.cost_usd) || 0), 0),
      tin: r.rows.reduce((s, x) => s + (Number(x.tokens_in) || 0), 0),
      tout: r.rows.reduce((s, x) => s + (Number(x.tokens_out) || 0), 0),
    };
  };
  const [runs, errors, ordersAll, cancelled, win, mtd, orderAgg] = await Promise.all([
    cnt("flow_executions", "started_at", since),
    cnt("flow_executions", "started_at", since, (q) => q.eq("status", "error")),
    cnt("orders", "created_at", monthStart),
    cnt("orders", "created_at", monthStart, (q) => q.eq("status", "cancelled")),
    rootCost(since),
    rootCost(monthStart),
    pageAll((a, b) => t.db.from("orders").select("total,status")
      .gte("created_at", monthStart).order("created_at", { ascending: false }).range(a, b)),
  ]);
  const live = (orderAgg.rows || []).filter((o) => String(o.status) !== "cancelled");
  const valueBillable = live.reduce((s, o) => s + (Number(o.total) || 0), 0);
  return {
    window: {
      runs, errors, sessions: 0, cost_usd: Math.round(win.cost * 1e6) / 1e6,
      tokens_in: win.tin, tokens_out: win.tout, avg_ms: 0, p95_ms: 0, incomplete: true,
    },
    mtdCost: Math.round(mtd.cost * 1e6) / 1e6,
    ordersAll,
    ordersBillable: live.length || Math.max(0, ordersAll - cancelled),
    valueBillable: Math.round(valueBillable * 100) / 100,
    aov: live.length ? Math.round((valueBillable / live.length) * 100) / 100 : 0,
  };
}

/** The expensive metrics — only ever for one restaurant at a time. */
async function tenantDetail(t, since, days) {
  const { detectLang } = await import("./flows/master.js");
  const slug = t.config?.slug || null;
  const q = (table) => t.db.from(table);

  const [sessions, orders, msgs, guestText, failures, spendRow, flowRows] = await Promise.all([
    pageAll((f, to) => q("chat_sessions")
      .select("session_id,phone_number,channel,created_at,needs_attention,handoff_reason,ai_enabled")
      .gte("created_at", since).order("created_at", { ascending: false }).range(f, to)),
    pageAll((f, to) => q("orders")
      .select("id,phone_number,total,status,order_type,created_at")
      .gte("created_at", since).order("created_at", { ascending: false }).range(f, to)),
    // timestamps only — message bodies would be megabytes to compute an average
    pageAll((f, to) => q("chat_messages").select("session_id,sender,created_at")
      .gte("created_at", since).order("created_at", { ascending: true }).range(f, to), 8000),
    q("chat_messages").select("session_id,message,created_at")
      .eq("sender", "guest").gte("created_at", since)
      .order("created_at", { ascending: false }).limit(600),
    q("routing_failures").select("phone_number,stage,error,created_at")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(50),
    costRpcTrusted(t).then((ok) => (ok ? oneRow(tryRpc(t, "ops_rollup_totals", { p_since: since })) : null)),
    // WHERE the money went, for this restaurant — one row per flow
    costRpcTrusted(t).then((ok) => (ok ? tryRpc(t, "ops_rollup_flows", { p_since: since }) : null)).catch(() => null),
  ]);

  const orderRows = (orders.rows || []).filter((o) => String(o.status) !== "cancelled");
  const sessionRows = sessions.rows || [];

  const orderedPhones = new Set(orderRows.map((o) => o.phone_number).filter(Boolean));
  const convPhones = new Set(sessionRows.map((s) => s.phone_number || s.session_id).filter(Boolean));
  const converted = [...convPhones].filter((p) => orderedPhones.has(p)).length;

  const perPhone = new Map();
  for (const o of orderRows) {
    if (!o.phone_number) continue;
    perPhone.set(o.phone_number, (perPhone.get(o.phone_number) || 0) + 1);
  }
  const repeat = [...perPhone.values()].filter((n) => n > 1).length;

  const bySession = new Map();
  for (const m of msgs.rows || []) {
    (bySession.get(m.session_id) || bySession.set(m.session_id, []).get(m.session_id)).push(m);
  }
  const waits = [];
  for (const list of bySession.values()) {
    let pendingGuest = null;
    for (const m of list) {
      if (m.sender === "guest") { if (!pendingGuest) pendingGuest = m; }
      else if (pendingGuest) {
        const ms = new Date(m.created_at) - new Date(pendingGuest.created_at);
        if (ms >= 0 && ms < 300_000) waits.push(ms);
        pendingGuest = null;
      }
    }
  }

  const langs = { ar: 0, en: 0, franco: 0 };
  const sticky = new Map();
  for (const m of [...(guestText.data || [])].reverse()) {
    const l = detectLang(m.message, sticky.get(m.session_id) || null);
    if (langs[l] != null) { langs[l]++; sticky.set(m.session_id, l); }
  }

  const byHour = Array(24).fill(0);
  const byDow = Array(7).fill(0);
  for (const o of orderRows) {
    const d = new Date(o.created_at);
    byHour[d.getUTCHours()]++;
    byDow[d.getUTCDay()]++;
  }
  const typeMix = {};
  for (const o of orderRows) typeMix[String(o.order_type || "unknown")] = (typeMix[String(o.order_type || "unknown")] || 0) + 1;

  const spend = spendRow
    ? Number(spendRow.cost_usd) || 0
    // root rows only — a parent's cost_usd already includes its children's (see 035)
    : (await pageAll((f, to) => q("flow_executions").select("cost_usd,parent_id")
        .gte("started_at", since).order("started_at", { ascending: false }).range(f, to))).rows
        .filter((r) => !r.parent_id)
        .reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  const revenue = orderRows.reduce((s, o) => s + (Number(o.total) || 0), 0);

  return {
    restaurant: slug, name: t.config?.name || slug, window_days: days,
    sessions: sessionRows.length,
    sessions_converted: converted,
    conversion_rate: convPhones.size ? Math.round((converted / convPhones.size) * 1000) / 10 : 0,
    orders: orderRows.length,
    revenue_egp: round2(revenue),
    guests: perPhone.size,
    repeat_guests: repeat,
    repeat_rate: perPhone.size ? Math.round((repeat / perPhone.size) * 1000) / 10 : 0,
    cost_usd: round6(spend),
    cost_per_order_usd: orderRows.length ? round6(spend / orderRows.length) : null,
    first_reply: {
      samples: waits.length,
      median_ms: waits.length ? percentile(waits, 0.5) : null,
      p90_ms: waits.length ? percentile(waits, 0.9) : null,
      worst_ms: waits.length ? Math.max(...waits) : null,
    },
    languages: langs,
    orders_by_hour: byHour,
    orders_by_dow: byDow,
    order_types: typeMix,
    handoffs_open: sessionRows.filter((s) => s.needs_attention).length,
    ai_off: sessionRows.filter((s) => s.ai_enabled === false).length,
    dead_letters: (failures.data || []).map((f) => ({ ...f, restaurant: slug })),
    // where the money went, for this restaurant
    spend_by_flow: (Array.isArray(flowRows) ? flowRows : []).map((r) => ({
      flow: r.flow, runs: Number(r.runs) || 0, errors: Number(r.errors) || 0,
      cost_usd: round6(Number(r.cost_usd) || 0),
      avg_ms: Number(r.avg_ms) || 0, p95_ms: Number(r.p95_ms) || 0,
    })).sort((a, b) => b.cost_usd - a.cost_usd),
    messages_sampled: (msgs.rows || []).length,
    messages_capped: msgs.capped || false,
    language_sample: (guestText.data || []).length,
    spend_aggregated: !!spendRow,
  };
}

function percentile(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]);
}

// PRE-FLIGHT — a restaurant whose config is broken looks fine until a guest hits it.
// Every check is a fact about their data, not an opinion.
app.get("/api/ops/preflight", opsAuth, async (_req, res) => {
  try {
    const out = await cached("preflight", 60_000, async () => {
      const tenants = await resolveAllRestaurants();
      const wpidOwner = tenants.find((x) => x.record?.wpid)?.config?.slug || null;
      const rows = await Promise.all(tenants.map(async (t) => {
        const c = t.config || {};
        const bi = c.basic_info || {};
        const checks = [];
        const add = (ok, level, label, detail) => checks.push({ ok, level, label, detail });

        const [menu, sold, tables] = await Promise.all([
          t.db.from("menu_items").select("id", { count: "exact", head: true }),
          t.db.from("menu_items").select("id", { count: "exact", head: true }).eq("available", true),
          t.db.from("restaurant_tables").select("id", { count: "exact", head: true }),
        ]);

        const menuCount = menu.count ?? 0;
        const availCount = sold.count ?? 0;
        add(!menu.error, "error", "menu readable", menu.error?.message || `${menuCount} items`);
        add(menuCount > 0, "error", "menu has items", `${menuCount} items`);
        add(availCount > 0, "error", "something is available to sell", `${availCount} of ${menuCount} available`);
        add(Object.keys(c.hours || {}).length > 0, "error", "opening hours set", Object.keys(c.hours || {}).length ? "set" : "empty — the bot can't say if you're open");
        // contact lives at basic_info.contact.phone (and restaurants.phone_number) — an
        // earlier version read bi.phone/bi.hotline, which do not exist, and warned on
        // every restaurant that had a perfectly good hotline
        const contact = bi.contact?.phone || bi.contact?.hotline || t.record?.phone_number || bi.contact?.email;
        add(!!contact, "warn", "contact number set", contact || "none");

        const services = bi.services || {};
        const delivery = c.delivery || {};
        const zones = Array.isArray(delivery.zones) ? delivery.zones.length : 0;
        if (services.delivery !== false) {
          add(zones > 0, "warn", "delivery zones configured", zones ? `${zones} zones` : "delivery is on but no zones — fees can't be quoted");
        }
        if (services.table_numbers !== false) {
          add((tables.count ?? 0) > 0, "warn", "tables exist", `${tables.count ?? 0} tables`);
        }
        add((c.faqs || []).length > 0, "info", "FAQs present", `${(c.faqs || []).length} entries`);
        add(!!bi.brand?.primary, "info", "brand colour set", bi.brand?.primary || "default amber");
        add(Array.isArray(bi.branches) && bi.branches.length > 0, "warn", "branches listed", `${(bi.branches || []).length} branches`);
        // There is ONE WhatsApp number on the platform, so exactly one restaurant holds
        // the wpid and everyone else legitimately has none. Warning on each of them told
        // the founder to "fix" something that was already correct.
        if (t.record?.wpid) add(true, "info", "WhatsApp number linked", `wpid ${t.record.wpid}`);
        else if (wpidOwner) add(true, "info", "WhatsApp number linked", `not this one — the number is routed to ${wpidOwner}`);
        else add(false, "warn", "WhatsApp number linked", "no restaurant has a wpid — inbound WhatsApp cannot be routed");
        add(!!t.record?.plan, "info", "billing plan set", t.record?.plan || "unset — ops shows a guess");

        return {
          restaurant: c.slug, name: c.name || c.slug, schema: t.schema,
          failing: checks.filter((x) => !x.ok && x.level === "error").length,
          warning: checks.filter((x) => !x.ok && x.level === "warn").length,
          checks,
        };
      }));
      return { available: true, restaurants: rows };
    });
    res.json(out);
  } catch (e) {
    res.json({ available: false, reason: e.message, restaurants: [] });
  }
});

/**
 * Snapshot per-day cost into the control plane (migration 039) so it outlives the trace
 * purge. Idempotent: re-snapshotting a day upserts it. Runs hourly from the janitor
 * sweep and can be triggered by hand for a backfill of whatever still exists.
 */
async function snapshotCosts(days = 3) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const tenants = await resolveAllRestaurants();
  const rows = [];
  for (const t of tenants) {
    const slug = t.config?.slug;
    if (!slug) continue;
    if (!(await costRpcTrusted(t))) continue;      // never snapshot a double-counted figure
    const [byDay, split, orders] = await Promise.all([
      tryRpc(t, "ops_rollup_days", { p_since: since }).catch(() => null),
      oneRow(tryRpc(t, "ops_spend_split", { p_since: since })),
      oneRow(tryRpc(t, "ops_order_stats", { p_since: since })),
    ]);
    if (!Array.isArray(byDay)) continue;
    // the guest/test split and orders are window-wide, not per-day; they are apportioned
    // by each day's share of the window's cost, which is exact when the split is 0/100
    // (the common case) and a reasonable attribution otherwise
    const windowCost = byDay.reduce((s, d) => s + (Number(d.cost_usd) || 0), 0) || 1;
    for (const d of byDay) {
      const share = (Number(d.cost_usd) || 0) / windowCost;
      rows.push({
        restaurant: slug,
        day: String(d.day).slice(0, 10),
        runs: Number(d.runs) || 0,
        errors: Number(d.errors) || 0,
        sessions: Number(d.sessions) || 0,
        cost_usd: Math.round((Number(d.cost_usd) || 0) * 1e6) / 1e6,
        cost_guest_usd: split ? Math.round((Number(split.cost_guest) || 0) * share * 1e6) / 1e6 : null,
        cost_test_usd: split ? Math.round(((Number(split.cost_regression) || 0) + (Number(split.cost_web) || 0)) * share * 1e6) / 1e6 : null,
        tokens_in: Number(d.tokens_in) || 0,
        tokens_out: Number(d.tokens_out) || 0,
        orders_billable: orders ? Math.round((Number(orders.orders_billable) || 0) * share) : null,
        order_value_egp: orders ? Math.round((Number(orders.value_billable) || 0) * share * 100) / 100 : null,
        snapshot_at: new Date().toISOString(),
      });
    }
  }
  const { error } = await upsertCostDaily(rows);
  return { days_written: rows.length, restaurants: tenants.length, error };
}

// Backfill / force a snapshot. `days` is bounded by what still exists to be read.
app.post("/api/ops/snapshot-costs", opsAuth, async (req, res) => {
  const days = Math.min(Math.max(Number(req.body?.days) || 3, 1), TRACE_ERROR_RETENTION_D);
  try {
    res.json({ ok: true, days, ...(await snapshotCosts(days)) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// HISTORY — months that no longer exist in flow_executions, from the 039 snapshots.
// This is the ONLY way to answer "what did July cost": the traces are long gone.
app.get("/api/ops/history", opsAuth, async (req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 36);
  const from = new Date(Date.now() - months * 31 * 86400_000).toISOString().slice(0, 10);
  const { rows, error } = await readCostDaily({ from });
  if (error) return res.json({ available: false, reason: error, months: [], days: [] });

  const byMonth = new Map();
  for (const r of rows) {
    const key = String(r.day).slice(0, 7);
    let b = byMonth.get(key);
    if (!b) byMonth.set(key, (b = { month: key, runs: 0, errors: 0, sessions: 0, cost_usd: 0, cost_guest_usd: 0, cost_test_usd: 0, orders_billable: 0, order_value_egp: 0, days: 0, restaurants: new Set(), first_day: r.day, last_day: r.day }));
    b.runs += r.runs; b.errors += r.errors; b.sessions += r.sessions;
    b.cost_usd += Number(r.cost_usd) || 0;
    b.cost_guest_usd += Number(r.cost_guest_usd) || 0;
    b.cost_test_usd += Number(r.cost_test_usd) || 0;
    b.orders_billable += Number(r.orders_billable) || 0;
    b.order_value_egp += Number(r.order_value_egp) || 0;
    b.restaurants.add(r.restaurant);
    if (r.day < b.first_day) b.first_day = r.day;
    if (r.day > b.last_day) b.last_day = r.day;
  }
  const money = (x) => Math.round(x * 1e6) / 1e6;
  res.json({
    available: true,
    retention_days: TRACE_RETENTION_D,
    months: [...byMonth.values()].map((b) => ({
      ...b,
      cost_usd: money(b.cost_usd), cost_guest_usd: money(b.cost_guest_usd), cost_test_usd: money(b.cost_test_usd),
      order_value_egp: Math.round(b.order_value_egp * 100) / 100,
      // a month whose snapshots start after the 1st was already partly purged when first
      // captured — the console must present it as a floor, not as the month's bill
      days_covered: new Set(rows.filter((r) => String(r.day).slice(0, 7) === b.month).map((r) => r.day)).size,
      restaurants: [...b.restaurants],
    })).sort((a, b) => (a.month < b.month ? 1 : -1)),
    days: rows,
  });
});

// BREAKDOWN — per-model and per-step spend, on demand. Split out of /api/ops/rollup
// because these two expand the `nodes` jsonb and took 5.2s and 6.4s on the busy schema —
// 11.6 of the page's 15 seconds — to populate a table behind a tab and one behind a
// collapsed section. Nothing should pay for a view nobody opened.
app.get("/api/ops/breakdown", opsAuth, async (req, res) => {
  const kind = req.query.kind === "step" ? "step" : "model";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? String(req.query.from) : null;
  // Clamped to BREAKDOWN_MAX_H regardless of what the page is showing. These queries scan
  // and expand jsonb; over 14 days the step variant exceeded even a 25s timeout, so it paid
  // the full timeout AND THEN sampled — 28.7s to produce an estimate. Per-step averages and
  // per-model mix barely move week to week, and the question ("which step is slow, which
  // model costs most") is answered fine by a shorter window — stated, not hidden.
  const BREAKDOWN_MAX_H = 24 * 5;
  const asked = Math.min(Number(req.query.hours) || 168, 24 * TRACE_RETENTION_D);
  const hours = Math.min(asked, BREAKDOWN_MAX_H);
  const clamped = hours < asked;
  const since = from && !clamped ? `${from}T00:00:00.000Z` : new Date(Date.now() - hours * 3600_000).toISOString();
  const fn = kind === "step" ? "ops_step_stats" : "ops_model_stats";

  try {
    const out = await cached(`breakdown:${kind}:${since}`, 60_000, async () => {
      const tenants = await resolveAllRestaurants();
      const per = await mapLimit(tenants, 4, (t) => tryRpc(t, fn, { p_since: since }).catch(() => null));
      const exact = per.every((r) => Array.isArray(r));
      const money = (x) => Math.round(x * 1e6) / 1e6;
      const num = (x) => Number(x) || 0;

      if (!exact) {
        // fallback: sample the node payloads, as the rollup used to. Shares stay honest,
        // amounts do not, and the caller is told which it got.
        const rows = [];
        for (const t of tenants) {
          const { data } = await t.db.from("flow_executions").select("flow,nodes")
            .gte("started_at", since).order("started_at", { ascending: false }).limit(ROLLUP_SAMPLE);
          for (const r of data || []) for (const n of Array.isArray(r.nodes) ? r.nodes : []) rows.push({ flow: r.flow, n });
        }
        const m = new Map();
        for (const { flow, n } of rows) {
          if (kind === "model" ? !n?.model : !n?.name) continue;
          const key = kind === "model" ? n.model : `${flow}|${n.name}`;
          let b = m.get(key);
          if (!b) m.set(key, (b = kind === "model"
            ? { model: n.model, calls: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0, ms: 0 }
            : { flow, node: n.name, calls: 0, errors: 0, cost_usd: 0, ms: 0 }));
          b.calls++; b.ms += num(n.ms); b.cost_usd += num(n.cost_usd);
          if (kind === "model") { b.tokens_in += num(n.tokens_in); b.tokens_out += num(n.tokens_out); }
          else if (n.status === "error" || n.error) b.errors++;
        }
        const list = [...m.values()].map((b) => ({ ...b, cost_usd: money(b.cost_usd), avg_ms: b.calls ? Math.round(b.ms / b.calls) : 0, ms: undefined }));
        return { available: true, kind, exact: false, window_hours: hours, clamped, asked_hours: asked, sampled_runs: ROLLUP_SAMPLE * tenants.length, rows: list.sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 20) };
      }

      // exact: merge one row per model / per step across tenants
      const m = new Map();
      for (const rows of per) for (const r of rows) {
        const key = kind === "model" ? r.model : `${r.flow}|${r.node}`;
        let b = m.get(key);
        if (!b) m.set(key, (b = kind === "model"
          ? { model: r.model, calls: 0, tokens_in: 0, tokens_out: 0, tokens_cached: 0, cost_usd: 0, _msW: 0, p95_ms: 0 }
          : { flow: r.flow, node: r.node, calls: 0, errors: 0, cost_usd: 0, _msW: 0, p95_ms: 0 }));
        b.calls += num(r.calls); b.cost_usd += num(r.cost_usd);
        b._msW += num(r.avg_ms) * num(r.calls);
        b.p95_ms = Math.max(b.p95_ms, num(r.p95_ms));
        if (kind === "model") { b.tokens_in += num(r.tokens_in); b.tokens_out += num(r.tokens_out); b.tokens_cached += num(r.tokens_cached); }
        else b.errors += num(r.errors);
      }
      const list = [...m.values()].map((b) => ({
        ...b, cost_usd: money(b.cost_usd),
        avg_ms: b.calls ? Math.round(b._msW / b.calls) : 0, _msW: undefined,
      }));
      return {
        available: true, kind, exact: true, window_hours: hours, clamped, asked_hours: asked, sampled_runs: null,
        rows: list.sort((a, b) => (kind === "model" ? b.cost_usd - a.cost_usd : b.avg_ms - a.avg_ms)).slice(0, 20),
      };
    });
    res.json(out);
  } catch (e) {
    res.json({ available: false, reason: e.message, kind, rows: [] });
  }
});

/**
 * COST SUMMARY — what real guests actually cost, per tenant, with our own traffic kept
 * separate, plus a naive monthly projection.
 *
 * One `respond` row IS one guest turn, and its cost_usd already contains every sub-flow
 * it spawned (master → friendly/order). A turn's cost is therefore that single row —
 * summing its children as well counts the same LLM call two or three times, which is how
 * a $26 month once read $78. Nothing else is summed here.
 */
app.get("/api/ops/cost-summary", opsAuth, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), TRACE_RETENTION_D);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  try {
    const out = await cached(`cost-summary:${days}`, 60_000, async () => {
      const tenants = await resolveAllRestaurants();
      const r6 = (x) => Math.round(x * 1e6) / 1e6;

      const shape = (list) => {
        const turns = list.length;
        const sum = (f) => list.reduce((a, r) => a + (Number(r[f]) || 0), 0);
        const cost = sum("cost_usd");
        const conversations = new Set(list.map((r) => r.session_id).filter(Boolean)).size;
        const perConvo = conversations ? cost / conversations : 0;
        const convosPerDay = conversations / days;
        return {
          turns,
          errors: list.filter((r) => r.status === "error").length,
          cost_usd: r6(cost),
          avg_cost_per_turn: turns ? r6(cost / turns) : 0,
          conversations,
          avg_turns_per_conversation: conversations ? Math.round((turns / conversations) * 10) / 10 : 0,
          avg_cost_per_conversation: r6(perConvo),
          conversations_per_day: Math.round(convosPerDay * 100) / 100,
          avg_tokens_in: turns ? Math.round(sum("tokens_in") / turns) : 0,
          avg_tokens_out: turns ? Math.round(sum("tokens_out") / turns) : 0,
          avg_ms: turns ? Math.round(sum("duration_ms") / turns) : 0,
          // deliberately naive: today's conversation rate held for 30 days. With almost no
          // real traffic this is nearly zero — that is the honest answer, not a bug.
          expected_monthly_cost: r6(perConvo * convosPerDay * 30),
        };
      };

      const rows = await mapLimit(tenants, 6, async (t) => {
        const turns = await pageAll((from, to) => t.db.from("flow_executions")
          .select("session_id,cost_usd,duration_ms,tokens_in,tokens_out,status")
          .eq("flow", "respond")                       // one row = one guest turn
          .gte("started_at", since)
          .order("started_at", { ascending: false }).range(from, to), 20000);
        const all = turns.rows || [];
        return {
          restaurant: t.config?.slug || null,
          name: t.config?.name || t.config?.slug || null,
          capped: turns.capped || false,
          real: shape(all.filter((r) => !isTestSession(r.session_id))),
          test: shape(all.filter((r) => isTestSession(r.session_id))),
        };
      });

      const total = (key) => {
        const lists = rows.map((r) => r[key]);
        const cost = lists.reduce((a, x) => a + x.cost_usd, 0);
        const turns = lists.reduce((a, x) => a + x.turns, 0);
        const conversations = lists.reduce((a, x) => a + x.conversations, 0);
        const perConvo = conversations ? cost / conversations : 0;
        return {
          turns, cost_usd: r6(cost), conversations,
          avg_cost_per_turn: turns ? r6(cost / turns) : 0,
          avg_cost_per_conversation: r6(perConvo),
          avg_turns_per_conversation: conversations ? Math.round((turns / conversations) * 10) / 10 : 0,
          conversations_per_day: Math.round((conversations / days) * 100) / 100,
          expected_monthly_cost: r6(perConvo * (conversations / days) * 30),
        };
      };

      return { available: true, window_days: days, since, restaurants: rows, totals: { real: total("real"), test: total("test") } };
    });
    res.json(out);
  } catch (e) {
    res.json({ available: false, reason: e.message, window_days: days, restaurants: [] });
  }
});

// RESTAURANTS — the full roster for filter dropdowns. Deriving the options from the rows
// on screen meant a restaurant with no runs in the current page never appeared as an
// option at all, so it could not be selected to go and find them.
app.get("/api/ops/restaurants", opsAuth, async (_req, res) => {
  try {
    const rows = await cached("ops:restaurants", 60_000, async () => {
      const tenants = await resolveAllRestaurants();
      return tenants.map((t) => ({
        slug: t.config?.slug || null,
        name: t.config?.name || t.config?.slug || null,
        schema: t.schema,
        plan: t.record?.plan || null,
      })).filter((r) => r.slug);
    });
    res.json({ available: true, restaurants: rows });
  } catch (e) {
    res.json({ available: false, reason: e.message, restaurants: [] });
  }
});

// DEPLOYS — when the running behaviour last changed. Pairs with the cost/error charts:
// an error rate that starts climbing at 21:04 next to a restart at 21:03 answers itself.
app.get("/api/ops/deploys", opsAuth, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { rows, error } = await listServiceBoots(since);
  res.json({
    available: !error,
    reason: error,          // "relation does not exist" until migration 033 is run
    window_days: days,
    boots: rows,
  });
});

app.get("/api/executions/:id", opsAuth, async (req, res) => {
  let e = getExecution(req.params.id);
  if (!e) {
    // the id could live in ANY tenant's schema — check them all before a 404
    try {
      const tenants = await resolveAllRestaurants();
      for (const t of tenants) {
        e = await getExecutionDb(t.db, req.params.id).catch(() => null);
        if (e) { e = { ...e, restaurant: t.config?.slug || null }; break; }
      }
    } catch {}
  }
  if (!e) return res.status(404).json({ error: "Not found" });
  res.json({ ...e, is_test: e.is_test ?? isTestSession(e.session_id) });
});

// ================= workers =================
// Buffer keys are "<restaurantId>|<sessionId>" so two restaurants can never
// share a burst — the same guest phone may talk to both, and their messages
// must stay in separate conversations.
// A session's turns MUST run one at a time. Two overlapping `respond` cycles for the
// same chat (flush worker + a post_check chained re-flush, or two quick bursts) each
// read the diner/history, then write them back from their turn-old copy — the second
// clobbers the first, losing the guest's just-given answer, so the agent re-asks and
// the guest sees "the same wrong answer again". Serializing per bufferKey removes the
// race (and stops duplicate replies). claimBurst still guards the same burst; this
// guards different bursts of the SAME session running concurrently.
const flushLocks = new Map(); // bufferKey -> tail of its turn queue
async function flushOnce(bufferKey, channel = "web") {
  const sep = String(bufferKey).indexOf("|");
  const restaurantId = sep > 0 ? bufferKey.slice(0, sep) : null;
  const sessionId = sep > 0 ? bufferKey.slice(sep + 1) : bufferKey;
  const tenant = restaurantId ? await resolveRestaurantById(restaurantId) : await resolveRestaurant();
  const ctx = { sessionId, bufferKey, tenant, channel, trigger: "buffer-flush" };
  const { error } = await runFlow("respond", ctx, {});
  if (error) await handleFlushFailure(ctx, error);
}
function flushHandler(bufferKey, channel = "web") {
  const prev = flushLocks.get(bufferKey) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => flushOnce(bufferKey, channel));
  flushLocks.set(bufferKey, run.finally(() => { if (flushLocks.get(bufferKey) === run) flushLocks.delete(bufferKey); }));
  return run;
}

startFlushWorker(flushHandler);

// hourly janitor
setInterval(async () => {
  try {
    // Snapshot cost history FIRST — the janitor is what deletes the traces it is
    // computed from. Do it after, and the day the purge runs is the day the number is
    // lost forever (that is how July became unrecoverable: 36 error rows and $0.0005
    // survive from a month the bot worked through).
    await snapshotCosts(3).catch((e) => log("cost snapshot:", e.message));
    for (const tenant of await resolveAllRestaurants()) {
      await runFlow("janitor", { sessionId: "janitor", tenant, trigger: "schedule" }, {}).catch((e) => log(`janitor ${tenant.record.slug}:`, e.message));
    }
  } catch (e) {
    log("janitor error:", e.message);
  }
}, 3600_000);

// One snapshot shortly after boot, so a restart-heavy day still records itself and a
// fresh deploy does not wait an hour to start keeping history.
setTimeout(() => { snapshotCosts(3).catch(() => {}); }, 90_000).unref?.();

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

app.listen(PORT, () => {
  log(`munadim flows on :${PORT} (llm: ${llmReady ? "ready" : "MISSING KEY"})`);
  // deploy marker — see migration 033. Never awaited: boot must not wait on a write.
  recordServiceBoot("flows").catch(() => {});
});
