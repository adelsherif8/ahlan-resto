// Table QR codes for the dine-in chat widget — one signed token per table, printed once.
//
//   node tools/make-table-qr.mjs --slug koffee-kulture --branch arkan --tables A1-A12 [--base https://flows.munadim.com] [--out branding/qr/koffee]
//   node tools/make-table-qr.mjs --slug munadim --branch point90 --tables T1-T10 --base http://localhost:5143
//
// Writes <out>/<branch>-<table>.svg (+ a printable sheet.html) and prints each URL. The token
// is an HMAC over branch+table with the tenant's derived secret (services/tabletoken.js), so a
// code can't be edited to point at another table; it never expires — the SESSION a scan opens
// does (ai.dine_in_widget.table_token_ttl_min).
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";
import { signTableToken } from "../src/services/tabletoken.js";

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const SLUG = arg("slug"), BRANCH = arg("branch"), TABLES = arg("tables"), BASE = (arg("base") || process.env.PUBLIC_BASE || "http://localhost:5099").replace(/\/$/, "");
const OUT = arg("out") || path.join(process.cwd(), "..", "branding", "qr", SLUG || "tables");
if (!SLUG || !BRANCH || !TABLES) { console.error("usage: --slug <slug> --branch <key> --tables A1-A12|A1,A2,B3 [--base url] [--out dir]"); process.exit(1); }

const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: record, error } = await sb.from("restaurants").select("id,slug,name,basic_info,ai").eq("slug", SLUG).single();
if (error || !record) throw new Error(`restaurant ${SLUG}: ${error?.message || "not found"}`);
const branch = (record.basic_info?.branches || []).find((b) => b?.key === BRANCH);
if (!branch) throw new Error(`branch "${BRANCH}" not in ${SLUG}.basic_info.branches (${(record.basic_info?.branches || []).map((b) => b.key).join(", ")})`);
if (typeof branch.lat !== "number") console.warn(`⚠ branch ${BRANCH} has no coordinates — the geofence will not be enforced for it until basic_info.branches[].lat/lng are set`);

// "A1-A12" → A1..A12 ; "A1,A2,B7" → as given
function expand(spec) {
  const m = /^([A-Za-z]*)(\d+)-([A-Za-z]*)(\d+)$/.exec(spec);
  if (m && (m[1] === m[3] || !m[3])) return Array.from({ length: Number(m[4]) - Number(m[2]) + 1 }, (_, i) => `${m[1].toUpperCase()}${Number(m[2]) + i}`);
  return spec.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}
const tables = expand(TABLES);
fs.mkdirSync(OUT, { recursive: true });
const primary = record.basic_info?.brand?.primary || "#222";
const cards = [];
for (const t of tables) {
  const token = signTableToken(record, { branch: BRANCH, table: t });
  const url = `${BASE}/t/${token}?r=${encodeURIComponent(SLUG)}`;
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#15181a", light: "#ffffff" } });
  const file = path.join(OUT, `${BRANCH}-${t}.svg`);
  fs.writeFileSync(file, svg);
  cards.push({ t, url, svg });
  console.log(`${t}\t${url}`);
}
// a printable sheet: 6 cards per A4 page, brand colour, table number big enough to read across the room
const sheet = `<!doctype html><meta charset="utf-8"><title>${record.name} — table QR codes (${branch.name})</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:12mm;color:#15181a}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10mm}.card{border:1.5px solid #ddd;border-radius:12px;padding:8mm;text-align:center;page-break-inside:avoid}
.card svg{width:52mm;height:52mm}.tbl{font-size:30pt;font-weight:800;color:${primary};margin:2mm 0 0}.hint{font-size:10pt;color:#666}.brand{font-size:11pt;font-weight:700;margin-bottom:3mm}
@media print{.card{border-color:#ccc}}</style>
<div class="grid">${cards.map((c) => `<div class="card"><div class="brand">${record.name} · ${branch.name}</div>${c.svg}<div class="tbl">Table ${c.t}</div><div class="hint">Scan to order from your table ☕<br>امسح الكود واطلب من مكانك</div></div>`).join("")}</div>`;
fs.writeFileSync(path.join(OUT, "sheet.html"), sheet);
console.log(`\n${tables.length} codes → ${OUT} (open sheet.html to print)`);
