import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

router.get("/", async (req, res, next) => {
  try {
    const rows = await req.repo.list("events", { order: "date", desc: false });
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const { title, date } = req.body || {};
    if (!title || !date) return res.status(400).json({ error: "title and date required" });
    const row = await req.repo.insert("events", {
      title,
      date,
      description: req.body.description || null,
      start_time: req.body.start_time || null,
      end_time: req.body.end_time || null,
      capacity: req.body.capacity != null ? Number(req.body.capacity) : null,
      price: req.body.price != null ? Number(req.body.price) : null,
      rsvp_count: 0,
      status: "upcoming",
      broadcast_sent: false,
    });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ["title", "description", "date", "start_time", "end_time", "capacity", "price", "status", "broadcast_sent"])
      if (k in req.body) patch[k] = req.body[k];
    const row = await req.repo.update("events", req.params.id, patch);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

export default router;
