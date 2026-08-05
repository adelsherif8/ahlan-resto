import { Router } from "express";
import { requireAuth, allowRoles } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";
import { DEMO_MODE } from "../config/env.js";
import { supabaseAhlan } from "../config/connections.js";

const router = Router();
router.use(requireAuth, restaurantContext);

const EDITABLE_SECTIONS = [
  "basic_info", "hours", "sections", "reservation_policy",
  "payments", "ai", "faqs", "menu_config", "pos",
];

router.get("/", (req, res) => {
  const r = req.restaurant;
  res.json({
    id: r.id,
    name: r.name,
    slug: r.slug,
    phone_number: r.phone_number,
    ...Object.fromEntries(EDITABLE_SECTIONS.map((s) => [s, r[s] ?? null])),
  });
});

// PUT /api/settings/:section — replace one config section (merge happens client-side per field)
router.put("/:section", allowRoles("manager"), async (req, res, next) => {
  try {
    const section = req.params.section;
    if (!EDITABLE_SECTIONS.includes(section))
      return res.status(400).json({ error: `Editable sections: ${EDITABLE_SECTIONS.join(", ")}` });

    if (DEMO_MODE) {
      req.restaurant[section] = req.body;
      return res.json({ ok: true, [section]: req.body });
    }

    const { error } = await supabaseAhlan
      .from("restaurants")
      .update({ [section]: req.body, updated_at: new Date().toISOString() })
      .eq("id", req.restaurant.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true, [section]: req.body });
  } catch (e) { next(e); }
});

// ---- Bot-suggested FAQs (the agent proposes; staff approve/dismiss here) ----
router.get("/suggested-faqs", async (req, res, next) => {
  try {
    const rows = await req.repo.list("suggested_faqs", { where: { status: "pending" }, order: "created_at" });
    res.json(rows);
  } catch { res.json([]); } // table may not exist yet
});

router.post("/suggested-faqs/:id", allowRoles("manager"), async (req, res, next) => {
  try {
    const { action, answer } = req.body || {}; // approve | dismiss
    const row = await req.repo.get("suggested_faqs", req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });

    if (action === "approve") {
      if (!answer) return res.status(400).json({ error: "answer required to approve" });
      const faqs = [...(req.restaurant.faqs || []), { q: row.question, a: answer }];
      if (DEMO_MODE) req.restaurant.faqs = faqs;
      else {
        const { error } = await supabaseAhlan.from("restaurants").update({ faqs, updated_at: new Date().toISOString() }).eq("id", req.restaurant.id);
        if (error) throw new Error(error.message);
        req.restaurant.faqs = faqs;
      }
      await req.repo.update("suggested_faqs", row.id, { status: "approved", suggested_answer: answer });
      return res.json({ ok: true, faqs });
    }
    await req.repo.update("suggested_faqs", row.id, { status: "dismissed" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
