import test from "node:test";
import assert from "node:assert/strict";
import { missingCategoryReply } from "../src/services/fastpaths.js";

const MENU = [
  { name: "Classic Burger", name_ar: "كلاسيك برجر", category: "Burgers", available: true, ingredients: "beef, cheese, pickles" },
  { name: "Loaded Fries", name_ar: "لودد فرايز", category: "Sides", available: true },
  { name: "Soft Drink", name_ar: "مشروب غازي", category: "Drinks", available: true },
];
const COOKIE = { name: "Vanilla Cookie", name_ar: "كوكي فانيليا", category: "Desserts", available: false };
const cfg = { menu_config: {} };

test("a category we don't carry gets an honest, code-built no (EN)", () => {
  const r = missingCategoryReply("do you have desserts?", MENU, cfg);
  assert.equal(r?.category, "desserts");
  assert.match(r.reply, /^We don't have desserts — here it's /);
  assert.equal(r.language, "en");
});

test("Arabic ask, Arabic answer", () => {
  const r = missingCategoryReply("عندكم حلويات؟", MENU, cfg);
  assert.equal(r?.category, "desserts");
  assert.match(r.reply, /^مفيش حلويات عندنا/);
  assert.equal(r.language, "ar");
});

test("Franco ask, Franco answer", () => {
  const r = missingCategoryReply("fi koshary?", MENU, cfg, "franco");
  assert.equal(r?.category, "koshary");
  assert.match(r.reply, /^Mafeesh koshary 3andena/);
});

test("a category we DO carry is left to the normal path", () => {
  assert.equal(missingCategoryReply("do you have fries?", MENU, cfg), null);
  assert.equal(missingCategoryReply("عندكم برجر؟", MENU, cfg), null);
});

test("an unavailable item still counts as 'on the menu' (sold out ≠ not sold)", () => {
  // the cookie is off today, but desserts are a thing here — the host explains, not this path
  assert.equal(missingCategoryReply("do you have desserts?", [...MENU, COOKIE], cfg), null);
});

test("a compound question or an order attempt is not answered here", () => {
  assert.equal(missingCategoryReply("do you deliver to maadi and do you have desserts?", MENU, cfg), null);
  assert.equal(missingCategoryReply("one koshary extra spicy please", MENU, cfg), null);
});

test("a bare question-marked category word counts as an ask", () => {
  assert.equal(missingCategoryReply("sushi?", MENU, cfg)?.category, "sushi");
});

import { tidyNotes } from "../src/services/orderoptions.js";
test("money talk never survives as a kitchen note", () => {
  const items = [
    { name: "Classic Burger", notes: "price 0 EGP" },
    { name: "Fries", notes: "no salt · for free" },
    { name: "Wrap", notes: "extra sauce, no onion" },
    { name: "Cola", notes: "ببلاش" },
  ];
  tidyNotes(items);
  assert.equal(items[0].notes, null);
  assert.equal(items[1].notes, "no salt");
  assert.equal(items[2].notes, "extra sauce · no onion"); // tidyNotes joins parts with " · "
  assert.equal(items[3].notes, null);
});

import { arOptionWords, normName as nn } from "../src/services/orderoptions.js";
test("Arabic option words match whole words — chocolate is not a cola", () => {
  assert.doesNotMatch(arOptionWords("ضيف شوكولاته"), /cola/);
  assert.doesNotMatch(arOptionWords("ميلك شيك شوكولاتة"), /cola/);
  assert.equal(nn(arOptionWords("عايز كولا")), "coca cola");
  assert.equal(nn(arOptionWords("وكولا")), "coca cola");           // attached و
  assert.equal(nn(arOptionWords("كوكاكولا دايت")), "coca cola diet");
  assert.equal(nn(arOptionWords("بالكومبو")), "combo");              // attached بال
  assert.equal(nn(arOptionWords("حار")), "hot");
});

import { streetCore, queryVariants } from "../src/services/delivery.js";
test("villa / building numbers leave the street core intact in Arabic", () => {
  assert.equal(streetCore("شارع ابراهيم بن المهدي فيلا ١٢"), "شارع ابراهيم بن المهدي");
  assert.equal(streetCore("شارع الحسن بن الهيثم عمارة ٣"), "شارع الحسن بن الهيثم");
  assert.equal(streetCore("villa 7 street 12 next to the pharmacy"), "street 12");
  assert.ok(queryVariants("شارع ابراهيم بن المهدي فيلا ١٢").includes("ibrahim el mahdy"));
});
