import { Router } from "express";
import { requireAuth, allowRoles } from "../middleware/auth.js";
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

    // orders-first numbers for casual restaurants — test rows and other days excluded
    const isTest = (v) => /^web:(regress|convo|test)-/i.test(String(v || ""));
    const real = orders.filter((o) => !isTest(o.phone_number));
    // day boundaries in the RESTAURANT'S timezone — an order placed 23:50 must
    // not vanish from today's numbers because the server clock lives in UTC
    const tz = req.restaurant?.basic_info?.timezone || "Africa/Cairo";
    const dayOf = (ts) => new Date(ts).toLocaleDateString("en-CA", { timeZone: tz });
    const todayTz = dayOf(Date.now());
    const todayOrders = real.filter((o) => dayOf(o.created_at) === todayTz);
    const yesterday = dayOf(Date.now() - 86400000);
    const kept = todayOrders.filter((o) => o.status !== "cancelled");
    const round2 = (n) => Math.round(n * 100) / 100;
    const revenue = round2(kept.reduce((s, o) => s + Number(o.total || 0), 0));
    const revenueYesterday = round2(real
      .filter((o) => dayOf(o.created_at) === yesterday && o.status !== "cancelled")
      .reduce((s, o) => s + Number(o.total || 0), 0));
    // Live tickets are live regardless of which day they started — a 23:50 order still
    // cooking at 00:05 stays in open/late, so this is deliberately NOT bounded to today.
    // But "open" has to end somewhere. A ticket nobody ever closed is an admin chore, not
    // a kitchen emergency; counting those forever made "N orders running late" a permanent
    // red alarm no one could ever clear (observed: 12 "late" on a day with 1 order, the
    // oldest 17h old). Past STALE_HOURS a ticket stops being late and becomes stale_open.
    const STALE_HOURS = 12;
    const ageMin = (o) => (Date.now() - new Date(o.created_at).getTime()) / 60000;
    const openAll = real.filter((o) => !["paid", "cancelled", "served", "delivered"].includes(o.status));
    const openNow = openAll.filter((o) => ageMin(o) <= STALE_HOURS * 60);
    const staleOpen = openAll.length - openNow.length;
    const lateNow = openNow.filter((o) => ageMin(o) > 20).length;
    const prep = kept
      .map((o) => { const end = o.ready_at || o.served_at; return end ? (new Date(end).getTime() - new Date(o.created_at).getTime()) / 60000 : null; })
      .filter((x) => x !== null && x > 0 && x < 240);
    const byHour = {};
    for (const o of kept) { const h = new Date(o.created_at).getHours(); byHour[h] = byHour[h] || { count: 0, egp: 0 }; byHour[h].count++; byHour[h].egp += Number(o.total || 0); }
    const itemCounts = {};
    for (const o of kept) for (const it of o.items || []) itemCounts[it.name] = (itemCounts[it.name] || 0) + (Number(it.qty) || 1);
    const byBranch = {};
    for (const o of kept) { const b = o.branch || "—"; byBranch[b] = byBranch[b] || { count: 0, egp: 0 }; byBranch[b].count++; byBranch[b].egp = round2(byBranch[b].egp + Number(o.total || 0)); }

    res.json({
      orders_today: {
        count: kept.length,
        revenue, revenue_yesterday: revenueYesterday,
        open_now: openNow.length, late_now: lateNow, stale_open: staleOpen,
        cancelled: todayOrders.length - kept.length,
        avg_prep: prep.length ? Math.round(prep.reduce((s, x) => s + x, 0) / prep.length) : null,
        ai_count: kept.filter((o) => !String(o.phone_number || "").startsWith("walkin:")).length,
        by_hour: Object.entries(byHour).map(([h, v]) => ({ hour: Number(h), ...v })).sort((a, b) => a.hour - b.hour),
        top_items: Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, units]) => ({ name, units })),
        by_branch: Object.entries(byBranch).map(([branch, v]) => ({ branch, ...v })).sort((a, b) => b.egp - a.egp),
      },
      covers_today: coversToday,
      reservations_today: todays.filter((r) => active(r.status)).length,
      pending_deposits: reservations.filter((r) => r.deposit_status === "pending").length,
      waitlist_now: waitlist.filter((w) => ["waiting", "notified"].includes(w.status)).length,
      tables_seated: seated,
      tables_total: tables.length,
      open_orders: openNow.length,
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

