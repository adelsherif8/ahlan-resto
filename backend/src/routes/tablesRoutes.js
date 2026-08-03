import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

router.get("/", async (req, res, next) => {
  try {
    const rows = await req.repo.list("restaurant_tables", { order: "table_number", desc: false });
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const { table_number, section, capacity } = req.body || {};
    if (!table_number || !section) return res.status(400).json({ error: "table_number and section required" });
    let row;
    try {
      row = await req.repo.insert("restaurant_tables", {
        table_number, section, capacity: Number(capacity) || 2,
        status: "free", vip: !!req.body.vip, current_reservation_id: null,
        branch: req.body.branch || null,
      });
    } catch {
      // pre-migration fallback (branch column exists in prod, but stay safe)
      row = await req.repo.insert("restaurant_tables", {
        table_number, section, capacity: Number(capacity) || 2,
        status: "free", vip: !!req.body.vip, current_reservation_id: null,
      });
    }
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ["status", "capacity", "section", "vip", "current_reservation_id", "table_number", "note", "branch", "pos"])
      if (k in req.body) patch[k] = req.body[k];
    const row = await req.repo.update("restaurant_tables", req.params.id, patch);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await req.repo.remove("restaurant_tables", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
