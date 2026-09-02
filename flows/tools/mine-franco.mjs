// Mine real guest messages for Franco words our dictionary doesn't know yet.
// Reads message_full (guest turns, Latin script) across tenants, drops tokens that
// already resolve (menu names, FRANCO_FOOD_WORDS/AR_OPTION_WORDS targets, common
// English), and prints the leftovers by frequency — each one is a word a real guest
// typed that the bot could not read. Review the list, add the real ones to
// FRANCO_FOOD_WORDS in src/flows/order.js.
//
//   node tools/mine-franco.mjs            # all tenants, last 30 days
//   node tools/mine-franco.mjs luciz 90   # one tenant, last 90 days
import dotenv from "dotenv"; dotenv.config();
import { createClient } from "@supabase/supabase-js";
import { francoNorm } from "../src/services/franco.js";

const SLUG = process.argv[2] || null;
const DAYS = Number(process.argv[3]) || 30;

const COMMON_EN = new Set(`the a an and or but if so to of in on at for with from by is are was were be been am
i you he she it we they me my your his her its our their this that these those what which who when where why how
want need like get got take make made give go come see know think say said tell ask can could will would should
may might must do does did done have has had not no yes ok okay please thanks thank hi hello hey bye yeah yep nope
one two three four five six seven eight nine ten first second third next last more less much many some any all
order menu delivery pickup dine table burger sandwich combo meal fries chicken beef drink cola sprite fanta water
juice shake milkshake sauce cheese spicy mild hot medium small large cash card pay payment confirm cancel add remove
change now later today tomorrow minutes hour time open closed branch location address street mall city new old good
great nice fine sure right wrong sorry excuse question help still just only also very really about there here`.split(/\s+/));

const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: rs } = await sb.from("restaurants").select("slug,integrations");
const counts = new Map();
const examples = new Map();

for (const r of rs || []) {
  if (SLUG && r.slug !== SLUG) continue;
  const t = r.integrations?.supabase; if (!t?.url) continue;
  const db = createClient(t.url, t.key, { db: { schema: t.schema || "public" } });
  const { data: menu } = await db.from("menu_items").select("name").limit(500);
  const menuToks = new Set((menu || []).flatMap((m) => String(m.name).toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
  let from = 0;
  while (true) {
    const { data: rows } = await db.from("message_full").select("conversation,updated_at")
      .gte("updated_at", new Date(Date.now() - DAYS * 86400e3).toISOString()).range(from, from + 499);
    if (!rows?.length) break;
    for (const row of rows) for (const turn of row.conversation || []) {
      if (turn.role !== "guest") continue;
      const msg = String(turn.message || "").replace(/https?:\/\/\S+/g, " ");
      if (/[؀-ۿ]/.test(msg)) continue; // Arabic script — not Franco
      for (const tok of msg.toLowerCase().split(/[^a-z0-9]+/)) {
        if (tok.length < 3 || /^\d+$/.test(tok)) continue;
        if (COMMON_EN.has(tok) || menuToks.has(tok)) continue;
        const k = francoNorm(tok);
        if (COMMON_EN.has(k) || menuToks.has(k)) continue;
        counts.set(k, (counts.get(k) || 0) + 1);
        if (!examples.has(k)) examples.set(k, msg.slice(0, 70));
      }
    }
    if (rows.length < 500) break; from += 500;
  }
}

const top = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 60);
if (!top.length) { console.log(`No unknown Franco tokens seen ≥2× in the last ${DAYS} days.`); process.exit(0); }
console.log(`Unknown Latin tokens from real guests (last ${DAYS} days, seen ≥2×):\n`);
for (const [k, n] of top) console.log(`${String(n).padStart(4)}×  ${k.padEnd(16)} e.g. "${examples.get(k)}"`);
console.log(`\nAdd the real Franco words to FRANCO_FOOD_WORDS in src/flows/order.js (key = any one spelling — francoNorm covers the variants).`);
