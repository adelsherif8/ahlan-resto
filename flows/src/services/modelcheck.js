// MODEL WATCH — OpenAI retires models quietly: the model object carries a `shutdown_date`,
// and after it every call 404s with "has been deprecated". gpt-4.1-nano went away on
// 2026-10-23 and the router's classify call failed for nine days before a local run
// tripped over it — /health said ok because it never asked OpenAI anything. This asks:
// at boot and every six hours, each configured model is looked up; a retired model or
// one inside its last 90 days is logged loudly and shown in /health as `models`; the ntfy
// push fires from production only, once a day, for a retired model or one in its last 30 days.
import { OPENAI_API_KEY, MODEL_SMART, MODEL_FAST, MODEL_NANO, log } from "../config.js";

export const PUSH_DAYS = 30; // phone push only inside the last month (or once retired)
export const WARN_DAYS = 90; // a model swap is a benchmark + prompt tune, not an env flip — three months of notice

// pure: one model object (or a 404) → the verdict the alarm and /health print
export function assessModel(role, model, info, now = Date.now()) {
  if (!info || info.error) return { role, model, ok: false, status: "retired", error: info?.error?.message || "not found" };
  const shutdown = info.shutdown_date || null;
  if (!shutdown) return { role, model, ok: true, status: "ok", shutdown_date: null, days_left: null };
  const days = Math.floor((Date.parse(`${shutdown}T00:00:00Z`) - now) / 86400e3);
  if (days < 0) return { role, model, ok: false, status: "retired", shutdown_date: shutdown, days_left: days };
  return { role, model, ok: true, status: days <= WARN_DAYS ? "retiring" : "ok", shutdown_date: shutdown, days_left: days };
}

export function configuredModels() {
  return [["smart", MODEL_SMART], ["fast", MODEL_FAST], ["nano", MODEL_NANO]];
}

export async function checkModels(fetchImpl = fetch) {
  const out = [];
  for (const [role, model] of configuredModels()) {
    try {
      const res = await fetchImpl(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } });
      const info = await res.json().catch(() => ({}));
      out.push(assessModel(role, model, res.ok ? info : { error: info.error || { message: `HTTP ${res.status}` } }));
    } catch (e) {
      // network trouble is not a retirement — say so, never alarm on it
      out.push({ role, model, ok: true, status: "unknown", error: e.message });
    }
  }
  return out;
}

let last = null;
const alarmedAt = new Map(); // model → last ntfy time
export function lastModelCheck() { return last; }

export async function modelWatch() {
  if (!OPENAI_API_KEY) return null;
  const results = await checkModels();
  last = { at: new Date().toISOString(), models: results };
  for (const r of results) {
    if (r.status === "ok" || r.status === "unknown") continue;
    const line = r.status === "retired"
      ? `MODEL RETIRED: ${r.role}=${r.model} — every call 404s. Set MODEL_${r.role.toUpperCase()} to a live model now.`
      : `MODEL RETIRING: ${r.role}=${r.model} shuts down ${r.shutdown_date} (${r.days_left} days). Benchmark a replacement.`;
    log(`🚨 ${line}`);
    // The phone alarm is for PRODUCTION only (a local test server boots many times a day
    // and shares the topic), and only when it is actionable NOW: a retired model, or one
    // inside its last 30 days. A far-off retirement lives in the log and /health.
    const topic = process.env.NTFY_TOPIC;
    const isProd = !!process.env.RAILWAY_ENVIRONMENT;
    const urgent = r.status === "retired" || (r.days_left != null && r.days_left <= PUSH_DAYS);
    const prev = alarmedAt.get(r.model) || 0;
    if (topic && isProd && urgent && Date.now() - prev > 86400e3) {
      alarmedAt.set(r.model, Date.now());
      await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: { Title: r.status === "retired" ? "Munadim: OpenAI model RETIRED" : "Munadim: OpenAI model retiring", Priority: r.status === "retired" ? "urgent" : "high", Tags: "rotating_light" },
        body: line,
      }).catch(() => {});
    }
  }
  return last;
}
