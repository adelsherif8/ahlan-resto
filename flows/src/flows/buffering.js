// BUFFERING — the front door. Channel-agnostic (WhatsApp webhook or web live chat).
// INGEST: verify/parse → dedup → spam guard → chat gate → media → log → buffer push.
// RESPOND: claim burst → gates → history(TTL) → fast paths → session precheck → MASTER
//          → humanize delay → deliver → post check (chained re-flush).
import { defineFlow } from "../engine/flow.js";
import { pushMessage, claimBurst, pendingCount, flushNow, MAX_CAP_MS } from "../services/buffer.js";
import { logMessage, getSession, setSessionFlags, notifyDashboard } from "../services/chatlog.js";
import { appendHistory, getHistory } from "../services/history.js";
import { sessionPrecheck, detectAffirmative, detectSelfCorrection } from "../services/precheck.js";
import { processWaMedia } from "../services/media.js";
import { sendText, markReadWithTyping } from "../services/whatsapp.js";
import { bump } from "../services/metrics.js";

const HISTORY_TTL_MS = 60 * 60 * 1000; // fresh conversation after 1h of silence (removebuffer.json behavior, on read)

// per-session channel memory: how do we reply to this session?
const sessionRoutes = new Map(); // sessionId -> { channel, phoneNumberId }
// language stickiness
const sessionLang = new Map(); // sessionId -> "en"|"ar"|"franco"|"mixed"
export function setSessionLanguage(sessionId, l) {
  if (l && l !== "unknown") sessionLang.set(sessionId, l);
}
// spam guard state
const spam = new Map(); // sessionId -> { count, windowStart, cooled }
// dead-letter state
const failures = new Map(); // sessionId -> consecutive failures

