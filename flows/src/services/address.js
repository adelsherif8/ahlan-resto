// Delivery addresses, structured. "Type it out" produced one blob that a rider had
// to decode at the door — no floor, no apartment, no landmark, half of them missing
// the area. We ask for the parts by name and parse them deterministically here:
// address shape is structure, and structure is code's job, not the model's.

// (?![\p{L}]) after each keyword group: without it, "^" matches unconditionally at the
// start of the string, so any address whose first word merely STARTS WITH a keyword —
// "الدوران" (a landmark meaning "the roundabout") starts with "الدور" (floor), "Nearby
// Mosque" starts with "near" — got torn apart and misread as that field's label. Letters
// only (not digits) so a guest who writes "floor3" with no space still parses correctly.
const FLOOR = /(?:^|[,،\n|·-])\s*(?:floor|fl\.?|الدور|دور|طابق)(?![\p{L}])\s*[:#]?\s*([\p{L}\p{N}]{1,12})/iu;
const APT = /(?:^|[,،\n|·-])\s*(?:apartment|apt\.?|flat|unit|شقة|شقه|وحدة)(?![\p{L}])\s*[:#]?\s*([\p{L}\p{N}]{1,12})/iu;
const BUILDING = /(?:^|[,،\n|·-])\s*(?:building|bldg\.?|block|عمارة|عماره|مبنى|بلوك)(?![\p{L}])\s*[:#]?\s*([\p{L}\p{N}]{1,14})/iu;
// capture excludes '-' too, matching every other delimiter in this file (including this
// regex's own leading anchor) — without it, "near X - floor 3" let LANDMARK swallow
// past the dash and duplicate the floor label into the landmark text.
const LANDMARK = /(?:^|[,،\n|·-])\s*(?:landmark|near|beside|next to|in front of|علامة مميزة|جنب|بجوار|قدام|امام)(?![\p{L}])\s*[:#]?\s*([^,،\n|-]{2,60})/iu;

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim().replace(/^[,،\-·|]+|[,،\-·|]+$/g, "").trim();

// Everything the labelled patterns didn't claim is the street/area line — we keep
// the guest's own words for it rather than trying to guess Cairo's geography.
export function parseAddress(raw) {
  const text = clean(raw);
  if (!text) return null;

  const grab = (re) => {
    const m = re.exec(text);
    return m ? clean(m[1]) : null;
  };
  const parts = {
    floor: grab(FLOOR),
    apartment: grab(APT),
    building: grab(BUILDING),
    landmark: grab(LANDMARK),
  };

  // strip the labelled chunks out; what remains is street + area
  let rest = text;
  for (const re of [FLOOR, APT, BUILDING, LANDMARK]) rest = rest.replace(re, " ");
  rest = clean(rest);

  // "12 Road 9, Maadi" → street "12 Road 9", area "Maadi". Only split when the guest
  // actually used a separator; never invent an area boundary that isn't there.
  let street = rest, area = null;
  const bits = rest.split(/[,،]|(?:\s+-\s+)/).map(clean).filter(Boolean);
  if (bits.length >= 2) {
    area = bits[bits.length - 1];
    street = bits.slice(0, -1).join(", ");
  }

  return { ...parts, street: street || null, area, raw: text };
}

// One line a rider can read at the door, built from whatever we actually know.
export function formatAddress(parts) {
  if (!parts) return null;
  if (typeof parts === "string") return clean(parts);
  const head = [parts.street, parts.area].filter(Boolean).join(", ");
  const inner = [
    parts.building ? `Building ${parts.building}` : null,
    parts.floor ? `Floor ${parts.floor}` : null,
    parts.apartment ? `Apt ${parts.apartment}` : null,
  ].filter(Boolean).join(", ");
  const tail = parts.landmark ? `(${parts.landmark})` : null;
  return [head || parts.raw, inner, tail].filter(Boolean).join(" — ") || null;
}

// What's still missing that a rider genuinely needs. Landmark is a nice-to-have and
// never worth an extra turn; a flat with no apartment number is a doorstep problem.
export function missingAddressParts(parts) {
  if (!parts) return ["address"];
  const missing = [];
  if (!parts.street && !parts.raw) missing.push("street or building");
  if (!parts.area) missing.push("area");
  if (!parts.floor) missing.push("floor");
  if (!parts.apartment) missing.push("apartment");
  return missing;
}

// The prompt the guest sees. Kept here so the wording lives next to the parser
// that has to read the answer back.
export const ADDRESS_TEMPLATE_EN =
  "What's the delivery address? Send it like this 👇\n" +
  "• Street / building\n" +
  "• Area\n" +
  "• Floor\n" +
  "• Apartment\n" +
  "• Landmark (optional)\n\n" +
  "Or paste a Google Maps link 🔗";

export const ADDRESS_TEMPLATE_AR =
  "إيه عنوان التوصيل؟ ابعته كده 👇\n" +
  "• الشارع / العمارة\n" +
  "• المنطقة\n" +
  "• الدور\n" +
  "• الشقة\n" +
  "• علامة مميزة (اختياري)\n\n" +
  "أو ابعت لينك جوجل مابس 🔗";
