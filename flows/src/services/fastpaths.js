// Zero-LLM fast paths: closing detection + FAQ cache (hours / location / contact).
// Biggest cost saver — the most common messages never touch a model.
import { orderedCategories } from "./categories.js";
import { hoursToday } from "./tenant.js";

const AR = /[؀-ۿ]/;

// Franco markers must be as wide here as in the router, or a fast path answers a
// Franco guest in English: "ab3atli el menu" carried none of the old keywords, so the
// instant menu line came back in English to someone writing Arabic in Latin letters.
const FRANCO = /(3ayez|3aiz|3awez|3awz|fein|fen|emta|ezay|eshta|tamam|shokran|habibi|ya3ni|keda|bokra|ab3at|eb3at|hatli|hatly|warini|law sama7t|ma3lesh|delwa2ty|naharda|3andko|te7eb|momken|nefsak|kwayes|sabah el|masa el|3alek|akl|akol|el menu|elmenu)/i;
function lang(message, sticky) {
  if (AR.test(message)) return "ar";
  if (FRANCO.test(message)) return "franco";
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

// "build my own" — the guest wants the 3D builder, not a menu item. Kept as a
// pattern here (with the same Unicode boundaries as every other matcher, because
// \b never matches beside Arabic script) so master can mint the signed link.
// اصمم/asamem is bare "design/insist" in Egyptian Arabic — "insist" is the FAR more
// common everyday sense ("لو حد اصمم على السعر" = "if someone insists on the price"),
// so without requiring an object the pattern hijacked ordinary sentences into the
// sandwich builder. Requiring "برجر"/"ساندوتش"/"burger"/"sandwich" right after it,
// same as the English "design (my|a)? (burger|sandwich)" branch, is what actually
// distinguishes "design a burger" from "insist on it".
const BUILD_PAT = /(?<![\p{L}\p{N}])(build (my |your |a )?own|make (my |your )own|build (a |my )?(burger|sandwich)|customi[sz]e (my |a )?(burger|sandwich)|design (my |a )?(burger|sandwich)|3d builder|اعمل (برجر|ساندوتش)|اصمم (لي |لى )?(برجر|ساندوتش)|بظبط برجر|a3mel burger|a3mel sandwich|asamem (my |a )?(burger|sandwich))(?![\p{L}\p{N}])/iu;

export function wantsBuilder(message) {
  return BUILD_PAT.test(String(message || ""));
}

// ---- FAQ cache ----
const HOURS_PAT = /(?<![\p{L}\p{N}])(open|close|closing|opening|hours|what time|until when|when do you|فاتحين|بتفتحوا|بتقفلوا|امتى|مواعيد|شغالين|fat7in|bteftahu|bte2felo|emta|maw3id|maw3eed|sha8alin)(?![\p{L}\p{N}])/iu;
const LOCATION_PAT = /(?<![\p{L}\p{N}])(where|address|location|located|directions|how (do i|to) get|فين|عنوان|مكان|وصل|ازاي اجي|fein|fen|makan|3enwan|ezay agi)(?![\p{L}\p{N}])/iu;
const CONTACT_PAT = /(?<![\p{L}\p{N}])(phone number|call you|contact number|رقم|اتصل|كلمكم|ra2m|rakam|ttsl)(?![\p{L}\p{N}])/iu;

function fmtRanges(ranges) {
  if (!ranges?.length) return null;
  return ranges.map((r) => `${r.open}–${r.close}`).join(", ");
}

// day-specific hours ("friday", "tomorrow") — the template only knows TODAY; weekly needs the LLM
const DAY_PAT = /(?<![\p{L}\p{N}])(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|weekend|bokra|بكرة|بكره|الويكند|الجمعة|الجمعه|السبت|الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس)(?![\p{L}\p{N}])/iu;
// compound messages ("...and do you have vegan food?") — the template would swallow the other half
const COMPOUND_PAT = /(\?[^?]*\?)|(?<![\p{L}\p{N}])(and|also|plus|kaman|كمان|وكذلك)(?![\p{L}\p{N}])|(^|\s)و\s/iu;

// Guest tapped a category in the WhatsApp menu list (message = the category name):
// full deterministic listing — every dish, price, flags. Zero LLM, zero teasing.
import { getMenu } from "./menucache.js";

export async function matchMenuCategory(db, message, currency = "EGP", config = null) {
  const probe = String(message).trim().split("\n")[0].trim();
  if (!probe || probe.length > 24 || /[?؟]/.test(probe)) return null;
  const data = await getMenu(db);
  const items = (data || []).filter((m) => m.available);
  // a tapped list row sends the row TITLE back — English name, or the restaurant's
  // Arabic category name for an Arabic guest — match either
  const nz = (s) => String(s || "").toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim();
  const cats = orderedCategories(items, config || {});
  const hit = cats.find((c) => nz(c.name) === nz(probe) || (c.name_ar && nz(c.name_ar) === nz(probe)));
  if (!hit) return null;
  const isAr = /[؀-ۿ]/.test(probe) || (!!hit.name_ar && nz(hit.name_ar) === nz(probe));
  const list = items.filter((m) => m.category === hit.name);
  const lines = list.map((m) =>
    `• ${isAr && m.name_ar ? m.name_ar : m.name} — ${m.price} ${currency}${m.bestseller ? " ⭐" : ""}${m.spice_level ? " " + "🌶".repeat(m.spice_level) : ""}${(isAr ? (m.ingredients_ar || m.description) : m.description) ? `\n   ${isAr ? (m.ingredients_ar || m.description) : m.description}` : ""}`
  );
  return { reply: `🍽 ${isAr && hit.name_ar ? hit.name_ar : hit.name}\n\n${lines.join("\n")}`, kind: "menu_category", language: isAr ? "ar" : null };
}

export function matchFaq(message, config, sticky) {
  // a guest SHARING a location pin ("[shared location] (lat,lng)") is giving us
  // their address, not asking for ours — the word "location" must not trip this
  if (/\[shared location\]|\[location\]/i.test(message)) return null;
  // "where's MY ORDER / my food / my delivery" asks about their ticket, not our
  // address — it belongs to the order agent's status flow, never to this FAQ
  if (/(?<![\p{L}\p{N}])(my |the |our )?(order|food|delivery|rider|driver|طلب(ي|ه)?|الطلب|الاوردر|الأوردر|اوردري|الدليفري|السواق)(?![\p{L}\p{N}])/iu.test(message)) return null;
  // ANY delivery-coverage question ("where do you (not) deliver to?", "بتوصلوا فين") is
  // about ZONES, not our address — the LLM answers it from the delivery facts. The old
  // guard only caught the noun "delivery"; the verb slipped through and a guest asking
  // about coverage got a map pin to the branch instead.
  if (/(?<![\p{L}\p{N}])(deliver(s|y|ies|ing)?|توصيل|توصلوا|بتوصل|توصل)(?![\p{L}\p{N}])/iu.test(message)) return null;
  // "Where am I?" asks about the GUEST's location, not ours — we genuinely don't know
  // it. Answering with the branch address read as creepy/wrong; the LLM answers honestly
  // ("I can't see your location — share a pin and I'll help").
  if (/(?<![\p{L}\p{N}])(where am i|انا فين|أنا فين|ana fein|ana fen)(?![\p{L}\p{N}])/iu.test(message)) return null;
  // only fire on short, single-topic questions — anything nuanced goes to the LLM
  if (message.length > 90 || message.split("\n").length > 2) return null;
  if (DAY_PAT.test(message) || COMPOUND_PAT.test(message)) return null;
  // nuanced hours questions (kitchen close, last order, specific days) need the LLM's judgment
  if (/(?<![\p{L}\p{N}])(kitchen|last order|مطبخ|اخر طلب|آخر طلب)(?![\p{L}\p{N}])/iu.test(message)) return null;
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

// ---- approved FAQs answer for free — every Settings approval permanently
// converts an LLM turn into a 0-LLM one. Matching is deterministic: normalized
// equality, or ALL content words of the stored question present in the message.
// This is "semantic caching" with a human validating every cache entry.
const FAQ_STOP = new Set(["do", "you", "the", "a", "an", "is", "are", "what", "your", "there", "any", "have", "does", "can", "i", "we", "في", "هل", "ايه", "انتو", "عندكم"]);
function faqTokens(q) {
  return String(q).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1 && !FAQ_STOP.has(w));
}
export function matchApprovedFaq(message, config) {
  if (message.length > 120 || message.split("\n").length > 2) return null;
  const probe = ` ${String(message).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()} `;
  for (const f of config.faqs || []) {
    if (!f?.q || !f?.a) continue;
    const toks = faqTokens(f.q);
    if (toks.length < 2) continue; // too generic to match safely
    if (toks.every((t) => probe.includes(` ${t}`) || probe.includes(`${t} `))) {
      return { reply: String(f.a), kind: "faq_approved", language: null };
    }
  }
  return null;
}

// ---- item facts straight from the DB: "what's in X" / "is X spicy" ----
const INGREDIENTS_PAT = /(?<![\p{L}\p{N}])(what'?s in|what is in|inside|ingredients?|made (of|with)|contains?|فيه ايه|فيه إيه|فيها ايه|فيها إيه|جواه|جواها|مكونات|مكوناته|مكوناتها|بيتعمل من|feh eh|fyh eh|gowah|gowaha|makonat)(?![\p{L}\p{N}])/iu;
// "wat is inisde teh truffle shroom" — guests typo the QUESTION words, not just dish
// names. A fuzzy pass over the message's tokens catches 1–2-letter slips of the
// ingredient keywords, so the free path still answers instead of a paid model.
const ING_FUZZY = ["inside", "ingredients", "ingredient", "contains"];
function wantsIngredientsLoose(message) {
  if (INGREDIENTS_PAT.test(message)) return true;
  const toks = String(message).toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 5);
  return toks.some((t) => ING_FUZZY.some((k) =>
    Math.abs(k.length - t.length) <= 2 && editDistance(t, k) <= (Math.min(t.length, k.length) >= 6 ? 2 : 1)));
}
// A follow-up that NAMES a dish is a dish-info question, whatever came before:
// "wat about the Smoky BBQ Burger" deserves the same instant card.
const ABOUT_PAT = /(?<![\p{L}\p{N}])((wh?at|how) ?about|tell me about|وايه عن|وإيه عن|طب وايه|وايه رأيك في|w ?eh 3an|ra2yak fi)(?![\p{L}\p{N}])/iu;
const SPICY_PAT = /(?<![\p{L}\p{N}])(spicy|hot\??$|حار|سبايسي|حراق)(?![\p{L}\p{N}])/iu;
export function findItem(data, message) {
  // The Arabic definite article is stripped on BOTH sides: guests say «الترافل شروم»,
  // the menu row says «ترافل شروم برجر» — symmetric normalisation keeps them equal.
  const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/(^|\s)ال(?=\S)/g, "$1").replace(/\s+/g, " ").trim();
  const probe = ` ${norm(message)} `;
  const items = (data || []).filter((m) => m.available);
  // Arabic guests name dishes by their Arabic menu name — match both scripts.
  return items.find((m) => probe.includes(` ${norm(m.name)} `))
    || items.find((m) => m.name_ar && probe.includes(` ${norm(m.name_ar)} `))
    || items.find((m) => { const t = norm(m.name).split(" ")[0]; return t.length >= 4 && probe.includes(` ${t} `); })
    || items.find((m) => { const t = norm(m.name_ar || "").split(" ")[0]; return t.length >= 4 && probe.includes(` ${t} `); })
    || null;
}
export async function matchItemInfo(db, message, sticky = null, currency = "EGP") {
  if (message.length > 90) return null;
  const wantsIngredients = wantsIngredientsLoose(message);
  const wantsSpice = SPICY_PAT.test(message);
  const wantsAbout = ABOUT_PAT.test(message);
  if (!wantsIngredients && !wantsSpice && !wantsAbout) return null;
  const data = await getMenu(db);
  const item = findItem(data, message);
  if (!item) { if (wantsIngredients || wantsSpice) nearMiss("item_info", message); return null; }
  const l = lang(message, sticky);
  // Arabic guests get the Arabic dish name; ingredient text comes from the DB in
  // the guest's language when it exists (ingredients_ar), never invented.
  const dnAr = item.name_ar || item.name;
  if (wantsIngredients || wantsAbout) {
    const srcEn = item.ingredients || item.description;
    const srcAr = item.ingredients_ar || null;
    if (!srcEn && !srcAr) return null; // nothing real in the DB → the LLM stays honest instead
    const price = Number(item.price) ? Number(item.price) : null;
    const tail = price ? ` — ${price} ${currency}` : "";
    const tailAr = price ? ` — ${price} ${currency === "EGP" ? "جنيه" : currency}` : "";
    const replies = {
      en: `*${item.name}*${tail}\n${srcEn || srcAr}`,
      ar: `*${dnAr}*${tailAr}\n${srcAr || srcEn}`,
      franco: `*${item.name}*${tail}\n${srcEn || srcAr}`,
    };
    // The dish's photo rides WITH the answer (deliver merges it into one message) —
    // never a "want to see a photo?" question, never a second bubble.
    const photos = item.photo_url ? [{ url: item.photo_url, caption: `${l === "ar" ? dnAr : item.name}${l === "ar" ? tailAr : tail}` }] : [];
    return { reply: replies[l] || replies.en, kind: "item_info", language: l, photos };
  }
  if (wantsSpice) {
    if (item.spice_level == null) return null;
    const level = Number(item.spice_level);
    const replies = {
      en: level === 0 ? `${item.name} isn't spicy at all 👌` : `${item.name} is ${["not spicy", "mildly spicy 🌶", "medium spicy 🌶🌶", "properly hot 🌶🌶🌶"][level] || "spicy"}`,
      ar: level === 0 ? `${dnAr} مش حار خالص 👌` : `${dnAr} ${["مش حار", "حار خفيف 🌶", "حار متوسط 🌶🌶", "حار جامد 🌶🌶🌶"][level] || "حار"}`,
      franco: level === 0 ? `${item.name} mesh 7ar khales 👌` : `${item.name} ${["mesh 7ar", "7ar khafif 🌶", "7ar metwaset 🌶🌶", "7ar gamed 🌶🌶🌶"][level] || "7ar"}`,
    };
    return { reply: replies[l] || replies.en, kind: "item_spice", language: l };
  }
  return null;
}

