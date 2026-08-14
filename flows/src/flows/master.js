// MASTER — the router. Sanitizes, upserts the diner, classifies, dispatches to ONE agent.
// v1: all buckets dispatch to FRIENDLY (reservation/arrival/events agents land next);
// the classification is still real so Executions show true routing + the handoff hints work.
import { defineFlow } from "../engine/flow.js";
import { chatJSON } from "../services/llm.js";
import { MODEL_FAST, MODEL_NANO } from "../config.js";
import { detectCloser, matchFaq, matchApprovedFaq, matchMenuCategory, matchService, matchItemPrice, matchItemInfo, matchPriceMath, isGreetingish, isMenuRequest, menuReplyFor } from "../services/fastpaths.js";
import { wantsBuilder } from "../services/fastpaths.js";
import { signBuildToken, builderConfig, priceBuild, describeBuild, LAYERS as BUILDER_LAYERS } from "../services/builder.js";
import { label, isLabel, isLabelKey } from "../services/labels.js";
import { PUBLIC_BASE } from "../config.js";
import { bump } from "../services/metrics.js";

const AFFIRMATIVES = /^(yes|yep|yeah|ok|okay|sure|tamam|tmam|aywa|ah|aiwa|maashy|mashy|👍|✅|done|confirm|تأكيد|اكد|أكد|تمام)\W*$/i;
// a bare greeting (nothing else) — used both for the 0-LLM first-timer welcome and the
// classify shortcut so the two never disagree on what counts as "just a greeting"
const GREETING = /^(hi+|hey+|hello+|yo|hala|ahlan|salam( 3alek(o|om|um))?|اهلا|أهلا|هلا|(ال)?سلام( عليكو?م?)?|وعليكم السلام|صباح الخير|مساء الخير|good (morning|evening))[\s!.😊👋🙏]*$/i;
// warm, assumption-free fallbacks when the restaurant hasn't set config.ai.greetings.
// {name} = restaurant name (filled in below). Returning guests never see these — they
// get the context-rich LLM greeting (their usual, birthday, welcome-back).
const DEFAULT_GREETINGS = [
  "Heyy! 👋 Welcome to {name} — what are you craving today? 🍔",
  "Hi there! 😊 Welcome to {name}. What can I get you?",
  "Ahlan! 🙌 Ready when you are — what would you like today?",
];
// An Arabic "اهلا" must never get an English canned line — same rotation, mirrored.
const DEFAULT_GREETINGS_FR = [
  "Ahlan beek fe {name}! 👋 Nefsak fe eh el naharda? 🍔",
  "Heyy! 😊 Menawarna fe {name} — te7eb totlob eh?",
  "Ya hala! 🙌 Gahzeen le orderak — te7eb takol eh?",
];
const DEFAULT_GREETINGS_AR = [
  "أهلاً بيك في {name}! 👋 نفسك في إيه النهارده؟ 🍔",
  "أهلاً وسهلاً! 😊 منورنا في {name} — تحب تطلب إيه؟",
  "يا هلا! 🙌 جاهزين لطلبك — تحب تاكل إيه النهارده؟",
];
let greetIdx = 0; // rotates the canned line so it isn't identical every time

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
      // A4: a brand-new guest saying only "hi" → warm canned welcome, 0 LLM (~instant).
      // Returning/known guests fall through to the LLM greeting (usual/birthday/welcome-back
      // — enforced by the suite), and anyone who says more than a bare greeting also falls through.
      if (GREETING.test(message.trim()) || isGreetingish(message)) {
        const firstTimer = !diner?.name && !(diner?.visit_count > 0) && !diner?.last_visit_at
          && !diner?.preferences?.occasions?.birthday && !diner?.preferences?.pending_order;
        if (firstTimer) {
          bump("greeting_hits");
          const rname = ctx.tenant.config.basic_info?.name || ctx.tenant.config.name || "us";
          const isAr = /[\u0600-\u06FF]/.test(message);
          // On a FIRST message there is no sticky language yet, so "salam 3aleko" was
          // getting the English welcome. Franco is recognisable from the words themselves.
          const isFr = !isAr && (sticky === "franco"
            || /(3alek|3aleko|salam|ahlan|ezay(ak|ek)?|hala|sabah el|masa el|izayak)/i.test(message));
          const cfgPool = isAr ? ctx.tenant.config.ai?.greetings_ar : ctx.tenant.config.ai?.greetings;
          const pool = cfgPool?.length ? cfgPool : (isAr ? DEFAULT_GREETINGS_AR : isFr ? DEFAULT_GREETINGS_FR : DEFAULT_GREETINGS);
          let reply = String(pool[greetIdx++ % pool.length]).replace(/\{name\}/g, rname);
          // The signature nudge does NOT belong here. A greeting is hospitality —
          // "welcome, what are you in the mood for?" — and the recommendation lands
          // where it's useful: on the MENU message, when they browse or start ordering.
          // Ways IN, on the greeting itself. This is a 0-LLM fast path, so it skips the
          // flow that normally attaches entry chips — the founder's greeting arrived
          // with no buttons at all. Order-first when the restaurant asks type first.
          const chipLang = isAr ? "ar" : isFr ? "fr" : "en";
          const cfg = ctx.tenant.config;
          const entry = cfg.ai?.ask_type_first === true
            ? [label(cfg, "order_now", chipLang), label(cfg, "browse_menu", chipLang)]
            : [label(cfg, "browse_menu", chipLang), label(cfg, "order_now", chipLang)];
          if (builderConfig(cfg).enabled) entry.push(label(cfg, "build_your_own", chipLang));
          return { kind: "greeting", reply, quick_replies: entry.slice(0, 3), language: isAr ? "ar" : (sticky || undefined) };
        }
      }
      // THE MENU IS A DOCUMENT — answer it in code. This used to wake the big model
      // with the whole menu in the prompt just to say "here's the menu" and attach the
      // same PDF; on a slow call it crossed 15s and the guest got "one sec" and nothing.
      // Instant, free, and it cannot fail the way an LLM turn can.
      if (isMenuRequest(message)) {
        const menuRows = (await getMenu(db).catch(() => [])).filter((m) => m.available);
        const built = menuRows.length ? menuReplyFor(ctx.tenant.config, menuRows, message, sticky, diner) : null;
        if (built?.pdfUrl) {
          bump("faq_hits");
          return {
            kind: "menu_request",
            reply: built.reply,
            language: built.language,
            menu_doc: { url: built.pdfUrl, filename: "menu.pdf", caption: null },
          };
        }
      }

      // "build my own" hands over a signed one-guest link instead of an answer.
      // Offered only when the restaurant has actually priced its layers — an
      // unpriced builder would quote numbers nobody set.
      // "Adel's Double Smash 🔁" — their own saved creation, rebuilt and priced by code
      // from the layers stored against their number. One tap, no builder round trip.
      if (builderConfig(ctx.tenant.config).enabled) {
        const saved = (diner?.preferences?.builds || [])[0];
        if (saved?.name && saved.layers && isLabel(message, `${String(saved.name).slice(0, 18)} 🔁`)) {
          const priced = priceBuild(ctx.tenant.config, saved.layers);
          if (priced.lines.length) {
            bump("saved_build_hits");
            const summary = describeBuild(priced.lines);
            // A saved build can reference an ingredient the restaurant has since
            // un-priced (menu changed after it was saved). priceBuild silently drops
            // those — replaying the "usual" and quietly handing over a different burger
            // is worse than saying so. Name what's missing.
            const keptIds = new Set(priced.lines.map((l) => l.id));
            const droppedNames = Object.keys(saved.layers || {})
              .filter((id) => (saved.layers[id] || 0) > 0 && !keptIds.has(id))
              .map((id) => BUILDER_LAYERS.find((L) => L.id === id)?.name)
              .filter(Boolean);
            const droppedNote = droppedNames.length
              ? `\n(heads up — ${droppedNames.join(" and ")} ${droppedNames.length > 1 ? "aren't" : "isn't"} available right now, so I left ${droppedNames.length > 1 ? "them" : "it"} off)`
              : "";
            const pending = diner.preferences?.pending_order || {};
            await db.from("diners").update({
              preferences: {
                ...(diner.preferences || {}),
                pending_order: {
                  ...pending,
                  items: [...(pending.items || []), {
                    name: saved.name, qty: 1, unit_price: priced.total,
                    notes: summary, options: priced.lines.map((l) => `${l.qty}× ${l.name}`).join(" · "),
                    build: saved.layers,
                  }],
                  at: new Date().toISOString(),
                },
              },
            }).eq("id", diner.id).then(() => {}, () => {});
            return {
              kind: "saved_build",
              reply: `${saved.name} it is 🍔\n${summary}\n${priced.currency} ${priced.total}${droppedNote}\n\nHow would you like it — dine-in, pickup or delivery?`,
            };
          }
        }
      }

      if ((wantsBuilder(message) || isLabelKey(ctx.tenant.config, message, "build_your_own")) && builderConfig(ctx.tenant.config).enabled) {
        bump("builder_hits");
        const token = signBuildToken({ sessionId: ctx.sessionId, slug: ctx.tenant.config.slug });
        return {
          kind: "builder_link",
          reply: `Build it exactly how you want it 👇\n${PUBLIC_BASE}/build/${token}\n\nStack it, see the price as you go, and send it straight to the kitchen.`,
        };
      }
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

    // Language mirror is a hard rule even for canned answers: an Arabic message must
    // never get an English cached reply (and vice versa) — mismatches fall through to
    // the LLM, which answers from the same facts in the guest's language.
    const guestAr = /[\u0600-\u06FF]/.test(message);
    const replyAr = fast.reply ? /[\u0600-\u06FF]/.test(fast.reply) : false;
    const langMismatch = fast.reply && !fast.media && ((guestAr && !replyAr) || (!guestAr && replyAr));
    if (fast.reply && !langMismatch) {
      return { reply: fast.reply, quickReplies: fast.quick_replies || [], menuDoc: fast.menu_doc || null, fast_path: fast.kind, language: fast.language, bucket: "fast_path" };
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
      if (GREETING.test(message.trim()) || isGreetingish(message)) {
        return { value: { bucket: "friendly", confidence: 1, mood: "neutral", language: input.stickyLanguage || "unknown", via: "rule (bare greeting)" } };
      }
      // A live order session tells us where a short message belongs. Bare answers to our
      // own questions ("Maadi", "T3", "sprite", "card", "Medium", an address) are the
      // overwhelming majority of mid-order turns, and the small classifier is NOT reliable
      // at routing those to the order flow — dropping this rule silently broke real orders.
      // So we still route mid-order messages to ORDER. The key: the order flow itself now
      // hands any NON-order message (a question, chit-chat — extractor intent "other" with
      // no order content) straight to friendly (order.js handoff_to_friendly), so
      // "بتوصلوا المعادي؟" gets a real answer instead of a menu dump — WITHOUT us guessing
      // question-vs-answer by length here. Routing stays simple; the smart decision lives
      // where the extractor already read the message.
      if (precheck.active_flow === "order" && message.trim().length <= 45) {
        return { value: { bucket: "order", confidence: 1, mood: "neutral", language: input.stickyLanguage || "unknown", via: "rule (short message inside an active order — order flow re-routes non-order ones)" } };
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
- "order": wants food MADE now — placing/changing/cancelling an order, or chasing one ("2 burgers for pickup", "an iconic meal for dine in at Maadi", "same as last time", "the usual please", "نفس الطلب", "where's my order"). Naming a dish WITH an order-type word (dine-in/pickup/delivery) is an order even with no verb. ACCEPTING a dish we just recommended is an ORDER: when OUR LAST MESSAGE pitched a dish and they reply "thats nice i want this" / "ok get me that" / "yes that one" / "هاته" / "تمام عايزه" — that's them ordering it, never friendly chit-chat. A MIXED message counts too: if ANY part of it is an order action ("add a J special — and is the jalapeno bites spicy?"), the bucket is "order" — the order flow answers the question part as well, so nothing is lost. Asking what's on their CURRENT order/draft ("so now my order is?", "طلبي فيه ايه") is also "order".
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
