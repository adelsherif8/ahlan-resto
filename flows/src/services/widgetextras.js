// Table-chat extras (docs/KOFFEE-KULTURE-DINE-IN.md): busy level, popular today, the shared table
// cart, the running tab with per-phone shares, tips, voice ordering, guest profile (taste / vibe /
// default milk / language) and per-drink thumbs. Everything here is COUNTED from rows — orders,
// claims, diner preferences — never estimated by a model.
import { effectiveSession, liveClaim, isShowroom } from "./tabletoken.js";
import { notifyDashboard } from "./chatlog.js";
import { transcribeAudio } from "./media.js";
import { setSessionLanguage } from "../flows/buffering.js";

const OPEN = ["pending", "accepted", "received", "new", "preparing", "in_progress", "cooking"];
const cairoDay = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" })).toISOString().slice(0, 10);

// per-tenant 30s cache: busy + popular are the same for every phone in the café
const cache = new Map();
async function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - ms) return hit.v;
  const v = await fn(); cache.set(key, { at: Date.now(), v }); return v;
}

export async function busyLevel(tenant) {
  return cached(`busy|${tenant.record.id}`, 30_000, async () => {
    const { data } = await tenant.db.from("orders").select("status,created_at").in("status", OPEN).gte("created_at", new Date(Date.now() - 90 * 60_000).toISOString()).limit(200);
    const open = (data || []).length;
    const minutes = Math.min(45, Math.max(6, Math.round(6 + open * 2.5)));
    return { open, minutes, level: minutes <= 10 ? "quick" : minutes <= 20 ? "steady" : "busy" };
  });
}

export async function popularToday(tenant) {
  return cached(`pop|${tenant.record.id}`, 60_000, async () => {
    const start = new Date(`${cairoDay()}T00:00:00+02:00`).toISOString();
    const { data } = await tenant.db.from("orders").select("items,status").gte("created_at", start).neq("status", "cancelled").limit(500);
    const n = {};
    for (const o of data || []) for (const i of o.items || []) n[i.name] = (n[i.name] || 0) + (Number(i.qty) || 1);
    return Object.entries(n).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  });
}

// the row that holds table-wide state: the claim owner's widget session (showroom: your own)
async function tableKey(tenant, tok, sessionId) {
  if (isShowroom(tenant.record, tok.table)) return { key: sessionId, sessions: [sessionId], claim: null };
  const claim = await liveClaim(tenant.db, tok.table);
  if (!claim) return { key: sessionId, sessions: [sessionId], claim: null };
  return { key: claim.owner_session, sessions: [claim.owner_session, ...(claim.members || [])], claim };
}
async function prefsOf(db, phone) {
  const { data } = await db.from("diners").select("id,name,preferences").eq("phone_number", phone).maybeSingle();
  return data;
}
async function patchPrefs(db, phone, patch) {
  const d = await prefsOf(db, phone);
  if (!d?.id) return null;
  const preferences = { ...(d.preferences || {}), ...patch };
  await db.from("diners").update({ preferences }).eq("id", d.id);
  return preferences;
}

// who is who at the table: "Adel" when remembered, else "Phone 2"
async function labels(db, sessions) {
  const out = {};
  for (const [i, s] of sessions.entries()) {
    const runAs = await effectiveSession(db, s);
    const d = runAs !== s ? await prefsOf(db, runAs) : null;
    out[s] = { runAs, label: d?.name ? d.name.split(" ")[0] : i === 0 ? "Phone 1" : `Phone ${i + 1}` };
  }
  return out;
}

