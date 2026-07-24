// REMINDERS (#15, window-aware v1) — T-3h "see you tonight" with Confirm/Cancel buttons.
// Free-form messages are only allowed inside WhatsApp's 24h service window, so we
// send when the guest interacted <24h ago and skip otherwise (Meta template messages
// unlock the rest — planned; the sweep marks nothing so closed-window guests retry
// every tick until the window opens or the slot passes).
import { defineFlow } from "../engine/flow.js";
import { sendButtons, WA_PHONE_NUMBER_ID } from "../services/whatsapp.js";
import { logMessage } from "../services/chatlog.js";
import { appendHistory } from "../services/history.js";
import { todayISO } from "../services/availability.js";

const WINDOW_H = 24;
const REMIND_WITHIN_MIN = 180; // T-3h

defineFlow({
  name: "reminders",
  description: "T-3h reservation reminders (Confirm/Cancel buttons, 24h-window aware)",
  trigger: { icon: "timer", label: "Schedule (every 15 min) / manual from ops" },
  nodes: [
    { id: "find_due", label: "Find Due Reservations", icon: "database" },
    { id: "send", label: "Send Reminders", icon: "send" },
  ],

  async run(f, ctx) {
    const { db, config } = ctx.tenant;
    const tz = config.basic_info?.timezone || "Africa/Cairo";
    const today = todayISO(tz);

    const due = await f.node("find_due", async () => {
      const { data } = await db.from("reservations").select("*")
        .eq("date", today).eq("status", "confirmed").is("reminder_sent_at", null);
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const list = (data || []).filter((r) => {
        const phone = String(r.diner_phone);
        if (phone.startsWith("web:") || phone.startsWith("walkin")) return false;
        const [h, m] = String(r.time_slot).split(":").map(Number);
        let slotMin = h * 60 + (m || 0);
        if (slotMin < 6 * 60) slotMin += 1440; // 00:30 belongs to tonight
        const delta = slotMin - nowMin;
        return delta > 0 && delta <= REMIND_WITHIN_MIN;
      });
      return { due: list, count: list.length };
    }, { input: { date: today, within_min: REMIND_WITHIN_MIN } });

    return f.node("send", async () => {
      let sent = 0, window_closed = 0, failed = 0;
      for (const r of due.due) {
        const { data: d } = await db.from("diners").select("last_seen_at").eq("phone_number", r.diner_phone).maybeSingle();
        const windowOpen = d?.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < WINDOW_H * 3600_000;
        if (!windowOpen) { window_closed++; continue; } // needs a Meta template — skipped for now
        const text = `See you today at ${String(r.time_slot).slice(0, 5)} — table for ${r.party_size} (${r.code}) 🥳 All good?`;
        try {
          if (WA_PHONE_NUMBER_ID) await sendButtons(WA_PHONE_NUMBER_ID, r.diner_phone.replace(/^\+/, ""), text, ["Confirm ✅", "Cancel"]);
          await logMessage(db, r.diner_phone, "ai", `${text}\n▸ Confirm ✅  ▸ Cancel`, "whatsapp");
          await appendHistory(db, r.diner_phone, "ai", text);
          await db.from("reservations").update({ status: "reminded", reminder_sent_at: new Date().toISOString() }).eq("id", r.id);
          sent++;
        } catch { failed++; } // not marked — retried next tick
      }
      return { sent, window_closed_need_template: window_closed, failed };
    }, { input: { due: due.count } });
  },
});
