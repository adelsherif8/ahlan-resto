import express from "express";
import cors from "cors";
import { PORT, log, llmReady } from "./config.js";
import { resolveRestaurant } from "./services/tenant.js";
import { startFlushWorker, setTyping, bootSweep, drainAll } from "./services/buffer.js";
import { runFlow, listFlows, listExecutions, getExecution, listExecutionsDb, getExecutionDb } from "./engine/flow.js";
import { verifyHandshake, verifySignature, parseEnvelope } from "./services/whatsapp.js";
import { metrics } from "./services/metrics.js";
import { runRegression, regressionStatus } from "./services/regression.js";
import { handleFlushFailure, deliverStaffReply } from "./flows/buffering.js";
import { getSession } from "./services/chatlog.js";

// register flows
import "./flows/friendly.js";
import "./flows/master.js";
import "./flows/buffering.js";
import "./flows/janitor.js";

const app = express();
app.use(cors());
// keep raw body for WhatsApp signature verification
app.use(express.json({ limit: "4mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.get("/health", async (_req, res) => {
  try {
    const t = await resolveRestaurant();
    res.json({ ok: true, llm: llmReady, restaurant: t.record.name });
  } catch (e) {
    res.json({ ok: false, llm: llmReady, error: e.message });
  }
});

// ================= WhatsApp webhook (dormant until WA_TOKEN set) =================
app.get("/api/wa/webhook", (req, res) => {
  const challenge = verifyHandshake(req.query);
  if (challenge) return res.send(challenge);
  res.sendStatus(403);
});

app.post("/api/wa/webhook", async (req, res) => {
  res.sendStatus(200); // ack fast — Meta retries slow webhooks
  try {
    if (!verifySignature(req.rawBody, req.headers["x-hub-signature-256"])) {
      log("WA webhook: bad signature, dropped");
      return;
    }
    const { events, statuses } = parseEnvelope(req.body);
    if (statuses.length) log(`WA statuses: ${statuses.map((s) => s.status).join(",")}`);
    for (const event of events) {
      const tenant = await resolveRestaurant(); // v1 single-tenant; per-wpid routing when multi-restaurant
      const ctx = { sessionId: `+${event.from}`, tenant, channel: "whatsapp", trigger: "whatsapp" };
      await runFlow("ingest", ctx, { event });
    }
  } catch (e) {
    log("WA webhook error:", e.message);
  }
});

// ================= web live chat (ops test chat + future guest widget) =================
app.post("/api/web/send", async (req, res) => {
  try {
    const { sessionId, message } = req.body || {};
    if (!sessionId || !message) return res.status(400).json({ error: "sessionId and message required" });
    const tenant = await resolveRestaurant();
    const ctx = { sessionId, tenant, channel: "web", trigger: "web" };
    const { exec } = await runFlow("ingest", ctx, { message, messageId: req.body.messageId || null });
    res.json({ accepted: true, executionId: exec.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/web/typing", (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  setTyping(sessionId);
  res.json({ ok: true });
});

// Durable poll: reads chat_messages from the tenant DB (survives redeploys,
// shows the same thread the restaurant dashboard sees — incl. staff replies).
app.get("/api/web/poll", async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  try {
    const tenant = await resolveRestaurant();
    const { data, error } = await tenant.db
      .from("chat_messages")
      .select("sender,message,media_url,media_type,created_at")
      .eq("session_id", String(sessionId))
      .order("created_at", { ascending: true })
      .limit(60);
    if (error) throw new Error(error.message);
    res.json((data || []).map((m) => ({ sender: m.sender, message: m.message, at: m.created_at, media_url: m.media_url, media_type: m.media_type })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= staff reply relay (called by the restaurant backend) =================
// Delivers a dashboard staff reply to the guest's channel (WhatsApp when live; web needs
// no push — the durable poll reads chat_messages) and appends it to AI history so the
// bot knows what the team promised when it's handed back. Token-locked like ops.
app.post("/api/staff/reply", (req, res, next) => opsAuth(req, res, next), async (req, res) => {
  try {
    const { sessionId, message } = req.body || {};
    if (!sessionId || !message) return res.status(400).json({ error: "sessionId and message required" });
    const tenant = await resolveRestaurant();
    const session = await getSession(tenant.db, String(sessionId));
    const channel = session?.channel || (String(sessionId).startsWith("web:") ? "web" : "whatsapp");
    await deliverStaffReply({ sessionId: String(sessionId), tenant, channel }, String(message).slice(0, 3500));
    res.json({ delivered: true, channel });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= ops console (internal — token locked) =================
const OPS_TOKEN = process.env.OPS_TOKEN || "";
function opsAuth(req, res, next) {
  if (!OPS_TOKEN) return next(); // dev mode
  if (req.headers["x-ops-token"] === OPS_TOKEN) return next();
  res.status(401).json({ error: "ops token required" });
}
app.get("/api/ops/verify", opsAuth, (_req, res) => res.json({ ok: true }));
app.get("/api/metrics", opsAuth, async (_req, res) => {
  const m = metrics();
  // conversation outcomes from the tenant DB (supabase-js returns errors, doesn't throw —
  // a count is just null until the relevant migration has run)
  try {
    const t = await resolveRestaurant();
    const cnt = async (table, apply) => {
      let q = t.db.from(table).select("id", { count: "exact", head: true });
      if (apply) q = apply(q);
      const { count } = await q;
      return count ?? 0;
    };
    m.sessions_total = await cnt("chat_sessions");
    m.handoffs_open = await cnt("chat_sessions", (q) => q.eq("needs_attention", true));
    m.staff_takeovers = await cnt("chat_sessions", (q) => q.eq("ai_enabled", false));
    m.replies_rated_up = await cnt("chat_messages", (q) => q.eq("rating", 1));
    m.replies_rated_down = await cnt("chat_messages", (q) => q.eq("rating", -1));
  } catch {}
  res.json(m);
});

app.post("/api/ops/run-regression", opsAuth, (_req, res) => {
  runRegression(); // async — poll status
  res.json({ started: true });
});
app.get("/api/ops/regression", opsAuth, (_req, res) => res.json(regressionStatus()));

app.post("/api/ops/run-janitor", opsAuth, async (_req, res) => {
  try {
    const tenant = await resolveRestaurant();
    const { exec } = await runFlow("janitor", { sessionId: "janitor", tenant, trigger: "manual" }, {});
    res.json({ ok: exec.status === "ok", executionId: exec.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/flows", opsAuth, (_req, res) => {
  const flows = listFlows();
  const execs = listExecutions({ limit: 300 });
  res.json(
    flows.map((fl) => {
      const runs = execs.filter((e) => e.flow === fl.name);
      const ok = runs.filter((r) => r.status === "ok").length;
      const errors = runs.filter((r) => r.status === "error").length;
      const cost = runs.reduce((s, r) => s + r.cost_usd, 0);
      const avgMs = runs.length ? Math.round(runs.reduce((s, r) => s + (r.duration_ms || 0), 0) / runs.length) : 0;
      return { ...fl, runs: runs.length, ok, errors, cost_usd: Math.round(cost * 1e6) / 1e6, avg_ms: avgMs };
    })
  );
});

app.get("/api/executions", opsAuth, async (req, res) => {
  const flow = req.query.flow ? String(req.query.flow) : undefined;
  const limit = Number(req.query.limit) || 50;
  const mem = listExecutions({ flow, limit });
  let merged = mem;
  try {
    const tenant = await resolveRestaurant();
    const dbRows = await listExecutionsDb(tenant.db, { flow, limit });
    const seen = new Set(mem.map((e) => e.id));
    merged = [...mem, ...dbRows.filter((e) => !seen.has(e.id))]
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
      .slice(0, limit);
  } catch {}
  res.json(merged);
});

app.get("/api/executions/:id", opsAuth, async (req, res) => {
  let e = getExecution(req.params.id);
  if (!e) {
    try {
      const tenant = await resolveRestaurant();
      e = await getExecutionDb(tenant.db, req.params.id);
    } catch {}
  }
  if (!e) return res.status(404).json({ error: "Not found" });
  res.json(e);
});

// ================= workers =================
async function flushHandler(sessionId, channel = "web") {
  const tenant = await resolveRestaurant();
  const ctx = { sessionId, tenant, channel, trigger: "buffer-flush" };
  const { error } = await runFlow("respond", ctx, {});
  if (error) await handleFlushFailure(ctx, error);
}

startFlushWorker(flushHandler);

// hourly janitor
setInterval(async () => {
  try {
    const tenant = await resolveRestaurant();
    await runFlow("janitor", { sessionId: "janitor", tenant, trigger: "schedule" }, {});
  } catch (e) {
    log("janitor error:", e.message);
  }
}, 3600_000);

// boot sweep: flush bursts stranded by a previous restart
resolveRestaurant()
  .then((t) => bootSweep(t.db, flushHandler))
  .catch((e) => log("boot sweep skipped:", e.message));

// graceful drain on redeploy
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    log(`${sig} — draining pending bursts…`);
    await drainAll(flushHandler).catch(() => {});
    process.exit(0);
  });
}

app.listen(PORT, () => log(`ahlan-resto flows on :${PORT} (llm: ${llmReady ? "ready" : "MISSING KEY"})`));
