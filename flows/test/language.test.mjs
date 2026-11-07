// The conversation's language, decided by code. Every scenario the founder listed,
// tested at the resolver boundary — the one place the decision is made.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveLanguage, messageEvidence, explicitRequest, conversationalText, EN, AR, FRANCO } from "../src/services/langstate.js";
import { looksFranco } from "../src/services/franco.js";

// the real Munadim/Luci'z vocabulary that must never count as language evidence
const ITEMS = [
  "Munadim Classic Burger", "Munadim Chicken Ranch", "Chicken Burger", "French Fries",
  "Munadim Fries", "Coke Zero", "Soft Drink", "Munadim Karkadeh", "Munadim Om Ali", "Water",
];
const R = (message, sticky = null) => resolveLanguage({ message, sticky, itemNames: ITEMS }).lang;

test("1 — Franco stays Franco across a whole order", () => {
  let sticky = null;
  for (const m of ["ana 3ayez burger", "zawed fries", "el total kam"]) {
    const r = resolveLanguage({ message: m, sticky, itemNames: ITEMS });
    assert.equal(r.lang, FRANCO, `"${m}" → ${r.lang} (${r.reason})`);
    sticky = r.lang;
  }
});

test("2 — Franco with English item names is still Franco", () => {
  assert.equal(R("ana 3ayez Chicken Burger w French Fries"), FRANCO);
  assert.equal(R("momken tzawed Munadim Fries"), FRANCO);
  assert.equal(R("3ayez 3 burgers"), FRANCO);
});

test("3-6 — receipt language never moves the conversation", () => {
  // the receipt is DATA: it is not part of the guest's message, so it cannot be
  // evidence. These assert the state survives the turn AFTER a receipt, where the
  // guest says something short.
  assert.equal(R("tamam", FRANCO), FRANCO);       // franco convo, arabic receipt
  assert.equal(R("ok", FRANCO), FRANCO);          // franco convo, english receipt
  assert.equal(R("تمام", AR), AR);                // arabic convo, english receipt
  assert.equal(R("ok", EN), EN);                  // english convo, arabic receipt
});

test("7 — an item name is not a language switch", () => {
  assert.equal(R("Coke Zero", FRANCO), FRANCO);
  assert.equal(R("Fries", AR), AR);
  assert.equal(R("Munadim Karkadeh", FRANCO), FRANCO);
});

test("8 — short answers keep the active language", () => {
  for (const m of ["yes", "no", "ok", "done", "👍", "3"]) {
    assert.equal(R(m, FRANCO), FRANCO, `"${m}" flipped a Franco conversation`);
  }
  for (const m of ["yes", "ok", "اه", "تمام"]) {
    assert.equal(R(m, AR), AR, `"${m}" flipped an Arabic conversation`);
  }
});

test("9-11 — explicit requests win from any state", () => {
  assert.equal(R("Reply to me in English from now on.", FRANCO), EN);
  assert.equal(R("رد عليا بالعربي", EN), AR);
  assert.equal(R("kalemny franco", AR), FRANCO);
  assert.equal(explicitRequest("answer in arabic please"), AR);
  assert.equal(explicitRequest("i want a burger"), null);
});

test("12 — a real English sentence switches the conversation", () => {
  assert.equal(R("Can you remove the fries from my order?", FRANCO), EN);
  assert.equal(R("طب شيل البطاطس", EN), AR);
});

test("13 — mixed Franco with English words stays Franco", () => {
  assert.equal(R("momken remove el fries 3ashan mesh 3ayezha"), FRANCO);
  assert.equal(R("ana 3ayez Chicken Burger bas without onions"), FRANCO);
  assert.equal(R("عايز burger بس من غير onions"), AR);
});

test("evidence is null when a message says nothing about language", () => {
  assert.equal(messageEvidence("Coke Zero", ITEMS), null);
  assert.equal(messageEvidence("👍", ITEMS), null);
  assert.equal(messageEvidence("T3", ITEMS), null);
  assert.ok(messageEvidence("ana 3ayez akol", ITEMS));
});

test("item names are stripped before judging, links and tags too", () => {
  assert.equal(conversationalText("Chicken Burger", ITEMS), "");
  assert.equal(conversationalText("[shared location] (30.1,31.4)", ITEMS).includes("location"), false);
  assert.ok(conversationalText("ana 3ayez Chicken Burger", ITEMS).includes("3ayez"));
});

test("a wordless message never changes the language", () => {
  assert.equal(R("https://maps.google.com/?q=30.02,31.49", FRANCO), FRANCO);
  assert.equal(R("[shared location]   (30.02,31.49)", AR), AR);
  assert.equal(R("", FRANCO), FRANCO);
});

test("with no history at all, the restaurant default is used", () => {
  assert.equal(resolveLanguage({ message: "Coke", itemNames: ITEMS }).lang, EN);
  assert.equal(resolveLanguage({ message: "Coke", itemNames: ITEMS, fallback: AR }).lang, AR);
});

