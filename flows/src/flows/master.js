// MASTER — the router. Sanitizes, upserts the diner, classifies, dispatches to ONE agent.
// v1: all buckets dispatch to FRIENDLY (reservation/arrival/events agents land next);
// the classification is still real so Executions show true routing + the handoff hints work.
import { defineFlow } from "../engine/flow.js";
import { chatJSON } from "../services/llm.js";
import { MODEL_FAST, MODEL_NANO, log } from "../config.js";
import { detectCloser, matchFaq, matchApprovedFaq, matchMenuCategory, matchService, matchItemPrice, matchItemInfo, matchPriceMath, isGreetingish, isMenuRequest, menuReplyFor } from "../services/fastpaths.js";
import { wantsBuilder } from "../services/fastpaths.js";
import { signBuildToken, builderConfig, priceBuild, describeBuild, LAYERS as BUILDER_LAYERS } from "../services/builder.js";
import { label, isLabel, isLabelKey, entryChips } from "../services/labels.js";
import { PUBLIC_BASE } from "../config.js";
import { bump } from "../services/metrics.js";

const AFFIRMATIVES = /^(yes|yep|yeah|ok|okay|sure|tamam|tmam|aywa|ah|aiwa|maashy|mashy|👍|✅|done|confirm|تأكيد|اكد|أكد|تمام)\W*$/i;
// a bare greeting (nothing else) — used both for the 0-LLM first-timer welcome and the
// classify shortcut so the two never disagree on what counts as "just a greeting"
const GREETING = /^(hi+|hey+|hello+|yo|hala|ahlan|salam( 3alek(o|om|um))?|اهلا|أهلا|هلا|(ال)?سلام( عليكو?م?)?|وعليكم السلام|صباح الخير|مساء الخير|good (morning|evening))[\s!.😊👋🙏]*$/i;
// warm, assumption-free fallbacks when the restaurant hasn't set config.ai.greetings.
// {name} = restaurant name (filled in below). Returning guests never see these — they
// get the context-rich LLM greeting (their usual, birthday, welcome-back).
// EVERY greeting names the restaurant — a welcome that doesn't is a wasted first
// impression, and the lines that omitted {name} were dropped for that reason.
// {icon} is the restaurant's own food emoji (see foodIcon) — never a hardcoded burger.
const DEFAULT_GREETINGS = [
  "Heyy! 👋 Welcome to {name} — what are you craving today? {icon}",
  "Hi there! 😊 Welcome to {name}. What can I get you? {icon}",
];
// An Arabic "اهلا" must never get an English canned line — same rotation, mirrored.
const DEFAULT_GREETINGS_FR = [
  "Ahlan beek fe {name}! 👋 Nefsak fe eh el naharda? {icon}",
  "Heyy! 😊 Menawarna fe {name} — te7eb totlob eh? {icon}",
];
const DEFAULT_GREETINGS_AR = [
  "أهلاً بيك في {name}! 👋 نفسك في إيه النهارده؟ {icon}",
  "أهلاً وسهلاً! 😊 منورنا في {name} — تحب تطلب إيه؟ {icon}",
];

// A RETURNING guest's welcome is just as predictable as a first-timer's: their name,
// their usual, and a way in. It used to cost a full premium model call (8-12s and real
// money) on every "hi" from every regular — the single most repeated message a busy
// restaurant gets. Code writes it now: same warmth, instant, free.
const WELCOME_BACK = {
  en: [
    "Welcome back, {name}! 👋 {usual}",
    "Hey {name}! 😊 Good to see you again. {usual}",
  ],
  ar: [
    "أهلاً يا {name}! 👋 {usual}",
    "أهلاً وسهلاً يا {name}! 😊 نورت تاني. {usual}",
  ],
  fr: [
    "Ahlan ya {name}! 👋 {usual}",
    "Heyy {name}! 😊 Wa7ashtena. {usual}",
  ],
};
const USUAL_LINE = {
  en: (u) => (u ? `Same as last time — *${u}*? Or take a look at the menu.` : "What can I get you today?"),
  ar: (u) => (u ? `زي المرة اللي فاتت — *${u}*؟ أو شوف المنيو.` : "تحب تطلب إيه النهارده؟"),
  fr: (u) => (u ? `Zay el marra elly fatet — *${u}*? Aw shoof el menu.` : "Te7eb totlob eh el naharda?"),
};

