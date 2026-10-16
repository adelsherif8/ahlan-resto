// ORDER OPTIONS ENGINE — pure functions, no flow state, no DB, no model.
// Extracted from flows/order.js (2026-10-16) so the agent file holds the conversation
// logic and this one holds the mechanics: option groups on a menu item (format → size →
// drink…), bundle slot templates, per-unit splits ("2 hot, 1 mild"), the Arabic/Franco →
// menu-English word maps, and nextQuestion(), which walks an order one item at a time
// like a cashier. Everything here is deterministic; the suite exercises it end to end.
import { francoNorm, looksFranco } from "./franco.js";
import { editDistance } from "./fastpaths.js";
import { itemMods } from "./orderline.js";

// one normaliser for every menu/option comparison in the order pipeline
export const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------------------------------------------------------------------------
// Combo choices — a "meal" comes with a drink (and whatever else the restaurant
// configures). Options are read off the real menu, so we can never offer a drink
// we don't stock. Config: menu_config.combo = { match, choices:[{label, category_match}] }
// ---------------------------------------------------------------------------
// One human line for everything chosen on a line item — picks can be a single
// name or a list (a bundle picks several sandwiches).
// Delegates to the shared formatter (object-safe, and "sandwich only" is the
// default so a plain sandwich shows no modifier) — see services/orderline.js.
export function modifiers(it) {
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
export const UNIT_WORDS = { one: 1, two: 2, three: 3, four: 4, "١": 1, "٢": 2, "٣": 3, "٤": 4,
  "واحد": 1, "اتنين": 2, "تنين": 2, "تلاتة": 3, "تلاته": 3, "اربعة": 4, "أربعة": 4 };
export const ORDINAL_ONE = /(second|third|fourth|last|other|remaining|التاني|الثاني|التالت|الثالث|الاخير|الأخير|الباقي)/i;
export function unitsForChoice(said, at, len) {
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

// Ticket notes, tidied: "without X" reads "no X" (one wording on every ticket), the
// same removal in two scripts/spellings ("no pickles · no mekhalel", "no onion · no
// بصل") collapses to one, empty fragments go. Runs before EVERY bill render — the
// type-first opener once printed "no pickles · no onions · · no mekhalel · no basal".
export function tidyNotes(items) {
  for (const it of items || []) {
    if (!it?.notes) continue;
    const parts = String(it.notes).split(/\s*·\s*|\s*,\s*(?=no |without |من غير|بدون)/).map((x) => x.trim()).filter(Boolean);
    const seen = new Set(); const kept = [];
    for (const part0 of parts) {
      const part = part0.replace(/^(without|men gheir|min gheir|bedoon|bdoon)\s+/i, "no ").replace(/^no\s+(the|el)\s+/i, "no ");
      const key = normName(arOptionWords(part)).replace(/^(no|without|men gheir|bedoon)\s+/, "no ").replace(/\b(the|el)\b\s*/g, "").replace(/s\b/g, "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key); kept.push(part);
    }
    it.notes = kept.join(" · ") || null;
  }
}
// words that appear in most of a menu's item names — the restaurant's own brand
// ("munadim", «منادم») — carry no dish identity for matching
export const arNzBrand = (s) => String(s || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^؀-ۿa-z0-9\s]/gi, " ").replace(/\s+/g, " ").trim();
export const _brandCache = new WeakMap();
// A brand token must (a) be part of the RESTAURANT'S OWN NAME and (b) sit on 40%+ of
// item names. (a) keeps "burger" on a burger joint's menu a dish word; the Arabic
// brand token is the one that rides on the same items as the Latin one.
export function brandTokensOf(menu, restaurantName) {
  const _brandName = normName(restaurantName || "");
  const empty = { en: new Set(), ar: new Set() };
  if (!Array.isArray(menu) || menu.length < 6 || !_brandName) return empty;
  const key = `${_brandName}`;
  const cached = _brandCache.get(menu);
  if (cached && cached.key === key) return cached.v;
  const nameToks = new Set(_brandName.split(" ").filter((t) => t.length >= 4));
  const cut = Math.ceil(menu.length * 0.4);
  const enItems = new Map();
  menu.forEach((m, i) => { for (const t of new Set(normName(m.name).split(" "))) if (nameToks.has(t)) { if (!enItems.has(t)) enItems.set(t, new Set()); enItems.get(t).add(i); } });
  const en = new Set([...enItems].filter(([, set]) => set.size >= cut).map(([t]) => t));
  const brandItems = new Set([...enItems].filter(([t]) => en.has(t)).flatMap(([, set]) => [...set]));
  const arCount = new Map();
  if (brandItems.size) menu.forEach((m, i) => { for (const t of new Set(arNzBrand(m.name_ar).split(" ").filter((x) => x.length >= 3 && /[؀-ۿ]/.test(x)))) { const c = arCount.get(t) || { on: 0, off: 0 }; if (brandItems.has(i)) c.on++; else c.off++; arCount.set(t, c); } });
  const ar = new Set([...arCount].filter(([, c]) => c.on >= Math.ceil(brandItems.size * 0.9) && c.off <= 1).map(([t]) => t));
  const v = { en, ar };
  _brandCache.set(menu, { key, v });
  return v;
}
export function groupChoices(group, menu) {
  if (group.from_category) {
    // staff type this free-form in the dashboard — treat it as a literal
    // substring, never compile it as a regex (an unbalanced paren killed orders)
    const want = normName(group.from_category);
    return menu.filter((m) => normName(m.category || "").includes(want)).map((m) => ({ name: m.name }));
  }
  return (group.choices || []).filter((c) => c?.name);
}

// Does an earlier answer unlock this group? { "format": "Combo" } or a list.
export function groupApplies(group, picked) {
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
export function itemPrice(item) {
  const picked = item.options || {};
  let base = Number(item.price) || 0;
  let delta = 0;
  for (const g of item.option_defs || []) {
    const chosen = picked[g.key];
    for (const name of Array.isArray(chosen) ? chosen : [chosen].filter(Boolean)) {
      const nn = normName(name);
      const c = (g.choices || []).find((x) => normName(x.name) === nn)
        // a stored short form ("Combo") for a longer choice ("Combo (fries + drink)") —
        // the resolver sometimes keeps the guest's word; the PRICE must still be the combo's
        || (g.choices || []).find((x) => nn && normName(x.name).startsWith(nn + " "))
        || (g.choices || []).find((x) => nn && nn.startsWith(normName(x.name) + " "));
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
export const ORDINALS = ["FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH", "SEVENTH", "EIGHTH"];

export function slotsGroupOf(it) {
  return (it.option_defs || []).find((g) => g.key === "slots" && Array.isArray(g.slot_groups) && Number(g.count) >= 1) || null;
}

export function slotChoiceNames(sg, menu) {
  if (sg.from_category) {
    const re = new RegExp(sg.from_category, "i");
    return menu.filter((m) => re.test(String(m.category || ""))).map((m) => m.name);
  }
  return (sg.choices || []).map((c) => c.name).filter(Boolean);
}

// message 1: what this bundle includes + the allowed choices per field
export function renderSlotsIntro(it, g, menu) {
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
export function renderSlotsTemplate(g) {
  const blocks = [];
  for (let i = 0; i < Number(g.count); i++) {
    const head = `${ORDINALS[i] || `#${i + 1}`} CHOICE`;
    const fields = g.slot_groups.map((sg) => `${String(sg.label || sg.key).toUpperCase()}:`);
    blocks.push([head, ...fields].join("\n"));
  }
  return blocks.join("\n\n");
}

// near-miss auto-switch: "cola"/"coke" → whatever cola we stock; else first option
export const SODA_WORDS = /(?<![\p{L}\p{N}])(cola|coke|pepsi|soda|كولا|بيبسي)(?![\p{L}\p{N}])/iu;
export function matchSlotValue(raw, names) {
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
export function parseSlots(message, g, menu) {
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
export function missingSlots(slots, g) {
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
export function lev1(a, b) {
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
export function optionMatches(said, optName) {
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
export function distinctTokens(opts) {
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
export const AR_OPTION_WORDS = [
  ["فانتا", "fanta"], ["سبرايت", "sprite"], ["كولا دايت", "coca cola diet"], ["بيبسي دايت", "coca cola diet"], ["بيبسي", "coca cola"], ["كولا", "coca cola"],
  ["سفن اب", "sprite"], ["سفن أب", "sprite"], ["ميرندا", "fanta"], ["مياه", "water"], ["مية", "water"],
  ["ساندوتش", "sandwich"], ["سندوتش", "sandwich"], ["ساندويتش", "sandwich"], ["كومبو", "combo"], ["وجبة", "meal"], ["وجبه", "meal"],
  ["حار", "hot"], ["حارة", "hot"], ["سبايسي", "hot"], ["خفيف", "mild"], ["وسط", "medium"], ["متوسط", "medium"], ["صغير", "small"], ["كبير", "large"],
  ["كوكا كولا دايت", "coca cola diet"], ["كوكاكولا دايت", "coca cola diet"],
  ["كوكا كولا", "coca cola"], ["كوكاكولا", "coca cola"], ["كولا دايت", "coca cola diet"],
  ["فرنش فرايز", "french fries"], ["بطاطس عادية", "french fries"], ["فرنشايز", "french fries"],
  ["ديابلو", "diablo"], ["ديبلو", "diablo"], ["دابلو", "diablo"], ["ديابولو", "diablo"],
  ["كيرلي", "curly"], ["كيرلى", "curly"], ["كورلي", "curly"],
  ["برتقال", "orange"], ["اورنج", "orange"], ["أورنج", "orange"],
  ["كركديه", "karkadeh"], ["كركدية", "karkadeh"], ["عرقسوس", "sobia"], ["سوبيا", "sobia"],
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
// Arabic COUNT / POSITION words used when splitting units ("حار للأول اتنين وخفيف
// للتالت") — mapped to the English forms the splitter and unitsForChoice understand.
// Order matters: longer phrases first.
export const AR_COUNT_WORDS = [
  ["للأول اتنين", "for the first 2"], ["للاول اتنين", "for the first 2"], ["لأول اتنين", "for the first 2"], ["لاول اتنين", "for the first 2"],
  ["للأول تلاتة", "for the first 3"], ["للاول تلاتة", "for the first 3"], ["للأول واحد", "for the first 1"], ["للاول واحد", "for the first 1"],
  ["للتاني", "for the second"], ["للثاني", "for the second"], ["للتالت", "for the third"], ["للثالث", "for the third"], ["للرابع", "for the fourth"], ["للباقي", "for the rest"], ["للأخير", "for the last"], ["للاخير", "for the last"],
  ["الأول", "the first"], ["الاول", "the first"], ["التاني", "the second"], ["الثاني", "the second"], ["التالت", "the third"], ["الثالث", "the third"], ["الأخير", "the last"], ["الاخير", "the last"], ["الباقي", "the rest"],
  ["اتنين", "2"], ["إتنين", "2"], ["تلاتة", "3"], ["ثلاثة", "3"], ["تلاته", "3"], ["اربعة", "4"], ["أربعة", "4"], ["واحد", "1"], ["واحدة", "1"],
];
// Franco food words guests actually type — mapped to the English the menu uses
export const FRANCO_FOOD_WORDS = [
  // Franco COUNT words — the per-unit splitter reads digits ("2 hot w wa7ed mild")
  ["wa7ed", "1"], ["wa7da", "1"], ["wahed", "1"], ["etnen", "2"], ["etneen", "2"], ["tnen", "2"],
  ["talata", "3"], ["tlata", "3"], ["arba3a", "4"],
  ["batates", "fries"], ["bataates", "fries"], ["mashroob", "drink"], ["mashrob", "drink"], ["3aseer", "juice"], ["3asir", "juice"],
  ["gebna", "cheese"], ["gebnah", "cheese"], ["basal", "onion"], ["mekhalel", "pickles"], ["me5alel", "pickles"], ["tamatem", "tomato"],
  ["7ar", "hot"], ["7arr", "hot"], ["khafif", "mild"], ["metwaset", "medium"], ["wast", "medium"],
  ["sandawetsh", "sandwich"], ["sandwetsh", "sandwich"], ["sandwesh", "sandwich"], ["sandwish", "sandwich"], ["kombo", "combo"], ["wagba", "meal"],
  ["frayz", "fries"], ["frays", "fries"], ["fryz", "fries"], ["burgar", "burger"], ["borgar", "burger"],
  ["klasik", "classic"], ["klassik", "classic"], ["klasek", "classic"],
  ["tshiken", "chicken"], ["tsheken", "chicken"], ["farkha", "chicken"], ["shokolata", "chocolate"], ["shokolatah", "chocolate"],
  ["milkshek", "milkshake"], ["melkshek", "milkshake"], ["spisi", "spicy"], ["ransh", "ranch"],
  ["delivry", "delivery"], ["dilevery", "delivery"], ["delevary", "delivery"], ["tekaway", "takeaway"],
];
// Franco dictionary, spelling-proof: keys canonicalised once with francoNorm, guest
// tokens matched by the same canon + edit-distance 1 — "me5alel", "mkhallel" and
// "mekhalel" all land on "pickles" without listing every spelling by hand.
export const FRANCO_DICT_N = (() => {
  const m = new Map();
  for (const [fr, en] of FRANCO_FOOD_WORDS) { const k = francoNorm(fr); if (k && !k.includes(" ")) m.set(k, en); }
  return m;
})();
export function francoDictPass(text) {
  // exact canon matches always apply (me5alel → mekhalel → pickles); the FUZZY pass
  // (distance 1) only runs when the message itself reads as Franco — otherwise plain
  // English gets mangled ("basil" is one edit from "basal"/onion)
  const fuzzyOK = looksFranco(text);
  return String(text || "").split(/(\s+)/).map((tok) => {
    if (!/[a-z]/i.test(tok) || tok.length < 3) return tok;
    const k = francoNorm(tok);
    if (!k || k.includes(" ")) return tok;
    const hit = FRANCO_DICT_N.get(k);
    if (hit) return ` ${hit} `;
    if (fuzzyOK && k.length >= 5) for (const [dk, en] of FRANCO_DICT_N) if (Math.abs(dk.length - k.length) <= 1 && editDistance(dk, k) <= 1) return ` ${en} `;
    return tok;
  }).join("");
}
export function arOptionWords(message) {
  let m = String(message || "");
  for (const [ar, en] of AR_OPTION_WORDS) m = m.split(ar).join(` ${en} `);
  for (const [fr, en] of FRANCO_FOOD_WORDS) m = m.replace(new RegExp(`(?<![a-z0-9])${fr}(?![a-z0-9])`, "gi"), ` ${en} `);
  m = francoDictPass(m);
  for (const [ar, en] of AR_COUNT_WORDS) m = m.split(ar).join(` ${en} `);
  return m;
}

export function nextQuestion(items, menu, message, pending, currency = "EGP") {
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
  // notes that only restate applied choices are ticket noise — drop them. Order-type
  // and payment words that the extractor swept into the note ("pickup, full meal,
  // medium…") are noise too — they live in their own fields.
  for (const it2 of out) {
    if (!it2.notes) continue;
    const chosen = normName(Object.values(it2.options).filter((v) => typeof v === "string").join(" "));
    const FILLER = new Set(["and", "with", "a", "an", "the", "please", "و", "مع", "pickup", "pick", "up", "delivery", "dine", "in", "takeaway", "cash", "card", "visa", "instapay", "for", "from", "to"]);
    const words = normName(arOptionWords(it2.notes)).split(" ").filter((w) => w && !FILLER.has(w));
    if (!words.length || words.every((w) => chosen.includes(w))) it2.notes = null;
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

