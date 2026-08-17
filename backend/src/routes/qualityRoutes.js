import { Router } from "express";
import { requireAuth, allowRoles } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

// Bot quality — the feedback loop that was missing. Staff have been rating AI replies
// 👍/👎 in Chats since migration 005 and nothing ever read those ratings back; the same
// went for handoff reasons and questions the bot couldn't answer. This route gathers
// every "the bot got it wrong" signal in one place so a manager can act on it:
//   ratings   — chat_messages.rating written by staff in the Chats page
//   handoffs  — chat_sessions.needs_attention / handoff_reason (bot gave up)
//   unanswered— suggested_faqs the bot filed because it had no answer
//   engine    — flow_executions failures and latency (did it break, or was it just wrong?)
//
// Read-only: fixing things happens on the pages that own them (Chats, Settings → FAQs).

const isTest = (v) => /^web:(regress|convo|test)-/i.test(String(v || ""));

// Admin-only: this is an internal tool (headed for the ops console), not a staff page.
router.get("/", allowRoles("admin"), async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const sinceMs = Date.now() - days * 86400000;
    const sinceISO = new Date(sinceMs).toISOString();
    const recent = (ts) => new Date(ts).getTime() > sinceMs;

    const [rated, sessions, faqs, engine] = await Promise.all([
      ratedMessages(req, sinceISO),
      req.repo.list("chat_sessions", { order: "last_message_at" }).catch(() => []),
      req.repo.list("suggested_faqs", { order: "created_at" }).catch(() => []),
      engineHealth(req, sinceISO),
    ]);

    // ---- ratings ------------------------------------------------------------
    const window = rated.filter((m) => recent(m.created_at) && !isTest(m.session_id));
    const up = window.filter((m) => Number(m.rating) > 0);
    const down = window.filter((m) => Number(m.rating) < 0);

    // a 👎 alone is not actionable — what the guest asked right before it is the
    // whole story, so pull the preceding guest turn for each flagged reply
    const bad = down.slice(0, 40);
    const context = await precedingGuestTurns(req, bad);
    const names = new Map(
      (await req.repo.list("diners").catch(() => [])).map((d) => [d.phone_number, d.name || d.wa_profile_name])
    );

    // ---- handoffs -----------------------------------------------------------
    const live = sessions.filter((s) => !isTest(s.session_id));
    const handedOff = live.filter((s) => recent(s.last_message_at || s.created_at) &&
      (s.needs_attention || s.handoff_reason || s.ai_enabled === false));
    const reasons = {};
    for (const s of handedOff) {
      const r = (s.handoff_reason || "unspecified").trim();
      reasons[r] = (reasons[r] || 0) + 1;
    }
    const activeSessions = live.filter((s) => recent(s.last_message_at || s.created_at)).length;

    // ---- unanswered questions ----------------------------------------------
    const pending = faqs.filter((f) => f.status === "pending");

    res.json({
      days,
      ratings: {
        up: up.length,
        down: down.length,
        rated: window.length,
        down_pct: window.length ? Math.round((down.length / window.length) * 100) : null,
      },
      bad_replies: bad.map((m) => ({
        id: m.id,
        session_id: m.session_id,
        diner_name: names.get(m.session_id) || null,
        message: m.message,
        created_at: m.created_at,
        guest_said: context.get(m.id) || null,
      })),
      handoffs: {
        count: handedOff.length,
        active_sessions: activeSessions,
        rate_pct: activeSessions ? Math.round((handedOff.length / activeSessions) * 100) : null,
        reasons: Object.entries(reasons).map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count),
        sessions: handedOff.slice(0, 20).map((s) => ({
          session_id: s.session_id,
          diner_name: names.get(s.session_id) || null,
          reason: s.handoff_reason || null,
          needs_attention: !!s.needs_attention,
          ai_enabled: s.ai_enabled !== false,
          last_message: s.last_message,
          last_message_at: s.last_message_at,
        })),
      },
      unanswered: {
        count: pending.length,
        recent: pending.filter((f) => recent(f.created_at)).length,
        items: pending.slice(0, 20).map((f) => ({
          id: f.id, question: f.question, context: f.context,
          session_id: f.session_id, created_at: f.created_at,
        })),
      },
      engine,
    });
  } catch (e) { next(e); }
});

