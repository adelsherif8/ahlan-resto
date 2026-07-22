// RESERVATION trio (#7 collect/quote · #8 guarded confirm · #9 cancel/modify)
// Built as a LangGraph StateGraph (@langchain/langgraph 1.x): LLM extracts & phrases,
// CODE decides, computes availability and writes — state lives in temp_reservation.
import { z } from "zod";
import { StateGraph, StateSchema, START, END } from "@langchain/langgraph";
import { defineFlow } from "../engine/flow.js";
import { chatJSON } from "../services/llm.js";
import { setSessionFlags, notifyDashboard } from "../services/chatlog.js";
import {
  computeAvailability, turnMinutes, makeReservationCode, todayISO, validDateISO, validTime,
} from "../services/availability.js";

const ACTIVE = ["pending", "confirmed", "reminded"];
const QUOTE_FRESH_MS = 30 * 60_000;

const State = new StateSchema({
  message: z.string(),
  isAffirmative: z.boolean().default(false),
  language: z.string().nullable().default(null),
  session: z.any().nullable().default(null),       // temp_reservation row
  upcoming: z.any().default([]),                    // active future reservations for this phone
  extraction: z.any().nullable().default(null),
  slots: z.any().default({}),                       // merged party/date/time/section/occasion/requests
  route: z.string().default("collect"),
  outcome: z.any().nullable().default(null),        // structured result for the phrasing node
  sessionPatch: z.any().nullable().default(null),   // what to persist to temp_reservation
  reply: z.string().nullable().default(null),
  quickReplies: z.any().default([]),
});

