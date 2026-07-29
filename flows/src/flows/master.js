// MASTER — the router. Sanitizes, upserts the diner, classifies, dispatches to ONE agent.
// v1: all buckets dispatch to FRIENDLY (reservation/arrival/events agents land next);
// the classification is still real so Executions show true routing + the handoff hints work.
import { defineFlow } from "../engine/flow.js";
import { chatJSON } from "../services/llm.js";
import { MODEL_FAST } from "../config.js";
import { detectCloser, matchFaq, matchMenuCategory } from "../services/fastpaths.js";
import { bump } from "../services/metrics.js";

const AFFIRMATIVES = /^(yes|yep|yeah|ok|okay|sure|tamam|tmam|aywa|ah|aiwa|maashy|mashy|👍|✅|done|confirm)\W*$/i;

defineFlow({
  name: "master",
  description: "Router — sanitize, diner upsert, 0-LLM fast paths, intent classification, dispatch",
  trigger: { icon: "branch", label: "Called by RESPOND after buffer flush" },
  nodes: [
    { id: "sanitize", label: "Sanitize", icon: "shield" },
    { id: "diner_upsert", label: "Diner Upsert", icon: "user" },
    { id: "fast_paths", label: "Fast Paths (0-LLM)", icon: "zap" },
    { id: "classify", label: "Classify Intent", icon: "brain" },
    { id: "dispatch", label: "Dispatch Agent", icon: "route" },
  ],

  async run(f, ctx, input) {
    const { db } = ctx.tenant;
    const raw = input.message;

    const message = await f.node("sanitize", async () => {
      return raw
        .replace(/```/g, "'''")
        .replace(/<\/?(system|assistant|instructions?)>/gi, "")
        .replace(/\b(ignore (all|previous|above) instructions?)\b/gi, "[redacted]")
        .slice(0, 2000);
    }, { input: { raw } });

    const diner = await f.node("diner_upsert", async () => {
      const phone = ctx.sessionId;
      const { data: existing } = await db.from("diners").select("*").eq("phone_number", phone).maybeSingle();
      if (existing) return existing;
      const { data: created } = await db
        .from("diners")
        .insert({ phone_number: phone, status: "lead" })
        .select()
        .single();
      return created;
    }, { input: { phone_number: ctx.sessionId } });

    // ---- fast_paths (0 LLM tokens): closers + FAQ answered straight from config/DB ----
    const fast = await f.node("fast_paths", async () => {
      const sticky = input.stickyLanguage || null;
      const closer = detectCloser(message, sticky);
      if (closer) { bump("closer_hits"); return closer; }
      const faq = matchFaq(message, ctx.tenant.config, sticky);
      if (faq) { bump("faq_hits"); return faq; }
      const catList = await matchMenuCategory(db, message, ctx.tenant.config.payments?.currency || "EGP");
      if (catList) { bump("menu_category_hits"); return catList; }
      return { kind: "none — needs classification + LLM" };
    }, { input: { message, sticky_language: input.stickyLanguage || null } });

    if (fast.reply) {
      return { reply: fast.reply, fast_path: fast.kind, language: fast.language, bucket: "fast_path" };
    }

    const precheck = input.precheck || {};
    const isAffirmative = precheck.is_affirmative ?? AFFIRMATIVES.test(message.trim());
    const classification = await f.node("classify", async () => {
      // session override: mid-reservation + bare "yes" → stays in the reservation flow, zero LLM
      if (isAffirmative && precheck.active_flow === "reservation") {
        return { value: { bucket: "reservation", intent: "confirm_reservation", confidence: 1, mood: "neutral", language: input.stickyLanguage || "unknown", via: "rule (affirmative in active reservation session)" } };
      }
      // a draft order in progress is session STATE, not a guess about wording — a bare
      // "yes" mid-order is a confirmation, and belongs to the ORDER agent, full stop
      if (isAffirmative && precheck.active_flow === "order") {
        return { value: { bucket: "order", intent: "confirm", confidence: 1, mood: "neutral", language: input.stickyLanguage || "unknown", via: "rule (affirmative in active order session)" } };
      }
      if (isAffirmative) {
        return { value: { bucket: "friendly", confidence: 1, mood: "neutral", language: input.stickyLanguage || "unknown", via: "rule (bare affirmative)" } };
      }
      const system = `Classify a WhatsApp message to a trendy Cairo restaurant. Reply JSON only.
Buckets:
- "reservation": wants/asks about booking, changing, cancelling a table ("table for 4", "احجزلي", "cancel my booking")
- "arrival": is at/near the restaurant now ("I'm here", "wa2eft barra", "running late 10 min")
- "events": asks about parties/DJ nights/special events or wants to RSVP
- "order": wants to order food for delivery/pickup/pre-order/dine-in ("same as last time", "the usual please", "نفس الطلب", asking where their order is)
- "friendly": everything else — greetings, menu questions, hours, location, complaints, chit-chat (DEFAULT when unsure)
CONTINUATION RULE (most important): ORDER IN PROGRESS is ${precheck.active_flow === "order" ? `YES, stage "${precheck.stage}"` : "no"}. When an order is in progress, the guest is answering us — a drink name, a branch, "T3", "pickup", "card", "yes", an address — ALL of that is bucket "order", never friendly. Only route elsewhere if they clearly changed the subject (asking hours, complaining, booking a table).
OUR LAST MESSAGE: ${JSON.stringify(String(input.lastAiMessage || "").slice(0, 300))}
Also detect mood: happy|neutral|frustrated|urgent|confused, and language: en|ar|franco|mixed.
Return: {"bucket": "...", "confidence": 0-1, "mood": "...", "language": "..."}`;
      return chatJSON(MODEL_FAST, system, message, { temperature: 0, maxTokens: 120 });
    }, { input: { message, affirmative_shortcut: isAffirmative } });

    const cls = classification.value || {};
    if (!cls.bucket || (cls.confidence ?? 0) < 0.35) cls.bucket = "friendly";

    const result = await f.node("dispatch", async () => {
      // RESERVATION agent takes its bucket + any mid-booking session; FRIENDLY handles the rest
      // (arrival/events/order agents land next — FRIENDLY covers them with handoffs for now).
      // restaurant_type drives the flagship flow: casual = walk-in only (no reservation
      // agent, waitlist via FRIENDLY) + ORDER agent; fine = reservation agent, orders via staff
      const rtype = ctx.tenant.config.basic_info?.restaurant_type || "fine";
      const reservable = rtype !== "casual" && ctx.tenant.config.ai?.reservations_enabled !== false;
      const agent = (cls.bucket === "order" || precheck.active_flow === "order") && rtype === "casual" ? "order"
        : (cls.bucket === "reservation" || precheck.active_flow === "reservation") && reservable ? "reservation"
        : cls.bucket === "arrival" && reservable ? "arrival"
        : "friendly";
      return f.flow(agent, {
        message,
        diner,
        history: input.history,
        precheck,
        classification: { ...cls, requested_bucket: cls.bucket, sticky_language: input.stickyLanguage || null, self_correction: precheck.is_self_correction || false },
      });
    }, { input: { bucket: cls.bucket, confidence: cls.confidence, active_flow: precheck.active_flow || "none", agent: cls.bucket === "reservation" || precheck.active_flow === "reservation" ? "reservation" : cls.bucket === "arrival" ? "arrival" : "friendly" } });

    return { ...result, bucket: cls.bucket, mood: cls.mood, language: cls.language };
  },
});
