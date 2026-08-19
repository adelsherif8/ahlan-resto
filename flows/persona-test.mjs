// PERSONA CONVERSATIONS — whole conversations, judged the way the founder judges:
//   • the conversation must REACH ITS END: a ticket (🎫) for order personas, or every
//     asked thing answered for question personas — never "the first assertion passed"
//   • no wrong-script reply on ANY turn (Latin guest → no Arabic; Arabic guest → Arabic)
//   • no "one sec" filler, no NO-REPLY, no repeated identical question
//   • per-persona expectations on the FULL transcript (bill lines, totals, notices)
//   • real COST per conversation, read from flow_executions (respond rows only — a
//     respond row already includes its sub-flows; summing children triple-counts)
// Usage: node persona-test.mjs <baseUrl> <slug> <fixture.json> [--only=id1,id2]
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const BASE = process.argv[2] || "https://flows.munadim.com";
const SLUG = process.argv[3] || "luciz";
const FILE = process.argv[4];
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").replace("--only=", "").split(",").filter(Boolean);
const TOKEN = process.env.OPS_TOKEN || "0fcef00a1debec92dbaee745";
const INTERIM = /^(one sec|لحظة واحدة|le7za wa7da)/i;
const AR = /[؀-ۿ]/;

const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: r } = await sb.from("restaurants").select("integrations").eq("slug", SLUG).single();
const s = r.integrations.supabase;
const db = createClient(s.url, s.key, { db: { schema: s.schema || "public" } });

const convos = JSON.parse(fs.readFileSync(FILE, "utf8")).filter((c) => !ONLY.length || ONLY.includes(c.id));

