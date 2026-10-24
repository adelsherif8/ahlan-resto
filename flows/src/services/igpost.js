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

/** Does the token we are holding allow a first comment? Checked once per process: the
 *  brief wants hashtags in the first comment, but a token without
 *  instagram_manage_comments would publish the post and then fail the comment, and the
 *  tags would be gone for good. So the caption fallback is chosen BEFORE publishing. */
let _canComment = null;
export async function canComment() {
  if (_canComment !== null) return _canComment;
  try {
    const r = await fetch(`https://graph.facebook.com/${V}/debug_token?input_token=${process.env.IG_TOKEN}&access_token=${process.env.IG_TOKEN}`);
    const scopes = (await r.json())?.data?.scopes || [];
    _canComment = scopes.includes("instagram_manage_comments");
  } catch { _canComment = false; }
  log(`ig: hashtags will go in the ${_canComment ? "first comment" : "caption (token lacks instagram_manage_comments)"}`);
  return _canComment;
}

async function firstComment(mediaId, message) {
  const r = await fetch(`https://graph.facebook.com/${V}/${mediaId}/comments`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, access_token: process.env.IG_TOKEN }),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message || `comment ${r.status}`);
  return j.id;
}

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

/** Poll a container until it is ready to publish. */
async function awaitContainer(id, token) {
  for (let i = 0; i < 60; i++) {
    const st = await graphGet(id, { fields: "status_code,status" }, token);
    if (st.status_code === "FINISHED") return;
    if (st.status_code === "ERROR") throw new Error(`container error: ${st.status}`);
    await new Promise((z) => setTimeout(z, 5000));
  }
  throw new Error("container never finished processing");
}

