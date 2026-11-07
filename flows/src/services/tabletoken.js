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
  // test tables: real in every way (claims, join code, limits) except the location fence — for
  // scanning a printed/on-screen code away from the café during testing
  testTables: (record?.ai?.dine_in_widget?.test_tables || []).map((t) => String(t).toUpperCase()),
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
  if (table && cfg.testTables.includes(String(table).toUpperCase())) return { geofence: "ok", check: { ...chk, status: "test" } };
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
    // no name: "Table 5" read as a person's name ("Welcome back, Table!"); the table lives in table_session
    phone_number: sessionId, name: null, status: "customer",
    preferences: { language: record.basic_info?.language || "en", table_session, channel: "widget" },
  });
  if (error) throw new Error(`table session: ${error.message}`);
  return { sessionId, table_session };
}

// the session id itself names the table — a request must present a token for THAT table
export const sessionMatchesToken = (sessionId, record, tok) =>
  typeof sessionId === "string" && sessionId.startsWith(`web:tbl:${record.slug}:${String(tok.table).toUpperCase()}:`);

// ======================= table claims (one visit owns a table) =======================
// docs/KOFFEE-KULTURE-DINE-IN.md §2. GPS can't tell table 5 from table 7, so the TABLE itself
// is owned: the first phone to scan owns it for the visit; table-mates join with the 4-digit
// code shown on the owner's screen; a guest who sits down and finds their table already
// claimed taps "that's not my table" — the claim is released, the counter is told, and they
// own it. Claims end 90 min after the last activity, or once every order on them is paid/closed.
export const CLAIM_IDLE_MIN = 90;
export const MAX_ORDERS_PER_SESSION = 4;
export const MIN_SECONDS_BEFORE_ORDER = 8;
const DISPUTES_PER_DEVICE_PER_DAY = 1;

export const isShowroom = (record, table) => widgetConfig(record).showroomTables.includes(String(table).toUpperCase());
const code4 = () => String(crypto.randomInt(0, 10000)).padStart(4, "0");
const minsFromNow = (m) => new Date(Date.now() + m * 60_000).toISOString();

// is the claim still the live visit? (released, idle past expiry, or every order paid/closed → no).
// SERVED is not the end of a visit: guests stay for dessert, another round, a tip, the bill.
async function claimIsLive(db, claim) {
  if (!claim || claim.released_at) return false;
  if (new Date(claim.expires_at).getTime() < Date.now()) return false;
  const { data: orders } = await db.from("orders").select("status,payment_status,created_at")
    .eq("table_number", claim.table_number).gte("created_at", claim.claimed_at).limit(50);
  const mine = orders || [];
  if (mine.length && mine.every((o) => o.payment_status === "paid" || ["completed", "cancelled", "closed"].includes(String(o.status)))) return false;
  return true;
}

// a resumed session must still have a live table session (it expires after the TTL)
async function sessionAlive(db, sessionId) {
  const { data: d } = await db.from("diners").select("preferences").eq("phone_number", sessionId).maybeSingle();
  const runAs = d?.preferences?.linked_phone;
  if (runAs) { const { data: p } = await db.from("diners").select("preferences").eq("phone_number", runAs).maybeSingle(); return !!tableSessionOf(p); }
  return !!tableSessionOf(d);
}

export async function loadClaim(db, table) {
  const { data } = await db.from("widget_claims").select("*").eq("table_number", String(table).toUpperCase()).maybeSingle();
  return data || null;
}

export async function liveClaim(db, table) {
  const c = await loadClaim(db, table);
  return (await claimIsLive(db, c)) ? c : null;
}

async function writeClaim(db, table, branch, ownerSession) {
  const row = {
    table_number: String(table).toUpperCase(), branch, owner_session: ownerSession, members: [], join_code: code4(),
    claimed_at: new Date().toISOString(), last_activity_at: new Date().toISOString(), expires_at: minsFromNow(CLAIM_IDLE_MIN),
    released_at: null, release_reason: null, flagged: false,
  };
  const { error } = await db.from("widget_claims").upsert(row, { onConflict: "table_number" });
  if (error) throw new Error(`claim: ${error.message}`);
  return row;
}

