// THE DEMO GATE — only for the Munadim showcase number.
//
// Whoever messages Munadim is a restaurant owner kicking the tyres, not a guest buying
// dinner. Adel qualifies them himself on WhatsApp — he sends a short list of fields,
// they reply, he pastes the reply into `tools/demo-lead.mjs`, and that opens a
// 24-hour window on their number. No form page, no link: the only way in is a row
// someone put there on purpose.
//
// Switched on per restaurant by `ai.demo_mode === true`, so real clients never see any
// of this. The table lives only in the Munadim schema (migration 043).
export const DEMO_HOURS = 24;
export const demoOn = (config) => config?.ai?.demo_mode === true;

/**
 * One id for a person on WhatsApp. Usually a phone — +20 111 311 1026 / 01113111026 /
 * 201113111026 are all the same one — but WhatsApp usernames exist now and some people
 * hand those over instead, so "@martinmomtaz" is a legal id too and is kept verbatim
 * (lowercased). Anything else returns "", and the caller refuses it.
 */
export function normId(v) {
  const raw = String(v || "").trim();
  if (/^@/.test(raw)) return raw.toLowerCase().replace(/\s+/g, "");
  const d = raw.replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("20")) return `+${d}`;
  if (d.startsWith("0")) return `+20${d.slice(1)}`;
  return `+${d}`;
}

/** A username is not a phone: we can store it, but we cannot match a webhook on it. */
export const isHandle = (v) => /^@/.test(String(v || "").trim());

/**
 * All-time testers: our own numbers. They skip the form and never expire, so a
 * walkthrough or a regression run is never blocked by a 24-hour clock. Anyone else
 * on the demo number still fills the form.
 */
export function isTester(config, phone) {
  const me = normId(phone);
  if (!me) return false;
  return (config?.ai?.demo_testers || []).some((raw) => {
    const entry = String(raw || "").trim();
    // a trailing "*" matches a whole block — that is how the persona fixtures
    // (+2015570xx) get through without us listing every number. It whitelists a
    // HARNESS block and never a real guest: every fixture number carries 9 digits
    // after +20 where a real Egyptian mobile carries 10, so a stranger on the demo
    // line can never slip in through a prefix someone added for the tests.
    if (entry.endsWith("*")) {
      const stem = normId(entry.slice(0, -1));
      return me.startsWith(stem) && me.replace(/^\+20/, "").length < 10;
    }
    return me === normId(entry);
  });
}

export async function getLead(db, phone) {
  // `error` is swallowed on purpose: if migration 043 hasn't run on this tenant, the
  // gate must fall through to the normal bot rather than break the conversation.
  const { data, error } = await db.from("demo_leads").select("*").eq("phone_number", phone).maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { missingTable: /does not exist|schema cache/i.test(error.message) });
  return data || null;
}

/** Created on first contact; the clock only starts when they actually submit the form. */
export async function touchLead(db, phone, patch = {}) {
  const existing = await getLead(db, phone);
  if (existing) {
    const { data } = await db.from("demo_leads").update(patch).eq("id", existing.id).select().maybeSingle();
    return data || existing;
  }
  const { data } = await db.from("demo_leads").insert({ phone_number: phone, ...patch }).select().maybeSingle();
  return data || null;
}

/**
 * Open (or re-open) a prospect's 24-hour window. Called by tools/demo-lead.mjs after
 * Adel pastes what they sent him — so `submitted_at` means "we vouched for them",
 * and the clock starts here, never at first contact.
 */
export async function addLead(db, phone, fields = {}) {
  const now = new Date();
  const expires = new Date(now.getTime() + (Number(fields.hours) || DEMO_HOURS) * 3600_000);
  const clean = (v, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : null) || null;
  return touchLead(db, normId(phone), {
    name: clean(fields.name, 60),
    business_name: clean(fields.business_name, 80),
    business_type: clean(fields.business_type, 40),
    website: clean(fields.website, 200),
    city: clean(fields.city, 60),
    branches: clean(fields.branches, 20),
    note: clean(fields.note, 300),
    submitted_at: now.toISOString(),
    started_at: now.toISOString(),
    expires_at: expires.toISOString(),
  });
}

/**
 * Parse what the prospect sent back on WhatsApp — "NAME: Martin" and friends, in any
 * order, any casing, with or without the colon's spacing. Unknown labels are kept in
 * `note` rather than dropped, because the thing they volunteered is often the useful bit.
 */