// Reservation-agent performance over the last N days — the founder's ROI numbers
router.get("/agent-stats", async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 7;
    const cutoff = Date.now() - days * 86400000;
    let resAll = [], notifs = [];
    try { resAll = await req.repo.list("reservations"); } catch {}
    try { notifs = await req.repo.list("notifications"); } catch {}
    const recent = resAll.filter((r) => new Date(r.created_at).getTime() > cutoff);
    const ai = recent.filter((r) => r.source === "whatsapp");
    const aiActive = ai.filter((r) => !["cancelled", "no_show"].includes(r.status));
    const nRecent = (type) => notifs.filter((n) => n.type === type && new Date(n.created_at).getTime() > cutoff).length;
    res.json({
      days,
      ai_bookings: ai.length,
      ai_covers: aiActive.reduce((s, r) => s + (r.party_size || 0), 0),
      ai_cancelled: ai.filter((r) => r.status === "cancelled").length,
      manual_bookings: recent.filter((r) => r.source === "dashboard").length,
      walk_ins: recent.filter((r) => r.source === "walk_in").length,
      abandoned_leads: nRecent("abandoned_booking"),
      arrivals_handled: nRecent("arrival"),
    });
  } catch (e) { next(e); }
});

// What the restaurant actually MADE, not what it took. Revenue is the easy half —
// this pairs every sold item with its menu_items.cost so a manager can see gross
// profit, which categories carry the place, and which dishes lose money on every plate.
//
// Two honesty rules, because a wrong profit number is worse than no profit number:
//   1) an item with no cost recorded is NEVER guessed — it is excluded and reported
//      as uncovered, so the UI can say "these numbers cover 62% of revenue".
//   2) revenue here is FOOD revenue (items only). Delivery fees, tax and tips are
//      not food and would inflate margin if mixed in with food cost.
// Admin-only while the page is parked (hidden from the sidebar until item costs exist).
router.get("/profit", allowRoles("admin"), async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const cutoff = Date.now() - days * 86400000;
    const isTest = (v) => /^web:(regress|convo|test)-/i.test(String(v || ""));
    const tz = req.restaurant?.basic_info?.timezone || "Africa/Cairo";
    const dayOf = (ts) => new Date(ts).toLocaleDateString("en-CA", { timeZone: tz });
    const round2 = (n) => Math.round(n * 100) / 100;

    const [menu, allOrders] = await Promise.all([
      req.repo.list("menu_items", { order: "sort_order", desc: false }),
      req.repo.list("orders", { order: "created_at", desc: true, limit: 5000 }),
    ]);
    const orders = allOrders.filter((o) =>
      o.status !== "cancelled" && !isTest(o.phone_number) && new Date(o.created_at).getTime() > cutoff);

    // menu lookup by normalised name — order items store the name, not the id
    const key = (s) => String(s || "").trim().toLowerCase();
    const byName = new Map(menu.map((m) => [key(m.name), m]));

    const items = {};      // name -> aggregated sales
    const byDay = {};
    const byCategory = {};
    let discounts = 0;

    for (const o of orders) {
      discounts += Number(o.discount) || 0;
      const day = dayOf(o.created_at);
      byDay[day] = byDay[day] || { day, revenue: 0, cost: 0, profit: 0, covered: 0 };
      for (const it of o.items || []) {
        const qty = Number(it.qty) || 1;
        const unitPrice = Number(it.unit_price ?? it.price) || 0;
        const revenue = unitPrice * qty;
        const m = byName.get(key(it.name));
        const unitCost = m && m.cost != null && m.cost !== "" ? Number(m.cost) : null;
        const costed = unitCost != null && Number.isFinite(unitCost);
        const cost = costed ? unitCost * qty : 0;
        const category = m?.category || "—";

        const row = (items[it.name] = items[it.name] || {
          name: it.name, category, units: 0, revenue: 0, cost: 0,
          price: m ? Number(m.price) : null, unit_cost: costed ? unitCost : null, costed,
        });
        row.units += qty; row.revenue += revenue; row.cost += cost;

        byDay[day].revenue += revenue;
        if (costed) { byDay[day].cost += cost; byDay[day].covered += revenue; }

        const c = (byCategory[category] = byCategory[category] || { category, units: 0, revenue: 0, cost: 0, covered: 0 });
        c.units += qty; c.revenue += revenue;
        if (costed) { c.cost += cost; c.covered += revenue; }
      }
    }

    const all = Object.values(items);
    const costed = all.filter((r) => r.costed);
    const uncosted = all.filter((r) => !r.costed);
    const revenueTotal = all.reduce((s, r) => s + r.revenue, 0);
    const revenueCovered = costed.reduce((s, r) => s + r.revenue, 0);
    const foodCost = costed.reduce((s, r) => s + r.cost, 0);
    const grossProfit = revenueCovered - foodCost;

    const shape = (r) => ({
      name: r.name, category: r.category, units: r.units,
      revenue: round2(r.revenue), cost: round2(r.cost),
      profit: round2(r.revenue - r.cost),
      margin_pct: r.revenue > 0 ? Math.round(((r.revenue - r.cost) / r.revenue) * 100) : null,
      price: r.price, unit_cost: r.unit_cost,
      unit_margin: r.price != null && r.unit_cost != null ? round2(r.price - r.unit_cost) : null,
    });

    res.json({
      days,
      currency: req.restaurant?.payments?.currency || "EGP",
      coverage: {
        items_sold: all.length,
        items_costed: costed.length,
        revenue_total: round2(revenueTotal),
        revenue_covered: round2(revenueCovered),
        pct: revenueTotal > 0 ? Math.round((revenueCovered / revenueTotal) * 100) : 0,
      },
      totals: {
        orders: orders.length,
        food_revenue: round2(revenueCovered),
        food_cost: round2(foodCost),
        gross_profit: round2(grossProfit),
        margin_pct: revenueCovered > 0 ? Math.round((grossProfit / revenueCovered) * 100) : null,
        discounts: round2(discounts),
        avg_profit_per_order: orders.length ? round2(grossProfit / orders.length) : 0,
      },
      by_day: Object.values(byDay)
        .map((d) => ({ day: d.day, revenue: round2(d.covered), cost: round2(d.cost), profit: round2(d.covered - d.cost) }))
        .sort((a, b) => (a.day < b.day ? -1 : 1)),
      by_category: Object.values(byCategory)
        .map((c) => ({
          category: c.category, units: c.units,
          revenue: round2(c.covered), cost: round2(c.cost), profit: round2(c.covered - c.cost),
          margin_pct: c.covered > 0 ? Math.round(((c.covered - c.cost) / c.covered) * 100) : null,
          uncovered: round2(c.revenue - c.covered),
        }))
        .sort((a, b) => b.profit - a.profit),
      top: costed.map(shape).sort((a, b) => b.profit - a.profit).slice(0, 12),
      // sold below cost, or so thin it is not worth the pass — the whole point of the page
      losers: costed.map(shape).filter((r) => r.unit_margin != null && r.unit_margin <= 0)
        .sort((a, b) => a.profit - b.profit),
      uncosted: uncosted.map((r) => ({ name: r.name, units: r.units, revenue: round2(r.revenue) }))
        .sort((a, b) => b.revenue - a.revenue),
    });
  } catch (e) { next(e); }
});

router.get("/notifications", async (req, res, next) => {
  try {
    const rows = await req.repo.list("notifications", { order: "created_at" });
    // a branch only sees its own pings (untagged = restaurant-wide, always shown)
    const branch = req.user?.branch || (req.query.branch && req.query.branch !== "all" ? req.query.branch : null);
    res.json(branch ? rows.filter((n) => !n.branch || n.branch === branch) : rows);
  } catch (e) { next(e); }
});

router.patch("/notifications/:id", async (req, res, next) => {
  try {
    const row = await req.repo.update("notifications", req.params.id, { read: true });
    res.json(row || { ok: true });
  } catch (e) { next(e); }
});

export default router;
