// Drive FULL conversations against a running flows service and print every reply.
// Usage: node convo-test.mjs <baseUrl> <restaurantSlug> <convoFile.json>
// Conversations: [{ name, phone, turns: ["msg", ...] }]
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] || "http://localhost:5099";
const SLUG = process.argv[3] || "luciz";
const FILE = process.argv[4];
const TOKEN = process.env.OPS_TOKEN || "0fcef00a1debec92dbaee745";

const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: r } = await sb.from("restaurants").select("integrations").eq("slug", SLUG).single();
const s = r.integrations.supabase;
const db = createClient(s.url, s.key, { db: { schema: s.schema || "public" } });

const convos = JSON.parse(await import("node:fs").then((m) => m.promises.readFile(FILE, "utf8")));

async function aiCount(sid) {
  const { data } = await db.from("chat_messages").select("id").eq("session_id", sid).eq("sender", "ai");
  return (data || []).length;
}
async function aiSince(sid, n) {
  const { data } = await db.from("chat_messages").select("message,created_at").eq("session_id", sid)
    .eq("sender", "ai").order("created_at", { ascending: true });
  return (data || []).slice(n).map((m) => m.message);
}
async function wipe(sid) {
  // A test phone must start EVERY run as a brand-new guest. Leaving the rolling
  // conversation (message_full) or the session flags behind meant turns piled up
  // across runs until the 20-turn circuit breaker fired and answered "let me get a
  // team member" to a simple menu request — a harness artefact that looks like a bug.
  await db.from("chat_messages").delete().eq("session_id", sid);
  await db.from("message_full").delete().eq("phone_number", sid);
  await db.from("chat_sessions").delete().eq("session_id", sid);
  await db.from("orders").delete().eq("phone_number", sid);
  const { data: d } = await db.from("diners").select("id,preferences").eq("phone_number", sid).maybeSingle();
  if (d?.id) {
    const { pending_order: _p, ...rest } = d.preferences || {};
    await db.from("diners").update({ preferences: rest }).eq("id", d.id);
  }
}

let failures = 0;
for (const c of convos) {
  console.log(`\n${"=".repeat(70)}\n${c.name}\n${"=".repeat(70)}`);
  await wipe(c.phone);
  let lastTurnText = "";
  for (const turn of c.turns) {
    const before = await aiCount(c.phone);
    await fetch(`${BASE}/api/web/send`, {
      method: "POST",
      headers: { "x-ops-token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: c.phone, message: turn, restaurant: SLUG }),
    });
    // "One sec… 🙏" is the >15s SLA filler, not an answer — waiting must continue.
    const INTERIM = /^(one sec|لحظة واحدة|le7za wa7da)/i;
    let out = [], waited = 0, stable = 0;
    while (waited < 90000) {
      await new Promise((z) => setTimeout(z, 1500));
      waited += 1500;
      const now = await aiSince(c.phone, before);
      const real = now.filter((m) => !INTERIM.test(String(m).trim()));
      if (real.length && now.length === out.length) { stable++; if (stable >= 2) break; } else stable = 0;
      out = now;
    }
    out = out.filter((m) => !INTERIM.test(String(m).trim()));
    console.log(`\n👤 ${turn}`);
    if (!out.length) { console.log("🤖 (NO REPLY)"); failures++; }
    for (const m of out) console.log(`🤖 ${m.replace(/\n/g, "\n   ")}`);
    lastTurnText = out.join("\n");
  }
  // assertions
  for (const [label, re] of Object.entries(c.expect || {})) {
    const ok = new RegExp(re, "i").test(lastTurnText);
    if (!ok) failures++;
    console.log(`   ${ok ? "✅" : "❌"} ${label}`);
  }
  for (const [label, re] of Object.entries(c.forbid || {})) {
    const bad = new RegExp(re, "i").test(lastTurnText);
    if (bad) failures++;
    console.log(`   ${bad ? "❌ FORBIDDEN" : "✅ not present"} — ${label}`);
  }
}
console.log(`\n${failures === 0 ? "ALL CONVERSATIONS PASSED" : failures + " ASSERTION(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
