// Button wording belongs to the restaurant, not to us. Every tappable label the bot
// can send is resolved through here so Settings → AI can override any of them without
// a deploy, and so the matcher that has to recognise a tapped label reads the SAME
// string the sender used — the usual way custom buttons break is the two drifting apart.
// Defaults exist in all three guest languages; a restaurant override applies to every
// language (it's their wording, they know their crowd).
const DEFAULT_LABELS_BY_LANG = {
  en: {
    same_as_last: "Same as last time 🔁",
    build_your_own: "Build a burger 🍔",
    browse_menu: "Browse Menu",
    order_now: "Order now",
  },
  ar: {
    same_as_last: "زي المرة اللي فاتت 🔁",
    build_your_own: "اعمل برجرك 🍔",
    browse_menu: "المنيو",
    order_now: "اطلب دلوقتي",
  },
  fr: {
    same_as_last: "Zay el marra elly fatet 🔁",
    build_your_own: "E3mel burgerak 🍔",
    browse_menu: "El Menu",
    order_now: "Otlob delwa2ty",
  },
};

export const DEFAULT_LABELS = DEFAULT_LABELS_BY_LANG.en;

export function labels(config, lang = "en") {
  const base = DEFAULT_LABELS_BY_LANG[lang] || DEFAULT_LABELS_BY_LANG.en;
  const custom = config?.ai?.labels || {};
  const out = { ...base };
  for (const k of Object.keys(base)) {
    const v = typeof custom[k] === "string" ? custom[k].trim() : "";
    if (v) out[k] = v.slice(0, 24);   // WhatsApp truncates long button titles
  }
  return out;
}

export const label = (config, key, lang = "en") => labels(config, lang)[key] || DEFAULT_LABELS_BY_LANG.en[key];

// WhatsApp truncates button titles, so a tap can come back shortened — compare on a
// normalised prefix rather than demanding an exact match.
export function isLabel(message, value) {
  const norm = (s) => String(s || "").replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
  const a = norm(message), b = norm(value);
  if (!a || !b) return false;
  return a === b || (a.length >= 6 && b.startsWith(a)) || (b.length >= 6 && a.startsWith(b));
}

// A tapped chip may have been rendered in any of the three languages — match them all.
export function isLabelKey(config, message, key) {
  return ["en", "ar", "fr"].some((l) => isLabel(message, label(config, key, l)));
}
