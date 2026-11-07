import { test } from "node:test";
import assert from "node:assert/strict";
import { nextQuestion, itemPrice } from "../src/services/orderoptions.js";

const MILK = { key: "milk", label: "Milk", optional: true, choices: [{ name: "Regular" }, { name: "Skim" }, { name: "Coconut", delta: 40 }, { name: "Oat", delta: 40 }] };
const EXTRAS = { key: "extras", label: "Extras", optional: true, choices: [{ name: "Extra shot", delta: 35 }, { name: "Lactose-free milk", delta: 35 }] };
const SIZE = { key: "size", label: "Size", required: true, choices: [{ name: "Medium", price: 125 }, { name: "Large", price: 145 }] };
const latte = (options = {}) => ({ id: "l1", name: "Iced Spanish Latte", qty: 1, price: 125, options, option_defs: [SIZE, MILK, EXTRAS] });
const menu = [{ id: "l1", name: "Iced Spanish Latte", price: 125 }];

test("optional groups are never asked; the required size still is", () => {
  const r = nextQuestion([latte()], menu, "an iced spanish latte", null);
  assert.ok(r.ask, "size must be asked");
  assert.deepEqual(r.ask.keys, ["size"]);
});

test("naming an optional choice applies it (and its price) without a question", () => {
  const r = nextQuestion([latte({ size: "Large" })], menu, "large with oat milk and an extra shot", null);
  assert.ok(!r.ask, `nothing to ask, got ${JSON.stringify(r.ask)}`);
  const it = r.items[0];
  assert.equal(it.options.milk, "Oat");
  assert.equal(it.options.extras, "Extra shot");
  assert.equal(itemPrice(it), 145 + 40 + 35);
});

test("a plain order leaves optional groups unset — the barista's default", () => {
  const r = nextQuestion([latte({ size: "Medium" })], menu, "medium", null);
  assert.ok(!r.ask);
  assert.equal(r.items[0].options.milk, undefined);
  assert.equal(itemPrice(r.items[0]), 125);
});

import { tidyNotes } from "../src/services/orderoptions.js";
test("a leftover group word is not kept as a note ('oat milk' → Oat, no stray 'milk')", () => {
  const it = { name: "Iced Spanish Latte", notes: "milk · no ice", option_defs: [SIZE, MILK, EXTRAS] };
  tidyNotes([it]);
  assert.equal(it.notes, "no ice");
});
