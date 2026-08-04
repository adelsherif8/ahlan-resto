// MASTER — the router. Sanitizes, upserts the diner, classifies, dispatches to ONE agent.
// v1: all buckets dispatch to FRIENDLY (reservation/arrival/events agents land next);
// the classification is still real so Executions show true routing + the handoff hints work.
import { defineFlow } from "../engine/flow.js";
import { chatJSON } from "../services/llm.js";
import { MODEL_FAST, MODEL_NANO } from "../config.js";
import { detectCloser, matchFaq, matchApprovedFaq, matchMenuCategory, matchService, matchItemPrice, matchItemInfo, matchPriceMath } from "../services/fastpaths.js";
import { bump } from "../services/metrics.js";

const AFFIRMATIVES = /^(yes|yep|yeah|ok|okay|sure|tamam|tmam|aywa|ah|aiwa|maashy|mashy|👍|✅|done|confirm)\W*$/i;

import { getMenu } from "../services/menucache.js";

// menu names for the verbless-order rule — served by the shared 20s menu cache
async function menuNames(db) {
  const rows = await getMenu(db).catch(() => []);
  return rows.filter((m) => m.available).map((m) => String(m.name).toLowerCase());
}

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
      // staff-approved FAQ answers — every approval is a free turn forever
      const afaq = matchApprovedFaq(message, ctx.tenant.config);
      if (afaq) { bump("faq_approved_hits"); return afaq; }
      const svc = matchService(message, ctx.tenant.config, sticky);
      if (svc) { bump("service_hits"); return svc; }
      const currency = ctx.tenant.config.payments?.currency || "EGP";
      const catList = await matchMenuCategory(db, message, currency);
      if (catList) { bump("menu_category_hits"); return catList; }
      const itemPrice = await matchItemPrice(db, message, currency, sticky);
      if (itemPrice) { bump("item_price_hits"); return itemPrice; }
      // multi-item totals are arithmetic — code adds, never the model
      const priceMath = await matchPriceMath(db, message, currency, sticky);
      if (priceMath) { bump("price_math_hits"); return priceMath; }
      const itemInfo = await matchItemInfo(db, message, sticky);
      if (itemInfo) { bump("item_info_hits"); return itemInfo; }
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
      // a bare greeting is friendly, full stop — no model needed to know that
      if (/^(hi+|hey+|hello+|yo|hala|ahlan|اهلا|أهلا|هلا|السلام عليكم|صباح الخير|مساء الخير|good (morning|evening))[\s!.😊👋🙏]*$/i.test(message.trim())) {
        return { value: { bucket: "friendly", confidence: 1, mood: "neutral", language: input.stickyLanguage || "unknown", via: "rule (bare greeting)" } };
      }
      // A live order session already tells us where this belongs. Short answers to
      // our own questions ("Maadi", "T3", "sprite", "card", an address) are the
      // overwhelming majority of mid-order turns — classifying them again buys
      // nothing and costs a call. A longer message might be a genuine change of
      // subject, so that still goes to the model.
      if (precheck.active_flow === "order" && message.trim().length <= 45) {
        return { value: { bucket: "order", confidence: 1, mood: "neutral", language: input.stickyLanguage || "unknown", via: "rule (short answer inside an active order)" } };
      }
      // A filled-in slots template ("FIRST CHOICE / SANDWICH: iconic / NOTES: …")
      // is structurally an order answer. The classifier once filed one under
      // friendly and dropped the whole order — structure is code's job, not a
      // model's. Two or more "LABEL:" lines during an active order = order.
      if (precheck.active_flow === "order" && (message.match(/^\s*[\p{L} ]{2,24}:/gmu) || []).length >= 2) {
        return { value: { bucket: "order", confidence: 1, mood: "neutral", language: input.stickyLanguage || "unknown", via: "rule (filled template inside an active order)" } };
      }
      // "an iconic wrap meal for dine in at Sheraton" — no verb, but a menu item
      // plus an order-type word is an order, period. Real guests phrase it exactly
      // like this and the model sometimes filed it under friendly.
      const TYPE_WORD = /(?<![\p{L}\p{N}])(dine.?in|pick.?up|pickup|take.?away|deliver(y|ed)?|توصيل|استلام|تيك ?اواي)(?![\p{L}\p{N}])/iu;
      if (TYPE_WORD.test(message) && !/[?؟]/.test(message)) {
        const names = await menuNames(db);
        const ml = ` ${message.toLowerCase()} `;
        const hit = names.some((n) => {
          if (ml.includes(` ${n} `) || ml.includes(` ${n},`) || ml.includes(` ${n}.`)) return true;
          const tok = n.split(/\s+/)[0];
          // whole word only — a prefix match hijacked questions mentioning
          // places/words that merely start like an item name
          return tok.length >= 4 && new RegExp(`\\b${tok.replace(/[.*+?^${'$'}{}()|[\\]\\\\]/g, "\\$&")}\\b`).test(ml);
        });
        if (hit) {
          return { value: { bucket: "order", confidence: 1, mood: "neutral", language: input.stickyLanguage || "unknown", via: "rule (menu item + order-type wording)" } };
        }
      }
      const system = `Classify a WhatsApp message to a trendy Cairo restaurant. Reply JSON only.
Buckets:
- "reservation": wants/asks about booking, changing, cancelling a table ("table for 4", "احجزلي", "cancel my booking")
- "arrival": is at/near the restaurant now ("I'm here", "wa2eft barra", "running late 10 min")
- "events": asks about parties/DJ nights/special events or wants to RSVP
- "order": wants food MADE now — placing/changing/cancelling an order, or chasing one ("2 burgers for pickup", "an iconic meal for dine in at Maadi", "same as last time", "the usual please", "نفس الطلب", "where's my order"). Naming a dish WITH an order-type word (dine-in/pickup/delivery) is an order even with no verb.
  NOT "order": a QUESTION about the menu — price, total, calories, ingredients, what's available ("how much is X?", "total for 2 burgers?", "بكام"). Naming a dish is not ordering it; asking what something costs is "friendly".
- "friendly": everything else — greetings, menu questions, hours, location, complaints, chit-chat (DEFAULT when unsure)
CONTINUATION RULE (most important): ORDER IN PROGRESS is ${precheck.active_flow === "order" ? `YES, stage "${precheck.stage}"` : "no"}. When an order is in progress, the guest is answering us — a drink name, a branch, "T3", "pickup", "card", "yes", an address — ALL of that is bucket "order", never friendly. Only route elsewhere if they clearly changed the subject (asking hours, complaining, booking a table).
OUR LAST MESSAGE: ${JSON.stringify(String(input.lastAiMessage || "").slice(0, 300))}
Also detect mood: happy|neutral|frustrated|urgent|confused, and language: en|ar|franco|mixed.
Return: {"bucket": "...", "confidence": 0-1, "mood": "...", "language": "..."}`;
      return chatJSON(MODEL_NANO, system, message, { temperature: 0, maxTokens: 120 });
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
      // The classifier already knows an order is in progress (CONTINUATION RULE) and
      // is allowed to route a genuine subject change elsewhere — forcing the order
      // agent for the whole draft TTL hijacked parking questions and complaints.
      // The force survives only as a fallback when classification produced nothing.
      const agent = (cls.bucket === "order" || (precheck.active_flow === "order" && !cls.bucket)) && rtype === "casual" ? "order"
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
    }, { input: { bucket: cls.bucket, confidence: cls.confidence, active_flow: precheck.active_flow || "none", restaurant_type: ctx.tenant.config.basic_info?.restaurant_type || "fine" } });

    return { ...result, bucket: cls.bucket, mood: cls.mood, language: cls.language };
  },
});
