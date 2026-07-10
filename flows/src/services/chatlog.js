// Writes conversations into the tenant DB tables the dashboard Chats page reads.
export async function logMessage(db, sessionId, sender, message, channel = "web", media = null) {
  await db.from("chat_messages").insert({
    session_id: sessionId,
    sender,
    message,
    status: "delivered",
    media_url: media?.url || null,
    media_type: media?.type || null,
    wa_message_id: `${channel}-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  });

  const { data: existing } = await db
    .from("chat_sessions")
    .select("id")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existing) {
    await db.from("chat_sessions").update({
      last_message: message.slice(0, 300),
      last_message_at: new Date().toISOString(),
    }).eq("id", existing.id);
  } else {
    await db.from("chat_sessions").insert({
      session_id: sessionId,
      phone_number: sessionId.startsWith("web:") ? null : sessionId,
      channel,
      status: "open",
      ai_enabled: true,
      last_message: message.slice(0, 300),
      last_message_at: new Date().toISOString(),
    });
  }
}

export async function getSession(db, sessionId) {
  const { data } = await db.from("chat_sessions").select("*").eq("session_id", sessionId).maybeSingle();
  return data;
}

export async function setSessionFlags(db, sessionId, flags) {
  await db.from("chat_sessions").update(flags).eq("session_id", sessionId);
}

export async function notifyDashboard(db, type, title, body, refId = null) {
  await db.from("notifications").insert({ type, title, body, ref_id: refId });
}
