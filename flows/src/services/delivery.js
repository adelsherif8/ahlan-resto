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
//     pricing: {                    // HOW the fee is computed (per restaurant, dashboard-editable)
//       mode: "zone_fixed"          //   zone_fixed  → each zone's own `fee` (default = old behaviour)
//           | "flat_in_zone"        //   flat_in_zone→ one `flat_fee` for every covered zone
//           | "distance",           //   distance    → base_fee up to base_km, then per_km per extra km
//       flat_fee: 40,
//       base_fee: 50, base_km: 5, per_km: 6,
//       round_km: "up" | "nearest" | "exact",   // how a partial km is charged (default "up")
//       road_factor: 1.3,           //   straight-line km × this ≈ road km (free, no API)
//       eta_min_per_km: 3, eta_base_min: 10,    // drive-time estimate for the ETA (distance mode)
//     },
//     landmarks: [{name, aliases:[…], lat, lng}] // compounds/malls/streets → pins, checked BEFORE any geocoder
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
// A zone may be a DRAWN BOUNDARY (z.polygon = [[lat,lng], …], drawn on the map in
// Settings or seeded from OSM's official city limits) — exact "inside?" by ray casting,
// zero network — or the older centre+radius circle. Polygon wins when both exist.
export function pointInPolygon(pt, poly) {
  if (!pt || !Array.isArray(poly) || poly.length < 3) return false;
  const x = pt.lng, y = pt.lat;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
    const hit = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}
