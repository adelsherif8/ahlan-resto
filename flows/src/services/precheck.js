// Session precheck — ported from the hotel master's Session Precheck code node.
// Reads temp_reservation (the reservation agent's slot-filling state). Today that
// table is empty, so this returns { active_flow: "none" } — it lights up the moment
// the reservation agent starts writing sessions. Loop detection + circuit breakers
// run NOW against conversation history.
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_TURNS_SESSION = 20;

const AFFIRMATIVE = /^(yes|ya|yh|yea|yep|yeah|ok|okay|sure|confirm|done|tamam|tmam|aywa|ah|aiwa|maashi|mashy|akeed|اه|ايوه|أيوة|تمام|ماشي|اكيد|👍|✅)[\s!.]*$/i;
const SELF_CORRECTION = /\b(wait|actually|no wait|hold on|nvm|never ?mind|la2|la khalas|استنى|لا خلاص|مش كده|قصدي|asdi|2asdy)\b/i;

export async function sessionPrecheck(db, sessionId, history) {
  const out = {
    active_flow: "none",
    stage: null,
    session_expired: false,
    is_affirmative: false,
    is_self_correction: false,
    loop_detected: false,
    turns_in_session: 0,
    circuit_breaker: false,
  };

  // conversation-level signals (live NOW)
  const guestTurns = (history || []).filter((h) => h.role === "guest");
  out.turns_in_session = guestTurns.length;
  if (out.turns_in_session >= MAX_TURNS_SESSION) out.circuit_breaker = true;

  const aiTurns = (history || []).filter((h) => h.role === "ai").map((h) => h.message);
  if (aiTurns.length >= 2 && aiTurns.at(-1) === aiTurns.at(-2)) out.loop_detected = true;

  // reservation session state (lights up with the reservation agent)
  try {
    const { data: t } = await db.from("temp_reservation").select("*").eq("phone_number", sessionId).maybeSingle();
    if (t) {
      const age = Date.now() - new Date(t.updated_at).getTime();
      if (age > SESSION_TTL_MS && t.session_status !== "archived") {
        await db.from("temp_reservation").update({ session_status: "archived" }).eq("phone_number", sessionId);
        out.session_expired = true;
      } else if (["incomplete", "quoted", "awaiting_confirm", "awaiting_deposit", "awaiting_cancel_confirm"].includes(t.session_status)) {
        out.active_flow = "reservation";
        out.stage = t.stage || t.session_status;
        if ((t.turns_in_stage || 0) >= 5) out.circuit_breaker = true;
      }
    }
  } catch { /* table may not exist in memory mode */ }

  return out;
}

export function detectAffirmative(message) {
  return AFFIRMATIVE.test(message.trim());
}
export function detectSelfCorrection(message) {
  return SELF_CORRECTION.test(message);
}
