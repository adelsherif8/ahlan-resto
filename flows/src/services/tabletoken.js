// Dine-in chat widget — table identity without staff (docs/KOFFEE-KULTURE-DINE-IN.md).
//
// Two automatic checks:
//   1. the table's QR carries a SIGNED token naming branch + table (HMAC, per-tenant secret):
//      you had to be at the table to read it, and nobody can mint one for another table;
//   2. the phone's browser location must be inside the branch's geofence when an order is
//      placed (menu browsing works without it).
// A scan opens a TABLE SESSION on that phone (diner.preferences.table_session) for
// `ai.dine_in_widget.table_token_ttl_min` minutes; the order flow reads it as "dine-in,
// table X, branch Y" so the guest is never asked how they're eating or where they sit.
import crypto from "node:crypto";
import { distanceKm, branchList } from "./branches.js";

// read at call time — tools load their .env AFTER module imports are evaluated
const rootSecret = () => process.env.ENCRYPTION_KEY || process.env.TABLE_TOKEN_SECRET || "";
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(String(s), "base64url");

export const widgetConfig = (record) => ({
  enabled: record?.ai?.dine_in_widget?.enabled === true,
  ttlMin: Number(record?.ai?.dine_in_widget?.table_token_ttl_min) || 180,
  geofenceM: Number(record?.ai?.dine_in_widget?.geofence_m) || 120,
  geofenceRequired: record?.ai?.dine_in_widget?.geofence_required !== false,
  // showroom tables (the munadim.com demo frame) sit on a real branch but skip the fence
  showroomTables: (record?.ai?.dine_in_widget?.showroom_tables || ["DEMO"]).map((t) => String(t).toUpperCase()),
});

// per-tenant secret derived from the service secret — nothing extra to store or rotate
export function tenantSecret(record) {
  const secret = rootSecret();
  if (!secret) throw new Error("ENCRYPTION_KEY (or TABLE_TOKEN_SECRET) must be set for table tokens");
  return crypto.createHmac("sha256", secret).update(`table-token|${record.id}`).digest();
}

// v1.<payload>.<sig>  payload = {b: branchKey, t: tableNumber, r: restaurantId}
export function signTableToken(record, { branch, table }) {
  const payload = b64u(JSON.stringify({ v: 1, b: String(branch), t: String(table).toUpperCase(), r: record.id }));
  const sig = b64u(crypto.createHmac("sha256", tenantSecret(record)).update(payload).digest());
  return `v1.${payload}.${sig}`;
}

export function verifyTableToken(record, token) {
  const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || ""));
  if (!m) return null;
  const expected = crypto.createHmac("sha256", tenantSecret(record)).update(m[1]).digest();
  const given = unb64u(m[2]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(unb64u(m[1]).toString("utf8"));
    if (p.v !== 1 || p.r !== record.id || !p.b || !p.t) return null;
    return { branch: p.b, table: p.t };
  } catch {
    return null;
  }
}

// Where is the phone relative to the branch? `geo` = {lat, lng, accuracy} from the browser.
// Indoor GPS is 20–60 m off, so the reported accuracy (capped at 100 m) widens the fence.
export function geofenceCheck(record, branchKey, geo) {
  const cfg = widgetConfig(record);
  const branch = branchList(record).find((b) => b.key === branchKey) || null;
  if (!branch) return { status: "unknown", reason: "unknown branch" };
  if (typeof branch.lat !== "number" || typeof branch.lng !== "number") return { status: "unknown", reason: "branch has no coordinates" };
  const lat = Number(geo?.lat), lng = Number(geo?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: "missing", reason: "no location", branch: branch.name };
  const acc = Math.min(Math.max(Number(geo?.accuracy) || 0, 0), 100);
  const distanceM = Math.round(distanceKm(lat, lng, branch.lat, branch.lng) * 1000);
  const allowed = cfg.geofenceM + acc;
  return { status: distanceM <= allowed ? "ok" : "outside", distance_m: distanceM, allowed_m: allowed, branch: branch.name };
}

// What the order flow needs from a widget request: "ok" lets an order through, anything
// else refuses the PLACEMENT only (browsing and building the order still work).
export function geofenceVerdict(record, branchKey, geo, table = null) {
  const cfg = widgetConfig(record);
  const chk = geofenceCheck(record, branchKey, geo);
  if (!cfg.geofenceRequired) return { geofence: "ok", check: chk };
  if (table && cfg.showroomTables.includes(String(table).toUpperCase())) return { geofence: "ok", check: { ...chk, status: "showroom" } };
  if (chk.status === "unknown") return { geofence: "ok", check: chk }; // nothing to measure against — never block on our own missing data
  return { geofence: chk.status, check: chk };
}

// ---------- table session on the diner row ----------
export const sessionIdFor = (record, table) => `web:tbl:${record.slug}:${String(table).toUpperCase()}:${crypto.randomBytes(5).toString("hex")}`;

export function tableSessionOf(diner) {
  const s = diner?.preferences?.table_session;
  if (!s?.table_number || !s?.expires_at) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) return null;
  return { branch: s.branch || null, table_number: String(s.table_number), started_at: s.started_at, expires_at: s.expires_at,
    geofence: s.geofence || "unknown", branch_name: s.branch_name || null, distance_m: s.distance_m ?? null };
}

// The reply is produced later by the flush worker with a rebuilt ctx, so the verdict must
// live on the session, not on the request. Updated on every widget message (cheap).
export async function recordGeofence(tenant, sessionId, verdict, branchName = null) {
  const { data: d } = await tenant.db.from("diners").select("id,preferences").eq("phone_number", sessionId).maybeSingle();
  const prev = d?.preferences?.table_session;
  if (!d?.id || !prev) return null;
  const table_session = { ...prev, geofence: verdict?.geofence || "unknown", distance_m: verdict?.check?.distance_m ?? null, branch_name: branchName || prev.branch_name || null, geo_at: new Date().toISOString() };
  await tenant.db.from("diners").update({ preferences: { ...d.preferences, table_session } }).eq("id", d.id);
  return table_session;
}

export async function startTableSession(tenant, { branch, table, geoVerdict }) {
  const record = tenant.record;
  const cfg = widgetConfig(record);
  const sessionId = sessionIdFor(record, table);
  const now = new Date();
  const table_session = {
    branch, table_number: String(table).toUpperCase(),
    started_at: now.toISOString(), expires_at: new Date(now.getTime() + cfg.ttlMin * 60_000).toISOString(),
    geofence: geoVerdict?.geofence || "unknown", distance_m: geoVerdict?.check?.distance_m ?? null,
    branch_name: geoVerdict?.check?.branch || null,
  };
  const { error } = await tenant.db.from("diners").insert({
    phone_number: sessionId, name: `Table ${table_session.table_number}`, status: "customer",
    preferences: { language: record.basic_info?.language || "en", table_session, channel: "widget" },
  });
  if (error) throw new Error(`table session: ${error.message}`);
  return { sessionId, table_session };
}

// the session id itself names the table — a request must present a token for THAT table
export const sessionMatchesToken = (sessionId, record, tok) =>
  typeof sessionId === "string" && sessionId.startsWith(`web:tbl:${record.slug}:${String(tok.table).toUpperCase()}:`);
