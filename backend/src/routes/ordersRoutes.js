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
    const code = "O-" + Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
    const row = await req.repo.insert("orders", {
      code,
      phone_number: phone_number || `walkin:${Date.now()}`,
      diner_name: diner_name || null,
      order_type, table_number: table_number || null, branch: branch || null,
      items: items.map((i) => ({ name: i.name, qty: Number(i.qty) || 1, unit_price: Number(i.price) || 0, price: Number(i.price) || 0 })),
      subtotal, service_charge, tax, total,
      payment_method: payment_method || null,
      status: "pending", payment_status: "unpaid",
      address: order_type === "delivery" ? address || null : null,
      notes: notes || null,
    });
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
const STAMP = { preparing: "started_at", ready: "ready_at", served: "served_at", delivered: "served_at" };

router.patch("/:id", async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ["status", "payment_status", "notes", "table_number"])
      if (k in req.body) patch[k] = req.body[k];
    if (patch.status && STAMP[patch.status]) patch[STAMP[patch.status]] = new Date().toISOString();
    if (patch.status === "cancelled" && req.body.cancel_reason) patch.cancel_reason = String(req.body.cancel_reason).slice(0, 120);
    const before = patch.status === "cancelled" ? await req.repo.get("orders", req.params.id) : null;
    let row;
    try {
      row = await req.repo.update("orders", req.params.id, patch);
    } catch (err) {
      // migration 010 not run yet — drop the stamp columns, fold the reason into notes
      const { started_at: _s, ready_at: _r, served_at: _v, cancel_reason, ...bare } = patch;
      if (cancel_reason) bare.notes = [before?.notes, `cancelled: ${cancel_reason}`].filter(Boolean).join(" · ");
      row = await req.repo.update("orders", req.params.id, bare);
    }
    if (!row) return res.status(404).json({ error: "Not found" });
    // kitchen cancelled it → reverse the CRM bump the placement made
    if (patch.status === "cancelled" && before && before.status !== "cancelled" && row.phone_number) {
      try {
        const [d] = await req.repo.list("diners", { where: { phone_number: row.phone_number }, limit: 1 });
        if (d) await req.repo.update("diners", d.id, {
          total_spend: Math.max(0, Math.round(((Number(d.total_spend) || 0) - Number(row.total || 0)) * 100) / 100),
          visit_count: Math.max(0, (Number(d.visit_count) || 0) - 1),
        });
      } catch (err) { log("diner rollback on cancel failed:", err.message); }
    }
    if (patch.status) pushStatus(row.code, patch.status); // guest gets the update
    res.json(row);
  } catch (e) { next(e); }
});

export default router;
