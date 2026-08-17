import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";
import { FLOWS_URL, FLOWS_OPS_TOKEN, log } from "../config/env.js";

const router = Router();
router.use(requireAuth, restaurantContext);

// Price of one unit including the options the guest picked. Mirrors itemPrice() in
// flows/src/flows/order.js — a chosen option can REPLACE the base price (c.price) or add
// to it (c.delta). Everything it needs (option_defs) is stored on the draft item itself.
// If the two ever drift, flows is the authority: it is what the guest was actually quoted.
// Allergen vocabulary. menu_items.ingredients is FREE TEXT written by staff, so matching
// is a heuristic and is treated as one: a hit means "check this before it's made", and a
// miss NEVER means "safe". The UI must never render an all-clear from this — an unlisted
// butter is exactly the case that would hurt someone.
const ALLERGEN_HINTS = {
  nut: ["nut", "peanut", "almond", "cashew", "hazelnut", "pistachio", "walnut", "pecan", "nutella", "praline", "مكسرات", "فستق", "لوز", "بندق", "سوداني", "عين جمل"],
  dairy: ["milk", "cheese", "cream", "butter", "yoghurt", "yogurt", "labneh", "ghee", "mozzarella", "cheddar", "parmesan", "لبن", "جبن", "جبنة", "كريمة", "زبدة", "حليب"],
  gluten: ["wheat", "flour", "bread", "bun", "pasta", "dough", "breadcrumb", "crouton", "batter", "قمح", "دقيق", "خبز", "عيش", "مكرونة"],
  egg: ["egg", "mayo", "mayonnaise", "aioli", "meringue", "بيض", "مايونيز"],
  shellfish: ["shrimp", "prawn", "crab", "lobster", "calamari", "squid", "جمبري", "استاكوزا", "كابوريا", "كاليماري"],
  fish: ["fish", "tuna", "salmon", "anchovy", "سمك", "تونة", "سلمون", "أنشوجة"],
  sesame: ["sesame", "tahini", "tahina", "halva", "سمسم", "طحينة", "حلاوة"],
  soy: ["soy", "soya", "tofu", "edamame", "صويا", "توفو"],
  mushroom: ["mushroom", "truffle", "عيش الغراب", "مشروم"],
};

const norm = (s) => String(s || "").trim().toLowerCase();

// The cart guards need the menu, and /context refreshes every 20s while a chat is open —
// re-reading every dish three times a minute per open conversation. The menu changes on
// human timescales, so a short per-restaurant cache removes that entirely.
const menuCache = new Map(); // restaurantId -> { at, rows }
const MENU_TTL_MS = 60_000;
async function cachedMenu(req) {
  const key = req.restaurant?.id || "default";
  const hit = menuCache.get(key);
  if (hit && Date.now() - hit.at < MENU_TTL_MS) return hit.rows;
  const rows = await req.repo.list("menu_items");
  menuCache.set(key, { at: Date.now(), rows });
  return rows;
}

// Which words to hunt for, given what the guest wrote in their allergy list. "tree nuts"
// and "nut allergy" both resolve to the nut vocabulary; anything unrecognised is still
// searched literally, so a one-off like "coriander" still works.
function allergenTokens(allergy) {
  const a = norm(allergy);
  if (!a) return [];
  const tokens = new Set([a]);
  for (const [key, words] of Object.entries(ALLERGEN_HINTS)) {
    if (a.includes(key) || words.some((w) => a.includes(w))) words.forEach((w) => tokens.add(w));
  }
  return [...tokens];
}

