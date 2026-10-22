// INCIDENT WATCH — after the Railway credential disclosure (21 Oct 2026). Re-run any time to
// see whether anyone used our leaked keys: new dashboard logins, config edits, unexpected
// sessions, outbound messages, orders, demo leads, and process boots we did not make.
//
//   node tools/incident-watch.mjs                # since 2026-10-21T00:00Z
//   node tools/incident-watch.mjs --since=2026-10-22T00:00Z
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import { createClient } from "@supabase/supabase-js";
import { isTestSession } from "../src/engine/flow.js";

const since = (process.argv.find((a) => a.startsWith("--since=")) || "--since=2026-10-21T00:00:00Z").split("=")[1];
const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const flag = (cond, msg) => console.log(`${cond ? "🚨" : "✅"} ${msg}`);

const { data: users } = await sb.from("restaurant_users").select("email,role,active,created_at");
const newUsers = (users || []).filter((u) => u.created_at >= since);
flag(newUsers.length, `dashboard users created since ${since}: ${newUsers.length}${newUsers.length ? " → " + newUsers.map((u) => `${u.email} (${u.role})`).join(", ") : ""}`);

const { data: rs } = await sb.from("restaurants").select("slug,updated_at,wpid,phone_number,integrations,ai");
for (const r of rs || []) {
  flag(r.updated_at >= since, `restaurant ${r.slug} row updated ${r.updated_at?.slice(0, 16)} · wpid ${r.wpid || "-"} · demo_mode ${r.ai?.demo_mode ?? "-"}`);
}
const { data: boots } = await sb.from("service_boots").select("service,env,started_at,note").gte("started_at", since);
flag((boots || []).length, `service boots since ${since}: ${(boots || []).length}${(boots || []).length ? " → " + boots.map((b) => `${b.service} ${b.started_at.slice(5, 16)}`).join(", ") : ""}`);

for (const r of rs || []) {
  const c = r.integrations?.supabase; if (!c?.url) continue;
  const db = createClient(c.url, c.key, { db: { schema: c.schema || "public" } });
  const cnt = async (t, f) => { let q = db.from(t).select("id", { count: "exact", head: true }).gte("created_at", since); if (f) q = f(q); const { count } = await q; return count || 0; };
  const guest = await cnt("chat_messages", (q) => q.eq("sender", "guest"));
  const ai = await cnt("chat_messages", (q) => q.eq("sender", "ai"));
  const staff = await cnt("chat_messages", (q) => q.eq("sender", "staff"));
  const orders = await cnt("orders");
  const { data: ex } = await db.from("flow_executions").select("trigger,session_id,flow").gte("started_at", since).limit(5000);
  const real = [...new Set((ex || []).filter((e) => !isTestSession(e.session_id) && !["janitor", "reminders", "regression"].includes(e.session_id)).map((e) => e.session_id))];
  const manual = (ex || []).filter((e) => e.trigger === "manual").length;
  let leads = 0; try { const { count } = await db.from("demo_leads").select("id", { count: "exact", head: true }).gte("created_at", since); leads = count || 0; } catch {}
  flag(ai > guest + 2 || staff > 0 || manual > 0, `${r.slug}: guest ${guest} · ai ${ai} · staff ${staff} · orders ${orders} · manual runs ${manual} · demo leads ${leads} · real sessions ${real.length}${real.length ? " (" + real.map((s) => s.replace(/(\+20\d{4})\d+/, "$1…")).join(", ") + ")" : ""}`);
}
console.log("\nNot visible from here (check in the dashboards): OpenAI usage, Supabase API logs by IP, WhatsApp Manager outbound counts, Instagram activity.");
