import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";
import { FLOWS_URL, FLOWS_OPS_TOKEN, log } from "../config/env.js";

// The kitchen is where an allergy actually matters — the person holding the pan. The Chats
// panel warns whoever is TALKING to the guest; nothing warned whoever was COOKING.
//
// This runs on a 5-second poll, so both lookups are cached per restaurant: the menu and the
// guests' allergy lists change on human timescales, not per request.
const cache = new Map();   // restaurantId -> { at, menu, allergies }
const CACHE_TTL_MS = 60_000;

const ALLERGEN_HINTS = {
  nut: ["nut", "peanut", "almond", "cashew", "hazelnut", "pistachio", "walnut", "pecan", "nutella", "praline", "مكسرات", "فستق", "لوز", "بندق", "سوداني"],
  dairy: ["milk", "cheese", "cream", "butter", "yoghurt", "yogurt", "labneh", "ghee", "mozzarella", "cheddar", "لبن", "جبن", "جبنة", "كريمة", "زبدة", "حليب"],
  gluten: ["wheat", "flour", "bread", "bun", "pasta", "dough", "breadcrumb", "crouton", "batter", "قمح", "دقيق", "خبز", "عيش", "مكرونة"],
  egg: ["egg", "mayo", "mayonnaise", "aioli", "meringue", "بيض", "مايونيز"],
  shellfish: ["shrimp", "prawn", "crab", "lobster", "calamari", "squid", "جمبري", "استاكوزا", "كابوريا"],
  fish: ["fish", "tuna", "salmon", "anchovy", "سمك", "تونة", "سلمون"],
  sesame: ["sesame", "tahini", "tahina", "halva", "سمسم", "طحينة", "حلاوة"],
  soy: ["soy", "soya", "tofu", "edamame", "صويا", "توفو"],
  mushroom: ["mushroom", "truffle", "مشروم"],
};
const norm = (v) => String(v || "").trim().toLowerCase();

function allergenTokens(allergy) {
  const a = norm(allergy);
  if (!a) return [];
  const out = new Set([a]);
  for (const [key, words] of Object.entries(ALLERGEN_HINTS))
    if (a.includes(key) || words.some((w) => a.includes(w))) words.forEach((w) => out.add(w));
  return [...out];
}

async function allergyContext(req) {
  const key = req.restaurant?.id || "default";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  const [menu, diners] = await Promise.all([
    req.repo.list("menu_items").catch(() => []),
    req.repo.list("diners").catch(() => []),
  ]);
  const entry = {
    at: Date.now(),
    menu: new Map(menu.map((m) => [norm(m.name), m])),
    allergies: new Map(diners.filter((d) => d.allergies?.length).map((d) => [d.phone_number, d.allergies])),
  };
  cache.set(key, entry);
  return entry;
}

// A hit means "check before you cook this", never "this is safe" — ingredient lists are
// free text somebody typed, so silence proves nothing.
function flagAllergies(order, ctx) {
  const allergies = ctx.allergies.get(order.phone_number);
  if (!allergies?.length) return null;
  const flags = [];
  for (const it of order.items || []) {
    const m = ctx.menu.get(norm(it.name));
    const hay = norm(`${it.name} ${m?.ingredients || ""} ${m?.ingredients_ar || ""} ${m?.description || ""}`);
    for (const a of allergies) {
      const hitTok = allergenTokens(a).find((t) => t.length > 2 && hay.includes(t));
      if (hitTok) flags.push({ item: it.name, allergy: a });
    }
  }
  return { list: allergies, flags };
}

const router = Router();
router.use(requireAuth, restaurantContext);