// Is the restaurant open right now? hours = { mon: [{open,close}], … }, close may run past
// midnight (12:00–01:00), in which case the window belongs to the previous day.
function openNow(hours, tz) {
  if (!hours) return null;
  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz || "Africa/Cairo", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const dayIdx = DAYS.indexOf(String(parts.weekday || "").slice(0, 3).toLowerCase());
  if (dayIdx < 0) return null;
  const toMin = (s) => { const [h, m] = String(s || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const windows = [
    ...(hours[DAYS[dayIdx]] || []).map((w) => ({ ...w, prev: false })),
    ...(hours[DAYS[(dayIdx + 6) % 7]] || []).map((w) => ({ ...w, prev: true })),
  ];
  for (const w of windows) {
    const o = toMin(w.open), c = toMin(w.close);
    const overnight = c <= o;
    if (w.prev) { if (overnight && mins < c) return true; continue; }
    if (overnight ? mins >= o : mins >= o && mins < c) return true;
  }
  return false;
}

function unitPrice(item) {
  const picked = item.options || {};
  let base = Number(item.price) || 0;
  let delta = 0;
  for (const g of item.option_defs || []) {
    const chosen = picked[g.key];
    for (const name of Array.isArray(chosen) ? chosen : [chosen].filter(Boolean)) {
      const c = (g.choices || []).find((x) =>
        String(x.name || "").trim().toLowerCase() === String(name || "").trim().toLowerCase());
      if (!c) continue;
      if (c.price != null) base = Number(c.price);
      if (c.delta) delta += Number(c.delta);
    }
  }
  return Math.round((base + delta) * 100) / 100;
}

router.get("/sessions", async (req, res, next) => {
  try {
    const slaMin = Number(req.restaurant?.ai?.sla_minutes) || 0;
    // Polled every 10s by Chats and every 30s by the sidebar, so neither read here may be
    // unbounded. The inbox is a working queue, not an archive: the most recent conversations
    // are the ones anyone acts on. `?all=1` lifts the cap for search, the one case that
    // legitimately needs history (same widen-on-search rule the orders board uses).
    const wide = req.query.all === "1";
    let rows = await req.repo.list("chat_sessions", { order: "last_message_at", limit: wide ? 2000 : 300 });
    // regression/test harness sessions never belong in the staff inbox
    rows = rows.filter((r) => !/^web:(regress|convo|test)-/.test(String(r.session_id || "")));
    // attach the diner's name (guest-confirmed first, WhatsApp profile as fallback).
    // Only for the sessions we're returning — this used to pull the ENTIRE diners table
    // on every poll to label at most a few hundred rows.
    let byPhone = new Map();
    try {
      const ids = [...new Set(rows.map((r) => r.phone_number || r.session_id).filter(Boolean))];
      let diners = [];
      if (req.tenantClient && ids.length) {
        const { data } = await req.tenantClient.from("diners").select("*").in("phone_number", ids.slice(0, 500));
        diners = data || [];
      } else if (!req.tenantClient) {
        diners = await req.repo.list("diners");     // demo mode: tiny dataset
      }
      byPhone = new Map(diners.map((d) => [d.phone_number, d]));
    } catch {}
    // latest order per guest today — powers the "just ordered" chip in the inbox
    let lastOrder = new Map();
    try {
      const today = new Date().toISOString().slice(0, 10);
      const orders = await req.repo.list("orders", { order: "created_at", desc: true, limit: 200 });
      for (const o of orders) {
        if (String(o.created_at).slice(0, 10) !== today) break;
        if (!lastOrder.has(o.phone_number)) lastOrder.set(o.phone_number, { code: o.code, status: o.status, at: o.created_at, total: o.total });
      }
    } catch {}
    res.json(rows.map((s) => {
      const d = byPhone.get(s.phone_number || s.session_id);
      const p = d?.preferences?.pending_order;
      const draftFresh = p?.items?.length && Date.now() - new Date(p.at || 0).getTime() < 120 * 60_000;
      return {
        ...s,
        diner_name: d?.name || d?.wa_profile_name || null,
        draft_stage: draftFresh
          ? (p.awaiting_confirm ? "confirming" : p.awaiting_option ? "choosing options" : p.payment_method ? "confirming" : "building")
          : null,
        // how long this one has actually been waiting on a human — the inbox sorts by it,
        // because "oldest unanswered first" is the only fair queue on a busy shift
        waiting_min: s.needs_attention && s.last_message_at
          ? Math.round((Date.now() - new Date(s.last_message_at).getTime()) / 60000)
          : null,
        // breached the restaurant's own answer-within target (Settings → AI host).
        // No target configured = no breach: we never invent a standard nobody agreed to.
        sla_breached: slaMin && s.needs_attention && s.last_message_at
          ? (Date.now() - new Date(s.last_message_at).getTime()) / 60000 > slaMin
          : false,
        draft_stalled_min: draftFresh && p.at
          ? Math.round((Date.now() - new Date(p.at).getTime()) / 60000)
          : null,
        last_order: lastOrder.get(s.phone_number || s.session_id) || null,
      };
    }));
  } catch (e) { next(e); }
});

// "How we answered this before." Every past conversation is a knowledge base nobody could
// search: staff have already written a good answer to this question, probably more than
// once, and had no way to find it. Returns the guest question plus the reply that followed
// it, so the wording can be reused rather than reinvented at 9pm on a Friday.
router.get("/search", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 3) return res.json([]);
    const exclude = String(req.query.exclude || "");

    let hits = [];
    if (req.tenantClient) {
      const { data, error } = await req.tenantClient
        .from("chat_messages")
        .select("id,session_id,sender,message,created_at")
        .eq("sender", "guest")
        .ilike("message", `%${q.replace(/[%_]/g, "")}%`)
        .order("created_at", { ascending: false })
        .limit(40);
      if (!error) hits = data || [];
    } else {
      const rows = await req.repo.list("chat_messages", { order: "created_at", desc: true, limit: 2000 }).catch(() => []);
      hits = rows.filter((m) => m.sender === "guest" && norm(m.message).includes(norm(q))).slice(0, 40);
    }
    hits = hits.filter((m) => m.session_id !== exclude && !/^web:(regress|convo|test)-/i.test(String(m.session_id || "")));
    if (!hits.length) return res.json([]);

    // the answer is whatever was said next in that conversation — staff replies first,
    // since a human already judged them good enough to send
    const sessions = [...new Set(hits.map((m) => m.session_id))].slice(0, 10);
    let all = [];
    if (req.tenantClient) {
      const { data } = await req.tenantClient
        .from("chat_messages").select("id,session_id,sender,message,created_at")
        .in("session_id", sessions).order("created_at", { ascending: true }).limit(3000);
      all = data || [];
    } else {
      for (const sid of sessions)
        all.push(...await req.repo.list("chat_messages", { where: { session_id: sid }, order: "created_at", desc: false }).catch(() => []));
    }
    const bySession = new Map();
    for (const m of all) { if (!bySession.has(m.session_id)) bySession.set(m.session_id, []); bySession.get(m.session_id).push(m); }

    const out = [], seen = new Set();
    for (const h of hits) {
      const thread = bySession.get(h.session_id) || [];
      const at = new Date(h.created_at).getTime();
      const reply = thread.find((m) => new Date(m.created_at).getTime() > at && (m.sender === "staff" || m.sender === "ai"));
      if (!reply) continue;
      const key = norm(reply.message).slice(0, 120);
      if (!key || seen.has(key)) continue;      // the same answer twice teaches nothing
      seen.add(key);
      out.push({
        asked: String(h.message || "").slice(0, 200),
        answer: String(reply.message || "").slice(0, 600),
        by: reply.sender,
        at: reply.created_at,
        session_id: h.session_id,
      });
      if (out.length >= 5) break;
    }
    res.json(out);
  } catch (e) { next(e); }
});