// Staff-rated AI replies. Uses the raw client when available so the database does the
// filtering (chat_messages is the biggest table here); falls back to the repo in demo mode.
async function ratedMessages(req, sinceISO) {
  if (req.tenantClient) {
    const { data, error } = await req.tenantClient
      .from("chat_messages")
      .select("id,session_id,message,rating,created_at")
      .not("rating", "is", null)
      .gte("created_at", sinceISO)
      .order("created_at", { ascending: false })
      .limit(500);
    if (!error) return data || [];
  }
  const rows = await req.repo.list("chat_messages", { order: "created_at", desc: true, limit: 2000 }).catch(() => []);
  return rows.filter((m) => m.rating != null);
}

// For each flagged reply, the guest message immediately before it in that conversation.
async function precedingGuestTurns(req, badReplies) {
  const out = new Map();
  const ids = [...new Set(badReplies.map((m) => m.session_id).filter(Boolean))];
  if (!ids.length) return out;

  let rows = [];
  if (req.tenantClient) {
    const { data, error } = await req.tenantClient
      .from("chat_messages")
      .select("id,session_id,sender,message,created_at")
      .in("session_id", ids)
      .order("created_at", { ascending: true })
      .limit(4000);
    if (!error) rows = data || [];
  }
  if (!rows.length) {
    for (const sid of ids) {
      const r = await req.repo.list("chat_messages", { where: { session_id: sid }, order: "created_at", desc: false }).catch(() => []);
      rows.push(...r);
    }
  }

  const bySession = new Map();
  for (const r of rows) {
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, []);
    bySession.get(r.session_id).push(r);
  }
  for (const bad of badReplies) {
    const thread = bySession.get(bad.session_id) || [];
    const at = new Date(bad.created_at).getTime();
    let prev = null;
    for (const m of thread) {
      if (new Date(m.created_at).getTime() >= at) break;
      if (m.sender === "guest" || m.sender === "user" || m.sender === "customer") prev = m;
    }
    if (prev) out.set(bad.id, prev.message);
  }
  return out;
}

// Did the bot break, or was it merely wrong? flow_executions answers that.
// NEVER select("*") here — the nodes/children jsonb columns hold whole traces and
// pulling a week of them would move tens of MB for four summary numbers.
async function engineHealth(req, sinceISO) {
  if (!req.tenantClient) return null;
  const { data, error } = await req.tenantClient
    .from("flow_executions")
    .select("flow,status,duration_ms,cost_usd,error")
    .gte("started_at", sinceISO)
    .order("started_at", { ascending: false })
    .limit(5000);
  if (error || !data) return null;

  const failed = (r) => r.status === "error" || r.status === "failed" || !!r.error;
  const p95 = (xs) => {
    const a = xs.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
    return a.length ? Math.round(a[Math.min(a.length - 1, Math.floor(a.length * 0.95))]) : null;
  };
  const byFlow = {};
  for (const r of data) {
    const f = (byFlow[r.flow] = byFlow[r.flow] || { flow: r.flow, runs: 0, errors: 0, ms: [], cost_usd: 0 });
    f.runs++; if (failed(r)) f.errors++;
    if (r.duration_ms != null) f.ms.push(Number(r.duration_ms));
    f.cost_usd += Number(r.cost_usd) || 0;
  }
  const errors = data.filter(failed);
  return {
    runs: data.length,
    errors: errors.length,
    error_pct: data.length ? Math.round((errors.length / data.length) * 100) : 0,
    p95_ms: p95(data.map((r) => Number(r.duration_ms))),
    cost_usd: Math.round(data.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0) * 10000) / 10000,
    truncated: data.length >= 5000,
    by_flow: Object.values(byFlow)
      .map((f) => ({
        flow: f.flow, runs: f.runs, errors: f.errors,
        error_pct: f.runs ? Math.round((f.errors / f.runs) * 100) : 0,
        p95_ms: p95(f.ms),
        cost_usd: Math.round(f.cost_usd * 10000) / 10000,
      }))
      .sort((a, b) => b.runs - a.runs),
    recent_errors: errors.slice(0, 8).map((r) => ({ flow: r.flow, error: String(r.error || "").slice(0, 200) })),
  };
}

export default router;
