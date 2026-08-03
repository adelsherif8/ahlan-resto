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

router.patch("/:id", async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ["status", "payment_status", "notes", "table_number"])
      if (k in req.body) patch[k] = req.body[k];
    const before = patch.status === "cancelled" ? await req.repo.get("orders", req.params.id) : null;
    const row = await req.repo.update("orders", req.params.id, patch);
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
