// 10 greeting scenarios through PRODUCTION — run, judge, fix, repeat until 10/10.
// Sessions web:greet-<n>; everything cleaned up. Deleted when greetings are perfect.
import { resolveRestaurant } from "./src/services/tenant.js";

const FLOWS = "https://flows-production-e528.up.railway.app";
const t = await resolveRestaurant();
const db = t.db;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const mmddIn = (n) => { const d = new Date(Date.now() + n * 86400000); return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const AR = /[؀-ۿ]/;
const BOTISM = /vibe|hit me up|quick rec|checking in|how can i assist|just say the word/i;

const S = [
  { id: 1, name: "first-timer EN", msg: "hi", seed: null,
    must: [/just smash/i], forbid: [BOTISM] },
  { id: 2, name: "returning + favorite", msg: "hi",
    seed: { wa_profile_name: "Adel", visit_count: 3, last_seen_at: daysAgo(2), preferences: { favorite_items: ["Iconic Meal"] } },
    must: [/adel/i], forbid: [/welcome to just smash/i, BOTISM] },
  { id: 3, name: "returning, no favorite", msg: "hey",
    seed: { wa_profile_name: "Omar", visit_count: 2, last_seen_at: daysAgo(3) },
    must: [/omar/i], forbid: [/welcome to just smash/i, BOTISM] },
  { id: 4, name: "long time no see (60d)", msg: "hi",
    seed: { wa_profile_name: "Dina", visit_count: 4, last_seen_at: daysAgo(60) },
    must: [/dina/i, /miss|been a while|long time|it'?s been|وحشتنا/i], forbid: [BOTISM] },
  { id: 5, name: "birthday in 3 days", msg: "hi",
    seed: { wa_profile_name: "Salma", visit_count: 2, last_seen_at: daysAgo(4), preferences: { occasions: { birthday: mmddIn(3) } } },
    must: [/salma/i, /birthday|big day|🎂|عيد/i], forbid: [BOTISM] },
  { id: 6, name: "birthday far (60d) stays silent", msg: "hi",
    seed: { wa_profile_name: "Salma", visit_count: 2, last_seen_at: daysAgo(4), preferences: { occasions: { birthday: mmddIn(60) } } },
    must: [/salma/i], forbid: [/birthday|🎂/i, BOTISM] },
  { id: 7, name: "VIP regular", msg: "hello",
    seed: { wa_profile_name: "Layla", visit_count: 9, is_vip: true, last_seen_at: daysAgo(1) },
    must: [/layla/i], forbid: [/welcome to just smash/i, BOTISM] },
  { id: 8, name: "Arabic first-timer", msg: "اهلا", seed: null,
    must: [AR, /سماش|smash/i], forbid: [BOTISM] },
  { id: 9, name: "Franco returning", msg: "ezayak",
    seed: { wa_profile_name: "Adel", visit_count: 3, last_seen_at: daysAgo(2) },
    must: [/adel/i], forbid: [AR, BOTISM] },
  { id: 10, name: "dining right now", msg: "hi",
    seed: { wa_profile_name: "Hassan", visit_count: 3, last_seen_at: daysAgo(1) },
    reservation: { status: "arrived" },
    must: [/hassan/i, /meal|food|everything|going|الأكل|how/i], forbid: [/welcome to just smash/i, /📋/, BOTISM] },
];

async function run(sc) {
  const sid = `web:greet-${sc.id}`;
  if (sc.seed) await db.from("diners").insert({ phone_number: sid, status: "customer", ...sc.seed });
  if (sc.reservation) {
    const today = new Date().toLocaleDateString("en-CA");
    await db.from("reservations").insert({
      code: `R-G${sc.id}${Math.random().toString(36).slice(2, 4).toUpperCase()}`, diner_phone: sid,
      diner_name: sc.seed?.wa_profile_name || null, party_size: 2, date: today, time_slot: "20:00", status: sc.reservation.status,
    });
  }
  await fetch(`${FLOWS}/api/web/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sid, message: sc.msg }) });
  let reply = null;
  for (let i = 0; i < 18; i++) {
    await sleep(2500);
    const ms = await fetch(`${FLOWS}/api/web/poll?sessionId=${encodeURIComponent(sid)}`).then((x) => x.json()).catch(() => []);
    const ai = (Array.isArray(ms) ? ms : []).filter((m) => m.sender === "ai");
    if (ai.length) { reply = ai[ai.length - 1].message; break; }
  }
  const fails = [];
  if (!reply) fails.push("NO REPLY");
  else {
    for (const rx of sc.must) if (!rx.test(reply)) fails.push(`missing ${rx}`);
    for (const rx of sc.forbid) if (rx.test(reply)) fails.push(`forbidden ${rx}`);
  }
  return { id: sc.id, name: sc.name, pass: !fails.length, fails, reply: (reply || "").slice(0, 200) };
}

const results = [];
const queue = [...S];
await Promise.all(Array.from({ length: 5 }, async () => {
  while (queue.length) results.push(await run(queue.shift()));
}));
results.sort((a, b) => a.id - b.id);
let passed = 0;
for (const r of results) {
  if (r.pass) passed++;
  console.log(`${r.pass ? "PASS" : "FAIL"} #${r.id} ${r.name}${r.pass ? "" : " | " + JSON.stringify(r.fails)}`);
  console.log(`   → ${r.reply.replace(/\n/g, " | ")}`);
}
console.log(`RESULT ${passed}/10`);

for (const sc of S) {
  const sid = `web:greet-${sc.id}`;
  for (const [table, col] of [["message_full", "phone_number"], ["chat_messages", "session_id"], ["chat_sessions", "session_id"], ["diners", "phone_number"], ["reservations", "diner_phone"], ["notifications", "ref_id"]])
    await db.from(table).delete().eq(col, sid);
}
console.log("cleaned");
process.exit(0);
