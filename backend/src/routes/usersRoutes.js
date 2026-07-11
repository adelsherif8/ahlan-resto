// Staff account management (control-plane restaurant_users). Admin/manager only.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { requireAuth, allowRoles } from "../middleware/auth.js";
import { DEMO_MODE } from "../config/env.js";
import { supabaseAhlan } from "../config/connections.js";
import { demoUsers } from "../store/demo.js";

const router = Router();
router.use(requireAuth);

const ROLES = ["admin", "manager", "host", "kitchen", "livechat"];

router.get("/", allowRoles("manager"), async (req, res, next) => {
  try {
    if (DEMO_MODE) return res.json(demoUsers.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: true })));
    const { data, error } = await supabaseAhlan
      .from("restaurant_users")
      .select("id,email,name,role,active,created_at")
      .eq("restaurant_id", req.user.restaurantId)
      .order("created_at");
    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch (e) { next(e); }
});

router.post("/", allowRoles("manager"), async (req, res, next) => {
  try {
    const { email, name, role, password } = req.body || {};
    if (!email || !password || !ROLES.includes(role)) return res.status(400).json({ error: "email, password, valid role required" });
    if (DEMO_MODE) return res.status(501).json({ error: "Not available in demo mode" });
    const { data, error } = await supabaseAhlan
      .from("restaurant_users")
      .insert({ restaurant_id: req.user.restaurantId, email: email.toLowerCase().trim(), name: name || null, role, password_hash: bcrypt.hashSync(password, 10) })
      .select("id,email,name,role,active")
      .single();
    if (error) throw new Error(error.message.includes("duplicate") ? "Email already exists" : error.message);
    res.status(201).json(data);
  } catch (e) { next(e); }
});

router.patch("/:id", allowRoles("manager"), async (req, res, next) => {
  try {
    if (DEMO_MODE) return res.status(501).json({ error: "Not available in demo mode" });
    const patch = {};
    if (req.body.name !== undefined) patch.name = req.body.name;
    if (req.body.role && ROLES.includes(req.body.role)) patch.role = req.body.role;
    if (req.body.active !== undefined) patch.active = !!req.body.active;
    if (req.body.password) patch.password_hash = bcrypt.hashSync(req.body.password, 10);
    const { data, error } = await supabaseAhlan
      .from("restaurant_users")
      .update(patch)
      .eq("id", req.params.id)
      .eq("restaurant_id", req.user.restaurantId)
      .select("id,email,name,role,active")
      .single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (e) { next(e); }
});

// any logged-in user can change their own password
router.post("/me/password", async (req, res, next) => {
  try {
    const { current, password } = req.body || {};
    if (!password || password.length < 8) return res.status(400).json({ error: "New password must be 8+ chars" });
    if (DEMO_MODE) return res.status(501).json({ error: "Not available in demo mode" });
    const { data: me } = await supabaseAhlan.from("restaurant_users").select("*").eq("id", req.user.id).single();
    if (!me || !bcrypt.compareSync(current || "", me.password_hash)) return res.status(401).json({ error: "Current password incorrect" });
    await supabaseAhlan.from("restaurant_users").update({ password_hash: bcrypt.hashSync(password, 10) }).eq("id", req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