/** Container → wait for processing → publish. Returns the media id. */
export async function publishSlot(slot, url, caption, assets = {}) {
  const token = process.env.IG_TOKEN, ig = process.env.IG_USER_ID;

  // A carousel is built the long way: one child container per slide, then a parent
  // that holds their ids. The caption lives on the parent only.
  if (slot.type === "carousel") {
    const children = [];
    for (const slide of slot.slides || []) {
      const u = assets[slide];
      if (!u) throw new Error(`slide not uploaded: ${slide}`);
      const c = await graphPost(`${ig}/media`, { image_url: u, is_carousel_item: "true" }, token);
      await awaitContainer(c.id, token);
      children.push(c.id);
    }
    if (children.length < 2) throw new Error("a carousel needs at least 2 slides");
    const parent = await graphPost(`${ig}/media`, {
      media_type: "CAROUSEL", children: children.join(","), caption,
    }, token);
    await awaitContainer(parent.id, token);
    const out = await graphPost(`${ig}/media_publish`, { creation_id: parent.id }, token);
    return out.id;
  }

  // A story carries no caption and no sticker — the API refuses both. It is the film
  // itself, 24 hours, driving people to the reel on the grid.
  const params =
    slot.type === "reel" ? { media_type: "REELS", video_url: url, caption, share_to_feed: "true" }
    : slot.type === "story" ? { media_type: "STORIES", video_url: url }
    : { image_url: url, caption };
  const container = await graphPost(`${ig}/media`, params, token);

  await awaitContainer(container.id, token);
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
export async function publishDue({ arm = false, only = null, force = false, windowMs = 2 * 3600 * 1000 } = {}) {
  if (!process.env.IG_TOKEN || !process.env.IG_USER_ID) return { skipped: "no IG credentials" };
  const { schedule, assets } = loadPlan();
  const db = sb();
  let { ai, posted } = await readPosted(db);
  const now = cairoNow(schedule.timezone);

  const due = (only ? schedule.slots.filter(only) : schedule.slots).filter((s) => {
    if (posted[slotKey(s)]) return false;
    if (force) return true;            // named explicitly on the CLI — publish on command
    const t = new Date(`${s.date}T${s.time}:00`);
    return t <= now && now - t < windowMs;
  });

  const done = [];
  for (const s of due) {
    const url = s.type === "carousel"
      ? ((s.slides || []).every((x) => assets[x]) ? assets[s.slides[0]] : null)
      : assets[s.asset];
    if (!url) { log(`ig: skip day ${s.day} ${s.time} — ${s.pending ? "no asset made yet" : "not uploaded"}`); continue; }
    const inCaption = schedule.tagsInCaption || !(await canComment());
    const caption = inCaption && s.tags ? `${s.caption}\n\n${s.tags}` : s.caption;
    if (!arm) { done.push({ ...s, dry: true, tagsIn: inCaption ? "caption" : "first comment" }); continue; }

    // claim first — a second host that ticks mid-publish finds it taken
    posted[slotKey(s)] = { claimed_at: new Date().toISOString(), asset: s.asset };
    await writePosted(db, ai, posted);
    try {
      const media_id = await publishSlot(s, url, caption, assets);
      let comment_id = null;
      if (!inCaption && s.tags) {
        try { comment_id = await firstComment(media_id, s.tags); }
        catch (e) { log(`ig: first comment FAILED on ${media_id} — ${e.message} (post is live, tags are not)`); }
      }
      posted[slotKey(s)] = { media_id, comment_id, at: new Date().toISOString(), asset: s.asset };
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
      // Attach the poster frame, not the clip: the story is a 5-10 MB video now, and ntfy
      // shows a video as a download rather than something readable on the lock screen.
      // The poster is a still lifted from the clip with the question already on it.
      const img = assets[s.poster] || assets[s.asset];
      const imgName = assets[s.poster] ? s.poster : s.asset;
      await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: {
          Title: `Munadim day ${s.day} - ${s.kind} at ${ampm(s.time)}`,
          Priority: "default",
          Tags: "camera",
          ...(img ? { Attach: img, Filename: imgName } : {}),
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

/**
 * LinkedIn reminders. Nothing is auto-posted there — we hold no LinkedIn API access —
 * so this is purely "don't forget", with the Arabic body in the notification ready to
 * paste. Shares the stories' record so one nudge never repeats.
 */
/** Which LinkedIn days a machine can post at all. A native poll has no creation
 *  endpoint in LinkedIn's API — not through Make, not through anything — and an
 *  "active" day is engagement only, with nothing to publish. Both stay reminders. */
export const LI_AUTO = (x) => x.kind === "text" || x.kind === "video" || x.kind === "image";
export const liKey = (x) => `li-${x.day}`;
/** The video/image title LinkedIn shows: the post's own opening line, not our
 *  internal label ("the demo", "dine-in"), which is jargon and would be public. */
const liHook = (x) => (x.text || "").split("\n").map((l) => l.trim()).filter(Boolean)[0] || "";

async function readLi(db) {
  const { data } = await db.from("restaurants").select("ai").eq("slug", "munadim").single();
  return { ai: data?.ai || {}, posted: data?.ai?.li_posted || {} };
}
async function writeLi(db, posted) {
  const { data } = await db.from("restaurants").select("ai").eq("slug", "munadim").single();
  const { error } = await db.from("restaurants").update({ ai: { ...(data?.ai || {}), li_posted: posted } }).eq("slug", "munadim");
  if (error) throw new Error(`could not record the LinkedIn post: ${error.message}`);
}

/**
 * Publish the due LinkedIn days through the Make.com scenario
 * (tools/munadim-linkedin-blueprint.json), which holds the LinkedIn connection and
 * the company page. We only hand it a payload; it does the posting.
 *
 * The 2 h window is load-bearing, exactly as in publishDue: without it, arming this
 * for the first time would post every past day at once — days 1 and 3 were already
 * gone when it was wired up, and both would have landed on the page together.
 */
export async function publishLinkedInDue({ arm = false, only = null, force = false, windowMs = 2 * 3600 * 1000 } = {}) {
  const hookUrl = process.env.LINKEDIN_HOOK_URL;
  if (!hookUrl) return { skipped: "no LINKEDIN_HOOK_URL" };
  const { schedule, assets } = loadPlan();
  if (!schedule.linkedin?.length) return { due: 0, done: [] };
  const db = sb();
  let { posted } = await readLi(db);
  const now = cairoNow(schedule.timezone);

  const due = (only ? schedule.linkedin.filter(only) : schedule.linkedin).filter((x) => {
    if (!LI_AUTO(x)) return false;
    if (posted[liKey(x)]) return false;
    if (force) return true;            // named explicitly on the CLI — publish on command
    const t = new Date(`${x.date}T${x.time}:00`);
    return t <= now && now - t < windowMs;
  });

  const done = [];
  for (const x of due) {
    const media = x.video || x.image;
    const media_url = media ? assets[media] : undefined;
    if (media && !media_url) { log(`linkedin: skip day ${x.day} — ${media} is not hosted`); continue; }
    const base = { type: x.kind, text: x.text, day: x.day, hook: liHook(x), ...(media_url ? { media_url } : {}) };
    // Measured 24 Oct: the page got 65 impressions in a week and no followers. A company
    // page with no followers has no distribution; the founder's profile has the network,
    // and the copy is first-person anyway. With LINKEDIN_PERSON=1 the same post also goes
    // out as the person. Off by default: the v1 Make scenario has no `target` filter and
    // would publish both payloads to the page. Turn it on only once blueprint v2 is live.
    const targets = process.env.LINKEDIN_PERSON === "1" ? ["person", "organization"] : ["organization"];
    const payloads = targets.map((target) => ({ ...base, target }));
    const payload = payloads[0];
    if (!arm) { done.push({ ...x, payload, payloads, dry: true }); continue; }

    // claim first, same as the Instagram side: a second host ticking mid-post finds it taken
    posted[liKey(x)] = { claimed_at: new Date().toISOString(), kind: x.kind };
    await writeLi(db, posted);
    try {
      let body = "";
      for (const pl of payloads) {
        const r = await fetch(hookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pl) });
        const b = (await r.text()).slice(0, 200);
        if (!r.ok) throw new Error(`make webhook ${r.status} (${pl.target}): ${b}`);
        body += `${pl.target}:${b} `;
        // the page follows the person by a beat so the profile post is the one the network sees first
        if (payloads.length > 1 && pl !== payloads[payloads.length - 1]) await new Promise((res) => setTimeout(res, 5 * 60_000));
      }
      body = body.trim();
      posted[liKey(x)] = { at: new Date().toISOString(), kind: x.kind, response: body };
      await writeLi(db, posted);
      log(`linkedin: published day ${x.day} (${x.kind}) → ${body}`);
      done.push({ ...x, response: body });
    } catch (e) {
      delete posted[liKey(x)];
      await writeLi(db, posted).catch(() => {});
      log(`linkedin: FAILED day ${x.day} — ${e.message}`);
      done.push({ ...x, error: e.message });
    }
    ({ posted } = await readLi(db));
  }
  return { checked: schedule.linkedin.length, due: due.length, done };
}

export async function remindLinkedInDue({ send = false } = {}) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return { skipped: "no NTFY_TOPIC" };
  const { schedule } = loadPlan();
  if (!schedule.linkedin?.length) return { due: 0, sent: [] };
  const db = sb();
  const { data } = await db.from("restaurants").select("ai").eq("slug", "munadim").single();
  const ai = data?.ai || {};
  const reminded = ai.ig_reminded || {};
  const now = cairoNow(schedule.timezone);

  const due = schedule.linkedin.filter((x) => {
    const k = `li-${x.date}-${x.time}`;
    if (reminded[k]) return false;
    const t = new Date(`${x.date}T${x.time}:00`);
    return t <= now && now - t < 6 * 3600 * 1000;
  });

  const sent = [];
  for (const x of due) {
    const k = `li-${x.date}-${x.time}`;
    const body = [
      `LINKEDIN DAY ${x.day}  ·  ${ampm(x.time)}  ·  ${x.kind.toUpperCase()}`,
      ``,
      // Without this line the reminder reads as "go and post it", and a day that the
      // Make scenario already published would get posted a second time by hand.
      process.env.LINKEDIN_HOOK_URL && LI_AUTO(x)
        ? "AUTO-POSTED — do not post this by hand. Yours is the routine below."
        : "POST THIS BY HAND.",
      ``,
      x.label,
      x.video ? `\n▶ attach  igvideos/${x.video}` : "",
      x.text ? `\n${x.text}` : "",
      x.options ? `\nPoll options:\n${x.options.map((o) => `· ${o}`).join("\n")}` : "",
      x.also ? `\n— ${x.also}` : "",
    ].filter((l) => l !== "").join("\n");
    if (!send) { sent.push({ ...x, dry: true }); continue; }
    try {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: { Title: `Munadim LinkedIn day ${x.day} - ${x.kind}`, Priority: "default", Tags: "briefcase" },
        body,
      });
      reminded[k] = new Date().toISOString();
      await db.from("restaurants").update({ ai: { ...ai, ig_reminded: reminded } }).eq("slug", "munadim");
      log(`ig: linkedin reminder sent — day ${x.day} ${x.kind} (${x.date})`);
      sent.push(x);
    } catch (e) {
      log(`ig: linkedin reminder failed — ${e.message}`);
    }
  }
  return { due: due.length, sent };
}

