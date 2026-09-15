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

// ---------- the menu: Egyptian modern, built to exercise every bot feature ----------
const spice = { key: "spice", label: "Spice Level", choices: [{ name: "Mild" }, { name: "Medium" }, { name: "Hot 🔥" }] };
const drinks = [{ name: "Coca - Cola" }, { name: "Coca - Cola Diet" }, { name: "Sprite" }, { name: "Fanta" }, { name: "Karkadeh" }];
const combo = (sand, comboPrice) => ([
  { key: "format", label: "Which one", required: true, choices: [{ name: "Sandwich", price: sand }, { name: "Combo (fries + drink)", price: comboPrice }] },
  { key: "drink", when: { format: "Combo" }, label: "Combo drink", choices: drinks },
]);
const MENU = [
  // Sandwiches — سندوتشات
  { name: "Hawawshi Classic", name_ar: "حواوشي كلاسيك", category: "Sandwiches", price: 95, options: combo(95, 150),
    description: "Baladi bread stuffed with spiced minced beef, baked till crackling", ingredients: "Baladi bread, minced beef, onion, green pepper, baladi spices", bestseller: true, pairs_with: "Karkadeh", sort_order: 1 },
  { name: "Hawawshi Cheese", name_ar: "حواوشي بالجبنة", category: "Sandwiches", price: 110, options: combo(110, 165),
    description: "The classic with molten roumy cheese through the middle", ingredients: "Baladi bread, minced beef, roumy cheese, onion, green pepper, baladi spices", sort_order: 2 },
  { name: "Chicken Shawarma", name_ar: "شاورما فراخ", category: "Sandwiches", price: 85, options: combo(85, 140),
    description: "Marinated chicken off the spit, garlic sauce, pickles, syrian bread", ingredients: "Chicken, garlic sauce, pickles, syrian bread", bestseller: true, pairs_with: "Fries", sort_order: 3 },
  { name: "Beef Shawarma", name_ar: "شاورما لحمة", category: "Sandwiches", price: 100, options: combo(100, 155),
    description: "Beef shawarma, tahina, onion, parsley, tomato, syrian bread", ingredients: "Beef, tahina, onion, parsley, tomato, syrian bread", sort_order: 4 },
  { name: "Kofta Pita", name_ar: "كفتة في عيش بلدي", category: "Sandwiches", price: 90, options: [spice],
    description: "Charcoal kofta in baladi bread with tahina and salata baladi", ingredients: "Kofta (beef and lamb), tahina, tomato, onion, parsley, baladi bread", sort_order: 5 },
  { name: "Sausage Sandwich", name_ar: "سجق اسكندراني", category: "Sandwiches", price: 80, options: [spice],
    description: "Alexandrian sausage with peppers and onion, proper heat", ingredients: "Beef sausage, green pepper, onion, tomato, chili, baladi bread", sort_order: 6 },
  // Bowls & Plates — أطباق
  { name: "Koshary Bowl", name_ar: "طبق كشري", category: "Bowls & Plates", price: 70,
    options: [{ key: "size", label: "Size", required: true, choices: [{ name: "Regular", price: 70 }, { name: "Large", price: 95 }] }],
    description: "Rice, lentils, pasta, hummus, crispy onion, dakka and tomato sauce", ingredients: "Rice, brown lentils, pasta, chickpeas, fried onion, tomato sauce, garlic vinegar, chili oil", bestseller: true, pairs_with: "Sobia", sort_order: 1 },
  { name: "Chicken Shawarma Bowl", name_ar: "بول شاورما فراخ بالرز", category: "Bowls & Plates", price: 130,
    description: "Chicken shawarma over rice with garlic sauce and pickles", ingredients: "Chicken, rice, garlic sauce, pickles, parsley", sort_order: 2 },
  { name: "Half Grilled Chicken Plate", name_ar: "نص فرخة مشوية", category: "Bowls & Plates", price: 180, options: [spice],
    description: "Charcoal half chicken with rice, tahina and green salad", ingredients: "Chicken, rice, tahina, green salad, baladi bread", sort_order: 3 },
  { name: "Kofta Plate", name_ar: "طبق كفتة", category: "Bowls & Plates", price: 170,
    description: "Six charcoal kofta fingers, rice, tahina, salata baladi", ingredients: "Kofta (beef and lamb), rice, tahina, tomato, onion, parsley", sort_order: 4 },
  // From the Grill — مشويات
  { name: "Mixed Grill", name_ar: "مشكل مشويات", category: "From the Grill", price: 260,
    description: "Kofta, shish tawook and sausage off the charcoal, for one hungry person", ingredients: "Kofta, chicken shish tawook, beef sausage, rice, tahina, baladi bread", bestseller: true, pairs_with: "Karkadeh", sort_order: 1 },
  { name: "Shish Tawook Skewers", name_ar: "شيش طاووق", category: "From the Grill", price: 150, options: [spice],
    description: "Two chicken skewers marinated overnight, with rice and garlic sauce", ingredients: "Chicken, garlic sauce, rice, baladi bread", sort_order: 2 },
  // Sides — جانبي
  { name: "Fries", name_ar: "بطاطس", category: "Sides", price: 45, description: "Crispy fries with our spice mix", ingredients: "Potatoes, spice mix", sort_order: 1 },
  { name: "Spicy Fries", name_ar: "بطاطس حارة", category: "Sides", price: 55, description: "Fries tossed in shatta butter", ingredients: "Potatoes, chili, butter, garlic", sort_order: 2 },
  { name: "Tahina Salad", name_ar: "سلطة طحينة", category: "Sides", price: 30, ingredients: "Tahina, lemon, garlic, cumin", sort_order: 3 },
  { name: "Baba Ghanoush", name_ar: "بابا غنوج", category: "Sides", price: 40, ingredients: "Grilled eggplant, tahina, garlic, lemon", sort_order: 4 },
  { name: "Green Salad", name_ar: "سلطة خضرا", category: "Sides", price: 35, ingredients: "Tomato, cucumber, onion, parsley, lemon", sort_order: 5 },
  { name: "Pickles Plate", name_ar: "طبق طرشي", category: "Sides", price: 20, ingredients: "Pickled turnip, carrot, cucumber, lemon", sort_order: 6 },
  // Desserts — حلويات
  { name: "Om Ali", name_ar: "أم علي", category: "Desserts", price: 75, description: "Baked hot with nuts, raisins and cream", ingredients: "Puff pastry, milk, cream, hazelnuts, raisins, coconut", bestseller: true, sort_order: 1 },
  { name: "Rice Pudding", name_ar: "رز بلبن", category: "Desserts", price: 50, ingredients: "Rice, milk, cream, vanilla", sort_order: 2 },
  { name: "Basbousa", name_ar: "بسبوسة", category: "Desserts", price: 45, ingredients: "Semolina, syrup, coconut, cream", sort_order: 3 },
  // Drinks — مشروبات
  { name: "Karkadeh", name_ar: "كركديه", category: "Drinks", price: 40, description: "Our signature — hibiscus brewed cold, not too sweet", ingredients: "Hibiscus, sugar", bestseller: true, sort_order: 1 },
  { name: "Soft Drink", name_ar: "مشروب غازي", category: "Drinks", price: 30,
    options: [{ key: "which", label: "Which drink", required: true, choices: [{ name: "Coca - Cola" }, { name: "Coca - Cola Diet" }, { name: "Sprite" }, { name: "Fanta" }] }], sort_order: 2 },
  { name: "Mango Juice", name_ar: "عصير مانجا", category: "Drinks", price: 55, ingredients: "Mango, nothing else", sort_order: 3 },
  { name: "Sobia", name_ar: "سوبيا", category: "Drinks", price: 45, ingredients: "Coconut, milk, sugar", sort_order: 4 },
  { name: "Mineral Water", name_ar: "مياه معدنية", category: "Drinks", price: 15, sort_order: 5 },
  // Sauces — صوصات
  { name: "Tahina Cup", name_ar: "طحينة", category: "Sauces", price: 15, sort_order: 1 },
  { name: "Garlic Sauce Cup", name_ar: "تومية", category: "Sauces", price: 15, sort_order: 2 },
  { name: "Shatta Cup", name_ar: "شطة", category: "Sauces", price: 10, sort_order: 3 },
];
const CATEGORIES = [
  { name: "Sandwiches", name_ar: "سندوتشات", sort: 1 },
  { name: "Bowls & Plates", name_ar: "أطباق", sort: 2 },
  { name: "From the Grill", name_ar: "مشويات", sort: 3 },
  { name: "Sides", name_ar: "أطباق جانبية", sort: 4 },
  { name: "Desserts", name_ar: "حلويات", sort: 5 },
  { name: "Drinks", name_ar: "مشروبات", sort: 6 },
  { name: "Sauces", name_ar: "صوصات", sort: 7 },
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
      vibe: "Modern Egyptian comfort food — hawawshi, koshary and charcoal grill done properly.",
      restaurant_type: "casual", language: "ar", timezone: "Africa/Cairo",
      brand: { mode: "light", primary: KARKADEH, logo_url: logoUrl },
      address: "Point 90 Mall, New Cairo", google_maps: "https://maps.google.com/?q=30.0203,31.4947",
      contact: {}, parking: "Mall parking", dress_code: "", policies: {}, services: { delivery: true, pickup: true, dine_in: true },
      branches: [{ key: "point90", name: "Point 90", address: "Point 90 Mall, New Cairo", lat: 30.0203, lng: 31.4947, hours: "10 AM – 2 AM" }],
      // proven New Cairo coverage: same polygon, landmarks and distance pricing as Luci'z
      delivery: luciz.basic_info.delivery,
    },
    hours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ open: "10:00", close: "02:00" }]])),
    sections: luciz.sections,
    reservation_policy: luciz.reservation_policy,
    payments: { tax: 0.14, methods: ["cash", "card", "instapay"], currency: "EGP", delivery_fee: 50 },
    ai: {
      name: "Munadim", greeting: "أهلاً بيك في مُنادم 🍲",
      personality: "Warm, proud of the food, Egyptian to the bone — talks like the friend who always knows what you should eat.",
      voice_mode: "auto", chat_enabled: true, orders_enabled: true,
      ask_type_first: true, compact_messages: true, suggest_enabled: true,
      suggest_dishes: ["Hawawshi Classic"], pickup_prep_min: 15, pickup_smart_timing: true,
    },
    faqs: [
      { q: "Is the hawawshi spicy?", a: "You choose — mild, medium or hot. The sausage runs hot by nature." },
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
