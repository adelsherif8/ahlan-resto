// OpenAI chat wrapper with token usage + cost accounting per call.
// Every call returns { value, __usage: { model, tokens_in, tokens_out, cost_usd } }
// so the flow engine can attribute cost to the node that made the call.
import { OPENAI_API_KEY, llmReady, MODEL_SMART, MODEL_FAST } from "../config.js";

// USD per 1M tokens — [input $/1M, output $/1M, cached-input multiplier].
// Verified against OpenAI's pricing page on 2026-08-14. Only models we actually run
// (or are about to benchmark) live here: a wrong number silently corrupts every trace,
// every metric and any model comparison built on them, which is worse than no number.
// The flagship/mid tiers (gpt-5.4, gpt-5.6-terra, gpt-5.6-sol) are deliberately absent —
// they cost multiples of what we pay now and we have no plan to run them.
const PRICES = {
  "gpt-4.1": [2.0, 8.0, 0.25],          // SMART — guest-facing replies
  "gpt-4.1-mini": [0.4, 1.6, 0.25],     // FAST — extract, classify, summarize
  "gpt-4.1-nano": [0.1, 0.4, 0.25],     // NANO — router classify
  "gpt-4o-mini": [0.15, 0.6, 0.5],      // photo classification (media.js)
  "gpt-5.6-luna": [0.2, 1.2, 0.1],      // cheap tier, Jul 2026 — FAST candidate
  "deepseek-chat": [0.27, 1.1, 0.5],    // dormant budget lane
};

// OpenAI automatically caches identical prompt prefixes over ~1024 tokens and
// bills those at half price. Our system prompts are a stable per-restaurant block
// (persona, facts, menu) followed by the volatile guest part, so most of the input
// is cached — pricing it at full rate would overstate spend and hide the win.
function cost(model, tin, tout, cached = 0) {
  const [pi, po, cm = 0.5] = PRICES[model] || [1, 4, 0.5];
  const fresh = Math.max(0, tin - cached);
  return (fresh * pi + cached * pi * cm + tout * po) / 1e6;
}

const RETRYABLE = new Set([429, 500, 502, 503, 529]);

// Optional budget lane for EXTRACTION calls (hosted, no GPU ops): set
// DEEPSEEK_API_KEY on the service and ai.budget_extraction=true in the
// restaurant config. Dormant without both; falls back to OpenAI on any error.
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const BUDGET_MODEL = process.env.BUDGET_MODEL || "deepseek-chat";
export function budgetExtractionAvailable() { return !!DEEPSEEK_API_KEY; }

async function chat(model, messages, opts = {}) {
  const { json = false, temperature = 0.4, maxTokens = 700 } = opts;
  if (!llmReady) throw new Error("OPENAI_API_KEY not set");
  let res;
  let useModel = model;
  let flexFailed = false;
  let endpoint = "https://api.openai.com/v1/chat/completions";
  let authKey = OPENAI_API_KEY;
  if (opts.budget && DEEPSEEK_API_KEY) {
    endpoint = "https://api.deepseek.com/chat/completions";
    authKey = DEEPSEEK_API_KEY;
    useModel = BUDGET_MODEL;
  }
  for (let attempt = 0; ; attempt++) {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${authKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: useModel,
        messages,
        // gpt-5.x: temperature is rejected and reasoning must be pinned to minimal —
        // a chat guest waits ~2s, not for a thinking budget. max_completion_tokens
        // replaced max_tokens there; older models keep the classic params.
        ...(useModel.startsWith("gpt-5")
          ? { reasoning_effort: "none", max_completion_tokens: maxTokens }
          : { temperature, max_tokens: maxTokens }),
        ...(json ? { response_format: { type: "json_object" } } : {}),
        // background work (summaries, tidy, notes) rides the cheap slow lane;
        // unsupported-model errors retry without it below
        ...(opts.flex && !flexFailed ? { service_tier: "flex" } : {}),
      }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (res.ok) break;
    // budget provider hiccup → fall straight back to OpenAI, never retry it
    if (endpoint.includes("deepseek")) {
      endpoint = "https://api.openai.com/v1/chat/completions";
      authKey = OPENAI_API_KEY;
      useModel = model;
      continue;
    }
    // flex tier not supported for this model/account → plain call, same attempt
    if (opts.flex && !flexFailed && res.status === 400) { flexFailed = true; continue; }
    // rate-limited on the big model → a smaller reply beats NO reply, every time
    if (res.status === 429 && useModel === MODEL_SMART) { useModel = MODEL_FAST; continue; }
    if (attempt >= 2 || (!RETRYABLE.has(res.status) && res.status !== 0)) break;
    await new Promise((r) => setTimeout(r, res.status === 429 ? 2500 : 800));
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }
  const model_ = useModel;
  const data = await res.json();
  const usage = data.usage || {};
  const cached = usage.prompt_tokens_details?.cached_tokens || 0;
  return {
    text: data.choices?.[0]?.message?.content || "",
    __usage: {
      // model_ , not model: a 429 degrade runs the cheaper model, and billing it
      // at the expensive one's rate makes the cost report wrong
      model: model_,
      tokens_in: usage.prompt_tokens || 0,
      tokens_out: usage.completion_tokens || 0,
      tokens_cached: cached,
      cost_usd: cost(model_, usage.prompt_tokens || 0, usage.completion_tokens || 0, cached),
    },
  };
}

export async function chatText(model, system, user, opts = {}) {
  const r = await chat(model, [
    { role: "system", content: system },
    ...(Array.isArray(user) ? user : [{ role: "user", content: user }]),
  ], opts);
  return { value: r.text.trim(), __usage: r.__usage };
}

export async function chatJSON(model, system, user, opts = {}) {
  const messages = [
    { role: "system", content: system },
    ...(Array.isArray(user) ? user : [{ role: "user", content: user }]),
  ];
  const r = await chat(model, messages, { ...opts, json: true });
  try {
    return { value: JSON.parse(r.text), __usage: r.__usage };
  } catch {}
  // invalid JSON → one corrective re-ask (cost of both calls attributed to the node)
  const r2 = await chat(model, [
    ...messages,
    { role: "assistant", content: r.text },
    { role: "user", content: "That was not valid JSON. Reply again with ONLY the valid JSON object — no prose, no code fences." },
  ], { ...opts, json: true });
  const usage = {
    model,
    tokens_in: r.__usage.tokens_in + r2.__usage.tokens_in,
    tokens_out: r.__usage.tokens_out + r2.__usage.tokens_out,
    cost_usd: r.__usage.cost_usd + r2.__usage.cost_usd,
  };
  try {
    return { value: JSON.parse(r2.text), __usage: usage };
  } catch {
    throw new Error(`LLM returned invalid JSON twice: ${r2.text.slice(0, 120)}`);
  }
}
