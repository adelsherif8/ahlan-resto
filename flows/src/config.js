import dotenv from "dotenv";
dotenv.config();

export const PORT = Number(process.env.PORT || 5052);
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

export const AHLAN_URL = process.env.SUPABASE_AHLAN_URL || "";
export const AHLAN_KEY = process.env.SUPABASE_AHLAN_SERVICE_KEY || "";
export const RESTAURANT_SLUG = process.env.RESTAURANT_SLUG || "ahlan-pilot";

// 5s of silence = the guest is done typing. 8s read as "the bot is slow" —
// questions already flush at 2.5s and the 3s typing extension guards real bursts.
export const BUFFER_WINDOW_MS = Number(process.env.BUFFER_WINDOW_MS || 5000);
export const FLUSH_TICK_MS = Number(process.env.FLUSH_TICK_MS || 1000);

// Model policy — one place, so "which brain" is never scattered across flows.
// SMART = anything the guest reads or that needs judgment (composition, tone,
// multi-fact reasoning). FAST = mechanical work (classify, extract, summarize).
export const MODEL_SMART = process.env.MODEL_SMART || "gpt-4.1";
export const MODEL_FAST = process.env.MODEL_FAST || "gpt-4.1-mini";
// nano tier: the router's classify call is tiny and structural — quarter price
export const MODEL_NANO = process.env.MODEL_NANO || "gpt-4.1-nano";

export const llmReady = !!OPENAI_API_KEY;

export function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

// guest-facing links ride on the branded dashboard domain, not raw storage URLs
export const PUBLIC_BASE = process.env.PUBLIC_BASE || "https://flows-production-e528.up.railway.app";

// ...and they must say WHICH restaurant they belong to. /menu.pdf and /receipt/:code
// resolve the tenant server-side; without the slug they fall back to the default
// restaurant, which means handing one restaurant's guest another's menu.
export const publicLink = (path, slug) =>
  `${PUBLIC_BASE}${path}${slug ? `?r=${encodeURIComponent(slug)}` : ""}`;