/** Called by the flows service. Off unless IG_AUTOPOST=1, and it never throws. */
/** Pull what the account did in the last 7 days and push it to ntfy. Runs from the
 *  tick on Mondays at 09:00 Cairo, once per ISO week (recorded in ai.ig_digest).
 *  This is the measurement the whole schedule was flying without until 24 Oct. */
export async function igWeeklyDigest({ send = false, force = false } = {}) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic || !process.env.IG_TOKEN || !process.env.IG_USER_ID) return { skipped: "no ntfy/IG env" };
  const { schedule } = loadPlan();
  const now = cairoNow(schedule.timezone);
  const isoWeek = (() => { const t = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())); const dn = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dn); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, "0")}`; })();
  const db = sb();
  const { data } = await db.from("restaurants").select("ai").eq("slug", "munadim").single();
  const ai = data?.ai || {};
  if (!force) {
    if (now.getDay() !== 1 || now.getHours() !== 9) return { skipped: "not Monday 09:00" };
    if (ai.ig_digest?.[isoWeek]) return { skipped: "already sent this week" };
  }
  const G = `https://graph.facebook.com/${V}`;
  const get = async (p) => { const r = await fetch(`${G}/${p}${p.includes("?") ? "&" : "?"}access_token=${process.env.IG_TOKEN}`); return r.json(); };
  const acct = await get(`${process.env.IG_USER_ID}?fields=followers_count,media_count`);
  const media = (await get(`${process.env.IG_USER_ID}/media?fields=id,media_product_type,media_type,timestamp,caption&limit=25`)).data || [];
  const since = Date.now() - 7 * 86400000;
  const rows = [];
  for (const m of media) {
    if (new Date(m.timestamp).getTime() < since) continue;
    const isReel = m.media_product_type === "REELS";
    const ins = await get(`${m.id}/insights?metric=${isReel ? "reach,views,saved,shares,ig_reels_avg_watch_time" : "reach,views,saved,shares"}`);
    const v = Object.fromEntries((ins.data || []).map((x) => [x.name, x.values?.[0]?.value ?? x.total_value?.value]));
    rows.push({ when: m.timestamp.slice(5, 10), fmt: isReel ? "reel" : m.media_type === "CAROUSEL_ALBUM" ? "car " : "img ", cap: (m.caption || "").split("\n")[0].slice(0, 28),
      reach: v.reach ?? 0, views: v.views ?? 0, saved: v.saved ?? 0, shares: v.shares ?? 0, watch: v.ig_reels_avg_watch_time ? (v.ig_reels_avg_watch_time / 1000).toFixed(1) + "s" : "" });
  }
  rows.sort((a, b) => b.reach - a.reach);
  let split = "";
  try {
    const s30 = Math.floor((Date.now() - 30 * 86400000) / 1000);
    const bd = await get(`${process.env.IG_USER_ID}/insights?metric=reach&period=day&metric_type=total_value&breakdown=follow_type&since=${s30}`);
    const res = bd.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
    const nf = res.find((r) => r.dimension_values[0] === "NON_FOLLOWER")?.value ?? 0, f = res.find((r) => r.dimension_values[0] === "FOLLOWER")?.value ?? 0;
    split = `\n30-day reach: ${nf} non-followers · ${f} followers`;
  } catch {}
  const body = [
    `@munadim.eg · ${acct.followers_count} followers · ${rows.length} posts this week${split}`, ``,
    ...rows.map((r) => `${r.when} ${r.fmt} reach ${String(r.reach).padStart(4)} · views ${String(r.views).padStart(4)} · saves ${r.saved} · shares ${r.shares}${r.watch ? " · " + r.watch : ""}\n   ${r.cap}`),
    ``, `best by reach is first. a reel under 3s watch is a hook that did not hold.`,
  ].join("\n");
  if (!send) return { week: isoWeek, body };
  await fetch(`https://ntfy.sh/${topic}`, { method: "POST", headers: { Title: `Munadim IG week ${isoWeek}`, Tags: "bar_chart", Priority: "default" }, body });
  await db.from("restaurants").update({ ai: { ...ai, ig_digest: { ...(ai.ig_digest || {}), [isoWeek]: new Date().toISOString() } } }).eq("slug", "munadim");
  log(`ig: weekly digest sent for ${isoWeek}`);
  return { week: isoWeek, sent: true };
}

export function startIgPoster() {
  if (process.env.IG_AUTOPOST !== "1") return false;
  const tick = async () => {
    try { await publishDue({ arm: true }); }
    catch (e) { log(`ig poster tick failed (kept running): ${e.message}`); }
    try { await remindStoriesDue({ send: true }); }
    catch (e) { log(`ig story reminder tick failed (kept running): ${e.message}`); }
    try { await igWeeklyDigest({ send: true }); }
    catch (e) { log(`ig digest tick failed (kept running): ${e.message}`); }
    try { await publishLinkedInDue({ arm: true }); }
    catch (e) { log(`linkedin poster tick failed (kept running): ${e.message}`); }
    try { await remindLinkedInDue({ send: true }); }
    catch (e) { log(`linkedin reminder tick failed (kept running): ${e.message}`); }
  };
  setTimeout(tick, 20_000).unref?.();
  setInterval(tick, 5 * 60_000).unref?.();
  return true;
}