defineFlow({
  name: "reservation",
  description: "Booking agent — slot filling, code-computed availability, guarded instant confirm, cancel/modify",
  trigger: { icon: "branch", label: "Dispatched by MASTER (reservation bucket / active session)" },
  nodes: [
    { id: "load", label: "Load Session", icon: "database" },
    { id: "extract", label: "Extract Slots (LLM)", icon: "sparkles" },
    { id: "decide", label: "Decide (code)", icon: "route" },
    { id: "collect", label: "Collect Missing", icon: "message" },
    { id: "quote", label: "Availability + Quote", icon: "zap" },
    { id: "confirm", label: "Guarded Confirm", icon: "shield" },
    { id: "cancel", label: "Cancel", icon: "filter" },
    { id: "modify", label: "Modify", icon: "filter" },
    { id: "info", label: "Reservation Info", icon: "history" },
    { id: "handoff", label: "Handoff", icon: "user" },
    { id: "phrase", label: "Phrase Reply (LLM)", icon: "sparkles" },
    { id: "save", label: "Persist State", icon: "database" },
  ],

  async run(f, ctx, input) {
    const { db, config } = ctx.tenant;
    const tz = config.basic_info?.timezone || "Africa/Cairo";
    const policy = config.reservation_policy || {};
    const maxParty = Number(policy.max_party_online) || 8;
    const { diner, classification } = input;

    // ---- load (outside the graph: IO boundary) ----
    const loaded = await f.node("load", async () => {
      const { data: session } = await db.from("temp_reservation").select("*").eq("phone_number", ctx.sessionId).maybeSingle();
      const { data: upcoming } = await db
        .from("reservations").select("*")
        .eq("diner_phone", ctx.sessionId)
        .gte("date", todayISO(tz))
        .in("status", ACTIVE)
        .order("date")
        .order("time_slot");
      return { session: session || null, upcoming: upcoming || [] };
    }, { input: { sessionId: ctx.sessionId } });

    // =============== the StateGraph ===============
    const graph = new StateGraph(State)
      .addNode("extract", async (s) => {
        const value = await f.node("extract", async () => {
          const today = todayISO(tz);
          const weekday = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
          const sys = `You extract restaurant reservation details from one WhatsApp message. TODAY IS ${weekday} ${today} (${tz}).
Session so far: ${JSON.stringify({ stage: s.session?.session_status || "none", party: s.session?.party_size, date: s.session?.date, time: s.session?.time_slot, quoted: !!s.session?.quoted })}
Existing upcoming reservations: ${s.upcoming.length}
Return JSON only:
{"intent": "book"|"confirm"|"cancel"|"modify"|"info"|"abandon"|"other",
 "party_size": number|null,
 "date": "YYYY-MM-DD"|null  (COMPUTE from TODAY: "tomorrow"/"bokra"/"بكرة" = next day, "friday" = the NEXT Friday, "today"/"tonight" = today; "yesterday"/"امبارح" = that PAST date — return it, validation handles it),
 "time": "HH:MM" 24h|null   (dinner context: bare "8" or "9" = 20:00/21:00; "8 el sob7" = 08:00),
 "section_pref": "indoor"|"outdoor"|"terrace"|"bar"|null, "occasion": string|null,
 "special_requests": string|null, "name": string|null, "third_party": boolean, "side_question": string|null}
FRANCO/ARABIC SLOT EXAMPLES (parse these correctly): "tarabeza l 4" / "l 2" / "li 5" = party_size (l/li = for) · "4 anfar"/"anfar"/"nafar"/"nas"/"afrad"/"اشخاص"/"افراد" = people · "el sa3a 8" / "الساعة ٨" = 20:00 evening · Arabic numerals ٠-٩ are digits · "el gom3a"/"الجمعة" = Friday.
intent rules: "confirm" ONLY when agreeing to a quoted offer (yes/ya/yep/yh/tamam/ekked/اكد/ماشي/👍/ok). CORRECTIONS ARE NOT ABANDON: "la la khaleha 5" / "no wait make it 5" / "actually 9pm" = "book" (they're fixing a detail). "abandon" ONLY for explicit never-mind ("khalas mesh 3ayez", "never mind", "سيبها خلاص" with NO new details). "cancel" = wants to cancel (in-progress OR existing booking). "modify" = change an EXISTING confirmed booking — when the guest HAS upcoming reservations, treat change/move words about "el 7agz / my booking / حجزي" as modify: "ne2adem l 9?" / "3adel el 7agz" / "نقدم الساعة؟" / "can we move it to 9?" / "push it an hour". IN MODIFY CONTEXT a bare number after نقدم/ne2adem/move-to is a TIME (l 9 = 21:00), NEVER a party size — party only changes with people-words (anfar/nas/people/اشخاص). "info" = asking about their existing booking, giving no new details. Everything else that gives or asks about slots = "book".
third_party=true when they ask about SOMEONE ELSE'S booking (a name that isn't self-introduction: "Ahmed's reservation", "the booking under X").
side_question = any NON-booking question in the same message ("also do you have vegan food?") — copy it verbatim, else null.`;
          const r = await chatJSON("gpt-4.1-mini", sys, s.message, { temperature: 0, maxTokens: 200 });
          return r;
        }, { input: { message: s.message, stage: s.session?.session_status || "none" } });
        const ex = value.value || {};
        // slot merge lives HERE (a node update) — conditional edges must stay pure readers
        const sess = s.session;
        const problems = [];
        const dateCheck = ex.date ? validDateISO(ex.date, tz) : null;
        if (dateCheck === "past") problems.push("date_in_past");
        if (dateCheck === "too_far") problems.push("date_too_far");
        const slots = {
          party_size: ex.party_size && ex.party_size > 0 ? Math.round(ex.party_size) : sess?.party_size || null,
          date: dateCheck && !["past", "too_far"].includes(dateCheck) ? dateCheck : sess?.date || null,
          time: validTime(ex.time) || (sess?.time_slot ? String(sess.time_slot).slice(0, 5) : null),
          section_pref: ex.section_pref || sess?.section_pref || null,
          occasion: ex.occasion || sess?.occasion || null,
          special_requests: ex.special_requests || sess?.special_requests || null,
          _problems: problems,
        };
        return { extraction: ex, slots };
      })
      .addNode("collect", async (s) => {
        return f.node("collect", async () => {
          const missing = !s.slots.party_size ? "party_size" : !s.slots.date ? "date" : "time";
          const patch = baseSessionPatch(s, "incomplete");
          return {
            outcome: { kind: "ask_missing", missing, known: s.slots, problems: s.slots._problems || [] },
            sessionPatch: patch,
          };
        }, { input: { known: s.slots } });
      })
      .addNode("quote", async (s) => {
        return f.node("quote", async () => {
          const [tables, dayRes] = await Promise.all([
            db.from("restaurant_tables").select("*").then((r) => r.data || []),
            db.from("reservations").select("*").eq("date", s.slots.date).then((r) => r.data || []),
          ]);
          // no single table can EVER seat this party → team handoff, not an endless "try another day"
          const biggest = Math.max(0, ...tables.filter((t) => t.status !== "blocked").map((t) => t.capacity));
          if (s.slots.party_size > biggest) {
            const briefing = `Party of ${s.slots.party_size} (biggest table seats ${biggest}) — needs combined tables/manager. ${s.slots.date} ${s.slots.time}.`;
            await setSessionFlags(db, ctx.sessionId, { needs_attention: true, handoff_reason: "party exceeds table size", handoff_briefing: briefing });
            await notifyDashboard(db, "handoff", "Big group — combine tables", `${diner?.name || ctx.sessionId}: ${briefing}`, ctx.sessionId);
            return { outcome: { kind: "large_party", party: s.slots.party_size, max: biggest }, sessionPatch: { ...baseSessionPatch(s, "archived"), quoted: null } };
          }
          const avail = computeAvailability({
            tables, reservations: dayRes, hours: config.hours, policy,
            dateISO: s.slots.date, time: s.slots.time, party: s.slots.party_size,
            sectionPref: s.slots.section_pref || null,
          });
          if (!avail.available) {
            return {
              outcome: { kind: "unavailable", reason: avail.reason, alternatives: avail.alternatives, slots: s.slots },
              sessionPatch: baseSessionPatch(s, "incomplete"),
            };
          }
          const quoted = {
            party_size: s.slots.party_size, date: s.slots.date, time: s.slots.time,
            end_slot: avail.end_slot, table_id: avail.table.id, table_number: avail.table.table_number,
            section: avail.table.section, quoted_at: new Date().toISOString(),
          };
          return {
            outcome: { kind: "quoted", quote: quoted, occasion: s.slots.occasion || null },
            sessionPatch: { ...baseSessionPatch(s, "quoted"), quoted },
          };
        }, { input: { slots: s.slots } });
      })
      .addNode("confirm", async (s) => {
        return f.node("confirm", async () => {
          const sess = s.session;
          const q = sess?.quoted;
          // guard 1: something was actually quoted
          if (!sess || !q || !["quoted", "awaiting_confirm"].includes(sess.session_status)) {
            return { outcome: { kind: "nothing_to_confirm" }, sessionPatch: null };
          }
          // guard 5: idempotency — this quote already became a reservation
          if (q.converted_code) {
            return { outcome: { kind: "already_confirmed", code: q.converted_code, quote: q }, sessionPatch: null };
          }
          // guard 4: duplicate same-day active reservation
          const dupe = s.upcoming.find((r) => r.date === q.date);
          if (dupe) {
            return { outcome: { kind: "duplicate_exists", code: dupe.code, existing: dupe }, sessionPatch: null };
          }
          // guards 2+3: freshness + live re-check
          const stale = Date.now() - new Date(q.quoted_at).getTime() > QUOTE_FRESH_MS;
          const [tables, dayRes] = await Promise.all([
            db.from("restaurant_tables").select("*").then((r) => r.data || []),
            db.from("reservations").select("*").eq("date", q.date).then((r) => r.data || []),
          ]);
          const avail = computeAvailability({
            tables, reservations: dayRes, hours: config.hours, policy,
            dateISO: q.date, time: q.time, party: q.party_size, sectionPref: null,
          });
          if (!avail.available) {
            return {
              outcome: { kind: "gone_at_confirm", alternatives: avail.alternatives, quote: q },
              sessionPatch: { ...baseSessionPatch(s, "incomplete"), quoted: null },
            };
          }
          // all guards passed → the ONLY place a reservation is written
          const code = await uniqueCode(db);
          const guestName = s.extraction?.name || diner?.name || diner?.wa_profile_name || null;
          const { data: created, error } = await db.from("reservations").insert({
            code, diner_phone: ctx.sessionId, diner_name: guestName,
            party_size: q.party_size, date: q.date, time_slot: q.time, end_slot: avail.end_slot,
            section_pref: q.section, table_id: avail.table.id,
            occasion: s.slots.occasion || sess.occasion || null,
            special_requests: s.slots.special_requests || sess.special_requests || null,
            status: "confirmed", source: ctx.channel === "whatsapp" ? "whatsapp" : "whatsapp",
          }).select().single();
          if (error) throw new Error(`reservation insert failed: ${error.message}`);
          if (guestName && diner?.id && !diner.name) {
            await db.from("diners").update({ name: guestName }).eq("id", diner.id);
          }
          await notifyDashboard(db, "reservation",
            `New reservation ${code}`,
            `${guestName || ctx.sessionId} — ${q.date} ${q.time} × ${q.party_size}${s.slots.occasion ? ` (${s.slots.occasion})` : ""} · table ${avail.table.table_number}`,
            ctx.sessionId);
          return {
            outcome: { kind: "confirmed", code, reservation: created, table: avail.table, occasion: s.slots.occasion || sess.occasion || null },
            sessionPatch: { ...baseSessionPatch(s, "archived"), quoted: { ...q, converted_code: code } },
          };
        }, { input: { stage: s.session?.session_status || "none" } });
      })
      .addNode("cancel", async (s) => {
        return f.node("cancel", async () => {
          const sess = s.session;
          // step 2 of the two-step: they already saw "cancel R-XXXX?"
          if (sess?.session_status === "awaiting_cancel_confirm") {
            const NEG = /\b(no|nah|keep|kept|khalli|khaleeha|seebha|mesh 3ayez|el3'i|لا|خلي|خليها|سيبها|مش عايز)\b/i;
            const saidNo = NEG.test(s.message) && !/\b(cancel it|الغيه|الغيها|el3'ih)\b/i.test(s.message);
            const saidYes = !saidNo && (s.isAffirmative || s.extraction?.intent === "confirm" || s.extraction?.intent === "cancel");
            const target = s.upcoming.find((r) => r.id === sess.quoted?.cancel_id);
            if (saidNo || !target) {
              // anything that isn't a clear yes KEEPS the reservation — cancel is destructive
              return { outcome: target ? { kind: "kept_reservation", reservation: target } : { kind: "nothing_to_cancel" }, sessionPatch: { ...baseSessionPatch(s, "archived"), quoted: null } };
            }
            if (saidYes) {
              await db.from("reservations").update({ status: "cancelled", cancelled_reason: "guest_request" }).eq("id", target.id);
              await notifyDashboard(db, "reservation", `Cancelled ${target.code}`,
                `${target.diner_name || ctx.sessionId} cancelled ${target.date} ${String(target.time_slot).slice(0, 5)} × ${target.party_size}`, ctx.sessionId);
              return { outcome: { kind: "cancelled", reservation: target }, sessionPatch: { ...baseSessionPatch(s, "archived"), quoted: null } };
            }
            // unclear answer → ask once more, still holding the reservation
            return { outcome: { kind: "cancel_check", reservation: target, multiple: false, all: s.upcoming }, sessionPatch: { ...baseSessionPatch(s, "awaiting_cancel_confirm"), quoted: sess.quoted } };
          }
          // cancelling an in-progress (unconfirmed) session = just drop it
          if (!s.upcoming.length) {
            if (sess && ["incomplete", "quoted", "awaiting_confirm"].includes(sess.session_status)) {
              return { outcome: { kind: "session_dropped" }, sessionPatch: { ...baseSessionPatch(s, "archived"), quoted: null } };
            }
            return { outcome: { kind: "nothing_to_cancel" }, sessionPatch: null };
          }
          // existing booking(s): always one confirmation step
          const target = s.upcoming[0];
          return {
            outcome: { kind: "cancel_check", reservation: target, multiple: s.upcoming.length > 1, all: s.upcoming },
            sessionPatch: { ...baseSessionPatch(s, "awaiting_cancel_confirm"), quoted: { cancel_id: target.id, cancel_code: target.code } },
          };
        }, { input: { upcoming: s.upcoming.length, stage: s.session?.session_status || "none" } });
      })
      .addNode("modify", async (s) => {
        return f.node("modify", async () => {
          const target = s.upcoming[0];
          if (!target) return { outcome: { kind: "nothing_to_modify" }, sessionPatch: null };
          // a bare number in a modify message is a TIME unless people-words are present
          const PEOPLE_WORDS = /\b(people|persons?|ppl|guests?|anfar|nafar|nas|afrad|شخص|اشخاص|أشخاص|افراد|أفراد|نفر|واحد)\b/i;
          const want = {
            party_size: s.extraction?.party_size && PEOPLE_WORDS.test(s.message) ? s.extraction.party_size : target.party_size,
            date: s.slots.date || target.date,
            time: s.slots.time || String(target.time_slot).slice(0, 5),
          };
          if (want.party_size > maxParty) {
            return { outcome: { kind: "too_big", party: want.party_size, max: maxParty }, sessionPatch: null };
          }
          const [tables, dayRes] = await Promise.all([
            db.from("restaurant_tables").select("*").then((r) => r.data || []),
            db.from("reservations").select("*").eq("date", want.date).neq("id", target.id).then((r) => r.data || []),
          ]);
          const avail = computeAvailability({
            tables, reservations: dayRes, hours: config.hours, policy,
            dateISO: want.date, time: want.time, party: want.party_size, sectionPref: null,
          });
          if (!avail.available) {
            return { outcome: { kind: "modify_unavailable", kept: target, wanted: want, alternatives: avail.alternatives }, sessionPatch: null };
          }
          const { data: updated } = await db.from("reservations").update({
            party_size: want.party_size, date: want.date, time_slot: want.time,
            end_slot: avail.end_slot, table_id: avail.table.id, updated_at: new Date().toISOString(),
          }).eq("id", target.id).select().single();
          await notifyDashboard(db, "reservation", `Modified ${target.code}`,
            `${target.diner_name || ctx.sessionId} → ${want.date} ${want.time} × ${want.party_size}`, ctx.sessionId);
          return { outcome: { kind: "modified", reservation: updated || { ...target, ...want }, table: avail.table }, sessionPatch: { ...baseSessionPatch(s, "archived"), quoted: null } };
        }, { input: { upcoming: s.upcoming.length } });
      })
      .addNode("info", async (s) => {
        return f.node("info", async () => ({
          outcome: s.extraction?.third_party
            ? { kind: "third_party_refusal" }
            : s.upcoming.length
            ? { kind: "info", all: s.upcoming }
            : { kind: "no_reservation" },
          sessionPatch: null,
        }), { input: { upcoming: s.upcoming.length, third_party: !!s.extraction?.third_party } });
      })
      .addNode("handoff", async (s) => {
        return f.node("handoff", async () => {
          const briefing = `Large party request: ${s.slots.party_size} people${s.slots.date ? ` on ${s.slots.date}` : ""}${s.slots.time ? ` at ${s.slots.time}` : ""} — needs a manager (max online: ${maxParty}).`;
          await setSessionFlags(db, ctx.sessionId, { needs_attention: true, handoff_reason: "large party", handoff_briefing: briefing });
          await notifyDashboard(db, "handoff", "Large party — manager needed", `${diner?.name || ctx.sessionId}: ${briefing}`, ctx.sessionId);
          return { outcome: { kind: "large_party", party: s.slots.party_size, max: maxParty }, sessionPatch: { ...baseSessionPatch(s, "archived"), quoted: null } };
        }, { input: { party: s.slots.party_size } });
      })
      .addNode("phrase", async (s) => {
        const value = await f.node("phrase", async () => {
          const r = await phraseReply(s, config, classification);
          return r;
        }, { input: { outcome_kind: s.outcome?.kind } });
        return { reply: value.reply, quickReplies: value.quickReplies || [] };
      })
      .addEdge(START, "extract")
      .addConditionalEdges("extract", (s) => decide(s), {
        collect: "collect", quote: "quote", confirm: "confirm",
        cancel: "cancel", modify: "modify", info: "info", handoff: "handoff",
      })
      .addEdge("collect", "phrase")
      .addEdge("quote", "phrase")
      .addEdge("confirm", "phrase")
      .addEdge("cancel", "phrase")
      .addEdge("modify", "phrase")
      .addEdge("info", "phrase")
      .addEdge("handoff", "phrase")
      .addEdge("phrase", END)
      .compile();

    // decide is PURE code routing — reads state, never mutates it
    function decide(s) {
      const ex = s.extraction || {};
      const sess = s.session;
      const slots = s.slots || {};

      if (ex.third_party) return "info"; // privacy path — info node handles the refusal
      if (sess?.session_status === "awaiting_cancel_confirm") return "cancel";
      if (ex.intent === "cancel") return "cancel";
      if (ex.intent === "abandon") return "cancel";
      // CODE BACKSTOP: change/move words + an existing booking = modify, whatever the LLM said.
      // (Mid-collect corrections stay in the booking flow — only fires when no session is active.)
      const MODIFY_HINT = /\b(ne2adem|n2adem|ne2a5ar|n2a5ar|ne2akhar|3adel|3addel|ghayyar|move|change|reschedule|shift|postpone|push (it|the)|عدل|عدّل|غير|غيّر|نقدم|نقدّم|نأخر|أجل|بدّل|بدل)\b/i;
      const BOOKING_REF = /\b(7agz|el ?7agz|booking|reservation|ma3ad|el ?ma3ad|حجز|حجزي|الحجز|المعاد|معادي)\b/i;
      const sessionActive = sess && ["incomplete", "quoted", "awaiting_confirm"].includes(sess.session_status);
      if (MODIFY_HINT.test(s.message) && !sessionActive) {
        if (s.upcoming.length && (BOOKING_REF.test(s.message) || ex.intent === "modify" || ex.time || ex.date)) return "modify";
        if (!s.upcoming.length && BOOKING_REF.test(s.message)) return "info"; // "change my booking" with none
      }
      const quotedStage = ["quoted", "awaiting_confirm"].includes(sess?.session_status);
      if (ex.intent === "confirm" || (s.isAffirmative && quotedStage)) {
        if (quotedStage) return "confirm";
        // "yes/tamam" mid-collect: keep collecting instead of "yes to what?" loops
        if (slots.party_size || slots.date || slots.time) {
          return !slots.party_size || !slots.date || !slots.time ? "collect" : "quote";
        }
        return "confirm"; // truly nothing → playful nothing_to_confirm
      }
      if (ex.intent === "modify" && s.upcoming.length) return "modify";
      if (ex.intent === "modify" && !s.upcoming.length) return "info"; // "change my booking" with none → say so, don't start collecting
      if (ex.intent === "info" && !ex.party_size && !ex.date && !ex.time) return "info";
      if (slots.party_size && slots.party_size > maxParty) return "handoff";
      if (!slots.party_size || !slots.date || !slots.time) return "collect";
      return "quote";
    }

    function baseSessionPatch(s, status) {
      return {
        phone_number: ctx.sessionId,
        session_status: status,
        stage: status,
        party_size: s.slots.party_size || null,
        date: s.slots.date || null,
        time_slot: s.slots.time || null,
        section_pref: s.slots.section_pref || null,
        occasion: s.slots.occasion || null,
        special_requests: s.slots.special_requests || null,
        turns_in_stage: (s.session?.session_status === status ? (s.session?.turns_in_stage || 0) : 0) + 1,
        turns_in_session: (s.session?.turns_in_session || 0) + 1,
        updated_at: new Date().toISOString(),
      };
    }

    const result = await graph.invoke({
      message: input.message,
      isAffirmative: !!input.precheck?.is_affirmative,
      language: classification?.language || null,
      session: loaded.session,
      upcoming: loaded.upcoming,
    });

    // ---- save (outside the graph: IO boundary) ----
    await f.node("save", async () => {
      if (!result.sessionPatch) return { persisted: false };
      const { error } = await db.from("temp_reservation").upsert(result.sessionPatch, { onConflict: "phone_number" });
      if (error) throw new Error(`temp_reservation save failed: ${error.message}`);
      return { persisted: true, status: result.sessionPatch.session_status };
    }, { input: { has_patch: !!result.sessionPatch } });

    // multi-intent: "book a table — also do you have vegan food?" → FRIENDLY answers
    // the side question as a second message part (its own side effects included)
    let sideAnswer = null;
    const sideQ = result.extraction?.side_question;
    if (sideQ && !["large_party"].includes(result.outcome?.kind)) {
      try {
        const fr = await f.flow("friendly", {
          message: sideQ, diner, history: input.history,
          classification: { ...classification, requested_bucket: "friendly" },
        });
        sideAnswer = fr?.reply || null;
      } catch { /* side question is best-effort */ }
    }

    return {
      reply: (result.reply || "One second! 🙌") + (sideAnswer ? `\n\n${sideAnswer}` : ""),
      quickReplies: result.quickReplies || [],
      handoff: result.outcome?.kind === "large_party",
      photos: [],
    };
  },
});

async function uniqueCode(db) {
  for (let i = 0; i < 5; i++) {
    const code = makeReservationCode();
    const { data } = await db.from("reservations").select("id").eq("code", code).limit(1);
    if (!data?.length) return code;
  }
  return `R-${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

// phrasing: LLM turns the structured outcome into a warm reply — facts come ONLY from the outcome
async function phraseReply(s, config, classification) {
  const o = s.outcome || { kind: "ask_missing", missing: "party_size" };
  const lang = classification?.language || "en";
  const sys = `You are ${config.ai?.name || "the host"}, the booking assistant of ${config.name} on WhatsApp. Personality: ${config.ai?.personality || "warm"}.
Write ONE short reply (1-3 sentences, max 2 emojis) for the OUTCOME below. LANGUAGE = MIRROR THE GUEST'S MESSAGE EXACTLY:
- Guest wrote ARABIC SCRIPT → reply 100% in Arabic script (مصري). NEVER Franco to an Arabic-script guest.
- Guest wrote ENGLISH → reply 100% in English. NEVER Franco words ("emta", "3ayez") to an English guest.
- Guest wrote FRANCO (Latin letters with 3/7/2 digits) → Egyptian Franco in Latin letters only.
Section/table names and the R-code stay in Latin letters always.
HARD RULES: use ONLY the facts in OUTCOME — never invent times, tables, codes or policies. Dates: phrase naturally ("Friday Jul 24"). Times: 12h format ("8 PM").
OUTCOME KINDS:
- ask_missing: ask ONLY for the missing field (party_size→"How many people?", date→"What day?", time→"What time?"). If problems includes date_in_past you MUST playfully note that date already passed ("unless you've got a time machine 😄") before asking for a real day. One question only.
- quoted: state the exact offer (date, time, party, section) + ask to confirm. quick_replies: ["Confirm ✅","Change time"].
- confirmed: celebrate 🎉 + date/time/party/table number. The reservation CODE is MANDATORY — every confirmed reply MUST contain the exact code string (e.g. "R-7HK4") verbatim in Latin letters, whatever the language.
- already_confirmed: reassure — it's booked, restate code.
- duplicate_exists: they already have <code> that day — ask if they want to change it instead. quick_replies: ["Modify it","Keep it"].
- gone_at_confirm: FIRST sentence must clearly say that exact slot was JUST taken by someone else (apologize) — never re-offer the same slot or re-ask to confirm it; THEN offer the alternatives list (if empty, offer another day).
- unavailable: that exact slot isn't free; offer the alternatives (times list). If reason=closed_that_day say closed that day; outside_hours = outside opening hours. quick_replies from up to 3 alternatives.
- cancel_check: confirm cancelling <code> on <date> <time> for <party>? ONE clear question. quick_replies: ["Yes, cancel","Keep it"].
- cancelled: warm goodbye, mention they can rebook anytime.
- kept_reservation: great — the booking STAYS exactly as it was (restate code+date/time briefly). Never sound like anything changed.
- session_dropped: no problem, we dropped the request — door's open.
- nothing_to_cancel / nothing_to_modify / no_reservation: friendly "nothing found" + offer to book.
- nothing_to_confirm: "yes to what? 😄" — playfully offer to book a table.
- info: list their reservation(s): code, date, time, party.
- modified: confirm the change with new details + code.
- modify_unavailable: couldn't move it — KEPT the original (state it) + offer alternatives.
- too_big / large_party: for groups that size the team takes over personally — they'll reply right here shortly.
- third_party_refusal: kindly but firmly — for privacy you can ONLY manage bookings made from THIS number; their friend should message us directly.
FRANCO TONE: Egyptian colloquial in Latin letters ("kam wa7ed hatkono?", "emta ya basha?") — never transliterated formal Arabic.
NEVER, under any outcome except confirmed/already_confirmed/modified, say or imply the booking is done — no "7agezt", "booked", "حجزتلك", "reserved".
Return JSON: {"reply": string, "quick_replies": string[]|null}`;
  const BOOKED_CLAIM = /\b(booked|reserved|confirmed your|i'?ve confirmed|7agezt|hagezt|حجزتلك|حجزت لك|اتحجز|تم الحجز|تم تأكيد)\b/i;
  const SAFE_KINDS = new Set(["confirmed", "already_confirmed", "modified"]);
  try {
    const user = `OUTCOME: ${JSON.stringify(o)}\nGuest message: ${s.message}`;
    let r = await chatJSON("gpt-4.1-mini", sys, user, { temperature: 0.5, maxTokens: 260 });
    // CODE GUARD (script): Arabic-script guest must get an Arabic-script reply; Latin guest never gets Arabic script
    const AR = /[؀-ۿ]/;
    const FRANCO_MARK = /[a-z][237][a-z]|\b[237][a-z]{2,}/i; // 3ayez / ma3lesh / 7agz-style digit-letters
    const guestAr = AR.test(s.message);
    const guestFranco = !guestAr && FRANCO_MARK.test(s.message);
    const reply0 = r.value?.reply || "";
    const wrongScript = (guestAr && !AR.test(reply0)) || (!guestAr && AR.test(reply0));
    const francoToEnglish = !guestAr && !guestFranco && FRANCO_MARK.test(reply0); // EN guest, Franco reply
    if (wrongScript || francoToEnglish) {
      const want = guestAr ? "ARABIC SCRIPT — rewrite fully in Arabic script (مصري)"
        : guestFranco ? "FRANCO — rewrite in Egyptian Franco, Latin letters"
        : "plain ENGLISH — rewrite fully in English, no Franco words";
      r = await chatJSON("gpt-4.1-mini", sys, `${user}\nSYSTEM CHECK: your reply used the wrong language. The guest wrote in ${want}. Same meaning, same JSON shape.`, { temperature: 0.4, maxTokens: 260 });
    }
    const v = r.value || {};
    let reply = (v.reply || fallbackPhrase(o)).slice(0, 900);
    // CODE GUARD: a non-confirmed outcome must never read as a completed booking
    if (!SAFE_KINDS.has(o.kind) && BOOKED_CLAIM.test(reply)) reply = fallbackPhrase(o);
    const out = { reply, quickReplies: (v.quick_replies || []).map((q) => String(q).slice(0, 20)).slice(0, 3) };
    out.__usage = r.__usage;
    return out;
  } catch {
    return { reply: fallbackPhrase(o), quickReplies: [] };
  }
}

function fallbackPhrase(o) {
  switch (o.kind) {
    case "ask_missing":
      return o.missing === "party_size" ? "How many people should I book for?" : o.missing === "date" ? "What day works for you?" : "What time should I check?";
    case "quoted": return `${o.quote.date} at ${o.quote.time} for ${o.quote.party_size} — shall I confirm? ✅`;
    case "confirmed": return `Booked! 🎉 ${o.code} — ${o.reservation.date} ${String(o.reservation.time_slot).slice(0, 5)} for ${o.reservation.party_size}.`;
    case "cancel_check": return `Cancel ${o.reservation.code} on ${o.reservation.date}? Reply yes to confirm.`;
    case "cancelled": return "Cancelled — sad to miss you! Book again anytime 💛";
    case "kept_reservation": return `Perfect — your reservation stays exactly as planned${o.reservation?.code ? ` (${o.reservation.code})` : ""} 🙌`;
    case "session_dropped": return "No problem — dropped it. The door's always open 💛";
    case "nothing_to_confirm": return "Yes to what? 😄 Want me to book you a table? Just say people, day and time.";
    case "third_party_refusal": return "For privacy I can only manage bookings made from this number — ask them to message us directly 🙏";
    case "large_party": return "For a group that size the team takes over personally — they'll reply right here shortly 🙌";
    default: return "Got it — the team will follow up right here if anything's needed 🙌";
  }
}
