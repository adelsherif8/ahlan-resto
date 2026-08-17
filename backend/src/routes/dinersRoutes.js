import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

router.get("/", async (req, res, next) => {
  try {
    const q = (req.query.q || "").toString().toLowerCase();
    // Deliberately UNBOUNDED. This is the CRM: silently returning the first N guests would
    // be a broken customer list with nothing to say so, and Overview derives "new this
    // week", repeat rate and top spenders from the whole set. It is also cheap to leave
    // uncapped — unlike the KPI and inbox endpoints, nothing polls this; it is read once
    // per page load. A search still goes to the database rather than pulling everything
    // and filtering in JS, which is the one case where transferring the lot is wasteful.
    let rows;
    if (q && req.tenantClient) {
      const safe = q.replace(/[%_,()]/g, "");
      const { data } = await req.tenantClient.from("diners").select("*")
        .or(`name.ilike.%${safe}%,phone_number.ilike.%${safe}%,wa_profile_name.ilike.%${safe}%`)
        .order("visit_count", { ascending: false });
      rows = data || [];
    } else {
      rows = await req.repo.list("diners", { order: "visit_count" });
    }
    // test-suite guests never show in the CRM (same rule as chats and orders)
    rows = rows.filter((d) => !/^web:(regress|convo|test)-/i.test(String(d.phone_number || "")));
    if (q && !req.tenantClient)
      rows = rows.filter(
        (d) =>
          (d.name || "").toLowerCase().includes(q) ||
          (d.phone_number || "").includes(q) ||
          (d.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const diner = await req.repo.get("diners", req.params.id);
    if (!diner) return res.status(404).json({ error: "Not found" });
    const reservations = (await req.repo.list("reservations", { where: { diner_phone: diner.phone_number }, order: "date", desc: true, limit: 20 })).reverse();
    // order history + derived stats — a CRM shows what they DO, not just fields
    let orders = [], stats = null;
    try {
      const raw = await req.repo.list("orders", { where: { phone_number: diner.phone_number }, order: "created_at", desc: true, limit: 60 });
      // The list above is capped for payload reasons, so counting it undercounts anyone
      // with a long history — that is what made a 14-visit guest read as "Orders 1".
      // Ask the database for the real number instead of counting the page we fetched.
      let trueOrderCount = null;
      if (req.tenantClient) {
        const { count } = await req.tenantClient.from("orders")
          .select("id", { count: "exact", head: true })
          .eq("phone_number", diner.phone_number)
          .neq("status", "cancelled");
        if (typeof count === "number") trueOrderCount = count;
      }
      orders = raw.slice(0, 25).map((o) => ({
        id: o.id, code: o.code, status: o.status, order_type: o.order_type,
        total: o.total, branch: o.branch, created_at: o.created_at,
        items: (o.items || []).map((i) => `${i.qty}× ${i.name}`).join(", "),
      }));
      const done = raw.filter((o) => o.status !== "cancelled");

      // What they actually order — the same picture the Chats panel builds, so a guest
      // looks identical whether you open them from a conversation or from the CRM.
      // Nobody should have to guess "what does this person usually get".
      const commonest = (key) => {
        const c = {};
        for (const o of done) if (o[key]) c[o[key]] = (c[o[key]] || 0) + 1;
        const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
        return best ? { value: best[0], times: best[1] } : null;
      };
      const itemCounts = {};
      for (const o of done) for (const it of o.items || []) {
        const n = it?.name; if (!n) continue;
        itemCounts[n] = (itemCounts[n] || 0) + (Number(it.qty) || 1);
      }
      const ranked = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]);
      const hours = done.map((o) => new Date(o.created_at).getHours()).filter((h) => Number.isFinite(h));
      const hourBand = hours.length
        ? (() => {
            const avg = Math.round(hours.reduce((a, c) => a + c, 0) / hours.length);
            return avg < 12 ? "mornings" : avg < 17 ? "afternoons" : avg < 22 ? "evenings" : "late night";
          })()
        : null;

      const branchCounts = {};
      for (const o of done) if (o.branch) branchCounts[o.branch] = (branchCounts[o.branch] || 0) + 1;
      stats = {
        order_count: trueOrderCount ?? done.length,
        order_count_capped: trueOrderCount == null && raw.length >= 60,
        avg_ticket: done.length ? Math.round(done.reduce((s, o) => s + Number(o.total || 0), 0) / done.length) : 0,
        last_order_at: done[0]?.created_at || null,
        favorite_branch: Object.entries(branchCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
        // only call something "their usual" once they've chosen it more than once
        usual: ranked[0] && ranked[0][1] >= 2 ? { name: ranked[0][0], times: ranked[0][1] } : null,
        top_items: ranked.slice(0, 4).map(([name, times]) => ({ name, times })),
        favourite_type: commonest("order_type"),
        usual_payment: commonest("payment_method"),
        cancelled_count: raw.length - done.length,
        when_they_order: hourBand,
        // Where this guest actually came from, DERIVED — not typed in by staff who'd have
        // to guess. A walk-in booked at the till carries a `walkin:` phone or a cashier on
        // the ticket; everyone else reached you through the bot. Finer attribution (which
        // QR, which campaign) needs UTM tags on the entry links, which don't exist yet.
        source: (() => {
          const walkin = String(diner.phone_number || "").startsWith("walkin:");
          const tills = done.filter((o) => o.cashier).length;
          if (walkin) return { channel: "In restaurant", detail: "added at the till" };
          if (!done.length) return { channel: "WhatsApp", detail: "messaged, hasn't ordered" };
          if (tills === done.length) return { channel: "In restaurant", detail: "every order rung up at the till" };
          if (tills > 0) return { channel: "Both", detail: `${done.length - tills} via WhatsApp, ${tills} at the till` };
          return { channel: "WhatsApp", detail: "orders through the bot" };
        })(),
      };
    } catch {}
    res.json({ ...diner, reservations, orders, stats });
  } catch (e) { next(e); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ["name", "email", "is_vip", "allergies", "preferences", "tags", "notes", "status"])
      if (k in req.body) patch[k] = req.body[k];
    const row = await req.repo.update("diners", req.params.id, patch);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

export default router;
