// DB-backed message buffer with smart trailing windows.
// - rows persist in tenant messages_buffer (survives restarts; atomic claim on flush)
// - in-memory session meta drives timing: trailing window, typing extension, max cap,
//   completeness heuristics, first-contact fast path
// - graceful drain on shutdown, boot sweep for stray rows
import { BUFFER_WINDOW_MS, log } from "../config.js";

export const MAX_CAP_MS = 25_000;
const TYPING_EXTEND_MS = 3_000;

// sessionId -> { firstAt, lastAt, windowMs, typingUntil, channel, count }
const sessions = new Map();
const seenIds = new Set(); // fast in-memory dedup layer (DB unique constraint is the real guard)
const repliedBursts = new Set(); // idempotency: burst signature -> already replied

function heuristicWindow(message, base) {
  const t = (message || "").trim().toLowerCase();
  // incomplete thought → wait longer
  if (/(\.\.\.|…|,)$/.test(t) || /\b(and|also|w|wa|kaman|كمان|و|bas|بس)$/.test(t)) return base + 4000;
  // direct question → answer faster
  if (/[?؟]$/.test(t)) return Math.max(2500, base - 3000);
  return base;
}

export async function pushMessage(db, sessionId, message, messageId, { channel = "web", isNewSession = false, windowBase = null } = {}) {
  // dedup: memory fast-path
  if (messageId && seenIds.has(messageId)) return { accepted: false, reason: "duplicate (memory)" };
  if (messageId) {
    seenIds.add(messageId);
    if (seenIds.size > 8000) seenIds.clear();
  }

  // dedup + persistence: DB (unique wa_message_id)
  let persisted = false;
  try {
    const { error } = await db.from("messages_buffer").insert({
      phone_number: sessionId,
      wa_message_id: messageId || `${channel}-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      message,
    });
    if (error) {
      if (String(error.code) === "23505") return { accepted: false, reason: "duplicate (db)" };
      throw new Error(error.message);
    }
    persisted = true;
  } catch (e) {
    log("buffer db insert failed, memory-only:", e.message);
  }

  const base = windowBase || BUFFER_WINDOW_MS;
  const now = Date.now();
  const meta = sessions.get(sessionId) || { firstAt: now, count: 0, typingUntil: 0, channel };
  meta.lastAt = now;
  meta.count += 1;
  meta.channel = channel;
  meta.windowMs = isNewSession && meta.count === 1 && message.length < 25
    ? Math.min(3000, base) // snappy first impression on a bare "hi"
    : heuristicWindow(message, base);
  if (!meta.memoryRows) meta.memoryRows = [];
  if (!persisted) meta.memoryRows.push(message);
  sessions.set(sessionId, meta);

  return { accepted: true, persisted, window_ms: meta.windowMs, burst_count: meta.count };
}

export function setTyping(sessionId) {
  const meta = sessions.get(sessionId);
  if (meta) meta.typingUntil = Date.now() + TYPING_EXTEND_MS;
  else sessions.set(sessionId, { firstAt: Date.now(), lastAt: Date.now(), count: 0, typingUntil: Date.now() + TYPING_EXTEND_MS, windowMs: BUFFER_WINDOW_MS, memoryRows: [] });
}

export function pendingCount(sessionId) {
  return sessions.get(sessionId)?.count || 0;
}

// Atomically claim all buffered rows for a session. Returns merged burst or null.
// Retry-safe: a transient DB failure keeps the session alive so the next tick retries —
// bursts are never stranded in messages_buffer.
export async function claimBurst(db, sessionId) {
  const meta = sessions.get(sessionId);
  let rows = [];
  let dbOk = false;
  try {
    const { data, error } = await db
      .from("messages_buffer")
      .delete()
      .eq("phone_number", sessionId)
      .select("*");
    if (error) throw new Error(error.message);
    dbOk = true;
    rows = (data || []).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  } catch (e) {
    const fails = (meta?.claimFails || 0) + 1;
    if (meta) meta.claimFails = fails;
    if (fails < 5 && !meta?.memoryRows?.length) {
      log(`claim db failed (attempt ${fails}), will retry next tick:`, e.message);
      return null; // session meta kept → flush worker retries
    }
    log("claim db failed, falling back to memory rows:", e.message);
  }
  sessions.delete(sessionId);
  let messages = rows.map((r) => r.message);
  if (messages.length === 0 && meta?.memoryRows?.length) messages = meta.memoryRows;
  if (messages.length === 0) return null;

  const signature = `${sessionId}::${rows.map((r) => r.id).join(",") || messages.join("|").slice(0, 80)}`;
  if (repliedBursts.has(signature)) return null; // double-flush safety
  repliedBursts.add(signature);
  if (repliedBursts.size > 2000) repliedBursts.clear();

  return {
    merged: messages.join("\n").trim(),
    count: messages.length,
    last_message_id: rows.at(-1)?.wa_message_id || null,
    window_ms: meta ? Date.now() - meta.firstAt : null,
    channel: meta?.channel || "web",
    signature,
  };
}

let flushFn = null;

export function startFlushWorker(onFlush, tickMs = 1000) {
  flushFn = onFlush;
  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, m] of sessions) {
      if (m.count === 0) {
        if (now > (m.typingUntil || 0) + 30_000) sessions.delete(sessionId); // typing ghost cleanup
        continue;
      }
      const silenceOk = now - m.lastAt >= (m.windowMs || BUFFER_WINDOW_MS);
      const notTyping = now >= (m.typingUntil || 0);
      const capHit = now - m.firstAt >= MAX_CAP_MS;
      if ((silenceOk && notTyping) || capHit) {
        onFlush(sessionId, m.channel).catch((e) => log("flush error:", e.message));
      }
    }
  }, tickMs);
}

export function flushNow(sessionId, channel = "web") {
  if (flushFn && sessions.get(sessionId)?.count > 0) {
    return flushFn(sessionId, channel);
  }
}

// Boot sweep: stray rows left by a previous crash/redeploy → flush them.
export async function bootSweep(db, onFlush) {
  try {
    const { data } = await db.from("messages_buffer").select("phone_number").limit(200);
    const strays = [...new Set((data || []).map((r) => r.phone_number))];
    for (const sid of strays) {
      sessions.set(sid, { firstAt: 0, lastAt: 0, count: 1, windowMs: 0, typingUntil: 0, channel: "web" });
      await onFlush(sid, "web").catch(() => {});
    }
    if (strays.length) log(`boot sweep: flushed ${strays.length} stray burst(s)`);
  } catch (e) {
    log("boot sweep skipped:", e.message);
  }
}

// Graceful drain: flush everything pending before shutdown.
export async function drainAll(onFlush) {
  const pending = [...sessions.entries()].filter(([, m]) => m.count > 0);
  log(`drain: flushing ${pending.length} pending burst(s) before shutdown`);
  await Promise.allSettled(pending.map(([sid, m]) => onFlush(sid, m.channel)));
}