export const claimHas = (claim, sessionId) => !!claim && (claim.owner_session === sessionId || (claim.members || []).includes(sessionId));

export async function touchClaim(db, table) {
  const c = await loadClaim(db, table);
  if (!c || c.released_at) return;
  await db.from("widget_claims").update({ last_activity_at: new Date().toISOString(), expires_at: minsFromNow(CLAIM_IDLE_MIN) }).eq("table_number", c.table_number);
}

// The whole scan decision. Returns { status: "owner"|"member"|"claimed"|"bad_code"|"dispute_limit", ... }
export async function claimForScan(tenant, { branch, table, geoVerdict, resumeSessionId = null, joinCode = null, notMine = false, deviceId = null, notify = null }) {
  const db = tenant.db;
  const T = String(table).toUpperCase();
  if (isShowroom(tenant.record, T)) {
    // the website demo table: every visitor gets their own private visit, no claims
    if (resumeSessionId && sessionMatchesToken(resumeSessionId, tenant.record, { table: T }) && (await sessionAlive(db, resumeSessionId))) return { status: "owner", sessionId: resumeSessionId, showroom: true };
    const s = await startTableSession(tenant, { branch, table: T, geoVerdict });
    return { status: "owner", sessionId: s.sessionId, table_session: s.table_session, showroom: true };
  }
  const claim = await liveClaim(db, T);
  // returning phone that is already part of the live visit
  if (claim && resumeSessionId && claimHas(claim, resumeSessionId) && (await sessionAlive(db, resumeSessionId))) {
    return { status: claim.owner_session === resumeSessionId ? "owner" : "member", sessionId: resumeSessionId, join_code: claim.owner_session === resumeSessionId ? claim.join_code : null };
  }
  if (!claim) {
    const s = await startTableSession(tenant, { branch, table: T, geoVerdict });
    const c = await writeClaim(db, T, branch, s.sessionId);
    return { status: "owner", sessionId: s.sessionId, table_session: s.table_session, join_code: c.join_code };
  }
  if (joinCode) {
    if (String(joinCode).trim() !== claim.join_code) return { status: "bad_code" };
    const s = await startTableSession(tenant, { branch, table: T, geoVerdict });
    await db.from("widget_claims").update({ members: [...(claim.members || []), s.sessionId], last_activity_at: new Date().toISOString(), expires_at: minsFromNow(CLAIM_IDLE_MIN) }).eq("table_number", T);
    return { status: "member", sessionId: s.sessionId, table_session: s.table_session };
  }
  if (notMine) {
    // one dispute per device per day — a troll can't ping-pong a real table off its seat
    if (deviceId && !(await allowDispute(db, deviceId))) return { status: "dispute_limit" };
    const s = await startTableSession(tenant, { branch, table: T, geoVerdict });
    const c = await writeClaim(db, T, branch, s.sessionId);
    await db.from("widget_claims").update({ flagged: true, disputes: (claim.disputes || 0) + 1 }).eq("table_number", T);
    if (notify) await notify(T, claim).catch(() => {});
    return { status: "owner", sessionId: s.sessionId, table_session: s.table_session, join_code: c.join_code, disputed: true };
  }
  return { status: "claimed", since: claim.claimed_at };
}

// dispute budget lives on a tiny diner-less row keyed by device in the claims table's sibling
// store — reuse diners (phone_number = "dev:<id>") so no extra table is needed
async function allowDispute(db, deviceId) {
  const key = `dev:${String(deviceId).slice(0, 40)}`;
  const { data: d } = await db.from("diners").select("id,preferences").eq("phone_number", key).maybeSingle();
  const today = new Date().toISOString().slice(0, 10);
  const used = d?.preferences?.disputes?.[today] || 0;
  if (used >= DISPUTES_PER_DEVICE_PER_DAY) return false;
  const preferences = { ...(d?.preferences || {}), disputes: { [today]: used + 1 } };
  if (d?.id) await db.from("diners").update({ preferences }).eq("id", d.id);
  else await db.from("diners").insert({ phone_number: key, name: "device", status: "lead", preferences });
  return true;
}

