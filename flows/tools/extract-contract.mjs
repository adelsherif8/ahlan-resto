// EXTRACTOR CONTRACT TEST. The order extractor's prompt is 1,500 words of rules; an
// edit to it is a code change and gets tested like one. Fifty real guest messages (from
// the fixtures and persona suites) run through the CURRENT prompt and are compared with
// the expected JSON on file. Cost: ~50 nano-sized calls, a few cents.
//
//   node tools/extract-contract.mjs                # compare with test/extract-cases.json
//   node tools/extract-contract.mjs --record       # (re)write the expected JSON — review the diff before committing
//   node tools/extract-contract.mjs --slug=munadim # which restaurant's menu to extract against (default munadim)
//
// What is compared: intent, item names + qty, edit ops (+ item/with/option), order_type,
// payment_method, table_number. Notes, free text and the side-question field are NOT
// compared (the model rewords them / flips them between identical runs).
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { extractPrompt } from "../src/services/orderprompt.js";
import { chatJSON } from "../src/services/llm.js";
import { MODEL_FAST } from "../src/config.js";
import { expandFrancoConnectors, expandFrancoCounts } from "../src/services/franco.js";

const RECORD = process.argv.includes("--record");
const SLUG = (process.argv.find((a) => a.startsWith("--slug=")) || "--slug=munadim").split("=")[1];
const FILE = new URL("../test/extract-cases.json", import.meta.url);

const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: r } = await sb.from("restaurants").select("integrations,basic_info").eq("slug", SLUG).single();
const c = r.integrations.supabase;
const db = createClient(c.url, c.key, { db: { schema: c.schema || "public" } });
const { data: rows } = await db.from("menu_items").select("*").order("sort_order");
const menu = (rows || []).filter((m) => m.available);
const branches = (r.basic_info?.branches || []).filter((b) => b?.key);

const cases = JSON.parse(fs.readFileSync(FILE, "utf8"));
const shape = (v) => ({
  intent: v.intent || null,
  items: (v.items || []).map((i) => ({ name: String(i.name || ""), qty: Number(i.qty) || 1 })),
  edits: (v.edits || []).map((e) => ({ op: e.op, item: e.item || null, with: e.with || null, option: e.option || null, qty: e.qty ?? null })),
  order_type: v.order_type || null,
  payment_method: v.payment_method || null,
  table_number: v.table_number || null,
  // `question` is deliberately NOT compared: whether the model carries a side remark as
  // a question flips between runs at temperature 0 — the order content never does
});

let pass = 0, fail = 0, cost = 0;
for (const cs of cases) {
  const pending = cs.pending ? { items: cs.pending.map((n) => ({ qty: 1, name: n })) } : null;
  const history = (cs.history || []).map((m) => ({ role: "ai", message: m }));
  const sys = extractPrompt({ menu, pending, history, branches });
  const ask = async () => { const out = await chatJSON(MODEL_FAST, sys, expandFrancoConnectors(expandFrancoCounts(cs.message)), { temperature: 0, maxTokens: 220 }); cost += out.__usage?.cost_usd || 0; return shape(out.value || {}); };
  let got = await ask();
  if (RECORD) { cs.expected = got; pass++; continue; }
  const want = cs.expected;
  let same = want && JSON.stringify(got) === JSON.stringify(want);
  // temperature 0 is not determinism: a case that differs once is asked twice more and
  // counts as a match if ANY run agrees (and is reported as flaky, not broken)
  let flaky = false;
  for (let i = 0; !same && want && i < 2; i++) { got = await ask(); same = JSON.stringify(got) === JSON.stringify(want); if (same) flaky = true; }
  if (flaky) console.log(`~ ${cs.id} flaky (matched on retry): ${cs.message.slice(0, 60)}`);
  if (same) pass++;
  else {
    fail++;
    console.log(`\n❌ ${cs.id}: ${cs.message}`);
    if (want) for (const k of Object.keys(got)) if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) console.log(`   ${k}: expected ${JSON.stringify(want[k])}\n   ${" ".repeat(k.length)}  got      ${JSON.stringify(got[k])}`);
    else console.log("   (no expected recorded — run with --record)");
  }
}
if (RECORD) { fs.writeFileSync(FILE, JSON.stringify(cases, null, 1) + "\n"); console.log(`recorded ${cases.length} expectations → test/extract-cases.json (review the diff!)`); }
console.log(`\nEXTRACT CONTRACT: ${pass} match, ${fail} differ of ${cases.length} · $${cost.toFixed(4)}`);
try { fs.appendFileSync(new URL("../test-runs.log", import.meta.url), `${new Date().toISOString()} extract-contract ${SLUG} ${RECORD ? "recorded" : `${pass}/${cases.length}`} cost=$${cost.toFixed(4)}\n`); } catch {}
process.exit(fail ? 1 : 0);
