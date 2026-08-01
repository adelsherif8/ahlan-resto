// One-off importer: pulls Just Smash's live product catalogue and turns each
// product's Variants into option groups on our menu_items, then adds the combo
// follow-up questions (size / fries / drink) and bundle composition.
//
// Real prices are taken from their API. Where their API publishes no price, the
// value is marked SAMPLE in the output so it can be corrected in the dashboard —
// we never quietly invent a number a guest would be charged.
//
//   node tools/import-jsmash-options.mjs          # dry run, prints the plan
//   node tools/import-jsmash-options.mjs --apply  # writes to menu_items
import "dotenv/config";
import { resolveRestaurant } from "../src/services/tenant.js";

const API = "https://prod.myapp-eg.io/api/public/menu?tenantId=44&branchId=8";
const APPLY = process.argv.includes("--apply");

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Prices their API doesn't publish for the burger/chicken sandwich-vs-meal split.
// SAMPLES — the meal price is what we already had; the sandwich price is derived
// from the one product where they DO publish both (Slider: 60 sandwich / 120 meal).
const SAMPLE_SANDWICH_DISCOUNT = 70; // EGP off the meal price, flagged for review

function variantGroup(product, ourPrice) {
  const vs = (product.Variants || []).filter((v) => v?.name);
  if (vs.length < 2) return null;

  const isSandwich = (n) => /sandwich|sandwitch/i.test(n) && !/meal/i.test(n);
  const choices = [];
  let sampled = false;

  for (const v of vs) {
    const apiPrice = Number(v.price) || 0;
    let price = apiPrice;
    if (!price) {
      // their API left it blank — fall back to what we have, minus a flagged sample
      price = isSandwich(v.name) ? Math.max(0, ourPrice - SAMPLE_SANDWICH_DISCOUNT) : ourPrice;
      sampled = true;
    }
    choices.push({ name: v.name.trim().replace(/\s+/g, " "), price, ...(apiPrice ? {} : { sample: true }) });
  }
  // dedupe by name, keep the cheapest for a repeated label
  const byName = new Map();
  for (const c of choices) {
    const k = norm(c.name);
    if (!byName.has(k) || byName.get(k).price > c.price) byName.set(k, c);
  }
  const list = [...byName.values()];
  if (list.length < 2) return null;

  return {
    group: { key: "format", label: "Which one", required: true, choices: list },
    sampled,
  };
}

// The follow-ups a cashier asks once "combo/meal" is chosen. Sample values —
// Just Smash publishes no size or side options, so these are here to be edited.
function comboFollowUps(formatGroup) {
  const mealChoices = formatGroup.choices.filter((c) => /meal|combo/i.test(c.name)).map((c) => c.name);
  if (!mealChoices.length) return [];
  const when = { format: mealChoices }; // asked when any meal-ish variant is picked
  return [
    {
      key: "size", label: "Combo size", required: true, when, sample: true,
      choices: [{ name: "Small" }, { name: "Medium", delta: 15 }, { name: "Large", delta: 30 }],
    },
    {
      key: "side", label: "Which fries", required: true, when, sample: true,
      choices: [{ name: "French fries" }, { name: "Diablo fries", delta: 10 }, { name: "Curly fries", delta: 10 }],
    },
    { key: "drink", label: "Drink", required: true, when, from_category: "Beverages" },
  ];
}

// "4 Sandwich Double 2 Loaded Soda Litre" → pick 4 sandwiches; the sodas are
// fixed by the bundle, so they are never asked.
function bundleGroups(item, sandwichNames) {
  const text = `${item.name} ${item.description || ""}`;
  // "4 Sandwich Double", "2 Double sandwiches", "4 X 4" — a count, then up to two
  // words of description, then the word sandwich
  const m = text.match(/(\d+)\s+(?:\w+\s+){0,2}sandwich/i) || item.name.match(/^(\d+)\s*[xX]\s*\d+/);
  const count = m ? Math.min(Number(m[1]) || 0, 8) : 0;
  if (!count || !sandwichNames.length) return [];
  return [{
    key: "sandwiches",
    label: `Pick your ${count} sandwiches`,
    required: true,
    count,
    choices: sandwichNames.map((n) => ({ name: n })),
  }];
}

const res = await fetch(API, { headers: { "User-Agent": "Mozilla/5.0" } });
if (!res.ok) throw new Error(`menu API ${res.status}`);
const payload = await res.json();

const products = [];
(function walk(o) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === "object") {
    if (o.name && Array.isArray(o.Variants)) products.push(o);
    Object.values(o).forEach(walk);
  }
})(payload);

const tenant = await resolveRestaurant();
const { data: menu } = await tenant.db.from("menu_items").select("id,name,category,price,description").order("sort_order");

// sandwich names a bundle can be built from — read off our own menu, never invented
const sandwichSource = [];
for (const item of menu) {
  const p = products.find((x) => norm(x.name) === norm(item.name));
  const vg = p ? variantGroup(p, Number(item.price)) : null;
  if (vg) {
    const s = vg.group.choices.filter((c) => /sandwich/i.test(c.name));
    if (s.length) sandwichSource.push(item.name.replace(/\s*meal\s*$/i, "").trim());
  }
}

const plan = [];
for (const item of menu) {
  const p = products.find((x) => norm(x.name) === norm(item.name));
  const isBundle = /bundle/i.test(item.category || "") || /^\d+\s*[xX]\s*\d+/.test(item.name) || /mix/i.test(item.name);
  let options = [];
  let sampled = false;
  let newPrice = null;

  if (isBundle) {
    options = bundleGroups(item, sandwichSource);
    // their bundle price is authoritative where published
    const bv = (p?.Variants || []).map((v) => Number(v.price) || 0).filter(Boolean);
    if (bv.length) newPrice = Math.min(...bv);
  } else {
    const vg = p ? variantGroup(p, Number(item.price)) : null;
    if (vg) {
      options = [vg.group, ...comboFollowUps(vg.group)];
      sampled = vg.sampled;
      newPrice = Math.min(...vg.group.choices.map((c) => c.price));
    }
  }
  if (!options.length && newPrice == null) continue;
  plan.push({ item, options, sampled, newPrice });
}

console.log(`products from their API: ${products.length} · our menu items: ${menu.length} · to update: ${plan.length}\n`);
for (const p of plan) {
  const price = p.newPrice != null && p.newPrice !== Number(p.item.price) ? `  price ${p.item.price} → ${p.newPrice}` : "";
  console.log(`${p.item.name}${price}${p.sampled ? "   [SAMPLE PRICES]" : ""}`);
  for (const g of p.options) {
    const c = g.from_category ? `from ${g.from_category}` : (g.choices || []).map((x) => `${x.name}${x.price ? ` ${x.price}` : x.delta ? ` +${x.delta}` : ""}`).join(" | ");
    console.log(`   ${g.count ? `×${g.count} ` : ""}${g.label}${g.sample ? " [SAMPLE]" : ""}: ${c}`);
  }
}

if (!APPLY) {
  console.log("\ndry run — re-run with --apply to write");
  process.exit(0);
}

let ok = 0, failed = 0;
for (const p of plan) {
  const patch = { options: p.options };
  if (p.newPrice != null) patch.price = p.newPrice;
  const { error } = await tenant.db.from("menu_items").update(patch).eq("id", p.item.id);
  if (error) { failed++; console.log(`  FAILED ${p.item.name}: ${error.message}`); } else ok++;
}
console.log(`\nupdated ${ok}, failed ${failed}`);
process.exit(0);
