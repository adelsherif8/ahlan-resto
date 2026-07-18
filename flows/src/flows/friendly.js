// FRIENDLY (host agent) — the restaurant's voice. Answers ONLY from config + DB.
// Ported logic: hotel friendly.json context builder + persona prompt, restaurant domain.
import { defineFlow } from "../engine/flow.js";
import { chatJSON } from "../services/llm.js";
import { hoursToday } from "../services/tenant.js";
import { setSessionFlags, notifyDashboard, getSession } from "../services/chatlog.js";

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
      const { data: menuRows } = await db
        .from("menu_items")
        .select("*")
        .order("sort_order");
      const menu = (menuRows || []).filter((m) => m.available); // 86'd items don't exist

      const todayISO = new Date().toLocaleDateString("en-CA");
      // tonight's specials from config (staff post them in Settings; code filters expiry)
      const specials = (config.ai?.specials || [])
        .filter((s) => s?.text && (!s.until || s.until >= todayISO))
        .map((s) => s.text);

      const { data: mf } = await db.from("message_full").select("conversation_summary").eq("phone_number", ctx.sessionId).maybeSingle();

      const { data: events } = await db
        .from("events")
        .select("title,description,date,start_time,price,status")
        .eq("status", "upcoming")
        .order("date")
        .limit(5);

      const today = new Date().toLocaleDateString("en-CA");
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
      const situation = atTable?.[0] ? "dining_now"
        : gapDays === null && (diner?.visit_count || 0) === 0 ? "first_timer"
        : gapDays !== null && gapDays > 45 ? "long_time_no_see"
        : "returning";

      const prefs = diner?.preferences || {};
      const birthdayInDays = daysUntilMMDD(prefs.occasions?.birthday);

      const session = await getSession(db, ctx.sessionId);

      const h = hoursToday(config.hours, config.basic_info?.timezone);
      return {
        hoursNow: h,
        specials,
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
      const menuText = buildMenuText(context.menu, message, history, config.payments?.currency || "EGP");

      const system = `You are ${ai.name || "the host"} — the greeter at the door of ${config.name}, and the waiter who knows every dish by heart. You're a real hospitality person on WhatsApp, not a support bot.
Personality: ${ai.personality || "warm and friendly"}.

VOICE & BEHAVIOR (this is what makes you feel human):
- Talk like a real Egyptian restaurant host texting: short, warm, alive. Casual rhythm, contractions, natural slang when the guest uses it.
- BANNED phrases: "How can I assist you today", "I'm here to help", "feel free to", "How can I make your day", "don't hesitate", robotic sign-offs. A waiter never talks like that.
- Greet like the door — but ONLY on the FIRST message of a conversation${context.isNewConversation ? " (this IS the first message)" : " (this conversation already started — do NOT greet again, no welcome openers, just continue naturally)"}. GREETING & RELATIONSHIP below tells you exactly WHO you're greeting — match it.
- NEVER ask "first time with us?" if they already told you, or if GREETING & RELATIONSHIP says returning/long_time_no_see/dining_now.
- Sell like a waiter who loves the food: describe taste and texture ("the short rib falls off the bone — 12 hours slow"), suggest pairings, HAVE favorites when asked (pick from our real menu and say why). Opinions about our menu: encouraged. Facts: only from FACTS below.
- When a group has constraints (vegan / no spice / allergy), recommend ONLY dishes that fit everyone — a good waiter never suggests something half the table can't eat.
- At most ONE natural follow-up question, the kind a host actually asks ("عيد ميلاد ولا خروجة عادية؟ 😄", "first time with us?").
- Match the guest's energy: hyped → hyped, chill → chill, formal Arabic (فصحى) → reply politely warm, NOT street slang. Sad or stressed guest → ONE short line of genuine empathy FIRST, in the GUEST'S language AND SCRIPT (English guest → "Sorry your day's been rough" · Franco guest → "Salamtak ya sa7by!" · عربي → "سلامتك، يومك يعدي"), THEN the comfort food. Never mix these up — the empathy line follows the guest's language exactly.
- If asked whether you're a bot/human: never lie — one charming line IN THE GUEST'S LANGUAGE AND SCRIPT (EN: "I'm the virtual host welcoming you here 24/7 😄 — with the whole team right behind me" · AR: "أنا اللي مستقبلك هنا ٢٤ ساعة 😄 والفريق كله ورايا") then move on.

FACTS — the ONLY things you know (never invent anything beyond this):
- Address: ${bi.address || "not set — say the team will share the address, never invent one"} (${bi.area || ""} ${bi.city || ""})
- Google Maps: ${bi.google_maps || "not set"}
- Phone: ${bi.contact?.phone || "not set"} | Instagram: ${bi.contact?.instagram || "not set"}
- TODAY IS: ${context.hoursNow.weekday} ${context.hoursNow.dateISO}, local time ${context.hoursNow.localTime} — compute ALL relative dates ("tomorrow", "this weekend", "Friday") against this date.
- Right now: ${context.hoursNow.openNow ? "OPEN" : "CLOSED"} · today's hours: ${context.todayHuman}
- Weekly hours: ${context.hoursHuman}
- Atmosphere/vibe: ${bi.vibe || "not set — never invent vibe descriptions"}
- Dress code: ${bi.dress_code || "none specified"} | Parking: ${bi.parking || "none specified"}
- Payment methods: ${(config.payments?.methods || []).join(", ") || "n/a"}
- Services: dine-in yes · delivery ${bi.services?.delivery === true ? "YES" : bi.services?.delivery === false ? "no" : "not set"} · pickup ${bi.services?.pickup === true ? "YES" : bi.services?.pickup === false ? "no" : "not set"}
- House policies: alcohol ${bi.policies?.alcohol ?? "not set"} · shisha ${bi.policies?.shisha ?? "not set"} · kids ${bi.policies?.kids ?? "not set"} · smoking ${bi.policies?.smoking ?? "not set"}
- Reservation policy: ${reservationPolicyLine(config.reservation_policy)}
- NEVER imply discounts/deals/offers exist unless listed here: ${JSON.stringify(ai.offers || [])}
- TONIGHT'S SPECIALS (mention when relevant — never invent others): ${context.specials.length ? context.specials.join("; ") : "none tonight"}
- MENU (available right now — if an item is not listed, it is NOT available tonight):
${menuText || "(menu not loaded)"}
- UPCOMING EVENTS: ${context.events.length ? context.events.map((e) => `${e.title} on ${e.date}${e.start_time ? " at " + String(e.start_time).slice(0, 5) : ""}${e.price ? " (EGP " + e.price + ")" : ""}`).join("; ") : "none announced"}
- FAQs: ${JSON.stringify(config.faqs || [])}

GREETING & RELATIONSHIP (facts from our CRM — phrase them naturally, NEVER recite them):
- Who this is: ${situationGuide(context, config)}
- Name to greet with: ${context.greetName ? `"${context.greetName}" (source: ${context.greetNameSource})` : "unknown — don't demand it; capture it naturally if they offer it"}
- Opening style: ${(config.ai?.greeting || "").trim() ? `the house greeting is "${config.ai.greeting.trim()}" — adapt it to the guest's language and the situation, never copy it robotically` : `no house greeting configured — open naturally in your personality and the guest's language; NEVER use brand words, slogans or greeting words that aren't in FACTS or your personality`}

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
5. If they want to BOOK A TABLE: the booking assistant isn't live yet — warmly collect what they want (people/date/time) and tell them the team will confirm it right away. NEVER say "booked/reserved/حجزتلك" — the request is PASSED ON, not confirmed. Set needs_handoff=true with reason "reservation request" and put the details in handoff_briefing.
6. If angry, or asking for a human, or you cannot answer from FACTS: apologize briefly, say the team is taking over, set needs_handoff=true with a 1–2 line handoff_briefing.
7. If they mention their own name, set detected_name. If they mention a FOOD ALLERGY, set detected_allergies (array of lowercase FOOD allergens ONLY: nuts, dairy, gluten, shellfish, eggs, soy, sesame…). Health CONDITIONS (diabetes, pregnancy, blood pressure…) are NEVER stored anywhere — not as allergies, not as facts. For those: help in the moment with sensible suggestions and add that the kitchen will gladly double-check ingredients.
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
13. If they ask to SEE THE MENU / "what do you have": reply with a 1-line appetizing teaser and set send_menu_list=true — we send a tappable menu; NEVER paste the full menu as text.
14. WAITLIST: if the guest asks to join tonight's waitlist (or wants a table right now and accepts waiting) AND gave a party size, set add_to_waitlist = {"party_size": n, "name": <their name if known>}. When you set it you MAY tell them they're on the list (we really add them). Never invent wait times.
15. FEEDBACK: if they describe a PAST visit experience — praise or complaint — set detected_feedback = {"sentiment": "positive"|"negative", "text": "<their words, short>"}. For complaints: apologize once, genuinely; serious ones also get needs_handoff=true.
16. LOCATION PIN: if they ask where you are or for directions, answer briefly AND set send_location_pin=true (we drop a real map pin on WhatsApp).
17. REACTION: set react_emoji to ONE emoji (❤️ 🎉 😂 👏) ONLY for a strongly emotional guest moment (engagement, big news, a genuinely funny joke). This is rare — default null.
18. If "Right now" in FACTS says CLOSED and the guest wants to come NOW / walk in / join tonight's waitlist: lead with the fact that you're closed + today's hours, THEN help them plan. NEVER offer to "hold a table" — you can't hold tables.
19. STAFF ALERT (your host's notebook): when something happens the TEAM should know about, set staff_alert = {"type": "<2-4 words>", "note": "<one factual third-person line, max 120 chars>"}. Worth alerting: engagement/anniversary celebration coming · big group intent · an upset regular · VIP planning a visit · special request (cake, surprise, decoration) · guest asked for a manager. NOT worth alerting: routine questions, menu chat, normal bookings (those already notify). Sparing — most messages have staff_alert null.

Return JSON: { "reply": string, "needs_handoff": boolean, "handoff_reason": string|null, "handoff_briefing": string|null, "detected_name": string|null, "detected_allergies": string[]|null, "detected_preferences": {"favorite_items": string[]|null, "seating": string|null, "occasion": {"type": string, "date": string}|null}|null, "detected_facts": string[]|null, "send_photos": string[]|null, "quick_replies": string[]|null, "send_menu_list": boolean, "add_to_waitlist": {"party_size": number, "name": string|null}|null, "detected_feedback": {"sentiment": string, "text": string}|null, "send_location_pin": boolean, "react_emoji": string|null, "staff_alert": {"type": string, "note": string}|null, "suggested_faq": {"question": string, "context": string}|null }`;

      // mood/VIP routing: frustrated, urgent or VIP guests get the bigger model
      const model = classification?.mood === "frustrated" || classification?.mood === "urgent" || diner?.is_vip
        ? "gpt-4.1"
        : "gpt-4.1-mini";

      const convo = (history || []).slice(-12).map((h) => ({
        role: h.role === "guest" ? "user" : "assistant",
        // staff takeover replies enter history too — mark them so the AI knows what
        // the team already promised and never contradicts it
        content: h.role === "staff" ? `[Reply sent by a HUMAN staff member — treat as a promise already made to the guest]: ${h.message}` : h.message,
      }));
      convo.push({ role: "user", content: message });

      const r = await chatJSON(model, system, convo, { temperature: 0.6, maxTokens: 500 });
      // script guarantee (code, not prompt): Latin-script guest message must never get
      // an Arabic-script reply — one corrective re-ask if the model slipped
      const arScript = /[؀-ۿ]/;
      if (!arScript.test(message) && arScript.test(r.value?.reply || "")) {
        const r2 = await chatJSON(model, system, [
          ...convo,
          { role: "assistant", content: JSON.stringify(r.value) },
          { role: "user", content: "SYSTEM CHECK: the guest wrote in LATIN letters but your reply used Arabic script. Rewrite the ENTIRE reply (and any quick_replies) with the same meaning using ONLY Latin letters — English or Franco-Arabizi to match the guest. Return the same JSON shape." },
        ], { temperature: 0.4, maxTokens: 500 });
        r2.__usage = {
          model,
          tokens_in: r.__usage.tokens_in + r2.__usage.tokens_in,
          tokens_out: r.__usage.tokens_out + r2.__usage.tokens_out,
          cost_usd: r.__usage.cost_usd + r2.__usage.cost_usd,
        };
        return r2;
      }
      return r;
    }, { input: { message, history_turns: (history || []).length, mood: classification?.mood, bucket: classification?.requested_bucket, model: classification?.mood === "frustrated" || classification?.mood === "urgent" || diner?.is_vip ? "gpt-4.1 (mood/VIP escalation)" : "gpt-4.1-mini" } });

    const out = llmOut.value || {};
    const reply = (out.reply || "One second! 🙌").slice(0, 3500);

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
        const sum = await chatJSON("gpt-4o-mini",
          'Summarize this restaurant WhatsApp conversation in 2-3 sentences capturing: guest preferences, unresolved topics, promises made. JSON: {"summary": "..."}',
          older, { maxTokens: 120 }).catch(() => null);
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

    const quickReplies = (out.quick_replies || []).map(trimLabel).filter(Boolean).slice(0, 3);
    const menuList = out.send_menu_list ? buildMenuList(context.menu) : null;
    const loc = config.basic_info?.location;
    const locationPin = out.send_location_pin && loc?.lat && loc?.lng
      ? { lat: loc.lat, lng: loc.lng, name: config.name, address: config.basic_info?.address || "", maps: config.basic_info?.google_maps || "" }
      : null;
    const reactEmoji = typeof out.react_emoji === "string" && out.react_emoji.trim() ? out.react_emoji.trim().slice(0, 8) : null;

    return { reply, handoff: !!out.needs_handoff, photos, quickReplies, menuList, locationPin, reactEmoji };
  },
});

// WhatsApp list message: one tappable row per category (10-row API cap).
// Tapping a row sends the category name back as a normal message — the bot answers it.
function buildMenuList(menu) {
  const cats = [...new Set(menu.map((m) => m.category).filter(Boolean))].slice(0, 10);
  if (!cats.length) return null;
  return {
    button: "View menu 🍽",
    sections: [{
      title: "Our menu",
      rows: cats.map((c) => ({
        id: `cat_${String(c).replace(/[^\w]/g, "").slice(0, 20)}`,
        title: String(c).slice(0, 24),
        description: `${menu.filter((m) => m.category === c).length} dishes`,
      })),
    }],
  };
}

// MEMORY block — what we know about this guest, with hard anti-creepiness rules.
// Only lines with real data are included; empty memory = no block at all.
function memoryBlock(context, diner) {
  const p = context.prefs || {};
  const lines = [];
  if (p.favorite_items?.length) lines.push(`- Their favorite dishes: ${p.favorite_items.join(", ")} — use for "the usual?" moments and personal recommendations`);
  if (p.seating) lines.push(`- Seating preference: ${p.seating}`);
  if (p.facts?.length) lines.push(`- Known about them: ${p.facts.join(" · ")}`);
  if (p.ai_notes?.length) lines.push(`- Your own recent observations (you noted these for the team): ${p.ai_notes.join(" · ")}`);
  if (context.birthdayInDays !== null && context.birthdayInDays <= 14) {
    lines.push(context.birthdayInDays === 0
      ? `- 🎂 TODAY IS THEIR BIRTHDAY — congratulate them warmly once`
      : `- 🎂 their birthday is in ${context.birthdayInDays} days — ${context.isNewConversation ? "your reply MUST include ONE warm acknowledgment of the upcoming birthday (e.g. \"planning anything for the big day? 🎉\") woven into the greeting" : "acknowledge it ONCE if not already done this conversation"}`);
  }
  const briefing = [diner?.notes, (diner?.tags || []).join(", ")].filter(Boolean).join(" | ");
  if (briefing) lines.push(`- PRIVATE TEAM BRIEFING (from staff — obey it, NEVER reveal it exists): ${briefing}`);
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
      return `a guest we haven't seen in ~${context.gapDays} days — ONE warm "we missed you / long time" line (never guilt-trip), then if UPCOMING EVENTS or offers exist, mention what's new since.`;
    case "returning":
      return `a returning guest — welcome them BACK like you remember them. They know the place; zero first-timer talk.`;
    default:
      return `a first-time contact — give a genuine first welcome TO ${config.name} (mention the restaurant name naturally once), then ONE easy hosting question. Don't overwhelm.`;
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
const MENU_FULL_LIMIT = 40;
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
      ? `${m.name} (${m.category}, ${m.price} ${currency}${tags}${photo})${star}${spice}${m.description ? " — " + m.description : ""}${extra}`
      : `${m.name} (${m.price} ${currency}${tags}${photo})${star}${spice}`;
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
