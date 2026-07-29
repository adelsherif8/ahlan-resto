import dotenv from "dotenv";
dotenv.config();

export const PORT = Number(process.env.PORT || 5052);
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

export const AHLAN_URL = process.env.SUPABASE_AHLAN_URL || "";
export const AHLAN_KEY = process.env.SUPABASE_AHLAN_SERVICE_KEY || "";
export const RESTAURANT_SLUG = process.env.RESTAURANT_SLUG || "ahlan-pilot";

export const BUFFER_WINDOW_MS = Number(process.env.BUFFER_WINDOW_MS || 8000);
export const FLUSH_TICK_MS = Number(process.env.FLUSH_TICK_MS || 1000);

// Model policy — one place, so "which brain" is never scattered across flows.
// SMART = anything the guest reads or that needs judgment (composition, tone,
// multi-fact reasoning). FAST = mechanical work (classify, extract, summarize).
export const MODEL_SMART = process.env.MODEL_SMART || "gpt-4.1";
export const MODEL_FAST = process.env.MODEL_FAST || "gpt-4.1-mini";

export const llmReady = !!OPENAI_API_KEY;

export function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}
