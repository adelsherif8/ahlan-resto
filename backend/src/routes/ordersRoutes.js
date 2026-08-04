import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";
import { FLOWS_URL, FLOWS_OPS_TOKEN, log } from "../config/env.js";

const router = Router();
router.use(requireAuth, restaurantContext);

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
    const { items, order_type, branch, table_number, payment_method, diner_name, phone_number, notes, address } = req.body || {};
    if (!Array.isArray(items) || !items.length || !order_type)
      return res.status(400).json({ error: "items and order_type required" });
    const p = req.restaurant?.payments || {};
    const round = (n) => Math.round(n * 100) / 100;
    const rateOf = (...keys) => { for (const k of keys) { const v = Number(p[k]); if (Number.isFinite(v) && v > 0) return v > 1 ? v / 100 : v; } return 0; };
    const subtotal = round(items.reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 1), 0));
    const service_charge = order_type === "dine_in" ? round(subtotal * rateOf("service_charge", "service_charge_pct")) : 0;
    const tax = round(subtotal * rateOf("tax", "tax_pct", "vat_pct"));
    const delivery_fee = order_type === "delivery" ? round(Number(p.delivery_fee) || 0) : 0;
    const total = round(subtotal + service_charge + tax + delivery_fee);
    // SAME alphabet as flows/order.js CODE_ALPHABET — no I/L/O/U confusables
    const AB = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
    const code = "O-" + Array.from({ length: 4 }, () => AB[Math.floor(Math.random() * AB.length)]).join("");
    const row = await req.repo.insert("orders", {
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
      payment_method: payment_method || null,
      status: "pending", payment_status: "unpaid",
      address: order_type === "delivery" ? address || null : null,
      notes: notes || null,
    });
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
