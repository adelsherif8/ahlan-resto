import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

router.get("/", async (req, res, next) => {
  try {
    const rows = await req.repo.list("waitlist", { order: "created_at", desc: false });
    res.json(rows.filter((w) => !["seated", "left", "expired"].includes(w.status) || req.query.all === "1"));
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const { phone_number, party_size } = req.body || {};
    if (!phone_number || !party_size)
      return res.status(400).json({ error: "phone_number and party_size required" });
    const waiting = (await req.repo.list("waitlist")).filter((w) => w.status === "waiting");
    const row = await req.repo.insert("waitlist", {
      phone_number,
      name: req.body.name || null,
      party_size: Number(party_size),
      quoted_wait_min: Number(req.body.quoted_wait_min) || null,
      status: "waiting",
      position: waiting.length + 1,
      notified_at: null,
    });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const patch = {};
    if ("status" in req.body) {
      patch.status = req.body.status;
      if (req.body.status === "notified") patch.notified_at = new Date().toISOString();
    }
    if ("quoted_wait_min" in req.body) patch.quoted_wait_min = req.body.quoted_wait_min;
    if ("position" in req.body) patch.position = req.body.position;
    const row = await req.repo.update("waitlist", req.params.id, patch);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

export default router;
