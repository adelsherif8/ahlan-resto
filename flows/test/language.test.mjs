// The conversation's language, decided by code. Every scenario the founder listed,
// tested at the resolver boundary — the one place the decision is made.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveLanguage, messageEvidence, explicitRequest, conversationalText, EN, AR, FRANCO } from "../src/services/langstate.js";

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
});
