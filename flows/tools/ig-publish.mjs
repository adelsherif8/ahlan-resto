// CLI over src/services/igpost.js — same code and the same Supabase-held "already
// posted" record the flows service uses, so a local run and a Railway tick can never
// publish the same slot twice.
//
//   node tools/ig-publish.mjs --list
//   node tools/ig-publish.mjs --due            # dry
//   node tools/ig-publish.mjs --due --arm
//   node tools/ig-publish.mjs --day 1 --slot 2 --arm
//
//   node tools/ig-publish.mjs --li              # LinkedIn: what is due, dry
//   node tools/ig-publish.mjs --li --arm        # LinkedIn: publish it via the Make scenario
//   node tools/ig-publish.mjs --li-day 3 --arm  # one LinkedIn day, ignoring the 2 h window
import dotenv from "dotenv";
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
import { createClient } from "@supabase/supabase-js";
import { loadPlan, publishDue, publishLinkedInDue, LI_AUTO, slotKey, ampm } from "../src/services/igpost.js";

const arm = process.argv.includes("--arm");
const { schedule, assets } = loadPlan();

const db = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data } = await db.from("restaurants").select("ai").eq("slug", "munadim").single();
const posted = data?.ai?.ig_posted || {};

const liDayI = process.argv.indexOf("--li-day");
if (process.argv.includes("--li") || liDayI > -1) {
  const day = liDayI > -1 ? Number(process.argv[liDayI + 1]) : null;
  const r = await publishLinkedInDue({
    arm,
    only: day ? (x) => x.day === day : null,
    // --li-day is an explicit instruction about one day, so neither the freshness window
    // nor "has its time come" applies — those exist to stop an arm-up dumping the backlog
    force: !!day,
  });
  if (r.skipped) { console.log(`skipped: ${r.skipped}`); process.exit(1); }
  for (const x of r.done || []) {
    const head = `linkedin day ${String(x.day).padStart(2)} ${x.date} ${ampm(x.time)}  ${x.kind.padEnd(6)}`;
    if (x.error) console.log(`${head} FAILED — ${x.error}`);
    else if (x.dry) console.log(`${head} would send → ${JSON.stringify(x.payload).slice(0, 160)}…`);
    else console.log(`${head} sent → ${x.response}`);
  }
  const auto = (schedule.linkedin || []).filter(LI_AUTO).length;
  console.log(`\n${r.due} due · ${(r.done || []).length} handled · ${auto}/${(schedule.linkedin || []).length} days are machine-postable` +
              `${arm ? "" : "  (dry — add --arm to publish)"}`);
  process.exit(0);
}

if (process.argv.includes("--list")) {
  for (const s of schedule.slots) {
    // a carousel is ready when every slide is hosted — its own name is never a key
    const hosted = s.type === "carousel"
      ? (s.slides || []).length > 0 && (s.slides || []).every((x) => assets[x])
      : !!assets[s.asset];
    const st = posted[slotKey(s)]?.media_id ? "POSTED" : s.pending ? "no asset yet" : hosted ? "ready" : "not uploaded";
    console.log(`day ${String(s.day).padStart(2)} ${s.date} ${ampm(s.time).padStart(8)}  ${s.type.padEnd(4)}  ${String(s.asset ?? "—").padEnd(30)} ${st}`);
  }
  const ready = schedule.slots.filter((s) => !posted[slotKey(s)] &&
    (s.type === "carousel" ? (s.slides || []).every((x) => assets[x]) : assets[s.asset])).length;
  console.log(`\n${ready} ready · ${Object.values(posted).filter((p) => p.media_id).length} posted`);
  process.exit(0);
}

const di = process.argv.indexOf("--day");
let only = null;
if (di > -1) {
  const day = Number(process.argv[di + 1]);
  const si = process.argv.indexOf("--slot");
  const nth = si > -1 ? Number(process.argv[si + 1]) : null;
  const ofDay = schedule.slots.filter((s) => s.day === day);
  const want = nth ? [ofDay[nth - 1]] : ofDay;
  only = (s) => want.includes(s);
} else if (!process.argv.includes("--due")) {
  console.error("pass --due, --day N [--slot 1|2], or --list");
  process.exit(1);
}

// an explicit --day is a deliberate catch-up, so ignore the 2h due window
const r = await publishDue({ arm, only, windowMs: only ? Number.MAX_SAFE_INTEGER : undefined });
if (r.skipped) { console.log("skipped:", r.skipped); process.exit(1); }
for (const d of r.done) {
  console.log(d.error ? `FAILED day ${d.day} ${d.time} — ${d.error}`
    : d.dry ? `DRY    day ${d.day} ${d.time} ${d.type} · ${d.asset}`
    : `POSTED day ${d.day} ${d.time} ${d.type} → ${d.media_id}`);
}
if (!r.done.length) console.log("nothing due.");
if (!arm && r.done.length) console.log("\n(dry run — nothing published. add --arm.)");
