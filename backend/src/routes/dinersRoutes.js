import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

router.get("/", async (req, res, next) => {
  try {
    // test-suite guests never show in the CRM (same rule as chats and orders)
    let rows = (await req.repo.list("diners", { order: "visit_count" }))
      .filter((d) => !/^web:(regress|convo|test)-/i.test(String(d.phone_number || "")));
    const q = (req.query.q || "").toString().toLowerCase();
    if (q)
      rows = rows.filter(
        (d) =>
          (d.name || "").toLowerCase().includes(q) ||
          (d.phone_number || "").includes(q) ||
          (d.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const diner = await req.repo.get("diners", req.params.id);
    if (!diner) return res.status(404).json({ error: "Not found" });
    const reservations = (await req.repo.list("reservations", { where: { diner_phone: diner.phone_number }, order: "date", desc: true, limit: 20 })).reverse();
    // order history + derived stats — a CRM shows what they DO, not just fields
    let orders = [], stats = null;
    try {
      orders = (await req.repo.list("orders", { where: { phone_number: diner.phone_number }, order: "created_at", desc: true, limit: 25 }))
        .map((o) => ({
          id: o.id, code: o.code, status: o.status, order_type: o.order_type,
          total: o.total, branch: o.branch, created_at: o.created_at,
          items: (o.items || []).map((i) => `${i.qty}× ${i.name}`).join(", "),
        }));
      const done = orders.filter((o) => o.status !== "cancelled");
      const branchCounts = {};
      for (const o of done) if (o.branch) branchCounts[o.branch] = (branchCounts[o.branch] || 0) + 1;
      stats = {
        order_count: done.length,
        avg_ticket: done.length ? Math.round(done.reduce((s, o) => s + Number(o.total || 0), 0) / done.length) : 0,
        last_order_at: done[0]?.created_at || null,
        favorite_branch: Object.entries(branchCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      };
    } catch {}
    res.json({ ...diner, reservations, orders, stats });
  } catch (e) { next(e); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ["name", "email", "is_vip", "allergies", "preferences", "tags", "notes", "status"])
      if (k in req.body) patch[k] = req.body[k];
    const row = await req.repo.update("diners", req.params.id, patch);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

export default router;
