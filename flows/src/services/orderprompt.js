// THE ORDER EXTRACTOR'S PROMPT, in one place and in cache order.
//
// OpenAI caches an identical prompt PREFIX (≥1024 tokens) at a quarter of the price and
// serves it faster. Everything that is the same for every guest of a restaurant — the
// task, the JSON shape, the rules, the MENU, the BRANCHES — sits first; everything that
// changes per turn — the recent conversation and the draft — sits last. The old order
// put the conversation in line 2, which broke the cache on every single call.
//
// Also the single source for tools/extract-contract.mjs (fifty real messages → expected
// JSON on every prompt change) and tools/replay-extract.mjs (yesterday's real guest
// messages through today's prompt, diffed). A prompt edit is a code change: test it.
export function extractPrompt({ menu, pending, history, branches }) {
  const menuNames = menu.map((m) => `${m.name}${m.name_ar ? ` / ${m.name_ar}` : ""} (${m.category})`).join(" | ");
  // Grounding the model in the ACTUAL current state beats asking it to infer intent
  // from phrasing alone. Earlier this only had a paragraph of trigger phrases for
  // "replace" ("no I want X", "actually X") and the model just never used it — a
  // plain "No i want chicken ranch" kept coming back as items:[{name:"Chicken
  // Ranch"}], edits:null, exactly like a fresh order for that item, because that IS
  // the more natural reading of the sentence in isolation. Telling it directly what
  // is already on the order removes the guesswork: it isn't inferring "this phrasing
  // usually means a swap", it's comparing the name it just extracted against a name
  // it was handed.
  const pendingLine = pending?.items?.length
    ? `\nTHE GUEST ALREADY HAS THIS ON THEIR ORDER (not yet finalized): ${pending.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}. Three ways this message can relate to it:
  (1) It uses ADD language ("add", "also", "kaman", "زود", "كمان") naming another dish → edits op "add" (unchanged from below).
  (2) It answers a choice being asked about the item above (a size, a drink flavor, "sandwich" vs "combo", a modifier) → leave "items" and "edits" null, that answer is handled elsewhere.
  (3) Otherwise, if it names a DIFFERENT main dish from MENU with no add-language — a correction, or just restating what they want — they are SWAPPING the item above OUT, not adding a second dish: edits op "replace", "item" = the name above, "with" = the new name.`
    : "";
    return `Extract a food order from one WhatsApp message to a fast-casual restaurant. MENU (only these exist): ${menuNames}
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
Rules: qty defaults 1; ONLY names from MENU — return the name WITHOUT the (category); menu entries read "English name / Arabic name" — BOTH refer to the SAME dish and you ALWAYS return the ENGLISH name; match within the RIGHT category ("fried chicken" → a Chicken item, NEVER a beef burger); a MEAL's sides/drinks spoken with it ("iconic meal with fries and a cola") are that meal's choices — put them in that item's "notes", NEVER as separate items; an unclear/GARBLED word (voice notes!) is SKIPPED, never guessed — but a CLEARLY named product we don't carry ("a cola zero", "red bull") goes into items AS THE GUEST SAID IT (code reports it as unavailable — silently dropping it loses part of the order); if the RECENT CONVERSATION shows the guest already AGREED to a specific dish we recommended ("thats nice i want this" after we pitched it) and it is NOT already in the draft, include that dish in items too — to the guest it's ALREADY on their order and dropping it loses it ("also I want X" means X in ADDITION to it); never duplicate a dish the draft already has; a NEGATION ("I didn't order X", "مطلبتش X") is edits op "remove", never an item — BUT a bare "no" + item + OPTION word ("no, nashville slaw combo, the other is not") is NEVER removal: it's correcting WHICH item has that option → edits op "set_option" per item. DIRECTION MATTERS: the item NAMED WITH the option RECEIVES it — "no, nashville slaw combo, the other is not" = Nashville Slaw GETS combo ([{op:"set_option", item:"Nashville Slaw", option:"combo"}]) and "the other" (the other draft item) gets the opposite ({op:"set_option", item:"<the other item>", option:"sandwich"}); NEVER swap them; removal needs remove-words (remove/take off/شيل/didn't order); an instruction about ONE item ("burger without onion") belongs in that item's "notes", NOT the order-level "notes"; "edits" is for CHANGING an order being built — "add a coke"/"زود كوكاكولا"/"zawed coke" → op add, "remove the fries"/"شيل البطاطس"/"sheel el batates" → op remove, "make it 2"/"خليهم ٢"/"khaleehom etnen"/"actually just one" → op set_qty with qty, "change the drink to fanta"/"غيّر المشروب فانتا"/"ghayar el mashroob fanta" (a drink/size/format CHOICE of an item already on the order) → op set_option with option = the choice (never a replace of dishes), "no I want the chicken ranch instead"/"actually give me X"/"change it to X"/"مش عايز كذا, عايز X"/"بدل ده هاتلي X" (naming a DIFFERENT menu item to SWAP for one already on the order, mid-question or not) → op replace with "item" = the item being swapped OUT (closest MENU name; omit/null if only one item is on the order so it's unambiguous) and "with" = the item being swapped IN (when they change something, use edits and leave "items" null); "cancel_order" = wants to cancel/scrap the WHOLE order or start over ("cancel it all", "cancel this order", "start over", "forget the whole thing", "الغي الاوردر", "بلاش كله", "من الأول") — removing ONE item is edits op "remove", never cancel_order; "status" = asking where their order is; "confirm" = agreeing to place the order we just summarised (yes/confirm/تمام/اوكي/go ahead); "repeat_last" = wants their usual / same as last time ("same as last time", "the usual", "نفس الطلب", "زي كل مرة", "nafs el order") — items stay null, we rebuild from their history; "question" = the guest is ASKING about the restaurant, not ordering — delivery coverage or fee ("do you deliver to Maadi?", "بتوصلوا المعادي؟ وبكام", "بتوصلوا لحد فين"), hours, ingredients, availability, "do you have tissues" — anything you'd ANSWER rather than put in a cart, even mid-order. CRITICAL: a bare ANSWER to a question WE asked — a size ("Medium"), a drink ("Sprite"), "cash"/"card", a branch name, an address, "yes" — is NEVER "question"; only a real interrogative about the place is.
Recent conversation may add context: ${JSON.stringify((history || []).slice(-4).map((h) => h.message?.slice(0, 80)))}${pendingLine}`;
}
