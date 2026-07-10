import dotenv from "dotenv";
dotenv.config();

export const PORT = Number(process.env.PORT || 5052);
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

export const AHLAN_URL = process.env.SUPABASE_AHLAN_URL || "";
export const AHLAN_KEY = process.env.SUPABASE_AHLAN_SERVICE_KEY || "";
export const RESTAURANT_SLUG = process.env.RESTAURANT_SLUG || "ahlan-pilot";

export const BUFFER_WINDOW_MS = Number(process.env.BUFFER_WINDOW_MS || 8000);
export const FLUSH_TICK_MS = Number(process.env.FLUSH_TICK_MS || 1000);

export const llmReady = !!OPENAI_API_KEY;

export function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}
