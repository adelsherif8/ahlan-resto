// Munadim — the platform's own flagship restaurant, taking over the Luci'z number.
// Staged on purpose so the live number never points at a half-built tenant:
//
//   node tools/seed-munadim.mjs row     # upload logo + insert the restaurants row (wpid stays null)
//   node tools/seed-munadim.mjs menu    # seed r_munadim menu + tables  (needs migration 042 run first)
//   node tools/seed-munadim.mjs swap    # move phone_number + wpid Luci'z → Munadim (LAST, after tests)
//   node tools/seed-munadim.mjs status  # show where everything stands
import dotenv from "dotenv"; dotenv.config();
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const STAGE = process.argv[2] || "status";
const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: luciz } = await sb.from("restaurants").select("*").eq("slug", "luciz").single();
if (!luciz) throw new Error("luciz row not found");
const tcreds = luciz.integrations.supabase; // same tenant project, new schema
const tdb = createClient(tcreds.url, tcreds.key, { db: { schema: "r_munadim" } });

const LOGO_LOCAL = "/private/tmp/claude-502/-Users-adel-Desktop-Ai-Squared-ai2-resto/37610cdf-decc-45f0-8726-b828959ba81f/scratchpad/munadim-logo.png";
const LOGO_PATH = "munadim/logo.png";
const KARKADEH = "#8C1D2F"; // brand primary on light grounds (branding/BRAND-SPEC.md)