// POS conversational entry — proxied to flows so the POS shares the bot's brain
router.post("/pos-extract", async (req, res) => {
  try {
    if (!FLOWS_URL) return res.status(503).json({ error: "flows not configured" });
    const r = await fetch(`${FLOWS_URL}/api/ops/pos-extract`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ops-token": FLOWS_OPS_TOKEN },
      body: JSON.stringify({ text: String(req.body?.text || "") }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    // branch scoping: staff locked to their branch; managers may filter via ?branch=
    const branch = req.user?.branch || (req.query.branch && req.query.branch !== "all" ? req.query.branch : null);
    if (branch) where.branch = branch;
    // The kitchen board polls this every 5 seconds and is deliberately never hidden, so
    // "every order ever" is the most expensive query in the product. Callers say how far
    // back they need; open tickets are always included whatever their age, so a ticket
    // carried over from Saturday never disappears off the board.
    const days = Number(req.query.since_days) || 0;
    let rows;
    if (days > 0 && req.tenantClient) {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const base = () => {
        let q = req.tenantClient.from("orders").select("*");
        for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
        return q;
      };
      const [recent, open] = await Promise.all([
        base().gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
        base().in("status", ["pending", "accepted", "preparing", "ready", "out_for_delivery", "dispatched"])
          .order("created_at", { ascending: false }).limit(500),
      ]);
      const seen = new Set();
      rows = [...(recent.data || []), ...(open.data || [])].filter((o) => {
        if (seen.has(o.id)) return false;
        seen.add(o.id); return true;
      });
    } else {
      rows = await req.repo.list("orders", { where, order: "created_at" });
    }
    // test-suite orders never reach the kitchen board (same rule as the chat inbox)
    const isTest = (v) => /^web:(regress|convo|test)-/i.test(String(v || ""));
    const clean = rows.filter((r) => !isTest(r.phone_number) && !isTest(r.diner_name) && !isTest(r.session_id));

    // the ticket the kitchen reads carries the guest's allergies with it
    let ctx = null;
    try { ctx = await allergyContext(req); } catch {}
    res.json(ctx ? clean.map((o) => {
      const a = flagAllergies(o, ctx);
      return a ? { ...o, guest_allergies: a.list, allergy_flags: a.flags } : o;
    }) : clean);
  } catch (e) { next(e); }
});

// Staff-created order (phone orders / walk-ups) — the KDS is the ONE board for
// every order, not just WhatsApp ones. Bill rules identical to the bot's.
router.post("/", async (req, res, next) => {
  try {
    const { items, order_type, branch, table_number, payment_method, diner_name, phone_number, notes, address, discount, discount_reason, tip, cashier, payments, email } = req.body || {};
    if (!Array.isArray(items) || !items.length || !order_type)
      return res.status(400).json({ error: "items and order_type required" });
    const p = req.restaurant?.payments || {};
    const round = (n) => Math.round(n * 100) / 100;
    const rateOf = (...keys) => { for (const k of keys) { const v = Number(p[k]); if (Number.isFinite(v) && v > 0) return v > 1 ? v / 100 : v; } return 0; };
    const subtotal = round(items.reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 1), 0));

    // VAT is INCLUSIVE — the same model the bot uses (flows priceOrder). Menu prices
    // already contain it, so it is EXTRACTED from the total for the receipt, never added
    // on top. This till used to add it, which meant an identical cart cost ~14% more at
    // the counter than the same order placed on WhatsApp.
    //
    // Discount comes off the goods FIRST, and the charges follow the discounted amount —
    // otherwise a fully comped meal still billed service and tax on food given away.
    const disc = Math.min(Math.max(round(Number(discount) || 0), 0), subtotal);
    const goods = round(subtotal - disc);
    const service_charge = order_type === "dine_in" ? round(goods * rateOf("service_charge", "service_charge_pct")) : 0;
    const delivery_fee = order_type === "delivery" ? round(Number(p.delivery_fee) || 0) : 0;
    const total = round(goods + service_charge + delivery_fee);
    const rate = rateOf("tax", "tax_pct", "vat_pct");
    const tax = rate > 0 ? round(total - total / (1 + rate)) : 0;   // breakdown, already inside `total`
    // split payments must add up to the bill — reject silent mismatches
    const pays = Array.isArray(payments)
      ? payments.map((x) => ({ method: String(x.method || "cash"), amount: round(Number(x.amount) || 0) })).filter((x) => x.amount > 0)
      : null;
    if (pays && pays.length && Math.abs(pays.reduce((s2, x) => s2 + x.amount, 0) - total) > 0.5)
      return res.status(400).json({ error: "split payments must add up to the total" });
    // SAME alphabet as flows/order.js CODE_ALPHABET — no I/L/O/U confusables
    const AB = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
    let code = "O-" + Array.from({ length: 4 }, () => AB[Math.floor(Math.random() * AB.length)]).join("");
    // Settings → POS can brand the code with a daily-resetting sequence (JS-041)
    const oc = req.restaurant?.pos?.order_code || {};
    if (oc.mode === "daily") {
      try {
        const todayStr = new Date().toLocaleDateString("en-CA");
        const all = await req.repo.list("orders", { order: "created_at" });
        const n = all.filter((o) => String(o.created_at).slice(0, 10) === todayStr).length + 1;
        const prefix = String(oc.prefix || "O").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "O";
        code = `${prefix}-${String(n).padStart(3, "0")}`;
      } catch { /* random code still works */ }
    }
    const posExtras = {
      ...(disc > 0 ? { discount: disc, discount_reason: discount_reason || null } : {}),
      ...(Number(tip) > 0 ? { tip: round(Number(tip)) } : {}),
      ...(cashier ? { cashier: String(cashier).slice(0, 60) } : {}),
      ...(pays && pays.length > 1 ? { payments: pays } : {}),
    };
    const baseRow = {
      code,
      phone_number: phone_number || `walkin:${Date.now()}`,
      diner_name: diner_name || null,
      order_type, table_number: table_number || null, branch: branch || null,
      items: items.map((i) => ({
        name: i.name, qty: Number(i.qty) || 1,
        unit_price: Number(i.price) || 0, price: Number(i.price) || 0,
        ...(i.options && Object.keys(i.options).length ? { options: i.options } : {}),
        ...(i.notes ? { notes: i.notes } : {}),
      })),
      subtotal, service_charge, tax, total, delivery_fee,
      payment_method: pays && pays.length > 1 ? "split" : (payment_method || null),
      status: "pending", payment_status: "unpaid",
      address: order_type === "delivery" ? address || null : null,
      notes: notes || null,
    };
    // pre-migration-018 tolerance: never let a missing column kill an order —
    // retry the bare row so the kitchen always gets its ticket
    let row;
    try {
      row = await req.repo.insert("orders", { ...baseRow, ...posExtras });
    } catch (err) {
      if (!Object.keys(posExtras).length) throw err;
      log("orders insert w/ POS extras failed (migration 018 pending?):", err.message);
      row = await req.repo.insert("orders", baseRow);
    }
    // delivery orders leave with a rider decided and a driver link minted
    if (order_type === "delivery") {
      try { await assignAndLink(req.repo, row); } catch { /* assignment never blocks the ticket */ }
    }

    // the bell + any open board hears about manual orders too, same as bot ones
    try {
      await req.repo.insert("notifications", {
        type: "order", title: `New ${order_type.replace("_", "-")} order ${code}`,
        body: `${items.length} item${items.length > 1 ? "s" : ""} · EGP ${total}${cashier ? ` · by ${cashier}` : " · POS"}`,
        ref_id: code, ...(branch ? { branch } : {}),
      });
    } catch { /* notifications are never worth failing an order over */ }

    // inventory countdown: tracked items burn stock; at zero the item 86es
    // itself everywhere (POS grid, bot menu, Menu page) — one source of truth
    try {
      for (const it of items) {
        const [mi] = await req.repo.list("menu_items", { where: { name: it.name }, limit: 1 });
        if (mi && mi.stock_count != null) {
          const left = Math.max(0, Number(mi.stock_count) - (Number(it.qty) || 1));
          await req.repo.update("menu_items", mi.id, { stock_count: left, ...(left === 0 ? { available: false } : {}) });
        }
      }
    } catch { /* pre-019 schema or lookup miss — never blocks the ticket */ }

    // a POS order for a known guest moves their CRM numbers, same as a bot order
    if (phone_number) {
      try {
        const [d] = await req.repo.list("diners", { where: { phone_number }, limit: 1 });
        if (d) await req.repo.update("diners", d.id, {
          total_spend: Math.round(((Number(d.total_spend) || 0) + total) * 100) / 100,
          visit_count: (Number(d.visit_count) || 0) + 1,
          last_visit_at: new Date().toISOString(),
          ...(email ? { preferences: { ...(d.preferences || {}), email: String(email).slice(0, 120) } } : {}),
        });
        else if (email || diner_name) await req.repo.insert("diners", {
          phone_number, name: diner_name || null,
          preferences: email ? { email: String(email).slice(0, 120) } : {},
          visit_count: 1, total_spend: total, last_visit_at: new Date().toISOString(),
        }).catch(() => {});
      } catch { /* CRM bump is best-effort */ }
    }
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// X (mid-shift) / Z (end-of-day) report — one honest aggregation of the day's
// money: payment methods, discounts, tips, voids, VAT, per-cashier breakdown
router.get("/shift-report", async (req, res, next) => {
  try {
    const date = String(req.query.date || new Date().toLocaleDateString("en-CA"));
    const branch = req.user?.branch || (req.query.branch && req.query.branch !== "all" ? req.query.branch : null);
    const where = {};
    if (branch) where.branch = branch;
    const rows = (await req.repo.list("orders", { where, order: "created_at" }))
      .filter((o) => String(o.created_at).slice(0, 10) === date)
      .filter((o) => !/^web:(regress|convo|test)-/i.test(String(o.phone_number || "")));
    const live = rows.filter((o) => o.status !== "cancelled");
    const cancelled = rows.filter((o) => o.status === "cancelled");
    const round = (n) => Math.round(n * 100) / 100;
    const sum = (xs, f) => round(xs.reduce((s2, o) => s2 + (Number(f(o)) || 0), 0));
    const byMethod = {};
    for (const o of live) {
      const parts = Array.isArray(o.payments) && o.payments.length ? o.payments : [{ method: o.payment_method || "unset", amount: Number(o.total) || 0 }];
      for (const x of parts) byMethod[x.method] = round((byMethod[x.method] || 0) + (Number(x.amount) || 0));
    }
    const byCashier = {};
    for (const o of live) {
      const k = o.cashier || "AI / WhatsApp";
      byCashier[k] = byCashier[k] || { orders: 0, revenue: 0, discounts: 0, tips: 0 };
      byCashier[k].orders += 1;
      byCashier[k].revenue = round(byCashier[k].revenue + (Number(o.total) || 0));
      byCashier[k].discounts = round(byCashier[k].discounts + (Number(o.discount) || 0));
      byCashier[k].tips = round(byCashier[k].tips + (Number(o.tip) || 0));
    }
    res.json({
      date, branch: branch || "all",
      orders: live.length,
      revenue: sum(live, (o) => o.total),
      subtotal: sum(live, (o) => o.subtotal),
      vat: sum(live, (o) => o.tax),
      service_charge: sum(live, (o) => o.service_charge),
      delivery_fees: sum(live, (o) => o.delivery_fee),
      discounts: sum(live, (o) => o.discount),
      tips: sum(live, (o) => o.tip),
      by_method: byMethod,
      by_cashier: byCashier,
      cancelled: { count: cancelled.length, value: sum(cancelled, (o) => o.total), reasons: cancelled.map((o) => ({ code: o.code, reason: o.cancel_reason || null })) },
      cash_expected: byMethod.cash || 0,
    });
  } catch (e) { next(e); }
});

// ---- courier smart assignment ----
// Free riders first; a new drop within ~2.5 km of a rider's current open drop
// batches onto the SAME rider (one trip, two doors). Ties go to whoever has
// carried the least today. Pure code — no guessing.
const kmBetween = (a, b, c, d) => {
  const R = 6371, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(c - a), dLng = toR(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
async function smartAssign(repo, order) {
  const couriers = (await repo.list("couriers", {})).filter(
    (c) => c.active !== false && (!c.branch || !order.branch || c.branch === order.branch)
  );
  if (!couriers.length) return null;
  const all = await repo.list("orders", { order: "created_at" });
  const open = all.filter((o) => o.order_type === "delivery" && o.courier_id &&
    !["delivered", "cancelled", "served", "paid"].includes(o.status) && o.id !== order.id);
  // batch nearby drops onto the rider already going that way
  if (order.lat && order.lng) {
    for (const o of open) {
      if (o.lat && o.lng && kmBetween(Number(order.lat), Number(order.lng), Number(o.lat), Number(o.lng)) <= 2.5) {
        const c = couriers.find((x) => x.id === o.courier_id);
        if (c) return c;
      }
    }
  }
  const busy = new Set(open.map((o) => o.courier_id));
  const today = new Date().toLocaleDateString("en-CA");
  const carriedToday = (cid) => all.filter((o) => o.courier_id === cid && String(o.created_at).slice(0, 10) === today).length;
  const pool = couriers.filter((c) => !busy.has(c.id));
  const pick = (pool.length ? pool : couriers).sort((a, b) => carriedToday(a.id) - carriedToday(b.id))[0];
  return pick || null;
}
const TOKEN_AB = "abcdefghijkmnpqrstuvwxyz23456789";
const courierToken = () => Array.from({ length: 22 }, () => TOKEN_AB[Math.floor(Math.random() * 32)]).join("");
async function assignAndLink(repo, row) {
  const patch = {};
  if (!row.courier_token) patch.courier_token = courierToken();
  const c = await smartAssign(repo, row);
  if (c) { patch.courier_id = c.id; patch.courier_name = c.name; patch.courier_phone = c.phone_number || null; }
  if (Object.keys(patch).length) {
    try { await repo.update("orders", row.id, patch); } catch { /* pre-migration schema */ }
  }
  return c;
}

// manual (re)assign — {courier_id} to pin a rider, empty body to re-run auto
router.post("/:id/assign", async (req, res, next) => {
  try {
    const [row] = await req.repo.list("orders", { where: { id: req.params.id }, limit: 1 });
    if (!row) return res.status(404).json({ error: "order not found" });
    if (req.body?.courier_id) {
      const [c] = await req.repo.list("couriers", { where: { id: req.body.courier_id }, limit: 1 });
      if (!c) return res.status(404).json({ error: "courier not found" });
      const updated = await req.repo.update("orders", row.id, {
        courier_id: c.id, courier_name: c.name, courier_phone: c.phone_number || null,
        ...(row.courier_token ? {} : { courier_token: courierToken() }),
      });
      return res.json(updated);
    }
    const c = await assignAndLink(req.repo, row);
    const [fresh] = await req.repo.list("orders", { where: { id: row.id }, limit: 1 });
    res.json({ ...fresh, auto_assigned: c ? c.name : null });
  } catch (e) { next(e); }
});

// tell the guest their order moved (fire-and-forget; never blocks the kitchen)
async function pushStatus(code, status) {
  if (!FLOWS_URL || !code) return;
  try {
    await fetch(`${FLOWS_URL}/api/order/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(FLOWS_OPS_TOKEN ? { "x-ops-token": FLOWS_OPS_TOKEN } : {}) },
      body: JSON.stringify({ code, status }),
    });
  } catch (e) { log("order status push failed:", e.message); }
}

// each transition gets its own timestamp — real prep/wait metrics need more
// than a single updated_at
const STAMP = { preparing: "started_at", ready: "ready_at", served: "served_at", out_for_delivery: "out_at", delivered: "delivered_at" };

router.patch("/:id", async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ["status", "payment_status", "notes", "table_number", "courier_name", "courier_phone", "courier_id", "items"])
      if (k in req.body) patch[k] = req.body[k];
    if (patch.status && STAMP[patch.status]) patch[STAMP[patch.status]] = new Date().toISOString();
    if (patch.status === "cancelled" && req.body.cancel_reason) patch.cancel_reason = String(req.body.cancel_reason).slice(0, 120);
    const before = patch.status ? await req.repo.get("orders", req.params.id) : null;
    // COD is collected at the door — delivered means paid for cash orders
    if (patch.status === "delivered" && before?.payment_method === "cash") patch.payment_status = "paid";
    // status RANK: moving backwards = an undo. Re-arm guest notifications so the
    // real transition still pushes, and never push the backwards move itself.
    const RANK = { pending: 0, accepted: 0, preparing: 1, ready: 2, out_for_delivery: 3, served: 4, delivered: 4, paid: 4, cancelled: 9 };
    const movingBack = patch.status && before && (RANK[patch.status] ?? 0) < (RANK[before.status] ?? 0) && patch.status !== "cancelled";
    if (movingBack) patch.notified_status = null;
    let row;
    try {
      row = await req.repo.update("orders", req.params.id, patch);
    } catch (err) {
      // migrations 010/012 not run yet — drop the stamp columns, fold the reason into notes
      const { started_at: _s, ready_at: _r, served_at: _v, out_at: _o, delivered_at: _d, cancel_reason, ...bare } = patch;
      if (cancel_reason) bare.notes = [before?.notes, `cancelled: ${cancel_reason}`].filter(Boolean).join(" · ");
      row = await req.repo.update("orders", req.params.id, bare);
    }
    if (!row) return res.status(404).json({ error: "Not found" });
    // kitchen cancelled it → reverse the CRM bump the placement made;
    // un-cancelling (Undo) restores it — a mis-tap must not cost the guest's history
    const crmDelta = patch.status === "cancelled" && before && before.status !== "cancelled" ? -1
      : patch.status && patch.status !== "cancelled" && before?.status === "cancelled" ? 1 : 0;
    if (crmDelta !== 0 && row.phone_number) {
      try {
        const [d] = await req.repo.list("diners", { where: { phone_number: row.phone_number }, limit: 1 });
        if (d) await req.repo.update("diners", d.id, {
          total_spend: Math.max(0, Math.round(((Number(d.total_spend) || 0) + crmDelta * Number(row.total || 0)) * 100) / 100),
          visit_count: Math.max(0, (Number(d.visit_count) || 0) + crmDelta),
        });
      } catch (err) { log("diner CRM adjust on status change failed:", err.message); }
    }
    if (patch.status && !movingBack) pushStatus(row.code, patch.status); // guest gets the update (never for undos)
    res.json(row);
  } catch (e) { next(e); }
});

export default router;
