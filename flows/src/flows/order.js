// ORDER agent (casual flagship) — chat ordering: pickup / delivery / dine-in by
// table number. LLM extracts items & phrases; CODE matches menu, prices, totals.
// v1: no payments in chat — pay at counter/courier (per FACTS). Kitchen board fed live.
import { defineFlow } from "../engine/flow.js";
import { chatJSON } from "../services/llm.js";
import { notifyDashboard } from "../services/chatlog.js";

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const orderCode = () => "O-" + Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");

const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

defineFlow({
  name: "order",
  description: "Order agent — chat ordering (pickup/delivery/dine-in by table), code-priced tickets to the kitchen board",
  trigger: { icon: "branch", label: "Dispatched by MASTER (order bucket, casual restaurants)" },
  nodes: [
    { id: "load", label: "Menu + Open Order", icon: "database" },
    { id: "extract", label: "Extract Order (LLM)", icon: "sparkles" },
    { id: "act", label: "Match + Price (code)", icon: "zap" },
    { id: "phrase", label: "Phrase Reply (LLM)", icon: "sparkles" },
  ],

  async run(f, ctx, input) {
    const { db, config } = ctx.tenant;
    const currency = config.payments?.currency || "EGP";
    const { diner, classification } = input;

    const loaded = await f.node("load", async () => {
      const { data: menuRows } = await db.from("menu_items").select("*").order("sort_order");
      const menu = (menuRows || []).filter((m) => m.available);
      const { data: open } = await db.from("orders").select("*")
        .eq("phone_number", ctx.sessionId)
        .in("status", ["pending", "accepted", "preparing", "ready"])
        .order("created_at", { ascending: false }).limit(1);
      const { data: tables } = await db.from("restaurant_tables").select("table_number");
      return { menu, openOrder: open?.[0] || null, tableNumbers: (tables || []).map((t) => String(t.table_number).toUpperCase()) };
    }, { input: { sessionId: ctx.sessionId } });

    const ex = await f.node("extract", async () => {
      const menuNames = loaded.menu.map((m) => m.name).join(" | ");
      const sys = `Extract a food order from one WhatsApp message to a fast-casual restaurant. MENU (only these exist): ${menuNames}
Recent conversation may add context: ${JSON.stringify((input.history || []).slice(-4).map((h) => h.message?.slice(0, 80)))}
Return JSON only:
{"intent": "order"|"cancel_order"|"status"|"other",
 "items": [{"name": "<closest MENU name>", "qty": number}]|null,
 "order_type": "pickup"|"delivery"|"dine_in"|null (dine_in when they mention a table / being inside),
 "table_number": string|null ("t3"/"table 3" → "T3"),
 "pickup_time": string|null, "notes": string|null (sauce prefs, no onions, etc.)}
Rules: qty defaults 1; ONLY names from MENU (closest match); "cancel_order" = wants to cancel an order; "status" = asking where their order is.`;
      return chatJSON("gpt-4.1-mini", sys, input.message, { temperature: 0, maxTokens: 220 });
    }, { input: { message: input.message } });
    const e = ex.value || {};

    const outcome = await f.node("act", async () => {
      const name = diner?.name || diner?.wa_profile_name || null;

      if (e.intent === "cancel_order") {
        if (!loaded.openOrder) return { kind: "no_open_order" };
        if (["ready"].includes(loaded.openOrder.status)) return { kind: "too_late_to_cancel", order: publicOrder(loaded.openOrder) };
        await db.from("orders").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", loaded.openOrder.id);
        await notifyDashboard(db, "order", `❌ Order ${loaded.openOrder.code} cancelled`, `${name || ctx.sessionId} cancelled via chat`, ctx.sessionId);
        return { kind: "order_cancelled", order: publicOrder(loaded.openOrder) };
      }

      if (e.intent === "status") {
        if (!loaded.openOrder) return { kind: "no_open_order" };
        return { kind: "order_status", order: publicOrder(loaded.openOrder) };
      }

      // build the order — CODE matches every item against the real menu and prices it
      const wanted = (e.items || []).slice(0, 12);
      if (!wanted.length) return { kind: "ask_items" };
      const items = [];
      const unknown = [];
      for (const w of wanted) {
        const n = normName(w.name);
        const hit = loaded.menu.find((m) => normName(m.name) === n) ||
                    loaded.menu.find((m) => normName(m.name).includes(n) || n.includes(normName(m.name)));
        if (!hit) { unknown.push(w.name); continue; }
        const qty = Math.min(Math.max(Math.round(Number(w.qty) || 1), 1), 20);
        items.push({ id: hit.id, name: hit.name, qty, price: Number(hit.price) });
      }
      if (!items.length) return { kind: "nothing_matched", unknown };

      // delivery only if the restaurant actually offers it (config fact, never assumed)
      const deliveryOn = config.basic_info?.services?.delivery !== false;
      if (e.order_type === "delivery" && !deliveryOn) return { kind: "no_delivery", items };
      // dine-in must reference a real table
      let orderType = ["pickup", "delivery", "dine_in"].includes(e.order_type) ? e.order_type : null;
      let tableNumber = null;
      if (e.table_number) {
        const t = String(e.table_number).toUpperCase().replace(/\s+/g, "");
        tableNumber = loaded.tableNumbers.find((x) => x === t || x === t.replace(/^TABLE/, "T")) || null;
        if (tableNumber) orderType = "dine_in";
        else if (orderType === "dine_in") return { kind: "bad_table", given: e.table_number, items };
      }
      if (orderType === "dine_in" && !tableNumber) return { kind: "ask_table", items };
      if (!orderType) return { kind: "ask_order_type", items, subtotal: items.reduce((s, i) => s + i.price * i.qty, 0) };

      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
      const code = orderCode();
      const { error } = await db.from("orders").insert({
        code, phone_number: ctx.sessionId, diner_name: name,
        order_type: orderType, table_number: tableNumber,
        items, subtotal, total: subtotal,
        status: "pending", payment_status: "unpaid",
        notes: [e.notes, e.pickup_time ? `pickup: ${e.pickup_time}` : null].filter(Boolean).join(" · ") || null,
      });
      if (error) throw new Error(`order insert failed: ${error.message}`);
      await notifyDashboard(db, "order",
        `🍔 New ${orderType.replace("_", "-")} order ${code}`,
        `${name || ctx.sessionId}${tableNumber ? ` · table ${tableNumber}` : ""} — ${items.map((i) => `${i.qty}× ${i.name}`).join(", ")} · ${subtotal} ${currency}`,
        ctx.sessionId);
      return { kind: "order_placed", code, order_type: orderType, table_number: tableNumber, items, subtotal, currency, unknown, notes: e.notes || null, pickup_time: e.pickup_time || null };
    }, { input: { intent: e.intent, items: (e.items || []).length, order_type: e.order_type, table: e.table_number } });

    const value = await f.node("phrase", async () => {
      const lang = classification?.language || "en";
      const sys = `You are ${config.ai?.name || "the host"} of ${config.name} (fast-casual) on WhatsApp. ONE short hype-but-clear reply for the OUTCOME (max 2 emojis). Mirror the guest's language & script (${lang}). Use ONLY facts in OUTCOME — never invent prices, times or payment links. Payment: at the counter / on pickup / to the courier — never online.
OUTCOMES:
- order_placed: confirm the ticket 🎫: list items (qty× name), TOTAL <subtotal> <currency>, the code, and what happens next (dine_in: "coming to table X" · pickup: "we'll ping you when ready" + their pickup_time if any · delivery: "heading to you"). If unknown[] has entries, add "couldn't find <names> on the menu".
- ask_items: what would they like? (invite them to tap the menu or just type it)
- ask_order_type: got the items + subtotal — eating here (table number?), pickup, or delivery?
- ask_table: which table are they at? (they can read the number off the table)
- bad_table: that table number doesn't exist — ask them to double-check what's on the table.
- nothing_matched: none of that matched the menu (list unknown) — suggest tapping the menu.
- order_status: restate their order (code, status, items) honestly by status: pending/accepted="in the queue", preparing="on the grill now", ready="READY — come grab it!".
- order_cancelled: cancelled ✅, no charge, door's open.
- too_late_to_cancel: it's already READY — can't cancel now; the team can help at the counter.
- no_open_order: no active order found — want to start one?
- no_delivery: we don't do delivery — pickup or dine-in works great though.
Return JSON: {"reply": string, "quick_replies": string[]|null}`;
      return chatJSON("gpt-4.1-mini", sys, `OUTCOME: ${JSON.stringify(outcome)}\nGuest: ${input.message}`, { temperature: 0.5, maxTokens: 240 });
    }, { input: { outcome_kind: outcome.kind } });

    const fallback = {
      order_placed: `🎫 ${outcome.code}: ${outcome.items?.map((i) => `${i.qty}× ${i.name}`).join(", ")} — ${outcome.subtotal} ${currency}. We're on it!`,
      ask_items: "What are you craving? Tap the menu or just type it 🍔",
      ask_order_type: "Eating here (which table?), pickup, or delivery?",
      ask_table: "Which table are you at? The number's on the table 😄",
      no_open_order: "No active order found — want to start one? 🍔",
    };
    return {
      reply: value.value?.reply || fallback[outcome.kind] || fallback.ask_items,
      quickReplies: (value.value?.quick_replies || []).map((q) => String(q).slice(0, 20)).slice(0, 3),
      photos: [],
    };
  },
});

function publicOrder(o) {
  return { code: o.code, status: o.status, order_type: o.order_type, table_number: o.table_number, items: o.items, total: o.total };
}