// ---------- the menu: Munadim's own signatures — fast-casual, built to exercise every bot feature ----------
// (options: sandwich/combo + combo drink, spice, size, per-unit splits; bestsellers,
// pairs_with for the add-on engine; every item EN + AR; real ingredients for info cards
// and the phantom-removal check)
const spice = { key: "spice", label: "Spice Level", choices: [{ name: "Mild" }, { name: "Medium" }, { name: "Hot 🔥" }] };
const drinks = [{ name: "Coca - Cola" }, { name: "Coca - Cola Diet" }, { name: "Sprite" }, { name: "Fanta" }, { name: "Munadim Karkadeh" }];
const combo = (sand, comboPrice) => ([
  { key: "format", label: "Which one", required: true, choices: [{ name: "Sandwich", price: sand }, { name: "Combo (fries + drink)", price: comboPrice }] },
  { key: "drink", when: { format: "Combo" }, label: "Combo drink", choices: drinks },
]);
const MENU = [
  // Munadim Burgers — برجر مُنادم
  { name: "Munadim Classic Burger", name_ar: "مُنادم كلاسيك برجر", category: "Munadim Burgers", price: 195, options: combo(195, 265),
    description: "Our house smash — double-seared beef, American cheese, Munadim sauce", ingredients: "Beef patty, American cheese, Munadim sauce, lettuce, pickles, onion, tomato, brioche bun", bestseller: true, pairs_with: "Munadim Loaded Fries", sort_order: 1 },
  { name: "Munadim Signature Burger", name_ar: "مُنادم سيجنتشر برجر", category: "Munadim Burgers", price: 245, options: combo(245, 315),
    description: "Double beef, caramelised onion, smoked cheddar and our brass sauce", ingredients: "Double beef patty, smoked cheddar, caramelised onion, brass sauce, pickles, brioche bun", bestseller: true, pairs_with: "Munadim Loaded Fries", sort_order: 2 },
  { name: "Munadim Truffle Burger", name_ar: "مُنادم ترافل برجر", category: "Munadim Burgers", price: 265, options: combo(265, 335),
    description: "Truffle mayo, sautéed mushrooms, swiss cheese", ingredients: "Beef patty, swiss cheese, mushrooms, truffle mayo, rocket, brioche bun", sort_order: 3 },
  { name: "Munadim Fire Burger", name_ar: "مُنادم فاير برجر", category: "Munadim Burgers", price: 225, options: [...combo(225, 295), spice],
    description: "Jalapeños, pepper jack, shatta mayo — pick your heat", ingredients: "Beef patty, pepper jack cheese, jalapeños, shatta mayo, onion, brioche bun", sort_order: 4 },
  { name: "Munadim BBQ Burger", name_ar: "مُنادم باربيكيو برجر", category: "Munadim Burgers", price: 235, options: combo(235, 305),
    description: "Smoky BBQ, crispy onion rings, cheddar", ingredients: "Beef patty, cheddar cheese, BBQ sauce, onion rings, brioche bun", sort_order: 5 },
  // Munadim Chicken — فراخ مُنادم
  { name: "Munadim Chicken Ranch", name_ar: "مُنادم تشيكن رانش", category: "Munadim Chicken", price: 195, options: combo(195, 265),
    description: "Crispy fried chicken breast, cool ranch, lettuce, pickles", ingredients: "Crispy chicken breast, ranch sauce, lettuce, pickles, brioche bun", bestseller: true, pairs_with: "Munadim Fries", sort_order: 1 },
  { name: "Munadim Nashville Chicken", name_ar: "مُنادم ناشفيل تشيكن", category: "Munadim Chicken", price: 210, options: [...combo(210, 280), spice],
    description: "Nashville-dipped crispy chicken, slaw, pickles — heat your way", ingredients: "Crispy chicken breast, Nashville spice oil, coleslaw, pickles, brioche bun", bestseller: true, sort_order: 2 },
  { name: "Munadim Chicken Shawarma", name_ar: "مُنادم شاورما فراخ", category: "Munadim Chicken", price: 150, options: combo(150, 215),
    description: "Chicken off the spit, toum, pickles, fries inside — Cairo style", ingredients: "Chicken shawarma, garlic sauce, pickles, fries, syrian bread", sort_order: 3 },
  { name: "Munadim Chicken Tenders 3 Pcs", name_ar: "مُنادم تشيكن تندرز ٣ قطع", category: "Munadim Chicken", price: 140, options: [spice],
    description: "Three hand-breaded tenders with a dip of your choice", ingredients: "Chicken tenderloin, breading, ranch dip", sort_order: 4 },
  { name: "Munadim Chicken Tenders 5 Pcs", name_ar: "مُنادم تشيكن تندرز ٥ قطع", category: "Munadim Chicken", price: 210, options: [spice],
    description: "Five hand-breaded tenders, two dips", ingredients: "Chicken tenderloin, breading, ranch dip, honey mustard dip", sort_order: 5 },
  // Munadim Egyptian — مصري مُنادم
  { name: "Munadim Hawawshi", name_ar: "مُنادم حواوشي", category: "Munadim Egyptian", price: 110, options: [spice],
    description: "Baladi bread stuffed with spiced beef, baked till crackling", ingredients: "Baladi bread, minced beef, onion, green pepper, baladi spices", bestseller: true, pairs_with: "Munadim Karkadeh", sort_order: 1 },
  { name: "Munadim Koshary", name_ar: "مُنادم كشري", category: "Munadim Egyptian", price: 75,
    options: [{ key: "size", label: "Size", required: true, choices: [{ name: "Regular", price: 75 }, { name: "Large", price: 100 }] }],
    description: "Rice, lentils, pasta, crispy onion, dakka and tomato sauce", ingredients: "Rice, lentils, pasta, chickpeas, fried onion, tomato sauce, garlic vinegar, chili oil", sort_order: 2 },
  { name: "Munadim Mixed Grill", name_ar: "مُنادم مشكل مشويات", category: "Munadim Egyptian", price: 285,
    description: "Kofta, shish tawook and sausage off the charcoal, rice and tahina", ingredients: "Kofta, chicken shish tawook, beef sausage, rice, tahina, baladi bread", sort_order: 3 },
  // Munadim Sides — أطباق جانبية
  { name: "Munadim Fries", name_ar: "مُنادم فرايز", category: "Munadim Sides", price: 55, description: "Crispy fries with our spice dust", ingredients: "Potatoes, spice mix", sort_order: 1 },
  { name: "Munadim Loaded Fries", name_ar: "مُنادم لودد فرايز", category: "Munadim Sides", price: 105, description: "Fries under cheddar sauce, jalapeños and beef bits", ingredients: "Potatoes, cheddar sauce, jalapeños, beef bits, spring onion", bestseller: true, sort_order: 2 },
  { name: "Munadim Onion Rings", name_ar: "مُنادم أونيون رينجز", category: "Munadim Sides", price: 70, ingredients: "Onion, beer-style batter", sort_order: 3 },
  { name: "Munadim Mozzarella Sticks", name_ar: "مُنادم موتزاريلا ستيكس", category: "Munadim Sides", price: 95, ingredients: "Mozzarella, breadcrumbs, marinara dip", sort_order: 4 },
  { name: "Munadim Coleslaw", name_ar: "مُنادم كول سلو", category: "Munadim Sides", price: 40, ingredients: "Cabbage, carrot, mayo, lemon", sort_order: 5 },
  // Little Munadim — مُنادم الصغير
  { name: "Little Munadim Burger", name_ar: "مُنادم الصغير برجر", category: "Little Munadim", price: 120, description: "Kids burger with fries and a juice", ingredients: "Beef patty, cheese, ketchup, soft bun, fries", sort_order: 1 },
  { name: "Little Munadim Nuggets", name_ar: "مُنادم الصغير ناجتس", category: "Little Munadim", price: 115, description: "Six nuggets with fries and a juice", ingredients: "Chicken nuggets, fries, ketchup", sort_order: 2 },
  // Munadim Desserts — حلويات
  { name: "Munadim Om Ali", name_ar: "مُنادم أم علي", category: "Munadim Desserts", price: 80, description: "Baked hot with nuts, raisins and cream", ingredients: "Puff pastry, milk, cream, hazelnuts, raisins, coconut", bestseller: true, sort_order: 1 },
  { name: "Munadim Cookie", name_ar: "مُنادم كوكي", category: "Munadim Desserts", price: 75, description: "Warm triple-chocolate cookie", ingredients: "Flour, butter, dark chocolate, milk chocolate, white chocolate", sort_order: 2 },
  { name: "Munadim Milkshake Chocolate", name_ar: "مُنادم ميلك شيك شوكولاتة", category: "Munadim Desserts", price: 95, ingredients: "Milk, vanilla ice cream, chocolate sauce", sort_order: 3 },
  { name: "Munadim Milkshake Vanilla", name_ar: "مُنادم ميلك شيك فانيليا", category: "Munadim Desserts", price: 95, ingredients: "Milk, vanilla ice cream", sort_order: 4 },
  // Drinks — مشروبات
  { name: "Munadim Karkadeh", name_ar: "مُنادم كركديه", category: "Drinks", price: 45, description: "Our signature — hibiscus brewed cold, not too sweet", ingredients: "Hibiscus, sugar", bestseller: true, sort_order: 1 },
  { name: "Soft Drink", name_ar: "مشروب غازي", category: "Drinks", price: 35,
    options: [{ key: "which", label: "Which drink", required: true, choices: [{ name: "Coca - Cola" }, { name: "Coca - Cola Diet" }, { name: "Sprite" }, { name: "Fanta" }] }], sort_order: 2 },
  { name: "Mango Juice", name_ar: "عصير مانجا", category: "Drinks", price: 55, ingredients: "Mango", sort_order: 3 },
  { name: "Mineral Water", name_ar: "مياه معدنية", category: "Drinks", price: 15, sort_order: 4 },
  // Munadim Sauces — صوصات
  { name: "Munadim Sauce Cup", name_ar: "مُنادم صوص", category: "Munadim Sauces", price: 20, ingredients: "Mayo, ketchup, mustard, pickle, spices", sort_order: 1 },
  { name: "Ranch Cup", name_ar: "رانش صوص", category: "Munadim Sauces", price: 20, ingredients: "Buttermilk, herbs, garlic", sort_order: 2 },
  { name: "Garlic Toum Cup", name_ar: "تومية", category: "Munadim Sauces", price: 15, ingredients: "Garlic, oil, lemon", sort_order: 3 },
  { name: "Shatta Cup", name_ar: "شطة", category: "Munadim Sauces", price: 10, ingredients: "Chili, vinegar, garlic", sort_order: 4 },
];
const CATEGORIES = [
  { name: "Munadim Burgers", name_ar: "برجر مُنادم", sort: 1 },
  { name: "Munadim Chicken", name_ar: "فراخ مُنادم", sort: 2 },
  { name: "Munadim Egyptian", name_ar: "مصري مُنادم", sort: 3 },
  { name: "Munadim Sides", name_ar: "أطباق جانبية", sort: 4 },
  { name: "Little Munadim", name_ar: "مُنادم الصغير", sort: 5 },
  { name: "Munadim Desserts", name_ar: "حلويات", sort: 6 },
  { name: "Drinks", name_ar: "مشروبات", sort: 7 },
  { name: "Munadim Sauces", name_ar: "صوصات", sort: 8 },
];

