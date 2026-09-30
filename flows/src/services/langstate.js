// THE CONVERSATION'S LANGUAGE — one decision, made by code, from the GUEST'S words.
//
// Before this file, four different things could decide how the bot spoke: the LLM
// classifier's "language" field, master's detectLang, fastpaths' own regex list, and
// buffering's pipeLang. They disagreed, and worse: whatever they produced was written
// back as the session's sticky language, so a single wrong guess became state and the
// conversation never recovered ("akked" → English, «تمام» → Arabic for a Franco guest).
//
// The rule now, in strict priority order:
//
//   1. the guest ASKED for a language ("reply in English", «رد عليا بالعربي", "kalemny franco")
//   2. clear evidence in THIS user message — script and Egyptian markers, judged AFTER
//      menu item names are removed, so "Chicken Burger" is food, not English
//   3. the language the conversation is already in
//   4. the restaurant's default
//
// What may NEVER decide it: receipt text, menu rows, dish names, tool output, our own
// replies, the model's opinion, or anything cached from a previous turn's guess.
import { looksFranco, francoScore } from "./franco.js";

export const EN = "en";
export const AR = "ar";
export const FRANCO = "franco";
const VALID = new Set([EN, AR, FRANCO]);

const ARABIC_SCRIPT = /[؀-ۿ]/;

// ---- 1) an explicit request always wins -------------------------------------------
const WANT_EN = /(?:reply|answer|talk|speak|write|respond)[^.\n]{0,20}\b(?:in|with)\s+english\b|\benglish\s+please\b|\bin english\b|(?:بالانجليزي|بالإنجليزي|بالانجليزيه|بالإنجليزية|انجلش)|(?:kallemny|kalemny|kalimni|klmny|rod 3alaya|rod alaya)\s+(?:english|inglizy|englizy)/i;
const WANT_AR = /(?:reply|answer|talk|speak|write|respond)[^.\n]{0,20}\b(?:in|with)\s+arabic\b|\bin arabic\b|(?:بالعربي|بالعربية|بالعربيه|عربي بس|اتكلم عربي|رد عليا بالعرب)|(?:kallemny|kalemny|kalimni|klmny|rod 3alaya|rod alaya)\s+(?:3araby|araby|arabi|arabic)/i;
const WANT_FR = /(?:reply|answer|talk|speak|write|respond)[^.\n]{0,20}\b(?:in|with)\s+(?:franco|arabizi|frankoarab|franco[- ]?arabic)\b|\bin franco\b|(?:بالفرانكو|فرانكو|بالفرانكو عربي)|(?:kallemny|kalemny|kalimni|klmny|rod 3alaya|rod alaya)\s+(?:franco|frankoarab|arabizi)/i;

export function explicitRequest(message) {
  const s = String(message || "");
  if (WANT_FR.test(s)) return FRANCO;      // checked first: "franco" also contains no "arabic"
  if (WANT_AR.test(s)) return AR;
  if (WANT_EN.test(s)) return EN;
  return null;
}

// ---- 2) evidence in the guest's own words ------------------------------------------
// English function words — the skeleton of an English sentence. Food nouns are absent
// on purpose: "burger", "fries", "coke" are menu vocabulary in every language here.
const EN_FUNCTION = /(?<![\p{L}\p{N}])(i|i'?m|my|me|we|you|your|can|could|would|please|the|a|an|is|are|do|does|don'?t|want|need|give|make|add|remove|take|change|cancel|send|show|how|what|when|where|why|which|much|many|for|with|without|and|but|thanks|thank|hello|hi|sorry|ready|order|from|to|of|on|at|that|this|it|also|still|now|later)(?![\p{L}\p{N}])/giu;

