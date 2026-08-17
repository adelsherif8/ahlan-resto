// ORDER agent (casual flagship) — chat ordering: pickup / delivery / dine-in by
// table number. LLM extracts items & phrases; CODE matches menu, prices, totals.
// v1: no payments in chat — pay at counter/courier (per FACTS). Kitchen board fed live.
import { orderedCategories, categoryLabel } from "../services/categories.js";
import { defineFlow } from "../engine/flow.js";
import { chatJSON } from "../services/llm.js";
import { MODEL_SMART, MODEL_FAST, MODEL_NANO, PUBLIC_BASE, publicLink, log } from "../config.js";
import { notifyDashboard, setSessionFlags } from "../services/chatlog.js";
import { nearestBranches, matchBranchByText, freshLocation, extractMapLink, resolveMapLink } from "../services/branches.js";
import { deliveryQuote, geocodeAddress, pricingOf, resolvePlace } from "../services/delivery.js";
import { editDistance } from "../services/fastpaths.js";
import { getMenu } from "../services/menucache.js";
import { fmtMoney } from "../services/format.js";
import { makeReceipt } from "../services/receipt.js";
import { menuPdfUrl } from "../services/menupdf.js";
import { nextOrderCode } from "../services/ordercode.js";
import { itemMods } from "../services/orderline.js";
import { parseAddress, formatAddress, ADDRESS_TEMPLATE_EN, ADDRESS_TEMPLATE_AR } from "../services/address.js";
import { signTrackToken } from "../services/builder.js";



const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// script-agnostic normaliser for place names (Arabic kept, diacritics/hamza folded)
const norm2 = (s) => String(s || "").toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
// bare "yes/ok/tamam" — a confirmation, never an address or an item. One place,
// reused wherever a plain affirmative needs telling apart from real content.
const BARE_YES = /^(yes|ok|okay|sure|confirm|tamam|تمام|ماشي|اه|ايوه)(?![\p{L}\p{N}])[\s!.]*$/iu;

