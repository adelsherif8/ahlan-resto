// CHECK SPLIT — the language side. Three ways of talking to ONE engine.
//
// Nothing here does arithmetic. Every sentence, in English, Arabic, Franco-Arabizi or
// any mix of them, is turned into the language-independent actions in checksplit.js:
//
//   ADD_PARTICIPANT · REMOVE_PARTICIPANT · ASSIGN_ITEM · UNASSIGN_ITEM
//   SHARE_ITEM · SPLIT_UNASSIGNED · RESET
//
// Item matching is SEMANTIC and always against the receipt's real lines (by id), the
// same rule the option resolver already follows: the model may only pick from the list
// we hand it, so a translated or transliterated word can never conjure a line that
// isn't on the bill.
import { francoNorm } from "./franco.js";

// Arabic normalisation for MATCHING ONLY — display keeps whatever the guest wrote.
export const arNorm = (s) => String(s || "")
  .replace(/[ً-ْـ]/g, "")      // diacritics + tatweel
  .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .replace(/\s+/g, " ").trim();

/**
 * Does this message ask to split the bill? Code-first (free, instant) across the three
 * languages; Franco is matched on its canonical form so spelling can vary:
 *   "split the check" · «اقسم الحساب» · "2asem el 7esab" / "e2sem el hesab"
 */
export function looksLikeSplit(message) {
  const raw = String(message || "");
  const ar = arNorm(raw);
  if (/(?:اقسم|إقسم|قسم|نقسم|تقسيم|قسمه|قسمة|نتقاسم|نقسمها)\s*(?:ال)?(?:حساب|فاتوره|فاتورة|شيك|الاوردر|الطلب|بينا|بينهم|علينا)?/u.test(ar)) return true;
  if (/(?:الحساب|الفاتوره|الفاتورة)\s*(?:نقسمه|نقسمها|بينا|علينا|بينهم)/u.test(ar)) return true;
  const fr = francoNorm(raw);                  // 2asem → asem, 7esab → hesab, 5ad → khad
  const SPLIT_VERB = /\b(asem|easem|aesm|nasem|nesem|naasem|waza|wazaa|nekasem|netkasem)\b/;
  const BILL_WORD = /\b(hesab|hisab|fatoura|fatura|check|bill|order|bena|beena|alena|alehom|alihom|benhom)\b/;
  if (SPLIT_VERB.test(fr) && BILL_WORD.test(fr)) return true;
  if (/\b(split|divide|share)\b.*\b(check|bill|receipt|tab|order|it|between|among)\b/i.test(raw)) return true;
  if (/\bcheck split\b|\bsplit the (check|bill|receipt|tab)\b|\bsplit it\b/i.test(raw)) return true;
  if (/\b(kol wa7ed|kol wahed|koll wa7ed)\b.*\b(yedfa3|yedfaa|kam|hayedfa3)\b/.test(fr)) return true;
  if (/كل واحد\s*(?:هـ?يدفع|يدفع|عليه)\s*كام/u.test(ar)) return true;
  return false;
}

