// A LIVE SESSION BECOMES A FIXTURE. After a demo, a reel recording or a founder chat,
// point this at the phone/session and it writes a convo-test scenario: the guest's turns
// verbatim, the bot's replies as a comment block to read, and an assertion skeleton to
// fill in with what SHOULD have happened. The suite grows from real failures.
//
//   node tools/fixture-from-session.mjs <slug> <sessionId> [--since=2026-10-16T05:00] [--name="…"] [--out=convos-live.json]
//
// It appends to --out (default convos-live.json) and prints the scenario. Nothing is
// deleted; the session stays in the DB for the ops console.
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [slug, sessionId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const arg = (k, d = null) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=").slice(1).join("=") || d;
if (!slug || !sessionId) { console.error("usage: node tools/fixture-from-session.mjs <slug> <sessionId> [--since=ISO] [--name=…] [--out=file.json]"); process.exit(1); }

const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: r } = await sb.from("restaurants").select("integrations").eq("slug", slug).single();
if (!r) throw new Error(`restaurant '${slug}' not found`);
const c = r.integrations.supabase;
const db = createClient(c.url, c.key, { db: { schema: c.schema || "public" } });

let q = db.from("chat_messages").select("sender,message,created_at").eq("session_id", sessionId).order("created_at", { ascending: true });
if (arg("since")) q = q.gte("created_at", arg("since"));
const { data: msgs, error } = await q;
if (error) throw new Error(error.message);
if (!msgs?.length) { console.error("no messages for that session"); process.exit(1); }

const turns = msgs.filter((m) => m.sender === "guest").map((m) => m.message.replace(/^\[voice\]\s*/i, "").trim()).filter(Boolean);
const replies = msgs.filter((m) => m.sender === "ai").map((m) => m.message);
const latin = !/[؀-ۿ]/.test(turns.join(" "));
const placed = replies.some((m) => /🎫/.test(m));

const scenario = {
  name: arg("name") || `LIVE ${new Date().toISOString().slice(0, 10)} — ${slug} ${sessionId}: ${turns[0]?.slice(0, 40) || ""}`,
  phone: `+20155${String(Math.floor(Math.random() * 90000) + 10000)}`,   // a harness phone, never the real guest's
  turns,
  // FILL THESE IN — what should have happened, as regexes on the bot's replies
  expect: placed ? { ticket: "🎫" } : { "TODO: last reply must": "TODO" },
  expect_any: {},
  forbid: latin ? { "arabic to latin guest": "[\\u0600-\\u06FF]" } : {},
  _transcript_for_review: replies.map((m, i) => `🤖 ${i + 1}: ${m.replace(/\n/g, " ⏎ ").slice(0, 300)}`),
};

const out = arg("out", "convos-live.json");
const all = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : [];
all.push(scenario);
fs.writeFileSync(out, JSON.stringify(all, null, 1) + "\n");
console.log(JSON.stringify(scenario, null, 1));
console.log(`\nappended to ${out} (${all.length} scenarios). Replace the TODO assertions, drop _transcript_for_review, then: node convo-test.mjs <url> ${slug} ${out}`);