defineFlow({
  name: "order",
  description: "Order agent — chat ordering (pickup/delivery/dine-in by table), code-priced tickets to the kitchen board",
  trigger: { icon: "branch", label: "Dispatched by MASTER (order bucket, casual restaurants)" },
  nodes: [
    { id: "load", label: "Menu + Open Order", icon: "database" },
    { id: "extract", label: "Extract Order (LLM)", icon: "sparkles" },
    { id: "act", label: "Match + Price (code)", icon: "zap" },
    { id: "resolve_options", label: "Resolve Choices (LLM, list-locked)", icon: "sparkles" },
    { id: "phrase", label: "Phrase Reply (LLM)", icon: "sparkles" },
  ],

  async run(f, ctx, input) {
    const { db, config } = ctx.tenant;
    const currency = config.payments?.currency || "EGP";
    const { diner, classification } = input;
    // STRUCTURE SPEAKS THE GUEST'S LANGUAGE — Arabic and Franco variants of every
    // code-built template. Deterministic strings: zero AI tokens, exactly like English.
    const LANGV = classification?.language === "ar" ? "ar" : classification?.language === "franco" ? "fr" : "en";
    const L2 = (en, ar, fr) => (LANGV === "ar" ? ar : LANGV === "fr" ? (fr || en) : en);

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
        .in("status", ["pending", "accepted", "preparing", "ready", "out_for_delivery"])
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

    // Official Arabic menu names (menu_items.name_ar) — Arabic guests hear dishes
    // by their Arabic menu name everywhere code writes one. English stays canonical
    // internally (ids, matching, kitchen tickets).
    const arNameOf = (n) => {
      const m = (loaded?.menu || []).find((x) => x.name === n) || (loaded?.menu || []).find((x) => normName(x.name) === normName(n));
      return m?.name_ar || n;
    };
    const dishDisp = (n) => (LANGV === "ar" ? arNameOf(n) : n);

    const ex = await f.node("extract", async () => {
      // The router already KNOWS what this is — the guest tapped "Same as last time"
      // or answered yes to the greeting's usual offer. Asking a model to re-derive an
      // intent we handed it is a call we pay for and wait on for nothing.
      if (input.forcedIntent) {
        return { value: { intent: input.forcedIntent, items: null, edits: null, payment_method: null,
          order_type: null, table_number: null, pickup_time: null, notes: null, address: null,
          branch: null, reorder_ref: null, question: null }, __usage: null };
      }
      const menuNames = loaded.menu.map((m) => `${m.name}${m.name_ar ? ` / ${m.name_ar}` : ""} (${m.category})`).join(" | ");
      // Grounding the model in the ACTUAL current state beats asking it to infer intent
      // from phrasing alone. Earlier this only had a paragraph of trigger phrases for
      // "replace" ("no I want X", "actually X") and the model just never used it — a
      // plain "No i want chicken ranch" kept coming back as items:[{name:"Chicken
      // Ranch"}], edits:null, exactly like a fresh order for that item, because that IS
      // the more natural reading of the sentence in isolation. Telling it directly what
      // is already on the order removes the guesswork: it isn't inferring "this phrasing
      // usually means a swap", it's comparing the name it just extracted against a name
      // it was handed.
      const pendingLine = loaded.pending?.items?.length
        ? `\nTHE GUEST ALREADY HAS THIS ON THEIR ORDER (not yet finalized): ${loaded.pending.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}. Three ways this message can relate to it:
  (1) It uses ADD language ("add", "also", "kaman", "زود", "كمان") naming another dish → edits op "add" (unchanged from below).
  (2) It answers a choice being asked about the item above (a size, a drink flavor, "sandwich" vs "combo", a modifier) → leave "items" and "edits" null, that answer is handled elsewhere.
  (3) Otherwise, if it names a DIFFERENT main dish from MENU with no add-language — a correction, or just restating what they want — they are SWAPPING the item above OUT, not adding a second dish: edits op "replace", "item" = the name above, "with" = the new name.`
        : "";
      const sys = `Extract a food order from one WhatsApp message to a fast-casual restaurant. MENU (only these exist): ${menuNames}
Recent conversation may add context: ${JSON.stringify((input.history || []).slice(-4).map((h) => h.message?.slice(0, 80)))}${pendingLine}
Return JSON only:
{"intent": "order"|"repeat_last"|"confirm"|"cancel_order"|"status"|"question"|"other",
 "payment_method": "cash"|"card"|"instapay"|null,
 "items": [{"name": "<closest MENU name>", "qty": number, "notes": "<modifiers for THIS item, e.g. 'no onion', 'extra cheese', 'well done'>"|null}]|null — a GENERIC category word without a specific dish (برجر/"a burger", تشيكن/"chicken", ساندوتش, بيتزا) stays the guest's LITERAL word as the item name — NEVER silently pick a specific dish for it; a requested DRINK or SIDE is its OWN items entry, NEVER another dish's notes ("a burger and a cola zero" = TWO items, even when the drink isn't on the menu; notes only modify the dish they ride on),
 "order_type": "pickup"|"delivery"|"dine_in"|null (dine_in when they mention a table / being inside),
 "table_number": string|null ("t3"/"table 3" → "T3"),
 "pickup_time": string|null, "notes": string|null (sauce prefs, no onions, etc. — ALSO cash-change requests: "change for 500"/"معايا ٥٠٠ طلع الباقي" → "change for 500"),
 "address": "<the delivery address EXACTLY as the guest wrote it, verbatim>"|null,
 "branch": "<exact branch NAME from this list if the guest names one, else null>",
 "edits": [{"op": "add"|"remove"|"set_qty"|"replace"|"set_option", "item": "<closest MENU name>", "qty": number|null, "with": "<closest MENU name, ONLY for op replace>"|null, "option": "<ONLY for op set_option: the choice they want for that item, e.g. 'combo'/'sandwich'/'large'>"|null}]|null,
 "reorder_ref": "<ONLY with intent repeat_last: if they point at a SPECIFIC past order — a weekday ('same as last Tuesday'), a dish ('the truffle one I got'), 'my first order' — put that phrase here; a plain 'the usual'/'same as last time' leaves this null>"|null,
 "question": "<people mix ordering and chatting in ONE message: 'add a J special, and is the jalapeno bites spicy?' — the NON-order part (a question, asking for a suggestion, chit-chat) goes here so it gets ANSWERED alongside the order step; null when the whole message is order actions. NEVER put it in notes. If the ENTIRE message is a question with no order content, use intent 'question' instead>"|null}
BRANCHES: ${branches.map((b) => b.name).join(" | ") || "(single location)"}
Rules: qty defaults 1; ONLY names from MENU — return the name WITHOUT the (category); menu entries read "English name / Arabic name" — BOTH refer to the SAME dish and you ALWAYS return the ENGLISH name; match within the RIGHT category ("fried chicken" → a Chicken item, NEVER a beef burger); a MEAL's sides/drinks spoken with it ("iconic meal with fries and a cola") are that meal's choices — put them in that item's "notes", NEVER as separate items; an unclear/GARBLED word (voice notes!) is SKIPPED, never guessed — but a CLEARLY named product we don't carry ("a cola zero", "red bull") goes into items AS THE GUEST SAID IT (code reports it as unavailable — silently dropping it loses part of the order); if the RECENT CONVERSATION shows the guest already AGREED to a specific dish we recommended ("thats nice i want this" after we pitched it) and it is NOT already in the draft, include that dish in items too — to the guest it's ALREADY on their order and dropping it loses it ("also I want X" means X in ADDITION to it); never duplicate a dish the draft already has; a NEGATION ("I didn't order X", "مطلبتش X") is edits op "remove", never an item — BUT a bare "no" + item + OPTION word ("no, nashville slaw combo, the other is not") is NEVER removal: it's correcting WHICH item has that option → edits op "set_option" per item. DIRECTION MATTERS: the item NAMED WITH the option RECEIVES it — "no, nashville slaw combo, the other is not" = Nashville Slaw GETS combo ([{op:"set_option", item:"Nashville Slaw", option:"combo"}]) and "the other" (the other draft item) gets the opposite ({op:"set_option", item:"<the other item>", option:"sandwich"}); NEVER swap them; removal needs remove-words (remove/take off/شيل/didn't order); an instruction about ONE item ("burger without onion") belongs in that item's "notes", NOT the order-level "notes"; "edits" is for CHANGING an order being built — "add a coke"/"زود كوكاكولا" → op add, "remove the fries"/"شيل البطاطس" → op remove, "make it 2"/"خليهم ٢"/"actually just one" → op set_qty with qty, "no I want the chicken ranch instead"/"actually give me X"/"change it to X"/"مش عايز كذا, عايز X"/"بدل ده هاتلي X" (naming a DIFFERENT menu item to SWAP for one already on the order, mid-question or not) → op replace with "item" = the item being swapped OUT (closest MENU name; omit/null if only one item is on the order so it's unambiguous) and "with" = the item being swapped IN (when they change something, use edits and leave "items" null); "cancel_order" = wants to cancel/scrap the WHOLE order or start over ("cancel it all", "cancel this order", "start over", "forget the whole thing", "الغي الاوردر", "بلاش كله", "من الأول") — removing ONE item is edits op "remove", never cancel_order; "status" = asking where their order is; "confirm" = agreeing to place the order we just summarised (yes/confirm/تمام/اوكي/go ahead); "repeat_last" = wants their usual / same as last time ("same as last time", "the usual", "نفس الطلب", "زي كل مرة", "nafs el order") — items stay null, we rebuild from their history; "question" = the guest is ASKING about the restaurant, not ordering — delivery coverage or fee ("do you deliver to Maadi?", "بتوصلوا المعادي؟ وبكام", "بتوصلوا لحد فين"), hours, ingredients, availability, "do you have tissues" — anything you'd ANSWER rather than put in a cart, even mid-order. CRITICAL: a bare ANSWER to a question WE asked — a size ("Medium"), a drink ("Sprite"), "cash"/"card", a branch name, an address, "yes" — is NEVER "question"; only a real interrogative about the place is.`;
      return chatJSON(MODEL_FAST, sys, input.message, { temperature: 0, maxTokens: 220, budget: config.ai?.budget_extraction === true });
    }, { input: { message: input.message } });
    const e = ex.value || {};
    // A message with NO WORDS (a bare Maps link, a shared pin, a number) cannot contain
    // a question — the extractor once wrote "What is this location for?" for a pin,
    // and that invented question got a whole friendly answer glued above the receipt.
    {
      const wordless = !/\p{L}/u.test(String(input.message || "").replace(/https?:\/\/\S+/g, "").replace(/^\[location\]/i, ""));
      if (wordless && e.question) e.question = null;
      if (wordless && e.intent === "question") e.intent = "other";
    }
    // PICKUP TIME IS CODE'S TO HEAR. "cash, coming now" came back with pickup_time
    // null and the guest was asked "when are you passing by?" again — the answer he'd
    // just given. When pickup is in play and the message carries a time phrase, code
    // fills the slot; the model is only a first reader here, never the last.
    if (!e.pickup_time && (e.order_type === "pickup" || loaded.pending?.order_type === "pickup") && config.ai?.pickup_smart_timing === true) {
      const s0 = String(input.message || "").toLowerCase();
      const TIME_PHRASE = /(\b(now|omw|on my way|coming now|right away|asap)\b|حالا|دلوقتي|جاي|جاية|في الطريق|delwa2ty|dilwa2ty|gay\b|gaya\b|f el taree2|نص ساعة|نصف ساعة|half an? hour|nos sa3a|\d{1,3}\s*(min|mins|minutes?|m\b|دقيقة|دقايق|د\b|d2ee2a|da2ay2|d2ay2)|\d{1,2}\s*(hour|hours|hr|hrs|ساعة|ساعه|sa3a|sa3at)|\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b|الساعة\s*\d{1,2})/iu;
      const m0 = TIME_PHRASE.exec(s0);
      if (m0) e.pickup_time = m0[0].trim();
    }
    // was an option question open when this turn STARTED? (act mutates pending later)
    const awaitingAtTurnStart = !!loaded.pending?.awaiting_option;
    // "أنا بقولك عايز المنيو مش عايز أختار" got the same ask three times — a bare
    // menu request ALWAYS wins, mid-question or not. Draft and open ask stay put.
    const bareMsg = String(input.message || "").replace(/^\[voice\]\s*/i, "").trim();
    const menuAsked = /(منيو|مينيو|menu)/i.test(bareMsg) && bareMsg.length <= 45 && !(e.items?.length || e.edits?.length);

    const outcome = await f.node("act", async () => {
      const name = diner?.name || diner?.wa_profile_name || null;
      if (menuAsked) {
        const pi = loaded.pending?.items || [];
        return { kind: "menu_request", items: pi,
          running: pi.length ? { items: pi, subtotal: pi.reduce((s2, i2) => s2 + itemPrice(i2) * i2.qty, 0), currency } : null };
      }
      // BRANCH: named in this message > their sticky branch. Every order belongs to ONE branch.
      // The extractor's `branch` only counts when the guest actually WROTE it — it once
      // returned "Maxim Mall" for «فيستيفال سيتي مول» (a delivery address), which then
      // swallowed the address. Delivery branches are code's choice anyway (nearest).
      const branchSpoken = e.branch && (() => {
        const bn = normName(e.branch); const msgN = normName(arOptionWords(input.message));
        return !!bn && (msgN.includes(bn) || bn.split(" ").filter((w) => w.length >= 4).some((w) => msgN.includes(w)));
      })();
      const named = (branchSpoken
        ? branches.find((b) => normName(b.name) === normName(e.branch)) ||
          branches.find((b) => normName(b.name).includes(normName(e.branch)) || normName(e.branch).includes(normName(b.name)))
        : null) || matchBranchByText(branches, input.message);
      // "usual"/"same branch" resolves to their remembered branch without retyping it
      const usualKey = branches.some((b) => b.key === diner?.preferred_branch) ? diner.preferred_branch : null;
      const askedUsual = usualKey && /(?<![\p{L}\p{N}])(usual|same branch|نفس الفرع)(?![\p{L}\p{N}])/iu.test(input.message) ? usualKey : null;
      let branch = named?.key || askedUsual || loaded.branch || null;
      if (named && diner?.id && named.key !== diner.preferred_branch) {
        // pre-migration safe: column may not exist yet
        await db.from("diners").update({ preferred_branch: named.key }).eq("id", diner.id).then(({ error }) => {
          if (error) console.log("preferred_branch not saved (run migration 006):", error.message);
        });
      }
      let branchInfo = branches.find((b) => b.key === branch) || null;

      // NOT AN ORDER MESSAGE: the extractor found nothing order-related (no item, edit,
      // type, address, table, payment, branch) and the draft is idle (no items being
      // built, no question we're waiting on). It only reached the order flow because an
      // order session was open — but it's really a question or chit-chat ("do you deliver
      // to Maadi?", "do you have tissues?", "what time do you close?"). Hand it to the
      // normal brain to answer; the draft is left EXACTLY as it was, so the guest picks
      // ordering right back up afterwards (add/edit/confirm all still work). We trust the
      // model's own `intent` here — no keyword lists, no message-length guessing.
      // A QUESTION (delivery coverage/fee, hours, ingredients, "do you have tissues") is
      // ANSWERED by the normal brain, never absorbed into the order — even while we're
      // mid-configuring an item. The extractor flags it as intent "question"; a bare
      // option/branch/payment answer is never flagged that way. This is the fix for
      // "بتوصلوا المعادي؟" jumping to payment while a burger awaited its options.
      if (e.intent === "question") return { kind: "handoff_to_friendly" };
      // Belt-and-suspenders: an "other" message carrying zero order content, when we're
      // not waiting on a specific answer, is chit-chat/a question too → hand it off.
      // A message that ANSWERS a question we just asked is never chit-chat. We flag
      // awaiting_option and awaiting_confirm, but the which-one ask and the PAYMENT ask
      // carried no flag at all — so a bare "Online" or "nashville" scored as zero order
      // content and was handed to the chit-chat brain before the payment matcher ever
      // ran. Live 14 Aug: the guest answered the payment question, the bot wished him a
      // good meal, and no order was ever created.
      const PAY_ANSWER = /^\W*(cash|card|visa|instapay|online|link|كاش|كارت|فيزا|انستاباي|اونلاين|أونلاين|لينك)\b/i;
      // A Maps link / shared pin with a delivery draft open IS the address answer —
      // the extractor calls a bare URL "other" and it was handed to chit-chat, which
      // quoted the old flat zone fee.
      const isPin = !!extractMapLink(input.message) || /^\[location\]/i.test(input.message.trim());
      const answersOpenQuestion = !!loaded.pending?.ambiguous
        || (!!loaded.pending?.items?.length && PAY_ANSWER.test(input.message.trim()))
        || (!!loaded.pending?.items?.length && loaded.pending?.order_type === "delivery" && isPin)
        || (!!loaded.pending?.items?.length && loaded.pending?.awaiting_location === true);
      const notAwaiting = !loaded.pending?.awaiting_option && loaded.pending?.awaiting_confirm !== true && !answersOpenQuestion;
      const noOrderContent = e.intent === "other" && !(e.items?.length) && !(e.edits?.length)
        && !e.order_type && !e.address && !e.table_number && !e.payment_method && !e.pickup_time && !named;
      if (notAwaiting && noOrderContent) return { kind: "handoff_to_friendly" };

      if (e.intent === "cancel_order") {
        // "cancel it ALL" means all of it — the DRAFT dies too, in every branch. It used
        // to survive a cancel and resurrect on the next order with its stale items/options.
        const clearDraft = async () => {
          if (!diner?.id) return;
          const { pending_order: _po, ...restp } = diner.preferences || {};
          await db.from("diners").update({ preferences: restp }).eq("id", diner.id).then(() => {}, () => {});
          loaded.pending = null;
        };
        // A DRAFT in progress is what "cancel" means mid-conversation — a stale placed
        // order (yesterday's, already READY) must never hijack the answer.
        if (loaded.pending?.items?.length) { await clearDraft(); return { kind: "draft_cleared" }; }
        if (!loaded.openOrder) return { kind: "no_open_order" };
        // Founder rule: CONFIRMED = receipt sent = the kitchen owns it — the bot never
        // cancels a placed order. Staff get pinged and decide at the counter.
        await notifyDashboard(db, "order", `⚠️ ${loaded.openOrder.code}: guest asked to CANCEL`, `${name || ctx.sessionId} asked to cancel after confirmation — your call`, ctx.sessionId).catch(() => {});
        return { kind: "too_late_to_cancel", order: publicOrder(loaded.openOrder) };
      }

      if (e.intent === "status") {
        if (!loaded.openOrder) return { kind: "no_open_order" };
        return { kind: "order_status", order: publicOrder(loaded.openOrder) };
      }

      // ---- build the order — CODE matches every item against the real menu and prices it ----
      let items = [];
      let unknown = [];
      const unknownQty = {};
      let ambiguous = [];
      let answeredAmbiguity = null;   // dish resolved from a pending which-one question
      let askedBefore = null;         // the which-one question we already printed, if any
      let removedNames = null;
      const outcomeNotices = [];
      let typeHint = null;
      if (e.intent === "repeat_last") {
        // rebuild from their real history at CURRENT prices; unavailable items are dropped honestly
        const { data: prev } = await db.from("orders").select("*")
          .eq("phone_number", ctx.sessionId).neq("status", "cancelled")
          .order("created_at", { ascending: false }).limit(15);
        // "same as last Tuesday" / "the truffle one I got" → pick the SPECIFIC past order
        // they mean (by weekday or by a dish it contained); a plain "the usual" → most recent.
        let last = prev?.[0];
        const ref = normName(e.reorder_ref || "");
        if (ref && prev?.length) {
          const WD = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
            "الاحد": 0, "الأحد": 0, "الاثنين": 1, "الإثنين": 1, "الثلاثاء": 2, "الاربعاء": 3, "الأربعاء": 3, "الخميس": 4, "الجمعة": 5, "السبت": 6 };
          const wdKey = Object.keys(WD).find((d) => ref.includes(normName(d)));
          const byDay = wdKey != null ? prev.find((o) => new Date(o.created_at).getDay() === WD[wdKey]) : null;
          const byItem = !byDay ? prev.find((o) => (o.items || []).some((it) => {
            const n = normName(it.name); const toks = n.split(" ").filter((t) => t.length >= 4);
            return (n && ref.includes(n)) || toks.some((t) => ref.includes(t));
          })) : null;
          last = byDay || byItem || last;
        }
        if (!last?.items?.length) return { kind: "no_history" };
        for (const it of last.items) {
          const hit = loaded.menu.find((m) => normName(m.name) === normName(it.name));
          if (hit) items.push({ id: hit.id, name: hit.name, qty: Math.min(Number(it.qty) || 1, 20), price: Number(hit.price), notes: it.notes || null, options: it.options || {}, option_defs: hit.options || [] });
          else unknown.push(it.name);
        }
        if (!items.length) return { kind: "no_history" };
        if (["pickup", "delivery"].includes(last.order_type)) typeHint = last.order_type; // dine-in table changes — always re-ask
      } else {
        // A pending "which one did you mean?" — the answer names one candidate; the
        // remembered qty ("3 chicken") rides onto the chosen dish.
        const amb0 = loaded.pending?.ambiguous;
        askedBefore = amb0 || null;
        if (amb0?.candidates?.length) {
          // set when this turn resolves our own "which one did you mean?" — the short-
          // message guard below must never mistake that answer for chit-chat
          const said = normName(arOptionWords(input.message));
          let pick = amb0.candidates.filter((c) => { const n = normName(c); return said === n || said.includes(n); });
          if (!pick.length && said.length >= 4) pick = amb0.candidates.filter((c) => normName(c).includes(said));
          if (!pick.length) pick = amb0.candidates.filter((c) => normName(c).split(" ").filter((t) => t.length >= 3).some((t) => said.includes(t)));
          // "1" / "2" / "the second one" — people answer a printed list by position.
          if (!pick.length) {
            const nth = /^\D{0,6}([1-9])\D{0,8}$/.exec(input.message.trim())?.[1]
              || { first: 1, second: 2, third: 3, fourth: 4, "الاول": 1, "الأول": 1, "التاني": 2, "الثاني": 2, "التالت": 3, "الثالث": 3 }[said];
            if (nth && amb0.candidates[Number(nth) - 1]) pick = [amb0.candidates[Number(nth) - 1]];
          }
          // TYPOS. A guest answering our own printed list wrote "nashvile" and every
          // matcher above is exact-containment, so his answer was re-resolved against
          // the WHOLE menu and he got asked a WIDER question than the one he'd just
          // answered. Compare his words to each candidate's DISTINGUISHING tokens
          // (the ones the candidates don't share) with edit-distance tolerance, and
          // only take it when exactly one candidate is in reach — never guess between two.
          if (!pick.length && said.length >= 4) {
            const tokensOf = (c) => normName(c).split(" ").filter((t) => t.length >= 4);
            const shared = new Set(
              tokensOf(amb0.candidates[0]).filter((t) => amb0.candidates.every((c) => tokensOf(c).includes(t))),
            );
            const saidToks = said.split(" ").filter((t) => t.length >= 4);
            const hits = amb0.candidates.filter((c) =>
              tokensOf(c).filter((t) => !shared.has(t)).some((t) =>
                saidToks.some((s) => editDistance(s, t) <= (t.length <= 5 ? 1 : 2))));
            if (hits.length === 1) pick = hits;
          }
          if (pick.length === 1) {
            answeredAmbiguity = pick[0];
            // The guest picked from the list WE printed — that BEATS whatever the
            // extractor guessed. Live 14 Aug: he answered our Classic-or-Nashville
            // TENDERS question with "nashvile", the model guessed "Nashville Slaw",
            // the guess won, and he was walked through options for a dish he never
            // asked for. Anything else he named in the same breath ("and a coke")
            // is genuinely additional and stays.
            const qty = Math.min(Math.max(Math.round(Number(amb0.qty || e.items?.[0]?.qty) || 1), 1), 20);
            // A SHORT reply to a which-one is purely the answer. The extractor reads the
            // same word its own way ("classic" → Classic Burger), and keeping that guess
            // alongside the pick added the dish AND asked a wider question in the same
            // breath. Only a longer message can carry a genuine extra dish.
            const shortAnswer = said.split(" ").filter(Boolean).length <= 4;
            const others = shortAnswer ? [] : (e.items || []).filter((it) => {
              const n = normName(it.name);
              return n && n !== normName(pick[0]) && !amb0.candidates.some((c) => normName(c) === n)
                && (said.includes(n) || n.split(" ").filter((t) => t.length >= 4).some((t) => said.includes(t)));
            });
            e.items = [{ name: pick[0], qty, notes: e.items?.[0]?.notes || null }, ...others];
            // The model's own reading of the same word may also sit in `edits` ("add
            // Chocolate SAUCE" for "zawed chocolate") and would be applied on top of
            // the pick — the answer to our list is the whole message, drop those.
            if (shortAnswer && Array.isArray(e.edits)) e.edits = e.edits.filter((ed) => ed?.op !== "add" && ed?.op !== "replace");
          }
        }
        // WE JUST LISTED SOME DISHES; A SHORT REPLY PICKS ONE. "any milkshake?" → we
        // name Vanilla and Chocolate → "lets add chocolate". The extractor got that
        // wrong three different ways (added the sauce, duplicated the tenders, dropped
        // it) — because it's a guess. CODE reads our own last message, finds the dishes
        // we named, and if the guest's words single out exactly one, that dish is the
        // answer and overrides the model. Founder's pick, 16 Aug: context is decided by
        // OUR text (verifiable), never by trusting the model harder.
        {
          const lastAi = String([...(input.history || [])].reverse().find((h) => h.role === "ai")?.message || "");
          const shortReply = input.message.trim().split(/\s+/).filter(Boolean).length <= 6;
          if (lastAi && shortReply && !amb0?.candidates?.length && !loaded.pending?.awaiting_option) {
            const lastLc = lastAi.toLowerCase();
            const arNz = (s2) => String(s2 || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
            const lastAr = arNz(lastAi);
            // dishes we named in our own last message (either script). Token-wise, not
            // exact: the host writes "Chocolate Milkshake" for menu name "Milkshake
            // Chocolate" — every word of the name present counts as named.
            const lastToksEn = new Set(normName(lastAi).split(" ").filter(Boolean));
            const lastToksAr = new Set(lastAr.split(/[^؀-ۿ]+/).filter(Boolean));
            const offered = loaded.menu.filter((m) => {
              if (m.available === false) return false;
              const enT = normName(m.name).split(" ").filter((t) => t.length >= 2);
              if (enT.length && enT.every((t) => lastToksEn.has(t))) return true;
              const arT = arNz(m.name_ar || "").split(/\s+/).filter((t) => t.length >= 2 && !/^[٠-٩]+$/.test(t));
              return arT.length > 0 && arT.every((t) => lastToksAr.has(t));
            });
            if (offered.length >= 2) {
              const said = normName(arOptionWords(input.message));
              const saidAr = arNz(input.message);
              const STOP = new Set(["the", "one", "please", "add", "lets", "let", "and", "with", "of", "a", "an", "me", "want", "get", "make", "it", "that", "this", "ok", "yes"]);
              const saidToks = said.split(" ").filter((t) => t.length >= 3 && !STOP.has(t));
              const arSaidToks = saidAr.split(/\s+/).filter((t) => t.length >= 3);
              // a token that belongs to SOME offered dishes but not ALL of them tells them apart
              const scored = offered.map((m) => {
                const enT = normName(m.name).split(" ");
                const arT = arNz(m.name_ar || "").split(/\s+/).filter(Boolean);
                const hitsEn = saidToks.filter((t) => enT.some((x) => x === t || (x.length > 4 && t.length > 4 && editDistance(x, t) <= 1))).length;
                const hitsAr = arSaidToks.filter((t) => arT.some((x) => x === t || x.includes(t) || t.includes(x))).length;
                return { m, hits: hitsEn + hitsAr };
              }).filter((s2) => s2.hits > 0).sort((a, b) => b.hits - a.hits);
              const best = scored[0];
              const unique = best && (scored.length === 1 || scored[1].hits < best.hits);
              if (unique) {
                const qty = Math.min(Math.max(Math.round(Number(e.items?.[0]?.qty || e.edits?.[0]?.qty) || 1), 1), 20);
                const notes = (e.items || []).find((it) => normName(it.name) === normName(best.m.name))?.notes || null;
                // the pick replaces whatever the model guessed for THIS reply — a short
                // reply to our list carries no other dish
                e.items = [{ name: best.m.name, qty, notes }];
                if (Array.isArray(e.edits)) e.edits = e.edits.filter((ed) => ed?.op !== "add" && ed?.op !== "replace");
                answeredAmbiguity = best.m.name;
              }
            }
          }
        }
        const wanted = (e.items || []).slice(0, 12);
        for (const w of wanted) {
          const n = normName(w.name);
          // Arabic-only names normalize to "" — empty containment matches the WHOLE
          // menu (a real guest's بيبسي got burger candidates). Unknown path owns it.
          if (!n) { unknown.push(String(w.name)); unknownQty[String(w.name)] = Math.min(Math.max(Math.round(Number(w.qty) || 1), 1), 20); continue; }
          const exactHit = loaded.menu.find((m) => normName(m.name) === n);
          const cands = exactHit ? [exactHit] : loaded.menu.filter((m) => normName(m.name).includes(n) || n.includes(normName(m.name)));
          if (!cands.length) { unknown.push(w.name); unknownQty[String(w.name)] = Math.min(Math.max(Math.round(Number(w.qty) || 1), 1), 20); continue; }
          // "chicken" fits 4 dishes → ASK which one, never guess; exactly one fuzzy
          // fit ("caramelized burger" → Double Caramelized Burger) auto-takes.
          if (cands.length > 1) {
            // mid-ask, an ambiguous word is almost always an ANSWER fragment ("full
            // meal pepsi") — the options resolver owns it; never interrupt with which-one
            if (loaded.pending?.awaiting_option) continue;
            ambiguous.push({ said: String(w.name), qty: Math.min(Math.max(Math.round(Number(w.qty) || 1), 1), 20), candidates: cands.slice(0, 4).map((m) => m.name) });
            continue;
          }
          const hit = cands[0];
          // a CHICKEN request may never silently land on a beef item — better to
          // ask than to serve the wrong animal
          const saidChicken = /chicken|تشيكن|فراخ|فرايد/i.test(`${w.name} ${w.notes || ""}`);
          const isChickenItem = /chicken|wrap|تشيكن|فراخ/i.test(`${hit.name} ${hit.category || ""}`);
          if (saidChicken && !isChickenItem) { unknown.push(String(w.name)); continue; }
          const qty = Math.min(Math.max(Math.round(Number(w.qty) || 1), 1), 20);
          // The extractor over-specifies ("iconic" quietly becomes "Iconic Meal").
          // If the guest's OWN words fit several dishes and don't pin this one, ask —
          // a fragment pinning exactly one dish ("caramelised burger") still auto-takes.
          {
            const msgN2 = normName(arOptionWords(input.message));
            const hitN = normName(hit.name);
            // The guest may have said the dish by its ARABIC menu name. Judge the
            // guard against BOTH names — «تشيكن تندرز ناشفيل» pins the tenders exactly,
            // yet contains no English token, and was widened into "which chicken?".
            // Word-by-word, so a guest who drops the trailing "٣ قطع" still counts as
            // having named it.
            // (normName strips Arabic to "" — this check needs a script-aware normaliser)
            const arN = (s2) => String(s2 || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^؀-ۿ]+/g, " ").trim();
            const msgAr = ` ${arN(input.message)} `;
            const arToksOf = (s2) => arN(s2).split(" ").filter((t) => t.length >= 3 && !/^[٠-٩]+$/.test(t));
            const hitArToks = arToksOf(hit.name_ar);
            const arHits = (toks) => toks.filter((t) => msgAr.includes(` ${t} `)).length;
            // enough of the hit's Arabic words are in the message, and no OTHER dish's
            // Arabic name is matched more completely (Nashville Slaw vs Nashville Fiery)
            const namedInArabic = hitArToks.length > 0 && arHits(hitArToks) >= Math.min(2, hitArToks.length)
              && !loaded.menu.some((m) => {
                if (m.id === hit.id || !m.name_ar) return false;
                const t2 = arToksOf(m.name_ar);
                return t2.length > 0 && arHits(t2) === t2.length && arHits(t2) > arHits(hitArToks);
              });
            // A dish the guest just chose from OUR printed list is not the extractor
            // over-specifying — it's an answer. Without this, "nashvil" resolved
            // correctly to Chicken Tenders Nashville and was then re-ambiguated into a
            // WIDER question (Slaw / Fiery / Tenders) because the guest's short word
            // didn't contain the full dish name. That is the loop the founder hit twice.
            // CONTEXT BEATS THE GUARD (founder call, 16 Aug): the extractor reads the
            // conversation and resolves "chocolate" to Milkshake Chocolate right after
            // WE listed the milkshakes — then this guard, blind to context, re-asked
            // "which chocolate?" on the very turn the shake was added. If OUR last
            // message named the picked dish or its category, the pick is accepted:
            // code-verifiable (our own text), zero cost, and it can only ever let
            // through a dish we put on the table ourselves.
            const lastAi = String([...(input.history || [])].reverse().find((h) => h.role === "ai")?.message || "").toLowerCase();
            const hitCatN = normName(hit.category || "");
            const catToks = hitCatN.split(" ").filter((t) => t.length >= 4);
            const weOfferedIt = !!lastAi && (
              lastAi.includes(String(hit.name).toLowerCase())
              || (hit.name_ar && lastAi.includes(String(hit.name_ar)))
              || (catToks.length > 0 && catToks.some((t) => lastAi.includes(t) || lastAi.includes(t.replace(/s$/, ""))))
            );
            if (!msgN2.includes(hitN) && !namedInArabic && !weOfferedIt && hitN !== normName(answeredAmbiguity || "")) {
              const near = (t) => msgN2.includes(t) || (t.length >= 5 && msgN2.includes(t.slice(0, 5)));
              const fragToks = hitN.split(" ").filter((t) => t.length >= 3 && near(t));
              if (fragToks.length) {
                const fragHits = loaded.menu.filter((m) => { const n2 = normName(m.name); return fragToks.every((t) => n2.includes(t)); });
                if (fragHits.length > 1) {
                  if (loaded.pending?.awaiting_option) continue; // answer fragment, not a dish
                  ambiguous.push({ said: fragToks.join(" "), qty, candidates: fragHits.slice(0, 4).map((m) => m.name) });
                  continue;
                }
              }
            }
          }
          // "no onion", "extra sauce" ride WITH the item so the kitchen sees them on the line
          items.push({ id: hit.id, name: hit.name, qty, price: Number(hit.price), notes: (w.notes || "").trim() || null, options: {}, option_defs: hit.options || [] });
        }
        // "iconic meal with fries and a cola" — the fries/drink are the MEAL's
        // option choices, not separate order lines. Any matched item whose name
        // also names a choice inside another matched item's option groups
        // collapses into that group: exactly one choice hit = answered; several
        // (a bare "fries") = dropped and the group gets asked. Pure code.
        if (items.length > 1) {
          const absorbed = new Set();
          for (const host of items) {
            for (const g of host.option_defs || []) {
              if (g.key === "slots") continue;
              const choices = (g.choices || []).filter((c) => c?.name);
              if (!choices.length) continue;
              for (const other of items) {
                if (other === host || absorbed.has(other) || other.qty > host.qty) continue;
                const oNorm = normName(other.name);
                if (!oNorm) continue;
                const hitsC = choices.filter((c) => {
                  const cn = normName(c.name);
                  return cn === oNorm || cn.includes(oNorm) || oNorm.includes(cn);
                });
                if (!hitsC.length) continue;
                absorbed.add(other);
                if (hitsC.length === 1 && !host.options[g.key]) host.options[g.key] = hitsC[0].name;
              }
            }
          }
          if (absorbed.size) items = items.filter((it) => !absorbed.has(it));
        }

        // Mid-order, a SHORT reply is an answer to our question — never a new order.
        // The extractor happily matches "French fries" or "sprite" to a menu item;
        // letting that through replaces the burger being configured with a side.
        // The two mid-order intents that ARE new information get handled in code,
        // because the extractor is not reliable enough to carry them:
        //   "add a loaded fries"  → append (add-verb + an item not on the draft)
        //   "make it just 1"      → qty change (same item, different qty, or the
        //                            bare deterministic form below)
        const ADD_VERB = /(?<![\p{L}\p{N}])(add|also|kaman|zawe?d|زود|كمان|ضيف|وهات)(?![\p{L}\p{N}])/iu;
        // a draft older than 20 min is an abandoned session, not the context for
        // this message — a fresh "2 iconic meals" then REPLACES it instead of
        // being swallowed by "how would you like to pay?" about old food
        const draftAgeMs = Date.now() - new Date(loaded.pending?.at || 0).getTime();
        const draftStale = draftAgeMs > 20 * 60_000;
        if (loaded.pending?.items?.length && input.message.trim().length <= 28 && items.length && !e.edits?.length && !draftStale) {
          const prev = loaded.pending.items;
          // A dish the guest NAMED is never chit-chat. This guard exists so a short
          // reply mid-draft ("sprite") isn't mistaken for a new order — but it used to
          // require an add-word or a leading digit, so "Nashville Slaw" (14 chars, our
          // own which-one answer) was silently discarded and the guest watched the bot
          // skip to payment with only the old line on the bill.
          const msgN0 = normName(arOptionWords(input.message));
          const spokenHere = (nm) => { const n = normName(nm); return !!n && msgN0.includes(n); };
          if (items.length === 1 && !loaded.pending.awaiting_option) {
            const line = prev.find((it) => normName(it.name) === normName(items[0].name));
            if (line && Number(items[0].qty) !== Number(line.qty) && /\d|one|two|three|واحد|اتنين|٢|١/i.test(input.message)) {
              line.qty = items[0].qty;
            } else if (!line && (answeredAmbiguity || spokenHere(items[0].name) || ADD_VERB.test(input.message) || /^\s*\d/.test(input.message))) {
              // answering our which-one question, naming the dish outright, "add a
              // loaded fries", or a leading quantity ("2 cokes") — all genuine additions
              prev.push(items[0]);
            }
          } else if (!loaded.pending.awaiting_option) {
            // several dishes in one short message ("burger and fries") — keep every one
            // the guest actually said instead of dropping the lot
            for (const ni of items) {
              if (!prev.find((pp) => normName(pp.name) === normName(ni.name)) && spokenHere(ni.name)) prev.push(ni);
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
          // NEW dishes spoken during an option ask are ADDED, never lost ("js special
          // combo and the nashville slaw as a combo too" mid-ask must keep everything).
          // But an option ANSWER the extractor mis-read as an item ("sprite", "French
          // fries" while we asked the meal's questions) must not become a phantom line:
          // anything matching a CHOICE name of the awaited item's groups is an answer.
          const awaited = loaded.pending.items[loaded.pending.awaiting_option.index] || null;
          const choiceNames = new Set();
          for (const g of awaited?.option_defs || []) {
            for (const c of groupChoices(g, loaded.menu)) if (c?.name) choiceNames.add(normName(c.name));
            for (const sg of g.slot_groups || []) for (const cn of slotChoiceNames(sg, loaded.menu)) choiceNames.add(normName(cn));
          }
          // containment counts, not just exact: the extractor says "American Truck Meal"
          // while the slot choice says "American Truck" — still the same answer-word,
          // never a new order line
          const choiceArr = [...choiceNames];
          // The matched dish must also have actually been SPOKEN. "pepsi" fuzzy-matched
          // the "Soft Drink" menu item and added a 50 EGP line the guest never ordered —
          // when the message names neither the dish nor an add-word, it's an attempted
          // ANSWER for the open question and the resolver owns it.
          const msgN = normName(arOptionWords(input.message));
          const ADD_WORDS = /(?<![\p{L}])(add|another|also|plus|كمان|تاني|زود|هات)(?![\p{L}])/iu;
          const additions = items.filter((ni) => {
            const n = normName(ni.name);
            if (loaded.pending.items.find((it) => normName(it.name) === n)) return false;
            if (choiceArr.some((cn) => cn === n || n.includes(cn) || cn.includes(n))) return false;
            const spoken = msgN.includes(n) || n.split(" ").filter((t) => t.length >= 3).some((t) => msgN.includes(t));
            return spoken || ADD_WORDS.test(input.message);
          });
          // The awaited dish re-spoken WITH a note carries this turn's modification —
          // "sandwich but without the bbq" rode on the extractor's copy of the line,
          // and dropping that copy silently dropped the note with it.
          for (const ni of items) {
            if (!ni.notes) continue;
            const prev = loaded.pending.items.find((it) => normName(it.name) === normName(ni.name));
            if (prev && !String(prev.notes || "").toLowerCase().includes(String(ni.notes).toLowerCase())) {
              prev.notes = [prev.notes, ni.notes].filter(Boolean).join(" · ");
            }
          }
          loaded.pending.items.push(...additions);
          items = loaded.pending.items;
          unknown = [];
        }
        // A draft exists and the guest named items with NO option question open: that's
        // adding or updating, NEVER starting over — the unmentioned dishes stay. Items
        // they re-named keep previously answered options unless restated.
        else if (loaded.pending?.items?.length && items.length) {
          for (const ni of items) {
            const prev = loaded.pending.items.find((p) => normName(p.name) === normName(ni.name));
            if (prev?.options && Object.keys(prev.options).length) ni.options = { ...prev.options, ...ni.options };
          }
          const namedNew = new Set(items.map((i) => normName(i.name)));
          items = [...loaded.pending.items.filter((p) => !namedNew.has(normName(p.name))), ...items].slice(0, 12);
        }
        // nothing new — carry the in-progress order across turns
        if (!items.length && loaded.pending?.items?.length) { items = loaded.pending.items; unknown = []; }

        // "remove the croquette fries" / "I didn't order that" — removal is
        // code's job. A named pending line goes, whatever the extractor said.
        const NEG_REMOVE = /(?<![\p{L}\p{N}])(remove|take (it |that )?off|didn'?t (choose|order|want|ask for)|never (ordered|asked)|شيل|شيلي|امسح|الغي|مش عايز|ماطلبتش|مطلبتش)(?![\p{L}\p{N}])/iu;
        if (loaded.pending?.items?.length > 1 && NEG_REMOVE.test(input.message)) {
          const saidR = normName(arOptionWords(input.message));
          const kept = loaded.pending.items.filter((it) => {
            const n = normName(it.name);
            const tok = n.split(" ").filter((t) => t.length >= 4);
            return !(saidR.includes(n) || (tok.length && tok.every((t) => saidR.includes(t))));
          });
          if (kept.length < loaded.pending.items.length && kept.length > 0) {
            const gone = loaded.pending.items.filter((it) => !kept.includes(it)).map((it) => it.name);
            loaded.pending.items = kept;
            items = kept;
            unknown = [];
            if (e.edits) e.edits = null; // handled here — don't double-apply
            removedNames = gone;
          }
        }

        // ---- EDITS: "add a coke" / "remove the fries" / "make it 2" ----
        // Applied by CODE against the order being built, so changing your mind is a
        // guarantee, not a matter of extraction luck. Edits always operate on the
        // DRAFT — if the extractor also echoed items, they'd otherwise replace it.
        if (e.edits?.length && loaded.pending?.items?.length) {
          items = loaded.pending.items;
          unknown = [];
        }
        // shared by "add" and "replace" — both need to turn an extractor-named item
        // into a real menu row the same way
        const findMenuItem = (want) => {
          const w = normName(want || "");
          if (!w) return null;
          const exact = loaded.menu.find((m) => normName(m.name) === w);
          if (exact) return exact;
          const cands = loaded.menu.filter((m) => normName(m.name).includes(w) || w.includes(normName(m.name)));
          if (cands.length > 1) { ambiguous.push({ said: String(want), qty: 1, candidates: cands.slice(0, 4).map((m) => m.name) }); return null; }
          return cands[0] || null;
        };
        // op "set_option": "no, the SLAW is the combo, the other one isn't" — reassigning
        // an option between items, applied by code against the item's real choice lists.
        // Ambiguous matches set nothing (the walk re-asks) — never a guess.
        const applyOptionTo = (it, want) => {
          const w = normName(want || "");
          if (!w || !it) return false;
          for (const g of it.option_defs || []) {
            if (g.key === "slots") continue;
            const opts = groupChoices(g, loaded.menu);
            let hit = opts.find((o) => normName(o.name) === w) || null;
            if (!hit) {
              const near = opts.filter((o) => normName(o.name).includes(w) || w.includes(normName(o.name)));
              hit = near.length === 1 ? near[0] : null;
            }
            if (hit) { it.options[g.key] = hit.name; return true; }
          }
          return false;
        };
        // An instruction we CANNOT apply must be said out loud. Silently skipping it
        // leaves the guest certain their change landed — they walk away believing the
        // fries are off the order and find them on the bill. Same rule as an unknown
        // dish: name it, show what's actually there, let them correct us.
        const editMisses = [];
        // A dish the guest NEVER NAMED can't be added or swapped in. The extractor is
        // sampled, and one run of "sandwich but without the bbq" came back as
        // "replace Smoky BBQ Burger with Classic Burger" — nobody said "classic".
        // The incoming dish must be spoken in the message (either script, a
        // distinguishing token is enough) or the edit is dropped as noise.
        const saidForEdits = normName(arOptionWords(input.message));
        const saidArForEdits = String(input.message || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
        const guestNamed = (dish) => {
          const row = findMenuItem(dish);
          const en = normName(row?.name || dish || "");
          const enOk = !!en && (saidForEdits.includes(en) || en.split(" ").filter((t) => t.length >= 4).some((t) => saidForEdits.includes(t) || (t.length >= 5 && saidForEdits.split(" ").some((w) => editDistance(w, t) <= 1))));
          const ar = String(row?.name_ar || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
          const arOk = !!ar && ar.split(/\s+/).filter((t) => t.length >= 3 && !/^[٠-٩]+$/.test(t)).some((t) => saidArForEdits.includes(t));
          return enOk || arOk;
        };
        for (const ed of (e.edits || []).slice(0, 6)) {
          if ((ed?.op === "add" && ed.item && !guestNamed(ed.item)) || (ed?.op === "replace" && ed.with && !guestNamed(ed.with))) {
            log(`order: dropped model edit ${ed.op} → "${ed.with || ed.item}" — the guest never named it`);
            continue;
          }
          const target = normName(ed.item || "");
          // "make it just 1" / "no I want X instead" (only one item on the order) names
          // no item to replace FROM — with a single-line draft there is exactly one
          // thing it can mean, so resolve it in code rather than making the LLM guess
          // a name back at us for something already unambiguous.
          if (!target && ed.op !== "add" && items.length === 1) {
            if (ed.op === "remove") { items.splice(0, 1); continue; }
            if (ed.op === "set_option") { applyOptionTo(items[0], ed.option); continue; }
            if (ed.op === "set_qty") { items[0].qty = Math.min(Math.max(Math.round(Number(ed.qty) || 1), 1), 20); continue; }
            if (ed.op === "replace") {
              const hit = findMenuItem(ed.with);
              if (!hit) { unknown.push(ed.with); continue; }
              // swapping items is a fresh choice — any option-walk in progress was
              // about the item that just left the order, not this new one
              loaded.pending.awaiting_option = null;
              items[0] = { id: hit.id, name: hit.name, qty: items[0].qty, price: Number(hit.price), notes: null, options: {}, option_defs: hit.options || [] };
              continue;
            }
          }
          if (!target) { editMisses.push(String(ed.item || ed.with || "").trim()); continue; }
          if (ed.op === "add") {
            const hit = findMenuItem(ed.item);
            if (!hit) { unknown.push(ed.item); continue; }
            const q = Math.min(Math.max(Math.round(Number(ed.qty) || 1), 1), 20);
            const existing = items.find((it) => it.id === hit.id && !Object.keys(it.options || {}).length);
            if (existing) existing.qty = Math.min(existing.qty + q, 20);
            else items.push({ id: hit.id, name: hit.name, qty: q, price: Number(hit.price), notes: null, options: {}, option_defs: hit.options || [] });
          } else {
            const idx = items.findIndex((it) => normName(it.name).includes(target) || target.includes(normName(it.name)));
            if (idx < 0) { editMisses.push(String(ed.item || "").trim()); continue; }
            if (ed.op === "remove") items.splice(idx, 1);
            else if (ed.op === "set_option") applyOptionTo(items[idx], ed.option);
            else if (ed.op === "set_qty") items[idx].qty = Math.min(Math.max(Math.round(Number(ed.qty) || 1), 1), 20);
            else if (ed.op === "replace") {
              const hit = findMenuItem(ed.with);
              if (!hit) { unknown.push(ed.with); continue; }
              loaded.pending.awaiting_option = null;
              items[idx] = { id: hit.id, name: hit.name, qty: items[idx].qty, price: Number(hit.price), notes: null, options: {}, option_defs: hit.options || [] };
            }
          }
        }
        {
          const misses = editMisses.filter(Boolean);
          if (misses.length) {
            const have = items.map((it) => it.name).join("، ");
            const haveEn = items.map((it) => it.name).join(", ");
            outcomeNotices.push(L2(
              `Couldn't find ${misses.join(", ")} on your order 🙏${haveEn ? ` — you have ${haveEn}` : ""}`,
              `ملقيتش ${misses.join("، ")} في طلبك 🙏${have ? ` — عندك ${have}` : ""}`,
              `Mala2etsh ${misses.join(", ")} fe orderak 🙏${haveEn ? ` — 3andak ${haveEn}` : ""}`,
            ));
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
      // A type the guest ALREADY chose only changes when they actually say a type word
      // this turn. The model read "cash w gay delwa2ty" (cash, coming now) as DELIVERY,
      // flipped a pickup mid-order and demanded an address — code checks the message.
      {
        const prevType = loaded.pending?.order_type;
        const TYPE_SAID = /(dine.?in|pick.?up|take.?away|takeaway|deliver|delivery|توصيل|دليفري|ديليفري|استلام|تيك ?اواي|تيك ?أواي|في المطعم|هاكل هنا|هناكل هنا|3ala el makan|f el mat3am)/iu;
        if (prevType && orderType && orderType !== prevType && !TYPE_SAID.test(String(input.message || ""))) orderType = prevType;
      }
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
      // "same/usual" explicitly names the ask; a bare "yes" is just as much an answer
      // to "same as before, or somewhere new?" and was previously only understood as
      // one of those two exact words — so an honest "yes" fell through, unmatched,
      // and the guest got the identical question again instead of their address.
      const reuse = matchSaved(input.message, saved) ||
        (saved.length === 1 && (/(?<![\p{L}\p{N}])(same|usual|نفس|زي كل مرة)(?![\p{L}\p{N}])/iu.test(input.message) || BARE_YES.test(input.message.trim())) ? saved[0] : null);
      if (reuse && !loaded.pending?.address) address = reuse.text;
      // Deterministic address capture: we're mid-delivery waiting for the address,
      // nothing else in the message fits — the guest's words ARE the address. The
      // extractor misses bare areas ("Nasr City") and the guest got re-asked forever.
      // NEVER while an option question is open: "Medium" during the size ask is the
      // ANSWER, not an address — capturing it as one poisoned the draft (fake area →
      // false "we don't deliver", size re-asked forever, every later answer eaten).
      // The guest answered our "which place?" by tapping/typing one of the offered
      // candidates — that IS the point, no re-resolving.
      let pickedPlace = null;
      if (Array.isArray(loaded.pending?.place_candidates) && loaded.pending.place_candidates.length) {
        const said = norm2(input.message);
        const nth = /^\D{0,6}([1-3])\D{0,8}$/.exec(input.message.trim())?.[1];
        pickedPlace = (nth && loaded.pending.place_candidates[Number(nth) - 1])
          || loaded.pending.place_candidates.find((c) => { const l = norm2(c.label); return l && (said === l || said.includes(l) || l.includes(said) && said.length >= 4); })
          || null;
      }
      const awaitingLocation = !!loaded.pending?.awaiting_location;
      if (!address && orderType === "delivery" && loaded.pending?.order_type === "delivery" && items.length && !loaded.pending?.awaiting_option) {
        // "cash, Festival City Mall" — the payment word is an answer AND the rest is the
        // address. Peel leading pay/type words (and separators) off; what remains is
        // judged as the address. Only a message that is NOTHING BUT the command is skipped.
        const LEAD = /^(?:(?:cash|card|visa|instapay|online|كاش|كارت|فيزا|بطاقة|انستاباي|dine.?in|pick.?up|pickup|delivery|توصيل|دليفري|استلام|في المطعم|w|and|و|,|،|-|\s)+)/iu;
        // "o1 new cairo maybe?" — a hedge with a question mark is still an address,
        // not a question. Hedges are stripped before the "is it a question?" test.
        const HEDGE = /\s*(maybe|probably|i think|i guess|ya3ny|yemken|يمكن|تقريبا|تقريباً|ممكن|غالبا|غالباً)\s*[?؟]*\s*$/iu;
        const t0 = input.message.trim().replace(HEDGE, "").trim();
        const t = t0.replace(LEAD, "").trim();
        const isCommand = (e.items?.length) || (e.edits?.length) || BARE_YES.test(t0) || /[?؟]\s*$/.test(t0) || !t;
        // structure it here, once, so the ticket and the driver page both read a
        // proper address instead of each re-deriving one from a blob
        if (!isCommand && t.length >= 3 && t.length <= 300) address = formatAddress(parseAddress(t)) || t;
      }
      const sharedPin = freshLocation(diner, 1);
      // After "share your location / which place?", a new place name REPLACES the
      // unplaceable one ("Levels Mall" → "point 90 mall"), and it never goes to chit-chat.
      if (awaitingLocation && orderType === "delivery" && items.length && !pickedPlace && mapLink?.lat == null && !sharedPin) {
        const t2 = input.message.trim().replace(/\s*(maybe|probably|i think|ya3ny|yemken|يمكن|تقريبا|تقريباً|ممكن|غالبا|غالباً)\s*[?؟]*\s*$/iu, "").trim();
        const looksLikePlace = t2.length >= 3 && t2.length <= 120 && !/[?؟]\s*$/.test(t2) && !(e.items?.length) && !(e.edits?.length) && !BARE_YES.test(t2);
        if (looksLikePlace && norm2(t2) !== norm2(address || "")) address = t2;
      }
      // A TYPED address becomes a point too (landmark table → OpenStreetMap, free), so
      // distance-priced restaurants can quote it and every restaurant can check the
      // zone by geometry, not just by area words. A pin/Maps link always wins.
      let geoPoint = null;
      let placeCandidates = null;
      let outsideArea = null; // the guest NAMED an area we know we don't cover
      if (pickedPlace) geoPoint = pickedPlace;
      else if (orderType === "delivery" && address && mapLink?.lat == null && !sharedPin) {
        // a point the draft already resolved for THIS address text is reused (no re-geocode)
        const prev = loaded.pending?.delivery_point;
        if (prev && loaded.pending?.address && norm2(loaded.pending.address) === norm2(address) && prev.lat != null) geoPoint = prev;
        else {
          const r = await resolvePlace(config, address, { cityHint: config.basic_info?.city || "New Cairo" }).catch(() => ({ none: true }));
          if (r.point) geoPoint = r.point;
          else if (r.candidates) placeCandidates = r.candidates;
          else if (r.outside) outsideArea = r.area || true;
        }
      }
      const deliveryPoint = (mapLink?.lat != null ? mapLink : null) || sharedPin || geoPoint || null;

      // DELIVERY: the guest never picks the kitchen — code does. Nearest branch by
      // coordinates when we have a pin/Maps link, else the branch whose area the
      // typed address mentions, else their usual branch, else the first one.
      if (orderType === "delivery" && !branch && (deliveryPoint || address)) {
        const pt = deliveryPoint;
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

      // DELIVERY COVERAGE GATE: with zones configured, never take a delivery order to an
      // area we don't cover, while delivery is paused, or below the minimum — say so
      // honestly and offer pickup. (Code decides from config; the reply is phrased below.)
      if (orderType === "delivery" && (address || deliveryPoint)) {
        const sub = items.reduce((s2, i2) => s2 + itemPrice(i2) * i2.qty, 0);
        const dq = deliveryQuote(config, { area: address, coords: deliveryPoint, subtotal: sub });
        if (!dq.available && dq.reason === "paused") return { kind: "delivery_paused", items };
        if (!dq.available && dq.reason === "hours") return { kind: "delivery_closed", items, hours: dq.hours };
        // "Uncovered" is only honest when we could actually PLACE the address — by an
        // area word or by a point — and it fell outside every zone. A typed address
        // that names no known area and didn't geocode ("villa 7, street 12, next to
        // the pharmacy") is UNKNOWN, not outside: ask for a pin instead of turning the
        // guest away.
        const placed = !!deliveryPoint || !!outsideArea;
        // Several plausible places → ask WHICH (tappable), don't guess a fee and don't
        // demand a pin yet. Handled after savePending exists (var hoisted).
        var whichPlace = !placed && placeCandidates?.length ? placeCandidates : null;
        if (whichPlace) { /* fallthrough to the block below */ }
        else if (outsideArea) return { kind: "no_delivery_area", items, branch: branchInfo?.name || null };
        else if (dq.available && dq.covered === false && dq.has_zones && placed) return { kind: "no_delivery_area", items, branch: branchInfo?.name || null };
        if (dq.covered && dq.min_order && !dq.meets_min) return { kind: "below_min_order", items, min_order: dq.min_order };
        // Ask for a pin when (a) the address couldn't be placed at all, or (b) it's in a
        // covered zone but the restaurant prices by DISTANCE and we have no point.
        // Handled just below, once savePending/runningOf exist in scope.
        var needPinArea = (dq.covered === false && dq.has_zones && !placed) ? true
          : (dq.covered && dq.needs_pin) ? (dq.area || true) : null;
      }

      // remember the in-progress order so the next short answer doesn't lose it
      const savePending = async (extra = {}) => {
        if (!diner?.id) return;
        // MERGE over the previous draft — rebuilding from scratch erased fields
        // other gates had saved (payment_method said early, upsell_offered, …)
        // Delivery fee comes from the configured zones (code computes, never guessed) so
        // the bill matches what the bot quotes. Only set when the area is actually covered;
        // otherwise leave it untouched (back-compat: no zones configured → no fee change).
        const subtotal = items.reduce((s2, i2) => s2 + itemPrice(i2) * i2.qty, 0);
        const dq = orderType === "delivery"
          ? deliveryQuote(config, { area: address, coords: deliveryPoint, subtotal })
          : null;
        const pending_order = {
          ...(loaded.pending || {}),
          items, order_type: orderType, table_number: tableNumber, branch, address, map_link: mapLinkRaw,
          ambiguous: extra.ambiguous || null,
          // payment said early ("pickup and pay cash" while a size question is still open)
          // is remembered — it used to be lost on every option re-ask
          ...(e.payment_method ? { payment_method: e.payment_method } : {}),
          ...(e.pickup_time ? { pickup_time: e.pickup_time } : {}),
          ...(dq?.covered && dq.fee != null ? { delivery_fee: dq.fee, delivery_km: dq.km ?? null, delivery_eta_min: dq.eta_min ?? null } : {}),
          ...(deliveryPoint ? { delivery_point: { lat: deliveryPoint.lat, lng: deliveryPoint.lng, source: deliveryPoint.source || (mapLink?.lat != null ? "maps_link" : "pin"), label: deliveryPoint.label || null, approx: !!deliveryPoint.approx } } : {}),
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
      // Distance-priced and we couldn't place the typed address on the map: the fee
      // can't be computed honestly, so ask for a pin/Maps link instead of inventing a
      // number. The address text is kept — the pin only adds precision.
      if (typeof whichPlace !== "undefined" && whichPlace && items.length) {
        await savePending({ address, awaiting_option: null, awaiting_location: true, place_candidates: whichPlace.map((c) => ({ lat: c.lat, lng: c.lng, label: c.label, source: c.source })) });
        return { kind: "which_place", items, running, candidates: whichPlace.map((c) => c.label), notices: outcomeNotices };
      }
      if (typeof needPinArea !== "undefined" && needPinArea && items.length && !whichPlace) {
        await savePending({ address, awaiting_option: null, awaiting_location: true, place_candidates: null });
        return { kind: "need_pin", items, running, area: typeof needPinArea === "string" ? needPinArea : null, notices: outcomeNotices };
      }
      // a real point landed → we're no longer waiting for a location
      if (deliveryPoint && (loaded.pending?.awaiting_location || loaded.pending?.place_candidates)) await savePending({ awaiting_location: false, place_candidates: null });

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
      // The extractor sometimes folds a SEPARATE product into a dish's notes
      // ("Soo Classic Meal, notes: cola zero"). A note with NO modification words
      // that echoes menu-product words is a swallowed order line — code surfaces it
      // through the same-kind mapping instead of silently losing the guest's drink.
      const MODIFIER_SIG = /(?<![\p{L}])(no|not|without|less|more|extra|only|well|side|add|change|بدون|من غير|زياد|سادة|سبايسي|spicy|hot|mild|حار|بارد)(?![\p{L}])/iu;
      for (const it of items) {
        const nt = String(it.notes || "").trim();
        if (!nt || MODIFIER_SIG.test(nt)) continue;
        const ntN = normName(nt);
        const productish = loaded.menu.some((m) => normName(m.name).split(" ").some((t) => t.length >= 4 && ntN.includes(t)));
        if (productish && !unknown.includes(nt)) { unknown.push(nt); it.notes = null; }
      }
      // An unknown that's a same-kind cousin of something we DO sell ("a cola zero"
      // while the menu has a Soft Drink) becomes that item, with the guest's words as
      // the kitchen note — announced, one word to switch. Dynamic per menu, no lists.
      if (unknown.length && loaded.menu?.length) {
        const ru = await f.node("resolve_unknowns", async () =>
          chatJSON(MODEL_FAST, `A restaurant guest asked for things (possibly Arabic/Franco) that aren't exact menu item names. MENU: [${loaded.menu.map((m) => `"${m.name}"`).join(", ")}]\nFor each request return the closest SAME-KIND menu item; if SEVERAL are equally plausible (a generic word like "برجر"/"burger", "تشيكن"/"chicken"), return an ARRAY of those candidates (max 4); BUT a specific product with one natural equivalent maps to ONE ("pepsi"/"بيبسي" → the REGULAR cola, never also the diet variant; "7up" → the lemon-lime soda); null when nothing is the same kind. A chicken request may ONLY map to chicken dishes; a drink request only to drinks. Output ONLY exact strings from the MENU list. Return JSON {"map": {"<requested>": "<name>"|["<name>", ...]|null}}.`,
            JSON.stringify(unknown), { temperature: 0, maxTokens: 220 }),
          { input: { unknown } }).catch(() => null);
        const map = ru?.value?.map || {};
        const still = [];
        for (const u of unknown) {
          const v = map[u];
          const q = unknownQty[u] || 1;
          if (Array.isArray(v) && v.length > 1) {
            const cands = v.map((x) => loaded.menu.find((m) => normName(m.name) === normName(x))).filter(Boolean);
            if (cands.length > 1) { ambiguous.push({ said: String(u), qty: q, candidates: cands.slice(0, 4).map((m) => m.name) }); continue; }
          }
          const one = Array.isArray(v) ? v[0] : v;
          const target = typeof one === "string" ? loaded.menu.find((m) => normName(m.name) === normName(one)) : null;
          if (target && !items.some((it) => it.id === target.id)) {
            items.push({ id: target.id, name: target.name, qty: q, price: Number(target.price), notes: null, options: {}, option_defs: target.options || [] });
            outcomeNotices.push(L2(`${u} → *${target.name}* ✍️ (say the word to switch)`, `${u} → *${target.name}* ✍️ (قول لو عايز تغيّر)`, `${u} → *${target.name}* ✍️ (2ol law 3ayez teghayar)`));
          } else if (!target) still.push(u);
        }
        unknown = still;
        running = runningOf(items);
      }
      // Multiple dishes fit what they said → one question beats one wrong guess.
      // (After the mapping, so a generic word's candidates come from the mapper and
      // nothing else in the message gets lost behind the question.)
      if (ambiguous.length) {
        let a = ambiguous[0];
        // The guest ANSWERED our which-one and we still couldn't pin it. Re-searching the
        // whole menu produced a WIDER question than the one they just answered — the bot
        // looked like it was getting dumber. If the new candidates overlap the ones we
        // already printed, re-ask THAT list, say we didn't catch it, and count the try.
        const amb0Cands = (askedBefore?.candidates || []).map((c) => normName(c));
        if (amb0Cands.length && !answeredAmbiguity && a.candidates.some((c) => amb0Cands.includes(normName(c)))) {
          a = { ...askedBefore, tries: (Number(askedBefore.tries) || 1) + 1 };
        }
        await savePending({ ambiguous: a });
        // three misses on the same list is a loop — hand to a human rather than a 4th ask
        if ((Number(a.tries) || 1) >= 4) {
          await notifyDashboard(db, "handoff", "Human needed: guest stuck picking a dish",
            `${diner?.name || ctx.sessionId} — "${a.said}" asked ${(Number(a.tries) || 1) - 1}× without a match`, ctx.sessionId).catch(() => {});
          await setSessionFlags(db, ctx.sessionId, { needs_attention: true, handoff_reason: "which-item loop" }).catch(() => {});
          return { kind: "stuck_handoff", items, running: runningOf(items), notices: outcomeNotices };
        }
        return { kind: "which_item", said: a.said, qty: a.qty, candidates: a.candidates, tries: Number(a.tries) || 1, items, running: runningOf(items), notices: outcomeNotices };
      }
      if (!items.length) {
        await savePending({}); // marks the session as ordering — "loaded fries" next turn stays here
        // Fulfillment-first restaurants (per-restaurant toggle): the dine-in/pickup/
        // delivery question OPENS the order; the menu follows once the type is set.
        if (config.ai?.ask_type_first === true && !orderType && !unknown.length) {
          await savePending({ menu_shown: true }); // the opener carries the menu — don't resend next turn
          return { kind: "ask_fulfillment", type_first: true, first_fulfilment: true, need_type: true, delivery: deliveryOn, notices: outcomeNotices, items: [] };
        }
        // Carry the type on the outcome: loaded.pending is the START-of-turn snapshot,
        // so on the exact turn the guest answers "delivery" only this local has it.
        return unknown.length ? { kind: "nothing_matched", unknown } : { kind: "ask_items", order_type: orderType || loaded.pending?.order_type || null };
      }

      // 1b) TYPE FIRST, EVEN WHEN THE GUEST OPENS WITH A DISH (per-restaurant toggle):
      // "سيجناتشر برجر" → "how would you like it?" comes BEFORE the sandwich/combo
      // questions. Asked exactly once per draft (type_asked), only when the type is
      // still unknown and no option ask is already open. The item stays on the bill.
      if (config.ai?.ask_type_first === true && !orderType && items.length && !loaded.pending?.type_asked && !loaded.pending?.awaiting_option) {
        await savePending({ type_asked: true, leadin_shown: true });
        return { kind: "ask_fulfillment", type_first: true, first_fulfilment: true, need_type: true, delivery: deliveryOn, notices: outcomeNotices, items, running: runningOf(items) };
      }

      // 2) OPTIONS — finish configuring every item.
      // CODE matches first (free): exact names, transliterations, 1-edit fuzz.
      // Whatever stays open goes to the MODEL with the EXACT choice lists —
      // accents/spellings/dialects are language understanding, and hardcoded
      // word lists can't be dynamic per restaurant. The model may only PICK
      // from the lists; code validates every returned string. Zero invention.
      let step = nextQuestion(items, loaded.menu, input.message, loaded.pending, currency);
      const guestSaidSomething = String(input.message || "").replace(/^\[voice\]\s*/i, "").trim().length >= 3;
      // The model may only resolve answers against the ask the guest actually SAW (last
      // turn's awaiting_option) — or the very first ask when nothing was pending (option
      // info spoken inline with the order). When this turn's answer completed item A and
      // the ask moved on to item B, the same message must NOT also answer B's questions:
      // the guest hasn't seen them yet. (One 'Full Meal, Small…' configured BOTH meals.)
      const aw0 = loaded.pending?.awaiting_option;
      const askIsWhatGuestSaw = !aw0 || (step.ask && step.ask.index === aw0.index);
      // One applied answer can OPEN a follow-up group in the same breath ("pepsi"
      // infers Combo, which opens the combo-drink list the same word was meant to
      // answer — the drink then got re-asked cold). Resolution runs up to twice,
      // always against the SAME item, so the message's whole meaning lands.
      const resolveIndex = step.ask?.index;
      for (let pass = 0; pass < 2 && step.ask && guestSaidSomething; pass++) {
        if (pass === 0 ? !askIsWhatGuestSaw : step.ask.index !== resolveIndex) break;
        const askedItem = step.items[step.ask.index];
        const openGroups = (askedItem?.option_defs || []).filter((g) =>
          g.key !== "slots" && step.ask.keys?.includes(g.key) && groupApplies(g, askedItem.options) && !askedItem.options[g.key]);
        if (openGroups.length) {
          const lists = openGroups.map((g, i) =>
            `${i + 1}. "${g.label || g.key}": [${groupChoices(g, loaded.menu).map((c) => `"${c.name}"`).join(", ")}]`).join("\n");
          const rsys = `A restaurant guest is answering menu questions. Their message may be Arabic, Franco-Arabic, misspelled, or a garbled voice transcript — understand accents and translations ("ديابلو"→"Diablo fries", "برتقان"→the orange drink).
QUESTIONS:\n${lists}
Return JSON {"answers": {"1": "<EXACT string from list 1 or null>", ...}, "equivalent": {"asked": "<what they said>", "used": "<the list choice you mapped it to>", "different_product": <true ONLY when the mapped choice is a genuinely DIFFERENT product/brand (pepsi→Coca-Cola, cola→V Cola); false when it's the same thing worded differently (coke→Coca-Cola, cola zero→the sugar-free cola we carry)>}|null, "unmatched": "<an attempted ANSWER to the questions with NO reasonable equivalent in any list; null if nothing>"}. The guest's message may be ORDERING dishes — dish/item names are handled elsewhere and are NEVER "unmatched" and never an attempted answer; when the message just names dishes to order, equivalent=null and unmatched=null.
RULES: only exact strings from the lists; null when the message doesn't clearly answer that question; FORMAT questions (sandwich-vs-combo/meal): the guest describing the SERVING STYLE answers it — a bare "burger"/"just the burger"/"just a sandwich"/"لوحده"/"بس ساندوتش"/"not a combo"/"من غير وجبة" → the sandwich-only choice (even when the dish name contains "burger"); "combo"/"meal"/"full meal"/"وجبة"/"كومبو"/"with fries and a drink/cola" → the combo/meal choice (and any named drink/side in the same breath answers those questions too); BUT the dish's FULL name alone when ORDERING ("iconic meal" as a new order) does not choose a format; a variant/brand we don't carry maps to its closest REAL EQUIVALENT in the list — like a sharp cashier: "cola zero"/"coke zero" → the diet/sugar-free cola in the list; "pepsi" → the cola we carry; "7up" → "Sprite"; "بيبسي دايت" → the diet cola — put the LIST string in answers AND report it in "equivalent". "used" and every answer MUST be an EXACT string from the lists — NEVER a product that isn't listed (never invent "Coca-Cola Zero" when the list has "Coca - Cola Diet"). Only when NOTHING in the list is a reasonable equivalent (e.g. they asked for a milkshake and the list is sodas): answers null + "unmatched". Equivalence is about the same KIND of thing — never map across kinds; never invent. The examples in these instructions ("V Cola", "Diablo fries", "7up"→"Sprite") are ILLUSTRATIONS — never output any string that is not literally in THIS request's lists.`;
          const rr = await f.node("resolve_options", async () =>
            chatJSON(MODEL_FAST, rsys, String(input.message), { temperature: 0, maxTokens: 150 }),
            { input: { open_groups: openGroups.map((g) => g.label || g.key), message: input.message } });
          const answers = rr.value?.answers || {};
          // The guest asked for something we don't carry ("cola zero") — SAY so instead
          // of silently re-printing the list, which reads as the bot being stuck.
          let unmatchedOpt = typeof rr.value?.unmatched === "string" && rr.value.unmatched.trim()
            ? rr.value.unmatched.trim().slice(0, 40) : null;
          // a confused resolver sometimes echoes the WHOLE message — an "unmatched"
          // containing a choice that's already applied on the item is garbage, not feedback
          if (unmatchedOpt) {
            const un = normName(unmatchedOpt);
            const appliedNow = Object.values(askedItem.options || {}).filter((v) => typeof v === "string");
            if (appliedNow.some((v) => v && un.includes(normName(v)))) unmatchedOpt = null;
          }
          // feedback belongs to pass 0 only — pass 1 re-reads the SAME message against
          // leftover groups and would re-report an already-applied answer as missing
          const addedThisTurn = !!(e.items?.length || (e.edits || []).some((d) => d?.op === "add"));
          if (pass === 0 && unmatchedOpt && !addedThisTurn && !outcomeNotices.some((x) => x.startsWith("We don't have") || x.startsWith("معندناش"))) outcomeNotices.push(L2(`We don't have ${unmatchedOpt} 🙏 — the options we've got are below.`, `معندناش ${unmatchedOpt} 🙏 — الاختيارات اللي عندنا تحت.`, `Ma3andenash ${unmatchedOpt} 🙏 — el options elly 3andena taht.`));
          // Equivalents are AUTO-APPLIED, never asked about — and only ever a real list
          // string. The nano once invented "Coca-Cola Zero" (not on the menu) and the
          // notice claimed it was applied while nothing landed. Code verifies both.
          let eq = rr.value?.equivalent?.asked && rr.value?.equivalent?.used
            ? { asked: String(rr.value.equivalent.asked).slice(0, 30), used: String(rr.value.equivalent.used).trim(), different: rr.value.equivalent.different_product === true }
            : null;
          if (eq) {
            // normalized match, canonical spelling: the nano writes "Coca-Cola Diet",
            // the menu says "Coca - Cola Diet" — same choice, list string wins
            let canonUsed = null;
            for (const g of openGroups) {
              const hit = groupChoices(g, loaded.menu).find((c) => normName(c.name) === normName(eq.used));
              if (hit) { canonUsed = hit.name; break; }
            }
            if (!canonUsed) {
              // invented product — discard the mapping, tell the guest honestly instead
              if (pass === 0 && !unmatchedOpt && !addedThisTurn && !outcomeNotices.some((x) => x.startsWith("We don't have") || x.startsWith("معندناش"))) outcomeNotices.push(L2(`We don't have ${eq.asked} 🙏 — the options we've got are below.`, `معندناش ${eq.asked} 🙏 — الاختيارات اللي عندنا تحت.`, `Ma3andenash ${eq.asked} 🙏 — el options elly 3andena taht.`));
              eq = null;
            } else {
              eq.used = canonUsed;
              if (!Object.values(answers).some((v) => typeof v === "string" && normName(v) === normName(canonUsed))) {
                openGroups.forEach((g, i) => {
                  const k = String(i + 1);
                  if (!answers[k] && groupChoices(g, loaded.menu).some((c) => c.name === canonUsed)) answers[k] = canonUsed;
                });
              }
            }
          }
          let appliedAny = false;
          const appliedVals = new Set();
          openGroups.forEach((g, i) => {
            const a = answers[String(i + 1)];
            if (!a || typeof a !== "string") return;
            const valid = groupChoices(g, loaded.menu).find((c) => c.name === a.trim() || normName(c.name) === normName(a));
            if (valid && !askedItem.options[g.key]) { askedItem.options[g.key] = valid.name; appliedAny = true; appliedVals.add(valid.name); }
          });
          // the substitution notice may only state what ACTUALLY landed on the draft
          if (eq && eq.different && appliedVals.has(eq.used)) outcomeNotices.push(L2(`${eq.asked} → closest we carry is *${eq.used.slice(0, 40)}*, put that in ✍️ (say the word to switch)`, `${eq.asked} → أقرب حاجة عندنا *${eq.used.slice(0, 40)}*، حطيتها ✍️ (قول لو عايز تغيّر)`, `${eq.asked} → a2rab 7aga 3andena *${eq.used.slice(0, 40)}*, 7atetha ✍️ (2ol law 3ayez teghayar)`));
          if (!appliedAny) break;
          items = step.items;
          step = nextQuestion(items, loaded.menu, "", loaded.pending, currency);
        } else break;
      }
      if (removedNames?.length) {
        step.items = step.items || items;
        outcomeNotices.push(`Removed: ${removedNames.join(", ")} ✂️`);
      }
      items = step.items;
      // "no onion" on a dish that never had onion: the note is impossible — the
      // guest is guarding against something that isn't there. Checked by CODE
      // against the dish's real ingredient text (DB), never guessed: the phantom
      // removal is stripped from the kitchen note and the guest is told the dish
      // already comes without it.
      // Conversational residue is not a kitchen note: "no the smokey" (picking a
      // dish) once landed as a literal note "no" and printed as "(Sandwich · no)".
      const FILLER_NOTE = /^(yes|yeah|yep|no|nah|ok(ay)?|sure|tamam|تمام|طيب|اوكي|أوكي|لا|اه|أه|ايوه|أيوة|ماشي)[\s!.،,]*$/iu;
      for (const it of items || []) {
        if (it.notes && FILLER_NOTE.test(String(it.notes).trim())) it.notes = null;
      }
      // A removal spoken in the same breath as an option answer ("sandwich but
      // WITHOUT THE BBQ") — the extractor takes the option and drops the removal.
      // CODE re-reads the raw message; a removal lands on the item this turn is
      // about, and the phantom check right below vets it against real ingredients.
      // Words that are part of the dish/option names are skipped — "no the smokey"
      // picks a dish, it doesn't strip the smoke.
      {
        const RM = /(no|without|hold the|don'?t add|dont add|do not add|بدون|من غير|بلاش|متضفش|ما تضيفش|matdefsh|ma tdefsh|men gheir|min gheir|bedoon|bdoon)\s+((?:the |el )?[\p{L}][\p{L} ]{0,23})/giu;
        const awIdx = loaded.pending?.awaiting_option?.index;
        const target = (awIdx != null && items[awIdx]) || (items.length === 1 ? items[0] : null);
        // A question is never a kitchen note: "does the classic come without onion?"
        // wants an ANSWER, not a modification.
        const isQuestion = /[?؟]/.test(String(input.message || "")) || e.intent === "question";
        if (target && !isQuestion) {
          const nameToks = normName(`${target.name} ${Object.values(target.options || {}).map((v) => (typeof v === "string" ? v : "")).join(" ")} ${(target.option_defs || []).flatMap((g2) => (g2.choices || []).map((c2) => c2?.name || c2 || "")).join(" ")}`).split(" ");
          let m2;
          while ((m2 = RM.exec(String(input.message || "")))) {
            const marker = m2[1].toLowerCase();
            const what = m2[2].replace(/^(the|el)\s+/i, "").replace(/^ال/, "").trim().toLowerCase();
            if (!what || what.length < 3) continue;
            const wTok = what.split(" ")[0];
            // "no X" / "بلاش X" can be a dish-pick correction ("no the smokey") — the
            // name guard applies. "without X" / "من غير X" is ALWAYS a removal, even
            // when X sits in the dish name ("Smoky BBQ Burger without the bbq"
            // means the sauce): those markers bypass the guard.
            const weakMarker = marker === "no" || marker === "بلاش";
            if (weakMarker && nameToks.some((t2) => t2 === wTok || (t2.length > 3 && wTok.length > 3 && editDistance(t2, wTok) <= 1))) continue;
            // A MENU ITEM after the marker is an order edit, never an ingredient:
            // "don't add classic burger, add ranch sandwich instead" swaps items —
            // the extractor's edits own that; a note here would mangle the order.
            // EXCEPT when the word is literally in the target dish's ingredients:
            // "without the bbq" on a Smoky BBQ Burger means the sauce, even though a
            // "BBQ Sauce Cup" also exists on the menu.
            const whatN = normName(what);
            const rowT = loaded.menu.find((mi) => mi.id === target.id) || {};
            const hayT = `${rowT.ingredients || ""} ${rowT.description || ""}`.toLowerCase();
            const isIngredientOfTarget = hayT.includes(wTok);
            if (loaded.menu.some((mi) => {
              const n2 = normName(mi.name);
              if (n2 === whatN || whatN.startsWith(`${n2} `)) return true; // full item name → always an edit
              return !isIngredientOfTarget && n2.startsWith(`${whatN} `);   // partial → edit only when it's NOT an ingredient
            })) continue;
            if (String(target.notes || "").toLowerCase().includes(wTok)) continue;
            target.notes = [target.notes, `no ${what}`].filter(Boolean).join(" · ");
          }
        }
      }
      {
        const AR2EN_ING = [
          [/بصل|basal/iu, "onion"], [/جبن|gebna|gebnah/iu, "cheese"], [/مخلل|mekhalel|me5alel/iu, "pickle"], [/طماطم|قوط|tamatem|2ota/iu, "tomato"],
          [/خس|khas|5as/iu, "lettuce"], [/مايو|mayo/iu, "mayo"], [/هالبينو|هالابينو|halapeno|jalapeno/iu, "jalapeno"], [/بيكون|مقدد|bacon|be2on/iu, "bacon"],
          [/مشروم|فطر|mashroom|mashrum/iu, "mushroom"], [/كاتشب|katshab|ketchup/iu, "ketchup"], [/مسطردة|مستردة|mostarda/iu, "mustard"], [/خيار|khyar|5yar/iu, "cucumber"],
        ];
        const REMOVE_NOTE = /(?:no|without|hold the|بدون|من غير|بلاش|مفيش|men gheir|min gheir|bedoon|bdoon)\s+([\p{L}][\p{L} ]{1,23})/giu;
        for (const it of items || []) {
          if (!it.notes) continue;
          const row = loaded.menu.find((m) => m.id === it.id) || loaded.menu.find((m) => normName(m.name) === normName(it.name));
          const hay = `${row?.ingredients || ""} ${row?.description || ""}`.toLowerCase();
          if (!hay.trim()) continue; // no real ingredient data → never claim anything
          let changed = false;
          const cleaned = String(it.notes).replace(REMOVE_NOTE, (full, what) => {
            const said = String(what).trim();
            // "without THE bbq" — the article isn't an ingredient; strip it or the
            // DB lookup ("the bbq" vs "bbq sauce") misses and the note gets eaten
            let en = said.toLowerCase().replace(/^(the|el)\s+/, "").replace(/^ال/, "");
            for (const [rx, e2] of AR2EN_ING) if (rx.test(said)) { en = e2; break; }
            en = en.replace(/e?s$/, "");
            // generic words (sauce, bread…) match too many things — only clear-cut
            // single ingredients are judged; anything else stays a kitchen note
            if (en.length < 3 || /sauce|صوص|صلصة|bread|bun|خبز/.test(en)) return full;
            if (hay.includes(en)) return full; // the dish HAS it — real removal, keep
            changed = true;
            outcomeNotices.push(L2(
              `Good news — the ${it.name} already comes without ${said} 👌`,
              `على فكرة — الـ${dishDisp(it.name)} أصلاً مفيهوش ${said} 👌`,
              `3ala fekra — el ${it.name} aslan mafihoosh ${said} 👌`,
            ));
            return "";
          }).replace(/\s{2,}/g, " ").replace(/^[\s,·،-]+|[\s,·،-]+$/g, "");
          if (changed) it.notes = cleaned || null;
        }
      }
      running = runningOf(items); // this turn's answers are in — never echo the stale bill
      // Anything the guest named that we DON'T carry is said out loud mid-gather —
      // silently dropping "a cola zero" loses part of the order and erodes trust.
      if (unknown.length) outcomeNotices.push(L2(`Couldn't find ${unknown.join(", ")} on the menu 🙏`, `ملقناش ${unknown.join("، ")} في المنيو 🙏`, `Mala2enash ${unknown.join(", ")} fel menu 🙏`));
      if (step.ask) {
        // Info said alongside an unanswered option ("pickup and pay cash" while the size
        // is still open) IS captured (savePending) — acknowledge it so the re-ask doesn't
        // read as if we ignored them.
        const TYPE_WORD_L = { delivery: ["delivery", "دليفري", "delivery"], pickup: ["pickup", "تيك أواي", "pickup"], dine_in: ["dine-in", "في المطعم", "dine-in"] };
        const li = LANGV === "ar" ? 1 : LANGV === "fr" ? 2 : 0;
        const noted = [
          e.order_type ? (TYPE_WORD_L[e.order_type]?.[li] || e.order_type.replace("_", "-")) : null,
          e.payment_method ? (LANGV === "ar" ? arPay(e.payment_method) : e.payment_method) : null,
        ].filter(Boolean);
        if (noted.length) outcomeNotices.push(L2(`Noted — ${noted.join(" + ")} ✅`, `تمام — ${noted.join(" + ")} ✅`, `Tamam — ${noted.join(" + ")} ✅`));
        // RE-ASK CIRCUIT BREAKER: the SAME question issued a 4th time means three
        // answers in a row didn't land — asking again is a loop, not persistence.
        // Hand them to a human instead of grinding (the last unguarded loop class).
        const prevAw = loaded.pending?.awaiting_option;
        const sameAsk = prevAw && prevAw.index === step.ask.index &&
          JSON.stringify(prevAw.keys || []) === JSON.stringify(step.ask.keys || []);
        // A PRODUCTIVE turn (added items, applied edits/corrections, gave payment/type/
        // address) is real work, not a miss — the guest correcting the slaw while the
        // drink question stays open must never count toward the breaker.
        const turnProgress = !!(e.items?.length || e.edits?.length || e.payment_method || e.order_type || e.address || noted.length);
        const tries = sameAsk && !turnProgress ? (Number(prevAw.tries) || 1) + 1 : 1;
        if (tries >= 4) {
          await notifyDashboard(db, "handoff", "Human needed: guest stuck on an order question",
            `${name || ctx.sessionId} — "${step.ask.item || "item options"}" asked ${tries - 1}× without an answer that matched`, ctx.sessionId).catch(() => {});
          await setSessionFlags(db, ctx.sessionId, { needs_attention: true, handoff_reason: "order question missed 3×" }).catch(() => {});
          return { kind: "stuck_handoff", items };
        }
        await savePending({ awaiting_option: { index: step.ask.index, keys: step.ask.keys, tries } });
        step.ask.tries = tries;
        // recompute the bill AFTER this turn's answer — showing the pre-answer
        // state made prices look like they jumped a turn late
        return { kind: "ask_choice", items, running, ...step.ask, notices: [...(step.ask.notices || []), ...outcomeNotices] };
      }
      if (loaded.pending?.awaiting_option) {
        // savePending MERGES now, so the answered question must be closed
        // explicitly — a stale awaiting_option made every later "add a loaded
        // fries" get swallowed as an option answer and silently dropped
        loaded.pending.awaiting_option = null;
        await savePending({ awaiting_option: null });
      }

      // 3) FULFILLMENT — type + branch + table/address, everything still missing
      // asked in ONE message; each answer shrinks the next round's question
      const needType = !orderType;
      // Smart pickup timing (per-restaurant): ask WHEN they're passing by, so the
      // kitchen fires at T-minus-prep and the food lands fresh, not cold on a shelf.
      // SAME source as the ticket's ETA base — quoting "~10 min" in the ask and
      // "about 45 min" on the ticket in one order reads as two different bots.
      const prepMin = Number(config.menu_config?.prep_minutes) || Number(config.ai?.pickup_prep_min) || 15;
      const needPickupTime = orderType === "pickup" && config.ai?.pickup_smart_timing === true
        && !e.pickup_time && !loaded.pending?.pickup_time;
      // branch is a pickup/dine-in question only — delivery gets it assigned from the address
      const needBranch = branches.length > 1 && !branch && orderType !== "delivery";
      const tablesOn = config.basic_info?.services?.table_numbers !== false && loaded.tableNumbers.length > 0;
      const needTable = orderType === "dine_in" && tablesOn && !tableNumber;
      const needAddress = orderType === "delivery" && !address && !mapLink && !sharedPin;
      // Payment folds INTO the fulfillment message ("Address? And how are you
      // paying?") — one message instead of two. Only when the type is known (the
      // method list depends on it); missed answers get the normal payment ask later.
      const payKnown = !!(e.payment_method || loaded.pending?.payment_method);
      const foldPay = !payKnown && !!orderType
        ? (orderType === "dine_in" ? ["cash at the cashier", "card at the cashier"]
          : orderType === "pickup" ? ["cash at the counter", "card", "instapay"]
          : ["cash on delivery", "card", "instapay"])
        : null;
      if (needType || needBranch || needTable || needAddress || needPickupTime) {
        // The lead-in ("Almost done…") shows on the FIRST fulfilment ask only. The real
        // "first" signal is whether we've ASKED before, not whether a slot was saved —
        // turn 1 asks the type but saves no slot, so a saved-slot check wrongly repeats
        // the lead-in on turn 2. Persist the ask itself.
        const firstFulfilment = !loaded.pending?.leadin_shown;
        await savePending({ address, map_link: mapLinkRaw, awaiting_option: null, leadin_shown: true });
        const loc = freshLocation(diner);
        const near = loc ? nearestBranches(branches, loc.lat, loc.lng, 3).map((b) => `${b.name} (${b.km} km)`) : null;
        return {
          kind: "ask_fulfillment", items, running, first_fulfilment: firstFulfilment, notices: outcomeNotices,
          need_type: needType, delivery: deliveryOn, need_pickup_time: needPickupTime, prep_min: prepMin,
          need_payment: !!foldPay, pay_methods: foldPay || [],
          need_branch: needBranch, branches: branches.map((b) => b.name), nearest: near,
          usual: branches.find((b) => b.key === usualKey)?.name || null,
          need_table: needTable, tables: loaded.tableNumbers.slice(0, 12),
          need_address: needAddress, saved: saved.map((s2) => s2.text),
        };
      }

      // 4) MONEY — computed here, never by the model
      // this turn's own quote wins over the draft's saved one (address may have just changed)
      const quotedFee = orderType === "delivery"
        ? (() => { const q = deliveryQuote(config, { area: address, coords: deliveryPoint, subtotal: items.reduce((s2, i2) => s2 + itemPrice(i2) * i2.qty, 0) }); return q?.covered && q.fee != null ? { fee: q.fee, km: q.km ?? null } : { fee: loaded.pending?.delivery_fee ?? null, km: loaded.pending?.delivery_km ?? null }; })()
        : { fee: null, km: null };
      const bill = priceOrder(items, config, orderType, quotedFee.fee, quotedFee.km);

      // 6) PAYMENT METHOD — required before we take the order
      const payMethods = orderType === "dine_in" ? ["cash at the cashier", "card at the cashier", "online link"]
        : orderType === "pickup" ? ["cash at the counter", "card", "instapay"]
        : ["cash on delivery", "card", "instapay"];
      const PAY_WORD = {
        cash: "cash", كاش: "cash", card: "card", visa: "card", كارت: "card", فيزا: "card",
        instapay: "instapay", انستاباي: "instapay",
        online: "instapay", link: "instapay", اونلاين: "instapay", أونلاين: "instapay", لينك: "instapay",
      };
      const bare = input.message.replace(/^\[voice\]\s*/i, "").trim().toLowerCase().replace(/[^\p{L}]/gu, "");
      // The guest answers with what we PRINTED — "online link", "cash at the cashier" —
      // not with our internal key, and a tapped quick-reply sends the label verbatim.
      // Matching only bare keywords under a 14-char cap meant every multi-word label we
      // offer (all of dine-in's) failed: on 14 Aug a guest answered "Online", nothing
      // matched, the turn fell through to chit-chat and his order was never placed while
      // the bot wished him a good meal. Match what we rendered — same rule as buttons.
      // Key off the label's FIRST word, not a substring: "card at the cashier" contains
      // "cash" inside "cashier", so substring matching silently books card as cash.
      const payKeyOf = (label) => {
        const first = String(label).trim().toLowerCase().split(/\s+/)[0].replace(/[^\p{L}]/gu, "");
        return PAY_WORD[first] || (/card|visa|كارت|فيزا/i.test(label) ? "card" : /cash|كاش/i.test(label) ? "cash" : "instapay");
      };
      const offeredPay = (() => {
        if (!bare || bare.length < 3) return null;
        for (const label of payMethods) {
          const norm = String(label).toLowerCase().replace(/[^\p{L}]/gu, "");
          if (!norm) continue;
          if (norm === bare || norm.startsWith(bare) || bare.startsWith(norm)) return payKeyOf(label);
        }
        return null;
      })();
      const payment = ["cash", "card", "instapay"].includes(String(e.payment_method || "").toLowerCase())
        ? String(e.payment_method).toLowerCase()
        : offeredPay || (input.message.trim().length <= 14 && PAY_WORD[bare]) || loaded.pending?.payment_method || null;
      // ONE add-on offer per order — CODE picks it, never the model, always a real menu
      // item at its real price. Source order: the restaurant's own list
      // (menu_config.upsell.items) → the dish's pairs_with → auto: the cheapest
      // available side/fries or drink not already on the order. Where it SHOWS is the
      // restaurant's call (menu_config.upsell.placement): "confirm" (default — a line
      // above the receipt on the confirm screen, founder's pick) or "payment" (riding
      // on the payment question). Never a bubble of its own.
      const pickUpsell = () => {
        if (loaded.pending?.upsell_offered) return null;
        const up = config.menu_config?.upsell || {};
        if (up.enabled === false) return null;
        const have = new Set(items.map((it) => it.id));
        const haveN = new Set(items.map((it) => normName(it.name)));
        let picks = [];
        if (Array.isArray(up.items) && up.items.length) {
          picks = up.items.map((n) => loaded.menu.find((m) => normName(m.name) === normName(n))).filter((m) => m && m.available !== false && !have.has(m.id)).slice(0, 3);
        }
        // pairs_with is a SEED for the fitted set, not a replacement — and a paired
        // side is skipped when the order already carries fries (combo)
        let seed = null;
        if (!picks.length && config.menu_config?.cross_sell !== false) {
          for (const it of items) {
            const mi = loaded.menu.find((m) => m.id === it.id);
            if (!mi?.pairs_with) continue;
            const wants = String(mi.pairs_with).split(/[,·+&]| and /i).map((x) => normName(x)).filter(Boolean);
            const pk = loaded.menu.find((m) => m.available !== false && wants.some((w) => w && (normName(m.name) === w || normName(m.name).includes(w))) && !haveN.has(normName(m.name)));
            if (pk) { seed = pk; break; }
          }
        }
        if (!picks.length && up.auto !== false) {
          // ADD-ONS THAT FIT THE ORDER — up to three, one per gap: a side if there is
          // none (a combo already brings fries), a dessert (never in a combo), a drink
          // if none. Bestsellers first, then price; never anything with option questions
          // (it would derail the confirm), never sauces/kids/mains. Real items, real prices.
          const SIDE = /fries|side|بطاطس|جانب|appetizer|مقبلات/i, DRINK = /drink|beverage|مشروب|soft|juice|عصير|shake/i, DESSERT = /dessert|sweet|حلو|حلويات|كيك|ice ?cream|cookie/i;
          const SKIP_CAT = /sauce|صوص|kids|little|أطفال|اطفال|burger|chicken|special|hot ?dog|main|sandwich|برجر|ساندوتش/i;
          const catOf = (it) => loaded.menu.find((m) => m.id === it.id)?.category || "";
          const inCombo = (it) => /combo|meal|كومبو|وجبة/i.test(JSON.stringify(it.options || {}));
          const hasSide = items.some((it) => SIDE.test(`${catOf(it)} ${it.name}`) || inCombo(it));
          const hasDrink = items.some((it) => DRINK.test(`${catOf(it)} ${it.name}`) || inCombo(it));
          const hasDessert = items.some((it) => DESSERT.test(`${catOf(it)} ${it.name}`));
          const pool = loaded.menu.filter((m) => m.available !== false && !have.has(m.id) && Number(m.price) > 0 && !(m.options || []).length && !SKIP_CAT.test(m.category || "") && !SKIP_CAT.test(m.name || "") && !/sauce|صوص|cup/i.test(m.name || ""));
          const best = (re) => pool.filter((m) => re.test(`${m.category || ""}`)).sort((a, b) => (Number(!!b.bestseller) - Number(!!a.bestseller)) || (Number(a.price) - Number(b.price)))[0];
          const seedIsSide = seed && SIDE.test(`${seed.category || ""} ${seed.name}`);
          const sidePick = !hasSide ? (seedIsSide ? seed : best(SIDE)) : null;
          picks = [sidePick, !hasDessert ? best(DESSERT) : null, !hasDrink ? best(DRINK) : null].filter(Boolean).slice(0, 3);
          if (!picks.length && seed && !seedIsSide) picks = [seed];
        } else if (!picks.length && seed) picks = [seed];
        return picks.length ? picks.map((m) => `${m.name} (${m.price} ${currency})`) : null;
      };
      const upsellPlacement = config.menu_config?.upsell?.placement === "payment" ? "payment" : "confirm";

      if (!payment) {
        const upsell = upsellPlacement === "payment" ? pickUpsell() : null;
        await savePending({ address, map_link: mapLinkRaw, ...(upsell ? { upsell_offered: true } : {}) });
        return { kind: "ask_payment", notices: outcomeNotices, items, bill, currency, methods: payMethods, upsell, branch_pin: branchInfo ? { address: branchInfo.address || null, lat: branchInfo.lat, lng: branchInfo.lng } : null, branch: branchInfo?.name || null, order_type: orderType, address, table_number: tableNumber };
      }

      // Loyalty is CODE: the rule lives in Settings (pos.loyalty_every / reward),
      // the count comes from the CRM. The bot announces what was EARNED, never
      // invents a perk and never promises one that isn't due.
      const loyEvery = Number(config.pos?.loyalty_every) || 0;
      const loyalty = loyEvery > 0 && ((Number(diner?.visit_count) || 0) + 1) % loyEvery === 0
        ? { visit: (Number(diner?.visit_count) || 0) + 1, reward: String(config.pos?.loyalty_reward || "a little something on us") }
        : null;

      // 7) CONFIRM — the guest sees the full bill and says yes before anything is written.
      // Only a yes to a bill WE actually showed counts: the extractor reads "cash" as
      // intent=confirm, which would otherwise place the order the moment they pick a
      // payment method, before they've ever seen a total.
      const AFFIRM = /(?<![\p{L}\p{N}])(yes|yeah|yep|confirm|confirmed|ok|okay|sure|go ahead|tamam|تمام|اكيد|أكيد|ماشي|maashi|mashy|aywa|ayw[ae]|ايوه|أيوة|اه|akke?d|aked|akid|ekked|أكد|اكد|أكّد|اكّد|تأكيد|تاكيد|كمل|كمّل|kamel|kammel)(?![\p{L}\p{N}])/iu;
      const confirmed = loaded.pending?.awaiting_confirm === true &&
        (e.intent === "confirm" || (input.message.trim().length <= 24 && AFFIRM.test(input.message)));
      if (!confirmed) {
        const upsell = upsellPlacement === "confirm" ? pickUpsell() : null;
        await savePending({ address, map_link: mapLinkRaw, payment_method: payment, awaiting_confirm: true, ...(upsell ? { upsell_offered: true } : {}) });
        return {
          kind: "confirm_order", upsell, notices: outcomeNotices, items, bill, currency, payment,
          branch_pin: branchInfo ? { address: branchInfo.address || null, lat: branchInfo.lat, lng: branchInfo.lng } : null,
          branch: branchInfo?.name || null, order_type: orderType, table_number: tableNumber, address,
        };
      }
      const subtotal = bill.subtotal;

      // ETA = configured prep time + 3 min per ticket already in this branch's
      // queue (+ delivery leg). Computed from the live board, so it's honest —
      // a slammed kitchen quotes longer, an empty one quotes base.
      // Only TODAY'S live tickets count — a pending order from three days ago is an
      // unclosed test/stale row, not tonight's kitchen load (11 of those once
      // inflated a quiet kitchen's quote to 45 minutes).
      let q = db.from("orders").select("id", { count: "exact", head: true })
        .in("status", ["pending", "accepted", "preparing"])
        .gte("created_at", new Date(Date.now() - 2 * 3600_000).toISOString());
      if (branch) q = q.eq("branch", branch);
      const { count: queueDepth } = await q;
      const basePrep = Number(config.menu_config?.prep_minutes) || Number(config.ai?.pickup_prep_min) || 15;
      const etaMinutes = Math.min(
        basePrep + (Number(queueDepth) || 0) * 3 + (orderType === "delivery" ? Number(config.menu_config?.delivery_minutes) || 25 : 0),
        90
      );

      // order-code style is the restaurant's call (Settings → POS) — shared with
      // every other front that opens a ticket, so all of them agree.
      const code = await nextOrderCode(db, config);
      // "in 30 min" / "بعد نص ساعة" / "now" → a real timestamp the kitchen can plan on.
      // Clock times ("at 8pm") stay in notes for humans — timezones are not worth a
      // wrong auto-fire. Scheduling only when they're far enough out to matter.
      const parsePickupMin = (t) => {
        const s2 = String(t || "").toLowerCase();
        if (!s2) return null;
        if (/now|on my way|omw|right away|asap|حالا|دلوقتي|جاي|في الطريق|delwa2ty|dilwa2ty|\bgaya?\b|f el taree2/.test(s2)) return 0;
        const half = s2.match(/نص ساعة|نصف ساعة|half an? hour|nos sa3a/);
        if (half) return 30;
        const hr = s2.match(/(\d{1,2})\s*(hour|hr|ساعة|ساعه|sa3a|sa3at)/);
        if (hr) return Number(hr[1]) * 60;
        const rel = s2.match(/(\d{1,3})\s*(min|m\b|دقيقة|دقايق|د\b|d2ee2a|da2ay2|d2ay2)/);
        if (rel) return Number(rel[1]);
        return null;
      };
      const pickupSaid = e.pickup_time || loaded.pending?.pickup_time || null;
      const pkMin = orderType === "pickup" && config.ai?.pickup_smart_timing === true ? parsePickupMin(pickupSaid) : null;
      const prepMin2 = Number(config.menu_config?.prep_minutes) || Number(config.ai?.pickup_prep_min) || 15;
      const pickupEtaAt = pkMin != null && pkMin > prepMin2 + 5 ? new Date(Date.now() + pkMin * 60000).toISOString() : null;
      // The ticket's quoted minutes follow the guest's OWN pickup time when it's
      // later than the kitchen's: "in 20 minutes" answered with "about 45 min"
      // (or "in an hour" answered with "about 15 min") is a contradiction.
      const etaQuote = pkMin != null ? Math.max(etaMinutes, pkMin) : etaMinutes;
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
        notes: [e.notes, pickupSaid ? `pickup: ${pickupSaid}` : null,
          (loaded.pending?.delivery_point?.approx || deliveryPoint?.approx) ? `📍 approx (${loaded.pending?.delivery_point?.label || deliveryPoint?.label || "area centre"}) — confirm exact spot with the guest` : null,
        ].filter(Boolean).join(" · ") || null,
        ...(pickupEtaAt ? { pickup_eta_at: pickupEtaAt } : {}),
      };
      let { error } = await db.from("orders").insert(row);
      if (error && pickupEtaAt) {
        // migration 029 not run yet — the ticket still lands, timing rides in notes
        console.log("order insert with pickup_eta_at failed, retrying without:", error.message);
        const { pickup_eta_at: _pe, ...noEta } = row;
        ({ error } = await db.from("orders").insert(noEta));
      }
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
      // inventory countdown (migration 019): tracked items burn stock; at zero
      // the item 86es itself for POS, dashboard AND this bot — one truth.
      // Error-tolerant: a pre-019 schema never blocks a ticket.
      for (const it of items) {
        const mi = loaded.menu.find((m) => m.id === it.id);
        if (mi && mi.stock_count != null) {
          const left = Math.max(0, Number(mi.stock_count) - (Number(it.qty) || 1));
          await db.from("menu_items").update({ stock_count: left, ...(left === 0 ? { available: false } : {}) })
            .eq("id", mi.id).then(() => {}, () => {});
        }
      }
      // delivery gets a driver link: unguessable token IS the courier's login.
      // Separate error-tolerant update so a pre-migration DB never blocks a ticket.
      if (orderType === "delivery") {
        const courierToken = Array.from({ length: 22 }, () => "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 32)]).join("");
        await db.from("orders").update({ courier_token: courierToken }).eq("code", code).then(() => {}, () => {});
        // itemized receipts need the fee as data, not a re-derivation (migration 014)
        if (bill.delivery_fee > 0) await db.from("orders").update({ delivery_fee: bill.delivery_fee }).eq("code", code).then(() => {}, () => {});
        // smart courier assignment, same rules as the POS: free riders first,
        // a drop within ~2.5 km of a rider's open drop batches onto that rider.
        // Error-tolerant end to end — assignment never blocks a ticket.
        try {
          const { data: cs } = await db.from("couriers").select("*");
          const couriers = (cs || []).filter((c) => c.active !== false && (!c.branch || !branch || c.branch === branch));
          if (couriers.length) {
            const { data: openOrders } = await db.from("orders").select("id,courier_id,lat,lng,status,order_type,created_at")
              .eq("order_type", "delivery").not("courier_id", "is", null)
              .not("status", "in", "(delivered,cancelled,served,paid)");
            const open = openOrders || [];
            const km = (a, b, c2, d) => { const R = 6371, t = (x) => (x * Math.PI) / 180; const h = Math.sin(t(c2 - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c2)) * Math.sin(t(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
            let pick = null;
            const lat = row.lat ?? null, lng = row.lng ?? null;
            if (lat && lng) {
              const near = open.find((o) => o.lat && o.lng && km(Number(lat), Number(lng), Number(o.lat), Number(o.lng)) <= 2.5);
              if (near) pick = couriers.find((c) => c.id === near.courier_id) || null;
            }
            if (!pick) {
              const busy = new Set(open.map((o) => o.courier_id));
              const free = couriers.filter((c) => !busy.has(c.id));
              const today = new Date().toLocaleDateString("en-CA");
              const { data: todays } = await db.from("orders").select("courier_id,created_at").eq("order_type", "delivery").gte("created_at", `${today}T00:00:00`);
              const carried = (cid) => (todays || []).filter((o) => o.courier_id === cid).length;
              pick = (free.length ? free : couriers).sort((a, b) => carried(a.id) - carried(b.id))[0] || null;
            }
            if (pick) await db.from("orders").update({ courier_id: pick.id, courier_name: pick.name, courier_phone: pick.phone_number || null }).eq("code", code).then(() => {}, () => {});
          }
        } catch { /* no couriers table / pre-migration — fine */ }
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
      // A delivery order is the one case where "check back later" isn't good enough —
      // the customer gets a live link alongside the receipt, same as the rider's own page.
      // Computed BEFORE the receipt PDF so the QR on paper can point straight at it.
      const trackUrl = orderType === "delivery" ? `${PUBLIC_BASE}/track/${signTrackToken({ code, slug: config.slug })}` : null;
      const receiptUrl = await makeReceipt(db, {
        restaurant: config.name,
        order: {
          ...row, bill, created_at: new Date().toISOString(), track_url: trackUrl,
          // a QR is always on the receipt — track link for delivery, otherwise the
          // branded order page (the customer can scan it to see their order any time)
          scan_url: trackUrl || publicLink(`/receipt/${code}`, config.slug),
        },
        branch: branchInfo, currency,
        // everything the branded thermal template needs, all from config
        brand: config.basic_info?.brand || {},
        tagline: config.basic_info?.tagline || "",
        hotline: config.basic_info?.hotline || config.basic_info?.phone || "",
        vatRate: taxRate(config),
      });
      if (receiptUrl) await db.from("orders").update({ receipt_url: receiptUrl }).eq("code", code).then(() => {}, () => {});
      await notifyDashboard(db, "order",
        `🍔 New ${orderType.replace("_", "-")} order ${code}${branchInfo ? ` — ${branchInfo.name}` : ""}`,
        `${name || ctx.sessionId}${tableNumber ? ` · table ${tableNumber}` : ""}${address ? ` · 📍 ${address}` : ""} — ${items.map((i) => `${i.qty}× ${i.name}${i.notes ? ` (${i.notes})` : ""}${modifiers(i).length ? ` [${modifiers(i).join(" · ")}]` : ""}`).join(", ")} · ${fmtAmount(bill.total)} ${currency}`,
        ctx.sessionId, branch);
      return { kind: "order_placed", notices: outcomeNotices, loyalty, code, eta_minutes: etaQuote, order_type: orderType, table_number: tableNumber, branch_pin: branchInfo ? { address: branchInfo.address || null, lat: branchInfo.lat, lng: branchInfo.lng } : null, branch: branchInfo?.name || null, address: orderType === "delivery" ? address : null, map_link: mapLink?.url || null, payment, receipt_url: receiptUrl, track_url: trackUrl, items, bill, currency, unknown, notes: e.notes || null, pickup_time: e.pickup_time || null };
    }, { input: { intent: e.intent, items: (e.items || []).length, order_type: e.order_type, table: e.table_number } });

    // The message wasn't about the order — answer it with the normal brain and return.
    // pending_order is untouched (we never wrote it), so the classifier still sees the
    // order as active and the guest's next "add fries" / "make it 2" continues the exact
    // same draft. This is what stops a mid-order question from getting the menu dump.
    if (outcome.kind === "handoff_to_friendly") {
      return f.flow("friendly", { message: input.message, diner, history: input.history, precheck: input.precheck, classification });
    }

    const value = await f.node("phrase", async () => {
      // A handoff is a PROMISE ("a team member will jump in") — it must be verbatim,
      // never model-phrased: the model once wrote "Almost done — just the last
      // details 👇" over a handoff and stranded the guest mid-air. Code speaks here.
      // ask_choice joined the verbatim list: the render always uses the canned lead
      // now, so a model line here is money spent on a sentence we throw away.
      // confirm_order joins the verbatim list too: the model wrote the confirm line in
      // Arabic under an English receipt (it copied the prompt's Arabic example). It's
      // one fixed sentence in three languages — code says it, and says it right.
      if (["stuck_handoff", "which_item", "menu_request", "ask_choice", "confirm_order", "need_pin", "which_place"].includes(outcome.kind)) return { value: { reply: null, quick_replies: null } };
      // "Got it — pickup ✅ what would you like?" is a fixed phrase too: the model kept
      // drifting into MSA («ماذا تود»), Levantine («شو حابب») and plain English on this
      // exact turn. The deterministic fallback already says it right in all three.
      if (outcome.kind === "ask_items" && loaded.pending?.menu_shown && (outcome.order_type || loaded.pending?.order_type)) return { value: { reply: null, quick_replies: null } };
      const lang = classification?.language || "en";
      // Static persona first, the per-turn language last: an identical prefix is
      // what the model can cache (cheaper prompt, faster first token). ${lang}
      // used to sit in line 1 and broke the cache for the whole prompt.
      const sys = `You are ${config.ai?.name || "the host"} of ${config.name} (fast-casual) on WhatsApp, taking an order like a sharp cashier at the counter. ONE short reply for the OUTCOME (max 2 emojis). Use ONLY facts in OUTCOME.
MONEY RULE (absolute): NEVER write a price, a total, a currency symbol or any number of money. NEVER offer add-ons, extras or upsells unless "upsell" exists in OUTCOME.
LIST RULE (absolute): whenever you present 3+ choices of ANYTHING (options, branches, payment methods, sandwiches), format them as a bullet list — one per line, "• Name" — never a comma run. The itemised bill is attached below your reply automatically. Refer to it as "below" — do not restate it, do not invent a currency.
OUTCOMES:
- order_placed: if "loyalty" is present, open with ONE celebratory line naming EXACTLY the reward given ("visit 6 — your <reward> is on us 🎁") — never invent or promise a perk that isn't in that field. Then confirm the ticket 🎫 with the CODE, the honest ETA ("about <eta_minutes> min"), and what happens next BY TYPE — dine_in: "the kitchen's on it, coming to table X" · pickup: "we'll message you the moment it's ready at <branch>" · delivery: "we'll message you when it's on its way to <address>". Say the receipt is attached if receipt_url exists. If unknown[] has entries, add "couldn't find <names> on the menu".
- ask_fulfillment: ONE short lead-in line (e.g. "Almost done — just the last details 👇"). The questions themselves are appended automatically — NEVER write or answer them yourself.
- ask_choice: write ONE short lead-in line for configuring <item> (e.g. "Quick choices for your Soo Classic Meal — you can answer in one go 👇"). The questions themselves are appended below your line automatically. NEVER list options yourself, NEVER mention any OTHER item in the order — its turn comes next. NEVER claim any choice was recorded and NEVER ask to confirm — nothing is chosen until the guest answers the printed questions; quick_replies must be null here.
- ask_payment: ask how they'd like to pay, then the methods given as a bullet list, one per line. If "upsell" is present, add ONE casual offer of it in the same breath ("want to add loaded fries for 99?") — never push twice. The bill is below. quick_replies: the methods (e.g. ["Cash","Card","InstaPay"]).
- confirm_order: your line comes AFTER the printed receipt — ONE short line asking them to confirm so it goes to the kitchen (e.g. "كله تمام؟ أكد وهيروح للمطبخ ✅"). Never restate items or numbers. quick_replies: ["Confirm ✅","Change something"].
- LANGUAGE (absolute): reply in the GUEST'S language only. Arabic → EGYPTIAN Arabic, never Modern Standard and never Levantine. BANNED in Arabic: "شو", "حابب", "بدك", "ماذا تود", "أرغب", "تفضل أخبرني", "القائمة" (say "المنيو"). Franco → Latin letters, Egyptian words, never a full English sentence.
- ask_items: the full menu PDF is attached automatically — say it's below/attached and ask what they'd like. NEVER ask "what would you like?" on its own as if they can already see the menu.
- ask_table (rare): which table are they at? NEVER say the order is placed — nothing has been sent yet.
- bad_table: the number they gave isn't one of ours. Say so plainly, list the real ones from "tables", and ask which they're at. NEVER claim the order is placed.
- nothing_matched: none of that matched the menu (list unknown) — suggest tapping the menu.
- sold_out_today: OUTCOME.sold ran out today — apologize warmly, say it's back soon, offer the rest of the menu. NEVER pretend it doesn't exist.
- order_status: ONE short warm line only ("on it — here's where your order is 👇"). A progress ladder with real timestamps is appended by code below your line — never restate steps, times or the code yourself.
- order_cancelled: cancelled ✅, no charge, door's open.
- draft_cleared: they removed everything from the order being built — confirm it's wiped, offer to start fresh.
- too_late_to_cancel: ${L2("the order is confirmed and with the kitchen 👨‍🍳 — it can't be cancelled from chat; the team has been pinged and can help at the counter or on the phone.", "الطلب متأكد وفي المطبخ 👨‍🍳 — مش هينفع يتلغي من الشات؛ بلغنا الفريق وهيساعدوك على الكاونتر أو التليفون.", "El order met2aked w fel kitchen 👨‍🍳 — mesh hayenfa3 yetlghy men el chat; balaghna el team.")}
- no_open_order: no active order found — want to start one?
- stuck_handoff: the same question did not land three times — warmly say you do not want to keep repeating yourself and a TEAM MEMBER will jump in right here to finish the order with them. NEVER blame the guest, never re-ask the question.
- no_delivery: we don't do delivery — pickup or dine-in works great though.
- delivery_paused: delivery is temporarily paused (kitchen busy) — say so warmly and offer pickup. NEVER take the delivery order.
- delivery_closed: delivery only runs during OUTCOME.hours (open–close) and it's outside them now — say the hours honestly and offer pickup. NEVER take the delivery order.
- no_delivery_area: we don't deliver to their area — say so honestly and offer pickup at the branch (in OUTCOME.branch). NEVER quote or invent a delivery fee for it.
- below_min_order: delivery has a minimum (OUTCOME.min_order) they haven't reached — say the minimum warmly and offer to add more or switch to pickup. NEVER place it yet.
- no_history: no past orders on this number yet — invite them to make their first one (it becomes their "usual").
Return JSON: {"reply": string, "quick_replies": string[]|null}
LANGUAGE (last line so everything above stays cacheable): mirror the guest's language & script — ${lang}.`;
      // The smart model earns its price on the turns a guest judges you by — the
      // ticket confirmation, an apology, a "we can't do that". Asking which table
      // they're at is a form field with manners; mini says it just as well for a
      // quarter of the cost, and these are most of an order's turns.
      const VOICE_MATTERS = ["order_placed", "order_cancelled", "too_late_to_cancel", "no_delivery", "no_history", "nothing_matched", "order_status", "bad_table", "sold_out_today"];
      const model = VOICE_MATTERS.includes(outcome.kind) ? MODEL_SMART : MODEL_FAST;
      const { upsell: _u, ...outcomeForModel } = outcome;
      return chatJSON(model, sys, `OUTCOME: ${JSON.stringify(outcomeForModel)}\nGuest: ${input.message}`, { temperature: 0.5, maxTokens: 240 });
    }, { input: { outcome_kind: outcome.kind } });

    const fallback = {
      order_placed: L2(`🎫 Order ${outcome.code} is in — about ${outcome.eta_minutes} min!`, `🎫 طلبك ${outcome.code} اتسجل — حوالي ${outcome.eta_minutes} دقيقة!`, `🎫 Orderak ${outcome.code} etsagel — 7awaly ${outcome.eta_minutes} d2ee2a!`),
      // Once they've told us the TYPE and already have the menu, don't hand it over
      // again — acknowledge and ask the one thing still missing.
      ask_items: (() => {
        // `orderType` belongs to the act node — this runs in the render scope, so read
        // it off the outcome/draft instead. (Fourth time tonight I reached across a
        // scope boundary; caught locally, never shipped.)
        const ot = outcome.order_type || loaded.pending?.order_type || null;
        if (!(loaded.pending?.menu_shown && ot)) return null;
        return L2(`Got it — ${String(ot).replace("_", "-")} ✅ What would you like?`,
          `تمام — ${ot === "delivery" ? "دليفري" : ot === "pickup" ? "تيك أواي" : "في المطعم"} ✅ تحب تطلب إيه؟`,
          `Tamam — ${ot === "delivery" ? "delivery" : ot === "pickup" ? "pickup" : "dine-in"} ✅ Te7eb totlob eh?`);
      })() || L2("Here's the full menu 📄 — tell me what you'd like and I'll get it going 🍔", "اتفضل المنيو الكامل 📄 — قولّي تحب إيه وأنا أظبطها 🍔", "Etfadal el menu 📄 — 2oly te7eb eh w ana azabatha 🍔"),
      nothing_matched: L2(`Couldn't find ${(outcome.unknown || []).join(", ")} on the menu — here it is 📄, pick anything off it.`, `ملقناش ${(outcome.unknown || []).join("، ")} في المنيو — اتفضله 📄 واختار أي حاجة منه.`, `Mala2enash ${(outcome.unknown || []).join(", ")} fel menu — etfadalo 📄 w ekhtar ay 7aga.`),
      sold_out_today: L2(`${(outcome.sold || []).join(", ")} is sold out today 🙏 — back soon! Anything else from the menu?`, `${(outcome.sold || []).join("، ")} خلص النهارده 🙏 — هيرجع قريب! تحب حاجة تانية من المنيو؟`, `${(outcome.sold || []).join(", ")} kheles el naharda 🙏 — te7eb 7aga tanya?`),
      no_history: L2("No past orders on this number yet — here's the menu 📄, let's make your first one 🍔", "مفيش طلبات قديمة على الرقم ده — اتفضل المنيو 📄 ونعمل أول طلب 🍔", "Mafeesh orders 2adima 3al ra2am dah — etfadal el menu 📄 wn3mel awel order 🍔"),
      ask_fulfillment: L2("Almost done — just the last details 👇", "قربنا نخلص — آخر تفاصيل بس 👇", "2arabna nekhlas — akher tafaseel bas 👇"),
      ask_choice: `For your ${outcome.item}:\n${(outcome.questions || []).map((q) => `${q.label}${q.of > 1 ? ` (${q.remaining} to pick)` : ""}:\n${q.options.map((o) => `• ${o}`).join("\n")}`).join("\n\n")}`,
      ask_payment: `${L2("How would you like to pay?", "تحب تدفع إزاي؟", "Te7eb tedfa3 ezay?")}\n${(outcome.methods || []).map((m) => `• ${LANGV === "ar" ? arPay(m) : m.replace(/^\w/, (c) => c.toUpperCase())}`).join("\n")}`,
      confirm_order: L2("All set — confirm and I'll send it to the kitchen ✅", "كله تمام — أكد وهيروح للمطبخ على طول ✅", "Kolo tamam — akked w hayro7 lel kitchen ✅"),
      ask_table: L2(`Which table are you at? The number's printed on it${(outcome.tables || []).length ? ` — they look like ${outcome.tables.slice(0, 3).join(", ")}` : ""} 😄`, `انت على أنهي ترابيزة؟ الرقم مكتوب عليها${(outcome.tables || []).length ? ` — زي ${outcome.tables.slice(0, 3).join("، ")}` : ""} 😄`, `Enta 3ala anhy tarabeza? El ra2am maktoob${(outcome.tables || []).length ? ` — zay ${outcome.tables.slice(0, 3).join(", ")}` : ""} 😄`),
      bad_table: L2(`I can't find table ${outcome.given} — ours are ${(outcome.tables || []).slice(0, 8).join(", ")}. Which one are you at?`, `مش لاقي ترابيزة ${outcome.given} — عندنا ${(outcome.tables || []).slice(0, 8).join("، ")}. انت على أنهي واحدة؟`, `Mesh la2y tarabeza ${outcome.given} — 3andena ${(outcome.tables || []).slice(0, 8).join(", ")}.`),
      no_open_order: L2("No active order found — want to start one? 🍔", "مفيش طلب شغال دلوقتي — تحب تبدأ واحد؟ 🍔", "Mafeesh order sha3'al — te7eb tebda2 wa7ed? 🍔"),
      stuck_handoff: L2("I don't want to keep asking the same thing 😅 — a team member will jump in right here and finish your order with you 🙏", "مش عايز أفضل أسأل نفس السؤال 😅 — حد من الفريق هيدخل معاك هنا يكمّل طلبك 🙏", "Mesh 3ayez afdal as2al nafs el so2al 😅 — 7ad men el team haydkhol ykamel ma3ak el order 🙏"),
      draft_cleared: L2("All cleared ✅ Want to start a fresh order?", "اتلغى كله ✅ تحب تبدأ طلب جديد؟", "Etlagha kolo ✅ te7eb tebda2 order gedid?"),
      menu_request: L2("Here's the menu 📄 — tell me what to add!", "اتفضل المنيو 📄 — قولّي تحب تضيف إيه!", "Etfadal el menu 📄 — 2oly te7eb tedif eh!"),
      which_item: L2(`You said *${outcome.said || "that"}*${(outcome.qty || 1) > 1 ? ` (×${outcome.qty})` : ""} — we've got a few like that 😄 Which one did you mean?`, `قولت *${outcome.said || "كده"}*${(outcome.qty || 1) > 1 ? ` (×${outcome.qty})` : ""} — عندنا كذا واحد شبهه 😄 تقصد أنهي واحد؟`, `2olt *${outcome.said || "keda"}*${(outcome.qty || 1) > 1 ? ` (×${outcome.qty})` : ""} — 3andena kaza wa7ed shabaho 😄 te2sod anhy?`),
      delivery_paused: L2("Delivery's paused right now (kitchen's slammed 🙏) — but pickup's open! Want to switch to pickup?", "الدليفري واقف دلوقتي (المطبخ ضغط 🙏) — بس التيك أواي شغال! تحب تحولها تيك أواي؟", "El delivery wa2ef delwa2ty 🙏 — bas el pickup shaghal! Te7awelha pickup?"),
      delivery_closed: L2(`Delivery runs ${outcome.hours?.open || ""}–${outcome.hours?.close || ""} 🙏 — we're outside those hours right now, but pickup works! Want pickup instead?`, `الدليفري شغال من ${outcome.hours?.open || ""} لـ${outcome.hours?.close || ""} 🙏 — إحنا برة المواعيد دلوقتي، بس التيك أواي ينفع! تحب تيك أواي؟`, `El delivery men ${outcome.hours?.open || ""} le ${outcome.hours?.close || ""} 🙏 — bas el pickup yenfa3!`),
      which_place: L2(
        `Which one do you mean? 👇`,
        `تقصد أنهي مكان؟ 👇`,
        `Te2sod anhy makan? 👇`),
      need_pin: L2(
        `Got the address 👍 To work out the delivery fee I need the exact spot — please share your location 📍 (attach → Location) or paste a Google Maps link 🔗`,
        `وصلني العنوان 👍 عشان أحسب رسوم التوصيل محتاج المكان بالظبط — ابعت لوكيشنك 📍 (المرفقات ← الموقع) أو لينك جوجل مابس 🔗`,
        `Wasalny el 3enwan 👍 3ashan a7seb el delivery me7tag el makan bezabt — eb3at location 📍 aw link Google Maps 🔗`),
      no_delivery_area: L2(`We don't deliver to that area yet 🙏 — but pickup's ready${outcome.branch ? ` at ${outcome.branch}` : ""}. Want pickup instead?`, `لسه مبنوصلش المنطقة دي 🙏 — بس التيك أواي جاهز${outcome.branch ? ` من ${outcome.branch}` : ""}. تحب تيك أواي؟`, `Lesa mabnwaselsh el mante2a de 🙏 — bas el pickup gahez${outcome.branch ? ` men ${outcome.branch}` : ""}.`),
      below_min_order: L2(`Delivery needs a minimum of ${outcome.min_order} EGP 🙏 — add a bit more, or pickup has no minimum. Which works?`, `الدليفري أقل طلب ${outcome.min_order} جنيه 🙏 — زوّد حاجة صغيرة، أو التيك أواي من غير حد أدنى. إيه رأيك؟`, `El delivery a2al order ${outcome.min_order} EGP 🙏 — zawed 7aga so3'ayara, aw pickup men gheir minimum.`),
    };
    let reply = value.value?.reply || fallback[outcome.kind] || fallback.ask_items;
    // SCRIPT BACKSTOP (every outcome): a model line in the WRONG SCRIPT for this guest
    // is thrown away for the code fallback. English/Franco guests get Latin letters
    // only; Arabic guests get a line that actually contains Arabic. Dish names may
    // legitimately be Latin inside an Arabic line, so the Arabic check is "has Arabic
    // at all", the Latin check is "has no Arabic at all".
    if (value.value?.reply && fallback[outcome.kind]) {
      const hasAr = /[؀-ۿ]/.test(reply);
      const wrongScript = LANGV === "ar" ? !hasAr : hasAr;
      if (wrongScript) {
        log(`order: model reply in the wrong script for lang=${LANGV} on ${outcome.kind} — using code fallback`);
        reply = fallback[outcome.kind];
        if (value.value) value.value.quick_replies = null;
      }
    }
    // Notices ("Noted — pickup ✅", equivalence swaps) render as their OWN WhatsApp bubble,
    // so the "👇" ask lead always sits directly on top of its choices.
    let noticeBlock = null;

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

    // Where's my order → the model writes one warm line, CODE draws the ladder
    if (outcome.kind === "order_status" && outcome.order) {
      reply = `${reply.split("\n")[0]}\n\n${statusTimeline(outcome.order, config.basic_info?.timezone || "Africa/Cairo")}`;
    }

    // Fulfillment questions are STRUCTURE too — model writes one lead-in line
    if (outcome.kind === "ask_fulfillment") {
      const qs = [];
      if (outcome.need_type) qs.push(L2(`How would you like it?\n• Dine-in\n• Pickup${outcome.delivery === false ? "" : "\n• Delivery"}`, `تحب طلبك يكون إزاي؟\n• في المطعم (Dine-in)\n• تيك أواي (Pickup)${outcome.delivery === false ? "" : "\n• دليفري (Delivery)"}`, `Te7eb el order ezay?\n• Dine-in\n• Pickup${outcome.delivery === false ? "" : "\n• Delivery"}`));
      if (outcome.need_branch) {
        const near = outcome.nearest?.length ? `\n${L2("Closest to you", "أقرب فرع ليك", "A2rab far3 leek")}: ${outcome.nearest[0]} 📍`
          : outcome.usual ? `\n${L2("Your usual", "فرعك المعتاد", "Far3ak el mo3tad")}: ${outcome.usual} ⭐` : "";
        const head = outcome.need_type
          ? L2("If Pickup or Dine-in — please choose which branch, or send your location on Google Maps and we'll pick the nearest one for you 📍", "لو تيك أواي أو في المطعم — اختار الفرع، أو ابعت لوكيشنك على جوجل مابس وهنختارلك الأقرب 📍", "Law pickup aw dine-in — ekhtar el far3, aw eb3at location 3ala Google Maps w hanekhtarlak el a2rab 📍")
          : L2("Please choose which branch, or send your location on Google Maps and we'll pick the nearest one for you 📍", "اختار الفرع، أو ابعت لوكيشنك على جوجل مابس وهنختارلك الأقرب 📍", "Ekhtar el far3, aw eb3at location 3ala Google Maps w hanekhtarlak el a2rab 📍");
        qs.push(`${head}${near}\n${(outcome.branches || []).map((b) => `• ${b}`).join("\n")}`);
      }
      if (outcome.need_table) qs.push(L2(`Which table are you at? (the number's on it — like ${(outcome.tables || []).slice(0, 3).join(", ")})`, `انت على أنهي ترابيزة؟ (الرقم مكتوب عليها — زي ${(outcome.tables || []).slice(0, 3).join("، ")})`, `Enta 3ala anhy tarabeza? (el ra2am maktoob 3aleha — zay ${(outcome.tables || []).slice(0, 3).join(", ")})`));
      if (outcome.need_pickup_time) qs.push(L2(`When are you passing by? 🕐 Your order takes ~${outcome.prep_min || 10} min — say "now", "in 30 min", or a time`, `هتعدي علينا امتى؟ 🕐 طلبك بياخد حوالي ${outcome.prep_min || 10} دقيقة — قول "دلوقتي" أو "بعد نص ساعة" أو معاد`, `Hat3ady emta? 🕐 El order byakhod ~${outcome.prep_min || 10} d2ay2 — 2ol "delwa2ty" aw "ba3d nos sa3a"`));
      if (outcome.need_payment && outcome.pay_methods?.length) qs.push(`${L2("And how will you pay? 💳", "وهتدفع إزاي؟ 💳", "W hatedfa3 ezay? 💳")}\n${outcome.pay_methods.map((m) => `• ${LANGV === "ar" ? arPay(m) : m.replace(/^\w/, (c) => c.toUpperCase())}`).join("\n")}\n${L2("(you can answer everything in one message 😄)", "(ممكن تجاوب على كله في رسالة واحدة 😄)", "(momken tegaweb 3ala kolo f message wa7da 😄)")}`);
      if (outcome.need_address) {
        const addr = (outcome.saved || []).length
          ? L2(`Delivery address — same as before (${outcome.saved[0]}), or somewhere new?`, `عنوان التوصيل — نفس المرة اللي فاتت (${outcome.saved[0]})، ولا مكان جديد؟`, `El 3enwan — nafs el mara elly fatet (${outcome.saved[0]}), wala makan gedid?`)
          : (LANGV === "ar" ? ADDRESS_TEMPLATE_AR : ADDRESS_TEMPLATE_EN);
        // In a STACKED ask every conditional question carries its condition (same
        // pattern as "If Pickup or Dine-in —" on the branch question): the guest may
        // answer any subset, and a bare "What's the delivery address?" under the
        // payment list read as unconditional. Alone (type already locked), it stays
        // plain — "(if delivery)" to someone who just said delivery reads as deaf.
        // The condition is only meaningful while the TYPE is still being asked in the
        // same message. Once they've said "delivery", the address ask is unconditional.
        qs.push(outcome.need_type ? `${L2("(If delivery) ", "(لو دليفري) ", "(Law delivery) ")}${addr}` : addr);
      }
      // The lead-in ("Almost done — just the last details") belongs on the FIRST
      // fulfilment ask only; repeated every turn it reads as a stuck loop. The act node
      // computes this from whether we'd already asked (persisted leadin_shown) — which
      // is right even when the guest states the type up front (need_type would be false
      // on their genuine first ask) AND when turn 1 asks but saves no slot.
      if (outcome.notices?.length) noticeBlock = outcome.notices.join("\n");
      // type-first lead is a greeting only — the type QUESTION lives in qs, once.
      // Ask BOTH in one breath. Splitting "how would you like it?" from "what would
      // you like?" made the guest answer "pickup", get the menu pushed at them again,
      // and only then start ordering — three rounds for something they can say in one.
      const hasItems = !!(outcome.items?.length);
      reply = outcome.type_first && !hasItems
        ? `${L2("Let's get you fed 😄👇", "أهلاً بيك! 😄👇", "Yalla notlob 😄👇")}\n\n${qs.join("\n\n")}\n\n${L2(
            "You can answer both at once — e.g. *pickup, 2 Classic Burgers* 👇",
            "تقدر تقولّي الاتنين مرة واحدة — مثلاً *تيك أواي، ٢ كلاسيك برجر* 👇",
            "Momken te2ool el etnen mara wa7da — masalan *pickup, 2 Classic Burger* 👇",
          )}`
        // dish already named, type asked first: a short nod, then the question
        : outcome.type_first && hasItems
        ? `${L2("Great choice 👍", "اختيار حلو 👍", "Ekhtyar 7elw 👍")}\n\n${qs.join("\n\n")}`
        : outcome.first_fulfilment ? `${reply.split("\n")[0]}\n\n${qs.join("\n\n")}` : qs.join("\n\n");
    }

    // Which-PLACE candidates — numbered so "2" answers it too
    if (outcome.kind === "which_place") {
      reply = `${reply}\n${(outcome.candidates || []).map((c, i) => `${i + 1}. ${c}`).join("\n")}\n${L2("Or share your location 📍", "أو ابعت لوكيشنك 📍", "Aw eb3at location 📍")}`;
    }
    // Which-one candidates are STRUCTURE too — one lead line, code lists the dishes
    if (outcome.kind === "which_item") {
      let lead = reply.split("\n")[0];
      // a silent identical re-ask reads as a stuck bot — say we missed it
      if ((outcome.tries || 1) >= 2) {
        lead = `${L2("Sorry — didn't catch that 😅 Pick one of these:", "معلش مش فاهم قصدك 😅 اختار واحد من دول:", "Ma3lesh mesh fahem 2asdak 😅 ekhtar wa7ed men dol:")}`;
      }
      reply = `${lead}\n\n${(outcome.candidates || []).map((c) => `• *${dishDisp(c)}*`).join("\n")}`;
    }

    // Option questions are STRUCTURE, and structure is code's job — the model
    // once crammed two items and six comma-runs into one paragraph. It writes a
    // single lead-in line; the formatted questions are appended verbatim.
    if (outcome.kind === "ask_choice" && outcome.questions?.length) {
      const AW = LANGV === "ar";
      const qBlock = outcome.questions.map((q) => {
        const head = `${AW ? arLabel(q.label) : q.label}${q.of > 1 ? (AW ? ` — اختار ${q.remaining}` : ` — ${q.remaining} to pick`) : ""}${q.mixable ? (AW ? ` (ممكن تنوّع بين الـ${q.mixable})` : ` (you can mix across your ${q.mixable})`) : ""}`;
        return `${head}:\n${q.options.map((o) => `• ${AW ? arWord(o) : o}`).join("\n")}`;
      }).join("\n\n");
      // EVERY guest gets the CODE lead — the model wrote English for Franco (Latin
      // script passes its mirror rule), Arabic for an English guest, and once claimed
      // a choice was recorded before the guest answered. One deterministic line in
      // the guest's own dialect, naming the dish, ends all three failure modes.
      let lead = L2(`Quick choices for your *${outcome.item}* — you can answer in one go 👇`,
        `اختيارات سريعة لـ *${dishDisp(outcome.item)}* — ممكن تجاوب كلها مرة واحدة 👇`,
        `Quick choices 3ashan *${outcome.item}* — momken tegaweb kolaha mara wa7da 👇`);
      // a re-ask must SAY it didn't understand — the silent identical reprint read
      // as the bot being stuck (a real guest answered "Burger" and got a wall twice)
      if ((outcome.tries || 1) >= 2) {
        lead = `${L2("Sorry — didn't catch that 😅 Pick from these:", "معلش مش فاهم قصدك 😅 اختار من دول:", "Ma3lesh mesh fahem 2asdak 😅 ekhtar men dol:")}\n${lead}`;
      }
      if (outcome.notices?.length) noticeBlock = outcome.notices.join("\n");
      // The dish being configured pops in WhatsApp bold — the guest's eye finds WHICH
      // item these questions belong to at a glance (model-written leads included).
      if (outcome.item && lead.includes(outcome.item) && !lead.includes(`*${outcome.item}*`)) {
        lead = lead.replace(outcome.item, `*${outcome.item}*`);
      }
      reply = `${lead}\n\n${qBlock}`;
    }

    // Bundle template turns: the model writes one lead-in line; everything the
    // guest must read or copy-paste is appended by code, verbatim.
    if (outcome.kind === "ask_choice" && (outcome.slots_intro || outcome.slots_missing)) {
      const parts = [reply.split("\n")[0]];
      if (outcome.notices?.length) noticeBlock = outcome.notices.join("\n");
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
        const mods = modifiers(it).map((m) => (LANGV === "ar" ? arWord(m) : m));
        return `• ${it.qty}× *${dishDisp(it.name)}*${mods.length ? ` (${mods.join(" · ")})` : ""} — ${open_(it) ? (LANGV === "ar" ? "من " : "from ") : ""}${money(itemPrice(it) * it.qty)}`;
      });
      const RULE = "―".repeat(24);
      reply = `${reply}\n\n${RULE}\n${lines.join("\n")}\n${L2("Subtotal", "الإجمالي الجزئي", "Subtotal")}: ${anyOpen ? L2("from ", "من ", "from ") : ""}${money(outcome.running.subtotal)}\n${RULE}`;
    }

    // Upsell is CODE-PLACED: top of the payment message, dish name in bold —
    // trailing model-woven mentions kept burying it.
    if (outcome.kind === "confirm_order" && outcome.upsell?.length) {
      const bold = outcome.upsell.map((u) => {
        const m = String(u).match(/^(.*?)\s*\((.*)\)\s*$/);
        const nm = m ? dishDisp(m[1].trim()) : dishDisp(String(u));
        return m ? `*${nm}* (${m[2]})` : `*${nm}*`;
      }).join(" · ");
      const many = outcome.upsell.length > 1;
      reply = `${many
        ? L2(`🍟 Add-ons? ${bold} — say the name, or confirm as is ✅`, `🍟 تحب تضيف حاجة؟ ${bold} — قول الاسم، أو أكد الطلب زي ما هو ✅`, `🍟 Tedif 7aga? ${bold} — 2ol el esm, aw akked el order zay ma howa ✅`)
        : L2(`🍟 Add ${bold}? — or confirm as is ✅`, `🍟 تحب تضيف ${bold}؟ — أو أكد الطلب زي ما هو ✅`, `🍟 Tedif ${bold}? — aw akked el order zay ma howa ✅`)}\n\n${reply}`;
    }
    if (outcome.kind === "ask_payment" && outcome.upsell?.length) {
      const bold = outcome.upsell.map((u) => {
        const m = String(u).match(/^(.*?)\s*\((.*)\)\s*$/);
        const nm = m ? dishDisp(m[1].trim()) : dishDisp(String(u));
        return m ? `*${nm}* (${m[2]})` : `*${nm}*`;
      }).join(" · ");
      reply = `${L2(`🍟 Add ${bold}?`, `🍟 تحب تضيف ${bold}؟`, `🍟 Tedif ${bold}?`)}\n\n${reply}`;
    }

    // The bill is rendered by CODE and appended — the model never writes a number.
    // A model that ignored the money rule anyway gets its stray totals dropped here.
    if (outcome.bill && ["ask_payment", "confirm_order", "order_placed"].includes(outcome.kind)) {
      reply = reply
        .split("\n")
        .filter((l) => !/(total|subtotal|إجمالي|المجموع)\s*[:=]/i.test(l))
        .join("\n")
        .trim();
      // Compact mode: the receipt PDF already shows the full bill — the placed text
      // stays short (code + ETA ride below) so it fits the PDF caption and the whole
      // confirmation ships as ONE message.
      if (outcome.kind === "order_placed" && outcome.receipt_url && config.ai?.compact_messages === true) {
        reply = `${reply}${outcome.eta_minutes && !/min|دقيقة|دقايق/i.test(reply) ? `\nReady in ~${outcome.eta_minutes} min ⏱` : ""}`;
      } else {
      // confirm reads like the paper receipt FIRST, then one clear ask under it
      const billFirst = outcome.kind === "confirm_order";
      const askLine = reply;
      reply = `${billFirst ? "" : `${reply}\n\n`}${renderBill({
        lang: LANGV,
        arName: arNameOf,
        branchPin: outcome.branch_pin || null,
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
        trackUrl: outcome.kind === "order_placed" ? outcome.track_url : null,
        restaurant: config.name,
        slug: config.slug,
        when: new Date().toLocaleString("en-GB", { timeZone: config.basic_info?.timezone || "Africa/Cairo", hour12: true, day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" }),
      })}${billFirst ? `\n\n${askLine}` : ""}`;
      }
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
    // A message that asks TWO things (address + payment, type + branch) gets NO
    // buttons in any language: a tap answers one and the guest believes they're done.
    const asksSeveral = outcome.kind === "ask_fulfillment"
      && ([outcome.need_type, outcome.need_branch, outcome.need_table, outcome.need_address, outcome.need_pickup_time, outcome.need_payment].filter(Boolean).length > 1);
    const fulfillNeeds = outcome.kind === "ask_fulfillment"
      ? [outcome.need_type, outcome.need_branch, outcome.need_table, outcome.need_address, outcome.need_pickup_time].filter(Boolean).length : 0;
    const forced =
      outcome.kind === "ask_choice" && outcome.questions?.length === 1 ? (outcome.questions[0].names || [])
      : outcome.kind === "ask_fulfillment" && fulfillNeeds === 1 && outcome.need_type ? (outcome.type_first && config.ai?.compact_messages === true ? null : (LANGV === "ar" ? ["في المطعم", "تيك أواي", ...(outcome.delivery === false ? [] : ["دليفري"])] : ["Dine-in", "Pickup", ...(outcome.delivery === false ? [] : ["Delivery"])]))
      : outcome.kind === "ask_fulfillment" && fulfillNeeds === 1 && outcome.need_branch ? (outcome.branches || [])
      : outcome.kind === "ask_fulfillment" && !asksSeveral && outcome.need_address && (outcome.saved || []).length
        ? [...outcome.saved.slice(0, 2).map((a, i) => (i === 0 ? `🏠 ${String(a).slice(0, 16)}` : `📍 ${String(a).slice(0, 16)}`)), L2("Somewhere new", "مكان جديد", "Makan gedid")]
      : outcome.kind === "which_item" ? (outcome.candidates || [])
      : outcome.kind === "which_place" ? (outcome.candidates || []).map((c) => String(c).slice(0, 20))
      : outcome.kind === "confirm_order" ? (LANGV === "ar" ? ["تأكيد ✅", "عدّل حاجة"] : ["Confirm ✅", "Change something"])
      : outcome.kind === "ask_payment" ? (outcome.methods || []).map((m) => m.split(" ")[0].replace(/^\w/, (c) => c.toUpperCase()))
      // NOW is the moment for "the usual" — they have said they're ordering but not
      // yet what. Offering it in the greeting spent a button before anyone had decided
      // to order anything; offering it here is one tap at the exact decision point.
      : ["ask_items", "no_history"].includes(outcome.kind) ? reorderChips(diner, config)
      : null;
    let optionList = null;
    // multi-question message → strip ANY buttons, the model's included
    if (asksSeveral && value.value) value.value.quick_replies = null;
    if (forced && !asksSeveral) {
      value.value = value.value || {};
      if (["ask_choice", "ask_fulfillment", "which_item"].includes(outcome.kind) && forced.length > 3) {
        // buttons cap at 3 on WhatsApp — a list holds 10, so every option is tappable
        const q0 = outcome.kind === "ask_fulfillment"
          ? { label: "Choose your branch 🏪" }
          : outcome.kind === "which_item"
            ? { label: "Which one did you mean?" }
            : outcome.questions?.[0] || { label: "Options" };
        optionList = {
          button: outcome.kind === "ask_fulfillment" ? "Choose branch 🏪" : outcome.kind === "which_item" ? "Pick your dish 🍔" : "View options 🍽",
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

    // The type-first opener carries the menu too — guests answer "pickup, classic
    // burger" in one breath and skip a whole round. (Compact merges it as the caption.)
    const NEEDS_MENU = ["ask_items", "nothing_matched", "no_history", "menu_request"];
    if (outcome.kind === "ask_fulfillment" && outcome.type_first) NEEDS_MENU.push("ask_fulfillment");
    // the opener already delivered the menu this session — don't attach it again
    // type-first with a dish already on the bill is not a menu moment — no PDF, no nudge
    const menuAlreadyShown = (!!loaded.pending?.menu_shown && !outcome.type_first && outcome.kind !== "menu_request")
      || (outcome.type_first && !!(outcome.items?.length));
    let doc = null;
    if (outcome.kind === "order_placed" && outcome.receipt_url) {
      doc = { url: outcome.receipt_url, caption: `Receipt ${outcome.code}`, filename: `${outcome.code}.pdf` };
    } else if (!menuAlreadyShown && NEEDS_MENU.includes(outcome.kind)) {
      const mc = config.menu_config || {};
      const pdf = mc.pdf_url
        ? { url: mc.pdf_url, filename: "menu.pdf" }
        : await menuPdfUrl(db, {
            restaurant: config.name,
            menu: loaded.menu,
              categories: orderedCategories(loaded.menu, config).map((c) => c.name),
            currency,
            accent: config.basic_info?.brand?.primary || "#111111",
            tagline: config.basic_info?.tagline || "",
            phone: config.basic_info?.phone || "",
            website: config.basic_info?.website || "",
            logoUrl: config.basic_info?.brand?.logo_url || null,
          });
      if (pdf) {
        // PDF attached — no raw link next to it (redundant, and the bare host URL
        // reads ugly until the pretty domain is live)
        doc = { url: pdf.url, caption: L2(`${config.name} — full menu 📄`, `${config.name} — المنيو الكامل 📄`, `${config.name} — el menu el kamel 📄`), filename: pdf.filename };
      }
      // First-timer? The restaurant's chosen signatures (up to 3, per-restaurant,
      // toggleable) ride with the menu — a nudge, phrased by code, never invented.
      const sug = (config.ai?.suggest_dishes || []).filter(Boolean).slice(0, 3);
      const firstTimer0 = !diner?.name && !(diner?.visit_count > 0) && !diner?.last_visit_at;
      if (sug.length && config.ai?.suggest_enabled !== false && firstTimer0) {
        // Arabic guests hear the dish by its Arabic menu name, same as everywhere else
        const names = sug.map((d) => `*${dishDisp(d)}*`).join(" · ");
        reply = LANGV === "ar"
          ? `${reply}\n\n⭐ أول مرة؟ جرب ${names} — أكتر حاجة الناس بتحبها!`
          : LANGV === "fr"
            ? `${reply}\n\n⭐ Awel marra? Garrab ${names} — a7la 7aga 3andena!`
            : `${reply}\n\n⭐ First time here? Try ${names} — the crowd favourite${sug.length > 1 ? "s" : ""}!`;
      }
    }

    // MULTI-INTENT: people mix ordering and chatting in one breath ("add a J special —
    // and is the jalapeno bites spicy?"). The order part was just handled above; the
    // question part goes to the friendly brain (it has the full menu/FAQ facts, so no
    // hallucinated answers) and its answer leads the reply, with the order's next step
    // right under it. Both halves of the message get served, neither is dropped.
    let sidePhotos = [];
    let sideText = null;
    const sideQ = String(e.question || "").trim();
    // Never on a turn that was ANSWERING an open option question (the extractor sometimes
    // splits "Combo cola zero" and mislabels the tail a "question" — friendly then sends a
    // second, contradictory message). Real mixed turns carry items/edits; pure questions
    // mid-ask go through the question-intent handoff instead.
    const sideAllowed = !!(e.items?.length || e.edits?.length) || !awaitingAtTurnStart;
    if (sideQ.length >= 4 && sideAllowed) {
      const side = await f.flow("friendly", { message: sideQ, diner, history: input.history, precheck: input.precheck, classification });
      if (side?.reply) {
        sideText = side.reply;
        sidePhotos = side.photos || [];
      }
    }

    // Notices on non-ask outcomes (a substitution note riding into the payment ask or
    // the receipt) still surface — silence there would hide what we swapped.
    if (!noticeBlock && outcome.notices?.length) noticeBlock = outcome.notices.join("\n");
    // Explicit bubbles: [friendly's side answer] [notices] [the ask/bill — never split].
    // The deliverer sends these as separate messages instead of guessing a split point.
    const bubbles = [sideText, noticeBlock, reply].filter(Boolean);
    reply = bubbles.join("\n\n");

    return {
      reply,
      parts: bubbles,
      wantLocation: (outcome.kind === "ask_fulfillment" && !!outcome.need_address) || outcome.kind === "need_pin",
      menuList: optionList,
      // pipeline decision points keep their buttons even back-to-back — the
      // anti-spam pacing rule cost a guest their Confirm button and the order died
      forceButtons: ["ask_choice", "ask_payment", "confirm_order", "ask_order_type", "which_item", "which_place"].includes(outcome.kind),
      // the menu / receipt PDF rides along as a WhatsApp document
      menuDoc: doc,
      quickReplies: (value.value?.quick_replies || []).map((q) => String(q).slice(0, 20)).slice(0, 3),
      photos: sidePhotos,
    };
  },
});

function publicOrder(o) {
  return {
    code: o.code, status: o.status, order_type: o.order_type, table_number: o.table_number,
    items: o.items, total: o.total,
    created_at: o.created_at, started_at: o.started_at, ready_at: o.ready_at, out_at: o.out_at,
    courier_name: o.courier_name || null, branch: o.branch || null,
  };
}

// A code-drawn progress ladder — the guest sees exactly where their food is and
// how long each step took. Timestamps come from the board's own stamps, so the
// bot can never invent progress that didn't happen.
// Their real history, as taps: the saved custom build first (it is named, so it is the
// strongest offer), then their last order. Nothing invented — an empty history means
// no chips, and the model just asks what they'd like.
function reorderChips(diner, config) {
  const chips = [];
  const build = (diner?.preferences?.builds || [])[0];
  if (build?.name && build.layers) chips.push(`${String(build.name).slice(0, 18)} 🔁`);
  const last = (diner?.preferences?.last_items || [])[0]?.name || diner?.preferences?.usual_item;
  if (last) chips.push(`${String(last).slice(0, 18)} 🔁`);
  return chips.length ? chips.slice(0, 2) : null;
}

function statusTimeline(o, tz = "Africa/Cairo") {
  const t = (v) => v ? new Date(v).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }) : null;
  const delivery = o.order_type === "delivery";
  const steps = [
    { key: "placed", label: "Order received", at: o.created_at, done: true },
    { key: "preparing", label: "Kitchen started", at: o.started_at, done: !!o.started_at || ["preparing", "ready", "out_for_delivery", "served", "delivered"].includes(o.status) },
    { key: "ready", label: delivery ? "Packed & ready" : (o.order_type === "dine_in" ? "Coming to your table" : "Ready for pickup"), at: o.ready_at, done: ["ready", "out_for_delivery", "served", "delivered"].includes(o.status) },
  ];
  if (delivery) steps.push({
    key: "out", label: o.courier_name ? `On the way with ${String(o.courier_name).split(" ")[0]}` : "On the way",
    at: o.out_at, done: ["out_for_delivery", "delivered"].includes(o.status),
  });
  const mins = o.created_at ? Math.round((Date.now() - new Date(o.created_at).getTime()) / 60000) : null;
  const body = steps.map((st) => `${st.done ? "✅" : "⬜"} ${st.label}${st.done && t(st.at) ? ` · ${t(st.at)}` : ""}`).join("\n");
  return `🎫 *${o.code}*${mins != null ? ` · ${mins} min ago` : ""}\n${body}`;
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
  // chips render as "🏠 Zahraa El Maadi, s" — drop the emoji/marker before matching
  const m = normName(String(message).replace(/^[\s🏠📍]+/u, ""));
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
// Delegates to the shared formatter (object-safe, and "sandwich only" is the
// default so a plain sandwich shows no modifier) — see services/orderline.js.
function modifiers(it) {
  return itemMods(it);
}

// Option groups live on the menu item itself (menu_items.options), so each
// restaurant defines its own questions in the dashboard. A group is asked only
// when its "when" condition is met by earlier answers, so "which size" never
// appears for someone who picked the plain sandwich.
//
// choice.price = absolute (replaces the item's base price) · choice.delta = added
// group.count  = ask for that many picks · group.from_category = read the live menu
// How many UNITS of a multi-unit line does this choice cover? People mix choices
// with position words, not just counts: "hot for the first 2 and the third one
// medium", "coke for the first, sprite for the second", "واحد حار والتاني ميديام".
// Only a count that hugs the choice name is trusted; anything unclear returns null
// so the caller leaves the question open instead of guessing.
const UNIT_WORDS = { one: 1, two: 2, three: 3, four: 4, "١": 1, "٢": 2, "٣": 3, "٤": 4,
  "واحد": 1, "اتنين": 2, "تنين": 2, "تلاتة": 3, "تلاته": 3, "اربعة": 4, "أربعة": 4 };
const ORDINAL_ONE = /(second|third|fourth|last|other|remaining|التاني|الثاني|التالت|الثالث|الاخير|الأخير|الباقي)/i;
function unitsForChoice(said, at, len) {
  const before = said.slice(Math.max(0, at - 18), at);
  const after = said.slice(at + len, at + len + 24);
  const win = `${before} | ${after}`;
  // "for the first 2" / "أول اتنين" — the count that follows or precedes "first"
  const firstN = /(?:first|أول|اول)\s*(\d+|two|three|four|اتنين|تلاتة|تلاته)/i.exec(win);
  if (firstN) return Math.min(UNIT_WORDS[firstN[1].toLowerCase()] ?? Number(firstN[1]) ?? 1, 8);
  // a bare count hugging the name: "2 hot", "hot x2", "٢ حار"
  const digits = /(\d+)\s*x?\s*$/.exec(before) || /^\s*x\s*(\d+)/.exec(after);
  if (digits) return Math.min(Number(digits[1]) || 1, 8);
  const w = /([\p{L}\p{N}]+)\s*$/u.exec(before);
  if (w && UNIT_WORDS[w[1].toLowerCase()] != null) return UNIT_WORDS[w[1].toLowerCase()];
  // "the third one", "the other one", "التاني" — one unit
  if (ORDINAL_ONE.test(win)) return 1;
  return null;
}

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
const SODA_WORDS = /(?<![\p{L}\p{N}])(cola|coke|pepsi|soda|كولا|بيبسي)(?![\p{L}\p{N}])/iu;
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
// one-edit distance for ≥5-char tokens — voice transcripts drop letters
// ("diblo" must still hit "diablo"); never fuzzier than a single edit
function lev1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
function optionMatches(said, optName) {
  const o = normName(optName);
  if (o === said || said.includes(o)) return true;
  const saidTok = said.split(" ").filter((t) => t.length >= 3);
  const optTok = o.split(" ").filter((t) => t.length >= 3);
  return optTok.some((ot) => saidTok.some((st) =>
    st === ot || (st.length >= 4 && ot.startsWith(st.slice(0, 4))) || (ot.length >= 4 && st.startsWith(ot.slice(0, 4))) ||
    (st.length >= 5 && ot.length >= 5 && lev1(st, ot))
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
// Arabic spellings of the option vocabulary → their Latin menu equivalents.
// normName() drops Arabic script entirely, so without this a guest saying
// "ميديام فرنش فرايز وكوكاكولا" (voice notes especially) matches NOTHING and
// every question gets re-asked. Longest-first so "كوكا كولا دايت" wins over "كولا".
const AR_OPTION_WORDS = [
  ["كوكا كولا دايت", "coca cola diet"], ["كوكاكولا دايت", "coca cola diet"],
  ["كوكا كولا", "coca cola"], ["كوكاكولا", "coca cola"], ["كولا دايت", "coca cola diet"],
  ["فرنش فرايز", "french fries"], ["بطاطس عادية", "french fries"], ["فرنشايز", "french fries"],
  ["ديابلو", "diablo"], ["ديبلو", "diablo"], ["دابلو", "diablo"], ["ديابولو", "diablo"],
  ["كيرلي", "curly"], ["كيرلى", "curly"], ["كورلي", "curly"],
  ["برتقال", "orange"], ["اورنج", "orange"], ["أورنج", "orange"],
  ["فانتا", "fanta"], ["فانتة", "fanta"], ["فنتا", "fanta"],
  ["فرايد تشيكن", "fried chicken"], ["تشيكن", "chicken"], ["فراخ", "chicken"], ["فرايد", "fried"],
  ["كوكا", "coca"], ["فرايز", "fries"],
  ["ميديام", "medium"], ["ميديم", "medium"], ["متوسط", "medium"], ["وسط", "medium"],
  ["سمول", "small"], ["صغيرة", "small"], ["صغير", "small"],
  ["لارج", "large"], ["كبيرة", "large"], ["كبير", "large"],
  ["سبرايت", "sprite"], ["فانتا", "fanta"], ["مياه", "water"], ["ميه", "water"], ["مية", "water"],
  ["لتر", "litre"], ["كولا", "cola"], ["دايت", "diet"],
  ["فل ميل", "full meal"], ["وجبة كاملة", "full meal"], ["كومبو", "full meal"],
  ["ساندوتش بس", "sandwich only"], ["ساندويتش بس", "sandwich only"], ["ساندوتش لوحده", "sandwich only"],
  ["ساندوتش", "sandwich"], ["ساندويتش", "sandwich"], ["وجبة", "meal"],
];
function arOptionWords(message) {
  let m = String(message || "");
  for (const [ar, en] of AR_OPTION_WORDS) m = m.split(ar).join(` ${en} `);
  return m;
}

function nextQuestion(items, menu, message, pending, currency = "EGP") {
  message = arOptionWords(String(message).replace(/^\[voice\]\s*/i, ""));
  const out = items.map((it) => ({ ...it, options: { ...(it.options || {}) } }));
  const said = normName(message);

  // Answers can arrive before their gate: "medium fries and a cola" while
  // sandwich-or-meal is still open. Naming a choice that only exists under ONE
  // gate value IS choosing that value — code infers it, the guest isn't re-asked.
  // TWO GUARDS (a real guest hit both): the match must be the FULL choice name or
  // ALL of its distinguishing tokens — a lone shared word ("cola" from "cola zero")
  // must never infer anything; and if MORE THAN ONE item has this gate open, whose
  // drink is it? Ambiguous — skip, each item gets asked properly in turn.
  for (const it2 of out) {
    for (const g of it2.option_defs || []) {
      if (g.key === "slots" || !g.when) continue;
      const entries = Object.entries(g.when);
      if (entries.length !== 1) continue;
      const [pKey, pWant] = entries[0];
      const pVal = Array.isArray(pWant) ? (pWant.length === 1 ? pWant[0] : null) : pWant;
      if (!pVal || it2.options[pKey]) continue;
      const openHosts = out.filter((x) => !x.options[pKey] && (x.option_defs || []).some((gg) => gg.key === pKey)).length;
      if (openHosts > 1) continue; // ambiguous across items — ask each in turn
      const opts2 = groupChoices(g, menu);
      if (!opts2.length) continue;
      const stop2 = distinctTokens(opts2);
      const hit = opts2.some((o) => {
        const on = normName(o.name);
        if (said.includes(on)) return true;
        const oTok = on.split(" ").filter((t) => !stop2.has(t));
        return oTok.length && oTok.every((t) => optionMatches(said, t));
      });
      if (hit) it2.options[pKey] = pVal;
    }
  }
  const padded = ` ${said} `;
  for (const it2 of out) {
    for (const g of it2.option_defs || []) {
      if (g.key === "slots") continue;
      if (!groupApplies(g, it2.options)) continue;
      const need2 = Number(g.count) || 1;
      const have2 = it2.options[g.key];
      if ((Array.isArray(have2) ? have2.length : have2 ? 1 : 0) >= need2) continue;
      // Same ambiguity rule as the inference above: when MORE THAN ONE item has this
      // question open, one message can't answer it for all of them — the asked item is
      // handled by the awaiting-answer block below, and the next item gets its own ask.
      const openHosts2 = out.filter((x) => {
        const gg = (x.option_defs || []).find((d) => d.key === g.key && d.key !== "slots");
        if (!gg || !groupApplies(gg, x.options)) return false;
        const hv = x.options[g.key];
        return (Array.isArray(hv) ? hv.length : hv ? 1 : 0) < (Number(gg.count) || 1);
      }).length;
      if (openHosts2 > 1) continue;
      const strict = groupChoices(g, menu).filter((o) => {
        const cn = normName(o.name);
        return cn && padded.includes(` ${cn} `);
      });
      if (strict.length === 1 && need2 === 1) it2.options[g.key] = strict[0].name;
    }
  }
  // notes that only restate applied choices are ticket noise — drop them
  for (const it2 of out) {
    if (!it2.notes) continue;
    const chosen = normName(Object.values(it2.options).filter((v) => typeof v === "string").join(" "));
    const FILLER = new Set(["and", "with", "a", "an", "the", "please", "و", "مع"]);
    const words = normName(arOptionWords(it2.notes)).split(" ").filter((w) => w && !FILLER.has(w));
    if (words.length && words.every((w) => chosen.includes(w))) it2.notes = null;
  }

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
      if (!hits.length) {
        // score by how many of the option's own tokens the guest actually said —
        // "diet coca" must pick Coca-Cola DIET (2 tokens), never plain Coca-Cola (1)
        const scored = opts.map((o) => {
          const oTok = normName(o.name).split(" ").filter((t) => !stop.has(t));
          const matched = oTok.filter((ot) => optionMatches(said, ot)).length;
          return { o, matched, ok: matched > 0 && optionMatches(said, oTok.join(" ") || o.name) };
        }).filter((x) => x.ok);
        const best = Math.max(0, ...scored.map((x) => x.matched));
        hits = scored.filter((x) => x.matched === best).map((x) => x.o);
      }
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
        const key = normName(h.name).split(" ")[0];
        const idx = said.indexOf(key);
        const q = (idx >= 0 ? unitsForChoice(said, idx, key.length) : null) ?? 1;
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
      } else if (new Set(picked).size === 1) {
        it.options[g.key] = picked[0];
      }
      // else: the message matched SEVERAL choices equally ("cola zero" scored the same
      // against Coca-Cola and Coca-Cola Diet) — a tie is a question, not an answer.
      // Leave the group open so the printed list disambiguates; never guess picked[0].
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
// The VAT rate, for the receipt's Net/VAT/Total breakdown. Same >=1 → percent rule as
// the bill. Defaults to Egypt's 14% when unset — every restaurant here charges it and
// the printed receipt is legally required to show it, so this is a real national
// standard, not an invented number.
function taxRate(config) {
  const p = config?.payments || {};
  for (const k of ["tax_pct", "vat_pct", "tax"]) {
    const v = Number(p[k]);
    if (Number.isFinite(v) && v > 0) return v >= 1 ? v / 100 : v;
  }
  return 0.14;
}

function priceOrder(items, config, orderType, quotedDeliveryFee = null, deliveryKm = null) {
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
  // The fee the bot QUOTED (zone / flat / distance — computed by services/delivery.js
  // and stored on the draft) is the fee that's BILLED. payments.delivery_fee is only
  // the legacy fallback for restaurants with no delivery config at all. Quoting 30
  // and charging 70 was a real bug.
  const feeSrc = quotedDeliveryFee != null && Number.isFinite(Number(quotedDeliveryFee)) ? Number(quotedDeliveryFee) : (Number(p.delivery_fee) || 0);
  const delivery_fee = orderType === "delivery" ? round(feeSrc) : 0;
  if (delivery_fee > 0) extras.push({ label: deliveryKm != null && pricingOf(config).mode === "distance" ? `Delivery (~${deliveryKm} km)` : "Delivery", amount: delivery_fee });

  // VAT is INCLUSIVE — menu prices already include it, exactly like the printed
  // receipt ("Prices are VAT inclusive"). It is NEVER added on top; it's shown as a
  // breakdown of the total: Net = total / (1 + rate), VAT = total − Net. Adding it as
  // an extra was overcharging ~14% on prices that already contained it.
  const total = round(subtotal + extras.reduce((s, x) => s + x.amount, 0));
  const rate = rateOf("tax", "tax_pct", "vat_pct") || 0.14;
  const vat = round(total - total / (1 + rate));
  const net = round(total - vat);
  return { subtotal, extras, service_charge, delivery_fee, tax: vat, vat, net, vat_inclusive: true, total };
}

// The bill as the guest sees it. Built here so the model never writes a number
// or a currency symbol — it phrases around this block, it doesn't compose it.
const fmtAmount = fmtMoney;


// ---- Arabic DISPLAY translation for generic menu vocabulary ----
// Labels and generic choice words render in Arabic for Arabic guests; DISH NAMES
// stay as authored (house rule). Matching is unaffected: the resolver is semantic
// and arOptionWords maps the Arabic answers back.
const AR_MENU_WORDS = [
  [/^which one$/i, "تحب تاخده إزاي؟"], [/^combo drink$/i, "مشروب الكومبو"],
  [/^combo size$/i, "حجم الكومبو"], [/^size$/i, "الحجم"], [/^which fries$/i, "البطاطس"],
  [/^drink$/i, "المشروب"], [/^side$/i, "الجانب"], [/^spice level$/i, "مستوى الحرارة"],
  [/^sandwich$/i, "ساندوتش"], [/^combo \(fries \+ drink\)$/i, "كومبو (بطاطس + مشروب)"],
  // bare condition words as they appear in "If Combo — …" — the choice NAME is
  // "Combo (fries + drink)" but the when-value is just "Combo"
  [/^combo$/i, "كومبو"], [/^meal$/i, "وجبة"], [/^full meal$/i, "وجبة كاملة"], [/^sandwich only$/i, "ساندوتش بس"],
  [/^full meal$/i, "وجبة كاملة"], [/^meal$/i, "وجبة"], [/^small$/i, "صغير"],
  [/^medium$/i, "وسط"], [/^large$/i, "كبير"], [/^mild$/i, "خفيف"],
  [/^medium spicy$/i, "وسط حراقة"], [/^hot 🔥$/i, "حار 🔥"], [/^hot$/i, "حار"],
  [/^french fries$/i, "بطاطس"], [/^coca - cola$/i, "كوكاكولا"],
  [/^coca - cola diet$/i, "كوكاكولا دايت"], [/^sprite$/i, "سبرايت"], [/^fanta$/i, "فانتا"],
  [/^fanta orange$/i, "فانتا برتقال"], [/^water$/i, "مية"],
];
const arWord = (w) => { for (const [rx, ar] of AR_MENU_WORDS) if (rx.test(String(w).trim())) return ar; return w; };
const AR_PAY = { "cash on delivery": "كاش عند الاستلام", "cash at the counter": "كاش في الكاونتر", "cash at the cashier": "كاش عند الكاشير", "card": "كارت", "card at the cashier": "كارت عند الكاشير", "instapay": "انستاباي", "online link": "لينك أونلاين" };
const arPay = (m) => AR_PAY[String(m).toLowerCase().trim()] || m;
const arLabel = (l) => String(l).replace(/^If (.+?) — (.+)$/i, (m, cond, rest) => `لو ${arWord(cond)} — ${arWord(rest)}`)
  .replace(/^(?!لو )(.*)$/s, (m, x) => arWord(x));

function renderBill({ items, bill, currency, orderType, tableNumber, branchName, address, payment, code, eta, trackUrl, restaurant, slug, when, branchPin, lang, arName }) {
  // The bill mirrors the guest's language (Arabic gets full Arabic labels; Franco
  // keeps the Latin/EN labels — transliterated accounting words read as noise).
  const AR = lang === "ar";
  const money = (n) => `${fmtAmount(n)} ${currency}`;
  const lines = items.map((it) => {
    const mods = modifiers(it).map((m) => (AR ? arWord(m) : m));
    const nm = AR && arName ? arName(it.name) : it.name;
    return `• ${it.qty}× *${nm}*${mods.length ? ` (${mods.join(" · ")})` : ""} — ${money(itemPrice(it) * Number(it.qty))}`;
  });

  const totals = [`${AR ? "الإجمالي الجزئي" : "Subtotal"}: ${money(bill.subtotal)}`];
  for (const x of bill.extras) {
    const lbl = AR ? String(x.label).replace(/^Delivery(\s*\(~([0-9.]+) km\))?$/, (m, _p, km) => (km ? `التوصيل (~${km} كم)` : "التوصيل")).replace(/^Service/, "الخدمة") : x.label;
    totals.push(`${lbl}: ${money(x.amount)}`);
  }
  // The CHAT bill shows what the guest pays, full stop — the Net/VAT breakdown
  // ("Net Amount: 192.98") read like a different price and confused people. The
  // accounting split still lives on the printed PDF receipt where it belongs.
  totals.push(`*${AR ? "الإجمالي المطلوب" : "Total Due"}: ${money(bill.total)}*`);
  if (bill.vat_inclusive) totals.push(AR ? "_الأسعار شاملة الضريبة._" : "_Prices are VAT inclusive._");

  const where = orderType === "dine_in" ? `${AR ? "في المطعم" : "Dine-in"}${tableNumber ? ` · ${AR ? "ترابيزة" : "table"} ${tableNumber}` : ""}${!tableNumber && branchName ? ` · ${branchName}` : ""}`
    : orderType === "pickup" ? `${AR ? "تيك أواي" : "Pickup"}${branchName ? ` · ${branchName}` : ""}${branchPin?.address ? `\n📍 ${branchPin.address}` : ""}${branchPin?.lat && branchPin?.lng ? `\n🗺 maps.google.com/?q=${branchPin.lat},${branchPin.lng}` : ""}`
    : `${AR ? "دليفري" : "Delivery"}${branchName ? ` · ${AR ? "من" : "from"} ${branchName}` : ""}`;

  const RULE = "―".repeat(24);
  // placed orders read like the paper receipt: header with the code and where/when,
  // items, totals, then payment + destination + ETA + the branded receipt link
  const header = code
    ? [`🧾 *${AR ? "إيصال" : "RECEIPT"} ${code}*`, restaurant ? `${restaurant}${branchName ? ` — ${branchName}` : ""}` : null, `${when || ""} · ${where}`.trim()]
    : [`🧾 *${AR ? "طلبك" : "YOUR ORDER"}*`];
  const footer = [
    payment ? `💳 ${payment === "cash" ? (AR ? "كاش" : "Cash") : payment === "card" ? (AR ? "كارت" : "Card") : (AR ? "انستاباي" : "InstaPay")}` : null,
    orderType === "delivery" && address ? `📍 ${address}` : null,
    code && eta ? `⏱ ${AR ? `حوالي ${eta} دقيقة` : `about ${eta} min`}` : null,
    code ? `📄 ${publicLink(`/receipt/${code}`, slug)}` : null,
    trackUrl ? `📍 ${AR ? "تابع طلبك لايف" : "Track live"}: ${trackUrl}` : null,
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
