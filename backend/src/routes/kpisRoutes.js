import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

router.get("/kpis", async (req, res, next) => {
  try {
    const today = new Date().toLocaleDateString("en-CA"); // local date, matches dashboard
    const [reservations, tables, waitlist, orders, sessions, feedback] = await Promise.all([
      req.repo.list("reservations"),
      req.repo.list("restaurant_tables"),
      req.repo.list("waitlist"),
      req.repo.list("orders"),
      req.repo.list("chat_sessions"),
      req.repo.list("feedback"),
    ]);

    const todays = reservations.filter((r) => r.date === today);
    const active = (s) => !["cancelled", "no_show"].includes(s);
    const coversToday = todays.filter((r) => active(r.status)).reduce((s, r) => s + (r.party_size || 0), 0);

    const past = reservations.filter((r) => r.date < today);
    const noShows = past.filter((r) => r.status === "no_show").length;
    const noShowRate = past.length ? Math.round((noShows / past.length) * 100) : 0;

    const seated = tables.filter((t) => t.status === "seated").length;
    const ratings = feedback.filter((f) => f.rating != null);
    const avgRating = ratings.length
      ? (ratings.reduce((s, f) => s + f.rating, 0) / ratings.length).toFixed(1)
      : null;

    res.json({
      covers_today: coversToday,
      reservations_today: todays.filter((r) => active(r.status)).length,
      pending_deposits: reservations.filter((r) => r.deposit_status === "pending").length,
      waitlist_now: waitlist.filter((w) => ["waiting", "notified"].includes(w.status)).length,
      tables_seated: seated,
      tables_total: tables.length,
      open_orders: orders.filter((o) => !["paid", "cancelled", "served", "delivered"].includes(o.status)).length,
      needs_attention: sessions.filter((s) => s.needs_attention).length,
      no_show_rate_pct: noShowRate,
      avg_rating: avgRating,
      by_slot: buildSlotHistogram(todays.filter((r) => active(r.status))),
      upcoming: reservations
        .filter((r) => r.date >= today && active(r.status))
        .sort((a, b) => (a.date + a.time_slot < b.date + b.time_slot ? -1 : 1))
        .slice(0, 8),
    });
  } catch (e) { next(e); }
});

function buildSlotHistogram(rows) {
  const map = {};
  for (const r of rows) {
    const slot = (r.time_slot || "").slice(0, 5);
    map[slot] = (map[slot] || 0) + (r.party_size || 0);
  }
  return Object.entries(map)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([slot, covers]) => ({ slot, covers }));
}

router.get("/notifications", async (req, res, next) => {
  try {
    const rows = await req.repo.list("notifications", { order: "created_at" });
    res.json(rows);
  } catch (e) { next(e); }
});

router.patch("/notifications/:id", async (req, res, next) => {
  try {
    const row = await req.repo.update("notifications", req.params.id, { read: true });
    res.json(row || { ok: true });
  } catch (e) { next(e); }
});

export default router;
