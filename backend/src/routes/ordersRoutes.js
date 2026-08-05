import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";
import { FLOWS_URL, FLOWS_OPS_TOKEN, log } from "../config/env.js";

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
    const rows = await req.repo.list("orders", { where, order: "created_at" });
    // test-suite orders never reach the kitchen board (same rule as the chat inbox)
    const isTest = (v) => /^web:(regress|convo|test)-/i.test(String(v || ""));
    res.json(rows.filter((r) => !isTest(r.phone_number) && !isTest(r.diner_name) && !isTest(r.session_id)));
  } catch (e) { next(e); }
});

// Staff-created order (phone orders / walk-ups) — the KDS is the ONE board for
// every order, not just WhatsApp ones. Bill rules identical to the bot's.
router.post("/", async (req, res, next) => {
  try {
    const { items, order_type, branch, table_number, payment_method, diner_name, phone_number, notes, address, discount, discount_reason, tip, cashier, payments } = req.body || {};
    if (!Array.isArray(items) || !items.length || !order_type)
      return res.status(400).json({ error: "items and order_type required" });
    const p = req.restaurant?.payments || {};
    const round = (n) => Math.round(n * 100) / 100;
    const rateOf = (...keys) => { for (const k of keys) { const v = Number(p[k]); if (Number.isFinite(v) && v > 0) return v > 1 ? v / 100 : v; } return 0; };
    const subtotal = round(items.reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 1), 0));
    const service_charge = order_type === "dine_in" ? round(subtotal * rateOf("service_charge", "service_charge_pct")) : 0;
    const tax = round(subtotal * rateOf("tax", "tax_pct", "vat_pct"));
    const delivery_fee = order_type === "delivery" ? round(Number(p.delivery_fee) || 0) : 0;
    // discount applies to the subtotal before charges, clamped so the bill can
    // never go negative; the tip rides separately and never changes the total
    const disc = Math.min(Math.max(round(Number(discount) || 0), 0), subtotal);
    const total = round(subtotal - disc + service_charge + tax + delivery_fee);
    // split payments must add up to the bill — reject silent mismatches
    const pays = Array.isArray(payments)
      ? payments.map((x) => ({ method: String(x.method || "cash"), amount: round(Number(x.amount) || 0) })).filter((x) => x.amount > 0)
      : null;
    if (pays && pays.length && Math.abs(pays.reduce((s2, x) => s2 + x.amount, 0) - total) > 0.5)
      return res.status(400).json({ error: "split payments must add up to the total" });
    // SAME alphabet as flows/order.js CODE_ALPHABET — no I/L/O/U confusables
    const AB = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
    const code = "O-" + Array.from({ length: 4 }, () => AB[Math.floor(Math.random() * AB.length)]).join("");
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
        });
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
    for (const k of ["status", "payment_status", "notes", "table_number", "courier_name", "courier_phone"])
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