const FIELD_ALIASES = {
  name: "name", "your name": "name", اسم: "name", الاسم: "name",
  username: "phone", "whatsapp username": "phone", handle: "phone", "user name": "phone",
  phone: "phone", "phone number": "phone", number: "phone", whatsapp: "phone", mobile: "phone", رقم: "phone",
  restaurant: "business_name", "restaurant name": "business_name", business: "business_name",
  "business name": "business_name", place: "business_name", brand: "business_name", مطعم: "business_name",
  type: "business_type", "restaurant type": "business_type", "business type": "business_type", kind: "business_type",
  site: "website", url: "website", "site url": "website", website: "website", link: "website",
  instagram: "website", ig: "website", socials: "website", "site or instagram": "website",
  "website or instagram": "website", "instagram or site": "website", "social media": "website",
  city: "city", area: "city", location: "city",
  branches: "branches", "number of branches": "branches", "how many branches": "branches",
  note: "note", notes: "note", other: "note", comments: "note",
  "anything you want it to handle": "note", "what do you want it to handle": "note", anything: "note",
};

export function parseLeadBlob(text) {
  const out = { note: "" };
  const extras = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^[*_\s>-]*([^:：]{1,70})[:：]\s*(.*)$/);
    if (!m) { if (line.length > 2) extras.push(line); continue; }
    const label = m[1].replace(/\([^)]*\)/g, " ").toLowerCase().replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
    const value = m[2].trim().replace(/^[*_]+|[*_]+$/g, "");
    if (!value || /^[-–—n\/a]+$/i.test(value)) continue;
    const key = FIELD_ALIASES[label];
    if (key) out[key] = out[key] ? `${out[key]} / ${value}` : value;
    else extras.push(`${label || m[1].trim()}: ${value}`);
  }
  if (extras.length) out.note = [out.note, ...extras].filter(Boolean).join(" · ");
  if (!out.note) delete out.note;
  if (out.phone) out.phone = normId(out.phone);
  return out;
}

/**
 * Someone unknown just messaged. If Adel vouched for exactly one person by WhatsApp
 * USERNAME — the only thing they gave him — this is almost certainly them: a handle row
 * can never match a webhook, so it is a standing "let the next new number in as this
 * person". We rename the row onto their real id and they are through on the first try.
 *
 * Deliberately refuses when two handle rows are open at once: guessing which prospect
 * just knocked would hand one person's demo to another.
 */
export async function claimHandleLead(db, phone) {
  const { data } = await db.from("demo_leads").select("*")
    .like("phone_number", "@%").not("submitted_at", "is", null)
    .gt("expires_at", new Date().toISOString());
  if ((data || []).length !== 1) return null;
  const held = data[0];
  const { data: claimed } = await db.from("demo_leads")
    .update({
      phone_number: normId(phone),
      note: [held.phone_number, held.note].filter(Boolean).join(" · "),
      // the 24 hours start when they actually turn up, not when Adel typed it in
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + DEMO_HOURS * 3600_000).toISOString(),
    })
    // conditional on the row STILL being the handle: two unknown numbers arriving in
    // the same second must not both "win" it — the second update matches 0 rows
    .eq("id", held.id).eq("phone_number", held.phone_number).select().maybeSingle();
  return claimed || null;
}

export function leadState(lead) {
  if (!lead?.submitted_at) return "new";
  return new Date(lead.expires_at).getTime() > Date.now() ? "active" : "expired";
}

export const hoursLeft = (lead) =>
  Math.max(0, Math.ceil((new Date(lead?.expires_at || 0).getTime() - Date.now()) / 3600_000));

// ---- the three things the bot says ------------------------------------------------
// Code-written in all three languages, like every other pipeline line.
const L = (lang, en, ar, fr) => (lang === "ar" ? ar : lang === "franco" || lang === "fr" ? fr : en);

/**
 * Someone we have not vouched for messaged the demo number. We do not serve them — the
 * menu, the prices and the bot's time are a sales asset, not a sandbox — but we never
 * leave them staring at silence either.
 */