async function stageRow() {
  // 1) logo → brand bucket (public, same bucket Luci'z uses)
  const bytes = fs.readFileSync(LOGO_LOCAL);
  const { error: upErr } = await createClient(tcreds.url, tcreds.key).storage.from("brand")
    .upload(LOGO_PATH, bytes, { contentType: "image/png", upsert: true });
  if (upErr) throw new Error(`logo upload: ${upErr.message}`);
  const logoUrl = `${tcreds.url}/storage/v1/object/public/brand/${LOGO_PATH}?v=1`;
  console.log("logo:", logoUrl);

  // 2) the restaurants row — wpid stays NULL until `swap`
  const row = {
    slug: "munadim", name: "Munadim",
    phone_number: null, wpid: null,
    integrations: { supabase: { ...tcreds, schema: "r_munadim" } },
    basic_info: {
      name: "Munadim", area: "New Cairo", city: "New Cairo",
      tagline: "مطبخ مصري بروح جديدة",
      vibe: "Smash burgers, crispy chicken and Egyptian favourites — done the Munadim way.",
      restaurant_type: "casual", language: "ar", timezone: "Africa/Cairo",
      brand: { mode: "light", primary: KARKADEH, logo_url: logoUrl },
      address: "Point 90 Mall, New Cairo", google_maps: "https://maps.google.com/?q=30.0203,31.4947",
      contact: { phone: "19331", whatsapp: "+201515066123" }, parking: "Mall parking", dress_code: "", policies: {}, services: { delivery: true, pickup: true, dine_in: true },
      branches: [{ key: "point90", name: "Point 90", address: "Point 90 Mall, New Cairo", lat: 30.0203, lng: 31.4947, hours: "10 AM – 2 AM" }],
      // proven New Cairo coverage: same polygon, landmarks and distance pricing as Luci'z
      delivery: luciz.basic_info.delivery,
    },
    hours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ open: "10:00", close: "02:00" }]])),
    sections: luciz.sections,
    reservation_policy: luciz.reservation_policy,
    payments: { tax: 0.14, methods: ["cash", "card", "instapay"], currency: "EGP", delivery_fee: 50 },
    ai: {
      name: "Munadim", greeting: "أهلاً بيك في مُنادم 🍔",
      personality: "Warm, proud of the food, Egyptian to the bone — talks like the friend who always knows what you should eat.",
      voice_mode: "auto", chat_enabled: true, orders_enabled: true,
      ask_type_first: true, compact_messages: true, suggest_enabled: true,
      suggest_dishes: ["Munadim Signature Burger"], pickup_prep_min: 15, pickup_smart_timing: true,
    },
    faqs: [
      { q: "Is the Nashville chicken spicy?", a: "You choose — mild, medium or hot." },
      { q: "بتفتحوا امتى؟", a: "كل يوم من ١٠ الصبح لـ ٢ بالليل." },
    ],
    menu_config: { categories: CATEGORIES, upsell: { enabled: true, placement: "confirm" }, display: luciz.menu_config?.display || {} },
    pos: luciz.pos || {},
  };
  const { data: existing } = await sb.from("restaurants").select("id").eq("slug", "munadim").maybeSingle();
  if (existing) { const { error } = await sb.from("restaurants").update(row).eq("id", existing.id); if (error) throw error; console.log("restaurants row UPDATED"); }
  else { const { error } = await sb.from("restaurants").insert(row); if (error) throw error; console.log("restaurants row INSERTED"); }
}

