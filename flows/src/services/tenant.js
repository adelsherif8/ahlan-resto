// Resolves the restaurant (control plane) + its tenant DB client.
// v1: single pilot restaurant by slug (RESTAURANT_SLUG). Multi-restaurant routing by
// WhatsApp phone_number_id comes with the WhatsApp integration.
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { AHLAN_URL, AHLAN_KEY, RESTAURANT_SLUG, log } from "../config.js";

const control = AHLAN_URL ? createClient(AHLAN_URL, AHLAN_KEY) : null;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";

// AES-256-GCM, same wire format as the backend: hex(iv[12] + tag[16] + ciphertext).
// Falls back to plaintext so unencrypted rows keep working during migration.
function decryptField(value) {
  if (!value || !ENCRYPTION_KEY) return value;
  try {
    const buf = Buffer.from(value, "hex");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY, "hex"), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return value; // plaintext row
  }
}

const CACHE_MS = 60_000;

// One entry per restaurant, keyed by how it was looked up (wpid / slug / id).
// A single shared `cached` was fine for one restaurant and catastrophic for two:
// the second restaurant's messages would be answered with the first one's menu.
const tenants = new Map();

function buildTenant(data) {
  const creds = data.integrations?.supabase || {};
  if (!creds.url || !creds.key) throw new Error(`Tenant DB not configured for '${data.slug}'`);
  // schema-per-restaurant: several restaurants share ONE Supabase project, each
  // with its own schema. No schema set = the original `public` tenant.
  const schema = creds.schema ? decryptField(creds.schema) : null;
  const db = createClient(
    decryptField(creds.url),
    decryptField(creds.key),
    schema ? { db: { schema } } : undefined
  );
  return { record: data, db, config: shapeConfig(data), schema: schema || "public" };
}

async function lookup(column, value) {
  const key = `${column}:${value}`;
  const hit = tenants.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tenant;
  if (!control) throw new Error("SUPABASE_AHLAN_URL not configured");

  const { data, error } = await control.from("restaurants").select("*").eq(column, value).maybeSingle();
  if (error || !data) throw new Error(`Restaurant ${column}='${value}' not found: ${error?.message || "no row"}`);

  const tenant = buildTenant(data);
  tenants.set(key, { tenant, at: Date.now() });
  // also index it by the other keys so later lookups reuse the same client
  tenants.set(`slug:${data.slug}`, { tenant, at: Date.now() });
  tenants.set(`id:${data.id}`, { tenant, at: Date.now() });
  if (data.wpid) tenants.set(`wpid:${data.wpid}`, { tenant, at: Date.now() });
  log(`tenant resolved: ${data.name} (${data.slug}, schema ${tenant.schema})`);
  return tenant;
}

// The WhatsApp number that RECEIVED the message decides whose restaurant this is.
// An unknown number is refused, never silently served by the default restaurant —
// answering Luci'z guests with Just Smash's menu is the one failure we must make
// impossible.
export async function resolveRestaurantByWpid(wpid) {
  if (!wpid) throw new Error("no phone_number_id on the inbound message");
  try {
    return await lookup("wpid", String(wpid));
  } catch (e) {
    // Safety net: with exactly ONE restaurant on the platform there is nothing to
    // confuse it with, so a missing/stale wpid must not black out the bot. The
    // moment a second restaurant exists this fallback is disabled and an unknown
    // number is refused — correctness beats availability once mixing is possible.
    const { count } = await control.from("restaurants").select("id", { count: "exact", head: true });
    if ((count || 0) > 1) throw e;
    log(`WARN: wpid ${wpid} not matched; single-restaurant fallback to ${RESTAURANT_SLUG}. Set restaurants.wpid.`);
    return lookup("slug", RESTAURANT_SLUG);
  }
}

export async function resolveRestaurantById(id) {
  return lookup("id", id);
}

// Every restaurant on the platform — schedulers (janitor, reminders, the
// recovery/upsell/review sweeps) must run for ALL of them, not just the one
// named in RESTAURANT_SLUG, or a second restaurant silently gets no automations.
// Cached for the same CACHE_MS as single lookups. Every ops endpoint calls this, so
// an uncached version meant a `select * from restaurants` plus a fresh Supabase client
// per tenant on EVERY request — two or three times per console page load. The clients
// are reused rather than rebuilt, which is the bigger saving.
let allCache = { at: 0, list: null };
export async function resolveAllRestaurants() {
  if (!control) throw new Error("SUPABASE_AHLAN_URL not configured");
  if (allCache.list && Date.now() - allCache.at < CACHE_MS) return allCache.list;

  const { data, error } = await control.from("restaurants").select("*");
  if (error) {
    // a blip upstream must not blank out the tenant list mid-poll
    if (allCache.list) return allCache.list;
    throw new Error(error.message);
  }
  const out = [];
  for (const row of data || []) {
    try {
      // reuse the per-slug client if it's still warm, so repeat calls don't churn clients
      const hit = tenants.get(`slug:${row.slug}`);
      const tenant = hit && Date.now() - hit.at < CACHE_MS ? hit.tenant : buildTenant(row);
      tenants.set(`slug:${row.slug}`, { tenant, at: Date.now() });
      out.push(tenant);
    } catch (e) { log(`skipping ${row.slug}: ${e.message}`); }
  }
  allCache = { at: Date.now(), list: out };
  return out;
}