export async function tableState(tenant, tok, sessionId) {
  const db = tenant.db;
  const t = await tableKey(tenant, tok, sessionId);
  const who = await labels(db, t.sessions);
  const keyRow = await prefsOf(db, t.key);
  const since = t.claim?.claimed_at || keyRow?.preferences?.table_session?.started_at || new Date(Date.now() - 6 * 3600_000).toISOString();
  const phones = [...new Set(Object.values(who).map((w) => w.runAs).concat(t.sessions))];
  const { data: os } = await db.from("orders").select("code,status,total,subtotal,items,phone_number,created_at").in("phone_number", phones).gte("created_at", since).order("created_at").limit(30);
  const byPhone = Object.fromEntries(Object.entries(who).flatMap(([s, w]) => [[s, { s, ...w }], [w.runAs, { s, ...w }]]));
  const orders = (os || []).filter((o) => o.status !== "cancelled").map((o) => ({ code: o.code, status: o.status, total: Number(o.total) || 0, items: (o.items || []).map((i) => `${i.qty}× ${i.name}`),
    by: byPhone[o.phone_number]?.label || "Table", mine: byPhone[o.phone_number]?.s === sessionId }));
  const tips = (keyRow?.preferences?.table_tips || []).map((x) => ({ ...x, mine: x.session === sessionId, session: undefined }));
  const sum = (a) => Math.round(a.reduce((s, x) => s + (Number(x.total ?? x.amount) || 0), 0) * 100) / 100;
  return {
    me: who[sessionId]?.label || "You",
    cart: keyRow?.preferences?.table_cart || { rev: 0, lines: [] },
    tab: { orders, tips, total: sum(orders) + sum(tips), mine: sum(orders.filter((o) => o.mine)) + sum(tips.filter((x) => x.mine)), phones: t.sessions.length },
  };
}

// taste / vibe / default milk / language — on the identity the guest runs as (remembered guests keep it)
export async function profileOf(db, runAs) {
  const d = await prefsOf(db, runAs);
  const p = d?.preferences?.widget_profile || {};
  // habit: the milk they keep choosing, counted from their orders
  const { data: os } = await db.from("orders").select("items").eq("phone_number", runAs).neq("status", "cancelled").order("created_at", { ascending: false }).limit(15);
  const milks = {}; let drinks = 0;
  for (const o of os || []) for (const i of o.items || []) {
    const vals = Object.values(i.options || {}).flat().map((v) => (typeof v === "string" ? v : v?.name)).filter(Boolean);
    if (!(i.option_defs || []).some((g) => g.key === "milk")) continue;
    drinks++; const m = vals.find((v) => /^(oat|coconut|skim|almond)/i.test(v)); if (m) milks[m] = (milks[m] || 0) + 1;
  }
  const top = Object.entries(milks).sort((a, b) => b[1] - a[1])[0];
  const habit = top && top[1] >= 3 && top[1] / drinks >= 0.6 ? { milk: top[0], times: top[1], of: drinks } : null;
  return { taste: p.taste || null, vibe: p.vibe || null, default_milk: p.default_milk || null, language: d?.preferences?.language || null, habit };
}

