import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { JWT_SECRET, DEMO_MODE } from "../config/env.js";
import { supabaseAhlan } from "../config/connections.js";
import { demoUsers, demoRestaurant } from "../store/demo.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

function sign(user, restaurantId) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, restaurantId },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  if (DEMO_MODE) {
    const user = demoUsers.find((u) => u.email === email.toLowerCase().trim());
    if (!user || user.password !== password)
      return res.status(401).json({ error: "Invalid credentials" });
    return res.json({
      token: sign(user, demoRestaurant.id),
      user: { name: user.name, email: user.email, role: user.role },
      restaurant: { id: demoRestaurant.id, name: demoRestaurant.name },
    });
  }

  const { data: user, error } = await supabaseAhlan
    .from("restaurant_users")
    .select("*")
    .eq("email", email.toLowerCase().trim())
    .eq("active", true)
    .maybeSingle();
  if (error || !user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const { data: resto } = await supabaseAhlan
    .from("restaurants")
    .select("id,name")
    .eq("id", user.restaurant_id)
    .single();

  res.json({
    token: sign(user, user.restaurant_id),
    user: { name: user.name, email: user.email, role: user.role },
    restaurant: resto,
  });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

export default router;
