// A prospect we only know by @username: the next new number that messages must be
// let straight in as them, and their 24 hours must start then — not when we typed it.
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import { createClient } from "@supabase/supabase-js";
import { addLead, claimHandleLead, leadState, hoursLeft } from "../src/services/demolead.js";
const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: r } = await sb.from("restaurants").select("integrations").eq("slug", "munadim").single();
const c = r.integrations.supabase;
const db = createClient(c.url, c.key, { db: { schema: "r_munadim" } });
const ok = (c2, m) => console.log(c2 ? `✅ ${m}` : `❌ ${m}`);
const NUM = "+201999000111", H1 = "@probehandle1", H2 = "@probehandle2";
for (const p of [NUM, H1, H2]) await db.from("demo_leads").delete().eq("phone_number", p);

// REAL username rows would make every case here ambiguous — and worse, the probe would
// claim one. Park them (expired rows are invisible to the claim) and put them back at
// the end, whatever happens.
const { data: real } = await db.from("demo_leads").select("id,phone_number,expires_at")
  .like("phone_number", "@%").gt("expires_at", new Date().toISOString());
for (const r2 of real || []) await db.from("demo_leads").update({ expires_at: new Date(0).toISOString() }).eq("id", r2.id);
const restore = async () => { for (const r2 of real || []) await db.from("demo_leads").update({ expires_at: r2.expires_at }).eq("id", r2.id); };
process.on("exit", () => { if (real?.length) console.log(`(parked ${real.length} real username row(s) during the run — restored)`); });
try {

console.log("── one open username → the next new number claims it");
await addLead(db, H1, { name: "Probe One", business_name: "Seadoor" });
const got = await claimHandleLead(db, NUM);
ok(got?.phone_number === NUM, `row moved onto ${NUM}`);
ok(got?.business_name === "Seadoor" && got?.name === "Probe One", "their details came with it");
ok(String(got?.note).includes(H1), "the handle is kept on the row");
ok(leadState(got) === "active" && hoursLeft(got) === 24, `24h started at the knock (${hoursLeft(got)}h left)`);
ok((await claimHandleLead(db, "+201999000222")) === null, "it cannot be claimed twice");

console.log("\n── two open usernames → refuse rather than guess");
await addLead(db, H1, { name: "Probe One" });
await addLead(db, H2, { name: "Probe Two" });
ok((await claimHandleLead(db, "+201999000333")) === null, "ambiguous, so nobody is let in");

console.log("\n── an EXPIRED username row is not a standing invitation");
await db.from("demo_leads").delete().eq("phone_number", H2);
await db.from("demo_leads").update({ expires_at: new Date(Date.now() - 3600_000).toISOString() }).eq("phone_number", H1);
ok((await claimHandleLead(db, "+201999000444")) === null, "stale invite ignored");
} finally {
  for (const p of [NUM, H1, H2, "+201999000222", "+201999000333", "+201999000444"]) await db.from("demo_leads").delete().eq("phone_number", p);
  await restore();
}
console.log("\n(probe rows cleaned up — they were mine, not your leads)");