// ---- near-miss telemetry: a fast path ALMOST fired — these messages tell us
// exactly which phrasings to add next. Ring buffer surfaces in /api/metrics.
const nearMisses = [];
export function nearMiss(kind, message) {
  nearMisses.push({ kind, message: String(message).slice(0, 120), at: new Date().toISOString() });
  if (nearMisses.length > 50) nearMisses.shift();
}
export function recentNearMisses() { return [...nearMisses]; }

// ---- "do you deliver?" — a config lookup, not a judgment call ----
const SERVICE_PAT = /\b(do you |can i |is there |هل ?)?(deliver|delivery|توصيل|دليفري|بتوصلوا|takeaway|take ?away|pick ?up|تيك ?اواي|استلام)\b/i;

export function matchService(message, config, sticky) {
  if (message.length > 70 || !SERVICE_PAT.test(message)) return null;
  // Must be someone ASKING whether we do it. "2 fries for pickup from Maadi" also
  // contains the word — answering that with "yes we do pickup" swallows an order.
  if (!/[?؟]/.test(message) && !/^(do|does|can|is|are|هل|بتوصلوا|في)(?![\p{L}\p{N}])/iu.test(message.trim())) return null;
  if (/\d/.test(message)) return null;
  // "can I get an iconic meal for pickup" starts with "can" and contains "pickup",
  // but it is an ORDER. An ordering verb means hands off — answering it with
  // "yes we do pickup" throws the order away and the guest starts over.
  if (/(?<![\p{L}\p{N}])(get|want|order|have|take|gimme|make|bring|عايز|عاوز|أريد|اريد|هات|اطلب)(?![\p{L}\p{N}])/iu.test(message)) return null;
  // "deliver to Maadi?" / "how much is delivery" need real answers, not a yes/no
  if (/(?<![\p{L}\p{N}])(to|fee|cost|charge|how much|بكام|لفين|كام)(?![\p{L}\p{N}])/iu.test(message)) return null;
  const svc = config.basic_info?.services;
  if (!svc || typeof svc !== "object") return null; // nothing configured → never guess
  const l = lang(message, sticky);
  // IRON RULE: an unset field is UNKNOWN, not yes — only fields explicitly true
  // may be asserted in a 0-LLM answer. Anything unset falls through to the LLM,
  // whose FACTS block says "not set → the team will confirm".
  const on = [
    svc.delivery === true ? { en: "delivery", ar: "توصيل", franco: "delivery" } : null,
    svc.pickup === true ? { en: "pickup", ar: "استلام من الفرع", franco: "pickup" } : null,
    svc.dine_in === true ? { en: "dine-in", ar: "الأكل في الفرع", franco: "dine-in" } : null,
  ].filter(Boolean);
  const unset = ["delivery", "pickup", "dine_in"].some((k) => svc[k] === undefined || svc[k] === null);
  if (!on.length || unset) return null;
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
const PRICE_PAT = /(?<![\p{L}\p{N}])(how much|price of|price for|what'?s the price|بكام|السعر|سعر|kam|be?kam)(?![\p{L}\p{N}])/iu;

// ---- multi-item price math: "total for 2 american truck meals and a coke?" ----
// Arithmetic is code's job — the model once quoted "250 each + 30" and totalled
// it as 680. Fires ONLY when every segment resolves to exactly one unambiguous
// unit price; anything unresolved falls through to the model with the menu.
const MATH_PAT = /(?<![\p{L}\p{N}])(total|how much|cost|price|بكام|كام|الاجمالي|الإجمالي|bekam|be kam|kam)(?![\p{L}\p{N}])/iu;
export async function matchPriceMath(db, message, currency = "EGP", sticky = null) {
  if (message.length > 160 || !MATH_PAT.test(message)) return null;
  if (!/\d/.test(message) && !/(?<![\p{L}\p{N}])(a|an|one)(?![\p{L}\p{N}])/iu.test(message)) return null;
  const data = await getMenu(db);
  const items = (data || []).filter((m) => m.available);
  const norm = (x) => String(x || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  // every sellable name we can price: priced option choices first (they're the
  // most specific — "american truck meal" = the 250 choice), then items whose
  // top-level price is the whole answer (no priced options underneath)
  const priceBook = [];
  for (const m of items) {
    const pricedGroups = (m.options || []).filter((g) => (g.choices || []).some((c) => c.price != null));
    for (const g of pricedGroups) for (const c of g.choices || []) {
      if (c.price != null && c.name) priceBook.push({ name: norm(c.name), label: c.name, price: Number(c.price) });
    }
    if (!pricedGroups.length && m.price != null) priceBook.push({ name: norm(m.name), label: m.name, price: Number(m.price) });
  }
  priceBook.sort((a, b) => b.name.length - a.name.length); // longest name wins
  const ALIASES = { coke: "coca cola", cocacola: "coca cola", كوكاكولا: "coca cola", كوكا: "coca cola", بيبسي: "pepsi" };
  // strip the question part, then each comma/"and" segment must resolve
  const bodyRaw = norm(message)
    .replace(/(?<![\p{L}\p{N}])(what'?s|whats|the|total|for|of|how|much|is|are|cost|price|please|بكام|كام|الاجمالي|الإجمالي|bekam|kam)(?![\p{L}\p{N}])/giu, " ")
    .replace(/\s+/g, " ").trim();
  const segments = bodyRaw.split(/(?<![\p{L}\p{N}])(?:and|kaman|w|و|\+|,)(?![\p{L}\p{N}])|,/iu).map((x) => x.trim()).filter(Boolean);
  if (!segments.length || segments.length > 6) return null;
  const lines = [];
  let total = 0;
  for (const seg of segments) {
    let rest = seg;
    let qty = 1;
    const qm = rest.match(/^(\d{1,2})\s+/) || rest.match(/^(a|an|one|واحد|واحدة)\s+/iu);
    if (qm) { qty = /^\d/.test(qm[1]) ? parseInt(qm[1], 10) : 1; rest = rest.slice(qm[0].length).trim(); }
    if (!rest || qty < 1 || qty > 20) return null;
    const depluraled = rest.replace(/s$/i, "");
    const candidates = [rest, depluraled, ALIASES[rest.replace(/\s+/g, "")] || ALIASES[rest], ALIASES[depluraled]].filter(Boolean);
    let hit = null;
    for (const cand of candidates) {
      hit = priceBook.find((p) => p.name === cand) || priceBook.find((p) => p.name === cand.replace(/\s+/g, " "));
      if (hit) break;
    }
    // last resort: the segment IS the book name minus filler ("coca cola" ⊇ "cola" is
    // too loose — require the book name to contain the whole said phrase as words)
    if (!hit) {
      const matches = priceBook.filter((p) => ` ${p.name} `.includes(` ${depluraled} `));
      if (matches.length === 1) hit = matches[0];
    }
    if (!hit || !Number.isFinite(hit.price)) return null; // anything unresolved → the model handles it
    total += qty * hit.price;
    lines.push(`${qty}× ${hit.label} (${hit.price})`);
  }
  if (lines.length < 2 && !/\d/.test(message)) return null; // single unqty'd item → matchItemPrice's job
  const l = lang(message, sticky);
  const breakdown = lines.join(" + ");
  const replies = {
    en: `That's ${total} ${currency}: ${breakdown} 🙂`,
    ar: `الاجمالي ${total} ${currency}: ${breakdown} 🙂`,
    franco: `El total ${total} ${currency}: ${breakdown} 🙂`,
  };
  return { reply: replies[l] || replies.en, kind: "price_math", language: l };
}

export async function matchItemPrice(db, message, currency = "EGP", sticky = null) {
  if (message.length > 70 || !PRICE_PAT.test(message)) return null;
  // a quantity means arithmetic, and "and"/"or" means more than one thing — both
  // belong to the model, which can add up and compare
  if (/\d/.test(message) || /(?<![\p{L}\p{N}])(and|or|both|و|أو)(?![\p{L}\p{N}])/iu.test(message)) return null;
  const data = await getMenu(db);
  const items = (data || []).filter((m) => m.available);
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
  const said = norm(message);
  const hits = items.filter((m) => norm(m.name) && said.includes(norm(m.name)));
  if (hits.length !== 1) { if (!hits.length) nearMiss("item_price", message); return null; }
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

// ---- fuzzy greeting: catches misspelled greetings the regexes miss ("سلام عليكو",
// "helo", "ezayk") — one edit of distance per ~4 chars, so real words like "menu"
// or dish names can never drift into a greeting. Pure code, zero LLM.
const GREETING_WORDS = [
  "hi", "hey", "hello", "yo", "hala", "ahlan", "salam", "salam 3alekom", "salam 3aleko",
  "ezayak", "ezayek", "ezayk", "good morning", "good evening", "good afternoon",
  "هاي", "اهلا", "اهلين", "هلا", "سلام", "سلام عليكم", "سلام عليكو", "السلام عليكم",
  "وعليكم السلام", "مرحبا", "ازيك", "ازيكم", "صباح الخير", "مساء الخير", "عامل ايه",
];
export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
export function isGreetingish(message) {
  const raw = String(message || "").trim();
  if (!raw || raw.length > 40) return false;
  let norm = raw
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")        // diacritics + tatweel
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه")     // hamza/teh-marbuta variants
    .replace(/(.)\1{2,}/g, "$1$1")                 // heyyyy → heyy
    .replace(/^(ال)/, "")                          // definite article
    .replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  if (!norm || norm.length < 2) return false;
  // People double a greeting for warmth — "hihi", "heyhey", "hi hi", "هلا هلا".
  // Collapse an exact repetition so it reads as the single word it is; without this
  // "hihi" missed the free greeting and cost a full model call.
  const words = norm.split(" ");
  if (words.length === 2 && words[0] === words[1]) norm = words[0];
  else if (norm.length % 2 === 0) {
    const half = norm.slice(0, norm.length / 2);
    if (half === norm.slice(norm.length / 2) && half.length >= 2) norm = half;
  }
  return GREETING_WORDS.some((w) => editDistance(norm, w) <= (w.length <= 4 ? 1 : 2));
}

// ---- MENU REQUEST: the menu is a DOCUMENT, so the model has nothing to add ----
// "menu"/"المنيو"/"el menu" used to wake the big model with the whole menu in the
// prompt, wait for JSON, then attach the PDF anyway — 3-7s on a good day, and on
// 14 Aug it hit 15s and the guest got "one sec" followed by nothing. Answering in
// code makes it instant and free, and removes the class of failure entirely.
const MENU_REQ = /^\W*(?:(?:can i get|can i see|could i get|could i see|can i|could i|may i|i want|i'd like|i need|lemme see|let me see|send|show|give|gimme|3ayez|3aiz|ana 3ayez|3awez|3awz|ab3atli|ab3tli|eb3atli|eb3at|ab3at|hatli|hatly|hat|warini|wareeni|ابعت|ابعتلي|هات|هاتلي|عايز|عاوز|ممكن|وريني|اشوف)\s+)?(?:(?:me|the|el|a|us|lw|law)\s+){0,3}(menu|menue|meno|المنيو|منيو|مينيو|المينيو|el menu|elmenu)(?:\s+(please|pls|law sama7t|من فضلك|لو سمحت|كامل|el kamel|full))?\W*$/i;

export function isMenuRequest(message) {
  const t = String(message || "").trim();
  return t.length <= 45 && MENU_REQ.test(t);
}

// Builds the whole reply in code: the line, the first-timer signature nudge (named in
// the guest's own language), and the PDF to attach. Returns null when the restaurant
// shows its menu as text or a tappable list — those paths stay where they are.
export function menuReplyFor(config, menu, message, sticky, diner) {
  const mc = config.menu_config || {};
  if (mc.display === "text" || mc.display === "list") return null;
  const l = lang(message, sticky);
  const t = (en, ar, fr) => (l === "ar" ? ar : l === "franco" ? fr : en);

  let reply = t(
    "Here's the full menu 📄 — tell me what you'd like and I'll take it from there.",
    "اتفضل المنيو الكامل 📄 — قولّي تحب إيه وأنا أظبطهالك.",
    "Etfadal el menu el kamel 📄 — 2oly te7eb eh w ana azabathalak.",
  );

  const sug = (config.ai?.suggest_dishes || []).filter(Boolean).slice(0, 3);
  const firstTimer = !diner?.name && !(diner?.visit_count > 0) && !diner?.last_visit_at;
  if (sug.length && config.ai?.suggest_enabled !== false && firstTimer) {
    const arOf = (n) => (menu || []).find((m) => m.name === n)?.name_ar || n;
    const names = sug.map((d) => `*${l === "ar" ? arOf(d) : d}*`).join(" · ");
    reply += t(
      `\n\n⭐ First time here? Try ${names} — the crowd favourite${sug.length > 1 ? "s" : ""}!`,
      `\n\n⭐ أول مرة؟ جرب ${names} — أكتر حاجة الناس بتحبها!`,
      `\n\n⭐ Awel marra? Garrab ${names} — a7la 7aga 3andena!`,
    );
  }
  return { reply, language: l, pdfUrl: mc.pdf_url || null };
}
