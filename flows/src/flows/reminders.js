// REMINDERS (#15, window-aware v1) — T-3h "see you tonight" with Confirm/Cancel buttons.
// Free-form messages are only allowed inside WhatsApp's 24h service window, so we
// send when the guest interacted <24h ago and skip otherwise (Meta template messages
// unlock the rest — planned; the sweep marks nothing so closed-window guests retry
// every tick until the window opens or the slot passes).
import { defineFlow } from "../engine/flow.js";
import { sendButtons, sendText, WA_PHONE_NUMBER_ID } from "../services/whatsapp.js";
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
    { id: "recover_drafts", label: "Abandoned-Order Recovery", icon: "history" },
    { id: "upsell_ping", label: "Post-Order Upsell", icon: "sparkles" },
    { id: "review_ask", label: "Review Ask", icon: "star" },
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

    // ---- abandoned-order recovery (0-LLM; the draft IS the guest's own recent
    // message, so the 24h window is open by construction) ----
    const rec = config.ai?.automations?.recovery;
    await f.node("recover_drafts", async () => {
      if (rec?.enabled === false) return { skipped: "disabled in Settings" };
      const delayMin = Number(rec?.delay_min) || 45;
      const { data: diners } = await db.from("diners")
        .select("id,phone_number,preferences").not("preferences->pending_order", "is", null).limit(200);
      let nudged = 0;
      for (const d of diners || []) {
        const p = d.preferences?.pending_order;
        const phone = String(d.phone_number || "");
        if (!p?.items?.length || !p.at || p.recovery_nudged_at) continue;
        if (phone.startsWith("web:") || phone.startsWith("walkin")) continue;
        const ageMin = (Date.now() - new Date(p.at).getTime()) / 60000;
        if (ageMin < delayMin || ageMin > 20 * 60) continue; // too fresh, or a dead draft
        const names = p.items.slice(0, 3).map((i) => `${i.qty}× ${i.name}`).join(", ");
        const text = `Your ${names} ${p.items.length > 1 ? "are" : "is"} still waiting 🛎 Send *yes* and it goes straight to the kitchen — or tell me what to change.`;
        try {
          if (WA_PHONE_NUMBER_ID) await sendButtons(WA_PHONE_NUMBER_ID, phone.replace(/^\+/, ""), text, ["Yes — order it ✅", "Change it"]);
          await logMessage(db, phone, "ai", `${text}\n▸ Yes — order it ✅  ▸ Change it`, "whatsapp");
          await appendHistory(db, phone, "ai", text);
          await db.from("diners").update({ preferences: { ...d.preferences, pending_order: { ...p, recovery_nudged_at: new Date().toISOString() } } }).eq("id", d.id);
          nudged++;
        } catch { /* marker not set — retried next tick */ }
      }
      return { nudged, delay_min: delayMin };
    }, { input: { enabled: rec?.enabled !== false } });

    // ---- post-order upsell ping (0-LLM: bestseller from a category the order lacks) ----
    const ups = config.ai?.automations?.upsell;
    await f.node("upsell_ping", async () => {
      if (ups?.enabled === false) return { skipped: "disabled in Settings" };
      const delayMin = Number(ups?.delay_min) || 5;
      const since = new Date(Date.now() - 30 * 60000).toISOString();
      const { data: orders } = await db.from("orders").select("id,code,phone_number,items,created_at,status,upsell_pinged_at")
        .gte("created_at", since).in("status", ["pending", "accepted", "preparing"]).is("upsell_pinged_at", null).limit(50);
      const { data: menu } = await db.from("menu_items").select("name,category,price,bestseller,available").eq("available", true);
      let pinged = 0;
      for (const o of orders || []) {
        const phone = String(o.phone_number || "");
        if (phone.startsWith("web:") || phone.startsWith("walkin")) continue;
        const ageMin = (Date.now() - new Date(o.created_at).getTime()) / 60000;
        if (ageMin < delayMin) continue;
        const inOrder = new Set((o.items || []).map((i) => String(i.name).toLowerCase()));
        const hasCat = (cat) => (o.items || []).some((i) => (menu || []).find((m) => m.name.toLowerCase() === String(i.name).toLowerCase())?.category === cat);
        const target = ["Beverages", "Appetizers", "Extras"].find((c) => (menu || []).some((m) => m.category === c) && !hasCat(c));
        if (!target) { await db.from("orders").update({ upsell_pinged_at: new Date().toISOString() }).eq("id", o.id).then(() => {}, () => {}); continue; }
        const pick = (menu || []).filter((m) => m.category === target && !inOrder.has(m.name.toLowerCase()))
          .sort((a, b) => (b.bestseller ? 1 : 0) - (a.bestseller ? 1 : 0))[0];
        if (!pick) continue;
        const text = `Kitchen's on ${o.code} 👨‍🍳 Add a ${pick.name} (${Math.round(pick.price)} EGP) before it seals?`;
        try {
          if (WA_PHONE_NUMBER_ID) await sendButtons(WA_PHONE_NUMBER_ID, phone.replace(/^\+/, ""), text, [`Add ${pick.name}`.slice(0, 20), "No thanks"]);
          await logMessage(db, phone, "ai", `${text}\n▸ Add ${pick.name}  ▸ No thanks`, "whatsapp");
          await appendHistory(db, phone, "ai", text);
          await db.from("orders").update({ upsell_pinged_at: new Date().toISOString() }).eq("id", o.id).then(() => {}, () => {});
          pinged++;
        } catch { /* retry next tick */ }
      }
      return { pinged };
    }, { input: { enabled: ups?.enabled !== false } });

    // ---- review ask ~1h after arrival (in-window; unhappy guests never asked) ----
    const rev = config.ai?.automations?.review_ask;
    await f.node("review_ask", async () => {
      const url = config.ai?.google_reviews_url;
      if (rev?.enabled === false || !url) return { skipped: !url ? "no google_reviews_url configured" : "disabled" };
      const { data: orders } = await db.from("orders").select("id,code,phone_number,delivered_at,served_at,review_prompted_at,status")
        .in("status", ["delivered", "served"]).gte("created_at", new Date(Date.now() - 12 * 3600_000).toISOString())
        .is("review_prompted_at", null).limit(50);
      let asked = 0;
      for (const o of orders || []) {
        const phone = String(o.phone_number || "");
        if (phone.startsWith("web:") || phone.startsWith("walkin")) continue;
        const doneAt = o.delivered_at || o.served_at;
        if (!doneAt) continue;
        const ageMin = (Date.now() - new Date(doneAt).getTime()) / 60000;
        if (ageMin < 55 || ageMin > 180) continue;
        const { data: sess } = await db.from("chat_sessions").select("needs_attention").eq("session_id", phone).maybeSingle();
        if (sess?.needs_attention) { await db.from("orders").update({ review_prompted_at: new Date().toISOString() }).eq("id", o.id).then(() => {}, () => {}); continue; }
        const text = `Hope ${o.code} hit the spot 🧡 If you have 30 seconds, a Google review means the world to us:\n${url}`;
        try {
          if (WA_PHONE_NUMBER_ID) await sendText(WA_PHONE_NUMBER_ID, phone.replace(/^\+/, ""), text);
          await logMessage(db, phone, "ai", text, "whatsapp");
          await appendHistory(db, phone, "ai", text);
          await db.from("orders").update({ review_prompted_at: new Date().toISOString() }).eq("id", o.id).then(() => {}, () => {});
          asked++;
        } catch { /* retry next tick */ }
      }
      return { asked };
    }, { input: { enabled: rev?.enabled !== false, url_configured: !!config.ai?.google_reviews_url } });
  },
});