/** "split the rest equally" in any of the three languages — a free, deterministic read. */
export function looksLikeSplitRest(message) {
  const raw = String(message || "");
  const ar = arNorm(raw);
  if (/(?:اقسم|إقسم|قسم|وزع|قسمو|قسموا|نقسم)\s*(?:ال)?(?:باقي|باقى|متبقي|فاضل|فاضله|فاضلة|حاجات)/u.test(ar)) return true;
  if (/(?:الباقي|الباقى|اللي فاضل|اللي باقي)\s*(?:عليهم|علينا|بينا|بينهم|بالتساوي)/u.test(ar)) return true;
  const fr = francoNorm(raw);
  if (/\b(asem|easem|waza|wazaa|nasem|nesem|naasem)\b/.test(fr)
    && /\b(bay|bay|baki|baaey|fadel|fadla|fadl|rest|tany|elbay)\b/.test(fr)) return true;
  if (/\b(split|divide|share)\b.*\b(rest|remainder|remaining|left|unassigned|what'?s left)\b/i.test(raw)) return true;
  if (/\bequally\b.*\b(rest|left|remaining)\b|\bsplit what'?s left\b/i.test(raw)) return true;
  return false;
}

/** "that's it / done" — leave split mode. */
export function looksLikeDone(message) {
  const raw = String(message || "").trim();
  if (raw.length > 24) return false;
  const ar = arNorm(raw);
  if (/^(خلاص|كده تمام|تمام كده|شكرا|شكرًا|كفايه|كفاية|انتهينا)$/u.test(ar)) return true;
  const fr = francoNorm(raw);
  if (/^(khalas|kefaya|keda tamam|tamam keda|shokran|khalast|done|thanks|thank you|that'?s it|finished)$/.test(fr)) return true;
  return /^(done|that'?s it|thanks|thank you|finished|ok thanks)$/i.test(raw);
}

/**
 * The receipt's lines, as the model is allowed to see them: an id, both names, and the
 * quantity. No prices — the money is the engine's business, never the model's.
 */
export function linesForPrompt(state) {
  return state.lines.map((l) => {
    const taken = state.assignments[l.id];
    const owners = Object.keys(taken?.units || {}).length + (taken?.shared?.length || 0);
    return `${l.id}: "${l.name}"${l.name_ar ? ` / "${l.name_ar}"` : ""} ×${l.qty}${owners ? " (already assigned)" : ""}`;
  }).join("\n");
}

export const SPLIT_SYSTEM = (state) => `You turn ONE restaurant guest message into check-split ACTIONS. The guest may write English, Egyptian Arabic, Franco-Arabizi (Arabic in Latin letters and digits: 3=ع 7=ح 5=خ 2=ء/ق), or any mix of them in the same sentence. Reply with JSON only.

RECEIPT LINES — the ONLY items that exist. Use these ids, never invent one:
${linesForPrompt(state)}

PEOPLE already on this split: ${state.participants.length ? state.participants.map((p) => `"${p.name}"`).join(", ") : "(none yet)"}

Return {"actions": [...], "clarify": null|{"line_ids": ["L1","L2"], "said": "<the guest's word>"}}

Actions (use ONLY these shapes):
- {"op":"ASSIGN_ITEM","person":"<name EXACTLY as the guest wrote it>","line":"<id>","qty":<number>|null}
- {"op":"UNASSIGN_ITEM","line":"<id>","person":"<name>"|null}
- {"op":"SHARE_ITEM","line":"<id>","people":["<name>","<name>"]}
- {"op":"SPLIT_UNASSIGNED","people":["<name>",...]|[]}   ← [] means everyone on the split
- {"op":"ADD_PARTICIPANT","person":"<name>"}
- {"op":"REMOVE_PARTICIPANT","person":"<name>"}

RULES
- Verbs meaning "took/had/is his": took, had, ordered, خد، أخد، ياخد، بتاع، بتاعت، ليه، عليه، khad, 5ad, akhad, a5ad, bta3, beta3, bta3t, 3aleh → ASSIGN_ITEM.
- Verbs meaning "split/divide/share": split, divide, share, قسم، اقسم، وزع، نص بنص، 2asem, e2sem, waza3, nos be nos → SHARE_ITEM (a named item between named people) or SPLIT_UNASSIGNED (the rest / what's left / الباقي / el ba2y).
- "each one pays", "كل واحد يدفع", "kol wa7ed yedfa3" with nothing assigned → SPLIT_UNASSIGNED with [].
- NAMES ARE COPIED VERBATIM: "عمر" stays "عمر", "Omar" stays "Omar". Never translate or transliterate a name. A Franco name keeps its Latin spelling.
- Match items by MEANING against the list above, in any language: "el maya"/"المياه"/"mayya" → the Water line; "el fries"/"الفرايز"/"بطاطس" → the Fries line; "burger"/"برجر" → the Burger line.
- DIGITS INSIDE FRANCO WORDS ARE LETTERS, NOT NUMBERS: "3omar" is the name Omar, "5ad" is the verb took, "2asem" is the verb split, "7aga" is a thing. Only a standalone number ("2 waters", "واحد مياه") may be a qty.
- qty: only when the guest clearly means part of a multi-unit line ("one of the waters", "واحدة مياه"). Otherwise null (the whole line).
- If a word could be TWO different lines (e.g. "burger" with both a Burger and a Chicken Burger on the receipt), return NO action for it and set "clarify" with those line ids.
- Anything you cannot match to a line above: leave it out. Never guess, never invent an item, never output a price.`;

/**
 * Interpret one message into actions. `chat` is the project's chatJSON (already tenant-
 * and cost-aware); the fast model is enough — this is extraction, not writing.
 */
export async function interpretSplit({ message, state, chat, model }) {
  const out = await chat(model, SPLIT_SYSTEM(state), String(message || "").slice(0, 600), { temperature: 0, maxTokens: 320 });
  const value = out?.value || out || {};
  const actions = Array.isArray(value.actions) ? value.actions : [];
  const clarify = value.clarify && Array.isArray(value.clarify.line_ids) && value.clarify.line_ids.length > 1
    ? { lineIds: value.clarify.line_ids.filter((id) => state.lines.some((l) => l.id === id)), said: String(value.clarify.said || "").slice(0, 40) }
    : null;
  return { actions, clarify, usage: out?.__usage };
}

/**
 * Deterministic ambiguity check — never trust the model to own this. A word the guest
 * used that fits TWO receipt lines equally ("the burger" with a Classic Burger and a
 * Signature Burger on the bill) must be asked about, not guessed. Tokens shared by
 * several lines carry no identity; only a token unique to one line resolves it.
 */
export function ambiguityFor(state, message, chosenLineId) {
  const hay = ` ${String(message || "").toLowerCase()} ${francoNorm(message)} ${arNorm(message)} `;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
  const tokensOf = (l) => [...new Set([...norm(l.name).split(" "), ...norm(arNorm(l.name_ar || "")).split(" ")])]
    .filter((t) => t && t.length >= 3);
  const count = new Map();
  for (const l of state.lines) for (const t of tokensOf(l)) count.set(t, (count.get(t) || 0) + 1);
  const said = (t) => hay.includes(` ${t} `) || hay.includes(` ${t}s `) || hay.includes(`el ${t} `) || hay.includes(`ال${t} `);

  const chosen = state.lines.find((l) => l.id === chosenLineId);
  if (!chosen) return null;
  const unique = tokensOf(chosen).filter((t) => count.get(t) === 1);
  if (unique.some(said)) return null;                       // they named this exact line

  const shared = tokensOf(chosen).filter((t) => count.get(t) > 1 && said(t));
  if (!shared.length) return null;                          // nothing shared was said either
  const rivals = state.lines.filter((l) => tokensOf(l).some((t) => shared.includes(t)));
  return rivals.length > 1 ? { lineIds: rivals.map((l) => l.id), said: shared[0] } : null;
}
