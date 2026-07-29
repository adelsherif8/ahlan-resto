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

    const branches = (config.basic_info?.branches || []).filter((b) => b && typeof b === "object" && b.key);

    const loaded = await f.node("load", async () => {
      const { data: menuRows } = await db.from("menu_items").select("*").order("sort_order");
      const menu = (menuRows || []).filter((m) => m.available);
      const { data: open } = await db.from("orders").select("*")
        .eq("phone_number", ctx.sessionId)
        .in("status", ["pending", "accepted", "preparing", "ready"])
        .order("created_at", { ascending: false }).limit(1);
      const { data: tables } = await db.from("restaurant_tables").select("table_number");
      // an order in progress across turns (guest answered "Maadi" to our branch question)
      const p = diner?.preferences?.pending_order;
      const pending = p && Date.now() - new Date(p.at || 0).getTime() < 30 * 60_000 ? p : null;
      return {
        menu, openOrder: open?.[0] || null,
        tableNumbers: (tables || []).map((t) => String(t.table_number).toUpperCase()),
        branch: diner?.preferred_branch || pending?.branch || null, // sticky once chosen
        pending,
      };
    }, { input: { sessionId: ctx.sessionId } });

    const ex = await f.node("extract", async () => {
      const menuNames = loaded.menu.map((m) => m.name).join(" | ");
      const sys = `Extract a food order from one WhatsApp message to a fast-casual restaurant. MENU (only these exist): ${menuNames}
Recent conversation may add context: ${JSON.stringify((input.history || []).slice(-4).map((h) => h.message?.slice(0, 80)))}
Return JSON only:
{"intent": "order"|"repeat_last"|"cancel_order"|"status"|"other",
 "items": [{"name": "<closest MENU name>", "qty": number}]|null,
 "order_type": "pickup"|"delivery"|"dine_in"|null (dine_in when they mention a table / being inside),
 "table_number": string|null ("t3"/"table 3" → "T3"),
 "pickup_time": string|null, "notes": string|null (sauce prefs, no onions, etc.),
 "branch": "<exact branch NAME from this list if the guest names one, else null>"}
BRANCHES: ${branches.map((b) => b.name).join(" | ") || "(single location)"}
Rules: qty defaults 1; ONLY names from MENU (closest match); "cancel_order" = wants to cancel an order; "status" = asking where their order is; "repeat_last" = wants their usual / same as last time ("same as last time", "the usual", "نفس الطلب", "زي كل مرة", "nafs el order") — items stay null, we rebuild from their history.`;
      return chatJSON("gpt-4.1-mini", sys, input.message, { temperature: 0, maxTokens: 220 });
    }, { input: { message: input.message } });
    const e = ex.value || {};

    const outcome = await f.node("act", async () => {
      const name = diner?.name || diner?.wa_profile_name || null;
      // BRANCH: named in this message > their sticky branch. Every order belongs to ONE branch.
      const named = e.branch
        ? branches.find((b) => normName(b.name) === normName(e.branch)) ||
          branches.find((b) => normName(b.name).includes(normName(e.branch)) || normName(e.branch).includes(normName(b.name)))
        : null;
      let branch = named?.key || loaded.branch || null;
      if (named && diner?.id && named.key !== diner.preferred_branch) {
        // pre-migration safe: column may not exist yet
        await db.from("diners").update({ preferred_branch: named.key }).eq("id", diner.id).then(({ error }) => {
          if (error) console.log("preferred_branch not saved (run migration 006):", error.message);
        });
      }
      const branchInfo = branches.find((b) => b.key === branch) || null;

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
      let items = [];
      let unknown = [];
      let typeHint = null;
      if (e.intent === "repeat_last") {
        // rebuild from their real history at CURRENT prices; unavailable items are dropped honestly
        const { data: prev } = await db.from("orders").select("*")
          .eq("phone_number", ctx.sessionId).neq("status", "cancelled")
          .order("created_at", { ascending: false }).limit(1);
        const last = prev?.[0];
        if (!last?.items?.length) return { kind: "no_history" };
        for (const it of last.items) {
          const hit = loaded.menu.find((m) => normName(m.name) === normName(it.name));
          if (hit) items.push({ id: hit.id, name: hit.name, qty: Math.min(Number(it.qty) || 1, 20), price: Number(hit.price) });
          else unknown.push(it.name);
        }
        if (!items.length) return { kind: "no_history" };
        if (["pickup", "delivery"].includes(last.order_type)) typeHint = last.order_type; // dine-in table changes — always re-ask
      } else {
        const wanted = (e.items || []).slice(0, 12);
        if (!wanted.length && loaded.pending?.items?.length) {
          items = loaded.pending.items; // carry the in-progress order across turns
        } else if (!wanted.length) return { kind: "ask_items" };
        for (const w of wanted) {
          const n = normName(w.name);
          const hit = loaded.menu.find((m) => normName(m.name) === n) ||
                      loaded.menu.find((m) => normName(m.name).includes(n) || n.includes(normName(m.name)));
          if (!hit) { unknown.push(w.name); continue; }
          const qty = Math.min(Math.max(Math.round(Number(w.qty) || 1), 1), 20);
          items.push({ id: hit.id, name: hit.name, qty, price: Number(hit.price) });
        }
        if (!items.length && !loaded.pending?.items?.length) return { kind: "nothing_matched", unknown };
        if (!items.length) items = loaded.pending.items;
      }
      // carry order_type / table from the in-progress order too
      if (!e.order_type && loaded.pending?.order_type) e.order_type = loaded.pending.order_type;
      if (!e.table_number && loaded.pending?.table_number) e.table_number = loaded.pending.table_number;

      // delivery only if the restaurant actually offers it (config fact, never assumed)
      const deliveryOn = config.basic_info?.services?.delivery !== false;
      if (e.order_type === "delivery" && !deliveryOn) return { kind: "no_delivery", items };
      // dine-in must reference a real table
      let orderType = ["pickup", "delivery", "dine_in"].includes(e.order_type) ? e.order_type : typeHint;
      let tableNumber = null;
      if (e.table_number) {
        const t = String(e.table_number).toUpperCase().replace(/\s+/g, "");
        tableNumber = loaded.tableNumbers.find((x) => x === t || x === t.replace(/^TABLE/, "T")) || null;
        if (tableNumber) orderType = "dine_in";
        else if (orderType === "dine_in") return { kind: "bad_table", given: e.table_number, items };
      }
      // remember the in-progress order so the next short answer doesn't lose it
      const savePending = async (extra = {}) => {
        if (!diner?.id) return;
        const preferences = { ...(diner.preferences || {}), pending_order: { items, order_type: orderType, table_number: tableNumber, branch, at: new Date().toISOString(), ...extra } };
        await db.from("diners").update({ preferences }).eq("id", diner.id);
      };
      if (orderType === "dine_in" && !tableNumber) { await savePending(); return { kind: "ask_table", items }; }
      if (!orderType) { await savePending(); return { kind: "ask_order_type", items, subtotal: items.reduce((s, i) => s + i.price * i.qty, 0) }; }
      // multi-branch: an order MUST belong to a branch — ask before writing anything
      if (branches.length > 1 && !branch) {
        await savePending();
        return { kind: "ask_branch", items, branches: branches.map((b) => b.name), subtotal: items.reduce((s, i) => s + i.price * i.qty, 0) };
      }

      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
      const code = orderCode();
      const row = {
        code, phone_number: ctx.sessionId, diner_name: name,
        order_type: orderType, table_number: tableNumber, branch,
        items, subtotal, total: subtotal,
        status: "pending", payment_status: "unpaid",
        notes: [e.notes, e.pickup_time ? `pickup: ${e.pickup_time}` : null].filter(Boolean).join(" · ") || null,
      };
      let { error } = await db.from("orders").insert(row);
      if (error && branch) {
        // branch column missing (migration 006 not run) — the ticket still must reach the kitchen
        console.log("order insert with branch failed, retrying without:", error.message);
        const { branch: _b, ...noBranch } = row;
        ({ error } = await db.from("orders").insert({ ...noBranch, notes: [row.notes, `branch: ${branchInfo?.name || branch}`].filter(Boolean).join(" · ") }));
      }
      if (error) throw new Error(`order insert failed: ${error.message}`);
      if (diner?.id) { // order placed → the in-progress draft is done
        const { pending_order: _p, ...rest } = diner.preferences || {};
        await db.from("diners").update({ preferences: rest }).eq("id", diner.id);
      }
      await notifyDashboard(db, "order",
        `🍔 New ${orderType.replace("_", "-")} order ${code}${branchInfo ? ` — ${branchInfo.name}` : ""}`,
        `${name || ctx.sessionId}${tableNumber ? ` · table ${tableNumber}` : ""} — ${items.map((i) => `${i.qty}× ${i.name}`).join(", ")} · ${subtotal} ${currency}`,
        ctx.sessionId, branch);
      return { kind: "order_placed", code, order_type: orderType, table_number: tableNumber, branch: branchInfo?.name || null, items, subtotal, currency, unknown, notes: e.notes || null, pickup_time: e.pickup_time || null };
    }, { input: { intent: e.intent, items: (e.items || []).length, order_type: e.order_type, table: e.table_number } });

    const value = await f.node("phrase", async () => {
      const lang = classification?.language || "en";
      const sys = `You are ${config.ai?.name || "the host"} of ${config.name} (fast-casual) on WhatsApp. ONE short hype-but-clear reply for the OUTCOME (max 2 emojis). Mirror the guest's language & script (${lang}). Use ONLY facts in OUTCOME — never invent prices, times or payment links. Payment: at the counter / on pickup / to the courier — never online.
OUTCOMES:
- order_placed: confirm the ticket 🎫: list items (qty× name), TOTAL <subtotal> <currency>, the code, the BRANCH (if present), and what happens next (dine_in: "coming to table X" · pickup: "we'll ping you when ready" + their pickup_time if any · delivery: "heading to you"). If unknown[] has entries, add "couldn't find <names> on the menu".
- ask_branch: got their items — ask WHICH BRANCH they want it from, listing the branch names. quick_replies: the 3 most likely branch names.
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
- no_history: no past orders on this number yet — invite them to make their first one (it becomes their "usual").
Return JSON: {"reply": string, "quick_replies": string[]|null}`;
      return chatJSON("gpt-4.1-mini", sys, `OUTCOME: ${JSON.stringify(outcome)}\nGuest: ${input.message}`, { temperature: 0.5, maxTokens: 240 });
    }, { input: { outcome_kind: outcome.kind } });

    const fallback = {
      order_placed: `🎫 ${outcome.code}: ${outcome.items?.map((i) => `${i.qty}× ${i.name}`).join(", ")} — ${outcome.subtotal} ${currency}. We're on it!`,
      ask_items: "What are you craving? Tap the menu or just type it 🍔",
      ask_branch: `Which branch works for you? ${(outcome.branches || []).slice(0, 4).join(" · ")}`,
      ask_order_type: "Eating here (which table?), pickup, or delivery?",
      ask_table: "Which table are you at? The number's on the table 😄",
      no_open_order: "No active order found — want to start one? 🍔",
    };
    let reply = value.value?.reply || fallback[outcome.kind] || fallback.ask_items;
    // the ticket code is the guest's receipt — never let a confirmation go out without it
    if (outcome.kind === "order_placed" && outcome.code && !reply.includes(outcome.code)) {
      reply = `${reply} (order ${outcome.code})`;
    }
    return {
      reply,
      quickReplies: (value.value?.quick_replies || []).map((q) => String(q).slice(0, 20)).slice(0, 3),
      photos: [],
    };
  },
});

function publicOrder(o) {
  return { code: o.code, status: o.status, order_type: o.order_type, table_number: o.table_number, items: o.items, total: o.total };
}
