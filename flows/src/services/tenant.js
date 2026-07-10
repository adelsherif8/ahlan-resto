// Resolves the restaurant (control plane) + its tenant DB client.
// v1: single pilot restaurant by slug (RESTAURANT_SLUG). Multi-restaurant routing by
// WhatsApp phone_number_id comes with the WhatsApp integration.
import { createClient } from "@supabase/supabase-js";
import { AHLAN_URL, AHLAN_KEY, RESTAURANT_SLUG, log } from "../config.js";

const control = AHLAN_URL ? createClient(AHLAN_URL, AHLAN_KEY) : null;

let cached = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

export async function resolveRestaurant() {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  if (!control) throw new Error("SUPABASE_AHLAN_URL not configured");

  const { data, error } = await control
    .from("restaurants")
    .select("*")
    .eq("slug", RESTAURANT_SLUG)
    .single();
  if (error || !data) throw new Error(`Restaurant '${RESTAURANT_SLUG}' not found: ${error?.message}`);

  const creds = data.integrations?.supabase || {};
  if (!creds.url || !creds.key) throw new Error("Restaurant tenant DB not configured");
  // NOTE: plaintext creds for the pilot; AES decrypt (same as backend) added before restaurant #2
  const db = createClient(creds.url, creds.key);

  cached = { record: data, db, config: shapeConfig(data) };
  cachedAt = Date.now();
  log(`tenant resolved: ${data.name} (${data.slug})`);
  return cached;
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
