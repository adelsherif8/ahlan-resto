// ORDER agent (casual flagship) — chat ordering: pickup / delivery / dine-in by
// table number. LLM extracts items & phrases; CODE matches menu, prices, totals.
// v1: no payments in chat — pay at counter/courier (per FACTS). Kitchen board fed live.
import { defineFlow } from "../engine/flow.js";
import { chatJSON } from "../services/llm.js";
import { MODEL_SMART, MODEL_FAST, log } from "../config.js";
import { notifyDashboard } from "../services/chatlog.js";
import { nearestBranches, matchBranchByText, freshLocation, extractMapLink, resolveMapLink } from "../services/branches.js";
import { makeReceipt } from "../services/receipt.js";
import { menuPdfUrl } from "../services/menupdf.js";

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
{"intent": "order"|"repeat_last"|"confirm"|"cancel_order"|"status"|"other",
 "payment_method": "cash"|"card"|"instapay"|null,
 "items": [{"name": "<closest MENU name>", "qty": number, "notes": "<modifiers for THIS item, e.g. 'no onion', 'extra cheese', 'well done'>"|null}]|null,
 "order_type": "pickup"|"delivery"|"dine_in"|null (dine_in when they mention a table / being inside),
 "table_number": string|null ("t3"/"table 3" → "T3"),
 "pickup_time": string|null, "notes": string|null (sauce prefs, no onions, etc.),
 "address": "<the delivery address EXACTLY as the guest wrote it, verbatim>"|null,
 "branch": "<exact branch NAME from this list if the guest names one, else null>"}