// can this request still act on the table? (showroom: always; real tables: must be in the live claim)
export async function sessionStillHolds(tenant, table, sessionId) {
  if (isShowroom(tenant.record, table)) return true;
  const c = await liveClaim(tenant.db, table);
  if (c) return claimHas(c, sessionId);
  // no live claim: the visit ended on its own (paid / idle) — the people who were in it may keep
  // chatting; only a DIFFERENT live claim means someone else has the table now
  const raw = await loadClaim(tenant.db, table);
  return !raw || claimHas(raw, sessionId);
}

// a guest from an ended visit orders again → the table is theirs again (same table-mates)
export async function reclaimIfFree(tenant, table, branch, sessionId) {
  if (isShowroom(tenant.record, table)) return;
  if (await liveClaim(tenant.db, table)) return;
  const raw = await loadClaim(tenant.db, table);
  const row = await writeClaim(tenant.db, table, branch, raw && claimHas(raw, sessionId) ? raw.owner_session : sessionId);
  if (raw && claimHas(raw, sessionId) && raw.members?.length) await tenant.db.from("widget_claims").update({ members: raw.members, join_code: raw.join_code }).eq("table_number", row.table_number);
}

// ======================= guest identity (remember them like WhatsApp does) =======================
// The guest proves the phone by SENDING a one-time code from WhatsApp to our number (wa.me link) —
// no template needed, and it opens the 24h window. After that the table chat runs as that phone:
// name, history, "your usual", loyalty — everything the WhatsApp bot knows.
const pendingVerify = new Map(); // code → { slug, sessionId, exp }
setInterval(() => { const now = Date.now(); for (const [k, v] of pendingVerify) if (v.exp < now) pendingVerify.delete(k); }, 60_000).unref?.();

export function startVerify(slug, sessionId) {
  let code; do { code = String(crypto.randomInt(100000, 1000000)); } while (pendingVerify.has(code));
  pendingVerify.set(code, { slug, sessionId, exp: Date.now() + 10 * 60_000 });
  return code;
}
export const VERIFY_RE = /^\s*(?:KK|TABLE)[-\s]?VERIFY\s+(\d{6})\s*$/i;
export function takeVerify(code) {
  const v = pendingVerify.get(String(code));
  if (!v || v.exp < Date.now()) return null;
  pendingVerify.delete(String(code));
  return v;
}

// signed "remember me" token for the browser — proves a phone was verified on this device
export function guestToken(record, phone) {
  const p = b64u(JSON.stringify({ p: phone, r: record.id }));
  return `g1.${p}.${b64u(crypto.createHmac("sha256", tenantSecret(record)).update(`guest|${p}`).digest())}`;
}
export function verifyGuestToken(record, tok) {
  const m = /^g1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(tok || ""));
  if (!m) return null;
  const exp = crypto.createHmac("sha256", tenantSecret(record)).update(`guest|${m[1]}`).digest();
  const got = unb64u(m[2]);
  if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return null;
  try { const v = JSON.parse(unb64u(m[1]).toString("utf8")); return v.r === record.id && (/^\+\d{8,15}$/.test(v.p) || GUEST_KEY_RE.test(v.p)) ? v.p : null; } catch { return null; }
}

