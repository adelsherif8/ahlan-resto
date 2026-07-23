import { Router } from "express";
import crypto from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

// GET /api/reservations?date=YYYY-MM-DD&status=confirmed
// Enriched with table_number (the agent assigns best-fit tables) and the diner's
// allergies (kitchen sees warnings before the guest walks in).
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.date) where.date = req.query.date;
    if (req.query.status) where.status = req.query.status;
    const rows = await req.repo.list("reservations", { where, order: "time_slot", desc: false });
    let tableById = new Map(), dinerByPhone = new Map();
    try {
      const tables = await req.repo.list("restaurant_tables");
      tableById = new Map(tables.map((t) => [t.id, t]));
    } catch {}
    try {
      const diners = await req.repo.list("diners");
      dinerByPhone = new Map(diners.map((d) => [d.phone_number, d]));
    } catch {}
    res.json(rows.map((r) => {
      const d = dinerByPhone.get(r.diner_phone);
      return {
        ...r,
        table_number: tableById.get(r.table_id)?.table_number || null,
        table_section: tableById.get(r.table_id)?.section || null,
        diner_allergies: d?.allergies?.length ? d.allergies : null,
        diner_display: r.diner_name || d?.name || d?.wa_profile_name || null,
      };
    }));
  } catch (e) { next(e); }
});

// Guests mid-booking with the AI right now (active temp_reservation sessions)
router.get("/live", async (req, res, next) => {
  try {
    let rows = [];
    try {
      rows = await req.repo.list("temp_reservation", { order: "updated_at" });
    } catch { return res.json([]); }
    const ACTIVE = ["incomplete", "quoted", "awaiting_confirm", "awaiting_deposit", "awaiting_cancel_confirm"];
    const cutoff = Date.now() - 4 * 3600000; // same TTL the agent uses
    let dinerByPhone = new Map();
    try {
      const diners = await req.repo.list("diners");
      dinerByPhone = new Map(diners.map((d) => [d.phone_number, d]));
    } catch {}
    res.json(rows
      .filter((r) => ACTIVE.includes(r.session_status) && new Date(r.updated_at).getTime() > cutoff)
      .map((r) => {
        const d = dinerByPhone.get(r.phone_number);
        return {
          phone_number: r.phone_number,
          name: d?.name || d?.wa_profile_name || null,
          stage: r.session_status,
          party_size: r.party_size,
          date: r.date,
          time_slot: r.time_slot,
          quoted: r.quoted ? { date: r.quoted.date, time: r.quoted.time, party: r.quoted.party_size } : null,
          updated_at: r.updated_at,
        };
      }));
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
      table_id: req.body.table_id || null,
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
