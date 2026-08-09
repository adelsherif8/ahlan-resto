// One place that turns an order item's options/notes into human modifier lines,
// shared by the driver page, the customer tracking page and anywhere else that
// shows what's in the bag. Two rules it enforces everywhere:
//   1. never render a raw object ("[object Object]") — options can be strings,
//      arrays, or {name,price}-style objects (POS / older orders);
//   2. "sandwich only" is the default, not a modification — a plain sandwich gets
//      no annotation; only a MEAL earns its extra lines (fries, drink, …).

const SANDWICH_ONLY = /^(sandwich[\s-]*only|just[\s-]*(a|the)?[\s-]*sandwich|no[\s-]*meal|بس|ساندوتش بس|لوحده)$/i;

export function optVal(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(optVal).filter(Boolean).join(", ");
  if (typeof v === "object") return String(v.label ?? v.name ?? v.value ?? "").trim();
  return String(v).trim();
}

// Returns an array of modifier strings for one item (empty for a plain sandwich).
export function itemMods(it) {
  const opts = it?.options || {};
  const out = [];

  if (Array.isArray(opts.slots)) {
    opts.slots.forEach((sl, i) => {
      const vals = Object.entries(sl || {}).filter(([k]) => k !== "notes").map(([, v]) => optVal(v)).filter(Boolean).join(" + ");
      if (vals || sl?.notes) out.push(`${i + 1}) ${vals}${sl?.notes ? ` — ${sl.notes}` : ""}`);
    });
  } else {
    const order = (it?.option_defs || []).map((g) => g.key);
    const keys = [...order.filter((k) => opts[k]), ...Object.keys(opts).filter((k) => k !== "slots" && !order.includes(k) && opts[k])];
    for (const k of keys) {
      const s = optVal(opts[k]);
      if (s && !SANDWICH_ONLY.test(s)) out.push(s);
    }
  }
  if (it?.notes && !SANDWICH_ONLY.test(String(it.notes).trim())) out.push(String(it.notes).trim());
  return out;
}
