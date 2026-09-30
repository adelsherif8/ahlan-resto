// Check Split — the arithmetic, tested on its own (node --test, no new dependency).
// The engine knows nothing about language: every case here is the SAME engine the
// English, Arabic and Franco instructions end up calling.
import test from "node:test";
import assert from "node:assert/strict";
import {
  stateFromOrder, addParticipant, findParticipant, removeParticipant,
  assignItem, unassignItem, shareItem, splitUnassigned, computeSplit,
  applyActions, divideP, proportionP, toP, lineId,
} from "../src/services/checksplit.js";

// The worked example from the brief: Omar 300, Ahmed 200, Maya 50, Fries 70.
// VAT-inclusive prices, exactly how priceOrder() builds a bill.
const ORDER = {
  code: "O-TEST", total: 620, subtotal: 620, service_charge: 0, delivery_fee: 0, tax: 76.14,
  items: [
    { name: "Burger", qty: 1, unit_price: 220 },
    { name: "Cola", qty: 1, unit_price: 80 },
    { name: "Pasta", qty: 1, unit_price: 160 },
    { name: "Water", qty: 1, unit_price: 40 },
    { name: "Maya", qty: 1, unit_price: 50 },
    { name: "Fries", qty: 1, unit_price: 70 },
  ],
};
const L = { burger: lineId(0), cola: lineId(1), pasta: lineId(2), water: lineId(3), maya: lineId(4), fries: lineId(5) };

function seeded(order = ORDER, names = ["Omar", "Ahmed"]) {
  const s = stateFromOrder(order);
  for (const n of names) addParticipant(s, n);
  return s;
}
const pid = (s, name) => findParticipant(s, name).id;
const who = (r, name) => r.participants.find((p) => p.name === name);

test("basic assignment: 300 / 200, nothing unassigned", () => {
  const s = seeded({ ...ORDER, total: 500, subtotal: 500, items: ORDER.items.slice(0, 4) });
  assignItem(s, L.burger, pid(s, "Omar"));
  assignItem(s, L.cola, pid(s, "Omar"));
  assignItem(s, L.pasta, pid(s, "Ahmed"));
  assignItem(s, L.water, pid(s, "Ahmed"));
  const r = computeSplit(s);
  assert.equal(who(r, "Omar").items, 300);
  assert.equal(who(r, "Ahmed").items, 200);
  assert.equal(r.unassignedItems, 0);
  assert.ok(r.reconciles);
});

test("unassigned items stay visible and are never silently dropped", () => {
  const s = seeded();
  assignItem(s, L.burger, pid(s, "Omar"));
  assignItem(s, L.cola, pid(s, "Omar"));
  assignItem(s, L.pasta, pid(s, "Ahmed"));
  assignItem(s, L.water, pid(s, "Ahmed"));
  const r = computeSplit(s);
  assert.equal(who(r, "Omar").items, 300);
  assert.equal(who(r, "Ahmed").items, 200);
  assert.deepEqual(r.unassigned.map((u) => u.name).sort(), ["Fries", "Maya"]);
  assert.equal(r.unassignedItems, 120);
  assert.ok(r.reconciles);
});

test("split unassigned equally: 120 → 60 each, unassigned becomes empty", () => {
  const s = seeded();
  assignItem(s, L.burger, pid(s, "Omar"));
  assignItem(s, L.cola, pid(s, "Omar"));
  assignItem(s, L.pasta, pid(s, "Ahmed"));
  assignItem(s, L.water, pid(s, "Ahmed"));
  splitUnassigned(s);
  const r = computeSplit(s);
  assert.equal(who(r, "Omar").items, 360);
  assert.equal(who(r, "Ahmed").items, 260);
  assert.equal(r.unassigned.length, 0);
  assert.equal(r.unassignedTotal, 0);
  assert.ok(r.reconciles);
});