BRANCHES: ${branches.map((b) => b.name).join(" | ") || "(single location)"}
Rules: qty defaults 1; ONLY names from MENU (closest match); an instruction about ONE item ("burger without onion") belongs in that item's "notes", NOT the order-level "notes"; "cancel_order" = wants to cancel an order; "status" = asking where their order is; "confirm" = agreeing to place the order we just summarised (yes/confirm/تمام/اوكي/go ahead); "repeat_last" = wants their usual / same as last time ("same as last time", "the usual", "نفس الطلب", "زي كل مرة", "nafs el order") — items stay null, we rebuild from their history.`;
      return chatJSON(MODEL_FAST, sys, input.message, { temperature: 0, maxTokens: 220 });
    }, { input: { message: input.message } });
    const e = ex.value || {};

    const outcome = await f.node("act", async () => {
      const name = diner?.name || diner?.wa_profile_name || null;
      // BRANCH: named in this message > their sticky branch. Every order belongs to ONE branch.
      const named = (e.branch
        ? branches.find((b) => normName(b.name) === normName(e.branch)) ||
          branches.find((b) => normName(b.name).includes(normName(e.branch)) || normName(e.branch).includes(normName(b.name)))
        : null) || matchBranchByText(branches, `${e.branch || ""} ${input.message}`);
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

      // ---- build the order — CODE matches every item against the real menu and prices it ----
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
          if (hit) items.push({ id: hit.id, name: hit.name, qty: Math.min(Number(it.qty) || 1, 20), price: Number(hit.price), notes: it.notes || null, choices: it.choices || {} });
          else unknown.push(it.name);
        }
        if (!items.length) return { kind: "no_history" };
        if (["pickup", "delivery"].includes(last.order_type)) typeHint = last.order_type; // dine-in table changes — always re-ask
      } else {
        const wanted = (e.items || []).slice(0, 12);
        for (const w of wanted) {
          const n = normName(w.name);
          const hit = loaded.menu.find((m) => normName(m.name) === n) ||
                      loaded.menu.find((m) => normName(m.name).includes(n) || n.includes(normName(m.name)));
          if (!hit) { unknown.push(w.name); continue; }
          const qty = Math.min(Math.max(Math.round(Number(w.qty) || 1), 1), 20);
          // "no onion", "extra sauce" ride WITH the item so the kitchen sees them on the line
          items.push({ id: hit.id, name: hit.name, qty, price: Number(hit.price), notes: (w.notes || "").trim() || null, choices: {} });
        }
        // Answering "which drink?" — the extractor matches "sprite" to the menu, but it's
        // this combo's drink, not a second line item. Keep the order, drop the duplicate.
        const aw = loaded.pending?.awaiting_choice;
        if (aw && loaded.pending?.items?.length && items.length) {
          const def = comboSetup(config).choices.find((c) => c.label === aw.label);
          const opts = def ? loaded.menu.filter((m) => def.re.test(String(m.category || ""))).map((m) => m.name) : [];
          if (items.every((it) => opts.some((o) => normName(o) === normName(it.name)))) {
            items = loaded.pending.items;
            unknown = [];
          }
        }
        // nothing new — carry the in-progress order across turns
        if (!items.length && loaded.pending?.items?.length) { items = loaded.pending.items; unknown = []; }
      }

      // carry anything already agreed this session
      if (!e.order_type && loaded.pending?.order_type) e.order_type = loaded.pending.order_type;
      if (!e.table_number && loaded.pending?.table_number) e.table_number = loaded.pending.table_number;

      const deliveryOn = config.basic_info?.services?.delivery !== false;
      if (e.order_type === "delivery" && !deliveryOn) return { kind: "no_delivery", items };

      let orderType = ["pickup", "delivery", "dine_in"].includes(e.order_type) ? e.order_type : typeHint;
      // naming a table IS dining in — don't ask them how they're eating when they
      // already told us where they're sitting
      if (!orderType && e.table_number) orderType = "dine_in";
      // a bare "23" right after we asked for the table IS the answer, even though the
      // extractor won't call a lone number a table number
      let givenTable = e.table_number;
      if (!givenTable && orderType === "dine_in" && !loaded.pending?.table_number && /^[a-z]{0,3}\s?\d{1,3}$/i.test(input.message.trim())) {
        givenTable = input.message.trim();
      }
      let tableNumber = null;
      if (givenTable) {
        const t = String(givenTable).toUpperCase().replace(/\s+/g, "").replace(/^TABLE/, "");
        tableNumber = loaded.tableNumbers.find((x) => x === t || x === `T${t}`) || null;
        if (tableNumber) orderType = "dine_in";
        else if (orderType === "dine_in") return { kind: "bad_table", given: givenTable, items, tables: loaded.tableNumbers.slice(0, 12) };
      }
      // DELIVERY ADDRESS: keep the guest's own words verbatim + any map link (coords resolved)
      const mapLinkRaw = extractMapLink(input.message) || loaded.pending?.map_link || null;
      const mapLink = mapLinkRaw ? await resolveMapLink(mapLinkRaw) : null;
      // addresses they've used before — offered back instead of made to retype
      const saved = savedAddresses(diner);
      let address = (e.address && String(e.address).trim()) || loaded.pending?.address || null;
      // they tapped/typed one of their saved ones (WhatsApp truncates button titles,
      // so a prefix counts) or said "same as last time" with only one on file
      const reuse = matchSaved(input.message, saved) ||
        (saved.length === 1 && /\b(same|usual|نفس|زي كل مرة)\b/i.test(input.message) ? saved[0] : null);
      if (reuse && !loaded.pending?.address) address = reuse.text;
      const sharedPin = freshLocation(diner, 1);

      // remember the in-progress order so the next short answer doesn't lose it
      const savePending = async (extra = {}) => {
        if (!diner?.id) return;
        const preferences = { ...(diner.preferences || {}), pending_order: { items, order_type: orderType, table_number: tableNumber, branch, address, map_link: mapLinkRaw, at: new Date().toISOString(), ...extra } };
        await db.from("diners").update({ preferences }).eq("id", diner.id);
      };

      // ================= GATES, in the order a cashier actually asks =================
      // While gathering, echo back what's already on the order so the guest can see
      // it building. Item lines and a subtotal only — the TOTAL isn't knowable until
      // the type settles which charges apply, and quoting one early would be a lie.
      const running = items.length ? { items, subtotal: items.reduce((s, i) => s + i.price * i.qty, 0), currency } : null;

      // 1) HOW they're eating — this decides the whole rest of the conversation
      if (!orderType) {
        await savePending();
        return { kind: "ask_order_type", items, running, delivery: deliveryOn };
      }
      // 2) WHERE — table / address / branch, all resolved before we take a single item
      if (orderType === "dine_in" && !tableNumber) {
        await savePending();
        return { kind: "ask_table", items, running, tables: loaded.tableNumbers.slice(0, 12) };
      }
      if (orderType === "delivery" && !address && !mapLink && !sharedPin) {
        await savePending({ address, map_link: mapLinkRaw });
        return { kind: "ask_address", items, running, saved: saved.map((s) => s.text) };
      }
      if (branches.length > 1 && !branch) {
        await savePending();
        // if they shared their location, lead with the closest branch (code-computed)
        const loc = freshLocation(diner);
        const near = loc ? nearestBranches(branches, loc.lat, loc.lng, 3).map((b) => `${b.name} (${b.km} km)`) : null;
        return { kind: "ask_branch", items, running, branches: branches.map((b) => b.name), nearest: near };
      }
      // 3) WHAT — now the menu means something, because we know where it's going
      if (!items.length) return unknown.length ? { kind: "nothing_matched", unknown } : { kind: "ask_items" };

      // 4) COMBO CHOICES — a meal isn't an order until the drink/side is picked
      const choice = resolveChoices(items, loaded.menu, config, input.message, loaded.pending);
      if (choice.ask) {
        items = choice.items;
        await savePending({ awaiting_choice: choice.ask });
        return { kind: "ask_choice", items, item: choice.ask.item, label: choice.ask.label, options: choice.ask.options };
      }
      items = choice.items;

      // 5) MONEY — computed here, never by the model
      const bill = priceOrder(items, config, orderType);

      // 6) PAYMENT METHOD — required before we take the order
      const payMethods = orderType === "dine_in" ? ["cash at the cashier", "card at the cashier", "online link"]
        : orderType === "pickup" ? ["cash at the counter", "card", "instapay"]
        : ["cash on delivery", "card", "instapay"];
      const payment = ["cash", "card", "instapay"].includes(String(e.payment_method || "").toLowerCase())
        ? String(e.payment_method).toLowerCase()
        : loaded.pending?.payment_method || null;
      if (!payment) {
        await savePending({ address, map_link: mapLinkRaw });
        return { kind: "ask_payment", items, bill, currency, methods: payMethods, branch: branchInfo?.name || null, order_type: orderType, address, table_number: tableNumber };
      }

      // 7) CONFIRM — the guest sees the full bill and says yes before anything is written.
      // Only a yes to a bill WE actually showed counts: the extractor reads "cash" as
      // intent=confirm, which would otherwise place the order the moment they pick a
      // payment method, before they've ever seen a total.
      const confirmed = loaded.pending?.awaiting_confirm === true && e.intent === "confirm";
      if (!confirmed) {
        await savePending({ address, map_link: mapLinkRaw, payment_method: payment, awaiting_confirm: true });
        return {
          kind: "confirm_order", items, bill, currency, payment,
          branch: branchInfo?.name || null, order_type: orderType, table_number: tableNumber, address,
        };
      }
      const subtotal = bill.subtotal;

      const code = orderCode();
      const row = {
        code, phone_number: ctx.sessionId, diner_name: name,
        order_type: orderType, table_number: tableNumber, branch,
        // the charge breakdown lands in its own columns, so reporting can read it
        // without re-deriving anything from the total
        items, subtotal, service_charge: bill.service_charge, tax: bill.tax, total: bill.total,
        address: orderType === "delivery" ? address : null,
        map_link: mapLink?.url || null,
        lat: mapLink?.lat ?? (orderType === "delivery" ? sharedPin?.lat ?? null : null),
        lng: mapLink?.lng ?? (orderType === "delivery" ? sharedPin?.lng ?? null : null),
        payment_method: payment,
        status: "pending", payment_status: payment === "cash" ? "unpaid" : "pending",
        notes: [e.notes, e.pickup_time ? `pickup: ${e.pickup_time}` : null].filter(Boolean).join(" · ") || null,
      };
      let { error } = await db.from("orders").insert(row);
      if (error && branch) {
        // branch column missing (migration 006 not run) — the ticket still must reach the kitchen
        console.log("order insert with branch failed, retrying without:", error.message);
        const { branch: _b, address: _a, map_link: _m, lat: _lat, lng: _lng, payment_method: _pm, ...bare } = row;
        ({ error } = await db.from("orders").insert({
          ...bare,
          notes: [row.notes, `branch: ${branchInfo?.name || branch}`, `pay: ${payment}`, address ? `address: ${address}` : null, mapLink?.url ? `map: ${mapLink.url}` : null]
            .filter(Boolean).join(" · "),
        }));
      }
      if (error) throw new Error(`order insert failed: ${error.message}`);
      if (diner?.id) { // order placed → the in-progress draft is done
        const { pending_order: _p, ...rest } = diner.preferences || {};
        // remember where they had it sent, so next time we offer instead of ask
        if (orderType === "delivery" && address) {
          const kept = (rest.addresses || []).filter((a) => normName(a.text) !== normName(address));
          rest.addresses = [{ text: address, map_link: mapLink?.url || null, last_used: new Date().toISOString() }, ...kept].slice(0, 3);
        }
        await db.from("diners").update({ preferences: rest }).eq("id", diner.id);
      }
      const receiptUrl = await makeReceipt(db, {
        restaurant: config.name,
        order: { ...row, bill, created_at: new Date().toISOString() },
        branch: branchInfo, currency,
      });
      if (receiptUrl) await db.from("orders").update({ receipt_url: receiptUrl }).eq("code", code).then(() => {}, () => {});
      await notifyDashboard(db, "order",
        `🍔 New ${orderType.replace("_", "-")} order ${code}${branchInfo ? ` — ${branchInfo.name}` : ""}`,
        `${name || ctx.sessionId}${tableNumber ? ` · table ${tableNumber}` : ""}${address ? ` · 📍 ${address}` : ""} — ${items.map((i) => `${i.qty}× ${i.name}${i.notes ? ` (${i.notes})` : ""}${Object.values(i.choices || {}).length ? ` [${Object.values(i.choices).join(", ")}]` : ""}`).join(", ")} · ${bill.total} ${currency}`,
        ctx.sessionId, branch);
      return { kind: "order_placed", code, order_type: orderType, table_number: tableNumber, branch: branchInfo?.name || null, address: orderType === "delivery" ? address : null, map_link: mapLink?.url || null, payment, receipt_url: receiptUrl, items, bill, currency, unknown, notes: e.notes || null, pickup_time: e.pickup_time || null };
    }, { input: { intent: e.intent, items: (e.items || []).length, order_type: e.order_type, table: e.table_number } });

    const value = await f.node("phrase", async () => {
      const lang = classification?.language || "en";
      const sys = `You are ${config.ai?.name || "the host"} of ${config.name} (fast-casual) on WhatsApp, taking an order like a sharp cashier at the counter. ONE short reply for the OUTCOME (max 2 emojis). Mirror the guest's language & script (${lang}). Use ONLY facts in OUTCOME.
MONEY RULE (absolute): NEVER write a price, a total, a currency symbol or any number of money. The itemised bill is attached below your reply automatically. Refer to it as "below" — do not restate it, do not invent a currency.
OUTCOMES:
- order_placed: confirm the ticket 🎫 with the CODE and what happens next BY TYPE — dine_in: "the kitchen's on it, coming to table X" · pickup: "we'll message you the moment it's ready at <branch>" · delivery: "we'll message you when it's on its way to <address>". Say the receipt is attached if receipt_url exists. If unknown[] has entries, add "couldn't find <names> on the menu".
- ask_branch: ask WHICH BRANCH. If "nearest" is present, lead with those (they shared their location; include the km) and offer the full list; otherwise list the branch names and offer that they can share their location 📍 for the closest. quick_replies: the 3 most likely branch names.
- ask_choice: they ordered <item>, which comes with a <label>. Ask which one they want, the way a cashier does ("and what do you want to drink with it?"), and LIST the options given — those are the only ones we stock. quick_replies: the 3 most popular options.
- ask_payment: one line asking how they'd like to pay, listing ONLY the methods given. The bill is below. quick_replies: the methods (e.g. ["Cash","Card","InstaPay"]).
- confirm_order: one line asking them to confirm before it goes to the kitchen. The full bill is below. quick_replies: ["Confirm ✅","Change something"].
- ask_address: if saved[] has addresses, DON'T make them retype — read their saved address(es) back and ask if it's going there or somewhere new. Otherwise ask for the address: they can type it out or paste a Google Maps link 🔗. Never say "pin". quick_replies: each saved address (shortened), then "New address".
- ask_items: the full menu PDF is attached automatically — say it's below/attached and ask what they'd like. NEVER ask "what would you like?" on its own as if they can already see the menu.
- ask_order_type: FIRST question of every order — are they eating in, picking up, or want delivery? (omit delivery if delivery is false). If "running" is present their items are listed under your reply automatically, so acknowledge what they picked; if it is absent, promise NOTHING about a bill or a list — there is nothing attached yet. quick_replies: ["Dine-in","Pickup","Delivery"] as applicable.
- ask_table: which table are they at? If "tables" is given, show 2-3 of them as examples so they know the format. NEVER say the order is placed or that the kitchen has it — nothing has been sent yet.
- bad_table: the number they gave isn't one of ours. Say so plainly, list the real ones from "tables", and ask which they're at. NEVER claim the order is placed.
- nothing_matched: none of that matched the menu (list unknown) — suggest tapping the menu.
- order_status: restate their order (code, status, items) honestly by status: pending/accepted="in the queue", preparing="on the grill now", ready="READY — come grab it!".
- order_cancelled: cancelled ✅, no charge, door's open.
- too_late_to_cancel: it's already READY — can't cancel now; the team can help at the counter.
- no_open_order: no active order found — want to start one?
- no_delivery: we don't do delivery — pickup or dine-in works great though.
- no_history: no past orders on this number yet — invite them to make their first one (it becomes their "usual").
Return JSON: {"reply": string, "quick_replies": string[]|null}`;
      return chatJSON(MODEL_SMART, sys, `OUTCOME: ${JSON.stringify(outcome)}\nGuest: ${input.message}`, { temperature: 0.5, maxTokens: 240 });
    }, { input: { outcome_kind: outcome.kind } });

    const fallback = {
      order_placed: `🎫 Order ${outcome.code} is in — we're on it!`,
      ask_items: "Here's the full menu 📄 — tell me what you'd like and I'll get it going 🍔",
      nothing_matched: `Couldn't find ${(outcome.unknown || []).join(", ")} on the menu — here it is 📄, pick anything off it.`,
      no_history: "No past orders on this number yet — here's the menu 📄, let's make your first one 🍔",
      ask_branch: `Which branch works for you? ${(outcome.branches || []).slice(0, 4).join(" · ")}`,
      ask_choice: `And what ${outcome.label} do you want with the ${outcome.item}? We've got ${(outcome.options || []).slice(0, 6).join(" · ")}`,
      ask_address: (outcome.saved || []).length
        ? `Sending it to ${outcome.saved[0]} again, or somewhere else?`
        : "What's the delivery address? Type it out or paste your Google Maps link 🔗",
      ask_payment: `How would you like to pay: ${(outcome.methods || []).join(" / ")}?`,
      confirm_order: "All set — confirm and I'll send it to the kitchen ✅",
      ask_order_type: `Eating in, picking up${outcome.delivery === false ? "" : ", or delivery"}?`,
      ask_table: `Which table are you at? The number's printed on it${(outcome.tables || []).length ? ` — they look like ${outcome.tables.slice(0, 3).join(", ")}` : ""} 😄`,
      bad_table: `I can't find table ${outcome.given} — ours are ${(outcome.tables || []).slice(0, 8).join(", ")}. Which one are you at?`,
      no_open_order: "No active order found — want to start one? 🍔",
    };
    let reply = value.value?.reply || fallback[outcome.kind] || fallback.ask_items;

    // ZERO-HALLUCINATION BACKSTOP: only an outcome that actually wrote a ticket may
    // say so. The model has claimed "the kitchen's on it" while we were still asking
    // which table — the guest then waits for food nobody is cooking. Code decides
    // whether an order exists, so code gets the final say on the claim.
    if (!["order_placed", "confirm_order"].includes(outcome.kind)) {
      const PLACED = /kitchen'?s on it|order (is )?(placed|confirmed|in|on its way)|sending it to the kitchen|on the grill|we'?re on it|preparing (it|your)|coming to (your )?table|be ready in|طلبك (اتسجل|في المطبخ|جاهز)/i;
      if (PLACED.test(reply)) {
        log(`order: blocked a false "placed" claim on outcome ${outcome.kind}`);
        reply = fallback[outcome.kind] || fallback.ask_items;
      }
    }

    // Mid-gather: show the lines and a subtotal, never a TOTAL we can't stand behind yet.
    if (outcome.running?.items?.length) {
      const money = (n) => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
      const lines = outcome.running.items.map((it) => {
        const mods = [...Object.entries(it.choices || {}).map(([k, v]) => `${k}: ${v}`), it.notes || null].filter(Boolean);
        return `• ${it.qty}× ${it.name} — ${money(it.price * it.qty)}${mods.length ? `\n   ↳ ${mods.join(" · ")}` : ""}`;
      });
      reply = `${reply}\n\n🧾 ${lines.join("\n")}\nSubtotal: ${money(outcome.running.subtotal)}`;
    }

    // The bill is rendered by CODE and appended — the model never writes a number.
    // A model that ignored the money rule anyway gets its stray totals dropped here.
    if (outcome.bill && ["ask_payment", "confirm_order", "order_placed"].includes(outcome.kind)) {
      reply = reply
        .split("\n")
        .filter((l) => !/(total|subtotal|إجمالي|المجموع)\s*[:=]/i.test(l))
        .join("\n")
        .trim();
      reply = `${reply}\n\n${renderBill({
        items: outcome.items || [],
        bill: outcome.bill,
        currency,
        orderType: outcome.order_type,
        tableNumber: outcome.table_number,
        branchName: outcome.branch,
        address: outcome.address,
        payment: outcome.payment,
      })}`;
    }
    // the ticket code is the guest's receipt — never let a confirmation go out without it
    if (outcome.kind === "order_placed" && outcome.code && !reply.includes(outcome.code)) {
      reply = `${reply} (order ${outcome.code})`;
    }
    // whenever we're asking them to pick, the menu PDF must be in the same breath
    const NEEDS_MENU = ["ask_items", "nothing_matched", "no_history"];
    let doc = null;
    if (outcome.kind === "order_placed" && outcome.receipt_url) {
      doc = { url: outcome.receipt_url, caption: `Receipt ${outcome.code}`, filename: `${outcome.code}.pdf` };
    } else if (NEEDS_MENU.includes(outcome.kind)) {
      const mc = config.menu_config || {};
      const pdf = mc.pdf_url
        ? { url: mc.pdf_url, filename: "menu.pdf" }
        : await menuPdfUrl(db, {
            restaurant: config.name,
            menu: loaded.menu,
            currency,
            accent: config.basic_info?.brand?.primary || "#111111",
            tagline: config.basic_info?.tagline || "",
            phone: config.basic_info?.phone || "",
            website: config.basic_info?.website || "",
          });
      if (pdf) {
        doc = { url: pdf.url, caption: `${config.name} — full menu 📄`, filename: pdf.filename };
        reply = `${reply}\n\n📄 ${pdf.url}`;
      }
    }

    return {
      reply,
      // the menu / receipt PDF rides along as a WhatsApp document
      menuDoc: doc,
      quickReplies: (value.value?.quick_replies || []).map((q) => String(q).slice(0, 20)).slice(0, 3),
      photos: [],
    };
  },
});