// "remember me on this phone" — no number, no WhatsApp hop: the guest gives a first name, we mint a
// device guest key (gst:…) and the signed token in the browser IS the identity. Same diner-row
// machinery as a verified phone, so name, history and "my usual" all work on the next visit.
export const GUEST_KEY_RE = /^gst:[a-f0-9]{20}$/;
export const cleanGuestName = (n) => String(n || "").replace(/[^\p{L}\p{M}' -]/gu, "").replace(/\s+/g, " ").trim().slice(0, 30);
export async function rememberDevice(tenant, widgetSessionId, rawName) {
  const name = cleanGuestName(rawName);
  if (!name) return null;
  const db = tenant.db;
  const current = await effectiveSession(db, widgetSessionId);
  if (current !== widgetSessionId) { // already linked — just keep the name current
    await db.from("diners").update({ name }).eq("phone_number", current);
    return current;
  }
  const key = `gst:${crypto.randomBytes(10).toString("hex")}`;
  await linkPhone(tenant, widgetSessionId, key, name);
  // this visit's orders and rating move with them, so "my usual" works next time
  await db.from("orders").update({ phone_number: key }).eq("phone_number", widgetSessionId).then(() => {}, () => {});
  await db.from("feedback").update({ phone_number: key }).eq("phone_number", widgetSessionId).then(() => {}, () => {});
  return key;
}

// link a widget session to a verified phone: the phone's diner row gets the table session,
// so every later message runs as that guest
export async function linkPhone(tenant, widgetSessionId, phone, profileName = null) {
  const db = tenant.db;
  const { data: w } = await db.from("diners").select("id,preferences").eq("phone_number", widgetSessionId).maybeSingle();
  if (!w?.id) return null;
  const ts = w.preferences?.table_session || null;
  const { data: p } = await db.from("diners").select("id,name,preferences").eq("phone_number", phone).maybeSingle();
  if (p?.id) {
    await db.from("diners").update({ preferences: { ...(p.preferences || {}), table_session: ts }, ...(profileName && !p.name ? { name: profileName } : {}) }).eq("id", p.id);
  } else {
    await db.from("diners").insert({ phone_number: phone, name: profileName || null, status: "customer", preferences: { language: w.preferences?.language || "en", table_session: ts } });
  }
  await db.from("diners").update({ preferences: { ...(w.preferences || {}), linked_phone: phone } }).eq("id", w.id);
  return phone;
}

// the identity a widget request runs as: the verified phone when linked, else the session itself
export async function effectiveSession(db, widgetSessionId) {
  const { data: w } = await db.from("diners").select("preferences").eq("phone_number", widgetSessionId).maybeSingle();
  return w?.preferences?.linked_phone || widgetSessionId;
}

export async function guestProfile(db, phone) {
  const { data: d } = await db.from("diners").select("name,visit_count").eq("phone_number", phone).maybeSingle();
  const { data: o } = await db.from("orders").select("items,status").eq("phone_number", phone).order("created_at", { ascending: false }).limit(5);
  // "your usual" = the last order that wasn't cancelled, as the guest would say it — computed, never guessed
  const last = (o || []).find((x) => x.status !== "cancelled" && Array.isArray(x.items) && x.items.length);
  const usual = last ? last.items.slice(0, 6).map((i) => ({ name: i.name, qty: Number(i.qty) || 1,
    options: Object.values(i.options || {}).flat().map((v) => (typeof v === "string" ? v : v?.name)).filter((v) => v && !/^(regular|classic|as is|no dip)$/i.test(v)),
    note: i.notes || null })) : null;
  return { name: d?.name || null, has_history: !!o?.length, usual };
}

// ======================= menu time windows =======================
// menu_items.available_from / available_to ("07:30", "12:00") — breakfast-only dishes are
// neither offered nor accepted outside their window. Cairo time; a window may wrap midnight.
export function inServiceWindow(item, now = new Date()) {
  const f = item?.available_from, t = item?.available_to;
  if (!f || !t) return true;
  const toMin = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(v)); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const a = toMin(f), b = toMin(t);
  if (a == null || b == null) return true;
  const c = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  const n = c.getHours() * 60 + c.getMinutes();
  return a <= b ? n >= a && n < b : n >= a || n < b;
}
