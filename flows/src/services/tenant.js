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
export async function resolveAllRestaurants() {
  if (!control) throw new Error("SUPABASE_AHLAN_URL not configured");
  const { data, error } = await control.from("restaurants").select("*");
  if (error) throw new Error(error.message);
  const out = [];
  for (const row of data || []) {
    try { out.push(buildTenant(row)); }
    catch (e) { log(`skipping ${row.slug}: ${e.message}`); }
  }
  return out;
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
