import test from "node:test";
import assert from "node:assert/strict";
import { assessModel, WARN_DAYS } from "../src/services/modelcheck.js";

const now = Date.parse("2026-11-01T12:00:00Z");

test("a model with no shutdown date is simply ok", () => {
  const r = assessModel("smart", "gpt-6.1-terra", { id: "gpt-6.1-terra", shutdown_date: null }, now);
  assert.equal(r.status, "ok"); assert.equal(r.ok, true); assert.equal(r.days_left, null);
});

test("a 404 / deprecated answer is RETIRED and not ok", () => {
  const r = assessModel("nano", "gpt-4.1-nano", { error: { message: "The model `gpt-4.1-nano` has been deprecated" } }, now);
  assert.equal(r.status, "retired"); assert.equal(r.ok, false); assert.match(r.error, /deprecated/);
});

test("a shutdown date in the past is RETIRED even if the lookup still answers", () => {
  const r = assessModel("nano", "gpt-4.1-nano", { shutdown_date: "2026-10-23" }, now);
  assert.equal(r.status, "retired"); assert.equal(r.ok, false); assert.ok(r.days_left < 0);
});

test("inside the warning window it is RETIRING but still ok to run", () => {
  const r = assessModel("fast", "gpt-4.1-mini", { shutdown_date: "2026-12-10" }, now);
  assert.equal(r.status, "retiring"); assert.equal(r.ok, true); assert.equal(r.days_left, 38);
  assert.ok(r.days_left <= WARN_DAYS);
});

test("the whole gpt-4.1 family (shutdown 2027-01-14) is RETIRING as of 2026-11-01", () => {
  const r = assessModel("smart", "gpt-4.1", { shutdown_date: "2027-01-14" }, now);
  assert.equal(r.status, "retiring"); assert.equal(r.ok, true); assert.equal(r.days_left, 73);
});

test("a far shutdown date is ok, with the countdown exposed", () => {
  const r = assessModel("smart", "gpt-6.1-terra", { shutdown_date: "2027-06-01" }, now);
  assert.equal(r.status, "ok"); assert.equal(r.days_left, 211);
});
