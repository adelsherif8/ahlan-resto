// The money is pure code, so it can be fuzzed for free: random carts, random option
// choices (absolute price or delta), random fees — and the invariants a receipt must never
// break. Hundreds of carts per run, milliseconds, no model, no DB.
import test from "node:test";
import assert from "node:assert/strict";
import { priceOrder, renderBill } from "../src/services/orderbill.js";
import { itemPrice } from "../src/services/orderoptions.js";
import { stateFromOrder, addParticipant, assignItem, shareItem, splitUnassigned, computeSplit, toP } from "../src/services/checksplit.js";

// deterministic PRNG so a failure is reproducible from its seed
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const money = (n) => Math.round(n * 100) / 100;

function randomCart(r) {
  const n = 1 + Math.floor(r() * 6);
  const items = [];
  for (let i = 0; i < n; i++) {
    const price = pick(r, [45, 55, 80, 110, 140, 195, 210, 245, 265, 33.33, 99.99]);
    const defs = [];
    const options = {};
    if (r() < 0.6) {
      // a format group with ABSOLUTE prices (sandwich vs combo)
      const combo = price + pick(r, [60, 70, 75]);
      defs.push({ key: "format", choices: [{ name: "Sandwich", price }, { name: "Combo (fries + drink)", price: combo }] });
      options.format = r() < 0.5 ? "Sandwich" : "Combo (fries + drink)";
      // a drink group with no price, sometimes a DELTA add-on
      defs.push({ key: "drink", when: { format: "Combo" }, choices: [{ name: "Coca - Cola" }, { name: "Sprite" }, { name: "Munadim Karkadeh", delta: 10 }] });
      if (options.format.startsWith("Combo")) options.drink = pick(r, ["Coca - Cola", "Sprite", "Munadim Karkadeh"]);
    }
    if (r() < 0.3) { defs.push({ key: "size", choices: [{ name: "Small" }, { name: "Large", delta: 25 }] }); options.size = pick(r, ["Small", "Large"]); }
    items.push({ name: `Item ${i + 1}`, qty: 1 + Math.floor(r() * 4), price, options, option_defs: defs, notes: r() < 0.2 ? "no onion" : null });
  }
  return items;
}

function randomConfig(r) {
  const payments = {};
  if (r() < 0.5) payments.service_charge_pct = pick(r, [10, 12, 0.12]);
  if (r() < 0.7) payments.tax = pick(r, [14, 0.14]);
  if (r() < 0.3) payments.delivery_fee = pick(r, [30, 50]);
  return { payments, basic_info: { delivery: { pricing: { mode: pick(r, ["zone_fixed", "distance"]) } } } };
}

test("priceOrder: lines sum to the subtotal, extras sum to the total, VAT is inclusive — 400 random carts", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed);
    const items = randomCart(r);
    const config = randomConfig(r);
    const type = pick(r, ["dine_in", "pickup", "delivery"]);
    const quoted = type === "delivery" ? pick(r, [null, 0, 30, 45.5, 70]) : null;
    const bill = priceOrder(items, config, type, quoted, type === "delivery" ? 3.2 : null);
    const lineSum = money(items.reduce((s, it) => s + itemPrice(it) * it.qty, 0));
    assert.equal(bill.subtotal, lineSum, `seed ${seed}: subtotal ${bill.subtotal} vs lines ${lineSum}`);
    const extras = money(bill.extras.reduce((s, x) => s + x.amount, 0));
    assert.equal(bill.total, money(bill.subtotal + extras), `seed ${seed}: total ${bill.total} ≠ subtotal+extras`);
    // VAT is a breakdown of the total, never added on top
    assert.equal(money(bill.net + bill.vat), bill.total, `seed ${seed}: net+vat ≠ total`);
    assert.ok(bill.vat >= 0 && bill.vat < bill.total, `seed ${seed}: vat out of range`);
    // service only on dine-in; delivery fee only on delivery, and the QUOTED fee is billed
    if (type !== "dine_in") assert.equal(bill.service_charge, 0, `seed ${seed}: service on ${type}`);
    if (type !== "delivery") assert.equal(bill.delivery_fee, 0, `seed ${seed}: delivery fee on ${type}`);
    if (type === "delivery" && quoted != null) assert.equal(bill.delivery_fee, money(quoted), `seed ${seed}: quoted ${quoted} billed ${bill.delivery_fee}`);
    // every figure is a clean 2-dp number
    for (const v of [bill.subtotal, bill.total, bill.vat, bill.net]) assert.equal(v, money(v), `seed ${seed}: ${v} not 2dp`);
  }
});

