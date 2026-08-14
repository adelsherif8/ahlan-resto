// WHY DOES IT SAY "ONE SEC"? Measure it.
// The filler fires when the MASTER node passes 15s. This sends real turns, times the
// wait for a real reply, then reads the trace to attribute the time node by node.
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] || "https://flows.munadim.com";
const SLUG = process.argv[3] || "luciz";
const TOKEN = "0fcef00a1debec92dbaee745";
const INTERIM = /^(one sec|لحظة واحدة|le7za wa7da)/i;

const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: r } = await sb.from("restaurants").select("integrations").eq("slug", SLUG).single();
const s = r.integrations.supabase;
const db = createClient(s.url, s.key, { db: { schema: s.schema || "public" } });

const TURNS = [
  ["AR new    ", "+201555008801", "أهلاً وسهلاً"],
  ["AR new    ", "+201555008802", "سلام عليكو"],
  ["AR menu   ", "+201555008803", "المنيو"],
  ["EN new    ", "+201555008804", "hello there"],
  ["EN menu   ", "+201555008805", "send me the menu"],
  ["FR new    ", "+201555008806", "ezayak ya basha"],
  ["AR question", "+201555008807", "بتقفلوا امتى؟"],
  ["AR order  ", "+201555008808", "عايز كلاسيك برجر"],
  ["EN order  ", "+201555008809", "2 loaded fries please"],
  ["AR chat   ", "+201555008810", "ايه احلى حاجة عندكو؟"],
];

async function wipe(sid) {
  for (const [tbl, col] of [["chat_messages", "session_id"], ["message_full", "phone_number"],
    ["chat_sessions", "session_id"], ["diners", "phone_number"], ["flow_executions", "session_id"]]) {
    await db.from(tbl).delete().eq(col, sid);
  }
}
const aiRows = async (sid) => (await db.from("chat_messages").select("message,created_at")
  .eq("session_id", sid).eq("sender", "ai").order("created_at")).data || [];

console.log(`\n${"turn".padEnd(12)} ${"message".padEnd(24)} ${"wait".padStart(7)}  filler?  slowest node`);
console.log("-".repeat(92));
const slow = [];
for (const [label, phone, msg] of TURNS) {
  await wipe(phone);
  const t0 = Date.now();
  await fetch(`${BASE}/api/web/send`, {
    method: "POST", headers: { "x-ops-token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: phone, message: msg, restaurant: SLUG }),
  });
  let sawFiller = false, ms = null;
  while (Date.now() - t0 < 70000) {
    await new Promise((z) => setTimeout(z, 700));
    const rows = await aiRows(phone);
    if (rows.some((x) => INTERIM.test(String(x.message).trim()))) sawFiller = true;
    const real = rows.find((x) => !INTERIM.test(String(x.message).trim()));
    if (real) { ms = Date.now() - t0; break; }
  }
  // attribute the time from the trace
  const { data: ex } = await db.from("flow_executions").select("flow,duration_ms,nodes")
    .eq("session_id", phone).eq("flow", "respond").order("started_at", { ascending: false }).limit(1);
  const nodes = ex?.[0]?.nodes || [];
  const worst = nodes.filter((n) => n.ms).sort((a, b) => b.ms - a.ms)[0];
  const line = `${label.padEnd(12)} ${msg.slice(0, 23).padEnd(24)} ${(ms ? ms + "ms" : "NO REPLY").padStart(7)}  ${sawFiller ? "⏱ YES " : "  no  "}   ${worst ? worst.name + "=" + worst.ms + "ms" : "-"}`;
  console.log(line);
  if (sawFiller || !ms || ms > 15000) slow.push({ label, msg, ms, nodes });
}

if (slow.length) {
  console.log(`\nSLOW TURNS — full node breakdown:`);
  for (const t of slow) {
    console.log(`\n  "${t.msg}" (${t.ms ?? "no reply"})`);
    for (const n of t.nodes.filter((n) => n.ms > 200).sort((a, b) => b.ms - a.ms)) {
      console.log(`     ${String(n.ms).padStart(6)}ms  ${n.name}${n.model ? ` [${n.model} in:${n.tokens_in} out:${n.tokens_out}]` : ""}`);
    }
  }
} else {
  console.log(`\nNo turn crossed 15s and no filler was sent.`);
}
for (const [, phone] of TURNS) await wipe(phone);
console.log("\ntest data removed.");
