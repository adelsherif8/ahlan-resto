// Availability engine — PURE CODE, zero LLM (iron rule: code computes).
// Answers: "can party P sit at DATE TIME?" from restaurant_tables + reservations,
// with turn times from reservation_policy and open-hours from config.hours.

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const ACTIVE_STATUSES = ["pending", "confirmed", "reminded", "arrived", "seated"];

export function turnMinutes(policy, party) {
  const tm = policy?.turn_minutes || {};
  if (tm[String(party)]) return Number(tm[String(party)]);
  const numericKeys = Object.keys(tm).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  for (const k of numericKeys) if (party <= k) return Number(tm[String(k)]);
  if (tm["6+"] && party >= 6) return Number(tm["6+"]);
  // founder defaults: 2p=90 / 3-4p=105 / bigger=120
  return party <= 2 ? 90 : party <= 4 ? 105 : 120;
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return h * 60 + (m || 0);
};
const toHHMM = (min) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// Opening ranges for a given ISO date; overnight closes (12:00–01:00) extend past 1440.
export function hoursForDate(hours, dateISO) {
  const dow = DAYS[new Date(`${dateISO}T12:00:00`).getDay()];
  return (hours?.[dow] || []).map((r) => {
    const open = toMin(r.open);
    let close = toMin(r.close);
    if (close <= open) close += 1440; // crosses midnight
    return { open, close };
  });
}

// A start is bookable if it sits in an open range with ≥60 min before close.
function startsWithinHours(ranges, startMin) {
  return ranges.some((r) => startMin >= r.open && startMin <= r.close - 60);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Core check. reservations = active rows for that DATE (any table).
 * Returns { available, table, end_slot, reason, alternatives: ["HH:MM", ...] }
 */
export function computeAvailability({ tables, reservations, hours, policy, dateISO, time, party, sectionPref }) {
  const ranges = hoursForDate(hours, dateISO);
  if (!ranges.length) return { available: false, reason: "closed_that_day", alternatives: [] };

  const duration = turnMinutes(policy, party);
  let startMin = toMin(time);
  // after-midnight times ("00:30") belong to the overnight tail of the requested evening
  const fitsRaw = startsWithinHours(ranges, startMin);
  if (!fitsRaw && startMin < 360 && startsWithinHours(ranges, startMin + 1440)) startMin += 1440;

  const check = (start) => {
    if (!startsWithinHours(ranges, start)) return null;
    const end = start + duration;

    // candidate tables: fit the party, not blocked, section preference honored when given
    const candidates = tables
      .filter((t) => t.capacity >= party && t.status !== "blocked")
      .filter((t) => !sectionPref || t.section === sectionPref)
      .sort((a, b) => a.capacity - b.capacity); // best fit = smallest table
    if (!candidates.length) return null;

    const active = reservations.filter((r) => ACTIVE_STATUSES.includes(r.status));
    const busy = new Set();
    const unassigned = [];
    for (const r of active) {
      const rs = toMin(r.time_slot);
      const re = r.end_slot ? toMin(r.end_slot) : rs + turnMinutes(policy, r.party_size || 2);
      const rEnd = re > rs ? re : re + 1440;
      if (!overlaps(start, end, rs, rEnd)) continue;
      if (r.table_id) busy.add(r.table_id);
      else unassigned.push(r);
    }
    // conservatively seat unassigned overlapping reservations at the smallest fitting free table
    for (const r of unassigned) {
      const fit = candidates.find((t) => !busy.has(t.id) && t.capacity >= (r.party_size || 2));
      if (fit) busy.add(fit.id);
    }
    const free = candidates.find((t) => !busy.has(t.id));
    return free ? { table: free, start, end } : null;
  };

  const hit = check(startMin);
  if (hit) {
    return { available: true, table: hit.table, end_slot: toHHMM(hit.end), reason: null, alternatives: [] };
  }

  // nearest alternatives: ±30/60/90 within open hours
  const alternatives = [];
  for (const off of [30, -30, 60, -60, 90, -90]) {
    const alt = check(startMin + off);
    if (alt && !alternatives.includes(toHHMM(alt.start))) alternatives.push(toHHMM(alt.start));
    if (alternatives.length === 3) break;
  }
  return {
    available: false,
    reason: startsWithinHours(ranges, startMin) ? "no_table_free" : "outside_hours",
    alternatives,
  };
}

// R-CODE: crockford-ish, no 0/O/1/I — readable over the phone
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export function makeReservationCode() {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `R-${s}`;
}

// "today" in the restaurant's timezone (config-driven, Cairo default)
export function todayISO(tz = "Africa/Cairo") {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

// code-side sanity for LLM-extracted date/time (LLM computes, code validates)
export function validDateISO(s, tz) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return null;
  const d = new Date(`${s}T12:00:00`);
  if (isNaN(d)) return null;
  const today = todayISO(tz);
  if (s < today) return "past";
  const max = new Date(Date.now() + 60 * 86400000).toLocaleDateString("en-CA", { timeZone: tz });
  if (s > max) return "too_far";
  return s;
}
export function validTime(s) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || "")) ? String(s) : null;
}
