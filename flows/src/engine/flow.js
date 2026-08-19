// Tiny flow runtime — the n8n replacement.
// defineFlow({ name, description, trigger, nodes, run }) registers a flow.
//   trigger: { icon, label }   e.g. { icon: "whatsapp", label: "WhatsApp message" }
//   nodes:   [{ id, label, icon }]
// runFlow records every node's INPUT and OUTPUT (full JSON, truncated), status, ms,
// tokens and cost — served to the Munadim Ops console for the n8n-style canvas.
import { log } from "../config.js";

const registry = new Map();
const executions = []; // ring buffer, newest first
const MAX_EXECUTIONS = 300;
const IO_LIMIT = 6000; // chars per input/output snapshot

export function defineFlow(def) {
  def.nodes = (def.nodes || []).map((n) => (typeof n === "string" ? { id: n, label: n, icon: "box" } : { label: n.id, ...n }));
  def.trigger = def.trigger || { icon: "zap", label: "called by another flow" };
  registry.set(def.name, def);
  return def;
}

export function listFlows() {
  return [...registry.values()].map((f) => ({
    name: f.name,
    description: f.description || "",
    trigger: f.trigger,
    nodes: f.nodes,
  }));
}

/**
 * Is this session ours rather than a guest's? Cost figures are dominated by our own
 * traffic — on 2026-08-17 the friendly card read $6.35 across 1,048 runs, of which real
 * guests were 4 turns and $0.01; the rest was five regression-suite passes (~700 runs
 * each) and fixture conversations. Anything that isn't a real WhatsApp number is test:
 *   web:regress-*        the 113-case suite
 *   web:convo-* / test-* the conversation harness
 *   any other web:*      the ops Test Chat — a browser, never a guest
 *   +201555*             every fixture phone
 */
export function isTestSession(sessionId) {
  const s = String(sessionId || "");
  return s.startsWith("web:") || /^\+?201555/.test(s);
}

export function listExecutions({ flow, limit = 50 } = {}) {
  let rows = executions;
  if (flow) rows = rows.filter((e) => e.flow === flow);
  return rows.slice(0, limit).map(execSummary);
}

export function getExecution(id) {
  return executions.find((e) => e.id === id) || null;
}

function execSummary(e) {
  // list view: strip heavy input/output payloads
  const { _currentNode, ...rest } = e;
  return {
    ...rest,
    is_test: isTestSession(e.session_id),
    nodes: e.nodes.map((n) => ({ ...n, input: undefined, output: undefined })),
  };
}

function snapshot(value) {
  if (value === undefined) return null;
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value, null, 1);
    return s.length > IO_LIMIT ? s.slice(0, IO_LIMIT) + `\n… [truncated, ${s.length} chars total]` : s;
  } catch {
    return String(value).slice(0, IO_LIMIT);
  }
}

let seq = 0;
function newExecution(flowName, sessionId, trigger, restaurant = null) {
  const exec = {
    id: `ex_${Date.now()}_${++seq}`,
    flow: flowName,
    session_id: sessionId,
    // Tagged here so a just-finished run in the in-memory ring carries its restaurant.
    // Without it those rows showed a blank badge and slipped through a restaurant filter.
    restaurant,
    trigger,
    status: "running",
    error: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    duration_ms: null,
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    nodes: [], // { name, status, ms, tokens_in, tokens_out, tokens_cached, cost_usd, model, error, input, output }
    children: [], // { flow, execution_id } — sub-flow links
    parent_id: null,
  };
  executions.unshift(exec);
  if (executions.length > MAX_EXECUTIONS) executions.pop();
  return exec;
}

export async function runFlow(name, ctx, input, parentExec = null) {
  const def = registry.get(name);
  if (!def) throw new Error(`Unknown flow: ${name}`);
  const exec = newExecution(name, ctx.sessionId || "unknown", parentExec ? `sub:${parentExec.flow}` : ctx.trigger || "webhook", ctx?.tenant?.config?.slug || null);
  if (parentExec) {
    exec.parent_id = parentExec.id;
    parentExec.children.push({ flow: name, execution_id: exec.id });
  }
  const t0 = Date.now();

  const f = {
    exec,
    node: async (nodeName, fn, opts = {}) => {
      const n = {
        name: nodeName, status: "running", ms: 0,
        tokens_in: 0, tokens_out: 0, tokens_cached: 0, cost_usd: 0, model: null, error: null,
        input: snapshot(opts.input), output: null,
      };
      exec.nodes.push(n);
      exec._currentNode = nodeName;
      const s = Date.now();
      try {
        const result = await fn();
        n.status = "ok";
        n.ms = Date.now() - s;
        if (result && result.__usage) {
          n.tokens_in = result.__usage.tokens_in;
          n.tokens_out = result.__usage.tokens_out;
          // how much of the prompt the model served from its cache — without this
          // the traces report 0 forever and every cache measurement is a lie
          n.tokens_cached = result.__usage.tokens_cached || 0;
          n.cost_usd = result.__usage.cost_usd;
          n.model = result.__usage.model;
          exec.tokens_in += n.tokens_in;
          exec.tokens_out += n.tokens_out;
          exec.cost_usd = round6(exec.cost_usd + n.cost_usd);
          n.output = snapshot(result.value);
        } else {
          n.output = snapshot(result);
        }
        return result;
      } catch (err) {
        n.status = "error";
        n.ms = Date.now() - s;
        n.error = String(err.message || err).slice(0, 800);
        throw err;
      }
    },
    flow: async (subName, subInput) => {
      const spawnedBy = exec._currentNode || null;
      const child = await runFlow(subName, ctx, subInput, exec);
      const link = exec.children[exec.children.length - 1];
      if (link) link.node = spawnedBy;
      exec.tokens_in += child.exec.tokens_in;
      exec.tokens_out += child.exec.tokens_out;
      exec.cost_usd = round6(exec.cost_usd + child.exec.cost_usd);
      if (child.exec.status === "error") throw new Error(`sub-flow ${subName}: ${child.exec.error}`);
      return child.result;
    },
  };

  try {
    const result = await def.run(f, ctx, input);
    exec.status = "ok";
    return { result, exec };
  } catch (err) {
    exec.status = "error";
    exec.error = String(err.message || err).slice(0, 800);
    log(`flow ${name} ERROR:`, exec.error);
    if (process.env.DEBUG_STACKS) log(err.stack);
    return { result: null, exec, error: err };
  } finally {
    exec.finished_at = new Date().toISOString();
    exec.duration_ms = Date.now() - t0;
    persistExecution(ctx, exec); // fire-and-forget; survives redeploys once 003 migration ran
  }
}

