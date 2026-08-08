// FRIENDLY (host agent) — the restaurant's voice. Answers ONLY from config + DB.
// Ported logic: hotel friendly.json context builder + persona prompt, restaurant domain.
import { defineFlow } from "../engine/flow.js";
import { getMenu } from "../services/menucache.js";
import { chatJSON } from "../services/llm.js";
import { MODEL_SMART, MODEL_FAST, PUBLIC_BASE, publicLink } from "../config.js";
import { hoursToday } from "../services/tenant.js";
import { setSessionFlags, notifyDashboard, getSession } from "../services/chatlog.js";
import { todayISO } from "../services/availability.js";
import { branchList, nearestBranches, matchBranchByText, freshLocation } from "../services/branches.js";
import { menuPdfUrl } from "../services/menupdf.js";
import { label } from "../services/labels.js";
import { builderConfig } from "../services/builder.js";

// rolling-summary cooldown: refresh at most once per 10 min per session
// (history is capped at 20 turns, so a turn-count gate alone would stall at the cap)
const SUMMARY_COOLDOWN_MS = 10 * 60_000;
const lastSummaryAt = new Map(); // sessionId -> ts

defineFlow({
  name: "friendly",
  description: "Host agent — general questions, menu, hours, FAQs, occasions, handoff",
  trigger: { icon: "branch", label: "Dispatched by MASTER" },
  nodes: [
    { id: "build_context", label: "Build Context", icon: "database" },
    { id: "reply_llm", label: "Reply LLM", icon: "sparkles" },
    { id: "side_effects", label: "Side Effects", icon: "zap" },
  ],

  async run(f, ctx, input) {
    const { config, db } = ctx.tenant;
    const { message, diner, history, classification } = input;

    // ---- build_context: everything the LLM is ALLOWED to know (code, no LLM) ----
    const context = await f.node("build_context", async () => {
      const menuRows = await getMenu(db);
      // "today" in the RESTAURANT'S timezone — the server clock lives in UTC
      const today = todayISO(config.basic_info?.timezone || "Africa/Cairo");
      // hard-disabled items don't exist; 86'd-for-today ones are named honestly
      const menu = (menuRows || []).filter((m) => m.available && !(m.sold_out_until && String(m.sold_out_until).slice(0, 10) >= today));
      const soldOutNames = (menuRows || []).filter((m) => m.available && m.sold_out_until && String(m.sold_out_until).slice(0, 10) >= today).map((m) => m.name);
      // tonight's specials from config (staff post them in Settings; code filters expiry)
      const specials = (config.ai?.specials || [])
        .filter((s) => s?.text && (!s.until || s.until >= today))
        .map((s) => s.text);

      const { data: mf } = await db.from("message_full").select("conversation_summary").eq("phone_number", ctx.sessionId).maybeSingle();

      const { data: events } = await db
        .from("events")
        .select("title,description,date,start_time,price,status")
        .eq("status", "upcoming")
        .order("date")
        .limit(5);

      const { data: upcoming } = await db
        .from("reservations")
        .select("code,date,time_slot,party_size,status,occasion")
        .eq("diner_phone", ctx.sessionId)
        .gte("date", today)
        .in("status", ["confirmed", "reminded", "pending"])
        .limit(1);

      // dining RIGHT NOW = a reservation today marked arrived/seated (staff or ARRIVAL flow)
      const { data: atTable } = await db
        .from("reservations")
        .select("code,party_size,time_slot,occasion")
        .eq("diner_phone", ctx.sessionId)
        .eq("date", today)
        .in("status", ["arrived", "seated"])
        .limit(1);

      // relationship situation — pure code, from CRM facts
      const lastTouchMs = Math.max(
        diner?.last_seen_at ? new Date(diner.last_seen_at).getTime() : 0,
        diner?.last_visit_at ? new Date(diner.last_visit_at).getTime() : 0
      );
      const gapDays = lastTouchMs ? Math.round((Date.now() - lastTouchMs) / 86400000) : null;

      const prefs = diner?.preferences || {};
      const birthdayInDays = daysUntilMMDD(prefs.occasions?.birthday);

      // ORDER HISTORY → memory: the real "usual" comes from receipts, not just words
      let usualFromOrders = null;
      let lastOrder = null;
      const { data: pastOrders } = await db
        .from("orders")
        .select("items,order_type,created_at,status")
        .eq("phone_number", ctx.sessionId)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(15);
      if (pastOrders?.length) {
        const counts = {};
        for (const o of pastOrders) for (const it of o.items || []) counts[it.name] = (counts[it.name] || 0) + (Number(it.qty) || 1);
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] >= 2) usualFromOrders = { name: top[0], times: top[1] };
        const lo = pastOrders[0];
        lastOrder = {
          items: (lo.items || []).map((i) => `${i.qty}× ${i.name}`).join(", "),
          when: String(lo.created_at).slice(0, 10),
        };
      }

      // "returning" needs EVIDENCE of a relationship — visits, a real order, a
      // summary, or a confirmed name. last_seen_at alone proves nothing: the
      // message being answered right now already updated it, so a brand-new guest
      // read as "seen 0 days ago" and got greeted like a regular.
      const knownGuest = (diner?.visit_count || 0) > 0 || !!diner?.name || !!mf?.conversation_summary || !!(pastOrders?.length);
      const situation = atTable?.[0] ? "dining_now"
        : !knownGuest ? "first_timer"
        : gapDays !== null && gapDays > 45 ? "long_time_no_see"
        : "returning";

      const session = await getSession(db, ctx.sessionId);

      const h = hoursToday(config.hours, config.basic_info?.timezone);
      return {
        hoursNow: h,
        specials,
        sold_out: soldOutNames,
        hoursHuman: humanizeWeek(config.hours),
        todayHuman: (h.ranges || []).map((r) => `${fmt12(r.open)} – ${fmt12(r.close)}`).join(", ") || "closed today",
        isNewConversation: (history || []).length === 0,
        menu,
        events: events || [],
        upcomingReservation: upcoming?.[0] || null,
        diningNow: atTable?.[0] || null,
        situation,
        gapDays,
        prefs,
        birthdayInDays,
        usualFromOrders,
        lastOrder,
        greetName: diner?.name || diner?.wa_profile_name || null,
        greetNameSource: diner?.name ? "guest-confirmed" : diner?.wa_profile_name ? "WhatsApp profile (unconfirmed — may be a nickname/handle; use casually, skip if it looks like junk or a business name)" : null,
        handoffPending: !!session?.needs_attention,
        summary: mf?.conversation_summary || null,
        visitTier: !diner || diner.visit_count === 0 ? "first-timer"
          : diner.visit_count < 3 ? "returning"
          : diner.is_vip ? "VIP" : "regular",
      };
    }, { input: { sessionId: ctx.sessionId, diner: diner ? { name: diner.name, visits: diner.visit_count, vip: diner.is_vip, allergies: diner.allergies } : null } });

    function fmt12(hhmm) {
      const [h, m] = String(hhmm).split(":").map(Number);
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return m ? `${h12}:${String(m).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`;
    }
    function humanizeWeek(hours) {
      const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      return days
        .map((d) => `${d}: ${(hours?.[d] || []).map((r) => `${fmt12(r.open)} – ${fmt12(r.close)}`).join(", ") || "closed"}`)
        .join(" | ");
    }

    // ---- reply_llm ----
    const llmOut = await f.node("reply_llm", async () => {
      const bi = config.basic_info || {};
      const ai = config.ai || {};
      // MENU TIERING: the full menu block is the single biggest token spend, and
      // most turns (hours, location, chit-chat) never need it. A code check — the
      // guest's own words vs THIS restaurant's item/category names + a generic
      // food lexicon — decides per turn. The moment food comes up, the full block
      // is back. Nothing here is restaurant-specific: names come from their menu.
      const foodTalk = mentionsFood(message, history, context.menu);
      const menuText = foodTalk
        ? buildMenuText(context.menu, message, history, config.payments?.currency || "EGP")
        : `[menu not loaded this turn — the guest isn't discussing food] Categories we serve: ${[...new Set(context.menu.map((m) => m.category))].join(", ")} (${context.menu.length} items). If food, dishes or prices unexpectedly come up, NEVER invent or answer from memory — give a natural bridging line and the full menu will be in your next turn.`;

      const system = `You are ${ai.name || "the host"} — the greeter at the door of ${config.name}, and the waiter who knows every dish by heart. You're a real hospitality person on WhatsApp, not a support bot.
Personality: ${ai.personality || "warm and friendly"}.

VOICE & BEHAVIOR (this is what makes you feel human):
- Talk like a real Egyptian restaurant host texting: short, warm, alive. Casual rhythm, contractions, natural slang when the guest uses it.
- BANNED phrases: "How can I assist you today", "I'm here to help", "feel free to", "How can I make your day", "don't hesitate", robotic sign-offs. A waiter never talks like that.
- Greet like the door — but ONLY on the FIRST message of a conversation. GREETING & RELATIONSHIP below tells you whether this IS the first message, and exactly WHO you're greeting — match it.
- NEVER ask "first time with us?" if they already told you, or if GREETING & RELATIONSHIP says returning/long_time_no_see/dining_now.
- Sell like a waiter who loves the food: describe taste and texture ("the short rib falls off the bone — 12 hours slow"), suggest pairings, HAVE favorites when asked (pick from our real menu and say why). Opinions about our menu: encouraged. Facts: only from FACTS below.
- YOU ARE A RESTAURANT, NOT AN ASSISTANT: warm, human, easy — never generic service phrases ("how can I assist", "checking in"). If a sentence could come from a bank's chatbot, rewrite it.
- A GREETING IS HOSPITALITY, NEVER MARKETING: welcome them simply and ask how you can help ("Hello! Welcome to ${config.name} 🍔 What can we get you today?"). NEVER pitch, describe or recommend menu items in a greeting to someone who hasn't asked — no "the X is a beast", no product descriptions, no upsells. Referencing THE GUEST'S OWN favorite from MEMORY is warm and allowed; advertising is not. Selling starts only AFTER they ask about food.
- COMPLETE ANSWERS, FEWER QUESTIONS: when they ask what's in a category or for any list, give ALL of it (every item + price) — never a 2-item teaser. FORMAT any list of 3+ things (dishes, branches, options, hours) as bullets, one per line ("• Iconic Meal — 265 EGP"), never a comma run. Answer fully FIRST; at most ONE short question per reply, and only when it genuinely moves things forward. Never end every message with a question.
- When a group has constraints (vegan / no spice / allergy), recommend ONLY dishes that fit everyone — a good waiter never suggests something half the table can't eat.
- At most ONE natural follow-up question, the kind a host actually asks ("عيد ميلاد ولا خروجة عادية؟ 😄", "first time with us?").
- Match the guest's energy: hyped → hyped, chill → chill, formal Arabic (فصحى) → reply politely warm, NOT street slang. Sad or stressed guest → ONE short line of genuine empathy FIRST, in the GUEST'S language AND SCRIPT (English guest → "Sorry your day's been rough" · Franco guest → "Salamtak ya sa7by!" · عربي → "سلامتك، يومك يعدي"), THEN the comfort food. Never mix these up — the empathy line follows the guest's language exactly.
- If asked whether you're a bot/human: never lie — one charming line IN THE GUEST'S LANGUAGE AND SCRIPT (EN: "I'm the virtual host welcoming you here 24/7 😄 — with the whole team right behind me" · AR: "أنا اللي مستقبلك هنا ٢٤ ساعة 😄 والفريق كله ورايا") then move on.

HOUSE FACTS — the ONLY things you know (never invent anything beyond this).
Everything in this section is identical for every guest and every minute, so it
sits FIRST: an unchanging prefix is what lets the model cache it (cheaper AND
faster). Anything that changes per guest or per minute lives further down.
- Address: ${bi.address || "not set — say the team will share the address, never invent one"} (${bi.area || ""} ${bi.city || ""})
- Google Maps: ${bi.google_maps || "not set"}
- Phone: ${bi.contact?.phone || "not set"} | Instagram: ${bi.contact?.instagram || "not set"}
- Weekly hours: ${context.hoursHuman}
- Atmosphere/vibe: ${bi.vibe || "not set — never invent vibe descriptions"}
- Dress code: ${bi.dress_code || "none specified"} | Parking: ${bi.parking || "none specified"}
- Payment methods: ${(config.payments?.methods || []).join(", ") || "n/a"}
- Services: dine-in yes · delivery ${bi.services?.delivery === true ? "YES" : bi.services?.delivery === false ? "no" : "not set"} · pickup ${bi.services?.pickup === true ? "YES" : bi.services?.pickup === false ? "no" : "not set"}
- House policies: alcohol ${bi.policies?.alcohol ?? "not set"} · shisha ${bi.policies?.shisha ?? "not set"} · kids ${bi.policies?.kids ?? "not set"} · smoking ${bi.policies?.smoking ?? "not set"}
${config.basic_info?.restaurant_type === "casual" ? "" : `- Reservation policy: ${reservationPolicyLine(config.reservation_policy)}`}
${(ai.offers || []).length ? `- Current offers (ONLY these exist): ${JSON.stringify(ai.offers)}` : "- Offers/discounts: none configured — NEVER invent one; if asked, say you\'ll check with the team"}
- MENU (if an item is not listed, it is NOT on the menu):
${menuText || "(menu not loaded)"}
${context.events.length ? `- UPCOMING EVENTS: ${context.events.map((e) => `${e.title} on ${e.date}${e.start_time ? " at " + String(e.start_time).slice(0, 5) : ""}${e.price ? " (EGP " + e.price + ")" : ""}`).join("; ")}` : "- UPCOMING EVENTS: none announced"}
- FAQs: ${JSON.stringify(config.faqs || [])}

RIGHT NOW (live — overrides anything above):
- TODAY IS: ${context.hoursNow.weekday} ${context.hoursNow.dateISO}, local time ${context.hoursNow.localTime} — compute ALL relative dates ("tomorrow", "this weekend", "Friday") against this date.
- Right now: ${context.hoursNow.openNow ? "OPEN" : "CLOSED"} · today\'s hours: ${context.todayHuman}
${context.specials.length ? `- TONIGHT\'S SPECIALS (mention when relevant — never invent others): ${context.specials.join("; ")}\n` : ""}${context.sold_out?.length ? `- SOLD OUT TODAY (if asked about these, say honestly they ran out today and are back soon — they are on the menu above but NOT available now): ${context.sold_out.join(", ")}\n` : ""}${branchFacts(config, diner, message)}

GREETING & RELATIONSHIP (facts from our CRM — phrase them naturally, NEVER recite them):
- ${context.isNewConversation ? "This IS the first message of the conversation — greet them." : "This conversation already started — do NOT greet again, no welcome openers, just continue naturally."}
- Who this is: ${situationGuide(context, config)}
- Name to greet with: ${context.greetName ? `"${context.greetName}" (source: ${context.greetNameSource})` : "unknown — don't demand it; capture it naturally if they offer it"}
- Opening style: ${(config.ai?.greeting || "").trim() ? `the house opener "${config.ai.greeting.trim()}" is for FIRST-TIMERS ONLY (start their welcome with its spirit, then your own words). RETURNING guests are greeted like a human who knows them: by name, directly ("Welcome back, Adel! 👋…") — NEVER prepend the house opener or re-welcome them "to ${config.name}". Vary your wording between conversations; never sound copy-pasted.` : `no house greeting configured — open naturally in your personality and the guest's language; NEVER use brand words, slogans or greeting words that aren't in FACTS or your personality`}

GUEST CONTEXT (use silently — NEVER recite it back):
- Name: ${diner?.name || "unknown"} | Tier: ${context.visitTier}${diner?.is_vip ? " (VIP — extra warm)" : ""}
- Allergies: ${diner?.allergies?.length ? diner.allergies.join(", ").toUpperCase() + " — HARD RULE: NEVER recommend or suggest any item whose dietary_tags contain these allergens. When asked for recommendations, pick ONLY safe items and don't mention the allergy. Only if they explicitly ask for an unsafe item, warn them once." : "none known"}
- Their upcoming reservation: ${context.upcomingReservation ? `${context.upcomingReservation.code} on ${context.upcomingReservation.date} ${String(context.upcomingReservation.time_slot).slice(0, 5)} for ${context.upcomingReservation.party_size}` : "none"}
- Detected mood: ${classification?.mood || "neutral"}
${context.summary ? `- Earlier in this relationship (summary of older chats): ${context.summary}` : ""}
${memoryBlock(context, diner)}

${context.handoffPending ? "⚠️ HANDOFF PENDING: the team has ALREADY been notified about this guest. If they follow up, reassure them the team is on it and will reply here shortly — do NOT restart cheerful small talk or re-pitch the menu.\n" : ""}RULES:
0. ⚡ REPLY LANGUAGE — THE MOST IMPORTANT RULE. Your reply language = the language of the guest's LAST message (detected: ${classification?.language || "detect it yourself"}). English message → reply 100% in ENGLISH (a single local flavor word is allowed ONLY if it fits this restaurant's own personality). The Arabic/Franco snippets in these instructions are EXAMPLES for those languages only — never copy them into an English reply.
1. عربي → عربي مصري. Franco-Arabizi → reply FULLY in Franco, Latin letters ONLY (e.g. "lazem tegarrab el Mushroom Shawarma, ta3mo gamed"). NEVER answer Franco with Arabic script. ALWAYS keep menu item names in English. THE SCRIPT RULE: your reply's SCRIPT must match the guest's last message — Latin letters in → Latin letters out, Arabic script in → Arabic script out. This applies to EVERY line: greetings, EMPATHY lines, identity answers, everything. A sad Franco message gets Franco comfort, never Arabic script.
2. 1–3 short sentences. WhatsApp tone, warm, ${ai.personality ? "on-personality" : "friendly"}. Emojis welcome but max 2.
3. NEVER invent menu items, prices, events, or policies. Item not in the menu list = "not available tonight".
4. A FACT marked "not set" is UNKNOWN — not "none". Never turn a missing dress code / parking / policy into "there is no dress code"; say the team will confirm it. Same for anything not in FACTS: prep times, wait times, delivery zones — NEVER estimate numbers you don't have. Asked how long food takes? → "depends on the dish and the rush — the team can give you a live estimate", NEVER minutes.
5. ${config.basic_info?.restaurant_type === "casual"
  ? `WE DON'T TAKE RESERVATIONS — walk-in only 🍔. If they ask to book a table: tell them warmly to just come by anytime; if they're worried it's busy (or it IS busy), offer the WAITLIST (rule 14) — that's our version of booking. NEVER pretend a reservation was made.`
  : `If they want to BOOK A TABLE: our booking assistant handles it instantly — warmly invite them to send people/day/time (e.g. "4 people Friday 8pm") and it books on the spot. NEVER say "booked/reserved/حجزتلك" yourself and NEVER hand off to staff for a normal booking — the next message with details goes straight to the booking flow.`}
6. If angry, or asking for a human, or you cannot answer from FACTS: apologize briefly, say the team is taking over, set needs_handoff=true with a 1–2 line handoff_briefing.
7. If they mention their own name, set detected_name. If they mention a FOOD ALLERGY, set detected_allergies (array of lowercase FOOD allergens ONLY: nuts, dairy, gluten, shellfish, eggs, soy, sesame…). Health CONDITIONS (diabetes, pregnancy, blood pressure…) are NEVER stored anywhere — not as allergies, not as facts. For those: help with sensible suggestions AND you MUST end with the kitchen double-check line ("the kitchen will gladly double-check ingredients for you") — this line is mandatory for any health condition, it overrides the fewer-questions rule.
8. Off-topic requests: one playful redirect back to the restaurant.
9. If they ask for PHOTOS of food: ONLY items marked "📷 has photo" can be sent — set send_photos to up to 3 of those. If the dish they asked about has NO 📷 marker: say you don't have a photo of that one yet (NEVER "coming right up" / "sending now"), and optionally offer a photo of a similar 📷 dish instead.
10. If they asked a factual question about the restaurant you could NOT answer from FACTS (policy, service, amenity…), set suggested_faq = { "question": "<the generic question>", "context": "<what the guest actually said>" } so the owner can add the answer.
11. MEMORY CAPTURE — when the GUEST (never staff) volunteers something durable about themselves, record it:
   - a dish they LOVE (must be on our menu) → detected_preferences.favorite_items
   - a seating preference → detected_preferences.seating (one of: indoor, outdoor, terrace, quiet, window, bar)
   - their birthday or anniversary → detected_preferences.occasion = {"type":"birthday"|"anniversary","date":"MM-DD"} (compute MM-DD from TODAY IS if they say "next Friday")
   - other durable personal facts (kids, works nearby, hates cilantro) → detected_facts: short third-person snippets, max 8 words each.
   NEVER capture sensitive info (health conditions, religion, politics, private drama). ONLY the guest's OWN preferences — a friend's or family member's taste ("my friend Sara loves your pasta") is NEVER captured as this guest's favorite.
12. QUICK REPLIES: buttons are for real DECISION POINTS only (booking next step, menu, yes/no choices) — set quick_replies to 2-3 SHORT labels (1-3 words, max 20 chars, guest's language). NO buttons during: emotional moments, apologies, empathy, flowing chit-chat, or when your reply already ends the topic. Most replies should have NO buttons — think one in every few replies, not every reply.
13. If they ask to SEE THE MENU / "what do you have" / tap an order button: reply with a 1-line appetizing teaser and set send_menu_list=true — the menu PDF and its link are attached automatically. NEVER paste the menu as text and NEVER ask "what would you like?" without sending it. BUT a question about a CATEGORY ("what burgers do you have?", "عندكم برجر ايه") is NOT a menu request — NAME the items of that category in your reply (COMPLETE ANSWERS rule); never deflect to the PDF instead of answering.
14. WAITLIST: if the guest asks to join tonight's waitlist (or wants a table right now and accepts waiting) AND gave a party size, set add_to_waitlist = {"party_size": n, "name": <their name if known>}. When you set it you MAY tell them they're on the list (we really add them). Never invent wait times.
15. FEEDBACK: if they describe a PAST visit experience — praise or complaint — set detected_feedback = {"sentiment": "positive"|"negative", "text": "<their words, short>"}. For complaints: apologize once, genuinely; serious ones also get needs_handoff=true.
16. LOCATION PIN: if they ask where you are or for directions, answer briefly AND set send_location_pin=true (we drop a real map pin on WhatsApp).
17. REACTION: set react_emoji to ONE emoji (❤️ 🎉 😂 👏) ONLY for a strongly emotional guest moment (engagement, big news, a genuinely funny joke). This is rare — default null.
18. If "Right now" in FACTS says CLOSED and the guest wants to come NOW / walk in / join tonight's waitlist: lead with the fact that you're closed + today's hours, THEN help them plan. NEVER offer to "hold a table" — you can't hold tables.
19. ORDERS: ${config.basic_info?.restaurant_type === "casual"
      ? `we have a dedicated ordering flow that takes the whole order end-to-end. If they want to order, DO NOT collect items, DO NOT hand off to staff, DO NOT say "I'll pass this to the team" — just set send_menu_list=true and invite them to say what they'd like; the ordering flow picks it up from there.`
      : `(pickup / pre-order) we take them via chat — collect the items and pickup time, then set needs_handoff=true with reason "order request" and the FULL order in handoff_briefing; tell the guest the team will confirm when it's ready. NEVER claim an order is placed, charged or paid — no payments in chat. Delivery: only per FACTS policy.`}
20. STAFF ALERT (your host's notebook): when something happens the TEAM should know about, set staff_alert = {"type": "<2-4 words>", "note": "<one factual third-person line, max 120 chars>"}. Worth alerting: engagement/anniversary celebration coming · big group intent · an upset regular · VIP planning a visit · special request (cake, surprise, decoration) · guest asked for a manager. NOT worth alerting: routine questions, menu chat, normal bookings (those already notify). Sparing — most messages have staff_alert null.

Return JSON: { "reply": string, "needs_handoff": boolean, "handoff_reason": string|null, "handoff_briefing": string|null, "detected_name": string|null, "detected_allergies": string[]|null, "detected_preferences": {"favorite_items": string[]|null, "seating": string|null, "occasion": {"type": string, "date": string}|null}|null, "detected_facts": string[]|null, "send_photos": string[]|null, "quick_replies": string[]|null, "send_menu_list": boolean, "add_to_waitlist": {"party_size": number, "name": string|null}|null, "detected_feedback": {"sentiment": string, "text": string}|null, "send_location_pin": boolean, "react_emoji": string|null, "staff_alert": {"type": string, "note": string}|null, "suggested_faq": {"question": string, "context": string}|null }`;

      // VOICE MODE: "auto" (default) runs the fast model and escalates to the
      // premium one exactly where voice sells — bad mood, VIP, a pending handoff,
      // a brand-new guest's first impression, a long-time-no-see welcome.
      // "smart" (Settings → AI host → Voice quality) forces premium on every turn;
      // per-restaurant config, flippable from the dashboard without a deploy.
      const escalate =
        ["frustrated", "angry", "upset", "urgent"].includes(String(classification?.mood || "").toLowerCase()) ||
        !!diner?.is_vip ||
        context.handoffPending ||
        (context.isNewConversation && context.situation === "first_timer") ||
        context.situation === "long_time_no_see";
      const model = (config.ai?.voice_mode || "auto") === "smart" ? MODEL_SMART : escalate ? MODEL_SMART : MODEL_FAST;

      // 8 verbatim turns + the rolling summary (already in the prompt) carry the
      // conversation; 12 raw turns was paying for context the summary provides
      const convo = (history || []).slice(-8).map((h) => ({
        role: h.role === "guest" ? "user" : "assistant",
        // staff takeover replies enter history too — mark them so the AI knows what
        // the team already promised and never contradicts it
        content: h.role === "staff" ? `[Reply sent by a HUMAN staff member — treat as a promise already made to the guest]: ${h.message}` : h.message,
      }));
      convo.push({ role: "user", content: message });

      let r = await chatJSON(model, system, convo, { temperature: 0.6, maxTokens: 500 });
      // script guarantee (code, not prompt): Latin-script guest message must never get
      // an Arabic-script reply — up to two corrective re-asks (single-token slips happen)
      const arScript = /[؀-ۿ]/;
      for (let attempt = 0; attempt < 2 && !arScript.test(message) && arScript.test(r.value?.reply || ""); attempt++) {
        const r2 = await chatJSON(model, system, [
          ...convo,
          { role: "assistant", content: JSON.stringify(r.value) },
          { role: "user", content: "SYSTEM CHECK: the guest wrote in LATIN letters but your reply contains Arabic-script characters. Rewrite the ENTIRE reply (and any quick_replies) with the same meaning using ONLY Latin letters — English or Franco-Arabizi to match the guest. Not a single Arabic-script character is allowed. Return the same JSON shape." },
        ], { temperature: 0.4, maxTokens: 500 });
        r2.__usage = {
          model,
          tokens_in: r.__usage.tokens_in + r2.__usage.tokens_in,
          tokens_out: r.__usage.tokens_out + r2.__usage.tokens_out,
          cost_usd: r.__usage.cost_usd + r2.__usage.cost_usd,
        };
        r = r2;
      }
      // GREETING CONTRACT — the LLM authors every word, code only verifies the draft:
      // first reply of a conversation must greet by name (when known), welcome
      // first-timers to the restaurant BY NAME, and contain zero bot-isms/pitching.
      if (context.isNewConversation) {
        const draft = r.value?.reply || "";
        const BOTISM = /what'?s your vibe|checking in|hit me up|how can i assist|back for another round|just say the word|quick rec/i;
        const PITCH = /\b(is|are) (a|the) (beast|legend|must[- ]try)|you gotta try|don'?t miss|craving (that|our)/i;
        // name/restaurant enforcement ONLY when the guest actually just said hi —
        // a first-message QUESTION must keep its ANSWER, never become a greeting
        const BARE_GREETING = /^(hi+|hey+|hello+|yo+|hala|ahlan|ezayak|ezayek|ezay|salam|هاي|اهلا|أهلا|اهلين|هلا|السلام عليكم|ازيك|ازيكم|مرحبا|صباح الخير|مساء الخير|good (morning|evening|afternoon))[\s!.😊👋🙌❤️🔥]*$/i;
        const bareGreeting = message.trim().length <= 25 && BARE_GREETING.test(message.trim());
        const firstName = (context.greetName || "").split(" ")[0];
        const missName = bareGreeting && firstName && context.situation !== "first_timer" && !draft.toLowerCase().includes(firstName.toLowerCase());
        const missRest = bareGreeting && context.situation === "first_timer" && !draft.toLowerCase().includes(String(config.name || "").split(" ")[0].toLowerCase());
        const broken = (d) =>
          BOTISM.test(d) || PITCH.test(d) ||
          (bareGreeting && firstName && context.situation !== "first_timer" && !d.toLowerCase().includes(firstName.toLowerCase())) ||
          (bareGreeting && context.situation === "first_timer" && !d.toLowerCase().includes(String(config.name || "").split(" ")[0].toLowerCase()));
        if (broken(draft)) {
          const wants = bareGreeting
            ? [
                firstName && context.situation !== "first_timer" ? `greet them by name ("${firstName}")` : null,
                context.situation === "first_timer" ? `welcome them TO ${config.name} (say the restaurant name)` : null,
                "warm and simple like a real host",
                "NO dish pitching, NO assistant phrases",
              ].filter(Boolean).join("; ")
            : "KEEP ALL the substance and the actual answer of your reply exactly — only remove the bot-ish/marketing phrasing";
          const r2 = await chatJSON(model, system, [
            ...convo,
            { role: "assistant", content: JSON.stringify(r.value) },
            { role: "user", content: `SYSTEM CHECK: this is the FIRST reply of a conversation and it broke the greeting contract. Rewrite in your own natural words: ${wants}. Same JSON shape.` },
          ], { temperature: 0.5, maxTokens: 500 });
          r2.__usage = {
            model,
            tokens_in: r.__usage.tokens_in + r2.__usage.tokens_in,
            tokens_out: r.__usage.tokens_out + r2.__usage.tokens_out,
            cost_usd: r.__usage.cost_usd + r2.__usage.cost_usd,
          };
          r = r2;
          // still broken after the rewrite? keep the model's own words but guarantee
          // the welcome/name by prefixing — a guest must never be greeted anonymously
          if (bareGreeting && broken(r.value?.reply || "")) {
            const prefix = context.situation === "first_timer"
              ? (config.ai?.greeting || `Welcome to ${config.name}!`).trim()
              : `Welcome back${firstName ? `, ${firstName}` : ""}!`;
            r.value = { ...(r.value || {}), reply: `${prefix} ${(r.value?.reply || "").replace(/^(hey|hi|hello)[!,. ]*/i, "")}`.trim() };
          }
        }
      }
      return r;
    }, { input: { message, history_turns: (history || []).length, mood: classification?.mood, bucket: classification?.requested_bucket } });

    const out = llmOut.value || {};
    let reply = (out.reply || "One second! 🙌").slice(0, 3500);

    // ---- side_effects ----
    await f.node("side_effects", async () => {
      const effects = [];
      if (out.detected_name && diner?.id && !diner.name) {
        await db.from("diners").update({ name: out.detected_name }).eq("id", diner.id);
        effects.push(`name→${out.detected_name}`);
      }
      if (out.detected_allergies?.length && diner?.id) {
        // food allergens only — health conditions never land in the allergy field
        const clean = out.detected_allergies
          .map((a) => String(a).toLowerCase().trim())
          .filter((a) => a && !HEALTH_CONDITIONS.test(a));
        if (clean.length) {
          const merged = [...new Set([...(diner.allergies || []), ...clean])];
          await db.from("diners").update({ allergies: merged }).eq("id", diner.id);
          effects.push(`allergies→${merged.join(",")}`);
        }
      }
      // memory + AI notes share one preferences write so they never clobber each other
      let prefsPatch = null;
      if (diner?.id && (out.detected_preferences || out.detected_facts?.length)) {
        prefsPatch = mergePreferences(diner.preferences, out.detected_preferences, out.detected_facts, context.menu);
        if (prefsPatch) effects.push("memory-updated");
      }
      if (out.staff_alert?.note) {
        const note = String(out.staff_alert.note).trim().slice(0, 140);
        const type = String(out.staff_alert.type || "note").trim().slice(0, 40);
        if (note && diner?.id) {
          const base = prefsPatch || diner.preferences || {};
          const stamp = new Date().toISOString().slice(0, 10);
          prefsPatch = { ...base, ai_notes: [...(base.ai_notes || []), `[${stamp}] ${note}`].slice(-5) };
        }
        if (note) {
          await notifyDashboard(db, "ai_note", `🤖 ${type}`,
            `${diner?.name || diner?.wa_profile_name || ctx.sessionId}: ${note}`, ctx.sessionId);
          effects.push(`ai-note: ${type}`);
        }
      }
      if (prefsPatch && diner?.id) {
        await db.from("diners").update({ preferences: prefsPatch }).eq("id", diner.id);
      }
      const party = Number(out.add_to_waitlist?.party_size);
      if (party > 0 && party <= 50) {
        await db.from("waitlist").insert({
          phone_number: ctx.sessionId,
          name: out.add_to_waitlist.name || diner?.name || diner?.wa_profile_name || null,
          party_size: Math.round(party),
        });
        await notifyDashboard(db, "waitlist", `Waitlist: party of ${Math.round(party)}`,
          `${out.add_to_waitlist.name || diner?.name || ctx.sessionId} added via chat`, ctx.sessionId);
        effects.push("waitlist-added");
      }
      if (out.detected_feedback?.text && ["positive", "negative"].includes(out.detected_feedback.sentiment)) {
        await db.from("feedback").insert({
          phone_number: ctx.sessionId,
          comments: String(out.detected_feedback.text).slice(0, 800),
          sentiment: out.detected_feedback.sentiment,
          escalated: out.detected_feedback.sentiment === "negative",
        });
        if (out.detected_feedback.sentiment === "negative") {
          await notifyDashboard(db, "feedback", "Negative feedback from a guest",
            `${diner?.name || ctx.sessionId}: ${String(out.detected_feedback.text).slice(0, 140)}`, ctx.sessionId);
        }
        effects.push(`feedback-${out.detected_feedback.sentiment}`);
      }
      if (out.suggested_faq?.question) {
        // don't re-suggest a question that's already pending
        const { data: dupe } = await db.from("suggested_faqs").select("id").eq("status", "pending").ilike("question", out.suggested_faq.question).limit(1);
        if (!dupe?.length) {
          await db.from("suggested_faqs").insert({
            question: out.suggested_faq.question,
            context: out.suggested_faq.context || null,
            session_id: ctx.sessionId,
          }).then(() => {});
          effects.push(`faq-suggested: ${out.suggested_faq.question.slice(0, 60)}`);
        }
      }
      // rolling summary: long conversations get compressed so context stays sharp + cheap
      if ((history || []).length >= 14 && Date.now() - (lastSummaryAt.get(ctx.sessionId) || 0) > SUMMARY_COOLDOWN_MS) {
        lastSummaryAt.set(ctx.sessionId, Date.now());
        if (lastSummaryAt.size > 2000) lastSummaryAt.clear();
        const older = history.slice(0, -6).map((h) => `${h.role}: ${h.message}`).join("\n").slice(0, 4000);
        const sum = await chatJSON(MODEL_FAST /* flex lane */,
          'Summarize this restaurant WhatsApp conversation in 2-3 sentences capturing: guest preferences, unresolved topics, promises made. JSON: {"summary": "..."}',
          older, { maxTokens: 120, flex: true }).catch(() => null);
        if (sum?.value?.summary) {
          await db.from("message_full").update({ conversation_summary: sum.value.summary }).eq("phone_number", ctx.sessionId);
          effects.push("summary-refreshed");
        }
      }
      if (out.needs_handoff) {
        await setSessionFlags(db, ctx.sessionId, {
          needs_attention: true,
          handoff_reason: out.handoff_reason || "agent handoff",
          handoff_briefing: out.handoff_briefing || null,
        });
        await notifyDashboard(
          db,
          "handoff",
          `Human needed: ${out.handoff_reason || "guest request"}`,
          out.handoff_briefing || `${diner?.name || ctx.sessionId}: ${message.slice(0, 120)}`,
          ctx.sessionId
        );
        effects.push("handoff");
      }
      return { effects: effects.length ? effects : ["none"] };
    }, { input: { needs_handoff: !!out.needs_handoff, handoff_reason: out.handoff_reason, detected_name: out.detected_name } });

    const photos = [];
    for (const want of out.send_photos || []) {
      const m = findMenuPhoto(context.menu, want);
      if (m && !photos.some((p) => p.url === m.photo_url)) {
        photos.push({ url: m.photo_url, caption: `${m.name} — ${m.price} ${config.payments?.currency || "EGP"}` });
      }
      if (photos.length === 3) break;
    }

    let quickReplies = (out.quick_replies || []).map(trimLabel).filter(Boolean).slice(0, 3);

    // The FIRST buttons of a conversation are the ways IN, not a reorder prompt.
    // Three buttons is all WhatsApp allows, and spending one of them on "same as last
    // time" (plus another on a specific item) left no room to say the menu or the
    // builder even exist. The usual is offered in WORDS instead — the model is told
    // about it below — and a reorder chip comes back once they say they're ordering.
    if (context.isNewConversation && config.basic_info?.restaurant_type === "casual") {
      const entry = [label(config, "browse_menu"), label(config, "order_now")];
      if (builderConfig(config).enabled) entry.push(label(config, "build_your_own"));
      quickReplies = entry.slice(0, 3);
    }
    // menu display mode is per-restaurant: PDF document + link (default) | full text | tappable list
    const mc = config.menu_config || {};
    const currency = config.payments?.currency || "EGP";
    let menuList = null;
    let menuDoc = null;
    if (out.send_menu_list) {
      if (mc.display === "text") {
        reply = `${reply}\n\n${fullMenuText(context.menu, currency)}`.slice(0, 3900);
      } else if (mc.display === "list") {
        menuList = buildMenuList(context.menu, mc.build_your_own);
      } else {
        // default: a real PDF they can open, zoom and scroll — uploaded one wins,
        // otherwise we generate it from the live menu and cache it
        const pdf = mc.pdf_url
          ? { url: mc.pdf_url, filename: "menu.pdf" }
          : await menuPdfUrl(db, {
              restaurant: config.name,
              menu: context.menu,
              currency,
              accent: config.basic_info?.brand?.primary || "#111111",
              tagline: config.basic_info?.tagline || "",
              phone: config.basic_info?.phone || "",
              website: config.basic_info?.website || "",
            });
        if (pdf) {
          menuDoc = { url: pdf.url, caption: `${config.name} — full menu 📄`, filename: pdf.filename };
          reply = `${reply}\n\n📄 Full menu: ${publicLink("/menu.pdf", config.slug)}\nJust tell me what you'd like and I'll take it from there.`.slice(0, 3900);
        } else {
          // menu exists but the PDF couldn't be made — never leave the guest empty-handed
          reply = `${reply}\n\n${fullMenuText(context.menu, currency)}`.slice(0, 3900);
        }
      }
    }
    const loc = config.basic_info?.location;
    const locationPin = out.send_location_pin && loc?.lat && loc?.lng
      ? { lat: loc.lat, lng: loc.lng, name: config.name, address: config.basic_info?.address || "", maps: config.basic_info?.google_maps || "" }
      : null;
    const reactEmoji = typeof out.react_emoji === "string" && out.react_emoji.trim() ? out.react_emoji.trim().slice(0, 8) : null;

    return { reply, handoff: !!out.needs_handoff, photos, quickReplies, menuList, menuDoc, locationPin, reactEmoji };
  },
});

// full menu as ONE readable message (menu_config.display = "text")
function fullMenuText(menu, currency) {
  const cats = [...new Set(menu.map((m) => m.category).filter(Boolean))];
  return cats.map((c) => {
    const items = menu.filter((m) => m.category === c)
      .map((m) => `• ${m.name} — ${m.price} ${currency}${m.bestseller ? " ⭐" : ""}`);
    return `🍽 ${c}\n${items.join("\n")}`;
  }).join("\n\n");
}

// WhatsApp list message: one tappable row per category (10-row API cap).
// Tapping a row sends the category name back as a normal message — the bot answers it.
function buildMenuList(menu, byo = null) {
  const cats = [...new Set(menu.map((m) => m.category).filter(Boolean))].slice(0, byo?.enabled ? 9 : 10);
  if (!cats.length) return null;
  const list = {
    button: "View menu 🍽",
    sections: [{
      title: "Our menu",
      rows: cats.map((c) => {
        const inCat = menu.filter((m) => m.category === c);
        // appetizing preview instead of a dead count — bestsellers first
        const names = [...inCat].sort((a, b) => (b.bestseller ? 1 : 0) - (a.bestseller ? 1 : 0)).map((m) => m.name);
        let preview = "";
        for (const n of names) {
          if ((preview + n).length > 62) { preview += "…"; break; }
          preview += (preview ? " · " : "") + n;
        }
        return {
          id: `cat_${String(c).replace(/[^\w]/g, "").slice(0, 20)}`,
          title: String(c).slice(0, 24),
          description: preview.slice(0, 72),
        };
      }),
    }],
  };
  if (byo?.enabled) {
    list.sections[0].rows.unshift({
      id: "byo",
      title: String(byo.title || "Build your own").slice(0, 24),
      description: String(byo.subtitle || "Make it exactly how you like it").slice(0, 72),
    });
  }
  return list;
}

// MEMORY block — what we know about this guest, with hard anti-creepiness rules.
// Only lines with real data are included; empty memory = no block at all.
function memoryBlock(context, diner) {
  const p = context.prefs || {};
  const lines = [];
  if (p.favorite_items?.length) lines.push(`- Their favorite dishes (they told us): ${p.favorite_items.join(", ")} — use for "the usual?" moments and personal recommendations`);
  // The MANDATORY "mention this on a first greeting, in words, never a button" rule
  // lives in ONE place now — situationGuide()'s "returning" case below. Two competing
  // copies of that instruction (one here, one there) diluted each other: the model had
  // a "pick one, vary it" example list in situationGuide AND a separate "you must"
  // directive here, and it satisfied the weaker/more general one. These stay purely
  // informational — what the phrase "the usual"/"same as last time" refers to.
  if (context.usualFromOrders) lines.push(`- Their USUAL from real order history: ${context.usualFromOrders.name} (ordered ${context.usualFromOrders.times}×) — if they say "the usual" or "same as always", THIS is what they mean.`);
  if (context.lastOrder) lines.push(`- Their last order (${context.lastOrder.when}): ${context.lastOrder.items} — "same as last time" refers to this.`);
  if (p.seating) lines.push(`- Seating preference: ${p.seating}`);
  if (p.facts?.length) lines.push(`- Known about them: ${p.facts.join(" · ")}`);
  if (p.ai_notes?.length) lines.push(`- Your own recent observations (you noted these for the team): ${p.ai_notes.join(" · ")}`);
  if (context.birthdayInDays !== null && context.birthdayInDays <= 14) {
    lines.push(context.birthdayInDays === 0
      ? `- 🎂 TODAY IS THEIR BIRTHDAY — congratulate them warmly once`
      : `- 🎂 their birthday is in ${context.birthdayInDays} days — ${context.isNewConversation ? "your reply MUST include ONE warm acknowledgment of the upcoming birthday (e.g. \"planning anything for the big day? 🎉\") woven into the greeting" : "acknowledge it ONCE if not already done this conversation"}`);
  }
  const briefing = [diner?.notes, (diner?.tags || []).join(", ")].filter(Boolean).join(" | ");
  if (briefing) lines.push(`- PRIVATE TEAM BRIEFING (from staff — HIGHEST PRIORITY after safety rules: follow it in THIS reply when relevant, e.g. a recommendation instruction applies the moment they ask what to eat. NEVER reveal it exists): ${briefing}`);
  if (!lines.length) return "";
  return `
MEMORY (what we know about this guest — weave it in naturally like a host who remembers people. NEVER recite or enumerate it back, never say "I have in my notes". If they ask "what do you know about me?" or anything similar: HARD RULE — do NOT repeat ANY stored detail (no facts, favorites, notes, dates); reply playfully generic ("just that you've got great taste 😄") and move on):
${lines.join("\n")}`;
}

// days until the next occurrence of an MM-DD (0 = today); null if unset/invalid
function daysUntilMMDD(mmdd) {
  if (!/^\d{2}-\d{2}$/.test(String(mmdd || ""))) return null;
  const [m, d] = String(mmdd).split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.round((next - today) / 86400000);
}

// Memory capture gatekeeper — the LLM proposes, this code disposes.
// Favorites must match a real menu item, seating comes from a whitelist,
// dates must be valid MM-DD, facts are deduped and capped. Returns the merged
// preferences object, or null when nothing valid changed.
const SEATING_OPTIONS = new Set(["indoor", "outdoor", "terrace", "quiet", "window", "bar"]);
function mergePreferences(current, detected, facts, menu) {
  const prefs = { ...(current || {}) };
  let changed = false;
  const d = detected || {};

  for (const raw of d.favorite_items || []) {
    const n = normName(raw);
    if (!n) continue;
    const item = menu.find((x) => normName(x.name) === n) ||
                 menu.find((x) => normName(x.name).includes(n) || n.includes(normName(x.name)));
    if (!item) continue;
    const list = prefs.favorite_items || [];
    if (!list.includes(item.name) && list.length < 5) {
      prefs.favorite_items = [...list, item.name];
      changed = true;
    }
  }

  const seating = String(d.seating || "").toLowerCase();
  if (SEATING_OPTIONS.has(seating) && prefs.seating !== seating) {
    prefs.seating = seating;
    changed = true;
  }

  const occType = String(d.occasion?.type || "").toLowerCase();
  if (["birthday", "anniversary"].includes(occType) && daysUntilMMDD(d.occasion?.date) !== null) {
    if (prefs.occasions?.[occType] !== d.occasion.date) {
      prefs.occasions = { ...(prefs.occasions || {}), [occType]: d.occasion.date };
      changed = true;
    }
  }

  for (const f of facts || []) {
    const fact = String(f).trim().slice(0, 60);
    if (!fact) continue;
    const key = normName(fact) || fact;
    const list = prefs.facts || [];
    if (list.some((x) => (normName(x) || x) === key)) continue;
    prefs.facts = [...list, fact].slice(-10);
    changed = true;
  }

  return changed ? prefs : null;
}

// branches as facts — the guest's chosen branch leads, the rest are listed honestly
function branchFacts(config, diner, message) {
  const branches = branchList(config);
  if (!branches.length) return "";
  const mine = branches.find((b) => b.key === diner?.preferred_branch);
  const list = branches.map((b) => `${b.name}${b.address ? ` (${b.address})` : ""}${b.hours ? ` — ${b.hours}` : ""}`).join(" | ");
  // NEAREST BRANCH — computed in code from a shared pin, or matched from the area they named
  const loc = freshLocation(diner);
  const near = loc ? nearestBranches(branches, loc.lat, loc.lng, 3) : null;
  const byArea = !near ? matchBranchByText(branches, message) : null;
  const nearestLine = near?.length
    ? `- NEAREST BRANCHES to the location they shared (exact distances, use them): ${near.map((b) => `${b.name} ${b.km} km`).join(" · ")}. Lead with the closest.\n`
    : byArea
    ? `- They mentioned an area matching our ${byArea.name} branch${byArea.address ? ` (${byArea.address})` : ""} — suggest it as the nearest, and offer to switch if they meant another.\n`
    : `- No location from this guest yet. If they ask which branch is closest, ask them to SHARE THEIR LOCATION (WhatsApp 📎 → Location) or just name their area — then you can answer exactly. NEVER guess distances.\n`;
  return `- BRANCHES (${branches.length}): ${list}
${nearestLine}${mine ? `- THIS guest's branch: ${mine.name}${mine.address ? ` — ${mine.address}` : ""}. When they ask "where are you" / hours, answer for THEIR branch first; mention others only if they ask or want to switch.\n` : `- This guest hasn't picked a branch yet — if they ask where we are, give the branch NAMES; ask which branch they mean before branch-specific details.\n`}`;
}

// deposits/max-party as facts — without this line the model invents deposit policy
function reservationPolicyLine(rp = {}) {
  const dep = rp.deposits || {};
  const deposits = dep.enabled === true
    ? `deposits required: EGP ${dep.per_person ?? "?"} per person for parties of ${dep.applies_from_party ?? "?"}+`
    : dep.enabled === false
    ? "no deposits currently"
    : "deposits: not set — the team will confirm";
  const maxParty = rp.max_party_online ? `parties up to ${rp.max_party_online} book normally, bigger groups go through the team` : "max party size: not set — team will confirm";
  return `${maxParty} · ${deposits}`;
}

// per-situation hosting stance — facts computed in code, the LLM only phrases them
function situationGuide(context, config) {
  switch (context.situation) {
    case "dining_now":
      return `a guest sitting AT THEIR TABLE in the restaurant RIGHT NOW (reservation ${context.diningNow?.code || ""}). Do NOT pitch the menu or ask what they're in the mood for — ask how the meal is going / help immediately. Physical requests (waiter, bill, wrong order, complaint) = set needs_handoff=true with urgency, the team is meters away.`;
    case "long_time_no_see":
      return `a guest we haven't seen in ~${context.gapDays} days — ONE warm "we missed you / long time" line (never guilt-trip), then if UPCOMING EVENTS or offers exist, mention what's new since. Food-forward, like a host at the door.`;
    case "returning": {
      const usual = context.usualFromOrders?.name || context.prefs?.favorite_items?.[0] || null;
      const last = context.lastOrder?.items || null;
      // A "pick one of these, vary it" list let the model reliably pick the weakest,
      // most generic option — it satisfied "pick one" without ever mentioning the
      // usual/last order the founder specifically wants surfaced. Only one is offered
      // as a MUST now; the generic phrasing is reachable only when neither signal exists.
      const mandatory = usual
        ? `You MUST mention their usual — ${usual}${context.usualFromOrders ? ` (ordered ${context.usualFromOrders.times}×)` : ""} — in your own words, in this exact reply (e.g. "the usual ${usual}?" or "same ${usual} as always?"). This is the single highest-converting thing you can say to them — never fall back to a generic "what can we get you today?" when this signal exists.`
        : last
        ? `You MUST mention their last order — ${last} — in your own words, in this exact reply (e.g. "same as last time — ${last}?" or "want ${last} again?"). Never fall back to a generic "what can we get you today?" when this signal exists.`
        : `Pick a natural, warm opener — no purchase signal exists for them yet, so keep it simple: "Welcome back${context.greetName ? `, ${context.greetName}` : ""}! Ordering today, or just checking the menu?"`;
      return `a returning guest — greet them as ${config.name}'s host: warm, by name, and IMMEDIATELY useful. ${mandatory}
  Always make it about helping them (order / usual / menu), never vague chat. BAD: "back for another round?", "just checking in?", "what's your vibe?", "hit me up".`;
    }
    default:
      return `a first-time contact — a simple genuine welcome TO ${config.name} and ONE helpful question, e.g. "Hello! Welcome to ${config.name} 🍔 What can we get you today?" or "…Would you like to see the menu or order straight away?". No menu pitching, no product talk. Don't overwhelm.`;
  }
}

const HEALTH_CONDITIONS = /diabet|pregnan|hypertens|blood pressure|cholesterol|سكري|حامل|ضغط/i;

// WhatsApp caps button titles at 20 chars — cut at a word boundary, not mid-word
function trimLabel(s) {
  s = String(s).trim();
  if (s.length <= 20) return s;
  const cut = s.slice(0, 20);
  const sp = cut.lastIndexOf(" ");
  return (sp > 8 ? cut.slice(0, sp) : cut).trim();
}

// tolerant of emoji, casing, punctuation and plurals in LLM-returned dish names
function normName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findMenuPhoto(menu, name) {
  const n = normName(name);
  if (!n) return null;
  const withPhotos = menu.filter((m) => m.photo_url);
  return (
    withPhotos.find((m) => normName(m.name) === n) ||
    withPhotos.find((m) => normName(m.name) === n.replace(/s$/, "")) ||
    withPhotos.find((m) => normName(m.name).includes(n) || n.includes(normName(m.name))) ||
    null
  );
}

// Small menus go in full. Past MENU_FULL_LIMIT items, only the categories the guest is
// actually talking about keep descriptions; the rest compress to name+price+dietary tags
// (tags stay — the allergy hard rule needs them) so prompt size stays flat on big menus.
const MENU_FULL_LIMIT = 12;
// An item with several priced formats has no single price — quoting the cheapest
// as "the" price undersells the meal and misleads the guest. Show the formats.
function priceOf(m, currency) {
  const g = (m.options || []).find((x) => (x.choices || []).some((c) => c.price != null));
  if (!g) return `${m.price} ${currency}`;
  const parts = g.choices.filter((c) => c.price != null).map((c) => `${c.name} ${c.price}`);
  return `${parts.join(" / ")} ${currency}`;
}

// Is this turn about food? Generic lexicon (EN/AR/Franco) + THIS restaurant's
// own item and category tokens — nothing brand-specific hardcoded.
const GENERIC_FOOD = /\b(menu|eat|eating|food|hungry|order|meal|dish|drink|dessert|burger|sandwich|wrap|fries|wings|veg(an|etarian)?|gluten|spicy|price|cost|how much|recommend|suggest|best.?seller|popular|3ayez akol|gau3an|menue?)\b/i;
// Arabic glues prefixes onto the word (البرجرات = ال+برجر+ات) and JS \b never
// matches beside Arabic script — so Arabic food talk is detected by substring.
const GENERIC_FOOD_AR = ["بكام", "سعر", "منيو", "اكل", "آكل", "جعان", "طلب", "وجبة", "مشروب", "حلو", "اقتراح", "تنصح", "برجر", "برغر", "بورجر", "ساندوتش", "ساندويتش", "سندوتش", "بطاطس", "فرايز", "وينجز"];
function mentionsFood(message, history, menu) {
  const recentGuest = (history || []).slice(-4).filter((h) => h.role === "guest").map((h) => h.message).slice(-2);
  const probe = ` ${[message, ...recentGuest].join(" ").toLowerCase()} `;
  if (GENERIC_FOOD.test(probe)) return true;
  if (GENERIC_FOOD_AR.some((w) => probe.includes(w))) return true;
  for (const m of menu) {
    const cat = String(m.category || "").toLowerCase();
    if (cat && probe.includes(cat)) return true;
    const tok = String(m.name || "").toLowerCase().split(/\s+/)[0];
    if (tok.length >= 4 && probe.includes(tok)) return true;
  }
  return false;
}

function buildMenuText(menu, message, history, currency) {
  const line = (m, full) => {
    const tags = m.dietary_tags?.length ? ", " + m.dietary_tags.join("/") : "";
    const photo = m.photo_url ? ", 📷 has photo" : "";
    const star = m.bestseller ? " ⭐bestseller" : "";
    const spice = m.spice_level ? ` 🌶${m.spice_level}/3` : "";
    const extra = full
      ? `${m.ingredients ? ` [ingredients: ${m.ingredients}]` : ""}${m.pairs_with ? ` [pairs well with: ${m.pairs_with}]` : ""}`
      : "";
    return full
      ? `${m.name} (${m.category}, ${priceOf(m, currency)}${tags}${photo})${star}${spice}${m.description ? " — " + m.description : ""}${extra}`
      : `${m.name} (${priceOf(m, currency)}${tags}${photo})${star}${spice}`;
  };
  if (menu.length <= MENU_FULL_LIMIT) return menu.map((m) => line(m, true)).join("\n");

  const recent = normName(
    [message, ...(history || []).slice(-6).filter((h) => h.role === "guest").map((h) => h.message)].join(" ")
  );
  const hotCategories = new Set();
  for (const m of menu) {
    const cat = normName(m.category || "");
    if ((cat && recent.includes(cat)) || (normName(m.name) && recent.includes(normName(m.name)))) {
      hotCategories.add(m.category);
    }
  }
  const out = [];
  const compressed = new Map();
  for (const m of menu) {
    if (hotCategories.has(m.category)) out.push(line(m, true));
    else {
      if (!compressed.has(m.category)) compressed.set(m.category, []);
      compressed.get(m.category).push(line(m, false));
    }
  }
  for (const [cat, items] of compressed) out.push(`${cat}: ${items.join(" · ")}`);
  return out.join("\n");
}
