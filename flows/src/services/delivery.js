// Delivery coverage — one source of truth for "do we deliver to X, how much, how long".
// Everything is per-restaurant config (dashboard-editable), with per-branch zones so a
// multi-location brand answers from the branch that actually COVERS the area. Fees/ETAs
// are quoted EXACTLY from config — code computes, the LLM only phrases (zero-hallucination).
//
// Config shape (all optional; absent → sensible back-compat defaults):
//   config.delivery = {
//     enabled: true|false,          // master toggle (default: services.delivery !== false)
//     paused: false,                // temporary "kitchen slammed" pause
//     min_order: 0,                 // min subtotal for delivery (0 = none)
//     free_over: 0,                 // free delivery at/above this subtotal (0 = off)
//     rush_pad_min: 0,              // minutes added to every ETA (rush padding; 0 = off)
//     eta_enabled: true,            // show ETAs at all
//     uncovered_message: "…",       // what to say for an area we don't cover
//     zones: [{area, fee, eta_min}] // restaurant-wide fallback zones (single-branch brands)
//   }
//   branch.delivery_zones = [{area, fee, eta_min}]   // per-branch coverage (wins over config.delivery.zones)
//   branch.delivery_paused / branch.delivery_hours   // per-branch overrides (optional)
import { branchList, nearestBranches } from "./branches.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export function deliveryEnabled(config) {
  const d = config?.delivery || {};
  return d.enabled !== undefined ? !!d.enabled : (config?.basic_info?.services?.delivery !== false);
}
export function deliveryPaused(config, branch) {
  return !!(config?.delivery?.paused || branch?.delivery_paused);
}

function zonesFor(config, branch) {
  return (branch?.delivery_zones?.length ? branch.delivery_zones : config?.delivery?.zones) || [];
}
function matchZone(zones, area) {
  const t = norm(area);
  if (!t) return null;
  return zones.find((z) => norm(z.area) === t)
    || zones.find((z) => { const a = norm(z.area); return a && (t.includes(a) || a.includes(t)); });
}

// The heart: given an area name and/or coordinates (+ current subtotal), return whether we
// deliver there, from which branch, the exact fee (honouring free_over) and ETA (with rush pad).
// Multi-branch: try branches nearest-first (when coords given) and return the FIRST that covers
// the area — "nearest that covers, else next-nearest that covers".
export function deliveryQuote(config, { area = null, coords = null, subtotal = 0 } = {}) {
  if (!deliveryEnabled(config)) return { available: false, reason: "off" };
  const branches = branchList(config);
  const ordered = coords ? nearestBranches(branches, coords.lat, coords.lng, 50) : branches;
  const pool = ordered.length ? ordered : [null]; // single-location brands have no branch rows
  const d = config?.delivery || {};

  for (const b of pool) {
    if (deliveryPaused(config, b)) { if (pool.length === 1) return { available: false, reason: "paused" }; continue; }
    const z = area ? matchZone(zonesFor(config, b), area) : null;
    if (z) {
      const freeOver = Number(d.free_over) || 0;
      const free = freeOver > 0 && Number(subtotal) >= freeOver;
      const minOrder = Number(d.min_order) || 0;
      const etaBase = Number(z.eta_min) || 0;
      return {
        available: true, covered: true, branch: b || null,
        fee: free ? 0 : Number(z.fee) || 0, base_fee: Number(z.fee) || 0, free,
        eta_min: d.eta_enabled === false ? null : (etaBase ? etaBase + (Number(d.rush_pad_min) || 0) : null),
        min_order: minOrder, meets_min: Number(subtotal) >= minOrder,
        area: z.area,
      };
    }
  }
  if (deliveryPaused(config)) return { available: false, reason: "paused" };
  // enabled, but this area isn't in any branch's zones (or no zones configured at all)
  return { available: true, covered: false, reason: "uncovered", message: d.uncovered_message || null,
           has_zones: pool.some((b) => zonesFor(config, b).length > 0) };
}

// Render delivery coverage as FACTS for the friendly prompt so the LLM answers a delivery
// question ACCURATELY (quoting configured fees, never inventing one).
export function deliveryFacts(config) {
  if (!deliveryEnabled(config)) return "- Delivery: NOT offered — only dine-in / pickup. If asked, say so honestly.";
  if (deliveryPaused(config)) return "- Delivery: PAUSED right now (kitchen busy). Tell the guest delivery is temporarily paused and offer pickup — do NOT take a delivery order.";
  const branches = branchList(config);
  const pool = branches.length ? branches : [null];
  const d = config?.delivery || {};
  const lines = [];
  for (const b of pool) {
    const zones = zonesFor(config, b);
    if (!zones.length) continue;
    const zt = zones.map((z) => `${z.area} ${z.fee} EGP${z.eta_min ? ` ~${z.eta_min}min` : ""}`).join(" · ");
    lines.push(b && branches.length > 1 ? `${b.name}: ${zt}` : zt);
  }
  if (!lines.length) {
    return "- Delivery: available, but exact areas/fees aren't listed here. Ask the guest to share their location or exact area and say the team will confirm the fee. NEVER invent a delivery fee.";
  }
  const extras = [
    Number(d.min_order) ? `minimum order ${d.min_order} EGP` : "",
    Number(d.free_over) ? `free delivery over ${d.free_over} EGP` : "",
  ].filter(Boolean).join(", ");
  return `- DELIVERY ZONES — quote these EXACTLY, NEVER invent a fee or an area:\n${lines.map((l) => "  • " + l).join("\n")}${extras ? `\n  (${extras})` : ""}\n  If the guest's area is NOT listed above, say we don't deliver there yet and offer pickup — never guess a fee.`;
}