test("renderBill: the printed Total Due is exactly bill.total, in all three languages", () => {
  for (let seed = 1; seed <= 150; seed++) {
    const r = rng(seed * 7);
    const items = randomCart(r);
    const config = randomConfig(r);
    const type = pick(r, ["dine_in", "pickup", "delivery"]);
    const bill = priceOrder(items, config, type, type === "delivery" ? 50 : null, null);
    for (const lang of ["en", "ar", "fr"]) {
      const text = renderBill({ items, bill, currency: "EGP", orderType: type, tableNumber: "T3", branchName: "Main", address: "12 Road 9", payment: "cash", code: null, lang, arName: null });
      const m = /(?:Total Due|الإجمالي المطلوب): ([\d,]+(?:\.\d+)?) EGP/.exec(text);
      assert.ok(m, `seed ${seed} ${lang}: no total line in\n${text}`);
      assert.equal(Number(m[1].replace(/,/g, "")), bill.total, `seed ${seed} ${lang}: printed ${m[1]} vs ${bill.total}`);
      // a printed line amount is always qty × unit, never the unit alone
      for (const it of items) {
        const line = text.split("\n").find((l) => l.includes(`${it.qty}× *${it.name}*`));
        assert.ok(line, `seed ${seed} ${lang}: missing line for ${it.name}`);
        assert.ok(line.includes(`${money(itemPrice(it) * it.qty).toLocaleString("en-US")} EGP`) || line.includes(`${money(itemPrice(it) * it.qty)} EGP`), `seed ${seed} ${lang}: wrong amount on ${line}`);
      }
    }
  }
});

test("check split: shares always reconcile to the receipt — 300 random splits", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed * 13);
    const items = randomCart(r).map((it) => ({ name: it.name, qty: it.qty, unit_price: itemPrice(it) }));
    const subtotal = money(items.reduce((s, it) => s + it.unit_price * it.qty, 0));
    const service = r() < 0.4 ? money(subtotal * 0.12) : 0;
    const delivery = r() < 0.3 ? 50 : 0;
    const total = money(subtotal + service + delivery);
    const order = { code: "O-FUZZ", items, subtotal, service_charge: service, delivery_fee: delivery, total, tax: money(total - total / 1.14) };
    const s = stateFromOrder(order);
    const people = 1 + Math.floor(r() * 4);
    for (let p = 0; p < people; p++) addParticipant(s, `P${p}`);
    for (const l of s.lines) {
      const roll = r();
      if (roll < 0.5) assignItem(s, l.id, s.participants[Math.floor(r() * people)].id);
      else if (roll < 0.7 && people > 1) shareItem(s, l.id, s.participants.slice(0, 1 + Math.floor(r() * people)).map((p) => p.id));
      // else left unassigned
    }
    if (r() < 0.5) splitUnassigned(s);
    const res = computeSplit(s);
    assert.ok(res.reconciles, `seed ${seed}: split does not reconcile`);
    const parts = res.participants.reduce((a, p) => a + p.totalP, 0) + toP(res.unassignedTotal || 0);
    assert.equal(parts, toP(total), `seed ${seed}: shares ${parts} vs receipt ${toP(total)}`);
    for (const p of res.participants) assert.ok(p.totalP >= 0, `seed ${seed}: negative share`);
  }
});
