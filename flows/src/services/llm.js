// OpenAI chat wrapper with token usage + cost accounting per call.
// Every call returns { value, __usage: { model, tokens_in, tokens_out, cost_usd } }
// so the flow engine can attribute cost to the node that made the call.
import { OPENAI_API_KEY, llmReady } from "../config.js";

// USD per 1M tokens (input, output)
const PRICES = {
  "gpt-4.1": [2.0, 8.0],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4o-mini": [0.15, 0.6],
};

function cost(model, tin, tout) {
  const [pi, po] = PRICES[model] || [1, 4];
  return (tin * pi + tout * po) / 1e6;
}

async function chat(model, messages, { json = false, temperature = 0.4, maxTokens = 700 } = {}) {
  if (!llmReady) throw new Error("OPENAI_API_KEY not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const usage = data.usage || {};
  return {
    text: data.choices?.[0]?.message?.content || "",
    __usage: {
      model,
      tokens_in: usage.prompt_tokens || 0,
      tokens_out: usage.completion_tokens || 0,
      cost_usd: cost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0),
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
  const r = await chat(model, [
    { role: "system", content: system },
    ...(Array.isArray(user) ? user : [{ role: "user", content: user }]),
  ], { ...opts, json: true });
  let value = {};
  try {
    value = JSON.parse(r.text);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${r.text.slice(0, 120)}`);
  }
  return { value, __usage: r.__usage };
}
