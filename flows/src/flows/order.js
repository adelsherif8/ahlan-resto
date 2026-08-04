// ORDER agent (casual flagship) — chat ordering: pickup / delivery / dine-in by
// table number. LLM extracts items & phrases; CODE matches menu, prices, totals.
// v1: no payments in chat — pay at counter/courier (per FACTS). Kitchen board fed live.
import { defineFlow } from "../engine/flow.js";
import { chatJSON } from "../services/llm.js";
import { MODEL_SMART, MODEL_FAST, PUBLIC_BASE, log } from "../config.js";
import { notifyDashboard } from "../services/chatlog.js";
import { nearestBranches, matchBranchByText, freshLocation, extractMapLink, resolveMapLink } from "../services/branches.js";
import { getMenu } from "../services/menucache.js";
import { fmtMoney } from "../services/format.js";
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
      const menuRows = await getMenu(db);
      const today_ = new Date().toISOString().slice(0, 10);
      // 86'd-for-today items stay matchable so we can say "sold out today" honestly
      // instead of pretending they don't exist; hard-disabled items don't exist
      const soldOutToday = new Set((menuRows || []).filter((m) => m.available && m.sold_out_until && String(m.sold_out_until).slice(0, 10) >= today_).map((m) => m.name));
      const menu = (menuRows || []).filter((m) => m.available && !soldOutToday.has(m.name));
      const { data: open } = await db.from("orders").select("*")
        .eq("phone_number", ctx.sessionId)
        .in("status", ["pending", "accepted", "preparing", "ready"])
        .order("created_at", { ascending: false }).limit(1);
      const { data: tables } = await db.from("restaurant_tables").select("table_number");
      // an order in progress across turns (guest answered "Maadi" to our branch question)
      const p = diner?.preferences?.pending_order;
      const pending = p && Date.now() - new Date(p.at || 0).getTime() < 120 * 60_000 ? p : null;
      return {
        menu, soldOutToday, openOrder: open?.[0] || null,
        tableNumbers: (tables || []).map((t) => String(t.table_number).toUpperCase()),
        // sticky only within the CURRENT draft — every new order asks the branch
        // again (guests of a 9-branch chain move around); their usual is a hint,
        // not a silent decision
        branch: pending?.branch || null,
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
 "branch": "<exact branch NAME from this list if the guest names one, else null>",
 "edits": [{"op": "add"|"remove"|"set_qty", "item": "<closest MENU name>", "qty": number|null}]|null}