defineFlow({
  name: "ingest",
  description: "Front door — verify/parse (all WA payload types), dedup, spam guard, gate, media, log, buffer",
  trigger: { icon: "whatsapp", label: "WhatsApp webhook / Web live chat" },
  nodes: [
    { id: "resolve_restaurant", label: "Restaurant + URLs", icon: "database" },
    { id: "verify_parse", label: "Verify + Parse", icon: "shield" },
    { id: "dedup", label: "Dedup", icon: "filter" },
    { id: "spam_guard", label: "Spam Guard", icon: "shield" },
    { id: "chat_gate", label: "Chat Gate", icon: "shield" },
    { id: "media_normalize", label: "Media → Text", icon: "sparkles" },
    { id: "log_inbound", label: "Log to Chats", icon: "message" },
    { id: "buffer_push", label: "Buffer Push", icon: "timer" },
  ],

  async run(f, ctx, input) {
    const { db, config } = ctx.tenant;
    bump("messages_in");

    // ---- resolve_restaurant: the "Urls" node — which tenant is this, which DB do we write to ----
    await f.node("resolve_restaurant", async () => tenantSummary(ctx), { input: { sessionId: ctx.sessionId, channel: ctx.channel } });

    // ---- verify_parse: normalize BOTH channels into one event shape ----
    const event = await f.node("verify_parse", async () => {
      if (ctx.channel === "whatsapp") {
        const e = input.event; // parsed by services/whatsapp.js parseEnvelope — raw included
        sessionRoutes.set(ctx.sessionId, { channel: "whatsapp", phoneNumberId: e.phoneNumberId });
        // reactions need no reply — log & stop after this node
        if (e.type === "reaction") return { kind: "reaction", text: `[reacted ${e.reaction.emoji}]`, raw: e.raw, no_reply: true, profileName: e.profileName };
        if (e.type === "location") return { kind: "location", text: `[shared location] ${e.location.name || ""} ${e.location.address || ""} (${e.location.lat},${e.location.lng})`, raw: e.raw, profileName: e.profileName };
        if (e.type === "contacts") return { kind: "contacts", text: `[shared contact card: ${(e.contacts_card || []).map((c) => c.name?.formatted_name).join(", ")}]`, raw: e.raw, profileName: e.profileName };
        if (e.interactive) return { kind: "interactive", text: e.interactive.title || e.interactive.id || "[button]", raw: e.raw, profileName: e.profileName };
        if (e.media) return { kind: e.media.kind, media: e.media, text: e.text, raw: e.raw, profileName: e.profileName };
        return { kind: "text", text: e.text || `[${e.type}]`, raw: e.raw, profileName: e.profileName };
      }
      sessionRoutes.set(ctx.sessionId, { channel: "web", phoneNumberId: null });
      return { kind: "text", text: input.message };
    }, { input: ctx.channel === "whatsapp" ? { channel: "whatsapp", raw_event: input.event?.raw, from: input.event?.from, type: input.event?.type } : { channel: "web", message: input.message } });

    // ---- dedup ----
    const messageId = ctx.channel === "whatsapp" ? input.event?.messageId : input.messageId || null;
    // (actual insert-dedup happens in buffer_push; here we pre-check reactions/no-reply kinds)
    await f.node("dedup", async () => {
      return { message_id: messageId || "(generated)", strategy: "unique wa_message_id in messages_buffer (DB) + memory set" };
    }, { input: { messageId } });

    // ---- spam_guard ----
    const spamResult = await f.node("spam_guard", async () => {
      const now = Date.now();
      const s = spam.get(ctx.sessionId) || { count: 0, windowStart: now, cooled: false };
      if (now - s.windowStart > 60_000) { s.count = 0; s.windowStart = now; s.cooled = false; }
      s.count += 1;
      spam.set(ctx.sessionId, s);
      if (s.count > 12) {
        bump("spam_blocks");
        if (!s.cooled) {
          s.cooled = true;
          await respondDirect(ctx, "Take a breath 😄 We got your messages — replying to everything in one go now.");
        }
        return { blocked: true, count_this_minute: s.count };
      }
      return { blocked: false, count_this_minute: s.count };
    }, { input: { sessionId: ctx.sessionId } });
    if (spamResult.blocked) return { buffered: false, reason: "spam guard" };

    // ---- chat_gate ----
    const gate = await f.node("chat_gate", async () => {
      if (config.ai?.chat_enabled === false) {
        // staff still see the message; guest gets ONE canned note per session per hour
        await logMessage(db, ctx.sessionId, "guest", event.text || "[message]", ctx.channel);
        const s = spam.get(`gate:${ctx.sessionId}`);
        if (!s || Date.now() - s.windowStart > 3_600_000) {
          spam.set(`gate:${ctx.sessionId}`, { windowStart: Date.now() });
          await respondDirect(ctx, config.ai?.off_hours?.reply || "Thanks for your message! The team will get back to you shortly 🙏");
        }
        return { pass: false, reason: "restaurant bot disabled (ai.chat_enabled=false) — logged for staff, canned reply sent" };
      }
      return { pass: true };
    }, { input: { chat_enabled: config.ai?.chat_enabled !== false } });
    if (!gate.pass) return { buffered: false, reason: gate.reason };

    // ---- media_normalize ----
    const normalized = await f.node("media_normalize", async () => {
      if (event.media) {
        const r = await processWaMedia(db, input.event);
        if (r.usage) return { value: { text: r.text, media: { url: r.mediaUrl, type: r.mediaType } }, __usage: r.usage };
        return { text: r.text, media: { url: r.mediaUrl, type: r.mediaType } };
      }
      return { text: event.text, media: null };
    }, { input: { kind: event.kind, has_media: !!event.media } });
    const norm = normalized.value || normalized;
    const finalText = norm.text || "[message]";

    // WhatsApp: read receipt + typing indicator (guest sees we're on it)
    if (ctx.channel === "whatsapp" && messageId && input.event?.phoneNumberId) {
      markReadWithTyping(input.event.phoneNumberId, messageId).catch(() => {});
    }

    // ---- log_inbound ----
    await f.node("log_inbound", async () => {
      await logMessage(db, ctx.sessionId, "guest", finalText, ctx.channel, norm.media);
      return { logged: true, text: finalText.slice(0, 120) };
    }, { input: { sessionId: ctx.sessionId, media: norm.media } });

    // reactions: visible to staff, no bot reply
    if (event.no_reply) return { buffered: false, reason: "reaction — logged, no reply needed" };

    // ---- buffer_push ----
    const pushed = await f.node("buffer_push", async () => {
      const hist = await getHistory(db, ctx.sessionId);
      const isNewSession = hist.length === 0;
      const base = config.ai?.buffer_window_ms || (ctx.channel === "whatsapp" ? 8000 : 5000);
      const r = await pushMessage(db, ctx.sessionId, finalText, messageId, { channel: ctx.channel, isNewSession, windowBase: base });
      return { ...r, next: `→ RESPOND flow fires after ${Math.round((r.window_ms || base) / 1000)}s of silence (or 25s cap) and routes to MASTER` };
    }, { input: { channel: ctx.channel, per_channel_default: ctx.channel === "whatsapp" ? "8s" : "5s", max_cap: `${MAX_CAP_MS / 1000}s` } });

    return { buffered: pushed.accepted, window_ms: pushed.window_ms, burst_count: pushed.burst_count };
  },
});