async function aiCount(sid) { const { data } = await db.from("chat_messages").select("id").eq("session_id", sid).eq("sender", "ai"); return (data || []).length; }
async function aiSince(sid, n) { const { data } = await db.from("chat_messages").select("message,created_at").eq("session_id", sid).eq("sender", "ai").order("created_at", { ascending: true }); return (data || []).slice(n).map((m) => m.message); }
async function seedDiner(sid, seed) {
  const { data: d } = await db.from("diners").select("id").eq("phone_number", sid).maybeSingle();
  const row = { name: seed.name, visit_count: seed.visit_count ?? 3, last_visit_at: new Date(Date.now() - 3 * 86400000).toISOString(), status: "regular", ...(seed.preferences ? { preferences: seed.preferences } : {}) };
  if (d?.id) await db.from("diners").update(row).eq("id", d.id); else await db.from("diners").insert({ phone_number: sid, ...row });
  if (seed.orders) for (const o of seed.orders) await db.from("orders").insert({ code: `H-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, phone_number: sid, order_type: o.order_type || "pickup", branch: o.branch || null, items: o.items, subtotal: o.total, total: o.total, status: "completed", payment_method: "cash", created_at: new Date(Date.now() - 5 * 86400000).toISOString() });
}
async function wipe(sid) {
  await db.from("chat_messages").delete().eq("session_id", sid);
  await db.from("message_full").delete().eq("phone_number", sid);
  await db.from("chat_sessions").delete().eq("session_id", sid);
  await db.from("orders").delete().eq("phone_number", sid);
  const { data: d } = await db.from("diners").select("id,preferences").eq("phone_number", sid).maybeSingle();
  if (d?.id) { const { pending_order: _p, last_location: _l, ...rest } = d.preferences || {}; await db.from("diners").update({ preferences: rest }).eq("id", d.id); }
}
async function costOf(sid, since) {
  const { data } = await db.from("flow_executions").select("cost_usd,tokens_in,tokens_out,flow").eq("session_id", sid).eq("flow", "respond").gte("started_at", since);
  const rows = data || [];
  return { cost: rows.reduce((a, x) => a + (Number(x.cost_usd) || 0), 0), tin: rows.reduce((a, x) => a + (Number(x.tokens_in) || 0), 0), tout: rows.reduce((a, x) => a + (Number(x.tokens_out) || 0), 0), turns: rows.length };
}
const langOf = (msg) => (AR.test(msg) ? "ar" : "latin");

let failed = 0, passed = 0, totalCost = 0, totalTurns = 0, totalIn = 0, totalOut = 0;
const summary = [];
for (const c of convos) {
  console.log(`\n${"=".repeat(74)}\n[${c.id}] ${c.name}\n${"=".repeat(74)}`);
  await wipe(c.phone);
  if (c.seed) await seedDiner(c.phone, c.seed);
  const startedAt = new Date().toISOString();
  const transcript = [];   // [{guest, bot:[...]}]
  const problems = [];
  const guestLang = langOf(c.turns.join(" "));
  const askedQuestions = [];
  for (const turn of c.turns) {
    const before = await aiCount(c.phone);
    const t0 = Date.now();
    await fetch(`${BASE}/api/web/send`, { method: "POST", headers: { "x-ops-token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: c.phone, message: turn, restaurant: SLUG }) });
    let out = [], waited = 0, stable = 0;
    while (waited < 90000) {
      await new Promise((z) => setTimeout(z, 1500)); waited += 1500;
      const now = await aiSince(c.phone, before);
      const real = now.filter((m) => !INTERIM.test(String(m).trim()));
      if (real.length && now.length === out.length) { stable++; if (stable >= 2) break; } else stable = 0;
      out = now;
    }
    const filler = out.some((m) => INTERIM.test(String(m).trim()));
    out = out.filter((m) => !INTERIM.test(String(m).trim()));
    console.log(`\n👤 ${turn}   ⏲ ${Date.now() - t0}ms`);
    if (!out.length) { console.log("🤖 (NO REPLY)"); problems.push(`no reply to "${turn.slice(0, 40)}"`); }
    for (const m of out) console.log(`🤖 ${m.replace(/\n/g, "\n   ")}`);
    if (filler) problems.push(`filler on "${turn.slice(0, 40)}"`);
    // wrong script on ANY turn — dish names / labels may be Latin inside an Arabic bubble,
    // so for Arabic guests the test is "the bubble contains Arabic at all"
    for (const m of out) {
      const body = String(m).replace(/https?:\/\/\S+/g, "").replace(/[•▸📄🧾🎫📍🍟✅—–―\d\s.,:()*+/×%$_-]/g, "");
      if (!body.trim()) continue;
      if (guestLang === "latin" && AR.test(m)) problems.push(`Arabic script to a Latin guest on "${turn.slice(0, 30)}"`);
      // a bilingual first reply to a wordless first message (a bare pin/link) is by design
      if (guestLang === "ar" && !AR.test(m) && !(c.allow_bilingual_first && transcript.length === 0)) problems.push(`no Arabic to an Arabic guest on "${turn.slice(0, 30)}"`);
    }
    // repeated identical question = stuck
    const q = out.join("\n").split("\n").filter((l) => /[?؟]\s*$/.test(l)).map((l) => l.trim());
    for (const line of q) { if (askedQuestions.filter((x) => x === line).length >= 2) problems.push(`asked 3× "${line.slice(0, 40)}"`); askedQuestions.push(line); }
    transcript.push({ guest: turn, bot: out });
  }
  const full = transcript.map((t) => t.bot.join("\n")).join("\n");
  const last = transcript.length ? transcript[transcript.length - 1].bot.join("\n") : "";
  // COMPLETION: the conversation must have reached its end
  const done = c.complete === "ticket" ? /🎫/.test(full)
    : c.complete === "answered" ? (c.answered || []).every((re) => new RegExp(re, "i").test(full))
    : c.complete === "confirm" ? /(confirm and I'll send|أكد وهيروح|akked w hayro7)/i.test(last)
    : true;
  if (!done) problems.push(`NOT COMPLETED (${c.complete})`);
  for (const [label, re] of Object.entries(c.expect || {})) if (!new RegExp(re, "i").test(full)) problems.push(`missing: ${label}`);
  for (const [label, re] of Object.entries(c.expect_last || {})) if (!new RegExp(re, "i").test(last)) problems.push(`missing on last turn: ${label}`);
  for (const [label, re] of Object.entries(c.forbid || {})) if (new RegExp(re, "i").test(full)) problems.push(`FORBIDDEN: ${label}`);
  for (const [label, re] of Object.entries(c.forbid_last || {})) if (new RegExp(re, "i").test(last)) problems.push(`FORBIDDEN on last turn: ${label}`);
  const cost = await costOf(c.phone, startedAt);
  totalCost += cost.cost; totalTurns += cost.turns; totalIn += cost.tin; totalOut += cost.tout;
  const ok = problems.length === 0;
  if (ok) passed++; else failed++;
  console.log(`\n   ${ok ? "✅ PASS" : "❌ FAIL"} · ${cost.turns} turns · $${cost.cost.toFixed(4)} · ${cost.tin}→${cost.tout} tok`);
  for (const p of problems) console.log(`      • ${p}`);
  summary.push({ id: c.id, ok, problems, cost: cost.cost, turns: cost.turns });
}
console.log(`\n${"#".repeat(74)}`);
console.log(`PERSONAS: ${passed} passed, ${failed} failed of ${convos.length}`);
console.log(`COST: $${totalCost.toFixed(4)} total · ${totalTurns} turns · $${(totalTurns ? totalCost / totalTurns : 0).toFixed(5)}/turn · $${(convos.length ? totalCost / convos.length : 0).toFixed(4)}/conversation · tokens ${totalIn}→${totalOut}`);
for (const x of summary.filter((x) => !x.ok)) console.log(`  ❌ ${x.id}: ${x.problems.join(" | ")}`);
fs.writeFileSync(`/tmp/persona-${Date.now()}.json`, JSON.stringify({ summary, totalCost, totalTurns, totalIn, totalOut }, null, 1));
process.exit(failed ? 1 : 0);
