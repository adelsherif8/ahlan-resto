import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ENCRYPTION_KEY ||= "00".repeat(32);
const { signTableToken, verifyTableToken, geofenceCheck, geofenceVerdict, tableSessionOf, sessionIdFor, sessionMatchesToken, widgetConfig } = await import("../src/services/tabletoken.js");

const record = {
  id: "r-kk-1", slug: "koffee-kulture",
  basic_info: { branches: [
    { key: "arkan", name: "Arkan Plaza", lat: 30.02089, lng: 31.003292 },
    { key: "uvenues", name: "U Venues", lat: null, lng: null },
  ] },
  ai: { dine_in_widget: { enabled: true, geofence_m: 120, geofence_required: true, table_token_ttl_min: 180 } },
};
const other = { ...record, id: "r-other" };

test("table token: signs and verifies; tampering, other tenant, garbage all fail", () => {
  const tok = signTableToken(record, { branch: "arkan", table: "a7" });
  assert.match(tok, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(verifyTableToken(record, tok), { branch: "arkan", table: "A7" });
  assert.equal(verifyTableToken(other, tok), null, "another restaurant's secret must not verify it");
  const [v, payload, sig] = tok.split(".");
  // flip the table inside the payload → signature no longer matches
  const forged = Buffer.from(JSON.stringify({ v: 1, b: "arkan", t: "A8", r: record.id })).toString("base64url");
  assert.equal(verifyTableToken(record, `${v}.${forged}.${sig}`), null);
  assert.equal(verifyTableToken(record, `${v}.${payload}.${sig.slice(0, -2)}xx`), null);
  assert.equal(verifyTableToken(record, "v1.nope"), null);
  assert.equal(verifyTableToken(record, ""), null);
  assert.equal(verifyTableToken(record, null), null);
});

test("geofence: inside, outside, accuracy widening, missing location, branch without coordinates", () => {
  const at = { lat: 30.02089, lng: 31.003292, accuracy: 15 };
  assert.equal(geofenceCheck(record, "arkan", at).status, "ok");
  // ~300 m east of the branch
  const near = { lat: 30.02089, lng: 31.0064, accuracy: 10 };
  const c = geofenceCheck(record, "arkan", near);
  assert.equal(c.status, "outside");
  assert.ok(c.distance_m > 250 && c.distance_m < 350, `distance ${c.distance_m}`);
  // same spot with a 100 m GPS accuracy still outside (120 + 100 < ~300); 60 m off with 80 m accuracy is inside
  assert.equal(geofenceCheck(record, "arkan", { ...near, accuracy: 100 }).status, "outside");
  const sixty = { lat: 30.02089 + 0.00054, lng: 31.003292, accuracy: 80 };
  assert.equal(geofenceCheck(record, "arkan", sixty).status, "ok");
  // accuracy is capped at 100 m — a phone claiming 5 km accuracy does not open the fence
  assert.equal(geofenceCheck(record, "arkan", { ...near, accuracy: 5000 }).status, "outside");
  assert.equal(geofenceCheck(record, "arkan", null).status, "missing");
  assert.equal(geofenceCheck(record, "arkan", { lat: "x" }).status, "missing");
  assert.equal(geofenceCheck(record, "uvenues", at).status, "unknown");
  assert.equal(geofenceCheck(record, "nowhere", at).status, "unknown");
});

test("geofence verdict: required → outside/missing block, unknown branch data never blocks; not required → always ok", () => {
  assert.equal(geofenceVerdict(record, "arkan", { lat: 30.02089, lng: 31.003292, accuracy: 20 }).geofence, "ok");
  assert.equal(geofenceVerdict(record, "arkan", null).geofence, "missing");
  assert.equal(geofenceVerdict(record, "arkan", { lat: 30.1, lng: 31.1, accuracy: 20 }).geofence, "outside");
  assert.equal(geofenceVerdict(record, "uvenues", null).geofence, "ok", "no coordinates on file → do not block on our own missing data");
  const relaxed = { ...record, ai: { dine_in_widget: { ...record.ai.dine_in_widget, geofence_required: false } } };
  assert.equal(geofenceVerdict(relaxed, "arkan", null).geofence, "ok");
  // the showroom table on a real branch is never fenced; any other table on it is
  assert.equal(geofenceVerdict(record, "arkan", null, "DEMO").geofence, "ok");
  assert.equal(geofenceVerdict(record, "arkan", null, "A7").geofence, "missing");
  assert.equal(widgetConfig(relaxed).geofenceRequired, false);
});

test("table session: valid until expiry; session id names the table and must match the token", () => {
  const future = new Date(Date.now() + 60_000).toISOString(), past = new Date(Date.now() - 60_000).toISOString();
  const ts = tableSessionOf({ preferences: { table_session: { branch: "arkan", table_number: "A7", started_at: past, expires_at: future, geofence: "ok", branch_name: "Arkan Plaza" } } });
  assert.deepEqual({ branch: ts.branch, table_number: ts.table_number, expires_at: ts.expires_at, geofence: ts.geofence, branch_name: ts.branch_name },
    { branch: "arkan", table_number: "A7", expires_at: future, geofence: "ok", branch_name: "Arkan Plaza" });
  assert.equal(tableSessionOf({ preferences: { table_session: { table_number: "A7", expires_at: future } } }).geofence, "unknown");
  assert.equal(tableSessionOf({ preferences: { table_session: { table_number: "A7", expires_at: past } } }), null);
  assert.equal(tableSessionOf({ preferences: {} }), null);
  assert.equal(tableSessionOf(null), null);
  const sid = sessionIdFor(record, "a7");
  assert.match(sid, /^web:tbl:koffee-kulture:A7:[0-9a-f]{10}$/);
  assert.equal(sessionMatchesToken(sid, record, { branch: "arkan", table: "A7" }), true);
  assert.equal(sessionMatchesToken(sid, record, { branch: "arkan", table: "A8" }), false, "a token for another table cannot drive this session");
  assert.equal(sessionMatchesToken("+201555000001", record, { branch: "arkan", table: "A7" }), false);
});
