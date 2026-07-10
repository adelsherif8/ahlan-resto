import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

router.get("/", async (req, res, next) => {
  try {
    let rows = await req.repo.list("diners", { order: "visit_count" });
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
    const reservations = (await req.repo.list("reservations", { order: "date" }))
      .filter((r) => r.diner_phone === diner.phone_number)
      .slice(0, 20);
    res.json({ ...diner, reservations });
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
