// DEMO ACCESS, GRANTED BY HAND.
//
// Adel asks the prospect for their details on WhatsApp; they reply; he pastes that
// reply here. That opens a 24-hour window on their number and prints the "you're in"
// message to send back. Nobody gets in any other way.
//
//   node tools/demo-lead.mjs add            # then paste their reply, then Ctrl-D
//   node tools/demo-lead.mjs add --hours=48 # a longer window for a big account
//   node tools/demo-lead.mjs list           # who is live, who has run out
//   node tools/demo-lead.mjs extend +2010…  # another 24 hours
//   node tools/demo-lead.mjs stop +2010…    # end it now
//   node tools/demo-lead.mjs ask            # print the message that asks for details
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import { createClient } from "@supabase/supabase-js";
import { addLead, parseLeadBlob, normId, isHandle, leadState, hoursLeft, welcomeBack, DEMO_HOURS } from "../src/services/demolead.js";

const SLUG = "munadim";
const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: r } = await sb.from("restaurants").select("integrations").eq("slug", SLUG).single();
if (!r) throw new Error(`${SLUG} row not found`);
const c = r.integrations.supabase;
const db = createClient(c.url, c.key, { db: { schema: c.schema || "r_munadim" } });

const STAGE = process.argv[2] || "list";
const arg = (k, d = null) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const phoneArg = process.argv.slice(3).find((a) => !a.startsWith("--"));
const when = (iso) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// The message to send a prospect. Plain fields, no link — they just reply to it.
const ASK = `Hey! 👋 Send these back in one message and I'll switch the demo on for your number:

NAME:
PHONE NUMBER (the one you'll WhatsApp from):
RESTAURANT NAME:
TYPE (burgers / coffee / Egyptian / pizza / cloud kitchen / other):
SITE OR INSTAGRAM:
CITY:
BRANCHES:
ANYTHING YOU WANT IT TO HANDLE:`;

async function readStdin() {
  if (process.stdin.isTTY) console.log("Paste their reply, then press Ctrl-D:\n");
  let buf = "";
  for await (const chunk of process.stdin) buf += chunk;
  return buf;
}

async function stageAdd() {
  const blob = arg("text") || (await readStdin());
  const f = parseLeadBlob(blob);
  const phone = normId(arg("phone") || f.phone || phoneArg || "");
  if (!phone || (!isHandle(phone) && phone.replace(/\D/g, "").length < 11)) {
    console.error("\n✗ No usable number or username in that. Add one: --phone=+2010… or --phone=@handle");
    console.error("  parsed:", JSON.stringify(f));
    process.exit(1);
  }
  const hours = Number(arg("hours", DEMO_HOURS));
  const lead = await addLead(db, phone, { ...f, hours });
  if (!lead) { console.error("✗ write failed"); process.exit(1); }
  console.log(`\n✓ ${phone} is in for ${hours}h — until ${when(lead.expires_at)} Cairo`);
  if (isHandle(phone)) {
    // WhatsApp tells us the sender's NUMBER, never their @username, so this row cannot
    // be matched directly. The gate handles it: the next unknown number to message
    // claims this row and their 24 hours start then. Say so, and say the one limit.
    console.log(`\n⚠️  "${phone}" is a username. WhatsApp only ever tells us the sender's NUMBER,`);
    console.log(`   so this row gets claimed by the NEXT new number that messages Munadim — which`);
    console.log(`   will be them if you send this now. Their 24h start when they actually turn up.`);
    console.log(`   Only one username can be left open at a time, or we would not know who is who.`);
  }
  console.log(`\n──────── send them this ────────\n${welcomeBack("en", lead)}\n────────────────────────────────`);
}

async function stageList() {
  const { data } = await db.from("demo_leads").select("*").order("created_at", { ascending: false }).limit(40);
  if (!data?.length) return console.log("no demo leads yet");
  for (const l of data) {
    const st = leadState(l);
    const mark = st === "active" ? `🟢 ${hoursLeft(l)}h left` : st === "expired" ? "⚪️ finished" : "🔸 knocked, not let in";
    console.log(`${mark}  ${l.phone_number}  ${[l.name, l.business_name, l.business_type, l.city].filter(Boolean).join(" · ") || "—"}`);
    if (st !== "new") console.log(`        ${when(l.started_at)} → ${when(l.expires_at)}${l.website ? `  ${l.website}` : ""}`);
  }
}

async function setExpiry(phone, iso, label) {
  const p = normId(phone);
  if (!p) throw new Error("give me a number or a @username");
  const { data, error } = await db.from("demo_leads").update({ expires_at: iso }).eq("phone_number", p).select().maybeSingle();
  if (error) throw error;
  if (!data) return console.log(`${p} has no demo row — use \`add\` first`);
  console.log(`${p}: ${label}`);
}

if (STAGE === "add") await stageAdd();
else if (STAGE === "ask") console.log(ASK);
else if (STAGE === "extend") await setExpiry(phoneArg, new Date(Date.now() + Number(arg("hours", DEMO_HOURS)) * 3600_000).toISOString(), `extended ${arg("hours", DEMO_HOURS)}h`);
else if (STAGE === "stop") await setExpiry(phoneArg, new Date(Date.now() - 1000).toISOString(), "demo closed");
else await stageList();