export function registerWidgetExtras(app, { widgetTenant, widgetGuard, rateLimit, widgetKey }) {
  // shared table cart: last write wins, every phone at the table polls it
  app.post("/api/widget/cart", rateLimit("widget-cart", 90, 60_000, widgetKey), async (req, res) => {
    const w = await widgetTenant(req, res); if (!w) return;
    try {
      const sessionId = await widgetGuard(req, res, w); if (!sessionId) return;
      const t = await tableKey(w.tenant, w.tok, sessionId);
      const who = await labels(w.tenant.db, t.sessions);
      const lines = (Array.isArray(req.body?.lines) ? req.body.lines : []).slice(0, 30).map((l) => ({
        key: String(l.key || "").slice(0, 200), name: String(l.name || "").slice(0, 80), qty: Math.max(1, Math.min(9, Number(l.qty) || 1)),
        price: Number(l.price) || 0, opts: (l.opts || []).slice(0, 8).map((o) => String(o).slice(0, 40)), size: l.size ? String(l.size).slice(0, 20) : null,
        note: l.note ? String(l.note).slice(0, 120) : null, photo: l.photo ? String(l.photo).slice(0, 300) : null, by: l.by ? String(l.by).slice(0, 24) : who[sessionId]?.label || "You" }));
      const cur = (await prefsOf(w.tenant.db, t.key))?.preferences?.table_cart || { rev: 0 };
      const table_cart = { rev: (cur.rev || 0) + 1, lines, by: who[sessionId]?.label || "You", at: new Date().toISOString() };
      await patchPrefs(w.tenant.db, t.key, { table_cart });
      res.json({ ok: true, cart: table_cart });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // tips: to a named staff member, a team, or the whole café — added to the table's bill
  app.post("/api/widget/tip", rateLimit("widget-tip", 10, 60_000, widgetKey), async (req, res) => {
    const w = await widgetTenant(req, res); if (!w) return;
    try {
      const sessionId = await widgetGuard(req, res, w); if (!sessionId) return;
      const amount = Math.round(Number(req.body?.amount) || 0);
      if (amount < 5 || amount > 2000) return res.status(400).json({ error: "tip must be 5–2000" });
      const staff = (w.tenant.record.ai?.dine_in_widget?.staff || []).map((s) => s.name);
      const target = String(req.body?.target || "The whole café").slice(0, 60);
      const t = await tableKey(w.tenant, w.tok, sessionId);
      const who = await labels(w.tenant.db, t.sessions);
      const row = await prefsOf(w.tenant.db, t.key);
      const tip = { target, amount, note: req.body?.note ? String(req.body.note).slice(0, 140) : null, by: who[sessionId]?.label || "Guest", session: sessionId, at: new Date().toISOString(), named: staff.includes(target) };
      await patchPrefs(w.tenant.db, t.key, { table_tips: [...(row?.preferences?.table_tips || []), tip] });
      await notifyDashboard(w.tenant.db, "tip", `Tip ${amount} EGP for ${target} · table ${w.tok.table}`, tip.note || `From ${tip.by} at table ${w.tok.table} — add it to their bill.`, `table:${w.tok.table}`).catch(() => {});
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // voice ordering: the same transcription the WhatsApp voice notes use
  app.post("/api/widget/voice", rateLimit("widget-voice", 10, 60_000, widgetKey), async (req, res) => {
    const w = await widgetTenant(req, res); if (!w) return;
    try {
      const sessionId = await widgetGuard(req, res, w); if (!sessionId) return;
      const b64 = String(req.body?.audio || "");
      if (!b64 || b64.length > 3_000_000) return res.status(400).json({ error: "audio missing or too long" });
      const mime = /^audio\/[a-z0-9.+-]+/i.test(req.body?.mime || "") ? String(req.body.mime).split(";")[0] : "audio/webm";
      const text = await transcribeAudio(Buffer.from(b64, "base64"), mime);
      res.json({ text: /^\[voice note/.test(text) ? "" : text.trim() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/widget/profile", rateLimit("widget-profile", 20, 60_000, widgetKey), async (req, res) => {
    const w = await widgetTenant(req, res); if (!w) return;
    try {
      const sessionId = await widgetGuard(req, res, w); if (!sessionId) return;
      const runAs = await effectiveSession(w.tenant.db, sessionId);
      const cur = (await prefsOf(w.tenant.db, runAs))?.preferences || {};
      const p = { ...(cur.widget_profile || {}) };
      for (const k of ["taste", "vibe", "default_milk"]) if (k in (req.body || {})) p[k] = req.body[k] ? String(req.body[k]).slice(0, 30) : null;
      const patch = { widget_profile: p };
      const lang = req.body?.language;
      if (["en", "ar", "franco"].includes(lang)) {
        patch.language = lang;
        for (const s of new Set([sessionId, runAs])) setSessionLanguage(`${w.tenant.record.id}|${s}`, lang);
      }
      await patchPrefs(w.tenant.db, runAs, patch);
      if (runAs !== sessionId && patch.language) await patchPrefs(w.tenant.db, sessionId, { language: patch.language });
      res.json({ ok: true, profile: await profileOf(w.tenant.db, runAs) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 👍 / 👎 per item after it's served — the owner's "which drinks do people love" signal
  app.post("/api/widget/rate-item", rateLimit("widget-rate-item", 20, 60_000, widgetKey), async (req, res) => {
    const w = await widgetTenant(req, res); if (!w) return;
    try {
      const sessionId = await widgetGuard(req, res, w); if (!sessionId) return;
      const runAs = await effectiveSession(w.tenant.db, sessionId);
      const item = String(req.body?.item || "").slice(0, 80); if (!item) return res.status(400).json({ error: "item required" });
      const up = req.body?.up === true;
      const row = { phone_number: runAs, rating: null, comments: `${up ? "👍" : "👎"} ${item} · ${w.tok.branch}`, order_code: req.body?.order_code ? String(req.body.order_code).slice(0, 12) : null, source: "item_rating", status: "closed" };
      let ins = await w.tenant.db.from("feedback").insert(row);
      if (ins.error) ins = await w.tenant.db.from("feedback").insert({ phone_number: row.phone_number, rating: null, comments: row.comments });
      res.json({ ok: !ins.error });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
