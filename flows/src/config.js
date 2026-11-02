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
// SMART = gpt-6.1-terra since 2026-11-02: half of gpt-4.1's price ($1/$5 vs $2/$8, cached input
// 5%), 64/64 persona conversations with the 4.1 prompts untouched — docs/MODEL_BENCHMARK_2026-11-01.md.
// gpt-4.1 itself shuts down 2027-01-14.
export const MODEL_SMART = process.env.MODEL_SMART || "gpt-6.1-terra";
export const MODEL_FAST = process.env.MODEL_FAST || "gpt-4.1-mini";
// nano tier: the router's classify call is tiny and structural. gpt-4.1-nano was shut down
// by OpenAI on 2026-10-23 (every classify call 404'd until 2026-11-01); the whole gpt-4.1
// family has a shutdown date of 2027-01-14 — see docs/MODEL_BENCHMARK_2026-11-01.md.
export const MODEL_NANO = process.env.MODEL_NANO || "gpt-4.1-mini";

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
