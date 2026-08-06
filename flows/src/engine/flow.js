// Tiny flow runtime — the n8n replacement.
// defineFlow({ name, description, trigger, nodes, run }) registers a flow.
//   trigger: { icon, label }   e.g. { icon: "whatsapp", label: "WhatsApp message" }
//   nodes:   [{ id, label, icon }]
// runFlow records every node's INPUT and OUTPUT (full JSON, truncated), status, ms,
// tokens and cost — served to the Ahlan Ops console for the n8n-style canvas.
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
function newExecution(flowName, sessionId, trigger) {
  const exec = {
    id: `ex_${Date.now()}_${++seq}`,
    flow: flowName,
    session_id: sessionId,
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
  const exec = newExecution(name, ctx.sessionId || "unknown", parentExec ? `sub:${parentExec.flow}` : ctx.trigger || "webhook");
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
  db.from("flow_executions")
    .upsert({
      id: row.id, flow: row.flow, session_id: row.session_id, trigger: row.trigger,
      status: row.status, error: row.error, started_at: row.started_at,
      finished_at: row.finished_at, duration_ms: row.duration_ms,
      tokens_in: row.tokens_in, tokens_out: row.tokens_out, cost_usd: row.cost_usd,
      nodes: row.nodes, children: row.children, parent_id: row.parent_id,
    })
    .then(({ error }) => {
      if (error && !persistExecution.warned) {
        persistExecution.warned = true;
        log("execution persistence unavailable (run migration 003):", error.message);
      }
    });
}

// DB-backed reads (merged with the in-memory ring by the server)
export async function listExecutionsDb(db, { flow, limit = 50 } = {}) {
  try {
    let q = db.from("flow_executions").select("id,flow,session_id,trigger,status,error,started_at,finished_at,duration_ms,tokens_in,tokens_out,cost_usd,children,parent_id").order("started_at", { ascending: false }).limit(limit);
    if (flow) q = q.eq("flow", flow);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((e) => ({ ...e, nodes: [] , _db: true }));
  } catch {
    return [];
  }
}

export async function getExecutionDb(db, id) {
  try {
    const { data } = await db.from("flow_executions").select("*").eq("id", id).maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}