defineFlow({
  name: "respond",
  description: "Post-buffer pipeline — atomic claim, gates, TTL history, fast paths, precheck, MASTER, humanized delivery, chained re-flush",
  trigger: { icon: "timer", label: "Buffer flush (silence window / 25s cap / typing-aware)" },
  nodes: [
    { id: "resolve_restaurant", label: "Restaurant + URLs", icon: "database" },
    { id: "claim_burst", label: "Claim Burst", icon: "filter" },
    { id: "gates", label: "AI Gates", icon: "shield" },
    { id: "load_history", label: "History (1h TTL)", icon: "history" },
    { id: "session_precheck", label: "Session Precheck", icon: "route" },
    { id: "master", label: "MASTER (sub-flow)", icon: "branch" },
    { id: "humanize_delay", label: "Humanize Delay", icon: "timer" },
    { id: "deliver", label: "Deliver", icon: "send" },
    { id: "post_check", label: "Post Check", icon: "history" },
  ],

  async run(f, ctx) {
    const { db, config } = ctx.tenant;

    // ---- resolve_restaurant: the "Urls" node ----
    await f.node("resolve_restaurant", async () => tenantSummary(ctx), { input: { sessionId: ctx.sessionId } });

    // ---- claim_burst (atomic) ----
    const burst = await f.node("claim_burst", async () => {
      const b = await claimBurst(db, ctx.sessionId);
      if (!b) return { empty: true };
      bump("bursts"); bump("burst_msgs", b.count); bump("window_sum_ms", b.window_ms || 0);
      return b;
    }, { input: { sessionId: ctx.sessionId } });
    if (burst.empty) return { replied: false, reason: "nothing to claim (already processed elsewhere)" };
    const merged = burst.merged;

    // ---- gates ----
    const gate = await f.node("gates", async () => {
      const session = await getSession(db, ctx.sessionId);
      if (session && session.ai_enabled === false) return { pass: false, reason: "staff took over (ai_enabled=false)" };
      try {
        const { data: diner } = await db.from("diners").select("status").eq("phone_number", ctx.sessionId).maybeSingle();
        if (diner?.status === "blocked") return { pass: false, reason: "diner blocked" };
      } catch {}
      return { pass: true };
    }, { input: { sessionId: ctx.sessionId } });
    if (!gate.pass) return { replied: false, reason: gate.reason };

    // ---- load_history (TTL-filtered: fresh conversation after 1h silence) ----
    const history = await f.node("load_history", async () => {
      const all = await getHistory(db, ctx.sessionId);
      const cutoff = Date.now() - HISTORY_TTL_MS;
      const fresh = all.filter((h) => !h.at || new Date(h.at).getTime() > cutoff);
      await appendHistory(db, ctx.sessionId, "guest", merged);
      return fresh;
    }, { input: { sessionId: ctx.sessionId, ttl: "1h — older turns ignored (fresh visit = fresh conversation)" } });

    const sticky = sessionLang.get(ctx.sessionId) || null;

    // ---- session_precheck ----
    const precheck = await f.node("session_precheck", async () => {
      const p = await sessionPrecheck(db, ctx.sessionId, history);
      p.is_affirmative = detectAffirmative(merged);
      p.is_self_correction = detectSelfCorrection(merged);
      return p;
    }, { input: { sessionId: ctx.sessionId, history_turns: history.length } });

    let reply = null;
    let routed = null;

    if (precheck.loop_detected || precheck.circuit_breaker) {
      reply = "Let me get a team member to help you directly — one moment 🙏";
      await setSessionFlags(db, ctx.sessionId, { needs_attention: true, handoff_reason: precheck.loop_detected ? "loop detected" : "circuit breaker (too many turns)" });
      await notifyDashboard(db, "handoff", "Human needed: conversation stuck", `Session ${ctx.sessionId} — ${precheck.loop_detected ? "bot repeated itself" : "20+ turns"}`, ctx.sessionId);
    } else {
      // ---- master: EVERY burst goes through the router (fast paths live inside it) ----
      routed = await f.node("master", async () => {
        return f.flow("master", { message: merged, history, precheck, stickyLanguage: sticky });
      }, { input: { message: merged, precheck_active_flow: precheck.active_flow, sticky_language: sticky } });
      reply = routed?.reply || "Sorry — something went wrong on our side 🙏 A team member will follow up.";
      if (routed?.language) setSessionLanguage(ctx.sessionId, routed.language);
      if (routed?.fast_path === "closer") await setSessionFlags(db, ctx.sessionId, { status: "closed" }).catch(() => {});
      if (!routed?.fast_path) bump("llm_replies");
    }

    // ---- humanize_delay ----
    await f.node("humanize_delay", async () => {
      const ms = Math.min(Number(config.ai?.response_delay_ms) || 800, 4000);
      await new Promise((r) => setTimeout(r, ms));
      return { delayed_ms: ms };
    }, { input: { configured: config.ai?.response_delay_ms || "default 800ms" } });

    // ---- deliver (channel-aware, splits long replies) ----
    await f.node("deliver", async () => {
      const parts = splitReply(reply);
      for (const part of parts) {
        await deliverToChannel(ctx, part);
        await logMessage(db, ctx.sessionId, "ai", part, ctx.channel);
      }
      await appendHistory(db, ctx.sessionId, "ai", reply);
      return { parts: parts.length, via: sessionRoutes.get(ctx.sessionId)?.channel || ctx.channel, reply };
    }, { input: { reply_length: reply.length, fast_path: routed?.fast_path || null } });

    // ---- post_check: guest kept typing while we were thinking? answer that too ----
    const post = await f.node("post_check", async () => {
      const pending = pendingCount(ctx.sessionId);
      if (pending > 0) {
        setTimeout(() => flushNow(ctx.sessionId, ctx.channel), 1200);
        return { more_pending: pending, action: "chained re-flush scheduled" };
      }
      return { more_pending: 0 };
    }, { input: { sessionId: ctx.sessionId } });

    failures.delete(ctx.sessionId);
    return { replied: true, reply, fast_path: routed?.fast_path || null, bucket: routed?.bucket || null, chained: post.more_pending > 0 };
  },
});

