import { Router } from "express";
import crypto from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

// GET /api/reservations?date=YYYY-MM-DD&status=confirmed
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.date) where.date = req.query.date;
    if (req.query.status) where.status = req.query.status;
    const rows = await req.repo.list("reservations", { where, order: "time_slot", desc: false });
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const { diner_name, diner_phone, party_size, date, time_slot } = req.body || {};
    if (!diner_phone || !party_size || !date || !time_slot)
      return res.status(400).json({ error: "diner_phone, party_size, date, time_slot required" });
    const row = await req.repo.insert("reservations", {
      code: "R-" + crypto.randomBytes(2).toString("hex").toUpperCase(),
      diner_name: diner_name || null,
      diner_phone,
      party_size: Number(party_size),
      date,
      time_slot,
      section_pref: req.body.section_pref || null,
      occasion: req.body.occasion || null,
      special_requests: req.body.special_requests || null,
      status: req.body.status || "confirmed",
      source: req.body.source || "dashboard",
      deposit_status: "none",
      updated_at: new Date().toISOString(),
    });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

const STATUS_TIMESTAMPS = {
  arrived: "arrived_at",
  seated: "seated_at",
  completed: "completed_at",
};

router.patch("/:id", async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ["status", "table_id", "party_size", "date", "time_slot", "section_pref", "occasion", "special_requests", "deposit_status", "cancelled_reason", "diner_name"])
      if (k in req.body) patch[k] = req.body[k];
    const tsField = STATUS_TIMESTAMPS[req.body.status];
    if (tsField) patch[tsField] = new Date().toISOString();
    const row = await req.repo.update("reservations", req.params.id, patch);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

export default router;
