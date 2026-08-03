// Per-device unread tracking for chat sessions: we remember when the viewer last
// opened each thread and compare against the session's last_message_at.
const KEY = "chat_seen_v1";

function store(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}

export function markSeen(sessionId: string) {
  const s = store();
  s[sessionId] = new Date().toISOString();
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function isUnread(s: { session_id: string; last_message_at?: string | null }): boolean {
  if (!s.last_message_at) return false;
  const seen = store()[s.session_id];
  return !seen || seen < s.last_message_at;
}

export function unreadCount(sessions: { session_id: string; last_message_at?: string | null }[]): number {
  return sessions.filter(isUnread).length;
}