/** Text the detector is allowed to look at: no links, no tags, no numbers, no dish names. */
export function conversationalText(message, itemNames = []) {
  let s = String(message || "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[[^\]]{0,40}\]/g, " ")              // [voice], [shared location] …
    .replace(/[\p{Extended_Pictographic}]/gu, " ")
    // table numbers ("T3"), order codes ("O-CGTW") and bare quantities are data too —
    // "t3" otherwise reads as a Franco digit-letter word and flipped the conversation
    .replace(/(?<![\p{L}\p{N}])[A-Za-z]-?\d{1,3}(?![\p{L}\p{N}])/gu, " ")
    .replace(/(?<![\p{L}\p{N}])[A-Za-z]-[A-Za-z0-9]{3,8}(?![\p{L}\p{N}])/gu, " ");
  // menu item names are DATA, never evidence: "ana 3ayez Chicken Burger" is Franco, and
  // «عايز Chicken Burger» is Arabic — the dish is the same word in both.
  for (const raw of itemNames || []) {
    const n = String(raw || "").trim();
    if (n.length < 3) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(esc, "gi"), " ");
    // also the individual words of multi-word names ("Chicken Burger" → chicken, burger)
    for (const w of n.split(/\s+/)) {
      if (w.length < 4) continue;
      s = s.replace(new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu"), " ");
    }
  }
  return s.replace(/\s+/g, " ").trim();
}

/**
 * What the CURRENT message shows on its own. Returns null when it shows nothing —
 * a bare "Coke Zero", "fries", "yes" or "ok" is not a language decision.
 */
export function messageEvidence(message, itemNames = []) {
  const text = conversationalText(message, itemNames);
  if (!text) return null;
  if (ARABIC_SCRIPT.test(text)) return { lang: AR, reason: "arabic script" };
  const fScore = francoScore(text);
  if (fScore >= 2 || (fScore >= 1 && text.split(/\s+/).length >= 2)) {
    return { lang: FRANCO, reason: `franco markers (${fScore})` };
  }
  // English needs a real sentence, not one leftover word: two function words, or one
  // plus a few tokens. "fries" and "Coke Zero" deliberately fall through to sticky.
  const fn = (text.match(EN_FUNCTION) || []).length;
  const tokens = text.split(/\s+/).filter(Boolean).length;
  if (fn >= 2 || (fn === 1 && tokens >= 3)) return { lang: EN, reason: `english sentence (${fn} function words)` };
  // English shapes Franco never has: contractions and -ing/-ed/-tion endings. This is
  // what lets a short English message switch ("cancelled?", "I'm waiting") without a
  // bare noun ("fries", "Coke") ever doing it.
  if (/(?<![\p{L}])[a-z]{3,}(?:ing|tion|n't|'re|'ve|'ll|'m)(?![\p{L}])/iu.test(text)
    || /(?<![\p{L}])(?:cancell?ed|ordered|waiting|delivered|finished|arrived|refunded)(?![\p{L}])/iu.test(text)) {
    return { lang: EN, reason: "english morphology" };
  }
  if (looksFranco(text)) return { lang: FRANCO, reason: "franco marker" };
  return null;
}

/**
 * The one resolver. Everything that speaks to a guest asks this — flows, fast paths and
 * the pipeline's own lines — so one turn can never be answered in two languages.
 *
 * @returns {{lang: "en"|"ar"|"franco", reason: string, switched: boolean}}
 */
export function resolveLanguage({ message, sticky = null, itemNames = [], fallback = EN } = {}) {
  const prev = VALID.has(sticky) ? sticky : null;
  const asked = explicitRequest(message);
  if (asked) return { lang: asked, reason: "explicit request", switched: !!prev && prev !== asked };

  const ev = messageEvidence(message, itemNames);
  if (ev) return { lang: ev.lang, reason: ev.reason, switched: !!prev && prev !== ev.lang };

  if (prev) return { lang: prev, reason: "kept (no evidence in this message)", switched: false };
  return { lang: VALID.has(fallback) ? fallback : EN, reason: "restaurant default", switched: false };
}

/** "franco" is the conversation mode; "fr" is what the render helpers (L2) call it. */
export const toRenderLang = (l) => (l === AR ? "ar" : l === FRANCO ? "fr" : "en");