function persistExecution(ctx, exec) {
  const db = ctx?.tenant?.db;
  if (!db) return;
  const { _currentNode, ...row } = exec;
  // This run's OWN cost, excluding sub-flows. `cost_usd` deliberately includes children
  // (the `flow:` helper rolls them up so a parent shows the true cost of the turn), which
  // means summing cost_usd across rows counts one LLM call once per level of nesting —
  // it read $78.81 for a month that cost $33.57. Storing the own-cost here makes every
  // aggregate a plain sum over an indexed range: correct by construction, and it removed
  // a 12-second jsonb expansion from the read path. See migrations 035 and 040.
  const own = (row.nodes || []).reduce(
    (a, n) => ({
      cost: a.cost + (Number(n?.cost_usd) || 0),
      tin: a.tin + (Number(n?.tokens_in) || 0),
      tout: a.tout + (Number(n?.tokens_out) || 0),
    }),
    { cost: 0, tin: 0, tout: 0 }
  );
  const base = {
    id: row.id, flow: row.flow, session_id: row.session_id, trigger: row.trigger,
    status: row.status, error: row.error, started_at: row.started_at,
    finished_at: row.finished_at, duration_ms: row.duration_ms,
    tokens_in: row.tokens_in, tokens_out: row.tokens_out, cost_usd: row.cost_usd,
    nodes: row.nodes, children: row.children, parent_id: row.parent_id,
  };
  const withOwn = {
    ...base,
    own_cost_usd: round6(own.cost), own_tokens_in: own.tin, own_tokens_out: own.tout,
  };

  // The own_* columns arrive with migration 040. If flows ships before the migration runs,
  // PostgREST rejects the ENTIRE upsert for an unknown column — which would silently stop
  // persisting every trace on every tenant. So a failure of that shape falls back to the
  // old shape…
  //
  // …but the fallback EXPIRES. It used to latch for the life of the process, which meant a
  // container that started before the migration kept writing NULL own_cost_usd forever —
  // 164 such rows appeared during one deploy's overlap window, because the old container
  // was still serving. A transient condition must never become a permanent one: retry the
  // full payload every RETRY_OWN_MS so any process heals itself after the migration lands.
  const RETRY_OWN_MS = 5 * 60_000;
  const skipOwn = persistExecution.noOwnAt && Date.now() - persistExecution.noOwnAt < RETRY_OWN_MS;
  const write = (payload) => db.from("flow_executions").upsert(payload);
  write(skipOwn ? base : withOwn).then(({ error }) => {
    if (!error) {
      if (!skipOwn) persistExecution.noOwnAt = null;   // column is there — stop skipping
      return;
    }
    const missingColumn = /column .* does not exist|own_cost_usd|own_tokens/i.test(String(error.message));
    if (missingColumn && !skipOwn) {
      persistExecution.noOwnAt = Date.now();
      log(`flow_executions has no own_cost_usd column — writing without it, retrying in ${RETRY_OWN_MS / 60000}min. Run migration 040.`);
      write(base).then(({ error: e2 }) => {
        if (e2 && !persistExecution.warned) {
          persistExecution.warned = true;
          log("execution persistence unavailable (run migration 003):", e2.message);
        }
      });
      return;
    }
    if (!persistExecution.warned) {
      persistExecution.warned = true;
      log("execution persistence unavailable (run migration 003):", error.message);
    }
  });
}

// DB-backed reads (merged with the in-memory ring by the server)
export async function listExecutionsDb(db, { flow, limit = 50, since = null, status = null, q: search = null } = {}) {
  try {
    let q = db.from("flow_executions").select("id,flow,session_id,trigger,status,error,started_at,finished_at,duration_ms,tokens_in,tokens_out,cost_usd,children,parent_id").order("started_at", { ascending: false }).limit(limit);
    if (flow) q = q.eq("flow", flow);
    if (since) q = q.gt("started_at", since); // incremental polling — see /api/executions
    // Filters belong HERE, not in the browser. Filtering the 60 rows that happened to be
    // fetched meant picking a restaurant with no rows in that page returned nothing at
    // all, while thousands of matching runs sat in the table unqueried.
    if (status) q = q.eq("status", status);
    if (search) q = q.or(`session_id.ilike.%${search}%,id.ilike.%${search}%,error.ilike.%${search}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((e) => ({ ...e, is_test: isTestSession(e.session_id), nodes: [], _db: true }));
  } catch {
    return [];
  }
}

export async function getExecutionDb(db, id) {
  try {
    const { data } = await db.from("flow_executions").select("*").eq("id", id).maybeSingle();
    return data ? { ...data, is_test: isTestSession(data.session_id) } : null;
  } catch {
    return null;
  }
}

function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}