async function stageMenu() {
  const { error: probe } = await tdb.from("menu_items").select("id").limit(1);
  if (probe) throw new Error(`r_munadim not reachable — run migrations/042_tenant_schema_munadim.sql first (${probe.message})`);
  const { data: have } = await tdb.from("menu_items").select("name");
  const haveN = new Set((have || []).map((m) => m.name));
  let ins = 0;
  for (const m of MENU) {
    if (haveN.has(m.name)) continue;
    const { error } = await tdb.from("menu_items").insert({ available: true, ...m });
    if (error) throw new Error(`${m.name}: ${error.message}`);
    ins++;
  }
  console.log(`menu: ${ins} inserted, ${haveN.size} already there`);
  const { data: tbl } = await tdb.from("restaurant_tables").select("id").limit(1);
  if (!tbl?.length) {
    const { data: sample } = await createClient(tcreds.url, tcreds.key, { db: { schema: "r_luciz" } }).from("restaurant_tables").select("*").limit(1);
    const shape = sample?.[0] || {};
    for (let i = 1; i <= 10; i++) {
      const r = { table_number: `T${i}`, seats: i <= 6 ? 4 : 8, status: "available" };
      for (const k of Object.keys(r)) if (!(k in shape) && sample?.length) delete r[k];
      await tdb.from("restaurant_tables").insert(r).then(({ error }) => { if (error && i === 1) console.log("tables:", error.message); });
    }
    console.log("tables: T1–T10 attempted");
  }
}

