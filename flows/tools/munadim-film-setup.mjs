// One-off setup (founder-approved 13 Nov) so the "Friday 9pm, table 7" reel can be filmed on
// Munadim's own menu through the TABLE CHAT only (no WhatsApp sends, no Meta cost).
//   node tools/munadim-film-setup.mjs          (from flows/)
// Adds — never removes:
//   1. table chat ON: showroom table DEMO + filming table "7" (skips only the location check)
//   2. stations: Drinks → Bar screen, all food → Kitchen screen
//   3. two demo dashboard logins (manager + kitchen), generated passwords written ONLY to
//      flows/.env.munadim-demo (git-ignored). WhatsApp ordering and existing staff logins untouched.
// Undo: ai.dine_in_widget.enabled=false on the munadim row; delete the two demo-*@munadim.com users.
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const bcrypt = createRequire(import.meta.url)("../../backend/node_modules/bcryptjs");
const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: r, error: e0 } = await sb.from("restaurants").select("*").eq("slug", "munadim").single();
if (e0 || !r) throw new Error(`munadim row: ${e0?.message || "not found"}`);

const ai = { ...r.ai, dine_in_widget: { ...(r.ai?.dine_in_widget || {}), enabled: true, table_token_ttl_min: 180, geofence_m: 120, geofence_required: true, showroom_tables: ["DEMO"], test_tables: ["7"] } };
const pos = { ...(r.pos || {}), stations: [
  { name: "Bar", cats: "Drinks" },
  { name: "Kitchen", cats: "Munadim Burgers, Munadim Chicken, Munadim Egyptian, Munadim Sides, Little Munadim, Munadim Desserts, Munadim Sauces" },
] };
const { error } = await sb.from("restaurants").update({ ai, pos }).eq("id", r.id);
if (error) throw new Error(error.message);

const pw = () => crypto.randomBytes(9).toString("base64url");
const lines = [`# Munadim demo dashboard logins for filming (created ${new Date().toISOString().slice(0, 10)}). Local only, never commit.`];
for (const [role, email] of [["manager", "demo-manager@munadim.com"], ["kitchen", "demo-kitchen@munadim.com"]]) {
  const password = pw();
  const { data: ex } = await sb.from("restaurant_users").select("id").eq("email", email).maybeSingle();
  if (ex) await sb.from("restaurant_users").update({ password_hash: bcrypt.hashSync(password, 10), role, restaurant_id: r.id }).eq("id", ex.id);
  else {
    const { error: e } = await sb.from("restaurant_users").insert({ restaurant_id: r.id, email, name: role === "manager" ? "Demo Manager" : "Demo Kitchen", role, password_hash: bcrypt.hashSync(password, 10) });
    if (e) throw new Error(e.message);
  }
  lines.push(`MUNADIM_${role.toUpperCase()}_EMAIL=${email}`, `MUNADIM_${role.toUpperCase()}_PASSWORD=${password}`);
}
fs.writeFileSync(".env.munadim-demo", lines.join("\n") + "\n");
console.log("done: Munadim table chat on (DEMO + table 7), Bar/Kitchen stations, 2 demo logins saved to flows/.env.munadim-demo");
