// Opening hours, next opening, Franco counts and the test-phone rule — pure code, no DB.
import test from "node:test";
import assert from "node:assert/strict";
import { nextOpening, hasHours } from "../src/services/tenant.js";
import { isTestSession } from "../src/engine/flow.js";
import { expandFrancoCounts } from "../src/services/franco.js";

const H = Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [{ open: "10:00", close: "02:00" }]]));

test("hasHours: configured vs empty", () => {
  assert.equal(hasHours(H), true);
  assert.equal(hasHours({}), false);
  assert.equal(hasHours({ notes: "x", mon: [] }), false);
});

test("nextOpening returns a real slot from the restaurant's own hours", () => {
  const n = nextOpening(H);
  assert.ok(n && n.time === "10:00", JSON.stringify(n));
  assert.ok(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].includes(n.day));
  assert.equal(nextOpening({}), null);
});

test("Franco count words become digits; Arabic and plain digits are untouched", () => {
  assert.equal(expandFrancoCounts("3ayez wa7ed chicken ranch"), "3ayez 1 chicken ranch");
  assert.equal(expandFrancoCounts("etnen classic w talata fries"), "2 classic w 3 fries");
  assert.equal(expandFrancoCounts("2 hot w wa7ed mild"), "2 hot w 1 mild");
  assert.equal(expandFrancoCounts("عايز واحد"), "عايز واحد");
  assert.equal(expandFrancoCounts("wa7edy"), "wa7edy"); // only whole words
});

test("a harness phone (nine digits after +20) is test traffic; a real mobile is not", () => {
  assert.equal(isTestSession("+2015580001"), true);
  assert.equal(isTestSession("+2015560101"), true);
  assert.equal(isTestSession("+201555000001"), true);  // the classic block, any length
  assert.equal(isTestSession("web:regress-x"), true);
  assert.equal(isTestSession("+201515066123"), false); // Munadim's own number
  assert.equal(isTestSession("+201001234567"), false);
  assert.equal(isTestSession("+966501234567"), false); // not Egypt → never guessed
  assert.equal(isTestSession("+20223456789"), false);  // a Cairo landline on WhatsApp is a real guest
  assert.equal(isTestSession("+2010123456"), false);   // short but outside the harness blocks
});
