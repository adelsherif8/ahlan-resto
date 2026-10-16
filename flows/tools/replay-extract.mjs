// TRACE REPLAY. Every real guest turn stores the extractor's input and output in
// flow_executions. This replays yesterday's REAL messages (test sessions excluded) through
// TODAY's prompt and menu, and prints where the extraction changed — so a prompt edit that
// silently alters behaviour on real traffic is seen the next morning, not in a chat.
//
//   node tools/replay-extract.mjs                 # yesterday, every restaurant
//   node tools/replay-extract.mjs --days=3 --slug=munadim --limit=80
//
// Cost: one nano-sized call per replayed turn (a busy day ≈ a few cents).
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import { resolveAllRestaurants } from "../src/services/tenant.js";
import { isTestSession } from "../src/engine/flow.js";
import { extractPrompt } from "../src/services/orderprompt.js";
import { chatJSON } from "../src/services/llm.js";
import { MODEL_FAST } from "../src/config.js";
import { expandFrancoConnectors, expandFrancoCounts } from "../src/services/franco.js";

const arg = (k, d) => Number((process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1]) || d;
const slugOnly = (process.argv.find((a) => a.startsWith("--slug=")) || "").split("=")[1] || null;
const DAYS = arg("days", 1), LIMIT = arg("limit", 60);
const since = new Date(Date.now() - DAYS * 86400_000).toISOString();

const key = (v) => JSON.stringify({
  intent: v.intent || null,
  items: (v.items || []).map((i) => `${Number(i.qty) || 1}× ${i.name}`),
  edits: (v.edits || []).map((e) => `${e.op}:${e.item || ""}→${e.with || e.option || e.qty || ""}`),
  type: v.order_type || null, pay: v.payment_method || null,
});

let turns = 0, changed = 0, cost = 0;
for (const t of await resolveAllRestaurants()) {
  if (slugOnly && t.config.slug !== slugOnly) continue;
  const { data } = await t.db.from("flow_executions").select("session_id,started_at,nodes").eq("flow", "order").gte("started_at", since).order("started_at", { ascending: false }).limit(400);
  const real = (data || []).filter((e) => !isTestSession(e.session_id)).slice(0, LIMIT);
  if (!real.length) { console.log(`${t.config.slug}: no real order turns in the last ${DAYS} day(s)`); continue; }
  const { data: rows } = await t.db.from("menu_items").select("*").order("sort_order");
  const menu = (rows || []).filter((m) => m.available);
  const branches = (t.config.basic_info?.branches || []).filter((b) => b?.key);
  console.log(`\n${t.config.slug}: replaying ${real.length} real turn(s)`);
  for (const e of real) {
    const ex = (e.nodes || []).find((n) => n.name === "extract");
    if (!ex?.input || !ex?.output) continue;
    let message, before;
    try { message = JSON.parse(ex.input).message; before = JSON.parse(ex.output); } catch { continue; }
    if (!message || before?.value) continue;
    // the draft at the time is not stored — replay as a fresh turn (the common case)
    const sys = extractPrompt({ menu, pending: null, history: [], branches });
    const out = await chatJSON(MODEL_FAST, sys, expandFrancoConnectors(expandFrancoCounts(message)), { temperature: 0, maxTokens: 220 });
    cost += out.__usage?.cost_usd || 0; turns++;
    const a = key(before), b = key(out.value || {});
    if (a !== b) {
      changed++;
      console.log(`\n≠ ${e.session_id.replace(/^(\+20\d{3})\d+/, "$1…")} ${String(e.started_at).slice(5, 16)}: ${String(message).slice(0, 90)}`);
      console.log(`   was: ${a}\n   now: ${b}`);
    }
  }
}
console.log(`\nREPLAY: ${turns} turn(s), ${changed} changed · $${cost.toFixed(4)}`);
