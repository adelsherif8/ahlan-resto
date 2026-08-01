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

// Guest tapped a category in the WhatsApp menu list (message = the category name):
// full deterministic listing — every dish, price, flags. Zero LLM, zero teasing.
export async function matchMenuCategory(db, message, currency = "EGP") {
  const probe = String(message).trim().split("\n")[0].trim();
  if (!probe || probe.length > 24 || /[?؟]/.test(probe)) return null;
  const { data } = await db.from("menu_items").select("*").order("sort_order");
  const items = (data || []).filter((m) => m.available);
  const cat = [...new Set(items.map((m) => m.category))].find((c) => String(c).toLowerCase() === probe.toLowerCase());
  if (!cat) return null;
  const list = items.filter((m) => m.category === cat);
  const lines = list.map((m) =>
    `• ${m.name} — ${m.price} ${currency}${m.bestseller ? " ⭐" : ""}${m.spice_level ? " " + "🌶".repeat(m.spice_level) : ""}${m.description ? `\n   ${m.description}` : ""}`
  );
  return { reply: `🍽 ${cat}\n\n${lines.join("\n")}`, kind: "menu_category", language: null };
}

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

// ---- "do you deliver?" — a config lookup, not a judgment call ----
const SERVICE_PAT = /\b(do you |can i |is there |هل ?)?(deliver|delivery|توصيل|دليفري|بتوصلوا|takeaway|take ?away|pick ?up|تيك ?اواي|استلام)\b/i;

export function matchService(message, config, sticky) {
  if (message.length > 70 || !SERVICE_PAT.test(message)) return null;
  // Must be someone ASKING whether we do it. "2 fries for pickup from Maadi" also
  // contains the word — answering that with "yes we do pickup" swallows an order.
  if (!/[?؟]/.test(message) && !/^(do|does|can|is|are|هل|بتوصلوا|في)\b/i.test(message.trim())) return null;
  if (/\d/.test(message)) return null;
  // "can I get an iconic meal for pickup" starts with "can" and contains "pickup",
  // but it is an ORDER. An ordering verb means hands off — answering it with
  // "yes we do pickup" throws the order away and the guest starts over.
  if (/\b(get|want|order|have|take|gimme|make|bring|عايز|عاوز|أريد|اريد|هات|اطلب)\b/i.test(message)) return null;
  // "deliver to Maadi?" / "how much is delivery" need real answers, not a yes/no
  if (/\b(to|fee|cost|charge|how much|بكام|لفين|كام)\b/i.test(message)) return null;
  const svc = config.basic_info?.services;
  if (!svc || typeof svc !== "object") return null; // nothing configured → never guess
  const l = lang(message, sticky);
  const on = [
    svc.delivery !== false ? { en: "delivery", ar: "توصيل", franco: "delivery" } : null,
    svc.pickup !== false ? { en: "pickup", ar: "استلام من الفرع", franco: "pickup" } : null,
    svc.dine_in !== false ? { en: "dine-in", ar: "الأكل في الفرع", franco: "dine-in" } : null,
  ].filter(Boolean);
  if (!on.length) return null;
  const list = on.map((x) => x[l] || x.en);
  const join = l === "ar" ? " و" : ", ";
  const replies = {
    en: `Yes — we do ${list.join(join)} 🙌 What works for you?`,
    ar: `أيوة، عندنا ${list.join(join)} 🙌 تحب إيه؟`,
    franco: `Aywa, 3andena ${list.join(join)} 🙌 Te7eb eh?`,
  };
  return { reply: replies[l] || replies.en, kind: "faq_services", language: l };
}

// ---- "how much is the iconic meal?" — one named item, one price ----
const PRICE_PAT = /\b(how much|price of|price for|what'?s the price|بكام|السعر|سعر|kam|be?kam)\b/i;

export async function matchItemPrice(db, message, currency = "EGP", sticky = null) {
  if (message.length > 70 || !PRICE_PAT.test(message)) return null;
  // a quantity means arithmetic, and "and"/"or" means more than one thing — both
  // belong to the model, which can add up and compare
  if (/\d/.test(message) || /\b(and|or|both|و|أو)\b/i.test(message)) return null;
  const { data } = await db.from("menu_items").select("name,price,options,available").order("sort_order");
  const items = (data || []).filter((m) => m.available);
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
  const said = norm(message);
  const hits = items.filter((m) => norm(m.name) && said.includes(norm(m.name)));
  if (hits.length !== 1) return null;
  const m = hits[0];
  // an item with several priced formats has no single answer — let the model ask
  const priced = (m.options || []).find((g) => (g.choices || []).some((c) => c.price != null));
  if (priced) return null;
  const l = lang(message, sticky);
  const replies = {
    en: `${m.name} is ${m.price} ${currency} 🙂`,
    ar: `${m.name} بـ ${m.price} ${currency} 🙂`,
    franco: `${m.name} be ${m.price} ${currency} 🙂`,
  };
  return { reply: replies[l] || replies.en, kind: "faq_item_price", language: l };
}
