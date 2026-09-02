// Franco-Arabizi (Latin-script Egyptian Arabic) has no orthography: the same guest
// writes مخلل as "mekhalel", "me5alel", "m5alal" or "mkhallel" in one conversation.
// Exact-spelling dictionaries can't keep up — these helpers give every matcher a
// canonical form instead.
//
//   francoNorm(text)  → canonical form for MATCHING (never for display):
//                       word-internal digit letters mapped (7→h, 5→kh, 3→a, 2→a, 8→gh),
//                       doubled letters collapsed, accents dropped, lowercased.
//                       Standalone numbers ("2 burgers") are untouched — they're counts.
//   looksFranco(text) → the text carries Franco signals (digit-letters or Egyptian
//                       marker words). Used for language detection and for catching a
//                       plain-English model reply sent to a Franco guest.

// digits Egyptians use as letters, only meaningful INSIDE a word
const DIGIT_LETTERS = { "2": "a", "3": "a", "5": "kh", "7": "h", "8": "gh", "9": "q" };

export function francoNorm(text) {
  let s = String(text || "").toLowerCase();
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, ""); // é→e, à→a
  // a digit is a LETTER when it touches letters ("me5alel", "3ayez", "taree2");
  // standalone ("2 burgers", "4x4" stays: x is a letter → "4" maps? no — 4 isn't in the map)
  s = s.replace(/\d/g, (d, i) => {
    if (!(d in DIGIT_LETTERS)) return d;
    const prev = s[i - 1] || "", next = s[i + 1] || "";
    const touchesLetter = /[a-z]/.test(prev) || /[a-z]/.test(next);
    return touchesLetter ? DIGIT_LETTERS[d] : d;
  });
  s = s.replace(/([a-z])\1+/g, "$1");      // mkhallel → mkhalel, gedddan → gedan
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

// Egyptian marker words that only show up in Franco writing (not plain English).
// Deliberately common/boring words — the point is coverage, not precision per word.
// Egyptian marker words that only show up in Franco writing. Digit-spelled words
// ("3ayez", "te7eb", "5aleehom") are NOT listed — DIGIT_WORD below already catches
// every one of them at double weight. Keys that normalize to an English word
// (3and→and, hat, law, men…) are filtered out so English replies never score.
const ENGLISH_COLLISIONS = new Set(["and","ad","ada","law","men","min","hat","gay","ya","the","on","in","of","a","to","is","it","eleven"]);
const FRANCO_WORDS = new Set((
  "el fel fil lel wel eh leh lih keda kda mesh msh mish mafesh mafish feh fe fi " +
  "aywa ayw tamam tmam hader khalas yalla gher gheir bas bs kaman shwaya shwya " +
  "awy gedan gdan delwaty dlwaty ezay ezai fein fen feen emta imta kam bekam " +
  "momken mumken lw ana enta inta howa heya hena hina ayez awez hatli sheel shil " +
  "zawed khaleh khalih akked aked orderak talab akl akol teheb yeba haykon ashan " +
  "andak andoko naharda bokra embareh wahed etnen tnen talata shokran habibi " +
  "basha nemel gowa bara helw haga zay zayy ely elly gaya garab agarab etfadal " +
  "mawgood mawgud yenfa balash khalik maashi mashy"
).split(/\s+/).map(francoNorm).filter((w) => w.length >= 2 && !ENGLISH_COLLISIONS.has(w)));

// digit-letter inside a word is the strongest single Franco signal there is
const DIGIT_WORD = /(?:[a-z][23578]|[23578][a-z])/;

export function francoScore(text) {
  const raw = String(text || "").replace(/https?:\/\/\S+/g, " ");
  if (/[؀-ۿ]/.test(raw)) return 0; // Arabic script is Arabic, not Franco
  let score = 0;
  for (const tok of raw.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean)) {
    if (DIGIT_WORD.test(tok)) { score += 2; continue; }
    if (FRANCO_WORDS.has(francoNorm(tok))) score += 1;
  }
  return score;
}

export function looksFranco(text) {
  return francoScore(text) >= 1;
}
