// Host the schedule's assets so Instagram can fetch them: the Content Publishing API
// takes a PUBLIC URL, never a file upload. Same bucket the menu photos already live in.
//
//   node tools/ig-upload.mjs <dir> [--check]
//
// <dir> holds the files named in ig-schedule.json. --check only reports what is
// present, missing, or too small for Instagram — it uploads nothing.
import dotenv from "dotenv";
// resolve .env next to the service, not the cwd — cron runs this from anywhere
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DIR = process.argv[2];
const CHECK = process.argv.includes("--check");
if (!DIR) { console.error("usage: node tools/ig-upload.mjs <dir> [--check]"); process.exit(1); }

const PREFIX = "munadim/ig";
const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: r } = await sb.from("restaurants").select("integrations").eq("slug", "munadim").single();
const t = r.integrations.supabase;
const store = createClient(t.url, t.key).storage.from("brand");

const sched = JSON.parse(fs.readFileSync(new URL("./ig-schedule.json", import.meta.url), "utf8"));
const assets = [...new Set([...sched.slots, ...(sched.stories || [])].map((s) => s.asset).filter(Boolean))];

/** The artifact slugified the filenames; on disk they are human names with spaces,
 *  commas and apostrophes ("One receipt, two outcomes.png"). Punctuation is dropped,
 *  not turned into a dash, so "Brass 1,500+ …" slugs to "brass-1500-…". */
const slug = (s) =>
  s.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/[\s-]+/g, "-").replace(/^-|-$/g, "");

/** Walk the asset dir once and index everything by slug, so a schedule name finds its file. */
function indexFiles(dir) {
  const out = new Map();
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    files.push(path.join(e.parentPath ?? e.path ?? dir, e.name));
  }
  // ig-ready/ holds the 4:5-corrected copies; index it LAST so it wins over the original
  const corrected = (p) => /(?:^|\/)(?:ig|stories)-ready\//.test(p);
  files.sort((a, b) => Number(corrected(a)) - Number(corrected(b)));
  for (const full of files) out.set(slug(path.basename(full)), full);
  return out;
}

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Instagram upscales anything under 1080 and it goes soft — refuse rather than ship mush. */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

const index = indexFiles(DIR);
let ok = 0, missing = 0, small = 0;
const urls = {};
for (const name of assets) {
  // "g-"/"e-" are the artifact's folder markers (goodposts / editposts), not part of the name
  const want = slug(name).replace(/^[ge]-/, "");
  const p = index.get(want) ?? index.get(slug(name));
  if (!p) { console.log(`✗ MISSING   ${name}`); missing++; continue; }
  const buf = fs.readFileSync(p);
  const isVid = /\.mp4$/i.test(p);
  let label = `${(buf.length / 1024 / 1024).toFixed(2)} MB`;
  if (!isVid) {
    const d = /\.png$/i.test(p) ? pngSize(buf) : jpegSize(buf);
    if (d) {
      label = `${d.w}×${d.h}`;
      if (d.w < 1080) { console.log(`✗ TOO SMALL ${name}  ${label} — Instagram wants 1080 wide`); small++; continue; }
    }
  }
  if (CHECK) { console.log(`✓ ok        ${name}  ${label}  ← ${path.basename(p)}`); ok++; continue; }
  const ext = path.extname(p).toLowerCase();
  const dest = `${PREFIX}/${name.replace(/\.[^.]+$/, "")}${ext}`;
  const { error } = await store.upload(dest, buf, {
    contentType: ext === ".mp4" ? "video/mp4" : ext === ".png" ? "image/png" : "image/jpeg",
    upsert: true,
  });
  if (error) { console.log(`✗ UPLOAD    ${name} — ${error.message}`); continue; }
  const { data } = store.getPublicUrl(dest);
  urls[name] = data.publicUrl;
  console.log(`✓ uploaded  ${name}  ${label}`);
  ok++;
}

if (!CHECK && Object.keys(urls).length) {
  // MERGE, never replace: assets come from several directories (branding/, igvideos/),
  // so one run must not wipe the URLs written by the last one.
  const out = new URL("./ig-assets.json", import.meta.url);
  const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};
  const merged = { ...prev, ...urls };
  fs.writeFileSync(out, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nwrote ${Object.keys(urls).length} URLs (${Object.keys(merged).length} total) → tools/ig-assets.json`);
}
console.log(`\n${ok} ok · ${missing} missing · ${small} too small`);
if (missing || small) process.exit(1);