// The greeting emoji belongs to the RESTAURANT, not to burgers. Settings wins
// (ai.greeting_emoji); otherwise it is read off their own menu categories, so a
// chicken place greets with 🍗 and a coffee shop with ☕ without anyone configuring it.
const CUISINE_ICONS = [
  [/burger|برجر|برغر/i, "🍔"], [/pizza|بيتزا/i, "🍕"], [/sushi|سوشي/i, "🍣"],
  [/chicken|دجاج|فراخ|تشيكن/i, "🍗"], [/seafood|fish|سمك|بحري/i, "🦐"],
  [/pasta|italian|مكرونة|باستا/i, "🍝"], [/coffee|cafe|قهوة|كافيه/i, "☕"],
  [/dessert|sweet|حلو|حلويات|كيك/i, "🍰"], [/juice|drink|عصير|مشروب/i, "🥤"],
  [/grill|bbq|مشوي|مشويات/i, "🔥"], [/shawarma|شاورما/i, "🌯"],
  [/breakfast|فطار|إفطار/i, "🍳"], [/sandwich|ساندوتش|سندوتش/i, "🥪"],
  [/koshary|كشري|مصري/i, "🍛"], [/taco|mexican|تاكو/i, "🌮"],
];
function foodIcon(config, menuRows) {
  const set = String(config?.ai?.greeting_emoji || "").trim();
  if (set) return set;
  const hay = (menuRows || []).map((m) => `${m.category || ""} ${m.name || ""}`).join(" ");
  const counts = CUISINE_ICONS.map(([re, ic]) => [ic, (hay.match(new RegExp(re.source, "gi")) || []).length]);
  const best = counts.sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : "🍽";
}
// LANGUAGE IS DECIDED BY SCRIPT, NOT BY A MODEL. Arabic script is unambiguous and
// Franco has a stable marker set, so this costs nothing and is never wrong about
// "هاي". It also can never return "unknown" — which is exactly what happened to a
// returning Arabic guest: the rule below passed language "unknown" downstream, the
// host had nothing to mirror, and he got an English welcome with English buttons on
// his first message back. An extra LLM "language agent" would cost a call per message
// and still be less certain than reading the alphabet.
const FRANCO_HINT = /(3ayez|3aiz|3awez|3awz|2ol|ezay|fein|fen|emta|khalas|shokran|habibi|ya basha|law sama7t|ma3lesh|delwa2ty|akl|akol|tamam|kwayes|sabah el|masa el|3alek|nefsak|te7eb|momken|bta3|naharda|3andko|3andokom|hat|hatli|ab3at)/i;
// exported so the ops language split reports what the BOT actually decided, rather
// than a second, subtly different guess living in the console
export function detectLang(message, sticky) {
  const s = String(message || "");
  if (/[\u0600-\u06FF]/.test(s)) return "ar";
  // a bare URL / pin / number carries no language — keep whatever the guest was
  // speaking (an Arabic guest sending a Maps link got a Franco refusal)
  const words = s.replace(/https?:\/\/\S+/g, "").replace(/[^\p{L}]/gu, "");
  if (!words && sticky) return sticky;
  if (FRANCO_HINT.test(s)) return "franco";
  return sticky || "en";
}
// The classifier may still answer "unknown"/"mixed", or disagree with the alphabet.
// The alphabet wins — a message in Arabic script is Arabic, whatever the model thinks.
function settleLang(modelLang, message, sticky) {
  const code = detectLang(message, sticky);
  if (/[\u0600-\u06FF]/.test(String(message || ""))) return "ar";
  // LATIN IN → NEVER ARABIC OUT. The classifier labelled "3ayez classic burger" as
  // Arabic (it IS Arabic, just written in Latin letters), and the order flow then
  // rendered his whole bill in Arabic script — dish name, subtotal label and all —
  // to a guest who had never typed an Arabic character.
  // (Only when the message actually contains Latin LETTERS — a bare Maps link or
  // pin from an Arabic guest keeps their language, resolved by detectLang above.)
  const latinWords = /\p{Script=Latin}/u.test(String(message || "").replace(/https?:\/\/\S+/g, ""));
  if (modelLang === "ar") return !latinWords ? code : (code === "ar" ? "franco" : code);
  if (!modelLang || modelLang === "unknown" || modelLang === "mixed") return code;
  return modelLang;
}

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
        // a transcribed voice note arrives as "[voice] …" — the marker is metadata, not
        // words; fast paths and the classifier must see the transcript alone
        .replace(/^\s*\[voice\]\s*/i, "")
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
      // A bare pin / Maps link with NO order in progress: acknowledge the location and
      // invite the order — code, no model. It used to be greeted like "hi", and the
      // location sat unused so delivery asked for the address again.
      const bareLoc = (/https?:\/\/[^\s]*(google\.[a-z.]+\/maps|maps\.google|maps\.app\.goo\.gl|goo\.gl\/maps|waze\.com)/i.test(message) || /^\[shared location\]|^\[location\]/i.test(message))
        && !/\p{L}{4,}/u.test(message.replace(/https?:\/\/\S+/g, "").replace(/^\[shared location\][^(]*/i, ""));
      if (bareLoc && input.precheck?.active_flow !== "order") {
        bump("faq_hits");
        // a bare URL carries no language: follow the sticky one; with none, greet in
        // both scripts so neither an Arabic nor a Latin guest gets a foreign line
        const lg = input.stickyLanguage || null;
        const reply = lg === "ar" ? "وصلني اللوكيشن 📍 تحب تطلب إيه؟" : lg === "franco" ? "Wasalny el location 📍 te7eb totlob eh?" : lg === "en" ? "Got your location 📍 What would you like to order?" : "Got your location 📍 What would you like to order?\nوصلني اللوكيشن 📍 تحب تطلب إيه؟";
        return { kind: "location_ack", language: lg || "en", reply };
      }

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
          const icon = foodIcon(ctx.tenant.config, await getMenu(db).catch(() => []));
          let reply = String(pool[greetIdx++ % pool.length])
            .replace(/\{name\}/g, rname)
            .replace(/\{icon\}/g, icon);
          // The signature nudge does NOT belong here. A greeting is hospitality —
          // "welcome, what are you in the mood for?" — and the recommendation lands
          // where it's useful: on the MENU message, when they browse or start ordering.
          // Ways IN, on the greeting itself. This is a 0-LLM fast path, so it skips the
          // flow that normally attaches entry chips — the founder's greeting arrived
          // with no buttons at all. Order-first when the restaurant asks type first.
          const chipLang = isAr ? "ar" : isFr ? "fr" : "en";
          const cfg = ctx.tenant.config;
          const entry = entryChips(cfg, chipLang, { builderEnabled: builderConfig(cfg).enabled });
          return { kind: "greeting", reply, quick_replies: entry, language: isAr ? "ar" : (sticky || undefined) };
        }

        // KNOWN GUEST, bare greeting → also answered in code. One cheap DB read for
        // their usual; no model. Anything richer than a welcome (a question, an order)
        // never reaches here, so the host still handles everything that needs thought.
        const knownName = (diner?.name || "").trim().split(/\s+/)[0];
        if (knownName && !diner?.preferences?.pending_order) {
          const lg = detectLang(message, sticky);
          const lgk = lg === "ar" ? "ar" : lg === "franco" ? "fr" : "en";
          let usual = null;
          try {
            const { data: past } = await db.from("orders").select("items")
              .eq("phone_number", ctx.sessionId).neq("status", "cancelled")
              .order("created_at", { ascending: false }).limit(1);
            const first = past?.[0]?.items?.[0];
            if (first?.name) {
              const menuRows = await getMenu(db).catch(() => []);
              const row = menuRows.find((m) => m.name === first.name && m.available);
              usual = row ? (lgk === "ar" && row.name_ar ? row.name_ar : row.name) : null;
            }
          } catch { /* no usual is fine — the greeting still works */ }
          bump("greeting_hits");
          const pool = WELCOME_BACK[lgk];
          const reply = String(pool[greetIdx++ % pool.length])
            .replace(/\{name\}/g, knownName)
            .replace(/\{usual\}/g, USUAL_LINE[lgk](usual));
          const cfg2 = ctx.tenant.config;
          const chips = entryChips(cfg2, lgk, { builderEnabled: builderConfig(cfg2).enabled, hasUsual: !!usual });
          // their usual leads when they have one — it's the fastest way back in
          if (usual && !chips.includes(label(cfg2, "same_as_last", lgk))) {
            chips.unshift(label(cfg2, "same_as_last", lgk));
          }
          return { kind: "greeting", reply, quick_replies: chips.slice(0, 3), language: lg };
        }
      }
      // THE MENU IS A DOCUMENT — answer it in code. This used to wake the big model
      // with the whole menu in the prompt just to say "here's the menu" and attach the
      // same PDF; on a slow call it crossed 15s and the guest got "one sec" and nothing.
      // Instant, free, and it cannot fail the way an LLM turn can.
      if (isMenuRequest(message)) {
        const menuRows = (await getMenu(db).catch(() => [])).filter((m) => m.available);
        const built = menuRows.length ? menuReplyFor(ctx.tenant.config, menuRows, message, sticky, diner) : null;
        // No uploaded PDF (Just Smash) → generate the menu PDF here, same cached
        // builder the order flow uses. Without this the free path only worked for
        // restaurants with a designed PDF and everyone else woke the model.
        if (built && !built.pdfUrl) {
          try {
            const cfg = ctx.tenant.config;
            const { menuPdfUrl } = await import("../services/menupdf.js");
            const { orderedCategories } = await import("../services/categories.js");
            const pdf = await menuPdfUrl(db, {
              restaurant: cfg.name, menu: menuRows, categories: orderedCategories(menuRows, cfg).map((c) => c.name),
              currency: cfg.payments?.currency || "EGP", accent: cfg.basic_info?.brand?.primary || "#111111",
              tagline: cfg.basic_info?.tagline || "", phone: cfg.basic_info?.phone || "", website: cfg.basic_info?.website || "",
              logoUrl: cfg.basic_info?.brand?.logo_url || null,
            });
            if (pdf?.url) built.pdfUrl = pdf.url;
          } catch (e) { log("menu fast path: pdf build failed:", e.message); }
        }
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

      // "Same as last time" — tapped or typed, or a plain "yes" to the usual we just
      // offered in the greeting. The intent is already certain, so it goes straight to
      // the order agent with the extractor skipped: no model, no wait.
      if (isLabelKey(ctx.tenant.config, message, "same_as_last")
        || /^(?:\W*)(same as last( time)?|the usual|my usual|نفس الطلب|نفس المرة اللي فاتت|زي المرة اللي فاتت|زي كل مرة|nafs el order|zay el marra)(?:\W*)$/i.test(message.trim())
        || (AFFIRMATIVES.test(message.trim()) && /same as last|زي المرة اللي فاتت|zay el marra/i.test(String(input.lastAiMessage || "")))) {
        bump("greeting_hits");
        return { kind: "repeat_last_shortcut" };
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
      const catList = await matchMenuCategory(db, message, currency, ctx.tenant.config);
      if (catList) { bump("menu_category_hits"); return catList; }
      const itemPrice = await matchItemPrice(db, message, currency, sticky);
      if (itemPrice) { bump("item_price_hits"); return itemPrice; }
      // multi-item totals are arithmetic — code adds, never the model
      const priceMath = await matchPriceMath(db, message, currency, sticky);
      if (priceMath) { bump("price_math_hits"); return priceMath; }
      const itemInfo = await matchItemInfo(db, message, sticky, currency);
      if (itemInfo) { bump("item_info_hits"); return itemInfo; }
      return { kind: "none — needs classification + LLM" };
    }, { input: { message, sticky_language: input.stickyLanguage || null } });

    // Language mirror is a hard rule even for canned answers: an Arabic message must
    // never get an English cached reply (and vice versa) — mismatches fall through to
    // the LLM, which answers from the same facts in the guest's language.
    const guestAr = /[\u0600-\u06FF]/.test(message);
    const replyAr = fast.reply ? /[\u0600-\u06FF]/.test(fast.reply) : false;
    const langMismatch = fast.reply && !fast.media && ((guestAr && !replyAr) || (!guestAr && replyAr));
    if (fast.kind === "repeat_last_shortcut") {
      return f.flow("order", {
        message, diner, history: input.history, precheck: input.precheck || {},
        forcedIntent: "repeat_last",
        classification: { bucket: "order", intent: "repeat_last", confidence: 1, mood: "neutral",
          language: detectLang(message, input.stickyLanguage), via: "fast path (usual shortcut)" },
      });
    }
    if (fast.reply && !langMismatch) {
      return { reply: fast.reply, quickReplies: fast.quick_replies || [], menuDoc: fast.menu_doc || null, photos: fast.photos || [], fast_path: fast.kind, language: fast.language, bucket: "fast_path" };
    }

    const precheck = input.precheck || {};
    const isAffirmative = precheck.is_affirmative ?? AFFIRMATIVES.test(message.trim());
    const classification = await f.node("classify", async () => {
      // session override: mid-reservation + bare "yes" → stays in the reservation flow, zero LLM
      if (isAffirmative && precheck.active_flow === "reservation") {
        return { value: { bucket: "reservation", intent: "confirm_reservation", confidence: 1, mood: "neutral", language: detectLang(message, input.stickyLanguage), via: "rule (affirmative in active reservation session)" } };
      }
      // a draft order in progress is session STATE, not a guess about wording — a bare
      // "yes" mid-order is a confirmation, and belongs to the ORDER agent, full stop
      if (isAffirmative && precheck.active_flow === "order") {
        return { value: { bucket: "order", intent: "confirm", confidence: 1, mood: "neutral", language: detectLang(message, input.stickyLanguage), via: "rule (affirmative in active order session)" } };
      }
      if (isAffirmative) {
        return { value: { bucket: "friendly", confidence: 1, mood: "neutral", language: detectLang(message, input.stickyLanguage), via: "rule (bare affirmative)" } };
      }
      // a bare greeting is friendly, full stop — no model needed to know that
      if (GREETING.test(message.trim()) || isGreetingish(message)) {
        return { value: { bucket: "friendly", confidence: 1, mood: "neutral", language: detectLang(message, input.stickyLanguage), via: "rule (bare greeting)" } };
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
      // A Maps link / shared pin during an active order IS the delivery address — it
      // belongs to the order flow whatever its length (URLs are long). Friendly once
      // answered it with the old flat zone fee and its own "Place order" buttons.
      if (precheck.active_flow === "order" && /https?:\/\/[^\s]*(google\.[a-z.]+\/maps|maps\.google|maps\.app\.goo\.gl|goo\.gl\/maps|waze\.com)|^\[location\]/i.test(message)) {
        return { value: { bucket: "order", confidence: 1, mood: "neutral", language: detectLang(message, input.stickyLanguage), via: "rule (map link / pin inside an active order)" } };
      }
      if (precheck.active_flow === "order" && message.trim().length <= 45) {
        return { value: { bucket: "order", confidence: 1, mood: "neutral", language: detectLang(message, input.stickyLanguage), via: "rule (short message inside an active order — order flow re-routes non-order ones)" } };
      }
      // A filled-in slots template ("FIRST CHOICE / SANDWICH: iconic / NOTES: …")
      // is structurally an order answer. The classifier once filed one under
      // friendly and dropped the whole order — structure is code's job, not a
      // model's. Two or more "LABEL:" lines during an active order = order.
      if (precheck.active_flow === "order" && (message.match(/^\s*[\p{L} ]{2,24}:/gmu) || []).length >= 2) {
        return { value: { bucket: "order", confidence: 1, mood: "neutral", language: detectLang(message, input.stickyLanguage), via: "rule (filled template inside an active order)" } };
      }
      // A bare pin / Maps link with NO order in progress: acknowledge the location in
      // code and invite the order — it used to be greeted like "hi" (and the location
      // sat unused, so delivery asked for the address again).

      // A message that is JUST a dish name ("سيجناتشر برجر", "classic burger") is an
      // ORDER, not a question — the guest is picking, the way people answer a menu.
      // Friendly used to send a product card + photo and ask "want to try it?".
      // Only when nothing marks it as a question (no ?/بكام/how much/what's in).
      if (!/[?؟]/.test(message) && !/(بكام|how much|price|سعر|what'?s in|فيه ايه|ingredients|مكونات|spicy|حار)/i.test(message) && message.trim().length <= 40) {
        const names = await menuNames(db);
        const { getMenu } = await import("../services/menucache.js");
        const rows = await getMenu(db).catch(() => []);
        const arNames = rows.filter((m) => m.available && m.name_ar).map((m) => String(m.name_ar));
        const nz = (s) => String(s || "").toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
        const said = nz(message);
        const isDish = names.some((n) => nz(n) === said) || arNames.some((n) => nz(n) === said || nz(n).replace(/\s*[٠-٩0-9]+\s*قطع$/, "").trim() === said);
        if (isDish) {
          return { value: { bucket: "order", confidence: 1, mood: "neutral", language: detectLang(message, input.stickyLanguage), via: "rule (bare dish name = order)" } };
        }
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
          return { value: { bucket: "order", confidence: 1, mood: "neutral", language: detectLang(message, input.stickyLanguage), via: "rule (menu item + order-type wording)" } };
        }
      }
      // A FULL menu item name plus an ordering cue — a want-verb ("3ayez", «عايز», "i
      // want", "hat"), a count ("2 …"), a format word (sandwich/combo/meal) or a removal
      // ("men gheir mekhalel", «بدون بصل», "no onion") — is an ORDER. The classifier once
      // filed "smoky bbq burger sandwich men gheir mekhalel w men gheir basal" as chat and
      // friendly narrated the order without placing it. Never with a question mark / price word.
      if (!/[?؟]/.test(message) && !/(بكام|how much|price|سعر|what'?s in|فيه ايه|ingredients|مكونات)/i.test(message)) {
        const CUE = /(?<![\p{L}\p{N}])(3ayez|3ayza|3awez|3awza|hat|hatli|i want|i'?d like|get me|give me|can i get|عايز|عايزة|عاوز|عاوزة|هات|هاتلي|ابعتلي|sandwich|sandawetsh|combo|kombo|meal|wagba|ساندوتش|ساندويتش|كومبو|وجبة|men gheir|min gheir|bedoon|without|بدون|من غير|بلاش)(?![\p{L}\p{N}])|(?:^|\s)(\d{1,2}|[٠-٩]{1,2}|one|two|three|wa7ed|etnen|واحد|اتنين|تلاتة)\s+\p{L}/iu;
        if (CUE.test(message) && message.trim().length <= 160) {
          const names = await menuNames(db);
          const { getMenu } = await import("../services/menucache.js");
          const rows = await getMenu(db).catch(() => []);
          const nz = (s2) => String(s2 || "").toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
          const said = ` ${nz(message)} `;
          const full = (n) => { const x = nz(n); return x.split(" ").length >= 2 && said.includes(` ${x} `); };
          const hit = names.some(full) || rows.filter((m) => m.available && m.name_ar).some((m) => full(m.name_ar) || full(String(m.name_ar).replace(/\s*[٠-٩0-9]+\s*قطع$/, "")));
          if (hit) return { value: { bucket: "order", confidence: 1, mood: "neutral", language: detectLang(message, input.stickyLanguage), via: "rule (full menu item name + ordering cue)" } };
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
        classification: { ...cls, language: settleLang(cls.language, message, input.stickyLanguage), requested_bucket: cls.bucket, sticky_language: input.stickyLanguage || null, self_correction: precheck.is_self_correction || false },
      });
    }, { input: { bucket: cls.bucket, confidence: cls.confidence, active_flow: precheck.active_flow || "none", restaurant_type: ctx.tenant.config.basic_info?.restaurant_type || "fine" } });

    return { ...result, bucket: cls.bucket, mood: cls.mood, language: settleLang(cls.language, message, input.stickyLanguage) };
  },
});
