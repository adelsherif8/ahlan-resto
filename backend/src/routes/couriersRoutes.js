import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

router.get("/", async (req, res, next) => {
  try {
    const rows = await req.repo.list("couriers", { order: "created_at", desc: false });
    res.json(rows);
  } catch { res.json([]); } // table may predate migration 013
});

router.post("/", async (req, res, next) => {
  try {
    const { name, phone_number, branch } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const row = await req.repo.insert("couriers", { name: String(name).trim(), phone_number: phone_number || null, branch: branch || null, active: true });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ["name", "phone_number", "branch", "active"]) if (k in req.body) patch[k] = req.body[k];
    const row = await req.repo.update("couriers", req.params.id, patch);
    res.json(row || { ok: true });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await req.repo.remove("couriers", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