function tenantSummary(ctx) {
  const r = ctx.tenant.record || {};
  const creds = r.integrations?.supabase || {};
  return {
    restaurant: r.name,
    slug: r.slug,
    control_plane: "restaurants row (Ahlan Supabase)",
    tenant_supabase_url: creds.url || "(memory mode)",
    tenant_supabase_key: creds.key ? creds.key.slice(0, 14) + "…(masked)" : null,
    writes_to: "chat_sessions / chat_messages / diners / notifications → restaurant dashboard",
  };
}

function splitReply(reply) {
  if (reply.length > 400 && reply.includes("\n\n")) {
    const i = reply.indexOf("\n\n");
    return [reply.slice(0, i).trim(), reply.slice(i + 2).trim()].filter(Boolean);
  }
  return [reply];
}

async function deliverToChannel(ctx, text) {
  const route = sessionRoutes.get(ctx.sessionId) || { channel: ctx.channel };
  if (route.channel === "whatsapp" && route.phoneNumberId) {
    const to = ctx.sessionId.replace(/^\+/, "");
    await sendText(route.phoneNumberId, to, text).catch(async (e) => {
      await ctx.tenant.db.from("pending_message_queue").insert({ phone_number: ctx.sessionId, payload: { text }, attempts: 1, next_attempt_at: new Date(Date.now() + 5 * 60000).toISOString(), last_error: e.message }).catch(() => {});
    });
  }
  // web channel needs no push — the durable poll reads chat_messages (logged by the caller)
}

async function respondDirect(ctx, text) {
  await deliverToChannel(ctx, text);
  await logMessage(ctx.tenant.db, ctx.sessionId, "ai", text, ctx.channel).catch(() => {});
}

// Dead-letter wrapper used by the server's flush handler
export async function handleFlushFailure(ctx, err) {
  const n = (failures.get(ctx.sessionId) || 0) + 1;
  failures.set(ctx.sessionId, n);
  bump("dead_letters");
  try {
    await ctx.tenant.db.from("routing_failures").insert({ phone_number: ctx.sessionId, stage: "respond", error: String(err?.message || err).slice(0, 500) });
  } catch {}
  if (n >= 2) {
    failures.delete(ctx.sessionId);
    await respondDirect(ctx, "So sorry — we're having a technical hiccup 🙏 A team member will reply to you personally.");
    await setSessionFlags(ctx.tenant.db, ctx.sessionId, { needs_attention: true, handoff_reason: "dead-letter: pipeline failed twice" }).catch(() => {});
    await notifyDashboard(ctx.tenant.db, "system", "Pipeline failure", `Two consecutive failures for ${ctx.sessionId} — guest got apology, needs human`, ctx.sessionId).catch(() => {});
  }
}
