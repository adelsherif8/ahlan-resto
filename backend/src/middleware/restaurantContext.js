// Resolves the tenant for the authenticated user and attaches:
//   req.repo       — data access (demo store or the restaurant's own Supabase)
//   req.restaurant — control-plane config row
import {
  DEMO_MODE,
  TEST_RESTO_SUPABASE_URL,
  TEST_RESTO_SUPABASE_KEY,
} from "../config/env.js";
import { supabaseAhlan, decryptField, tenantClient } from "../config/connections.js";
import { supabaseRepo } from "../store/supabaseRepo.js";
import { demoRepo, demoRestaurant } from "../store/demo.js";

const configCache = new Map(); // restaurantId -> { record, repo, at }
const CACHE_MS = 60_000;

export async function restaurantContext(req, res, next) {
  try {
    if (DEMO_MODE) {
      req.repo = demoRepo;
      req.restaurant = demoRestaurant;
      return next();
    }

    if (TEST_RESTO_SUPABASE_URL) {
      req.repo = supabaseRepo(tenantClient(TEST_RESTO_SUPABASE_URL, TEST_RESTO_SUPABASE_KEY));
      req.restaurant = demoRestaurant; // config editing needs the control plane; test mode uses demo config
      return next();
    }

    const restaurantId = req.user?.restaurantId;
    if (!restaurantId) return res.status(400).json({ error: "Token missing restaurantId" });

    const cached = configCache.get(restaurantId);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      req.repo = cached.repo;
      req.restaurant = cached.record;
      return next();
    }

    const { data, error } = await supabaseAhlan
      .from("restaurants")
      .select("*")
      .eq("id", restaurantId)
      .single();
    if (error || !data) return res.status(404).json({ error: "Restaurant not found" });

    const creds = data.integrations?.supabase || {};
    const url = decryptField(creds.url);
    const key = decryptField(creds.key);
    if (!url || !key) return res.status(500).json({ error: "Restaurant DB not configured" });

    const repo = supabaseRepo(tenantClient(url, key));
    configCache.set(restaurantId, { record: data, repo, at: Date.now() });
    req.repo = repo;
    req.restaurant = data;
    next();
  } catch (err) {
    next(err);
  }
}
