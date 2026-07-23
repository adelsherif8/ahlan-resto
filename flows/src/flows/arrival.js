// ARRIVAL (#10) — "I'm here" / "running late". Completes book → arrive → seat.
// Simple flow (no graph needed): one small extract, code decides, one phrase call.
import { defineFlow } from "../engine/flow.js";
import { chatJSON } from "../services/llm.js";
import { notifyDashboard } from "../services/chatlog.js";
import { todayISO } from "../services/availability.js";

const ACTIVE = ["confirmed", "reminded"];

defineFlow({
  name: "arrival",
  description: "Arrival agent — mark arrived + host ping; running-late grace holds",
  trigger: { icon: "branch", label: "Dispatched by MASTER (arrival bucket)" },
  nodes: [
    { id: "load", label: "Find Today's Reservation", icon: "database" },
    { id: "extract", label: "Extract (LLM)", icon: "sparkles" },
    { id: "act", label: "Act (code)", icon: "zap" },
    { id: "phrase", label: "Phrase Reply (LLM)", icon: "sparkles" },
  ],

  async run(f, ctx, input) {
    const { db, config } = ctx.tenant;
    const tz = config.basic_info?.timezone || "Africa/Cairo";
    const { diner, classification } = input;
    const today = todayISO(tz);

    const loaded = await f.node("load", async () => {
      const { data: rows } = await db.from("reservations").select("*")
        .eq("diner_phone", ctx.sessionId).eq("date", today).order("time_slot");
      const res = (rows || []).find((r) => ACTIVE.includes(r.status)) || null;
      const already = (rows || []).find((r) => ["arrived", "seated"].includes(r.status)) || null;
      const cancelled = (rows || []).find((r) => r.status === "cancelled") || null;
      let table = null;
      if (res?.table_id) {
        const { data: t } = await db.from("restaurant_tables").select("*").eq("id", res.table_id).maybeSingle();
        table = t || null;
      }
      return { res, already, cancelled, table };
    }, { input: { sessionId: ctx.sessionId, date: today } });

    const ex = await f.node("extract", async () => {
      const r = await chatJSON("gpt-4.1-mini",
        `Classify this WhatsApp message from a restaurant guest. JSON only:
{"kind": "im_here" | "running_late" | "other", "eta_minutes": number|null}
"im_here" = at/outside the restaurant now ("I'm here", "we're outside", "wa2fin barra", "احنا وصلنا").
"running_late" = on the way but delayed ("running late", "traffic", "el za7ma", "هتأخر شوية") — eta_minutes if stated ("15 mins" → 15), null if not.`,
        input.message, { temperature: 0, maxTokens: 60 });
      return r;
    }, { input: { message: input.message } });
    const kind = ex.value?.kind || "other";
    const eta = Number(ex.value?.eta_minutes) || null;

    const outcome = await f.node("act", async () => {
      const { res, already, cancelled, table } = loaded;
      const name = diner?.name || diner?.wa_profile_name || ctx.sessionId;

      if (kind === "im_here") {
        if (already) return { kind: "already_in", table: loaded.table?.table_number || null };
        if (res) {
          // way early? (>3h before the slot) — clarify instead of marking arrived
          const [h, m] = String(res.time_slot).split(":").map(Number);
          const nowMin = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
          const minutesEarly = h * 60 + m - (nowMin.getHours() * 60 + nowMin.getMinutes());
          if (minutesEarly > 180) return { kind: "early", time: String(res.time_slot).slice(0, 5), code: res.code };
          await db.from("reservations").update({ status: "arrived", arrived_at: new Date().toISOString() }).eq("id", res.id);
          if (res.table_id) {
            await db.from("restaurant_tables").update({ status: "reserved", current_reservation_id: res.id })
              .eq("id", res.table_id).eq("status", "free");
          }
          await notifyDashboard(db, "arrival",
            `🚶 ${name} has arrived`,
            `${res.code} · ${res.party_size}p${table ? ` · table ${table.table_number}` : ""}${res.occasion && res.occasion !== "none" ? ` · ${res.occasion} 🎂` : ""}`,
            ctx.sessionId);
          return { kind: "arrived", code: res.code, table: table?.table_number || null, party: res.party_size, occasion: res.occasion };
        }
        if (cancelled) return { kind: "was_cancelled", code: cancelled.code };
        // walk-in at the door — tell the host either way
        await notifyDashboard(db, "arrival", `🚪 Walk-in at the door`, `${name} is outside without a reservation`, ctx.sessionId);
        return { kind: "walkin_welcome" };
      }

      if (kind === "running_late") {
        if (!res) return { kind: "late_no_res" };
        const grace = (Number(config.reservation_policy?.grace_minutes) || 15) + 15; // grace + goodwill
        const [h, m] = String(res.time_slot).split(":").map(Number);
        const until = `${String(Math.floor(((h * 60 + m + grace) % 1440) / 60)).padStart(2, "0")}:${String((h * 60 + m + grace) % 60).padStart(2, "0")}`;
        const withinGrace = eta === null || eta <= grace;
        await notifyDashboard(db, "arrival",
          `⏰ ${name} running late${eta ? ` (~${eta} min)` : ""}`,
          `${res.code} · ${String(res.time_slot).slice(0, 5)} × ${res.party_size}${table ? ` · table ${table.table_number}` : ""} — ${withinGrace ? `holding until ${until}` : `beyond grace (until ${until}) — may need re-slot`}`,
          ctx.sessionId);
        return withinGrace
          ? { kind: "hold_ok", code: res.code, until, eta }
          : { kind: "hold_hard", code: res.code, until, eta };
      }

      return { kind: "unclear" };
    }, { input: { kind, eta, has_reservation: !!loaded.res } });

    const value = await f.node("phrase", async () => {
      const lang = classification?.language || "en";
      const sys = `You are ${config.ai?.name || "the host"} of ${config.name} on WhatsApp. ONE short warm reply (1-2 sentences, max 2 emojis) for the OUTCOME. Mirror the guest's language and script exactly (${lang}; franco = Latin letters; Arabic script in → Arabic script out). Use ONLY facts in the OUTCOME.
OUTCOMES:
- arrived: welcome them in 🥳 — the host is expecting them${""} (mention table number if present; birthday occasion → one warm line).
- already_in: they're already checked in — enjoy!
- early: their reservation is at <time> — warm "see you then", or ask if they want to come earlier (team will check).
- was_cancelled: that booking was cancelled — but the door's open, want a table now?
- walkin_welcome: welcome! the host at the door will sort them out right away.
- hold_ok: no stress — table's held until <until>. See them soon.
- hold_hard: honest: we can hold until <until>; beyond that it may go to the waitlist — offer to check a later slot.
- late_no_res: no booking found today — want me to check for a table?
- unclear: friendly one-line ask: are they here now, or on the way?
Return JSON: {"reply": string}`;
      return chatJSON("gpt-4.1-mini", sys, `OUTCOME: ${JSON.stringify(outcome)}\nGuest: ${input.message}`, { temperature: 0.5, maxTokens: 140 });
    }, { input: { outcome_kind: outcome.kind } });

    const fallback = {
      arrived: `Welcome in! 🥳 The host is expecting you${outcome.table ? ` — table ${outcome.table}` : ""}.`,
      hold_ok: `No stress — your table is held until ${outcome.until} 🙌`,
      hold_hard: `We can hold your table until ${outcome.until} — after that it may go to the waitlist. Want a later slot?`,
      walkin_welcome: "Welcome! The host at the door will take care of you right away 🙌",
      unclear: "Are you here now, or on the way? 😊",
    };
    return { reply: value.value?.reply || fallback[outcome.kind] || fallback.unclear, photos: [], quickReplies: [] };
  },
});
