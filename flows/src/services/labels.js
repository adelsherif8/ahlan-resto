// Button wording belongs to the restaurant, not to us. Every tappable label the bot
// can send is resolved through here so Settings → AI can override any of them without
// a deploy, and so the matcher that has to recognise a tapped label reads the SAME
// string the sender used — the usual way custom buttons break is the two drifting apart.
export const DEFAULT_LABELS = {
  same_as_last: "Same as last time 🔁",
  build_your_own: "Build a burger 🍔",
  browse_menu: "Browse Menu",
  order_now: "Order now",
};

export function labels(config) {
  const custom = config?.ai?.labels || {};
  const out = { ...DEFAULT_LABELS };
  for (const k of Object.keys(DEFAULT_LABELS)) {
    const v = typeof custom[k] === "string" ? custom[k].trim() : "";
    if (v) out[k] = v.slice(0, 24);   // WhatsApp truncates long button titles
  }
  return out;
}

export const label = (config, key) => labels(config)[key] || DEFAULT_LABELS[key];

// WhatsApp truncates button titles, so a tap can come back shortened — compare on a
// normalised prefix rather than demanding an exact match.
export function isLabel(message, value) {
  const norm = (s) => String(s || "").replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
  const a = norm(message), b = norm(value);
  if (!a || !b) return false;
  return a === b || (a.length >= 6 && b.startsWith(a)) || (b.length >= 6 && a.startsWith(b));
}
