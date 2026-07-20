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
 "date": "YYYY-MM-DD"|null  (COMPUTE from TODAY: "tomorrow"/"bokra" = next day, "friday" = the NEXT Friday, "today"/"tonight" = today),
 "time": "HH:MM" 24h|null   (dinner context: bare "8" or "9" = 20:00/21:00; "8 el sob7" = 08:00),
 "section_pref": "indoor"|"outdoor"|"terrace"|null, "occasion": string|null,
 "special_requests": string|null, "name": string|null}
intent rules: "confirm" ONLY when agreeing to a quoted offer (yes/tamam/confirm/👍). "cancel" = wants to cancel (in-progress OR existing booking). "modify" = change an EXISTING booking. "info" = asking about their existing booking, giving no new details. "abandon" = never mind / leave it. Everything that gives or asks about slots = "book".`;
          const r = await chatJSON("gpt-4o-mini", sys, s.message, { temperature: 0, maxTokens: 160 });
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
          // step 2 of the two-step: they already saw "cancel R-XXXX?" and said yes
          if (sess?.session_status === "awaiting_cancel_confirm" && (s.isAffirmative || s.extraction?.intent === "confirm" || s.extraction?.intent === "cancel")) {
            const target = s.upcoming.find((r) => r.id === sess.quoted?.cancel_id);
            if (target) {
              await db.from("reservations").update({ status: "cancelled", cancelled_reason: "guest_request" }).eq("id", target.id);
              await notifyDashboard(db, "reservation", `Cancelled ${target.code}`,
                `${target.diner_name || ctx.sessionId} cancelled ${target.date} ${String(target.time_slot).slice(0, 5)} × ${target.party_size}`, ctx.sessionId);
              return { outcome: { kind: "cancelled", reservation: target }, sessionPatch: { ...baseSessionPatch(s, "archived"), quoted: null } };
            }
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
          const want = {
            party_size: s.extraction?.party_size || target.party_size,
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
          outcome: s.upcoming.length
            ? { kind: "info", all: s.upcoming }
            : { kind: "no_reservation" },
          sessionPatch: null,
        }), { input: { upcoming: s.upcoming.length } });
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

      if (sess?.session_status === "awaiting_cancel_confirm") return "cancel";
      if (ex.intent === "cancel") return "cancel";
      if (ex.intent === "abandon") return "cancel";
      if (ex.intent === "confirm" || (s.isAffirmative && ["quoted", "awaiting_confirm"].includes(sess?.session_status))) return "confirm";
      if (ex.intent === "modify" && s.upcoming.length) return "modify";
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

    return {
      reply: result.reply || "One second! 🙌",
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
Write ONE short reply (1-3 sentences, max 2 emojis) for the OUTCOME below. Reply in the guest's language: ${lang} (franco = Latin letters only; NEVER Arabic script for franco/en). Dish/section names stay as given.
HARD RULES: use ONLY the facts in OUTCOME — never invent times, tables, codes or policies. Dates: phrase naturally ("Friday Jul 24"). Times: 12h format ("8 PM").
OUTCOME KINDS:
- ask_missing: ask ONLY for the missing field (party_size→"How many people?", date→"What day?", time→"What time?"). If problems includes date_in_past, gently point it out. One question only.
- quoted: state the exact offer (date, time, party, section) + ask to confirm. quick_replies: ["Confirm ✅","Change time"].
- confirmed: celebrate 🎉 + give the code + date/time/party/table number. If occasion=birthday add ONE warm birthday line.
- already_confirmed: reassure — it's booked, restate code.
- duplicate_exists: they already have <code> that day — ask if they want to change it instead. quick_replies: ["Modify it","Keep it"].
- gone_at_confirm: apologize — the slot was just taken; offer the alternatives list (if empty, offer another day).
- unavailable: that exact slot isn't free; offer the alternatives (times list). If reason=closed_that_day say closed that day; outside_hours = outside opening hours. quick_replies from up to 3 alternatives.
- cancel_check: confirm cancelling <code> on <date> <time> for <party>? ONE clear question. quick_replies: ["Yes, cancel","Keep it"].
- cancelled: warm goodbye, mention they can rebook anytime.
- session_dropped: no problem, we dropped the request — door's open.
- nothing_to_cancel / nothing_to_modify / no_reservation: friendly "nothing found" + offer to book.
- nothing_to_confirm: "yes to what? 😄" — playfully offer to book a table.
- info: list their reservation(s): code, date, time, party.
- modified: confirm the change with new details + code.
- modify_unavailable: couldn't move it — KEPT the original (state it) + offer alternatives.
- too_big / large_party: for groups that size the team takes over personally — they'll reply right here shortly.
Return JSON: {"reply": string, "quick_replies": string[]|null}`;
  try {
    const r = await chatJSON("gpt-4.1-mini", sys, `OUTCOME: ${JSON.stringify(o)}\nGuest message: ${s.message}`, { temperature: 0.5, maxTokens: 260 });
    const v = r.value || {};
    const out = { reply: (v.reply || fallbackPhrase(o)).slice(0, 900), quickReplies: (v.quick_replies || []).map((q) => String(q).slice(0, 20)).slice(0, 3) };
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
    default: return "Got it — the team will follow up right here if anything's needed 🙌";
  }
}
