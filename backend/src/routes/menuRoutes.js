import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = Router();
router.use(requireAuth, restaurantContext);

// Photo upload → tenant storage → menu_items.photo_url (the bot sends these to guests)
router.post("/:id/photo", upload.single("photo"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "photo file required" });
    if (!req.tenantClient) return res.status(501).json({ error: "Photo upload needs real mode (tenant storage)" });
    const item = await req.repo.get("menu_items", req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });

    const BUCKET = "menu-photos";
    const ext = (req.file.mimetype.split("/")[1] || "jpg").split(";")[0];
    const path = `${req.params.id}.${ext}`;
    let up = await req.tenantClient.storage.from(BUCKET).upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (up.error) {
      await req.tenantClient.storage.createBucket(BUCKET, { public: true }).catch(() => {});
      up = await req.tenantClient.storage.from(BUCKET).upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
      if (up.error) throw new Error(up.error.message);
    }
    const { data: pub } = req.tenantClient.storage.from(BUCKET).getPublicUrl(path);
    const photo_url = `${pub.publicUrl}?v=${Date.now()}`;
    const row = await req.repo.update("menu_items", req.params.id, { photo_url });
    res.json(row);
  } catch (e) { next(e); }
});

router.get("/", async (req, res, next) => {
  try {
    const rows = await req.repo.list("menu_items", { order: "sort_order", desc: false });
    res.json(rows);
  } catch (e) { next(e); }
});

// units + revenue per item over the last 30 days, from real (non-test) orders —
// bestseller stars should come from data, not vibes
router.get("/performance", async (req, res, next) => {
  try {
    const since = Date.now() - 30 * 86400000;
    const isTest = (v) => /^web:(regress|convo|test)-/i.test(String(v || ""));
    const orders = (await req.repo.list("orders", { order: "created_at", desc: true, limit: 1000 }))
      .filter((o) => o.status !== "cancelled" && !isTest(o.phone_number) && new Date(o.created_at).getTime() > since);
    const perf = {};
    for (const o of orders) for (const it of o.items || []) {
      const k = it.name;
      perf[k] = perf[k] || { units: 0, egp: 0 };
      perf[k].units += Number(it.qty) || 1;
      perf[k].egp += (Number(it.unit_price ?? it.price) || 0) * (Number(it.qty) || 1);
    }
    res.json(perf);
  } catch (e) { next(e); }
});

// AI copy-cleanup proposals (proxied to flows; dashboard shows a diff to approve)
router.post("/tidy", async (req, res, next) => {
  try {
    const { FLOWS_URL, FLOWS_OPS_TOKEN } = await import("../config/env.js");
    if (!FLOWS_URL) return res.status(503).json({ error: "flows not configured" });
    const r = await fetch(`${FLOWS_URL}/api/ops/tidy-menu`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(FLOWS_OPS_TOKEN ? { "x-ops-token": FLOWS_OPS_TOKEN } : {}) },
    });
    if (!r.ok) return res.status(502).json({ error: `flows ${r.status}` });
    res.json(await r.json());
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
    for (const k of ["name", "category", "price", "description", "dietary_tags", "available", "sort_order", "photo_url", "ingredients", "spice_level", "bestseller", "pairs_with", "options", "sold_out_until"])
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