test("receipt-level charges are shared in proportion and add up exactly", () => {
  // service 10% on 500 + a 70 delivery fee: total 620, items 500
  const order = {
    code: "O-CHG", total: 620, subtotal: 500, service_charge: 50, delivery_fee: 70, tax: 76.14,
    items: [{ name: "Burger", qty: 1, unit_price: 300 }, { name: "Pasta", qty: 1, unit_price: 200 }],
  };
  const s = seeded(order);
  assignItem(s, lineId(0), pid(s, "Omar"));
  assignItem(s, lineId(1), pid(s, "Ahmed"));
  const r = computeSplit(s);
  // 300/500 and 200/500 of the 120 in charges
  assert.equal(who(r, "Omar").total, 300 + 72);
  assert.equal(who(r, "Ahmed").total, 200 + 48);
  assert.equal(who(r, "Omar").service + who(r, "Ahmed").service, 50);
  assert.equal(who(r, "Omar").delivery + who(r, "Ahmed").delivery, 70);
  assert.equal(who(r, "Omar").total + who(r, "Ahmed").total, 620);
  assert.ok(r.reconciles);
});

test("VAT per person is the inclusive portion and sums to the receipt VAT", () => {
  const s = seeded({ ...ORDER, total: 500, subtotal: 500, tax: 61.4, items: ORDER.items.slice(0, 4) });
  assignItem(s, L.burger, pid(s, "Omar"));
  assignItem(s, L.cola, pid(s, "Omar"));
  assignItem(s, L.pasta, pid(s, "Ahmed"));
  assignItem(s, L.water, pid(s, "Ahmed"));
  const r = computeSplit(s);
  const vatSum = who(r, "Omar").vat + who(r, "Ahmed").vat;
  assert.ok(Math.abs(vatSum - 61.4) <= 0.02, `vat parts ${vatSum} vs 61.4`);
});

test("rounding: 100 between 3 people loses nothing", () => {
  const order = { code: "O-R3", total: 100, subtotal: 100, items: [{ name: "Shared", qty: 1, unit_price: 100 }] };
  const s = seeded(order, ["A", "B", "C"]);
  splitUnassigned(s);
  const r = computeSplit(s);
  const parts = r.participants.map((p) => p.totalP);
  assert.equal(parts.reduce((a, b) => a + b, 0), toP(100));
  assert.deepEqual(parts.sort((a, b) => b - a), [3334, 3333, 3333]);
  assert.ok(r.reconciles);
});

test("rounding: an odd charge over odd item shares still reconciles", () => {
  const order = {
    code: "O-ODD", total: 100.03, subtotal: 99.99, service_charge: 0.04, delivery_fee: 0,
    items: [{ name: "A", qty: 1, unit_price: 33.33 }, { name: "B", qty: 1, unit_price: 33.33 }, { name: "C", qty: 1, unit_price: 33.33 }],
  };
  const s = seeded(order, ["A", "B", "C"]);
  s.lines.forEach((l, i) => assignItem(s, l.id, s.participants[i].id));
  const r = computeSplit(s);
  assert.equal(r.participants.reduce((sum, p) => sum + p.totalP, 0), toP(100.03));
  assert.ok(r.reconciles);
});

test("removing a participant frees their items instead of deleting them", () => {
  const s = seeded();
  assignItem(s, L.burger, pid(s, "Omar"));
  removeParticipant(s, pid(s, "Omar"));
  const r = computeSplit(s);
  assert.equal(r.participants.length, 1);
  assert.ok(r.unassigned.some((u) => u.name === "Burger"));
  assert.equal(r.unassignedItems, 620 - 0 - 0 - 0); // every line is free again
  assert.ok(r.reconciles);
});

test("quantity > 1 can go to different people", () => {
  const order = { code: "O-Q", total: 100, subtotal: 100, items: [{ name: "Water", qty: 2, unit_price: 50 }] };
  const s = seeded(order);
  assignItem(s, lineId(0), pid(s, "Omar"), 1);
  assignItem(s, lineId(0), pid(s, "Ahmed"), 1);
  const r = computeSplit(s);
  assert.equal(who(r, "Omar").items, 50);
  assert.equal(who(r, "Ahmed").items, 50);
  assert.equal(r.unassignedItems, 0);
  assert.ok(r.reconciles);
});

