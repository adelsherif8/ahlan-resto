// Does the TICKET match the BILL the guest agreed to? Re-prices every recent order
// from the menu + config and compares with what was written to the orders table.
import dotenv from "dotenv"; dotenv.config();
import { createClient } from "@supabase/supabase-js";
const SLUG = process.argv[2] || "munadim";
const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: r } = await sb.from("restaurants").select("*").eq("slug", SLUG).single();
const t = r.integrations.supabase;
const db = createClient(t.url, t.key, { db: { schema: t.schema } });
const { data: menu } = await db.from("menu_items").select("*");
const byName = new Map(menu.map((m) => [String(m.name).toLowerCase(), m]));
const { data: orders } = await db.from("orders").select("*").order("created_at", { ascending: false }).limit(40);
let bad = 0;
for (const o of orders || []) {
  const items = o.items || [];
  let recomputed = 0;
  const problems = [];
  for (const it of items) {
    const m = byName.get(String(it.name).toLowerCase());
    if (!m) { problems.push(`unknown item "${it.name}"`); continue; }
    // option prices override the base price (Sandwich vs Combo, Regular vs Large)
    let unit = Number(m.price);
    for (const g of m.options || []) {
      const chosen = (it.options || {})[g.key];
      const c = (g.choices || []).find((x) => x.name === chosen);
      if (c && Number.isFinite(Number(c.price))) unit = Number(c.price);
    }
    // the effective price lives in unit_price (price keeps the menu base) — every
    // consumer (receipt, KPIs, dashboard) reads unit_price ?? price, so audit that
    const stored = Number(it.unit_price ?? it.price);
    if (stored !== unit) problems.push(`${it.name}: charged ${stored} vs menu ${unit}`);
    recomputed += (Number.isFinite(stored) ? stored : unit) * Number(it.qty || 1);
  }
  const fee = Number(o.delivery_fee || 0);
  const expectedTotal = recomputed + fee;
  if (Number(o.subtotal) !== recomputed) problems.push(`subtotal ${o.subtotal} vs items ${recomputed}`);
  if (Math.abs(Number(o.total) - expectedTotal) > 0.01) problems.push(`total ${o.total} vs ${expectedTotal} (fee ${fee})`);
  if (o.order_type === "delivery" && !o.address && !o.lat) problems.push("delivery with no address/pin");
  if (o.order_type === "dine_in" && !o.table_number) problems.push("dine-in with no table");
  if (!items.length) problems.push("no items");
  if (problems.length) { bad++; console.log(`❌ ${o.code} ${String(o.created_at).slice(5,16)} ${o.order_type} — ${problems.join(" | ")}`); }
}
console.log(`\nchecked ${orders?.length || 0} orders on ${SLUG}: ${bad} with mismatches`);