function publicOrder(o) {
  return { code: o.code, status: o.status, order_type: o.order_type, table_number: o.table_number, items: o.items, total: o.total };
}

// Delivery addresses the guest has actually used before, newest first.
function savedAddresses(diner) {
  return (diner?.preferences?.addresses || [])
    .filter((a) => a && typeof a.text === "string" && a.text.trim())
    .slice(0, 3);
}

// WhatsApp truncates button titles, so an answer that is a PREFIX of a saved
// address still means that address.
function matchSaved(message, saved) {
  const m = normName(message);
  if (m.length < 4) return null;
  return saved.find((a) => {
    const t = normName(a.text);
    return t === m || t.startsWith(m) || m.startsWith(t);
  }) || null;
}

// ---------------------------------------------------------------------------
// Combo choices — a "meal" comes with a drink (and whatever else the restaurant
// configures). Options are read off the real menu, so we can never offer a drink
// we don't stock. Config: menu_config.combo = { match, choices:[{label, category_match}] }
// ---------------------------------------------------------------------------
function comboSetup(config) {
  const cfg = config.menu_config?.combo || {};
  const match = new RegExp(cfg.match || "\\b(meal|combo|bundle)\\b", "i");
  const choices = (cfg.choices?.length ? cfg.choices : [{ label: "drink", category_match: "drink|beverage|مشروب" }])
    .map((c) => ({ label: c.label || "drink", re: new RegExp(c.category_match || c.label || "drink", "i") }));
  return { match, choices };
}