/**
 * One row per process start (migration 033). `railway up` deploys from a working
 * directory and carries no git metadata, so this is the only record of when the
 * running behaviour changed — the ops console marks its charts from it.
 * Fire-and-forget: a missing table must never delay or block boot.
 */
export async function recordServiceBoot(service = "flows", note = null) {
  if (!control) return;
  const env = process.env.RAILWAY_ENVIRONMENT || (process.env.NODE_ENV === "production" ? "production" : "local");
  // A developer restarting locally is not a deploy. Writing those rows buried the real
  // deploy history in noise (11 "restarts" in a week, most of them a laptop).
  // OPS_RECORD_LOCAL_BOOTS=1 opts back in if you ever want them.
  if (env === "local" && process.env.OPS_RECORD_LOCAL_BOOTS !== "1") return;
  const { error } = await control.from("service_boots").insert({ service, env, note });
  if (error) log(`service_boots unavailable (${error.message}) — run migration 033 for deploy markers`);
}

/**
 * Daily cost history (migration 039). Written while flow_executions still exists, because
 * the janitor deletes it at 14 days and this becomes the only record. Upsert on
 * (restaurant, day), so snapshotting the same day repeatedly corrects it instead of
 * duplicating it.
 */
export async function upsertCostDaily(rows) {
  if (!control || !rows.length) return { error: null };
  const { error } = await control.from("cost_daily").upsert(rows, { onConflict: "restaurant,day" });
  if (error) log(`cost_daily unavailable (${error.message}) — run migration 039 for cost history`);
  return { error: error?.message || null };
}

export async function readCostDaily({ from, to } = {}) {
  if (!control) return { rows: [], error: "control plane not configured" };
  let q = control.from("cost_daily").select("*").order("day", { ascending: false });
  if (from) q = q.gte("day", from);
  if (to) q = q.lte("day", to);
  const { data, error } = await q;
  return { rows: data || [], error: error?.message || null };
}

export async function listServiceBoots(sinceIso, limit = 60) {
  if (!control) return { rows: [], error: "control plane not configured" };
  let q = control.from("service_boots").select("id,service,started_at,env,note")
    .order("started_at", { ascending: false }).limit(limit);
  if (sinceIso) q = q.gte("started_at", sinceIso);
  const { data, error } = await q;
  return { rows: data || [], error: error?.message || null };
}

/** Drop the caches — for after a config write, so the next read is fresh. */
export function invalidateTenantCache() {
  allCache = { at: 0, list: null };
  tenants.clear();
}

export async function resolveRestaurantBySlug(slug) {
  return lookup("slug", slug);
}

export async function resolveRestaurant(wpid = null) {
  if (wpid) return resolveRestaurantByWpid(wpid);
  return lookup("slug", RESTAURANT_SLUG);
}

function shapeConfig(r) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    basic_info: r.basic_info || {},
    delivery: r.basic_info?.delivery || {}, // delivery coverage: zones/fees/toggles (services/delivery.js)
    hours: r.hours || {},
    sections: r.sections || [],
    reservation_policy: r.reservation_policy || {},
    payments: r.payments || {},
    ai: r.ai || {},
    faqs: r.faqs || [],
    menu_config: r.menu_config || {},
    pos: r.pos || {}, // cashiers, stations, promos, loyalty rule, order-code format (migration 022)
  };
}

// ---- computed hours helpers (code, never LLM) ----
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function hoursToday(hours, tz = "Africa/Cairo") {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const day = DAYS[now.getDay()];
  const ranges = hours?.[day] || [];
  const hhmm = now.toTimeString().slice(0, 5);
  const dateISO = now.toLocaleDateString("en-CA");
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  let openNow = false;
  for (const r of ranges) {
    // handle past-midnight closes (e.g. 12:00 → 01:00)
    if (r.close < r.open) {
      if (hhmm >= r.open || hhmm < r.close) openNow = true;
    } else if (hhmm >= r.open && hhmm < r.close) openNow = true;
  }
  return { day, ranges, openNow, localTime: hhmm, dateISO, weekday };
}