// AI-suggested staff reply — drafted by the flows service, edited by a human before send
router.post("/sessions/:sessionId/draft-reply", async (req, res, next) => {
  try {
    if (!FLOWS_URL) return res.status(503).json({ error: "flows not configured" });
    const r = await fetch(`${FLOWS_URL}/api/ops/draft-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(FLOWS_OPS_TOKEN ? { "x-ops-token": FLOWS_OPS_TOKEN } : {}) },
      body: JSON.stringify({ sessionId: req.params.sessionId }),
    });
    if (!r.ok) return res.status(502).json({ error: `flows ${r.status}` });
    res.json(await r.json());
  } catch (e) { next(e); }
});

// Everything the AI knows about this guest — powers the live-chat context panel.
// Same data FRIENDLY reads, so staff taking over sees exactly what the bot saw.
router.get("/sessions/:sessionId/context", async (req, res, next) => {
  try {
    const sid = req.params.sessionId;
    const sessions = await req.repo.list("chat_sessions", { where: { session_id: sid } });
    let diner = null, upcoming = null, summary = null;
    try {
      const diners = await req.repo.list("diners", { where: { phone_number: sid } });
      diner = diners[0] || null;
    } catch {}
    try {
      const today = new Date().toISOString().slice(0, 10);
      upcoming = (await req.repo.list("reservations", { order: "date" }))
        .filter((r) => r.diner_phone === sid && r.date >= today &&
          ["pending", "confirmed", "reminded", "arrived", "seated"].includes(r.status))[0] || null;
    } catch {}
    try {
      const mf = await req.repo.list("message_full", { where: { phone_number: sid } });
      summary = mf[0]?.conversation_summary || null;
    } catch {}

    // full order picture: history, lifetime spend, their "usual", the draft in progress
    let orders = [], lifetime = 0, usual = null, draft = null, profile = null;
    try {
      const all = await req.repo.list("orders", { where: { phone_number: sid }, order: "created_at", desc: true, limit: 50 });
      orders = all.slice(0, 6).map((o) => ({
        code: o.code, status: o.status, order_type: o.order_type, total: o.total,
        created_at: o.created_at, branch: o.branch,
        items: (o.items || []).map((i) => `${i.qty}× ${i.name}`).join(", "),
      }));
      const done = all.filter((o) => o.status !== "cancelled");
      lifetime = done.reduce((t, o) => t + Number(o.total || 0), 0);
      const counts = {};
      for (const o of done) for (const it of o.items || []) counts[it.name] = (counts[it.name] || 0) + (Number(it.qty) || 1);
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= 2) usual = { name: top[0], times: top[1] };

      // Everything a person taking over the conversation would otherwise have to dig for:
      // how they usually order, where, how they pay, what they always get. All derived
      // from their real history — none of it asked for twice.
      const commonest = (key) => {
        const c = {};
        for (const o of done) if (o[key]) c[o[key]] = (c[o[key]] || 0) + 1;
        const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
        return best ? { value: best[0], times: best[1] } : null;
      };
      profile = {
        orders_count: done.length,
        cancelled_count: all.length - done.length,
        avg_ticket: done.length ? Math.round(lifetime / done.length) : null,
        first_order_at: done.length ? done[done.length - 1].created_at : null,
        last_order_at: done.length ? done[0].created_at : null,
        favourite_type: commonest("order_type"),
        favourite_branch: commonest("branch"),
        usual_payment: commonest("payment_method"),
        top_items: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([name, times]) => ({ name, times })),
      };
    } catch {}

    // How they write, so staff can answer in kind. Alphabet decides it — no LLM call for
    // something a regex settles, and Franco-Arabic ("te7eb totlob eh?") is neither
    // Arabic script nor English and gets missed by every naive check.
    try {
      const msgs = await req.repo.list("chat_messages", { where: { session_id: sid }, order: "created_at", desc: true, limit: 30 });
      const said = msgs.filter((m) => m.sender === "guest").map((m) => String(m.message || "")).join(" ");
      if (said.trim()) {
        const franco = /[0-9]/.test(said) && /\b\w*[23579]\w*\b/.test(said);
        if (profile) profile.writes_in = /[؀-ۿ]/.test(said) ? "Arabic" : franco ? "Franco-Arabic" : "English";
      }
    } catch {}

    // ---- friction: is this guest going in circles, or losing patience?
    //
    // Tuned DOWN after firing on ordinary conversations. Sending three messages in two
    // minutes is just how people use WhatsApp, and "??" is casual punctuation — neither is
    // distress. A warning that appears on healthy chats is worse than no warning, because
    // staff learn to scroll past it and then miss the real one.
    //
    // So: only STRONG evidence raises the banner on its own —
    //   • the same question asked again (the answer genuinely didn't land), or
    //   • an explicit complaint phrase ("still waiting", "زهقت").
    // Weak hints (shouting, "???") never fire alone; two of them together do.
    let friction = null;
    try {
      const msgs = await req.repo.list("chat_messages", { where: { session_id: sid }, order: "created_at", desc: true, limit: 40 });
      const guest = msgs.filter((m) => m.sender === "guest").reverse();
      const flat = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

      // A repeat only counts if it's a real question, not "yes"/"ok"/"tamam" — short
      // confirmations repeat constantly in a normal ordering flow.
      const counts = {};
      for (const m of guest) {
        const k = flat(m.message);
        if (k.length >= 12 && k.split(" ").length >= 3) counts[k] = (counts[k] || 0) + 1;
      }
      const repeated = Object.entries(counts).filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([text, times]) => ({ text: text.slice(0, 120), times }));

      const recent = guest.slice(-8).map((m) => String(m.message || ""));
      const joined = recent.join(" ");

      // Phrases, not single words: bare "why" appears in perfectly happy questions
      // ("why is it called that?"), and matching it was a large part of the noise.
      const COMPLAINT_LATIN = /(still waiting|no ?one (is|has)|nobody (is|has)|not working|doesn'?t work|use ?less|ridiculous|unacceptable|third time|again and again|forget it|very slow|too slow|mesh fahem|ma7adesh|zeh?[ea]t)/i;
      const COMPLAINT_ARABIC = /(زهقت|مش فاهم|مفيش حد|لسه مستني|مش راضي|ايه المشكلة|بقالي ساعة|مش بيرد)/;
      const strongWording = COMPLAINT_LATIN.test(joined) || COMPLAINT_ARABIC.test(joined);

      const weak = [];
      if (/\?{3,}/.test(joined)) weak.push("repeated question marks");
      // count letters, not a consecutive run — "WHERE IS MY ORDER" has no 6-letter run
      if (recent.some((t) => t === t.toUpperCase() && t.replace(/[^A-Za-z]/g, "").length >= 6)) weak.push("shouting in capitals");

      const strong = repeated.length > 0 || strongWording;
      if (strong || weak.length >= 2) {
        const signals = [...(strongWording ? ["said something's wrong"] : []), ...weak];
        friction = {
          looping: repeated.length > 0,
          repeated,
          signals,
          summary: repeated.length
            ? `Asked the same thing ${repeated[0].times}× — the answer isn't landing.`
            : "Sounds unhappy.",
        };
      }
    } catch {}

    // Have they complained before? Walking into a conversation blind to that is how a
    // second bad experience happens.
    let feedback = null;
    try {
      const fb = (await req.repo.list("feedback", { where: { phone_number: sid }, order: "created_at", desc: true, limit: 10 }));
      if (fb.length) {
        const rated = fb.filter((f) => f.rating != null);
        feedback = {
          count: fb.length,
          avg_rating: rated.length ? Math.round((rated.reduce((s, f) => s + Number(f.rating), 0) / rated.length) * 10) / 10 : null,
          last: { rating: fb[0].rating ?? null, comment: fb[0].comments || fb[0].comment || null, at: fb[0].created_at },
        };
      }
    } catch {}
    const prefs = diner?.preferences || {};
    if (prefs.pending_order?.items?.length) {
      const p = prefs.pending_order;
      // Structured, not a joined string. Staff need to see the actual basket — line by
      // line, with the options the guest picked and what each line costs — plus WHY it
      // has stopped moving. "1× Milkshake" as prose can't tell you the guest has been
      // sitting on an unanswered size question for twelve minutes.
      const items = p.items.map((i) => ({
        name: i.name,
        qty: Number(i.qty) || 1,
        unit_price: unitPrice(i),
        line_total: Math.round(unitPrice(i) * (Number(i.qty) || 1) * 100) / 100,
        options: Object.entries(i.options || {})
          .map(([k, v]) => ({ group: k, choice: Array.isArray(v) ? v.join(", ") : String(v) }))
          .filter((o) => o.choice && o.choice !== "undefined"),
        notes: i.notes || null,
        // an option group with no choice yet is exactly what the bot is waiting on
        missing_options: (i.option_defs || [])
          .filter((g) => g.required !== false && !(i.options || {})[g.key])
          .map((g) => g.label || g.key),
      }));
      const subtotal = Math.round(items.reduce((s, i) => s + i.line_total, 0) * 100) / 100;

      // What still stands between this basket and a real order, in the order the bot asks.
      const blockers = [];
      if (p.ambiguous?.length) blockers.push(`which item they meant: “${p.ambiguous[0].said}”`);
      for (const i of items) for (const g of i.missing_options) blockers.push(`${g} for ${i.name}`);
      if (!p.order_type) blockers.push("dine-in, pickup or delivery");
      if (p.order_type === "delivery" && !p.address) blockers.push("a delivery address");
      if (p.order_type === "dine_in" && !p.table_number) blockers.push("a table number");
      if (!p.payment_method) blockers.push("a payment method");

      draft = {
        items,
        summary: p.items.map((i) => `${i.qty}× ${i.name}`).join(", "),
        subtotal,
        delivery_fee: p.delivery_fee ?? null,
        order_type: p.order_type || null,
        branch: p.branch || null,
        address: p.address || null,
        table_number: p.table_number || null,
        payment_method: p.payment_method || null,
        stage: p.awaiting_confirm ? "awaiting confirmation" : p.awaiting_option ? "choosing options" : p.payment_method ? "confirming" : "building",
        blockers,
        at: p.at || null,
        stalled_min: p.at ? Math.round((Date.now() - new Date(p.at).getTime()) / 60000) : null,
        nudged_at: p.recovery_nudged_at || null,
      };

      // ---- guards: what staff should know BEFORE this basket becomes a real order.
      // Each is computed from data already on file; none of them guesses.
      try {
        const menu = await cachedMenu(req);
        const byName = new Map(menu.map((m) => [norm(m.name), m]));
        const allergies = (diner?.allergies || []).filter(Boolean);
        const allergy_flags = [], stock_flags = [];
        const inCart = new Set(items.map((i) => norm(i.name)));
        // This restaurant only "does stock" once somebody actually puts a count on an
        // item. Until then every stock/sold-out warning is noise about a feature they
        // don't use — so the whole guard stays silent and switches itself on the day
        // the first stock_count is entered. No code change needed to enable it.
        const stockTracked = menu.some((m) => m.stock_count != null);

        for (const line of items) {
          const m = byName.get(norm(line.name));
          if (!m) continue;
          const haystack = norm(`${m.name} ${m.ingredients || ""} ${m.ingredients_ar || ""} ${m.description || ""}`);
          for (const allergy of allergies) {
            const hit = allergenTokens(allergy).find((t) => t.length > 2 && haystack.includes(t));
            if (hit) allergy_flags.push({ item: line.name, allergy, matched_on: hit });
          }
          if (!stockTracked) continue;
          const soldOut = m.available === false || (m.sold_out_until && new Date(m.sold_out_until) > new Date());
          if (soldOut) stock_flags.push({ item: line.name, wanted: line.qty, left: 0, reason: "marked sold out" });
          else if (m.stock_count != null && Number(m.stock_count) < line.qty)
            stock_flags.push({ item: line.name, wanted: line.qty, left: Number(m.stock_count), reason: "not enough left" });
        }

        // pairs_with is filled in on the menu and has never been surfaced anywhere
        const pairing = [];
        for (const line of items) {
          const m = byName.get(norm(line.name));
          for (const raw of m?.pairs_with || []) {
            const name = typeof raw === "string" ? raw : raw?.name;
            const pm = byName.get(norm(name));
            if (!name || inCart.has(norm(name)) || pairing.some((x) => norm(x.name) === norm(name))) continue;
            if (pm && (pm.available === false)) continue;
            pairing.push({ name, price: pm ? Number(pm.price) : null, goes_with: line.name });
          }
        }

        // a second identical basket minutes after the first is usually a double-tap
        const recent = (await req.repo.list("orders", { where: { phone_number: sid }, order: "created_at", desc: true, limit: 5 }))
          .filter((o) => o.status !== "cancelled" && Date.now() - new Date(o.created_at).getTime() < 45 * 60000);
        const cartKey = [...inCart].sort().join("|");
        const dup = recent.find((o) => [...new Set((o.items || []).map((i) => norm(i.name)))].sort().join("|") === cartKey);

        draft.guards = {
          allergy_flags,
          allergy_checked: allergies.length > 0,
          stock_flags,
          pairing: pairing.slice(0, 3),
          closed_now: openNow(req.restaurant?.hours, req.restaurant?.basic_info?.timezone) === false,
          duplicate_of: dup ? { code: dup.code, minutes_ago: Math.round((Date.now() - new Date(dup.created_at).getTime()) / 60000) } : null,
        };
      } catch { draft.guards = null; }
    }
    res.json({
      session: sessions[0] || null,
      diner,
      upcoming_reservation: upcoming,
      summary,
      orders,
      order_stats: { count: orders.length ? undefined : 0, lifetime_egp: Math.round(lifetime), usual },
      profile,
      feedback,
      friction,
      saved_addresses: (prefs.addresses || []).map((a) => ({ text: a.text, last_used: a.last_used || null })),
      draft,
    });
  } catch (e) { next(e); }
});