function resolveChoices(items, menu, config, message, pending) {
  const { match, choices } = comboSetup(config);
  const optionsFor = (def) => menu.filter((m) => def.re.test(String(m.category || ""))).map((m) => m.name);
  const out = items.map((it) => ({ ...it, choices: { ...(it.choices || {}) } }));

  // Did this message answer the question we asked last turn? Then it's that combo's
  // drink — NOT a new line item the guest has to pay for twice.
  const awaiting = pending?.awaiting_choice;
  if (awaiting && out[awaiting.index]) {
    const def = choices.find((c) => c.label === awaiting.label);
    const picked = def && optionsFor(def).find((o) => normName(message).includes(normName(o)));
    if (picked) out[awaiting.index].choices[awaiting.label] = picked;
  }

  for (let i = 0; i < out.length; i++) {
    if (!match.test(out[i].name)) continue;
    for (const def of choices) {
      if (out[i].choices[def.label]) continue;
      const options = optionsFor(def);
      if (!options.length) continue; // nothing to offer — don't ask a dead question
      return { items: out, ask: { index: i, label: def.label, item: out[i].name, options: options.slice(0, 12) } };
    }
  }
  return { items: out, ask: null };
}

// ---------------------------------------------------------------------------
// Money — computed in code, always. Only charges the restaurant actually
// configured appear; an unset fee is absent, never guessed at.
// ---------------------------------------------------------------------------
function priceOrder(items, config, orderType) {
  const p = config.payments || {};
  const round = (n) => Math.round(n * 100) / 100;
  const subtotal = round(items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0));

  const extras = [];
  // configs in the wild write these either as a fraction (0.14) or a percentage (14) —
  // accept both rather than silently charging nothing, or charging 100x
  const rateOf = (...keys) => {
    for (const k of keys) {
      const v = Number(p[k]);
      if (Number.isFinite(v) && v > 0) return v > 1 ? v / 100 : v;
    }
    return 0;
  };
  const charge = (label, rate) => {
    if (rate <= 0) return 0;
    const amount = round(subtotal * rate);
    extras.push({ label: `${label} (${Math.round(rate * 1000) / 10}%)`, amount });
    return amount;
  };
  // service charge is a dine-in convention — never added to a delivery or pickup bill
  const service_charge = orderType === "dine_in" ? charge("Service", rateOf("service_charge", "service_charge_pct")) : 0;
  const tax = charge("VAT", rateOf("tax", "tax_pct", "vat_pct"));
  const delivery_fee = orderType === "delivery" ? round(Number(p.delivery_fee) || 0) : 0;
  if (delivery_fee > 0) extras.push({ label: "Delivery", amount: delivery_fee });

  const total = round(subtotal + extras.reduce((s, x) => s + x.amount, 0));
  return { subtotal, extras, service_charge, tax, delivery_fee, total };
}

