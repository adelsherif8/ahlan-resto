// OpenAI chat wrapper with token usage + cost accounting per call.
// Every call returns { value, __usage: { model, tokens_in, tokens_out, cost_usd } }
// so the flow engine can attribute cost to the node that made the call.
import { OPENAI_API_KEY, llmReady, MODEL_SMART, MODEL_FAST } from "../config.js";

// USD per 1M tokens (input, output)
const PRICES = {
  "gpt-4.1": [2.0, 8.0],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4o-mini": [0.15, 0.6],
};

// OpenAI automatically caches identical prompt prefixes over ~1024 tokens and
// bills those at half price. Our system prompts are a stable per-restaurant block
// (persona, facts, menu) followed by the volatile guest part, so most of the input
// is cached — pricing it at full rate would overstate spend and hide the win.
const CACHED_DISCOUNT = 0.5;
function cost(model, tin, tout, cached = 0) {
  const [pi, po] = PRICES[model] || [1, 4];
  const fresh = Math.max(0, tin - cached);
  return (fresh * pi + cached * pi * CACHED_DISCOUNT + tout * po) / 1e6;
}

const RETRYABLE = new Set([429, 500, 502, 503, 529]);

async function chat(model, messages, { json = false, temperature = 0.4, maxTokens = 700 } = {}) {
  if (!llmReady) throw new Error("OPENAI_API_KEY not set");
  let res;
  let useModel = model;
  for (let attempt = 0; ; attempt++) {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: useModel,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (res.ok) break;
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
