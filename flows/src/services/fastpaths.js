// Zero-LLM fast paths: closing detection + FAQ cache (hours / location / contact).
// Biggest cost saver — the most common messages never touch a model.
import { hoursToday } from "./tenant.js";

const AR = /[؀-ۿ]/;

function lang(message, sticky) {
  if (AR.test(message)) return "ar";
  if (/\b(3ayez|3aiz|fein|fen|emta|ezay|eshta|tamam|shokran|habibi|ya3ni|keda|bokra)\b/i.test(message)) return "franco";
  if (sticky) return sticky;
  return "en";
}

// ---- closing detection ----
// NOTE: deliberately does NOT match bare affirmatives (tamam/ok/👍 alone) — those may be
// a reservation confirmation, and the closer must never swallow a confirm.
const CLOSERS = /^((ok|okay|tamam|tmam|khalas|great|perfect|awesome|طيب|تمام)[\s,]*)?(thanks|thank ?you|thx|ty|shokran|shukran|شكرا|شكراً|مرسي|mersi|merci|bye|goodbye|good ?night|tsbah 3ala kher|تصبح على خير|🙏|❤️)([\s,]*(ya\s?)?(basha|pasha|fandem|habibi|habibty|gamil|باشا|يا باشا|فندم|حبيبي|يا جميل))?[\s!.😊🙏❤️👍]*$/i;

export function detectCloser(message, sticky) {
  const t = message.trim();
  if (t.length > 30 || !CLOSERS.test(t)) return null;
  const l = lang(t, sticky);
  const replies = {
    en: "Anytime! See you soon 🧡",
    ar: "في أي وقت! نستناك قريب 🧡",
    franco: "Anytime ya basha! Nestanak 🧡",
  };
  return { reply: replies[l] || replies.en, kind: "closer", language: l };
}

// ---- FAQ cache ----
const HOURS_PAT = /\b(open|close|closing|opening|hours|what time|until when|when do you|فاتحين|بتفتحوا|بتقفلوا|امتى|مواعيد|شغالين|fat7in|bteftahu|bte2felo|emta|maw3id|maw3eed|sha8alin)\b/i;
const LOCATION_PAT = /\b(where|address|location|located|directions|how (do i|to) get|فين|عنوان|مكان|وصل|ازاي اجي|fein|fen|makan|3enwan|ezay agi)\b/i;
const CONTACT_PAT = /\b(phone number|call you|contact number|رقم|اتصل|كلمكم|ra2m|rakam|ttsl)\b/i;

function fmtRanges(ranges) {
  if (!ranges?.length) return null;
  return ranges.map((r) => `${r.open}–${r.close}`).join(", ");
}

// day-specific hours ("friday", "tomorrow") — the template only knows TODAY; weekly needs the LLM
const DAY_PAT = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|weekend|bokra|بكرة|بكره|الويكند|الجمعة|الجمعه|السبت|الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس)\b/i;
// compound messages ("...and do you have vegan food?") — the template would swallow the other half
const COMPOUND_PAT = /(\?[^?]*\?)|\b(and|also|plus|kaman|كمان|وكذلك)\b|(^|\s)و\s/i;

export function matchFaq(message, config, sticky) {
  // only fire on short, single-topic questions — anything nuanced goes to the LLM
  if (message.length > 90 || message.split("\n").length > 2) return null;
  if (DAY_PAT.test(message) || COMPOUND_PAT.test(message)) return null;
  // nuanced hours questions (kitchen close, last order, specific days) need the LLM's judgment
  if (/\b(kitchen|last order|مطبخ|اخر طلب|آخر طلب)\b/i.test(message)) return null;
  const l = lang(message, sticky);
  const bi = config.basic_info || {};
  const h = hoursToday(config.hours, bi.timezone);
  const today = fmtRanges(h.ranges);

  // if BOTH patterns hit (hours + location) it's multi-intent → LLM handles better
  const hits = [HOURS_PAT.test(message), LOCATION_PAT.test(message), CONTACT_PAT.test(message)].filter(Boolean).length;
  if (hits !== 1) return null;

  if (HOURS_PAT.test(message)) {
    if (!today) return null;
    const replies = {
      en: `${h.openNow ? "We're open right now! 🎉" : "We're closed at the moment."} Today's hours: ${today}.`,
      ar: `${h.openNow ? "احنا فاتحين دلوقتي! 🎉" : "احنا مقفولين حالياً."} مواعيد النهاردة: ${today}.`,
      franco: `${h.openNow ? "E7na fat7in delwa2ty! 🎉" : "Ma2fulin delwa2ty."} Mawa3id enaharda: ${today}.`,
    };
    return { reply: replies[l] || replies.en, kind: "faq_hours", language: l };
  }
  if (LOCATION_PAT.test(message)) {
    if (!bi.address && !bi.google_maps) return null; // nothing real in the DB → let the LLM be honest
    const maps = bi.google_maps ? `\n🗺️ ${bi.google_maps}` : "";
    const parking = bi.parking ? (l === "ar" ? ` الركنة: ${bi.parking}` : ` Parking: ${bi.parking}`) : "";
    const addr = bi.address ? `📍 ${bi.address}${bi.area ? (l === "ar" ? "، " : ", ") + bi.area : ""}.` : "";
    return { reply: `${addr}${parking}${maps}`.trim(), kind: "faq_location", language: l };
  }
  if (CONTACT_PAT.test(message)) {
    const phone = bi.contact?.phone;
    if (!phone) return null;
    const replies = {
      en: `You can reach us at ${phone} 📞`,
      ar: `تقدر تكلمنا على ${phone} 📞`,
      franco: `Kalemna 3ala ${phone} 📞`,
    };
    return { reply: replies[l] || replies.en, kind: "faq_contact", language: l };
  }
  return null;
}
