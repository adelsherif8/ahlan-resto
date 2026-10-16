// Publishing the Munadim launch to Instagram (@munadim.eg).
//
// Shared by the CLI (tools/ig-publish.mjs) and the flows service's own timer, so both
// obey the same rules and, crucially, the same "already posted" record.
//
// That record lives in Supabase, NOT on disk: Railway's filesystem is ephemeral, so a
// redeploy would wipe a local file and the next tick would publish everything a second
// time. It is kept on the control-plane restaurants row (ai.ig_posted) — small, already
// read/written by our tooling, and shared by every host that might run a tick.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { log } from "../config.js";

const V = "v21.0";
const here = (f) => new URL(`../../tools/${f}`, import.meta.url);

const sb = () => createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
export const slotKey = (s) => `${s.day}-${s.time}`;

export function loadPlan() {
  const schedule = JSON.parse(fs.readFileSync(here("ig-schedule.json"), "utf8"));
  const assets = fs.existsSync(here("ig-assets.json"))
    ? JSON.parse(fs.readFileSync(here("ig-assets.json"), "utf8"))
    : {};
  return { schedule, assets };
}

async function readPosted(db) {
  const { data } = await db.from("restaurants").select("ai").eq("slug", "munadim").single();
  return { ai: data?.ai || {}, posted: data?.ai?.ig_posted || {} };
}
// Always re-read `ai` right before writing: publishSlot can poll a reel container for
// minutes, and a copy taken at the start of the tick would overwrite whatever changed
// on the row meanwhile (demo_mode flipped, a tester added, closed_orders set). Only the
// ig_posted key is ours.
async function writePosted(db, _ai, posted) {
  const { data } = await db.from("restaurants").select("ai").eq("slug", "munadim").single();
  const { error } = await db.from("restaurants").update({ ai: { ...(data?.ai || {}), ig_posted: posted } }).eq("slug", "munadim");
  if (error) throw new Error(`could not record the post: ${error.message}`);
}

