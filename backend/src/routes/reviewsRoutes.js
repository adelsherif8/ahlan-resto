import { Router } from "express";
import { requireAuth, allowRoles } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

// A review is "bad" if it's 1–2 stars OR flagged negative — those are the ones that
// need a human. Kept in one place so the list, the counts and the KPIs agree.
const isBad = (f) => (f.rating != null && f.rating <= 2) || f.sentiment === "negative" || f.escalated === true;
const isTest = (v) => /^web:(regress|convo|test)-/i.test(String(v || ""));

router.get("/", async (req, res, next) => {
  try {
    const rows = (await req.repo.list("feedback", { order: "created_at", desc: true }))
      .filter((f) => !isTest(f.phone_number));
    const filter = String(req.query.filter || "all");
    const view = rows.filter((f) => {
      const status = f.status || "new";
      if (filter === "bad") return isBad(f);
      if (filter === "unhandled") return isBad(f) && status !== "resolved";
      if (filter === "resolved") return status === "resolved";
      return true;
    });

    // counts drive the filter chips + the Overview warning badge
    const bad = rows.filter(isBad);
    const now = Date.now();
    const within = (days) => rows.filter((f) => now - new Date(f.created_at).getTime() < days * 86400000 && f.rating != null);
    const avg = (list) => (list.length ? +(list.reduce((s, f) => s + f.rating, 0) / list.length).toFixed(1) : null);
    res.json({
      reviews: view.map((f) => ({ ...f, bad: isBad(f), status: f.status || "new" })),
      counts: {
        all: rows.length,
        bad: bad.length,
        unhandled: bad.filter((f) => (f.status || "new") !== "resolved").length,
        resolved: rows.filter((f) => f.status === "resolved").length,
      },
      kpis: {
        avg_7d: avg(within(7)),
        avg_30d: avg(within(30)),
        rated: rows.filter((f) => f.rating != null).length,
      },
    });
  } catch (e) { next(e); }
});

// The handling workflow: assign → handling → resolved (with a note). Manager/host only.
router.patch("/:id", allowRoles("manager", "host"), async (req, res, next) => {
  try {
    const patch = {};
    if ("status" in req.body && ["new", "handling", "resolved"].includes(req.body.status)) {
      patch.status = req.body.status;
      if (req.body.status === "resolved") patch.resolved_at = new Date().toISOString();
    }
    if ("assigned_to" in req.body) patch.assigned_to = String(req.body.assigned_to || "").slice(0, 60) || null;
    if ("resolution_note" in req.body) patch.resolution_note = String(req.body.resolution_note || "").slice(0, 800) || null;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing to update" });

    let row;
    try {
      row = await req.repo.update("feedback", req.params.id, patch);
    } catch (e) {
      // migration 025 not run yet → the workflow columns don't exist. Don't 500 at
      // staff; tell them plainly so they know to run it.
      if (/column|schema|resolved_at|assigned_to|resolution_note|status/i.test(e.message))
        return res.status(503).json({ error: "reviews handling needs migration 025 — run it in the tenant SQL editor" });
      throw e;
    }
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  } catch (e) { next(e); }
});

// Manual entry — a review that came in by phone/in person, logged by staff.
router.post("/", allowRoles("manager", "host"), async (req, res, next) => {
  try {
    const rating = req.body.rating != null ? Math.max(1, Math.min(5, Math.round(Number(req.body.rating)))) : null;
    const base = {
      phone_number: req.body.phone_number ? String(req.body.phone_number).slice(0, 20) : null,
      rating,
      comments: String(req.body.comments || "").slice(0, 800) || null,
      sentiment: rating != null ? (rating <= 2 ? "negative" : rating >= 4 ? "positive" : "neutral") : (req.body.sentiment || null),
      escalated: rating != null && rating <= 2,
    };
    const full = { ...base, order_code: req.body.order_code ? String(req.body.order_code).slice(0, 12) : null, source: "manual", status: "new" };
    // schema-tolerant until migration 025: fall back to the base columns
    let row;
    try {
      row = await req.repo.insert("feedback", full);
    } catch (e) {
      if (!/column|order_code|source|status|schema/i.test(e.message)) throw e;
      row = await req.repo.insert("feedback", base);
    }
    res.status(201).json(row);
  } catch (e) { next(e); }
});

export default router;
