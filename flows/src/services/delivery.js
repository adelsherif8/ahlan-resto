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
// A zone matches by its area name OR any alias (so "التجمع"/"tagamoa"/"new cairo" all hit
// the same zone). Guests write areas in Arabic, English or Franco — aliases bridge them.
function matchZone(zones, area) {
  const t = norm(area);
  if (!t) return null;
  for (const z of zones) {
    const names = [z.area, ...(z.aliases || [])].map(norm).filter((a) => a.length >= 3);
    if (names.some((a) => a === t || t.includes(a) || a.includes(t))) return z;
  }
  return null;
}

// Share-location → auto-quote: a zone may carry an optional center + radius
// ({lat, lng, radius_km}); a dropped pin inside that circle matches the zone with no
// typing. Zones without coords simply don't participate (name/alias matching still works).
import { distanceKm } from "./branches.js";
function matchZoneByPin(zones, coords) {
  if (!coords || coords.lat == null) return null;
  let best = null;
  for (const z of zones) {
    if (typeof z.lat !== "number" || typeof z.lng !== "number") continue;
    const km = distanceKm(coords.lat, coords.lng, z.lat, z.lng);
    if (km <= (Number(z.radius_km) || 5) && (!best || km < best.km)) best = { z, km };
  }
  return best?.z || null;
}

// Delivery hours — a restaurant (or a branch) may deliver only part of the day.
// config.delivery.hours = {open:"12:00", close:"23:00"} (overnight windows supported:
// close < open spans midnight). branch.delivery_hours overrides. Absent → always open.
export function deliveryOpenNow(config, branch = null, now = new Date()) {
  const h = branch?.delivery_hours || config?.delivery?.hours || null;
  if (!h?.open || !h?.close) return { open: true };
  const tz = config?.basic_info?.timezone || "Africa/Cairo";
  const [hh, mm] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(now).split(":").map(Number);
  const cur = hh * 60 + mm;
  const [oh, om] = String(h.open).split(":").map(Number);
  const [ch, cm] = String(h.close).split(":").map(Number);
  const o = oh * 60 + (om || 0), c = ch * 60 + (cm || 0);
  const open = o <= c ? cur >= o && cur < c : cur >= o || cur < c; // overnight window
  return { open, hours: h };
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
  const hoursNow = deliveryOpenNow(config);
  if (!hoursNow.open) return { available: false, reason: "hours", hours: hoursNow.hours };

  for (const b of pool) {
    if (deliveryPaused(config, b)) { if (pool.length === 1) return { available: false, reason: "paused" }; continue; }
    if (b && !deliveryOpenNow(config, b).open) continue; // this branch's delivery window is closed
    const zs = zonesFor(config, b);
    const z = (area ? matchZone(zs, area) : null) || matchZoneByPin(zs, coords);
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
  const hn = deliveryOpenNow(config);
  const hoursLine = config?.delivery?.hours?.open ? `\n  Delivery hours: ${config.delivery.hours.open}–${config.delivery.hours.close}${hn.open ? "" : " — delivery is CLOSED right now (outside those hours): say so and offer pickup, do NOT take a delivery order"}.` : "";
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
  return `- DELIVERY ZONES — quote these EXACTLY, NEVER invent a fee or an area:\n${lines.map((l) => "  • " + l).join("\n")}${extras ? `\n  (${extras})` : ""}${hoursLine}\n  If the guest's area is NOT listed above, say we don't deliver there yet and offer pickup — never guess a fee.`;
}
