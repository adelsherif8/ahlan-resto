// Conversation memory in message_full (jsonb array, last 20 turns) — keyed by session id.
// A rolling conversation summary carries the older context, so replaying 20 raw
// turns into every prompt pays twice for the same information.
const MAX_TURNS = 10;

export async function appendHistory(db, sessionId, role, message) {
  const { data } = await db.from("message_full").select("conversation").eq("phone_number", sessionId).maybeSingle();
  const conv = (data?.conversation || []).slice(-(MAX_TURNS - 1));
  conv.push({ role, message: String(message).slice(0, 1500), at: new Date().toISOString() });
  if (data) {
    await db.from("message_full").update({ conversation: conv, updated_at: new Date().toISOString() }).eq("phone_number", sessionId);
  } else {
    await db.from("message_full").insert({ phone_number: sessionId, conversation: conv });
  }
  return conv;
}

export async function getHistory(db, sessionId) {
  const { data } = await db.from("message_full").select("conversation").eq("phone_number", sessionId).maybeSingle();
  return data?.conversation || [];
}