test("switching is reported, so it can be logged", () => {
  const r = resolveLanguage({ message: "Can you remove the fries from my order?", sticky: FRANCO, itemNames: ITEMS });
  assert.equal(r.switched, true);
  const keep = resolveLanguage({ message: "ok", sticky: FRANCO, itemNames: ITEMS });
  assert.equal(keep.switched, false);
  assert.match(keep.reason, /kept/);
});

test("Arabic script always wins over anything else in the same message", () => {
  assert.equal(R("عايز 2 burger w fries", EN), AR);
  assert.equal(R("شيل el fries", FRANCO), AR);
});

test("14 — english morphology switches without a bare noun doing it", () => {
  // a short English message CAN switch when its shape is unmistakably English…
  assert.equal(R("cancelled?", FRANCO), EN);
  assert.equal(R("I'm waiting", FRANCO), EN);
  assert.equal(R("still waiting", AR), EN);
  // …while item names and yes/no answers still never do
  assert.equal(R("Coke Zero", FRANCO), FRANCO);
  assert.equal(R("fries", AR), AR);
  assert.equal(R("ok", FRANCO), FRANCO);
});

test("15 — an English greeting is English, even on an Arabic-default tenant", () => {
  // the first message is the one turn with no sticky to fall back on: if "hello there"
  // reads as no-evidence, the restaurant default answers it in Arabic and the guest
  // never gets back out, because "menu pls" carries no evidence either.
  assert.equal(resolveLanguage({ message: "hello there", sticky: null, fallback: AR }).lang, EN);
  assert.equal(resolveLanguage({ message: "hi there", sticky: null, fallback: AR }).lang, EN);
  assert.equal(resolveLanguage({ message: "good morning", sticky: null, fallback: AR }).lang, EN);
  assert.equal(resolveLanguage({ message: "thanks", sticky: null, fallback: AR }).lang, EN);
  // Franco and Arabic openers are untouched — they never read as English
  assert.equal(resolveLanguage({ message: "اهلا", sticky: null, fallback: AR }).lang, AR);
  assert.equal(resolveLanguage({ message: "sabah el kheir", sticky: null, fallback: AR }).lang, FRANCO);
  // and a bare dish name still never switches anything
  assert.equal(R("fries", AR), AR);
  // but MID-conversation "thanks"/"hi" never flip an Arabic or Franco chat to English
  assert.equal(R("thanks", AR), AR);
  assert.equal(R("hi", FRANCO), FRANCO);
  assert.equal(R("thank you!", AR), AR);
});

test("English ordinals and units are not Franco markers (an address line must not flip the language)", () => {
  assert.equal(looksFranco("Street 90, building 12, 3rd floor, New Cairo"), false);
  assert.equal(looksFranco("2nd settlement, 5km from the mall, 3pm"), false);
  assert.notEqual(messageEvidence("Street 90, building 12, 3rd floor, New Cairo")?.lang, FRANCO);
  // real Franco still reads as Franco
  assert.equal(looksFranco("3ayez wa7ed classic burger"), true);
  assert.equal(looksFranco("7elw, 2akked el order"), true);
});

test("16 — an English order made mostly of dish names is English on an Arabic-default tenant", () => {
  // Live bug: "munadim chicken ranch combo with karkadeh" had its dishes stripped down to
  // "combo with" — one function word in two tokens, read as no evidence — so the first
  // turn fell to the Arabic restaurant default and the whole order ran in Arabic. The
  // dishes are not evidence, but they still occupy places in the sentence.
  const first = (message) => resolveLanguage({ message, sticky: null, itemNames: ITEMS, fallback: AR });
  assert.equal(first("munadim chicken ranch combo with karkadeh").lang, EN);
  assert.equal(first("Chicken Burger with French Fries").lang, EN);
  assert.equal(first("2 classic burgers and a coke zero please").lang, EN);
  // the stickiness then carries the rest of the order ("pickup", "cash, now", "confirm")
  for (const m of ["pickup", "cash, now", "confirm"]) {
    assert.equal(resolveLanguage({ message: m, sticky: EN, itemNames: ITEMS, fallback: AR }).lang, EN, m);
  }
  // still: a bare dish decides nothing, and Franco / Arabic with dishes stay themselves
  assert.equal(first("Coke Zero").lang, AR);
  assert.equal(first("Munadim Chicken Ranch").lang, AR);
  assert.equal(first("ana 3ayez Munadim Chicken Ranch w Karkadeh").lang, FRANCO);
  assert.equal(first("عايز Munadim Chicken Ranch مع كركديه").lang, AR);
  assert.equal(messageEvidence("Munadim Chicken Ranch", ITEMS), null);
  assert.equal(conversationalText("munadim chicken ranch combo with karkadeh", ITEMS), "combo with");
});