test("a shared line splits to the piastre", () => {
  const order = { code: "O-S", total: 70, subtotal: 70, items: [{ name: "Fries", qty: 1, unit_price: 70 }] };
  const s = seeded(order, ["A", "B", "C"]);
  shareItem(s, lineId(0), s.participants.map((p) => p.id));
  const r = computeSplit(s);
  assert.equal(r.participants.reduce((sum, p) => sum + p.totalP, 0), toP(70));
  assert.ok(r.reconciles);
});

test("edge cases: one participant, nobody assigned, everything assigned", () => {
  const solo = seeded(ORDER, ["Omar"]);
  splitUnassigned(solo);
  const r1 = computeSplit(solo);
  assert.equal(r1.participants[0].total, 620);
  assert.ok(r1.reconciles);

  const none = seeded(ORDER, []);
  const r2 = computeSplit(none);
  assert.equal(r2.unassignedTotal, 620);
  assert.ok(r2.reconciles);

  const empty = seeded(ORDER);            // participants with no items
  const r3 = computeSplit(empty);
  assert.equal(r3.participants[0].total, 0);
  assert.equal(r3.unassignedTotal, 620);
  assert.ok(r3.reconciles);
});

test("actions never invent a receipt line or a phantom person", () => {
  const s = seeded(ORDER, []);
  const { applied, skipped } = applyActions(s, [
    { op: "ASSIGN_ITEM", person: "Omar", line: L.burger },   // creates Omar, assigns
    { op: "ASSIGN_ITEM", person: "Ahmed", line: "L99" },     // no such line → dropped
    { op: "NONSENSE", person: "X" },
  ]);
  assert.equal(applied.length, 1);
  assert.equal(skipped.length, 2);
  assert.equal(s.participants.length, 1);
  assert.equal(s.participants[0].name, "Omar");
  assert.ok(computeSplit(s).reconciles);
});

test("names are kept exactly as typed — Arabic stays Arabic", () => {
  const s = stateFromOrder(ORDER);
  addParticipant(s, "عمر");
  addParticipant(s, "Omar");
  assert.deepEqual(s.participants.map((p) => p.name), ["عمر", "Omar"]);
  assert.equal(findParticipant(s, "عمر").name, "عمر");
  assert.equal(findParticipant(s, "omar").name, "Omar");
});

test("the same actions from any language produce identical money", () => {
  // what the English, Arabic and Franco sentences all normalize into
  const actions = [
    { op: "ASSIGN_ITEM", person: "Omar", line: L.burger },
    { op: "ASSIGN_ITEM", person: "Omar", line: L.cola },
    { op: "ASSIGN_ITEM", person: "Ahmed", line: L.pasta },
    { op: "ASSIGN_ITEM", person: "Ahmed", line: L.water },
    { op: "SPLIT_UNASSIGNED" },
  ];
  const runs = [0, 1, 2].map(() => {
    const s = stateFromOrder(ORDER);
    applyActions(s, actions);
    return computeSplit(s);
  });
  const money = runs.map((r) => r.participants.map((p) => p.totalP).join("/"));
  assert.equal(new Set(money).size, 1, `same actions must give one result, got ${money}`);
  assert.equal(runs[0].participants.reduce((s, p) => s + p.totalP, 0), toP(620));
});

test("helpers: divideP and proportionP always re-sum", () => {
  assert.equal(Object.values(divideP(100, ["a", "b", "c"])).reduce((a, b) => a + b, 0), 100);
  assert.equal(Object.values(divideP(0, ["a"])).reduce((a, b) => a + b, 0), 0);
  const parts = proportionP(1000, { a: 333, b: 333, c: 334 });
  assert.equal(Object.values(parts).reduce((a, b) => a + b, 0), 1000);
  const zero = proportionP(500, { a: 0, b: 0 });      // no weights → equal split
  assert.equal(Object.values(zero).reduce((a, b) => a + b, 0), 500);
});