BRANCHES: ${branches.map((b) => b.name).join(" | ") || "(single location)"}
Rules: qty defaults 1; ONLY names from MENU (closest match); an instruction about ONE item ("burger without onion") belongs in that item's "notes", NOT the order-level "notes"; "edits" is for CHANGING an order being built — "add a coke"/"زود كوكاكولا" → op add, "remove the fries"/"شيل البطاطس" → op remove, "make it 2"/"خليهم ٢"/"actually just one" → op set_qty with qty (when they change something, use edits and leave "items" null); "cancel_order" = wants to cancel an order; "status" = asking where their order is; "confirm" = agreeing to place the order we just summarised (yes/confirm/تمام/اوكي/go ahead); "repeat_last" = wants their usual / same as last time ("same as last time", "the usual", "نفس الطلب", "زي كل مرة", "nafs el order") — items stay null, we rebuild from their history.`;
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
      // "usual"/"same branch" resolves to their remembered branch without retyping it
      const usualKey = branches.some((b) => b.key === diner?.preferred_branch) ? diner.preferred_branch : null;
      const askedUsual = usualKey && /\b(usual|same branch|نفس الفرع)\b/i.test(input.message) ? usualKey : null;
      let branch = named?.key || askedUsual || loaded.branch || null;
      if (named && diner?.id && named.key !== diner.preferred_branch) {
        // pre-migration safe: column may not exist yet
        await db.from("diners").update({ preferred_branch: named.key }).eq("id", diner.id).then(({ error }) => {
          if (error) console.log("preferred_branch not saved (run migration 006):", error.message);
        });
      }
      let branchInfo = branches.find((b) => b.key === branch) || null;

      if (e.intent === "cancel_order") {
        if (!loaded.openOrder) return { kind: "no_open_order" };
        if (["ready"].includes(loaded.openOrder.status)) return { kind: "too_late_to_cancel", order: publicOrder(loaded.openOrder) };
        await db.from("orders").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", loaded.openOrder.id);
        if (diner?.id && loaded.openOrder.status !== "cancelled") {
          // cancellation reverses the CRM bump the placement made
          await db.from("diners").update({
            total_spend: Math.max(0, Math.round(((Number(diner.total_spend) || 0) - Number(loaded.openOrder.total || 0)) * 100) / 100),
            visit_count: Math.max(0, (Number(diner.visit_count) || 0) - 1),
          }).eq("id", diner.id);
        }
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
          if (hit) items.push({ id: hit.id, name: hit.name, qty: Math.min(Number(it.qty) || 1, 20), price: Number(hit.price), notes: it.notes || null, options: it.options || {}, option_defs: hit.options || [] });
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
          items.push({ id: hit.id, name: hit.name, qty, price: Number(hit.price), notes: (w.notes || "").trim() || null, options: {}, option_defs: hit.options || [] });
        }
        // Mid-order, a SHORT reply is an answer to our question — never a new order.
        // The extractor happily matches "French fries" or "sprite" to a menu item;
        // letting that through replaces the burger being configured with a side.
        // The two mid-order intents that ARE new information get handled in code,
        // because the extractor is not reliable enough to carry them:
        //   "add a loaded fries"  → append (add-verb + an item not on the draft)
        //   "make it just 1"      → qty change (same item, different qty, or the
        //                            bare deterministic form below)
        const ADD_VERB = /\b(add|also|kaman|zawe?d|زود|كمان|ضيف|وهات)\b/i;
        // a draft older than 20 min is an abandoned session, not the context for
        // this message — a fresh "2 iconic meals" then REPLACES it instead of
        // being swallowed by "how would you like to pay?" about old food
        const draftAgeMs = Date.now() - new Date(loaded.pending?.at || 0).getTime();
        const draftStale = draftAgeMs > 20 * 60_000;
        if (loaded.pending?.items?.length && input.message.trim().length <= 28 && items.length && !e.edits?.length && !draftStale) {
          const prev = loaded.pending.items;
          if (items.length === 1 && !loaded.pending.awaiting_option) {
            const line = prev.find((it) => normName(it.name) === normName(items[0].name));
            if (line && Number(items[0].qty) !== Number(line.qty) && /\d|one|two|three|واحد|اتنين|٢|١/i.test(input.message)) {
              line.qty = items[0].qty;
            } else if (!line && (ADD_VERB.test(input.message) || /^\s*\d/.test(input.message))) {
              // "add a loaded fries" OR a leading quantity ("2 cokes") — both are
              // genuine additions, not answers to an open question
              prev.push(items[0]);
            }
          }
          items = prev;
          unknown = [];
        }
        // a stale draft being replaced by fresh items must not leak its old
        // answers (an "options" pointer at a different item, a 2-hour-old "cash")
        if (draftStale && items.length && loaded.pending) {
          loaded.pending = { ...loaded.pending, items: [], awaiting_option: null, awaiting_confirm: null, payment_method: null };
        }
        // Bare "make it just 1" with a single-line draft — no model needed at all.
        if (loaded.pending?.items?.length === 1 && !items.length && !e.edits?.length) {
          const m = input.message.trim().match(/^(?:actually |طب |khalas )?(?:make (?:it|them) |خلي(?:ه|هم)? |khaleeh?m? )?(?:just |بس |bs )?(\d+|one|two|three|واحد|١|اتنين|٢|تلاتة|٣)\W*$/i);
          if (m) {
            const WORDS = { one: 1, two: 2, three: 3, "واحد": 1, "١": 1, "اتنين": 2, "٢": 2, "تلاتة": 3, "٣": 3 };
            const q = WORDS[m[1].toLowerCase()] ?? Number(m[1]);
            if (q >= 1 && q <= 20) {
              items = loaded.pending.items;
              items[0].qty = q;
              unknown = [];
            }
          }
        }
        // We asked a question about ONE item, so this turn belongs to that item.
        // Whatever the extractor matched ("sprite" when we asked sandwich-or-meal)
        // is an attempted answer, never a replacement for the order in progress —
        // letting it through drops the burger and leaves a lone drink.
        if (loaded.pending?.awaiting_option && loaded.pending?.items?.length && !e.edits?.length) {
          items = loaded.pending.items;
          unknown = [];
        }
        // nothing new — carry the in-progress order across turns
        if (!items.length && loaded.pending?.items?.length) { items = loaded.pending.items; unknown = []; }

        // ---- EDITS: "add a coke" / "remove the fries" / "make it 2" ----
        // Applied by CODE against the order being built, so changing your mind is a
        // guarantee, not a matter of extraction luck. Edits always operate on the
        // DRAFT — if the extractor also echoed items, they'd otherwise replace it.
        if (e.edits?.length && loaded.pending?.items?.length) {
          items = loaded.pending.items;
          unknown = [];
        }
        for (const ed of (e.edits || []).slice(0, 6)) {
          const target = normName(ed.item || "");
          // "make it just 1" names no item — with a single-line draft there is
          // exactly one thing it can mean, so resolve it in code
          if (!target && ed.op !== "add" && items.length === 1) {
            if (ed.op === "remove") { items.splice(0, 1); continue; }
            if (ed.op === "set_qty") { items[0].qty = Math.min(Math.max(Math.round(Number(ed.qty) || 1), 1), 20); continue; }
          }
          if (!target) continue;
          if (ed.op === "add") {
            const hit = loaded.menu.find((m) => normName(m.name) === target) ||
                        loaded.menu.find((m) => normName(m.name).includes(target) || target.includes(normName(m.name)));
            if (!hit) { unknown.push(ed.item); continue; }
            const q = Math.min(Math.max(Math.round(Number(ed.qty) || 1), 1), 20);
            const existing = items.find((it) => it.id === hit.id && !Object.keys(it.options || {}).length);
            if (existing) existing.qty = Math.min(existing.qty + q, 20);
            else items.push({ id: hit.id, name: hit.name, qty: q, price: Number(hit.price), notes: null, options: {}, option_defs: hit.options || [] });
          } else {
            const idx = items.findIndex((it) => normName(it.name).includes(target) || target.includes(normName(it.name)));
            if (idx < 0) continue;
            if (ed.op === "remove") items.splice(idx, 1);
            else if (ed.op === "set_qty") items[idx].qty = Math.min(Math.max(Math.round(Number(ed.qty) || 1), 1), 20);
          }
        }
        if (e.edits?.length && !items.length) {
          // they removed everything — the draft is dead, say so honestly
          if (diner?.id) {
            const { pending_order: _po, ...restp } = diner.preferences || {};
            await db.from("diners").update({ preferences: restp }).eq("id", diner.id);
          }
          return { kind: "draft_cleared" };
        }
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
      // Deterministic address capture: we're mid-delivery waiting for the address,
      // nothing else in the message fits — the guest's words ARE the address. The
      // extractor misses bare areas ("Nasr City") and the guest got re-asked forever.
      if (!address && orderType === "delivery" && loaded.pending?.order_type === "delivery" && items.length) {
        const t = input.message.trim();
        const isCommand = (e.items?.length) || (e.edits?.length) ||
          /^(dine.?in|pick.?up|pickup|delivery|توصيل|استلام|في المطعم)\b/i.test(t) ||
          /^(cash|card|visa|instapay|كاش|فيزا|بطاقة|انستاباي)\b/i.test(t) ||
          /^(yes|ok|okay|sure|confirm|tamam|تمام|ماشي|اه|ايوه)\b[\s!.]*$/i.test(t) ||
          /[?؟]\s*$/.test(t);
        if (!isCommand && t.length >= 3 && t.length <= 200) address = t;
      }
      const sharedPin = freshLocation(diner, 1);

      // DELIVERY: the guest never picks the kitchen — code does. Nearest branch by
      // coordinates when we have a pin/Maps link, else the branch whose area the
      // typed address mentions, else their usual branch, else the first one.
      if (orderType === "delivery" && !branch && (mapLink?.lat != null || sharedPin || address)) {
        const pt = (mapLink?.lat != null ? mapLink : null) || sharedPin;
        const auto = (pt ? nearestBranches(branches, pt.lat, pt.lng, 1)[0] : null) ||
          (address ? matchBranchByText(branches, address) : null);
        branch = auto?.key || (branches.some((b) => b.key === diner?.preferred_branch) ? diner.preferred_branch : branches[0]?.key) || null;
        branchInfo = branches.find((b) => b.key === branch) || null;
      }

      // ANY order type: a shared location picks the branch — exactly what the
      // branch question promises ("send your location and we'll pick the nearest")
      if (!branch && sharedPin) {
        const near1 = nearestBranches(branches, sharedPin.lat, sharedPin.lng, 1)[0];
        if (near1) {
          branch = near1.key;
          branchInfo = branches.find((b) => b.key === branch) || null;
        }
      }

      // remember the in-progress order so the next short answer doesn't lose it
      const savePending = async (extra = {}) => {
        if (!diner?.id) return;
        // MERGE over the previous draft — rebuilding from scratch erased fields
        // other gates had saved (payment_method said early, upsell_offered, …)
        const pending_order = {
          ...(loaded.pending || {}),
          items, order_type: orderType, table_number: tableNumber, branch, address, map_link: mapLinkRaw,
          at: new Date().toISOString(),
          ...extra,
        };
        const preferences = { ...(diner.preferences || {}), pending_order };
        await db.from("diners").update({ preferences }).eq("id", diner.id);
      };

      // ================= GATES, in the order a cashier actually asks =================
      // While gathering, echo back what's already on the order so the guest can see
      // it building. Item lines and a subtotal only — the TOTAL isn't knowable until
      // the type settles which charges apply, and quoting one early would be a lie.
      const runningOf = (its) => (its.length ? { items: its, subtotal: its.reduce((s2, i2) => s2 + itemPrice(i2) * i2.qty, 0), currency } : null);
      let running = runningOf(items);

      // 1) WHAT first — the food IS the order; where it goes comes at the end
      // an "unknown" item that's actually 86'd for today gets the honest answer,
      // not a shrug — the guest can still order everything else
      if (unknown.length && loaded.soldOutToday?.size) {
        const sold = unknown.filter((u) => [...loaded.soldOutToday].some((s) => normName(s).includes(normName(u)) || normName(u).includes(normName(s))));
        if (sold.length) {
          unknown = unknown.filter((u) => !sold.includes(u));
          await savePending({}); // keep type/branch/matched items — losing them re-asked everything
          return { kind: "sold_out_today", sold, items, running: runningOf(items) };
        }
      }
      if (!items.length) {
        await savePending({}); // marks the session as ordering — "loaded fries" next turn stays here
        return unknown.length ? { kind: "nothing_matched", unknown } : { kind: "ask_items" };
      }

      // 2) OPTIONS — finish configuring every item
      const step = nextQuestion(items, loaded.menu, input.message, loaded.pending, currency);
      items = step.items;
      running = runningOf(items); // this turn's answers are in — never echo the stale bill
      if (step.ask) {
        await savePending({ awaiting_option: { index: step.ask.index, keys: step.ask.keys } });
        // recompute the bill AFTER this turn's answer — showing the pre-answer
        // state made prices look like they jumped a turn late
        return { kind: "ask_choice", items, running, ...step.ask };
      }

      // 3) FULFILLMENT — type + branch + table/address, everything still missing
      // asked in ONE message; each answer shrinks the next round's question
      const needType = !orderType;
      // branch is a pickup/dine-in question only — delivery gets it assigned from the address
      const needBranch = branches.length > 1 && !branch && orderType !== "delivery";
      const tablesOn = config.basic_info?.services?.table_numbers !== false && loaded.tableNumbers.length > 0;
      const needTable = orderType === "dine_in" && tablesOn && !tableNumber;
      const needAddress = orderType === "delivery" && !address && !mapLink && !sharedPin;
      if (needType || needBranch || needTable || needAddress) {
        await savePending({ address, map_link: mapLinkRaw, awaiting_option: null });
        const loc = freshLocation(diner);
        const near = loc ? nearestBranches(branches, loc.lat, loc.lng, 3).map((b) => `${b.name} (${b.km} km)`) : null;
        return {
          kind: "ask_fulfillment", items, running,
          need_type: needType, delivery: deliveryOn,
          need_branch: needBranch, branches: branches.map((b) => b.name), nearest: near,
          usual: branches.find((b) => b.key === usualKey)?.name || null,
          need_table: needTable, tables: loaded.tableNumbers.slice(0, 12),
          need_address: needAddress, saved: saved.map((s2) => s2.text),
        };
      }

      // 4) MONEY — computed here, never by the model
      const bill = priceOrder(items, config, orderType);

      // 6) PAYMENT METHOD — required before we take the order
      const payMethods = orderType === "dine_in" ? ["cash at the cashier", "card at the cashier", "online link"]
        : orderType === "pickup" ? ["cash at the counter", "card", "instapay"]
        : ["cash on delivery", "card", "instapay"];
      const PAY_WORD = { cash: "cash", كاش: "cash", card: "card", visa: "card", كارت: "card", فيزا: "card", instapay: "instapay", انستاباي: "instapay" };
      const bare = input.message.trim().toLowerCase().replace(/[^\p{L}]/gu, "");
      const payment = ["cash", "card", "instapay"].includes(String(e.payment_method || "").toLowerCase())
        ? String(e.payment_method).toLowerCase()
        : (input.message.trim().length <= 14 && PAY_WORD[bare]) || loaded.pending?.payment_method || null;
      if (!payment) {
        // one casual add-on offer, riding on the payment question — never a gate of
        // its own, never invented: only names the restaurant listed, only once
        const up = config.menu_config?.upsell;
        let upsell = null;
        if (up?.enabled && Array.isArray(up.items) && !loaded.pending?.upsell_offered) {
          upsell = up.items
            .map((n) => loaded.menu.find((m) => normName(m.name) === normName(n)))
            .filter((m) => m && !items.some((it) => it.id === m.id))
            .slice(0, 2)
            .map((m) => `${m.name} (${m.price} ${currency})`);
          if (!upsell.length) upsell = null;
        }
        await savePending({ address, map_link: mapLinkRaw, upsell_offered: true });
        return { kind: "ask_payment", items, bill, currency, methods: payMethods, upsell, branch: branchInfo?.name || null, order_type: orderType, address, table_number: tableNumber };
      }

      // 7) CONFIRM — the guest sees the full bill and says yes before anything is written.
      // Only a yes to a bill WE actually showed counts: the extractor reads "cash" as
      // intent=confirm, which would otherwise place the order the moment they pick a
      // payment method, before they've ever seen a total.
      const AFFIRM = /\b(yes|yeah|yep|confirm|confirmed|ok|okay|sure|go ahead|tamam|تمام|اكيد|أكيد|ماشي|maashi|mashy|aywa|ايوه|أيوة|اه)\b/i;
      const confirmed = loaded.pending?.awaiting_confirm === true &&
        (e.intent === "confirm" || (input.message.trim().length <= 24 && AFFIRM.test(input.message)));
      if (!confirmed) {
        await savePending({ address, map_link: mapLinkRaw, payment_method: payment, awaiting_confirm: true });
        return {
          kind: "confirm_order", items, bill, currency, payment,
          branch: branchInfo?.name || null, order_type: orderType, table_number: tableNumber, address,
        };
      }
      const subtotal = bill.subtotal;

      // ETA = configured prep time + 3 min per ticket already in this branch's
      // queue (+ delivery leg). Computed from the live board, so it's honest —
      // a slammed kitchen quotes longer, an empty one quotes base.
      let q = db.from("orders").select("id", { count: "exact", head: true })
        .in("status", ["pending", "accepted", "preparing"]);
      if (branch) q = q.eq("branch", branch);
      const { count: queueDepth } = await q;
      const basePrep = Number(config.menu_config?.prep_minutes) || 15;
      const etaMinutes = Math.min(
        basePrep + (Number(queueDepth) || 0) * 3 + (orderType === "delivery" ? Number(config.menu_config?.delivery_minutes) || 25 : 0),
        90
      );

      const code = orderCode();
      const row = {
        code, phone_number: ctx.sessionId, diner_name: name,
        order_type: orderType, table_number: tableNumber, branch,
        // the charge breakdown lands in its own columns, so reporting can read it
        // without re-deriving anything from the total
        items: items.map((it) => ({ ...it, unit_price: itemPrice(it) })),
        subtotal, service_charge: bill.service_charge, tax: bill.tax, total: bill.total,
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
      // delivery gets a driver link: unguessable token IS the courier's login.
      // Separate error-tolerant update so a pre-migration DB never blocks a ticket.
      if (orderType === "delivery") {
        const courierToken = Array.from({ length: 22 }, () => "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 32)]).join("");
        await db.from("orders").update({ courier_token: courierToken }).eq("code", code).then(() => {}, () => {});
        // itemized receipts need the fee as data, not a re-derivation (migration 014)
        if (bill.delivery_fee > 0) await db.from("orders").update({ delivery_fee: bill.delivery_fee }).eq("code", code).then(() => {}, () => {});
      }
      if (diner?.id) { // order placed → the in-progress draft is done
        const { pending_order: _p, ...rest } = diner.preferences || {};
        // remember where they had it sent, so next time we offer instead of ask
        if (orderType === "delivery" && address) {
          const kept = (rest.addresses || []).filter((a) => normName(a.text) !== normName(address));
          rest.addresses = [{ text: address, map_link: mapLink?.url || null, last_used: new Date().toISOString() }, ...kept].slice(0, 3);
        }
        // a placed order IS a visit for a casual brand — CRM numbers move NOW,
        // not when someone remembers to edit the diner by hand
        await db.from("diners").update({
          preferences: rest,
          total_spend: Math.round(((Number(diner.total_spend) || 0) + bill.total) * 100) / 100,
          visit_count: (Number(diner.visit_count) || 0) + 1,
          last_visit_at: new Date().toISOString(),
        }).eq("id", diner.id);
      }
      const receiptUrl = await makeReceipt(db, {
        restaurant: config.name,
        order: { ...row, bill, created_at: new Date().toISOString() },
        branch: branchInfo, currency,
      });
      if (receiptUrl) await db.from("orders").update({ receipt_url: receiptUrl }).eq("code", code).then(() => {}, () => {});
      await notifyDashboard(db, "order",
        `🍔 New ${orderType.replace("_", "-")} order ${code}${branchInfo ? ` — ${branchInfo.name}` : ""}`,
        `${name || ctx.sessionId}${tableNumber ? ` · table ${tableNumber}` : ""}${address ? ` · 📍 ${address}` : ""} — ${items.map((i) => `${i.qty}× ${i.name}${i.notes ? ` (${i.notes})` : ""}${modifiers(i).length ? ` [${modifiers(i).join(" · ")}]` : ""}`).join(", ")} · ${fmtAmount(bill.total)} ${currency}`,
        ctx.sessionId, branch);
      return { kind: "order_placed", code, eta_minutes: etaMinutes, order_type: orderType, table_number: tableNumber, branch: branchInfo?.name || null, address: orderType === "delivery" ? address : null, map_link: mapLink?.url || null, payment, receipt_url: receiptUrl, items, bill, currency, unknown, notes: e.notes || null, pickup_time: e.pickup_time || null };
    }, { input: { intent: e.intent, items: (e.items || []).length, order_type: e.order_type, table: e.table_number } });

    const value = await f.node("phrase", async () => {
      const lang = classification?.language || "en";
      const sys = `You are ${config.ai?.name || "the host"} of ${config.name} (fast-casual) on WhatsApp, taking an order like a sharp cashier at the counter. ONE short reply for the OUTCOME (max 2 emojis). Mirror the guest's language & script (${lang}). Use ONLY facts in OUTCOME.
MONEY RULE (absolute): NEVER write a price, a total, a currency symbol or any number of money. NEVER offer add-ons, extras or upsells unless "upsell" exists in OUTCOME.
LIST RULE (absolute): whenever you present 3+ choices of ANYTHING (options, branches, payment methods, sandwiches), format them as a bullet list — one per line, "• Name" — never a comma run. The itemised bill is attached below your reply automatically. Refer to it as "below" — do not restate it, do not invent a currency.
OUTCOMES:
- order_placed: confirm the ticket 🎫 with the CODE, the honest ETA ("about <eta_minutes> min"), and what happens next BY TYPE — dine_in: "the kitchen's on it, coming to table X" · pickup: "we'll message you the moment it's ready at <branch>" · delivery: "we'll message you when it's on its way to <address>". Say the receipt is attached if receipt_url exists. If unknown[] has entries, add "couldn't find <names> on the menu".
- ask_fulfillment: ONE short lead-in line (e.g. "Almost done — just the last details 👇"). The questions themselves are appended automatically — NEVER write or answer them yourself.
- ask_choice: write ONE short lead-in line for configuring <item> (e.g. "Quick choices for your Soo Classic Meal — you can answer in one go 👇"). The questions themselves are appended below your line automatically. NEVER list options yourself, NEVER mention any OTHER item in the order — its turn comes next.
- ask_payment: ask how they'd like to pay, then the methods given as a bullet list, one per line. If "upsell" is present, add ONE casual offer of it in the same breath ("want to add loaded fries for 99?") — never push twice. The bill is below. quick_replies: the methods (e.g. ["Cash","Card","InstaPay"]).
- confirm_order: one line asking them to confirm before it goes to the kitchen. The full bill is below. quick_replies: ["Confirm ✅","Change something"].
- ask_items: the full menu PDF is attached automatically — say it's below/attached and ask what they'd like. NEVER ask "what would you like?" on its own as if they can already see the menu.
- ask_table (rare): which table are they at? NEVER say the order is placed — nothing has been sent yet.
- bad_table: the number they gave isn't one of ours. Say so plainly, list the real ones from "tables", and ask which they're at. NEVER claim the order is placed.
- nothing_matched: none of that matched the menu (list unknown) — suggest tapping the menu.
- sold_out_today: OUTCOME.sold ran out today — apologize warmly, say it's back soon, offer the rest of the menu. NEVER pretend it doesn't exist.
- order_status: restate their order (code, status, items) honestly by status: pending/accepted="in the queue", preparing="on the grill now", ready="READY — come grab it!".
- order_cancelled: cancelled ✅, no charge, door's open.
- draft_cleared: they removed everything from the order being built — confirm it's wiped, offer to start fresh.
- too_late_to_cancel: it's already READY — can't cancel now; the team can help at the counter.
- no_open_order: no active order found — want to start one?
- no_delivery: we don't do delivery — pickup or dine-in works great though.
- no_history: no past orders on this number yet — invite them to make their first one (it becomes their "usual").
Return JSON: {"reply": string, "quick_replies": string[]|null}`;
      // The smart model earns its price on the turns a guest judges you by — the
      // ticket confirmation, an apology, a "we can't do that". Asking which table
      // they're at is a form field with manners; mini says it just as well for a
      // quarter of the cost, and these are most of an order's turns.
      const VOICE_MATTERS = ["order_placed", "order_cancelled", "too_late_to_cancel", "no_delivery", "no_history", "nothing_matched", "order_status", "bad_table", "sold_out_today"];
      const model = VOICE_MATTERS.includes(outcome.kind) ? MODEL_SMART : MODEL_FAST;
      return chatJSON(model, sys, `OUTCOME: ${JSON.stringify(outcome)}\nGuest: ${input.message}`, { temperature: 0.5, maxTokens: 240 });
    }, { input: { outcome_kind: outcome.kind } });

    const fallback = {
      order_placed: `🎫 Order ${outcome.code} is in — about ${outcome.eta_minutes} min!`,
      ask_items: "Here's the full menu 📄 — tell me what you'd like and I'll get it going 🍔",
      nothing_matched: `Couldn't find ${(outcome.unknown || []).join(", ")} on the menu — here it is 📄, pick anything off it.`,
      sold_out_today: `${(outcome.sold || []).join(", ")} is sold out today 🙏 — back soon! Anything else from the menu?`,
      no_history: "No past orders on this number yet — here's the menu 📄, let's make your first one 🍔",
      ask_fulfillment: "Almost done — just the last details 👇",
      ask_choice: `For your ${outcome.item}:\n${(outcome.questions || []).map((q) => `${q.label}${q.of > 1 ? ` (${q.remaining} to pick)` : ""}:\n${q.options.map((o) => `• ${o}`).join("\n")}`).join("\n\n")}`,
      ask_payment: `How would you like to pay?\n${(outcome.methods || []).map((m) => `• ${m.replace(/^\w/, (c) => c.toUpperCase())}`).join("\n")}`,
      confirm_order: "All set — confirm and I'll send it to the kitchen ✅",
      ask_table: `Which table are you at? The number's printed on it${(outcome.tables || []).length ? ` — they look like ${outcome.tables.slice(0, 3).join(", ")}` : ""} 😄`,
      bad_table: `I can't find table ${outcome.given} — ours are ${(outcome.tables || []).slice(0, 8).join(", ")}. Which one are you at?`,
      no_open_order: "No active order found — want to start one? 🍔",
      draft_cleared: "All cleared ✅ Want to start a fresh order?",
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

    // Fulfillment questions are STRUCTURE too — model writes one lead-in line
    if (outcome.kind === "ask_fulfillment") {
      const qs = [];
      if (outcome.need_type) qs.push(`How would you like it?\n• Dine-in\n• Pickup${outcome.delivery === false ? "" : "\n• Delivery"}`);
      if (outcome.need_branch) {
        const near = outcome.nearest?.length ? `\nClosest to you: ${outcome.nearest[0]} 📍`
          : outcome.usual ? `\nYour usual: ${outcome.usual} ⭐` : "";
        const head = outcome.need_type
          ? "If Pickup or Dine-in — please choose which branch, or send your location on Google Maps and we'll pick the nearest one for you 📍"
          : "Please choose which branch, or send your location on Google Maps and we'll pick the nearest one for you 📍";
        qs.push(`${head}${near}\n${(outcome.branches || []).map((b) => `• ${b}`).join("\n")}`);
      }
      if (outcome.need_table) qs.push(`Which table are you at? (the number's on it — like ${(outcome.tables || []).slice(0, 3).join(", ")})`);
      if (outcome.need_address) qs.push((outcome.saved || []).length
        ? `Delivery address — same as before (${outcome.saved[0]}), or somewhere new?`
        : `What's the delivery address? Type it out or paste a Google Maps link 🔗`);
      reply = `${reply.split("\n")[0]}\n\n${qs.join("\n\n")}`;
    }

    // Option questions are STRUCTURE, and structure is code's job — the model
    // once crammed two items and six comma-runs into one paragraph. It writes a
    // single lead-in line; the formatted questions are appended verbatim.
    if (outcome.kind === "ask_choice" && outcome.questions?.length) {
      const qBlock = outcome.questions.map((q) => {
        const head = `${q.label}${q.of > 1 ? ` — ${q.remaining} to pick` : ""}${q.mixable ? ` (you can mix across your ${q.mixable})` : ""}`;
        return `${head}:\n${q.options.map((o) => `• ${o}`).join("\n")}`;
      }).join("\n\n");
      reply = `${reply.split("\n")[0]}\n\n${qBlock}`;
    }

    // Bundle template turns: the model writes one lead-in line; everything the
    // guest must read or copy-paste is appended by code, verbatim.
    if (outcome.kind === "ask_choice" && (outcome.slots_intro || outcome.slots_missing)) {
      const parts = [reply.split("\n")[0]];
      if (outcome.notices?.length) parts.push(outcome.notices.join("\n"));
      if (outcome.slots_missing?.length) parts.push(`Still missing — ${outcome.slots_missing.join(" · ")}`);
      if (outcome.slots_intro && outcome.slots_template) parts.push(outcome.slots_intro);
      if (outcome.slots_template) parts.push(`Copy this, fill it in, and send it back 👇\n\n${outcome.slots_template}`);
      reply = parts.filter(Boolean).join("\n\n");
    }

    // Mid-gather: show the lines and a subtotal, never a TOTAL we can't stand behind yet.
    if (outcome.running?.items?.length) {
      const money = (n) => `${fmtAmount(n)} ${currency}`;
      // options still unanswered? then this line's price isn't settled yet — say so
      const open_ = (it) => (it.option_defs || []).some((g) =>
        (g.choices || []).some((c) => c.price != null || c.delta) &&
        !(Array.isArray(it.options?.[g.key]) ? it.options[g.key].length : it.options?.[g.key]));
      const anyOpen = outcome.running.items.some(open_);
      const lines = outcome.running.items.map((it) => {
        const mods = modifiers(it);
        return `• ${it.qty}× ${it.name}${mods.length ? ` (${mods.join(" · ")})` : ""} — ${open_(it) ? "from " : ""}${money(itemPrice(it) * it.qty)}`;
      });
      const RULE = "―".repeat(24);
      reply = `${reply}\n\n${RULE}\n${lines.join("\n")}\nSubtotal: ${anyOpen ? "from " : ""}${money(outcome.running.subtotal)}\n${RULE}`;
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
        code: outcome.kind === "order_placed" ? outcome.code : null,
        eta: outcome.eta_minutes || null,
        restaurant: config.name,
        when: new Date().toLocaleString("en-GB", { timeZone: config.basic_info?.timezone || "Africa/Cairo", hour12: true, day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" }),
      })}`;
    }
    // the ticket code is the guest's receipt — never let a confirmation go out without it
    if (outcome.kind === "order_placed" && outcome.code && !reply.includes(outcome.code)) {
      reply = `${reply} (order ${outcome.code})`;
    }
    // whenever we're asking them to pick, the menu PDF must be in the same breath
    // buttons at decision gates come from CODE — the model paraphrased option
    // names into unparseable labels, and sometimes dropped the Confirm button
    // entirely. Every gate gets its buttons deterministically.
    // buttons/lists ONLY when this message asks exactly ONE question — tapping an
    // answer to question 1 while questions 2-3 hang unanswered just confuses
    const fulfillNeeds = outcome.kind === "ask_fulfillment"
      ? [outcome.need_type, outcome.need_branch, outcome.need_table, outcome.need_address].filter(Boolean).length : 0;
    const forced =
      outcome.kind === "ask_choice" && outcome.questions?.length === 1 ? (outcome.questions[0].names || [])
      : outcome.kind === "ask_fulfillment" && fulfillNeeds === 1 && outcome.need_type ? ["Dine-in", "Pickup", ...(outcome.delivery === false ? [] : ["Delivery"])]
      : outcome.kind === "ask_fulfillment" && fulfillNeeds === 1 && outcome.need_branch ? (outcome.branches || [])
      : outcome.kind === "confirm_order" ? ["Confirm ✅", "Change something"]
      : outcome.kind === "ask_payment" ? (outcome.methods || []).map((m) => m.split(" ")[0].replace(/^\w/, (c) => c.toUpperCase()))
      : null;
    let optionList = null;
    if (forced) {
      value.value = value.value || {};
      if (["ask_choice", "ask_fulfillment"].includes(outcome.kind) && forced.length > 3) {
        // buttons cap at 3 on WhatsApp — a list holds 10, so every option is tappable
        const q0 = outcome.kind === "ask_fulfillment"
          ? { label: "Choose your branch 🏪" }
          : outcome.questions[0];
        optionList = {
          button: outcome.kind === "ask_fulfillment" ? "Choose branch 🏪" : "View options 🍽",
          sections: [{
            title: String(q0.label || "Options").slice(0, 24),
            rows: forced.slice(0, 10).map((name2) => ({
              id: `opt_${normName(name2).replace(/\s+/g, "_").slice(0, 20)}`,
              title: String(name2).slice(0, 24),
              description: "",
            })),
          }],
        };
        value.value.quick_replies = [];
      } else {
        value.value.quick_replies = forced.filter((x) => x && x.length <= 20).slice(0, 3);
      }
    }

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
        reply = `${reply}\n\n📄 ${PUBLIC_BASE}/menu.pdf`;
      }
    }

    return {
      reply,
      menuList: optionList,
      // pipeline decision points keep their buttons even back-to-back — the
      // anti-spam pacing rule cost a guest their Confirm button and the order died
      forceButtons: ["ask_choice", "ask_payment", "confirm_order", "ask_order_type"].includes(outcome.kind),
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
// One human line for everything chosen on a line item — picks can be a single
// name or a list (a bundle picks several sandwiches).
function modifiers(it) {
  const opts = it.options || {};
  if (Array.isArray(opts.slots)) {
    const out = opts.slots.map((sl, i) => {
      const vals = Object.entries(sl || {}).filter(([k]) => k !== "notes").map(([, v]) => v);
      const note = sl?.notes ? ` — ${sl.notes}` : "";
      return `${i + 1}) ${vals.join(" + ") || "?"}${note}`;
    });
    if (it.notes) out.push(it.notes);
    return out;
  }
  const order = (it.option_defs || []).map((g) => g.key);
  const keys = [...order.filter((k) => opts[k]), ...Object.keys(opts).filter((k) => !order.includes(k) && opts[k])];
  const out = [];
  for (const k of keys) {
    const v = opts[k];
    out.push(Array.isArray(v) ? v.join(", ") : v);
  }
  if (it.notes) out.push(it.notes);
  return out;
}

// Option groups live on the menu item itself (menu_items.options), so each
// restaurant defines its own questions in the dashboard. A group is asked only
// when its "when" condition is met by earlier answers, so "which size" never
// appears for someone who picked the plain sandwich.
//
// choice.price = absolute (replaces the item's base price) · choice.delta = added
// group.count  = ask for that many picks · group.from_category = read the live menu
function groupChoices(group, menu) {
  if (group.from_category) {
    // staff type this free-form in the dashboard — treat it as a literal
    // substring, never compile it as a regex (an unbalanced paren killed orders)
    const want = normName(group.from_category);
    return menu.filter((m) => normName(m.category || "").includes(want)).map((m) => ({ name: m.name }));
  }
  return (group.choices || []).filter((c) => c?.name);
}

// Does an earlier answer unlock this group? { "format": "Combo" } or a list.
function groupApplies(group, picked) {
  if (!group.when) return true;
  return Object.entries(group.when).every(([key, want]) => {
    const got = picked[key];
    if (!got) return false;
    const wants = Array.isArray(want) ? want : [want];
    return wants.some((w) => normName(w) === normName(got) || normName(got).includes(normName(w)));
  });
}

// What a fully-configured line costs: base, or the absolute price its format
// choice sets, plus every delta.
function itemPrice(item) {
  const picked = item.options || {};
  let base = Number(item.price) || 0;
  let delta = 0;
  for (const g of item.option_defs || []) {
    const chosen = picked[g.key];
    for (const name of Array.isArray(chosen) ? chosen : [chosen].filter(Boolean)) {
      const c = (g.choices || []).find((x) => normName(x.name) === normName(name));
      if (!c) continue;
      if (c.price != null) base = Number(c.price);
      if (c.delta) delta += Number(c.delta);
    }
  }
  return base + delta;
}

// Walks the order ONE ITEM AT A TIME, the way a cashier does: finish this
// burger completely before starting the next line. Returns the next question,
// or null when every item is fully configured.
// ---------------------------------------------------------------------------
// Bundle slots — a bundle is N repeated blocks (sandwich / fries / soda / notes),
// defined per restaurant on the item: { key:"slots", count:N, slot_groups:[...] }.
// The guest gets a copy-paste template; code parses it back, matches every value
// against THAT bundle's allowed choices, auto-switches near-misses, and re-asks
// only what's missing.
// ---------------------------------------------------------------------------
const ORDINALS = ["FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH", "SEVENTH", "EIGHTH"];

function slotsGroupOf(it) {
  return (it.option_defs || []).find((g) => g.key === "slots" && Array.isArray(g.slot_groups) && Number(g.count) >= 1) || null;
}

function slotChoiceNames(sg, menu) {
  if (sg.from_category) {
    const re = new RegExp(sg.from_category, "i");
    return menu.filter((m) => re.test(String(m.category || ""))).map((m) => m.name);
  }
  return (sg.choices || []).map((c) => c.name).filter(Boolean);
}

// message 1: what this bundle includes + the allowed choices per field
function renderSlotsIntro(it, g, menu) {
  const lines = [`For your ${it.name} — ${g.count} choices to make. Pick from:`];
  for (const sg of g.slot_groups) {
    if (sg.free) continue;
    const names = slotChoiceNames(sg, menu);
    if (!names.length) continue;
    lines.push("");
    lines.push(`${String(sg.label || sg.key).toUpperCase()}:`);
    for (const nm of names) lines.push(`• ${nm}`);
  }
  return lines.join("\n");
}

// message 2: the copy-paste template — plain text, no formatting
function renderSlotsTemplate(g) {
  const blocks = [];
  for (let i = 0; i < Number(g.count); i++) {
    const head = `${ORDINALS[i] || `#${i + 1}`} CHOICE`;
    const fields = g.slot_groups.map((sg) => `${String(sg.label || sg.key).toUpperCase()}:`);
    blocks.push([head, ...fields].join("\n"));
  }
  return blocks.join("\n\n");
}

// near-miss auto-switch: "cola"/"coke" → whatever cola we stock; else first option
const SODA_WORDS = /\b(cola|coke|pepsi|soda|كولا|بيبسي)\b/i;
function matchSlotValue(raw, names) {
  const said = normName(raw);
  if (!said) return { value: null };
  let hit = names.find((n) => normName(n) === said)
    || names.find((n) => said.includes(normName(n)) || normName(n).includes(said));
  if (!hit) {
    const stop = distinctTokens(names.map((n) => ({ name: n })));
    hit = names.find((n) => {
      const tok = normName(n).split(" ").filter((t) => !stop.has(t));
      return optionMatches(said, tok.join(" ") || n);
    });
  }
  if (hit) return { value: hit };
  // cola-family ask we don't carry → the cola-family drink we DO carry, and the
  // switch is ANNOUNCED in the reply's notices (founder-specified behavior).
  // Anything else unmatched stays unmatched — never silently hand the guest the
  // first drink on the list; the slot re-asks with the real choices instead.
  if (SODA_WORDS.test(raw)) {
    const sub = names.find((n) => /cola|pepsi/i.test(n));
    if (sub) return { value: sub, switched: raw.trim() };
  }
  return { value: null, unmatched: raw.trim() };
}

// Parse a filled template (tolerates reordering, partial fills, extra prose).
// Returns { slots: [ {field: value|null, ...}, ... ], switched: ["Cola → Pepsi"], unmatched: [...] }
function parseSlots(message, g, menu) {
  const count = Number(g.count);
  const fieldsBySlot = Array.from({ length: count }, () => ({}));
  const switched = [], unmatched = [];
  // split into blocks on ordinal/numbered headings; fall back to one big block
  const headRe = new RegExp(`(?:^|\\n)\\s*(?:(${ORDINALS.join("|")})\\s+CHOICE|CHOICE\\s*(\\d+)|(\\d+)[).-])`, "gi");
  const marks = [];
  let m;
  while ((m = headRe.exec(message))) {
    const ord = m[1] ? ORDINALS.indexOf(m[1].toUpperCase()) : (Number(m[2] || m[3]) - 1);
    if (ord >= 0 && ord < count) marks.push({ at: m.index, slot: ord });
  }
  const blocks = marks.length
    ? marks.map((mk, i) => ({ slot: mk.slot, text: message.slice(mk.at, marks[i + 1]?.at ?? message.length) }))
    : [{ slot: 0, text: message }];

  for (const b of blocks) {
    for (const sg of g.slot_groups) {
      const label = String(sg.label || sg.key);
      const re = new RegExp(`${label.replace(/[.*+?^${'$'}{}()|[\\]\\\\]/g, "\\$&")}\\s*[:：-]\\s*([^\\n]*)`, "i");
      const hit = b.text.match(re);
      if (!hit || !hit[1].trim()) continue;
      if (sg.free) { fieldsBySlot[b.slot][sg.key] = hit[1].trim().slice(0, 120); continue; }
      const names = slotChoiceNames(sg, menu);
      const r = matchSlotValue(hit[1], names);
      if (r.value) {
        fieldsBySlot[b.slot][sg.key] = r.value;
        if (r.switched) switched.push(`${r.switched} → ${r.value}`);
      } else if (r.unmatched) unmatched.push(`${label}: ${r.unmatched}`);
    }
  }
  return { slots: fieldsBySlot, switched, unmatched };
}

// which slots are still missing required fields?
function missingSlots(slots, g) {
  const out = [];
  for (let i = 0; i < Number(g.count); i++) {
    const need = g.slot_groups.filter((sg) => !sg.free && !(slots[i] || {})[sg.key]).map((sg) => String(sg.label || sg.key));
    if (need.length) out.push({ slot: i, need });
  }
  return out;
}

// Does the guest's answer name this option? Token-level with 3-char prefixes,
// so "Coke" hits "Coca - Cola", "curly with cheese" hits "Curly fries", and
// "Meal" hits "American Truck Meal" — guests answer with the distinguishing
// word, never the exact label we printed.
function optionMatches(said, optName) {
  const o = normName(optName);
  if (o === said || said.includes(o)) return true;
  const saidTok = said.split(" ").filter((t) => t.length >= 3);
  const optTok = o.split(" ").filter((t) => t.length >= 3);
  return optTok.some((ot) => saidTok.some((st) =>
    st === ot || (st.length >= 4 && ot.startsWith(st.slice(0, 4))) || (ot.length >= 4 && st.startsWith(ot.slice(0, 4)))
  ));
}

// STOPWORDS a guest's answer shares with EVERY option ("fries", "meal") — a
// token only distinguishes if some option lacks it.
function distinctTokens(opts) {
  const all = opts.map((o) => normName(o.name).split(" "));
  const common = new Set(all[0] || []);
  for (const t of [...common]) if (!all.every((toks) => toks.includes(t))) common.delete(t);
  return common;
}

// One item, ALL its unanswered questions in one message; the guest answers any
// or all of them, and only what's still missing gets re-asked.
function nextQuestion(items, menu, message, pending, currency = "EGP") {
  const out = items.map((it) => ({ ...it, options: { ...(it.options || {}) } }));
  const said = normName(message);

  // ---- a filled bundle template answers its slots ----
  const aw = pending?.awaiting_option;
  const awKeys = aw ? (aw.keys || (aw.key ? [aw.key] : [])) : [];
  if (aw && out[aw.index] && awKeys.includes("slots")) {
    const it = out[aw.index];
    const g = slotsGroupOf(it);
    if (g) {
      const parsed = parseSlots(message, g, menu);
      const prev = Array.isArray(it.options.slots) ? it.options.slots : Array.from({ length: Number(g.count) }, () => ({}));
      it.options.slots = prev.map((old, i) => ({ ...old, ...(parsed.slots[i] || {}) }));
      it.slot_notices = [...(parsed.switched.length ? [`Switched: ${parsed.switched.join(", ")}`] : [])];
      // a bare "curly fries" when exactly one field is missing needs no labels —
      // but ONLY when this message wasn't a (partial) template: a labeled answer
      // for slot 1 must never bleed into slot 2
      const labeledAny = parsed.slots.some((sl) => Object.keys(sl || {}).length);
      const miss = missingSlots(it.options.slots, g);
      if (!labeledAny && miss.length === 1 && miss[0].need.length === 1) {
        const sgDef = g.slot_groups.find((x) => String(x.label || x.key) === miss[0].need[0] || x.key === miss[0].need[0]);
        if (sgDef && !sgDef.free) {
          const r = matchSlotValue(message, slotChoiceNames(sgDef, menu));
          if (r.value) it.options.slots[miss[0].slot][sgDef.key] = r.value;
        }
      }
    }
  }

  // ---- apply this message against every group we asked about last turn ----
  if (aw && out[aw.index] && awKeys.length) {
    const it = out[aw.index];
    const defs = it.option_defs || [];
    for (const g of defs) {
      if (!awKeys.includes(g.key)) continue;
      if (g.key === "slots" && Array.isArray(g.slot_groups)) continue; // handled above
      if (!groupApplies(g, it.options)) continue; // an earlier answer may have closed it
      const need = Number(g.count) || 1;
      const have = it.options[g.key];
      if ((Array.isArray(have) ? have.length : have ? 1 : 0) >= need) continue;
      const opts = groupChoices(g, menu);
      if (!opts.length) continue;

      const stop = distinctTokens(opts);
      let hits = opts.filter((o) => normName(o.name) === said);
      // full option name written out beats any fuzzy overlap — "coca cola" must
      // pick Coca - Cola, never also Coca - Cola Diet
      if (!hits.length) hits = opts.filter((o) => said.includes(normName(o.name)));
      if (!hits.length) hits = opts.filter((o) => {
        // ignore tokens every option shares — "fries" alone picks nothing
        const oTok = normName(o.name).split(" ").filter((t) => !stop.has(t));
        return optionMatches(said, oTok.join(" ") || o.name);
      });
      // a bare number picks off the printed list — only when this is the sole question
      if (!hits.length && awKeys.length === 1) {
        const n = Number(said.replace(/[^0-9]/g, ""));
        if (n >= 1 && n <= opts.length && said.length <= 3) hits = [opts[n - 1]];
      }
      if (!hits.length) continue;

      // "2 american truck and 2 iconic" — repeat each matched name by the number
      // written just before it (default 1)
      const picked = [];
      for (const h of hits) {
        const idx = said.indexOf(normName(h.name).split(" ")[0]);
        const before = idx > 0 ? said.slice(Math.max(0, idx - 6), idx) : "";
        const q = Math.min(Number((before.match(/(\d+)\s*x?\s*$/) || [])[1]) || 1, 8);
        for (let k = 0; k < q; k++) picked.push(h.name);
      }

      if (need > 1) {
        const prev = Array.isArray(it.options[g.key]) ? it.options[g.key] : [];
        it.options[g.key] = [...prev, ...picked].slice(0, need);
      } else if (it.qty > 1 && new Set(picked).size > 1 && picked.length === it.qty) {
        // "one coke and one sprite" for 2 meals — split the line like a real ticket
        const counts = {};
        for (const n of picked) counts[n] = (counts[n] || 0) + 1;
        const lines = Object.entries(counts).map(([n, q]) => ({
          ...it, qty: q, options: { ...it.options, [g.key]: n },
        }));
        out.splice(aw.index, 1, ...lines);
        break; // indexes shifted — remaining groups get asked next round
      } else {
        it.options[g.key] = picked[0];
      }
    }
  }

  // ---- ask everything still open on the FIRST unfinished item, in one go ----
  for (let i = 0; i < out.length; i++) {
    const it = out[i];
    const defs = it.option_defs || [];

    // bundle with slots → intro + copy-paste template (or re-ask only what's missing)
    const sg = slotsGroupOf(it);
    if (sg) {
      const slots = Array.isArray(it.options.slots) ? it.options.slots : [];
      const missing = missingSlots(slots, sg);
      if (missing.length) {
        const fresh = !slots.some((sl) => Object.keys(sl || {}).length);
        return {
          items: out,
          ask: {
            index: i, item: it.name, keys: ["slots"],
            slots_intro: renderSlotsIntro(it, sg, menu),
            slots_template: fresh ? renderSlotsTemplate(sg) : null,
            slots_missing: fresh ? null : missing.map((ms) => `${ORDINALS[ms.slot] || ms.slot + 1} choice: ${ms.need.join(", ")}`),
            notices: it.slot_notices || [],
            questions: [],
          },
        };
      }
    }

    const open = [];
    for (const g of defs) {
      if (g.key === "slots" && Array.isArray(g.slot_groups)) continue;
      // conditional groups are SHOWN upfront ("if Full Meal — fries: ...") so the
      // guest can answer the whole item in one line; they only APPLY if unlocked
      const conditional = g.when && !groupApplies(g, it.options);
      if (conditional && Object.keys(g.when).every((k) => it.options[k])) continue; // when-key answered and it ruled this group out
      const need = Number(g.count) || 1;
      const have = it.options[g.key];
      const got = Array.isArray(have) ? have.length : have ? 1 : 0;
      if (got >= need) continue;
      const opts = groupChoices(g, menu);
      if (!opts.length) continue;
      const whenTxt = conditional
        ? Object.values(g.when).map((v) => (Array.isArray(v) ? v[0] : v)).join("/")
        : null;
      open.push({
        key: g.key,
        label: (whenTxt ? `If ${whenTxt} — ` : "") + (g.label || g.key),
        // names only — clean choices; the math lands on the bill, not the menu
        options: opts.slice(0, 12).map((o) => o.name),
        names: opts.slice(0, 12).map((o) => o.name),
        remaining: need - got,
        of: need,
        mixable: need === 1 && it.qty > 1 ? it.qty : null,
      });
    }
    if (open.length) {
      return {
        items: out,
        ask: { index: i, item: it.name, keys: open.map((q) => q.key), questions: open },
      };
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
  const subtotal = round(items.reduce((s, i) => s + itemPrice(i) * Number(i.qty), 0));

  const extras = [];
  // configs in the wild write these either as a fraction (0.14) or a percentage (14) —
  // accept both rather than silently charging nothing, or charging 100x
  const rateOf = (...keys) => {
    for (const k of keys) {
      const v = Number(p[k]);
      // >= 1 always means percent: 14 → 14%, 1 → 1%. (Nobody configures a 100%
      // charge; reading a whole-number 1 as the fraction 1.0 doubled bills.)
      if (Number.isFinite(v) && v > 0) return v >= 1 ? v / 100 : v;
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
const fmtAmount = fmtMoney;

function renderBill({ items, bill, currency, orderType, tableNumber, branchName, address, payment, code, eta, restaurant, when }) {
  const money = (n) => `${fmtAmount(n)} ${currency}`;
  const lines = items.map((it) => {
    const mods = modifiers(it);
    return `• ${it.qty}× ${it.name}${mods.length ? ` (${mods.join(" · ")})` : ""} — ${money(itemPrice(it) * Number(it.qty))}`;
  });

  const totals = [`Subtotal: ${money(bill.subtotal)}`];
  for (const x of bill.extras) totals.push(`${x.label}: ${money(x.amount)}`);
  totals.push(`*TOTAL: ${money(bill.total)}*`);

  const where = orderType === "dine_in" ? `Dine-in${tableNumber ? ` · table ${tableNumber}` : ""}${!tableNumber && branchName ? ` · ${branchName}` : ""}`
    : orderType === "pickup" ? `Pickup${branchName ? ` · ${branchName}` : ""}`
    : `Delivery${branchName ? ` · from ${branchName}` : ""}`;

  const RULE = "―".repeat(24);
  // placed orders read like the paper receipt: header with the code and where/when,
  // items, totals, then payment + destination + ETA + the branded receipt link
  const header = code
    ? [`🧾 *RECEIPT ${code}*`, restaurant ? `${restaurant}${branchName ? ` — ${branchName}` : ""}` : null, `${when || ""} · ${where}`.trim()]
    : ["🧾 *YOUR ORDER*"];
  const footer = [
    payment ? `💳 ${payment === "cash" ? "Cash" : payment === "card" ? "Card" : "InstaPay"}` : null,
    orderType === "delivery" && address ? `📍 ${address}` : null,
    code && eta ? `⏱ about ${eta} min` : null,
    code ? `📄 ${PUBLIC_BASE}/receipt/${code}` : null,
  ].filter(Boolean);
  return [
    ...header.filter(Boolean),
    RULE,
    lines.join("\n"),
    RULE,
    totals.join("\n"),
    RULE,
    ...( code ? footer : [where, ...footer] ),
  ].filter(Boolean).join("\n");
}