router.get("/sessions/:sessionId/messages", async (req, res, next) => {
  try {
    const rows = await req.repo.list("chat_messages", {
      where: { session_id: req.params.sessionId },
      order: "created_at",
      desc: false,
    });
    res.json(rows);
  } catch (e) { next(e); }
});

// Staff reply: logged to the thread, then relayed to the flows service which delivers
// to the guest's channel (WhatsApp/IG) and enters it into the AI's history.
router.post("/sessions/:sessionId/messages", async (req, res, next) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "message required" });
    const row = await req.repo.insert("chat_messages", {
      session_id: req.params.sessionId,
      sender: "staff",
      message,
      status: "sent",
      wa_message_id: `staff-${Date.now()}`,
    });
    const sessions = await req.repo.list("chat_sessions", { where: { session_id: req.params.sessionId } });
    if (sessions[0])
      await req.repo.update("chat_sessions", sessions[0].id, {
        last_message: message,
        last_message_at: new Date().toISOString(),
        needs_attention: false,
        ai_enabled: false, // staff replied → auto-takeover so two voices never talk over each other
      });

    let delivery = { delivered: false, reason: "FLOWS_URL not set (demo mode)" };
    if (FLOWS_URL) {
      try {
        const r = await fetch(`${FLOWS_URL}/api/staff/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(FLOWS_OPS_TOKEN ? { "x-ops-token": FLOWS_OPS_TOKEN } : {}) },
          body: JSON.stringify({ sessionId: req.params.sessionId, message }),
        });
        delivery = r.ok ? await r.json() : { delivered: false, reason: `flows ${r.status}` };
      } catch (e) {
        delivery = { delivered: false, reason: e.message };
        log("staff reply relay failed:", e.message);
      }
    }
    res.status(201).json({ ...row, delivery });
  } catch (e) { next(e); }
});

// Staff quality signal on AI replies (👍=1 / 👎=-1, 0 clears) — feeds prompt fixes + metrics
router.post("/messages/:id/rate", async (req, res, next) => {
  try {
    const rating = Number(req.body?.rating);
    if (![1, -1, 0].includes(rating)) return res.status(400).json({ error: "rating must be 1, -1 or 0" });
    const row = await req.repo.update("chat_messages", req.params.id, { rating: rating === 0 ? null : rating });
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

// Full guest reset — wipes EVERYTHING about this number (chats, memory, orders,
// reservations, waitlist, feedback, notifications) so it becomes a brand-new guest.
// Testing/demo tool; destructive by design.
router.delete("/sessions/:sessionId/reset", async (req, res, next) => {
  try {
    const sid = req.params.sessionId;
    const TARGETS = [
      ["chat_messages", "session_id"], ["chat_sessions", "session_id"],
      ["message_full", "phone_number"], ["temp_reservation", "phone_number"],
      ["diners", "phone_number"], ["waitlist", "phone_number"], ["feedback", "phone_number"],
      ["orders", "phone_number"], ["reservations", "diner_phone"], ["notifications", "ref_id"],
    ];
    const wiped = {};
    const failed = [];
    for (const [table, col] of TARGETS) {
      try {
        if (req.tenantClient) {
          // delete BY THE NATURAL COLUMN — message_full/temp_reservation are keyed by
          // phone_number and have no id, so an id-based delete silently leaves memory behind
          const { data, error } = await req.tenantClient.from(table).delete().eq(col, sid).select("*");
          if (error) throw new Error(error.message);
          wiped[table] = (data || []).length;
        } else {
          const rows = await req.repo.list(table, { where: { [col]: sid } });
          for (const r of rows) await req.repo.remove(table, r.id);
          wiped[table] = rows.length;
        }
      } catch (e) {
        wiped[table] = `FAILED: ${e.message}`;
        failed.push(table);
      }
    }
    res.json({ ok: failed.length === 0, wiped, failed });
  } catch (e) { next(e); }
});

// Toggle AI per conversation (handoff / hand-back)
router.patch("/sessions/:id", async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ["ai_enabled", "needs_attention", "status", "handoff_reason"])
      if (k in req.body) patch[k] = req.body[k];
    const row = await req.repo.update("chat_sessions", req.params.id, patch);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

export default router;
