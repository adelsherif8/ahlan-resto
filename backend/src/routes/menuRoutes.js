import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

router.get("/", async (req, res, next) => {
  try {
    const rows = await req.repo.list("menu_items", { order: "sort_order", desc: false });
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const { name, category, price } = req.body || {};
    if (!name || !category || price == null)
      return res.status(400).json({ error: "name, category, price required" });
    const row = await req.repo.insert("menu_items", {
      name, category, price: Number(price),
      description: req.body.description || null,
      dietary_tags: req.body.dietary_tags || [],
      available: req.body.available !== false,
      sort_order: Number(req.body.sort_order) || 0,
    });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ["name", "category", "price", "description", "dietary_tags", "available", "sort_order", "photo_url"])
      if (k in req.body) patch[k] = req.body[k];
    const row = await req.repo.update("menu_items", req.params.id, patch);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await req.repo.remove("menu_items", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