async function graphPost(path, params, token) {
  const r = await fetch(`https://graph.facebook.com/${V}/${path}`, {
    method: "POST",
    body: new URLSearchParams({ ...params, access_token: token }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${j.error.message} (code ${j.error.code})`);
  return j;
}
async function graphGet(path, params, token) {
  const u = new URL(`https://graph.facebook.com/${V}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  const j = await (await fetch(u)).json();
  if (j.error) throw new Error(j.error.message);
  return j;
}

/** Container → wait for processing → publish. Returns the media id. */
export async function publishSlot(slot, url, caption) {
  const token = process.env.IG_TOKEN, ig = process.env.IG_USER_ID;
  const container = await graphPost(`${ig}/media`, slot.type === "reel"
    ? { media_type: "REELS", video_url: url, caption, share_to_feed: "true" }
    : { image_url: url, caption }, token);

  for (let i = 0; i < 60; i++) {
    const st = await graphGet(container.id, { fields: "status_code,status" }, token);
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR") throw new Error(`container error: ${st.status}`);
    if (i === 59) throw new Error("container never finished processing");
    await new Promise((z) => setTimeout(z, 5000));
  }
  const out = await graphPost(`${ig}/media_publish`, { creation_id: container.id }, token);
  return out.id;
}

const cairoNow = (tz) => new Date(new Date().toLocaleString("en-US", { timeZone: tz }));

/** 24h in the data (it sorts and compares cleanly), 12h everywhere a human reads it. */
export const ampm = (t) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/**
 * Publish everything whose moment has passed and that has not been published yet.
 * `arm` false reports without touching Instagram.
 * A slot is claimed in Supabase BEFORE publishing, so two hosts ticking at once cannot
 * both post it; the claim is released if the publish then fails.
 */
export async function publishDue({ arm = false, only = null, windowMs = 2 * 3600 * 1000 } = {}) {
  if (!process.env.IG_TOKEN || !process.env.IG_USER_ID) return { skipped: "no IG credentials" };
  const { schedule, assets } = loadPlan();
  const db = sb();
  let { ai, posted } = await readPosted(db);
  const now = cairoNow(schedule.timezone);

  const due = (only ? schedule.slots.filter(only) : schedule.slots).filter((s) => {
    if (posted[slotKey(s)]) return false;
    const t = new Date(`${s.date}T${s.time}:00`);
    return t <= now && now - t < windowMs;
  });

  const done = [];
  for (const s of due) {
    const url = assets[s.asset];
    if (!url) { log(`ig: skip day ${s.day} ${s.time} — ${s.pending ? "no asset made yet" : "not uploaded"}`); continue; }
    const caption = schedule.tagsInCaption ? `${s.caption}\n\n${s.tags}` : s.caption;
    if (!arm) { done.push({ ...s, dry: true }); continue; }

    // claim first — a second host that ticks mid-publish finds it taken
    posted[slotKey(s)] = { claimed_at: new Date().toISOString(), asset: s.asset };
    await writePosted(db, ai, posted);
    try {
      const media_id = await publishSlot(s, url, caption);
      posted[slotKey(s)] = { media_id, at: new Date().toISOString(), asset: s.asset };
      await writePosted(db, ai, posted);
      log(`ig: published day ${s.day} ${s.time} → ${media_id}`);
      done.push({ ...s, media_id });
    } catch (e) {
      delete posted[slotKey(s)];
      await writePosted(db, ai, posted).catch(() => {});
      log(`ig: FAILED day ${s.day} ${s.time} — ${e.message}`);
      done.push({ ...s, error: e.message });
    }
    ({ ai, posted } = await readPosted(db));
  }
  return { checked: schedule.slots.length, due: due.length, done };
}

/**
 * Story reminders over ntfy.
 *
 * Stories are NOT auto-posted: Meta's API cannot publish a poll, link or location
 * sticker, and these designs are built around one (the lower half is left empty for
 * it). So the service pushes a notification at each story's moment and Adel posts it
 * from the phone. The "already reminded" record sits beside the posted record, so a
 * redeploy cannot re-notify.
 */
export async function remindStoriesDue({ send = false } = {}) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return { skipped: "no NTFY_TOPIC" };
  const { schedule } = loadPlan();
  const db = sb();
  const { data } = await db.from("restaurants").select("ai").eq("slug", "munadim").single();
  const ai = data?.ai || {};
  const reminded = ai.ig_reminded || {};
  const now = cairoNow(schedule.timezone);

  const due = (schedule.stories || []).filter((s) => {
    const k = `${s.date}-${s.time}`;
    if (reminded[k]) return false;
    const t = new Date(`${s.date}T${s.time}:00`);
    return t <= now && now - t < 4 * 3600 * 1000;
  });

  const sent = [];
  for (const s of due) {
    const k = `${s.date}-${s.time}`;
    // The stories are instructions now, not pre-made images: reshare the day's post,
    // add a poll, run the CTA. Only a Reshare has a picture to attach.
    const body = [
      `${s.kind.toUpperCase()}  ·  ${ampm(s.time)}`,
      ``,
      s.text,
      ``,
      s.visual ? s.visual : "",
      s.kind === "CTA" ? s.link : "",
    ].filter((l) => l !== "").join("\n");
    if (!send) { sent.push({ ...s, dry: true }); continue; }
    try {
      const { assets } = loadPlan();
      const img = assets[s.asset];
      await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: {
          Title: `Munadim day ${s.day} - ${s.kind} at ${ampm(s.time)}`,
          Priority: "default",
          Tags: "camera",
          ...(img ? { Attach: img, Filename: s.asset } : {}),
        },
        body,
      });
      reminded[k] = new Date().toISOString();
      const { data: fresh } = await db.from("restaurants").select("ai").eq("slug", "munadim").single();
      await db.from("restaurants").update({ ai: { ...(fresh?.ai || ai), ig_reminded: reminded } }).eq("slug", "munadim");
      log(`ig: story reminder sent — day ${s.day} ${s.kind} ${ampm(s.time)}`);
      sent.push(s);
    } catch (e) {
      log(`ig: story reminder failed — ${e.message}`);
    }
  }
  return { due: due.length, sent };
}

/** Called by the flows service. Off unless IG_AUTOPOST=1, and it never throws. */
export function startIgPoster() {
  if (process.env.IG_AUTOPOST !== "1") return false;
  const tick = async () => {
    try { await publishDue({ arm: true }); }
    catch (e) { log(`ig poster tick failed (kept running): ${e.message}`); }
    try { await remindStoriesDue({ send: true }); }
    catch (e) { log(`ig story reminder tick failed (kept running): ${e.message}`); }
  };
  setTimeout(tick, 20_000).unref?.();
  setInterval(tick, 5 * 60_000).unref?.();
  return true;
}