export const notRegistered = (lang, contact = "") => L(lang,
  `Hi 👋 This is the Munadim demo line — it's open by invite while we're in private beta.\n\n`
  + `Message Adel and he'll switch it on for your number in a minute${contact ? ` — ${contact}` : ""}.`,
  `أهلاً 👋 ده خط الديمو بتاع مُنادم — شغال بالدعوة بس دلوقتي.\n\n`
  + `كلّم عادل وهيفتحهولك على رقمك في دقيقة${contact ? ` — ${contact}` : ""}.`,
  `Ahlan 👋 da khat el demo beta3 Munadim — sha3'al bel da3wa bas delwa2ty.\n\n`
  + `Kallem Adel w hayefta7hoolak 3ala ra2amak fe de2ee2a${contact ? ` — ${contact}` : ""}.`);

// the name is optional on the form, so it must never leave a gap in the greeting
const who = (lead) => (lead?.name ? ` ${lead.name}` : "");

// The one message that decides whether they actually test it: it has to tell them to
// stop being a founder and start being a customer, and give them four concrete things
// to try. Vague permission ("try anything!") gets a demo nobody uses.
export const welcomeBack = (lang, lead) => L(lang,
  `You're in${who(lead)} 🙌 The demo is open for the next ${hoursLeft(lead)} hours.\n\n`
  + `Talk to it exactly like one of your customers would — English, Arabic or Franco, it follows you.\n\n`
  + `Try this:\n`
  + `• Ask it something — "what's your bestseller?" or "is the chicken spicy?"\n`
  + `• Order — "2 classic burgers, one hot" — then say *confirm*\n`
  + `• After you order, say *split the check*\n`
  + `• Ask for delivery to your address, or a table for 4 tonight\n\n`
  + `Try to catch it out — that's the point. After ${hoursLeft(lead)} hours it stops and Adel follows up.`,

  `تمام${who(lead)} 🙌 الديمو شغال عندك ${hoursLeft(lead)} ساعة من دلوقتي.\n\n`
  + `كلّمه زي ما أي زبون هيكلّمه بالظبط — عربي، إنجليزي أو فرانكو، هو ماشي معاك.\n\n`
  + `جرّب كده:\n`
  + `• اسأله حاجة — «إيه أكتر حاجة بتتطلب؟» أو «الفراخ حراق؟»\n`
  + `• اطلب — «٢ كلاسيك برجر واحد حراق» — وبعدين قول *تأكيد*\n`
  + `• وبعد ما تطلب قول *اقسم الحساب*\n`
  + `• اطلب دليفري على عنوانك، أو ترابيزة لـ٤ النهاردة\n\n`
  + `وحاول توقّعه — دي الفكرة. بعد الـ${hoursLeft(lead)} ساعة هيقف وعادل هيكلّمك.`,

  `Tamam${who(lead)} 🙌 el demo sha3'al 3andak ${hoursLeft(lead)} sa3a men delwa2ty.\n\n`
  + `Kallemo bel zabt zay ay zaboon haykallemo — 3araby, English aw franco, howa mashy ma3ak.\n\n`
  + `Garrab keda:\n`
  + `• Es2alo 7aga — "eh aktar 7aga betettelb?" aw "el ferakh 7arra2?"\n`
  + `• Otlob — "2 classic burger wa7ed 7arra2" — w ba3den 2ol *akked*\n`
  + `• W ba3d ma totlob 2ol *2asem el 7esab*\n`
  + `• Otlob delivery 3ala 3enwanak, aw tarabeza le 4 ennaharda\n\n`
  + `W 7awel to2a3o — di el fekra. Ba3d el ${hoursLeft(lead)} sa3a hayo2af w Adel haykallemak.`);

export const expired = (lang, contact = "") => L(lang,
  `Your ${DEMO_HOURS}-hour demo has finished 🙏 Hope it showed you what it can do.\n\n`
  + `Adel can set this up with your own menu and switch it on for your number${contact ? ` — ${contact}` : ""}.`,
  `خلصت الـ${DEMO_HOURS} ساعة بتاعة الديمو 🙏 يا رب تكون شوفت اللي بيعمله.\n\n`
  + `عادل يقدر يظبطهولك بالمنيو بتاعك ويشغله على رقمك${contact ? ` — ${contact}` : ""}.`,
  `Khelset el ${DEMO_HOURS} sa3a beta3t el demo 🙏 yarab tekoon shoft elly bye3melo.\n\n`
  + `Adel ye2dar yezabathalak bel menu beta3ak w yesha3'alo 3ala ra2amak${contact ? ` — ${contact}` : ""}.`);