async function stageSwap() {
  // the point of no return — only after `menu` succeeded and a local test order passed
  const { data: mun } = await sb.from("restaurants").select("id,wpid").eq("slug", "munadim").single();
  if (!mun) throw new Error("munadim row missing — run `row` first");
  const { error: e1 } = await sb.from("restaurants").update({ wpid: null, phone_number: null, plan_notes: `WhatsApp number moved to Munadim ${new Date().toISOString().slice(0, 10)}` }).eq("slug", "luciz");
  if (e1) throw e1;
  const { error: e2 } = await sb.from("restaurants").update({ wpid: luciz.wpid, phone_number: luciz.phone_number }).eq("slug", "munadim");
  if (e2) throw e2;
  console.log(`number moved: wpid ${luciz.wpid} + phone ${luciz.phone_number} → munadim (luciz cleared)`);
  console.log("NOTE: restart/redeploy flows so the tenant cache drops the old wpid mapping.");
}

async function stageStatus() {
  const { data: rows } = await sb.from("restaurants").select("slug,phone_number,wpid").in("slug", ["luciz", "munadim"]);
  console.log(rows);
  const { data: m, error } = await tdb.from("menu_items").select("name").limit(3);
  console.log("r_munadim reachable:", !error, error ? error.message : `${m.length}+ items`);
}

if (STAGE === "row") await stageRow();
else if (STAGE === "menu") await stageMenu();
else if (STAGE === "swap") await stageSwap();
else await stageStatus();
