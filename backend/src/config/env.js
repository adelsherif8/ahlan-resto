import dotenv from "dotenv";
dotenv.config();

export const PORT = Number(process.env.PORT || 5051);
export const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
// FAIL FAST in production: the default secret makes every dashboard JWT forgeable
// (any role, any restaurant). Better a loud boot error than a silently open admin.
if (!process.env.JWT_SECRET && (process.env.RAILWAY_ENVIRONMENT === "production" || process.env.NODE_ENV === "production")) {
  throw new Error("JWT_SECRET must be set in production (dashboard auth)");
}

export const SUPABASE_AHLAN_URL = process.env.SUPABASE_AHLAN_URL || "";
export const SUPABASE_AHLAN_SERVICE_KEY = process.env.SUPABASE_AHLAN_SERVICE_KEY || "";
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";
export const TEST_RESTO_SUPABASE_URL = process.env.TEST_RESTO_SUPABASE_URL || "";
export const TEST_RESTO_SUPABASE_KEY = process.env.TEST_RESTO_SUPABASE_KEY || "";

export const DEMO_MODE = !SUPABASE_AHLAN_URL && !TEST_RESTO_SUPABASE_URL;

// Flows service — staff replies are relayed there for channel delivery + AI history
export const FLOWS_URL = process.env.FLOWS_URL || "";
export const FLOWS_OPS_TOKEN = process.env.FLOWS_OPS_TOKEN || "";

export function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}
