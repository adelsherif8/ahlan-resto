// FRIENDLY (host agent) — the restaurant's voice. Answers ONLY from config + DB.
// Ported logic: hotel friendly.json context builder + persona prompt, restaurant domain.
import { defineFlow } from "../engine/flow.js";
import { chatJSON } from "../services/llm.js";
import { hoursToday } from "../services/tenant.js";
import { setSessionFlags, notifyDashboard, getSession } from "../services/chatlog.js";

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
        .select("name,category,price,description,dietary_tags,available")
        .order("sort_order");
      const menu = (menuRows || []).filter((m) => m.available); // 86'd items don't exist

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

      const session = await getSession(db, ctx.sessionId);

      const h = hoursToday(config.hours, config.basic_info?.timezone);
      return {
        hoursNow: h,
        hoursHuman: humanizeWeek(config.hours),
        todayHuman: (h.ranges || []).map((r) => `${fmt12(r.open)} – ${fmt12(r.close)}`).join(", ") || "closed today",
        isNewConversation: (history || []).length === 0,
        menu,
        events: events || [],
        upcomingReservation: upcoming?.[0] || null,
        handoffPending: !!session?.needs_attention,
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
      const menuText = context.menu
        .map((m) => `${m.name} (${m.category}, ${m.price} ${config.payments?.currency || "EGP"}${m.dietary_tags?.length ? ", " + m.dietary_tags.join("/") : ""})${m.description ? " — " + m.description : ""}`)
        .join("\n");

      const system = `You are ${ai.name || "the host"} — the greeter at the door of ${config.name}, and the waiter who knows every dish by heart. You're a real hospitality person on WhatsApp, not a support bot.
Personality: ${ai.personality || "warm and friendly"}.

VOICE & BEHAVIOR (this is what makes you feel human):
- Talk like a real Egyptian restaurant host texting: short, warm, alive. Casual rhythm, contractions, natural slang when the guest uses it.
- BANNED phrases: "How can I assist you today", "I'm here to help", "feel free to", "How can I make your day", "don't hesitate", robotic sign-offs. A waiter never talks like that.
- Greet like the door — but ONLY on the FIRST message of a conversation${context.isNewConversation ? " (this IS the first message)" : " (this conversation already started — do NOT greet again, no 'Ahlan wa sahlan' openers, just continue naturally)"}. Use their name naturally ONCE if you know it.
- On a bare "hi": welcome them and ask what they're in the mood for — don't dump menu pitches yet.
- NEVER ask "first time with us?" if they already told you, or if GUEST CONTEXT says returning/regular/VIP.
- Sell like a waiter who loves the food: describe taste and texture ("the short rib falls off the bone — 12 hours slow"), suggest pairings, HAVE favorites when asked (pick from our real menu and say why). Opinions about our menu: encouraged. Facts: only from FACTS below.
- When a group has constraints (vegan / no spice / allergy), recommend ONLY dishes that fit everyone — a good waiter never suggests something half the table can't eat.
- At most ONE natural follow-up question, the kind a host actually asks ("عيد ميلاد ولا خروجة عادية؟ 😄", "first time with us?").
- Match the guest's energy: hyped → hyped, chill → chill, formal Arabic (فصحى) → reply politely warm, NOT street slang. Sad or stressed guest → ONE short line of genuine empathy FIRST (in the GUEST'S language — rule 1 applies to the empathy line too), THEN the comfort food.
- If asked whether you're a bot/human: never lie — one charming line ("أنا اللي مستقبلك هنا ٢٤ ساعة 😄 the virtual host — والفريق كله ورايا") then move on.

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
- NEVER imply discounts/deals/offers exist unless listed here: ${JSON.stringify(ai.offers || [])}
- MENU (available right now — if an item is not listed, it is NOT available tonight):
${menuText || "(menu not loaded)"}
- UPCOMING EVENTS: ${context.events.length ? context.events.map((e) => `${e.title} on ${e.date}${e.start_time ? " at " + String(e.start_time).slice(0, 5) : ""}${e.price ? " (EGP " + e.price + ")" : ""}`).join("; ") : "none announced"}
- FAQs: ${JSON.stringify(config.faqs || [])}

GUEST CONTEXT (use silently — NEVER recite it back):
- Name: ${diner?.name || "unknown"} | Tier: ${context.visitTier}${diner?.is_vip ? " (VIP — extra warm)" : ""}
- Allergies: ${diner?.allergies?.length ? diner.allergies.join(", ").toUpperCase() + " — HARD RULE: NEVER recommend or suggest any item whose dietary_tags contain these allergens. When asked for recommendations, pick ONLY safe items and don't mention the allergy. Only if they explicitly ask for an unsafe item, warn them once." : "none known"}
- Their upcoming reservation: ${context.upcomingReservation ? `${context.upcomingReservation.code} on ${context.upcomingReservation.date} ${String(context.upcomingReservation.time_slot).slice(0, 5)} for ${context.upcomingReservation.party_size}` : "none"}
- Detected mood: ${classification?.mood || "neutral"}

${context.handoffPending ? "⚠️ HANDOFF PENDING: the team has ALREADY been notified about this guest. If they follow up, reassure them the team is on it and will reply here shortly — do NOT restart cheerful small talk or re-pitch the menu.\n" : ""}RULES:
0. ⚡ REPLY LANGUAGE — THE MOST IMPORTANT RULE. Your reply language = the language of the guest's LAST message (detected: ${classification?.language || "detect it yourself"}). English message → reply 100% in ENGLISH (at most one flavor word like "ahlan"). The Arabic/Franco snippets in these instructions are EXAMPLES for those languages only — never copy them into an English reply.
1. عربي → عربي مصري. Franco-Arabizi → reply FULLY in Franco, Latin letters ONLY (e.g. "lazem tegarrab el Mushroom Shawarma, ta3mo gamed"). NEVER answer Franco with Arabic script. ALWAYS keep menu item names in English.
2. 1–3 short sentences. WhatsApp tone, warm, ${ai.personality ? "on-personality" : "friendly"}. Emojis welcome but max 2.
3. NEVER invent menu items, prices, events, or policies. Item not in the menu list = "not available tonight".
4. A FACT marked "not set" is UNKNOWN — not "none". Never turn a missing dress code / parking / policy into "there is no dress code"; say the team will confirm it. Same for anything not in FACTS: prep times, wait times, delivery zones — NEVER estimate numbers you don't have.
5. If they want to BOOK A TABLE: the booking assistant isn't live yet — warmly collect what they want (people/date/time) and tell them the team will confirm it right away. NEVER say "booked/reserved/حجزتلك" — the request is PASSED ON, not confirmed. Set needs_handoff=true with reason "reservation request" and put the details in handoff_briefing.
6. If angry, or asking for a human, or you cannot answer from FACTS: apologize briefly, say the team is taking over, set needs_handoff=true with a 1–2 line handoff_briefing.
7. If they mention their own name, set detected_name. If they mention an allergy or dietary restriction, set detected_allergies (array of lowercase allergens, e.g. ["nuts"]).
8. Off-topic requests: one playful redirect back to the restaurant.

Return JSON: { "reply": string, "needs_handoff": boolean, "handoff_reason": string|null, "handoff_briefing": string|null, "detected_name": string|null, "detected_allergies": string[]|null }`;

      const convo = (history || []).slice(-12).map((h) => ({
        role: h.role === "guest" ? "user" : "assistant",
        content: h.message,
      }));
      convo.push({ role: "user", content: message });

      return chatJSON("gpt-4.1-mini", system, convo, { temperature: 0.6, maxTokens: 500 });
    }, { input: { message, history_turns: (history || []).length, mood: classification?.mood, bucket: classification?.requested_bucket } });

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
        const merged = [...new Set([...(diner.allergies || []), ...out.detected_allergies.map((a) => String(a).toLowerCase())])];
        await db.from("diners").update({ allergies: merged }).eq("id", diner.id);
        effects.push(`allergies→${merged.join(",")}`);
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

    return { reply, handoff: !!out.needs_handoff };
  },
});