// The bill as the guest sees it. Built here so the model never writes a number
// or a currency symbol — it phrases around this block, it doesn't compose it.
function renderBill({ items, bill, currency, orderType, tableNumber, branchName, address, payment }) {
  const money = (n) => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
  const lines = items.map((it) => {
    const mods = [
      ...Object.entries(it.choices || {}).map(([k, v]) => `${k}: ${v}`),
      it.notes || null,
    ].filter(Boolean);
    return `• ${it.qty}× ${it.name} — ${money(Number(it.price) * Number(it.qty))}` +
      (mods.length ? `\n   ↳ ${mods.join(" · ")}` : "");
  });

  const totals = [`Subtotal: ${money(bill.subtotal)}`];
  for (const x of bill.extras) totals.push(`${x.label}: ${money(x.amount)}`);
  totals.push(`*TOTAL: ${money(bill.total)}*`);

  const where = orderType === "dine_in" ? `Dine-in · table ${tableNumber}`
    : orderType === "pickup" ? `Pickup${branchName ? ` · ${branchName}` : ""}`
    : `Delivery${branchName ? ` · from ${branchName}` : ""}`;

  return [
    "🧾 *YOUR ORDER*",
    lines.join("\n"),
    "————————————",
    totals.join("\n"),
    "————————————",
    where,
    orderType === "delivery" && address ? `📍 ${address}` : null,
    payment ? `💳 ${payment === "cash" ? "Cash" : payment === "card" ? "Card" : "InstaPay"}` : null,
  ].filter(Boolean).join("\n");
}