export function zoneContains(z, coords) {
  if (!coords || coords.lat == null) return false;
  if (Array.isArray(z.polygon) && z.polygon.length >= 3) return pointInPolygon(coords, z.polygon);
  if (typeof z.lat === "number" && typeof z.lng === "number") return distanceKm(coords.lat, coords.lng, z.lat, z.lng) <= (Number(z.radius_km) || 5);
  return false;
}
function matchZoneByPin(zones, coords) {
  if (!coords || coords.lat == null) return null;
  // polygons first (exact), then the nearest circle
  const poly = zones.find((z) => Array.isArray(z.polygon) && z.polygon.length >= 3 && pointInPolygon(coords, z.polygon));
  if (poly) return poly;
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


// ---- ADDRESS → COORDINATES, for free ----
// Order of trust: a pin/Maps link (exact, handled by the caller) → the restaurant's own
// LANDMARK table (compounds, malls, streets they know — zero network) → OpenStreetMap
// Nominatim (free, no key; 1 req/s policy honoured by caching + a UA). Anything below
// confidence returns null and the CALLER asks for a pin — a fee is never guessed.
const geoCache = new Map(); // normalised address → { lat, lng, source, label } | null
const GEO_TTL_MS = 6 * 3600_000;
export function matchLandmark(config, text) {
  const t = norm(text);
  if (!t) return null;
  const lms = config?.basic_info?.delivery?.landmarks || config?.delivery?.landmarks || [];
  let best = null;
  for (const lm of lms) {
    if (typeof lm?.lat !== "number" || typeof lm?.lng !== "number") continue;
    const names = [lm.name, ...(lm.aliases || [])].map(norm).filter((a) => a.length >= 3);
    const hit = names.find((a) => t === a || t.includes(a));
    if (hit && (!best || hit.length > best.len)) best = { lat: lm.lat, lng: lm.lng, label: lm.name, len: hit.length };
  }
  return best ? { lat: best.lat, lng: best.lng, source: "landmark", label: best.label } : null;
}
// ---- RESOLVE WITH CANDIDATES ----
// Returns { point } when ONE place is confidently meant, { candidates:[…] } when a
// few plausible places match (the caller offers them as taps — "which one?"), or
// { none:true }. Landmarks the restaurant listed win outright (typo-tolerant, both
// scripts); OSM results are kept only inside the restaurant's own zone circles, so a
// "Rehab" in Assiut can never be offered to a Cairo guest.
function editDist(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
const arNz = (s) => String(s || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
function landmarkCandidates(config, text) {
  const t = norm(arNz(text));
  if (!t) return [];
  const lms = config?.basic_info?.delivery?.landmarks || config?.delivery?.landmarks || [];
  const out = [];
  for (const lm of lms) {
    if (typeof lm?.lat !== "number" || typeof lm?.lng !== "number") continue;
    const names = [lm.name, ...(lm.aliases || [])].map((a) => norm(arNz(a))).filter((a) => a.length >= 2);
    let score = 0;
    for (const a of names) {
      if (t === a) { score = Math.max(score, 100); continue; }
      if (t.includes(a) || a.includes(t)) { score = Math.max(score, 80 + Math.min(a.length, 15)); continue; }
      // typo tolerance on short names ("levles mall" ~ "levels mall") — judged on the
      // DISTINCTIVE words only; "mall", "street", "new cairo" are shared by half the
      // table and must never carry a match on their own
      const GENERIC = new Set(["mall", "street", "st", "road", "rd", "compound", "club", "hospital", "university", "new", "cairo", "tagamoa", "settlement", "city", "plaza", "gate", "شارع", "مول", "كمبوند", "نادي", "مستشفى", "جامعة", "التجمع", "القاهرة", "الجديدة", "el", "al", "the"]);
      const tw = t.split(" ").filter((w) => w.length >= 3 && !GENERIC.has(w)), aw = a.split(" ").filter((w) => w.length >= 3 && !GENERIC.has(w));
      if (!aw.length) continue;
      const hits = aw.filter((w) => tw.some((x) => x === w || (w.length >= 5 && x.length >= 5 && editDist(x, w) <= 1))).length;
      if (hits === aw.length) score = Math.max(score, 60 + hits * 5);
      // a partial hit needs at least TWO distinctive words in common — one shared
      // word ("south", "el") between "South 90" and "South Academy" is noise
      else if (hits >= 2 && aw.length >= 3 && hits >= aw.length - 1) score = Math.max(score, 45);
    }
    if (score) out.push({ lat: lm.lat, lng: lm.lng, label: lm.name, source: "landmark", score });
  }
  return out.sort((a, b) => b.score - a.score);
}
function insideAnyZone(config, pt) {
  const branches = branchList(config);
  const pool = branches.length ? branches : [null];
  for (const b of pool) for (const z of zonesFor(config, b)) {
    if (Array.isArray(z.polygon) && z.polygon.length >= 3) { if (pointInPolygon(pt, z.polygon)) return true; continue; }
    if (typeof z.lat === "number" && typeof z.lng === "number" && distanceKm(pt.lat, pt.lng, z.lat, z.lng) <= (Number(z.radius_km) || 5) + 3) return true;
  }
  return false;
}
// ---- STREET-LEVEL RESOLUTION CHAIN (all free) ----
//   1. the restaurant's landmark table (compounds/malls/streets it curates)
//   2. Photon (OSM data, fuzzy, biased to the restaurant's zone centre) — SCORED:
//      a hit only counts when the guest's distinctive words appear in its name
//   3. Nominatim, same scoring
//   4. AREA-CENTRE FALLBACK: the message names a district we know (Narges, Yasmeen,
//      Lotus, 5th settlement…) but the street couldn't be placed → the district's
//      centre, marked approx — the fee is right to ±1 km band, the guest isn't stopped
//   5. nothing → { none } and the caller asks for a pin. A fee is never guessed.
// Every candidate is kept only inside the restaurant's own zone circles.
const GENERIC_WORDS = new Set(["street", "st", "road", "rd", "axis", "villa", "building", "floor", "apartment", "apt", "flat", "compound", "mall", "gate", "next", "to", "near", "beside", "behind", "front", "of", "the", "el", "al", "and", "new", "cairo", "egypt", "tagamoa", "settlement", "district", "area", "شارع", "ش", "عمارة", "فيلا", "الدور", "شقة", "محور", "جنب", "بجوار", "خلف", "امام", "أمام", "قدام", "التجمع", "الخامس", "القاهرة", "الجديدة", "مصر", "كمبوند", "مول", "بوابة", "الشارع", "منطقة", "حي", "الحي"]);
const TRANSLIT = [[/^al /, "el "], [/\bibn\b/g, "bin"], [/\bebn\b/g, "bin"], [/\bmohammed\b/g, "mohamed"], [/\bmuhammad\b/g, "mohamed"], [/\bahmad\b/g, "ahmed"], [/\bteseen\b/g, "tesein"], [/\btes3een\b/g, "tesein"], [/\bnargess\b/g, "narges"], [/\byasmin\b/g, "yasmeen"], [/\bbanafsag\b/g, "banafseg"]];
const foldLatin = (s) => { let x = ` ${norm(s)} `; for (const [re, rep] of TRANSLIT) x = x.replace(re, rep); return x.trim(); };
// distinctive words of the guest's text (both scripts), used to SCORE geocoder hits
// Arabic-Indic digits → ASCII so "٩٠" and "90" are the same word
const asciiDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
function distinctiveWords(text) {
  // numbers that NAME a street ("90", "التسعين"→"90") stay distinctive; a lone house
  // number was already stripped by streetCore, so what's left is part of the name
  return norm(asciiDigits(arNz(text))).replace(/\bالتسعين\b|\btesein\b|\bteseen\b|\btes3een\b/g, "90").split(" ")
    .filter((w) => (w.length >= 3 || /^\d{2,3}$/.test(w)) && !GENERIC_WORDS.has(w) && !/^(ibn|bin|ebn|بن|ابن)$/.test(w));
}
const foldWord = (w) => /^\d+$/.test(w) ? w : foldLatin(w).replace(/y\b/, "i").replace(/^(el|al)$/, "").replace(/^(ibn|bin|ebn)$/, "");
function hitScore(guestWords, hitName) {
  const gws = guestWords.map(foldWord).filter((w) => w.length >= 3);
  if (!gws.length) return 0;
  const hw = foldLatin(asciiDigits(arNz(hitName))).replace(/\bالتسعين\b|\btesein\b|\bteseen\b/g, "90").split(" ").map(foldWord).filter((w) => w.length >= 3 || /^\d{2,3}$/.test(w));
  let hits = 0;
  for (const gf of gws) {
    if (hw.some((w) => w === gf || (w.length >= 5 && gf.length >= 5 && (w.startsWith(gf) || gf.startsWith(w) || editDist(w, gf) <= 1)))) hits++;
  }
  return hits / gws.length; // 0..1 fraction of the guest's words the hit carries
}
export function polygonCentroid(poly) {
  if (!Array.isArray(poly) || !poly.length) return null;
  const s = poly.reduce((a, p) => ({ lat: a.lat + p[0], lng: a.lng + p[1] }), { lat: 0, lng: 0 });
  return { lat: s.lat / poly.length, lng: s.lng / poly.length };
}
function zoneCentre(config) {
  const branches = branchList(config);
  const pool = branches.length ? branches : [null];
  for (const b of pool) for (const z of zonesFor(config, b)) {
    if (typeof z.lat === "number") return { lat: z.lat, lng: z.lng };
    const c = polygonCentroid(z.polygon); if (c) return c;
  }
  return { lat: 30.03, lng: 31.47 };
}
async function fetchJson(url, ms = 5000) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "munadim-flows/1.0 (delivery-quote; contact: support@munadim.com)", "Accept-Language": "en,ar" } });
    return res.ok ? await res.json() : null;
  } catch { return null; } finally { clearTimeout(to); }
}
// The STREET is what a geocoder can find; "villa 12, floor 3, next to the pharmacy"
// only confuses it. Strip those parts, then try spelling variants — OSM has one
// spelling per street and Egyptians write five ("al mahdi"/"el mahdy"/"ibn"/"bin").
export function streetCore(text) {
  let s = String(text || "");
  s = s.replace(/https?:\/\/\S+/g, " ");
  s = s.replace(/(?:^|[,،\s])(?:villa|فيلا|فيللا|building|bldg|عمارة|عماره|flat|apt|apartment|شقة|شقه|floor|الدور|دور|gate|بوابة|بوابه|block|بلوك|no\.?|رقم)\s*[#:]?\s*[0-9٠-٩]+[a-z]?/giu, " ");
  s = s.replace(/(?:next to|beside|near|behind|in front of|opposite|جنب|بجوار|بجانب|خلف|امام|أمام|قدام|قصاد|قريب من|عند)\s+.+$/iu, " ");
  s = s.replace(/[,،]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}
export function queryVariants(text) {
  const core = streetCore(text);
  const out = new Set();
  if (core) out.add(core);
  const isAr = /[؀-ۿ]/.test(core);
  if (isAr) {
    out.add(core.replace(/^(شارع|ش)\s+/u, "").trim());
    out.add(core.replace(/^(شارع|ش)\s+/u, "").replace(/\s+(بن|ابن)\s+/gu, " ").trim());
  } else {
    const l = core.toLowerCase().replace(/\b(street|st\.?|road|rd\.?)\b/g, "").replace(/\s+/g, " ").trim();
    out.add(l);
    const v1 = l.replace(/\bal\b/g, "el").replace(/\b(ibn|bin|ebn)\b/g, "").replace(/\s+/g, " ").trim();
    out.add(v1);
    out.add(v1.replace(/i\b/g, "y")); // mahdi → mahdy
    out.add(v1.replace(/\bel\b/g, "al"));
  }
  return [...out].filter((x) => x && x.length >= 3).slice(0, 5);
}
async function photonSearch(config, q) {
  const key = `photon:${norm(q)}`;
  const c = geoCache.get(key);
  if (c && Date.now() - c.at < GEO_TTL_MS) return c.v;
  const ctr = zoneCentre(config);
  const isAr = /[؀-ۿ]/.test(q);
  const j = await fetchJson(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=${ctr.lat}&lon=${ctr.lng}${isAr ? "" : "&lang=en"}`, 4500);
  const out = (j?.features || []).map((f) => {
    const p = f.properties || {};
    const label = [p.name || p.street, p.district || p.locality, p.city].filter(Boolean).slice(0, 2).join(", ");
    return { lat: f.geometry?.coordinates?.[1], lng: f.geometry?.coordinates?.[0], label, source: "photon", kind: p.osm_value || p.type || "", nameForScore: [p.name, p.street, p.district].filter(Boolean).join(" ") };
  }).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));
  geoCache.set(key, { v: out, at: Date.now() });
  return out;
}
async function nominatimSearch(q, cityHint) {
  const key = `nomi:${norm(q)}`;
  const c = geoCache.get(key);
  if (c && Date.now() - c.at < GEO_TTL_MS) return c.v;
  const j = await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=eg&q=${encodeURIComponent(`${q}${cityHint ? `, ${cityHint}` : ""}, Egypt`)}`);
  const specific = (h) => !/^(country|state|region|province|county|city|town)$/i.test(String(h.addresstype || h.type || ""));
  const out = (Array.isArray(j) ? j : []).filter((h) => Number.isFinite(Number(h.lat)) && Number.isFinite(Number(h.lon)) && specific(h))
    .map((h) => ({ lat: Number(h.lat), lng: Number(h.lon), label: String(h.display_name || "").split(",").slice(0, 2).join(",").trim(), source: "osm", kind: h.addresstype || h.type || "", nameForScore: String(h.display_name || "").split(",").slice(0, 3).join(" ") }));
  geoCache.set(key, { v: out, at: Date.now() });
  return out;
}
// areas we KNOW are outside coverage — configurable (delivery.outside_areas), with a
// Cairo default; naming one is an honest "no", never a fuzzy landmark hit
const DEFAULT_OUTSIDE = ["maadi", "المعادي", "zamalek", "الزمالك", "heliopolis", "مصر الجديدة", "dokki", "الدقي", "mohandessin", "المهندسين", "giza", "الجيزة", "6th of october", "6 october", "السادس من اكتوبر", "اكتوبر", "أكتوبر", "sheikh zayed", "zayed", "الشيخ زايد", "زايد", "shorouk", "الشروق", "obour", "العبور", "downtown cairo", "وسط البلد", "alexandria", "اسكندرية", "الإسكندرية", "helwan", "حلوان", "shubra", "شبرا", "ain shams", "عين شمس"];
export function namesOutsideArea(config, text) {
  const t = ` ${norm(arNz(text))} `;
  const list = (config?.basic_info?.delivery?.outside_areas || config?.delivery?.outside_areas || DEFAULT_OUTSIDE).map((a) => norm(arNz(a))).filter(Boolean);
  // an outside word that is ALSO a covered zone/alias (e.g. a restaurant that does
  // cover Maadi) doesn't count
  const covered = branchList(config).concat([null]).flatMap((b) => zonesFor(config, b)).flatMap((z) => [z.area, ...(z.aliases || [])]).map((a) => norm(arNz(a)));
  return list.find((a) => a && t.includes(` ${a} `) && !covered.some((c) => c && (c === a || c.includes(a)))) || null;
}
export async function resolvePlace(config, text, { cityHint = "" } = {}) {
  const raw = String(text || "").replace(/[?؟]|\b(maybe|probably|i think|ya3ny|yemken|يمكن|تقريبا|تقريباً)\b/gi, "").trim();
  if (raw.length < 2) return { none: true };
  const outside = namesOutsideArea(config, raw);
  if (outside) return { outside: true, area: outside };
  // 1) landmarks
  const lms = landmarkCandidates(config, raw);
  // an EXACT/containment alias hit (≥80) beats any fuzzy runner-up outright; two
  // containment hits (South 90 vs North 90 both literally present) is a real tie → ask
  if (lms.length && lms[0].score >= 80 && (lms.length === 1 || lms[1].score < 80)) return { point: lms[0] };
  if (lms.length && lms[0].score >= 60 && (lms.length === 1 || lms[0].score - lms[1].score >= 15)) return { point: lms[0] };
  if (lms.length >= 2 && lms[0].score >= 45) return { candidates: lms.slice(0, 3) };
  if (lms.length === 1 && lms[0].score >= 45) return { point: lms[0] };
  // 2) + 3) geocoders, scored by the guest's own words, zone-filtered
  const core = streetCore(raw) || raw;
  const gw = distinctiveWords(core);
  const scored = [];
  // a CONFIDENT hit that sits outside every zone is remembered: if nothing inside
  // matches, that's an honest "we don't deliver there", not "couldn't place it"
  const outsideHits = [];
  const consider = (arr) => {
    for (const h of arr || []) {
      const s = hitScore(gw, h.nameForScore || h.label);
      if (!insideAnyZone(config, h)) { if (s >= 0.99) outsideHits.push({ ...h, score: s }); continue; }
      if (s >= 0.5) scored.push({ ...h, score: s });
    }
  };
  const variants = queryVariants(raw);
  for (const v of variants) {
    consider(await photonSearch(config, v));
    if (scored.some((s) => s.score >= 0.99)) break;
  }
  if (!scored.some((s) => s.score >= 0.99)) {
    for (const v of variants.slice(0, 2)) { consider(await nominatimSearch(v, cityHint)); if (scored.some((s) => s.score >= 0.99)) break; }
  }
  // best first — by word coverage, then by CLOSENESS TO THE BRANCH (the same street
  // name exists in Nasr City and Tagamoa; the one 2 km away is the one they mean);
  // de-dup points within 300 m
  const home = (() => { const b = branchList(config).find((x) => typeof x.lat === "number"); return b ? { lat: b.lat, lng: b.lng } : zoneCentre(config); })();
  for (const s of scored) s.km = distanceKm(home.lat, home.lng, s.lat, s.lng);
  scored.sort((a, b) => (b.score - a.score) || (a.km - b.km));
  const uniq = [];
  for (const p of scored) if (!uniq.some((u) => distanceKm(u.lat, u.lng, p.lat, p.lng) < 0.3)) uniq.push(p);
  if (uniq.length) {
    const top = uniq[0];
    // a rival must carry the SAME words the top did (not just a similar score) and
    // sit somewhere genuinely different; a same-name street in a farther zone is
    // not a rival when the near one is a full match
    const rivals = uniq.filter((u) => u !== top && u.score >= top.score && distanceKm(u.lat, u.lng, top.lat, top.lng) > 1.5 && !(top.score >= 0.99 && u.km > top.km + 5));
    if (top.score >= 0.99 && !rivals.length) return { point: top };
    if (rivals.length) return { candidates: [top, ...rivals].slice(0, 3) };
    if (top.score >= 0.5) return { point: top };
  }
  // a full-confidence place that is outside coverage → honest no (only when the guest
  // also named a district/city word, so a bare street name that merely EXISTS
  // elsewhere doesn't get refused — those go to the area/pin path)
  if (outsideHits.length && /(nasr|مدينة نصر|maadi|المعادي|heliopolis|مصر الجديدة|zamalek|الزمالك|giza|الجيزة|october|اكتوبر|أكتوبر|zayed|زايد|shorouk|الشروق|obour|العبور|helwan|حلوان|dokki|الدقي|mohandessin|المهندسين|downtown|وسط البلد|shubra|شبرا|ain shams|عين شمس|alex|اسكندرية|الإسكندرية|badr|بدر|city|مدينة)/i.test(raw)) {
    return { outside: true, area: outsideHits[0].label };
  }
  // 4) area-centre fallback: a district we know is named, street not placed. Only
  // AREA-kind landmarks (districts, settlements, main streets) qualify — a partial
  // match on a mall name must not become "approximately at the mall".
  const areaLms = (config?.basic_info?.delivery?.landmarks || config?.delivery?.landmarks || []).filter((l) => l?.kind === "area");
  const areaHits = landmarkCandidates({ basic_info: { delivery: { landmarks: areaLms } } }, raw).filter((l) => l.score >= 40);
  const areaFromZone = (() => {
    const branches = branchList(config); const pool = branches.length ? branches : [null];
    for (const b of pool) { const z = matchZone(zonesFor(config, b), raw); if (z) { const c = typeof z.lat === "number" ? { lat: z.lat, lng: z.lng } : polygonCentroid(z.polygon); if (c) return { ...c, label: z.area, source: "zone" }; } }
    return null;
  })();
  const approx = areaHits[0] || areaFromZone;
  if (approx) return { point: { ...approx, approx: true } };
  return { none: true };
}

export async function geocodeAddress(config, text, { countryHint = "Egypt", cityHint = "" } = {}) {
  const raw = String(text || "").trim();
  if (raw.length < 4) return null;
  const lm = matchLandmark(config, raw);
  if (lm) return lm;
  const key = norm(raw);
  const c = geoCache.get(key);
  if (c && Date.now() - c.at < GEO_TTL_MS) return c.v;
  let v = null;
  try {
    const q = `${raw}${cityHint ? `, ${cityHint}` : ""}, ${countryHint}`;
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=0&countrycodes=eg&q=${encodeURIComponent(q)}`;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "munadim-flows/1.0 (delivery-quote; contact: support@munadim.com)", "Accept-Language": "en,ar" } });
    clearTimeout(to);
    const arr = res.ok ? await res.json() : [];
    const hit = Array.isArray(arr) ? arr[0] : null;
    // Nominatim's `importance` is a rough confidence; a bare city-level hit for a
    // villa number is useless for a fee → require a reasonably specific place type
    const specific = hit && !/^(country|state|region|province|county|city|town)$/i.test(String(hit.addresstype || hit.type || ""));
    if (hit && specific && Number.isFinite(Number(hit.lat)) && Number.isFinite(Number(hit.lon))) {
      v = { lat: Number(hit.lat), lng: Number(hit.lon), source: "osm", label: String(hit.display_name || "").split(",").slice(0, 3).join(",") };
    }
  } catch { v = null; }
  geoCache.set(key, { v, at: Date.now() });
  if (geoCache.size > 2000) geoCache.delete(geoCache.keys().next().value);
  return v;
}

// ---- FEE, by the restaurant's pricing mode ----
export function pricingOf(config) {
  const d = config?.basic_info?.delivery || config?.delivery || {};
  const p = d.pricing || {};
  return {
    mode: ["zone_fixed", "flat_in_zone", "distance"].includes(p.mode) ? p.mode : "zone_fixed",
    flat_fee: Number(p.flat_fee) || 0,
    base_fee: Number(p.base_fee) || 0,
    base_km: Number(p.base_km) || 0,
    per_km: Number(p.per_km) || 0,
    round_km: ["up", "nearest", "exact"].includes(p.round_km) ? p.round_km : "up",
    road_factor: Number(p.road_factor) > 0 ? Number(p.road_factor) : 1.3,
    eta_min_per_km: Number(p.eta_min_per_km) > 0 ? Number(p.eta_min_per_km) : 3,
    eta_base_min: Number(p.eta_base_min) >= 0 ? Number(p.eta_base_min) : 10,
  };
}
// Straight-line km × road factor, then the mode's arithmetic. Pure function — the
// receipt, the quote and the tests all call this one.
export function feeFor(config, { zone = null, roadKm = null } = {}) {
  const p = pricingOf(config);
  const round2 = (n) => Math.round(n * 100) / 100;
  if (p.mode === "flat_in_zone") return { fee: round2(p.flat_fee), mode: p.mode };
  if (p.mode === "distance") {
    if (roadKm == null || !Number.isFinite(roadKm)) return { fee: null, mode: p.mode, reason: "no_distance" };
    const extra = Math.max(0, roadKm - p.base_km);
    const billedExtra = p.round_km === "up" ? Math.ceil(extra - 1e-9) : p.round_km === "nearest" ? Math.round(extra) : extra;
    return { fee: round2(p.base_fee + billedExtra * p.per_km), mode: p.mode, km: round2(roadKm), billed_extra_km: round2(billedExtra) };
  }
  return { fee: round2(Number(zone?.fee) || 0), mode: p.mode };
}
export function roadKmBetween(config, a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const p = pricingOf(config);
  return Math.round(distanceKm(a.lat, a.lng, b.lat, b.lng) * p.road_factor * 10) / 10;
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
      const pricing = pricingOf(config);
      // distance from the SERVING branch's pin to the delivery point (needs both)
      const branchPin = b && typeof b.lat === "number" && typeof b.lng === "number" ? { lat: b.lat, lng: b.lng } : null;
      const km = coords && branchPin ? roadKmBetween(config, branchPin, coords) : null;
      const priced = feeFor(config, { zone: z, roadKm: km });
      // distance mode without a distance = we can't quote yet — the caller asks for a
      // pin/maps link. Never fall back to a guessed number.
      if (pricing.mode === "distance" && priced.fee == null) {
        return { available: true, covered: true, needs_pin: true, branch: b || null, area: z.area, min_order: minOrder, meets_min: Number(subtotal) >= minOrder, mode: pricing.mode };
      }
      const etaBase = pricing.mode === "distance" && km != null
        ? Math.round(pricing.eta_base_min + km * pricing.eta_min_per_km)
        : (Number(z.eta_min) || 0);
      return {
        available: true, covered: true, branch: b || null,
        fee: free ? 0 : priced.fee, base_fee: priced.fee, free, mode: pricing.mode,
        km, billed_extra_km: priced.billed_extra_km ?? null,
        eta_min: d.eta_enabled === false ? null : (etaBase ? etaBase + (Number(d.rush_pad_min) || 0) : null),
        min_order: minOrder, meets_min: Number(subtotal) >= minOrder,
        area: z.area,
      };
    }
  }
  if (deliveryPaused(config)) return { available: false, reason: "paused" };
  // enabled, but this area isn't in any branch's zones (or no zones configured at all).
  // matched_area: the guest's words DID name a known area (just not a covered one) or a
  // point was given — i.e. we genuinely placed them outside. Without either, the caller
  // treats it as unknown and asks for a pin rather than refusing.
  return { available: true, covered: false, reason: "uncovered", message: d.uncovered_message || null,
           has_zones: pool.some((b) => zonesFor(config, b).length > 0), placed: !!coords };
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
