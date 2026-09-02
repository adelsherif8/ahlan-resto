// Session precheck — ported from the hotel master's Session Precheck code node.
// Reads temp_reservation (the reservation agent's slot-filling state). Today that
// table is empty, so this returns { active_flow: "none" } — it lights up the moment
// the reservation agent starts writing sessions. Loop detection + circuit breakers
// run NOW against conversation history.
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_TURNS_SESSION = 20;

const AFFIRMATIVE = /^(yes|ya|yh|yea|yep|yeah|ok|okay|sure|confirm|done|tamam|tmam|aywa|ah|aiwa|maashi|mashy|akeed|اه|ايوه|أيوة|تمام|ماشي|اكيد|👍|✅)[\s!.]*$/i;
const SELF_CORRECTION = /(?<![\p{L}\p{N}])(wait|actually|no wait|hold on|nvm|never ?mind|la2|la khalas|استنى|لا خلاص|مش كده|قصدي|asdi|2asdy)(?![\p{L}\p{N}])/iu;

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

  // Loop detection stays byte-exact ON PURPOSE. A fuzzy (word-overlap) version false-
  // positived on legit multi-step order asks (branch → payment → confirm share
  // boilerplate), tripping a handoff mid-order and killing the order. The reported
  // "same wrong answer" loop is prevented upstream now (order-flow handoff + per-session
  // lock), so exact-match is the safe, sufficient backstop here.
  const aiTurns = (history || []).filter((h) => h.role === "ai").map((h) => h.message);
  // …except the ORDER STATUS CARD: "where's my order?" then "how long?" legitimately get
  // the same card twice — that is the answer, not the bot stuck (it tripped a human
  // handoff on the guest's next word, "can I cancel?").
  const isStatusCard = (m) => /🎫 \*[A-Z]{1,3}-[A-Z0-9]{3,6}\*/u.test(String(m || "")) && /[⬜✅]/u.test(String(m || ""));
  const repeatedTwice = aiTurns.length >= 2 && aiTurns.at(-1) === aiTurns.at(-2) && !isStatusCard(aiTurns.at(-1));
  const repeatedThrice = aiTurns.length >= 3 && repeatedTwice && aiTurns.at(-2) === aiTurns.at(-3);
  if (repeatedTwice) out.loop_detected = true;

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

  // order session state — a real draft order in progress, not a guess from the wording.
  // While this is live, short answers ("sprite", "card", "T3") belong to the ORDER agent.
  {
    try {
      const { data: d } = await db.from("diners").select("preferences").eq("phone_number", sessionId).maybeSingle();
      // sticky language survives restarts: the in-memory map dies on every deploy,
      // and a Franco guest greeted in English mid-conversation reads as a new bot
      out.stored_language = d?.preferences?.language || null;
      const p = out.active_flow === "none" ? d?.preferences?.pending_order : null;
      if (p && Date.now() - new Date(p.at || 0).getTime() < 120 * 60_000) {
        out.active_flow = "order";
        out.stage = p.awaiting_confirm ? "awaiting_confirm"
          : p.awaiting_option ? "configuring_item"
          : p.payment_method ? "awaiting_confirm" : "building";
        // Mid-order, ONE repeated question is the agent doing its job — the guest
        // answered something else ("Maadi" during the options walk) and the same
        // code-built block gets asked again. Handing off there eats their next
        // answer. A real stuck loop shows as THREE identical messages.
        if (out.loop_detected && !repeatedThrice) out.loop_detected = false;
      }
    } catch { /* diners table may not exist in memory mode */ }
  }

  return out;
}

export function detectAffirmative(message) {
  return AFFIRMATIVE.test(message.trim());
}
export function detectSelfCorrection(message) {
  return SELF_CORRECTION.test(message);
}
