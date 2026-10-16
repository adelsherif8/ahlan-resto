// The gate, end to end: a stranger is refused, a number Adel added is served, an
// expired one is wrapped up. Hits a local server against the real Munadim tenant.
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import { createClient } from "@supabase/supabase-js";
import { addLead } from "../src/services/demolead.js";
const BASE = process.env.PROBE_BASE || "http://127.0.0.1:3999", TOKEN = process.env.OPS_TOKEN;
const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: r } = await sb.from("restaurants").select("integrations").eq("slug", "munadim").single();
const c = r.integrations.supabase;
const db = createClient(c.url, c.key, { db: { schema: "r_munadim" } });

const PHONE = "+201234509876";
const count = async () => (await db.from("chat_messages").select("id", { count: "exact", head: true }).eq("session_id", PHONE).eq("sender", "ai")).count || 0;
const since = async (n) => ((await db.from("chat_messages").select("message,created_at").eq("session_id", PHONE).eq("sender", "ai").order("created_at", { ascending: true })).data || []).slice(n).map((m) => m.message);

async function say(msg) {
  const before = await count();
  await fetch(`${BASE}/api/web/send`, { method: "POST", headers: { "x-ops-token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: PHONE, message: msg, restaurant: "munadim" }) });
  let out = [], waited = 0, stable = 0;
  while (waited < 60000) {
    await new Promise((z) => setTimeout(z, 1500)); waited += 1500;
    const now = await since(before);
    if (now.length && now.length === out.length) { stable++; if (stable >= 2) break; } else stable = 0;
    out = now;
  }
  console.log(`\n👤 ${msg}\n🤖 ${out.join("\n   ") || "(NO REPLY)"}`);
  return out.join("\n");
}
const ok = (c, m) => console.log(c ? `   ✅ ${m}` : `   ❌ ${m}`);

await db.from("demo_leads").delete().eq("phone_number", PHONE);
await db.from("chat_messages").delete().eq("session_id", PHONE);

console.log("═══ 1. a number we never vouched for");
const a = await say("hi");
ok(/invite|بالدعوة|bel da3wa/i.test(a) && !/🎫|EGP/.test(a), "refused politely, no menu given away");
ok(!a.includes("/demo/"), "no link anywhere");

console.log("═══ 2. Adel adds them by hand");
const lead = await addLead(db, PHONE, { name: "Martin", business_name: "Burger Lab", business_type: "burgers", city: "Maadi" });
console.log(`   row: ${lead.name} / ${lead.business_name} / expires ${lead.expires_at}`);

console.log("═══ 3. inside the window → the real bot");
const b = await say("what burgers do you have?");
ok(/burger/i.test(b) && !/invite|بالدعوة/i.test(b), "full bot answers");

console.log("═══ 4. they order like a customer");
const c2 = await say("2 munadim classic burgers takeaway, cash");
ok(/EGP|جنيه/.test(c2), "priced the order");

console.log("═══ 5. clock runs out");
await db.from("demo_leads").update({ expires_at: new Date(Date.now() - 3600_000).toISOString() }).eq("phone_number", PHONE);
const d = await say("ok confirm");
ok(/demo|ديمو/i.test(d) && !/🎫/.test(d), "wrapped up, no ticket after expiry");
const { data: sess } = await db.from("chat_sessions").select("needs_attention,handoff_reason").eq("session_id", PHONE).maybeSingle();
ok(sess?.needs_attention === true, `flagged for follow-up: ${sess?.handoff_reason}`);
