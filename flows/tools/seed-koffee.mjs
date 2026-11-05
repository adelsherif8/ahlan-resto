// Koffee Kulture — dine-in chat-widget pilot (café chain: Arkan Plaza Sheikh Zayed + 6 New Cairo sites).
// Same staging shape as seed-munadim.mjs so the control plane never points at a half-built tenant:
//
//   node tools/seed-koffee.mjs row     # upload logo + insert/update the restaurants row (no WhatsApp number)
//   node tools/seed-koffee.mjs menu    # seed r_koffee menu + tables   (needs migrations/044_tenant_schema_koffee.sql run on the TENANT DB first)
//   node tools/seed-koffee.mjs menu --update   # push option/price/description changes to rows that already exist
//   node tools/seed-koffee.mjs status  # show where everything stands
//
// Menu sources (2026-11-05): the brand's own printed menu (menuegypt.com images, dated 2025-10-29 —
// sizes M/L, extras, add-ons, "all prices subject to 12% service charge") and the egmenus.com
// listing "updated September 2026" (newer prices for ~60 items, Arabic names). Where both give a
// price the newer egmenus one wins; items priced only on the 2025 print carry `price_note` so the
// founder can confirm them with the café before launch. Nothing here is invented.
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const STAGE = process.argv[2] || "status";
const SLUG = "koffee-kulture";
const SCHEMA = "r_koffee";
const sb = createClient(process.env.SUPABASE_AHLAN_URL, process.env.SUPABASE_AHLAN_SERVICE_KEY);
const { data: munadim } = await sb.from("restaurants").select("*").eq("slug", "munadim").single();
if (!munadim) throw new Error("munadim row missing — nothing to clone the tenant creds from");
const tcreds = munadim.integrations.supabase; // same tenant project, new schema
const tdb = createClient(tcreds.url, tcreds.key, { db: { schema: SCHEMA } });

const LOGO_LOCAL = process.env.KK_LOGO || "/private/tmp/claude-502/-Users-adel-Desktop-Ai-Squared-ai2-resto/a80d6965-57e2-4681-897f-35ed5dd8bb0e/scratchpad/kk/logo.jpg";
const LOGO_PATH = "koffee-kulture/logo.jpg";
const KK_GREEN = "#3DAE2B"; // the menu's brand green

// ---------- option groups ----------
const size = (m, l) => ({ key: "size", label: "Size", required: true, choices: [{ name: "Medium", price: m }, { name: "Large", price: l }] });
// `optional: true` groups are never asked — they apply only when the guest names a choice
// ("oat milk", "extra shot"); the barista's default stands otherwise (orderoptions.js).
// "KK extras" on the print: Shot 35 · Flavor 35 · Plant based milks 40 · Lactose free milk 35
const EXTRAS = { key: "extras", label: "Extras", optional: true, choices: [
  { name: "Extra shot", delta: 35 }, { name: "Extra flavor", delta: 35 }, { name: "Lactose-free", delta: 35 }, // not "…milk": "oat milk" must only hit the Milk group
] };
const MILK = { key: "milk", label: "Milk", optional: true, choices: [{ name: "Regular" }, { name: "Skim" }, { name: "Coconut", delta: 40 }, { name: "Oat", delta: 40 }] };
const SIDE = { key: "side", label: "Side", required: true, choices: [{ name: "Sweet potato fries" }, { name: "Savory salad" }] };
const BAGEL = { key: "bagel", label: "Bagel", optional: true, choices: [{ name: "Classic" }, { name: "Pretzel bagel", delta: 30 }, { name: "Jalapeño cheese bagel", delta: 30 }] };
const BREAD = { key: "bread", label: "Baguette", optional: true, choices: [{ name: "White" }, { name: "Brown" }] };
const DIP = { key: "dip", label: "Add a dip", optional: true, choices: [{ name: "No dip" }, { name: "Spicy mayo dip", delta: 15 }] };
const OMELETTE_ADDONS = { key: "addons", label: "Add-ons", optional: true, choices: [
  { name: "Avocado", delta: 35 }, { name: "Mushrooms", delta: 35 }, { name: "Turkey", delta: 45 }, { name: "Mixed veggies", delta: 30 }, { name: "Fried brie", delta: 45 },
] };
const CHEESECAKE_UP = { key: "topping", label: "Upgrade with", optional: true, choices: [{ name: "As is" }, { name: "Pistachio sauce", delta: 60 }, { name: "Caramel sauce", delta: 55 }, { name: "Chocolate sauce", delta: 55 }] };

const P2025 = "price from the 2025 print — confirm with the café";
let sort = 0;
const it = (category, name, price, extra = {}) => ({ name, category, price, sort_order: ++sort, ...extra });
const cold = (category, name, m, l, extra = {}) => it(category, name, m, { options: [size(m, l), MILK, EXTRAS], price_note: P2025, ...extra });

// ---------- the menu ----------
const MENU = [
  // HOT KOFFEE — egmenus Sept 2026 prices
  it("Hot Koffee", "Espresso", 80, { name_ar: "إسبريسو", options: [EXTRAS], price_note: P2025, description: "Double shot of the house blend" }),
  it("Hot Koffee", "Espresso Makkhiato", 85, { name_ar: "إسبريسو ماكياتو", options: [EXTRAS], price_note: P2025 }),
  it("Hot Koffee", "Amerikano", 100, { name_ar: "أمريكانو", options: [EXTRAS], description: "Espresso diluted with hot water" }),
  it("Hot Koffee", "Kortado", 110, { name_ar: "كورتادو", options: [EXTRAS, MILK], description: "Espresso, steamed milk with foam" }),
  it("Hot Koffee", "Flat White", 110, { name_ar: "فلات وايت", options: [EXTRAS, MILK], description: "Double espresso, steamed milk" }),
  it("Hot Koffee", "Kappuccino", 125, { name_ar: "كابتشينو", options: [EXTRAS, MILK], description: "Espresso, steamed milk foam" }),
  it("Hot Koffee", "Klassic Latte", 125, { name_ar: "لاتيه", options: [EXTRAS, MILK], description: "Espresso, steamed milk, thin foam", bestseller: true }),
  it("Hot Koffee", "KK Latte", 130, { name_ar: "كيه كيه لاتيه", options: [EXTRAS, MILK], description: "Less-sweet Spanish-style latte" }),
  it("Hot Koffee", "Spanish Latte", 135, { name_ar: "لاتيه أسباني", options: [EXTRAS, MILK], description: "Espresso, milk, condensed milk", bestseller: true }),
  it("Hot Koffee", "Spicy Spanish Latte", 135, { name_ar: "لاتيه إسباني سبايسي", options: [EXTRAS, MILK], description: "Spanish latte with cinnamon" }),
  it("Hot Koffee", "Salted Karamel Latte", 135, { name_ar: "لاتيه كراميل مملح", options: [EXTRAS, MILK], description: "Double espresso, steamed milk, salted caramel" }),
  it("Hot Koffee", "Salted Vanilla Latte", 140, { options: [EXTRAS, MILK], description: "Latte with salted vanilla" }),
  it("Hot Koffee", "Pistachio Latte", 175, { name_ar: "لاتيه بالفستق", options: [EXTRAS, MILK], description: "Espresso, steamed milk, pistachio syrup" }),
  it("Hot Koffee", "Honey Cinnamon Latte", 145, { name_ar: "لاتيه بالعسل والقرفة", options: [EXTRAS, MILK], description: "Double espresso, honey cinnamon sauce" }),
  it("Hot Koffee", "Klassic Mokka", 140, { name_ar: "موكا", options: [EXTRAS, MILK], description: "Latte with chocolate sauce" }),
  it("Hot Koffee", "White Mokka", 145, { name_ar: "وايت موكا", options: [EXTRAS, MILK], description: "Latte with white chocolate" }),

  // KOLD KOFFEE — M/L from the print
  cold("Kold Koffee", "Iced Amerikano", 90, 105, { name_ar: "أمريكانو مثلج", description: "Double espresso, cold water, ice" }),
  cold("Kold Koffee", "Iced Latte", 105, 125, { name_ar: "لاتيه مثلج", description: "Double espresso, cold milk, ice" }),
  cold("Kold Koffee", "Iced KK Latte", 115, 135, { description: "Iced coffee, light condensed milk" }),
  cold("Kold Koffee", "Iced Spanish Latte", 125, 145, { name_ar: "لاتيه اسباني مثلج", description: "Milk, espresso, condensed milk", bestseller: true }),
  cold("Kold Koffee", "Iced Spicy Spanish Latte", 125, 145, { description: "Condensed milk, cinnamon" }),
  cold("Kold Koffee", "Iced Salted Karamel Latte", 125, 145, { description: "Creamy, salted caramel syrup", bestseller: true }),
  cold("Kold Koffee", "Iced Salted Vanilla Latte", 125, 145, { description: "Cold coffee, vanilla, touch of salt" }),
  cold("Kold Koffee", "Iced White Mokka", 135, 155, { description: "Espresso, milk, white chocolate sauce" }),
  cold("Kold Koffee", "Iced Pistachio Latte", 165, 185, { name_ar: "لاتيه فستق مثلج" }),
  cold("Kold Koffee", "Iced Honey Cinnamon Latte", 135, 155, { description: "Cold coffee, honey, cinnamon" }),
  cold("Kold Koffee", "Iced Brown Sugar", 135, 155, { name_ar: "سكر بني مثلج", description: "Homemade brown sugar sauce" }),
  cold("Kold Koffee", "Iced Banana Bread Latte", 155, 175, { name_ar: "ايس بنانا بريد", description: "Banana, cinnamon, milk, ice" }),

  // BLENDED KOFFEE — M/L from the print
  cold("Blended Koffee", "Blended Salted Caramel Latte", 125, 145, { description: "Cold coffee, salted caramel, whipped cream, crushed ice" }),
  cold("Blended Koffee", "Blended Spicy Spanish Latte", 125, 145, { description: "Strong coffee, condensed milk, cinnamon, ice" }),
  cold("Blended Koffee", "Blended Spanish Latte", 125, 145, { name_ar: "لاتيه أسباني مخلوط", description: "Strong coffee, condensed milk, ice" }),
  cold("Blended Koffee", "Blended Pistachio Latte", 170, 190, { name_ar: "لاتيه فستق مخلوط" }),
  cold("Blended Koffee", "Blended White Mokka", 140, 160, { description: "White coffee, white chocolate, milk, ice" }),
  cold("Blended Koffee", "Blended Banana Bread Latte", 155, 175, { name_ar: "بليندد بنانا بريد" }),
  cold("Blended Koffee", "Koffee Frappe", 110, 130, { description: "Cold coffee, ice, milk, whipped" }),
  cold("Blended Koffee", "Karamel Koffee Frappe", 125, 145, { description: "Cold coffee, caramel, milk, whipped with ice" }),
  cold("Blended Koffee", "Mokka Frappe", 125, 145, { description: "Cold coffee, chocolate, milk, ice" }),

  // NON KOFFEE — coffee-free, M/L from the print
  cold("Non Koffee", "Karamel Klassic", 120, 135, { name_ar: "كراميل كلاسيك", description: "Coffee-free caramel drink" }),
  cold("Non Koffee", "Choko Klassic", 120, 135, { name_ar: "الشوكولاتة الكلاسيك", description: "Coffee-free chocolate drink" }),
  cold("Non Koffee", "Vanilla Klassic", 120, 135, { description: "Coffee-free vanilla drink" }),
  cold("Non Koffee", "Pistachio Klassic", 150, 175, { name_ar: "بيستاشيو كلاسيك", description: "Coffee-free pistachio drink" }),
  cold("Non Koffee", "Salted Karamel Klassic", 110, 125, { description: "Coffee-free salted caramel drink", bestseller: true }),

  // MATCHA KULTURE — hot = one size (egmenus Sept 2026), cold = M/L (print)
  it("Matcha Kulture", "Hot Matcha Latte", 150, { name_ar: "ماتشا لاتيه ساخن", options: [MILK, EXTRAS], description: "Best with skim or coconut milk" }),
  it("Matcha Kulture", "Hot White Matcha", 165, { options: [MILK, EXTRAS], price_note: P2025, description: "Matcha, white chocolate" }),
  it("Matcha Kulture", "Hot Honey Cinnamon Matcha", 165, { name_ar: "هوت هانى سنامون ماتشا", options: [MILK, EXTRAS], description: "Matcha, honey, cinnamon" }),
  it("Matcha Kulture", "Hot Salted Karamel Matcha", 165, { name_ar: "هوت سولتيد كراميل ماتشا", options: [MILK, EXTRAS], description: "Hot matcha, salted caramel sauce", bestseller: true }),
  it("Matcha Kulture", "Hot Salted Vanilla Matcha", 165, { options: [MILK, EXTRAS], description: "Matcha with salted vanilla" }),
  it("Matcha Kulture", "Hot Pistachio Matcha", 185, { name_ar: "هوت بستاشيو ماتشا", options: [MILK, EXTRAS], description: "Matcha, pistachio, hot milk" }),
  cold("Matcha Kulture", "Iced Matcha Latte", 140, 160, { name_ar: "ماتشا لاتيه مثلج" }),
  cold("Matcha Kulture", "Iced Spanish Matcha", 150, 170, { description: "Matcha, touch of condensed milk" }),
  cold("Matcha Kulture", "Iced Cherry Vanilla Matcha", 155, 175, { description: "Matcha, cherry, vanilla" }),
  cold("Matcha Kulture", "Iced Salted Vanilla Matcha", 150, 170, { description: "Matcha with salted vanilla" }),
  cold("Matcha Kulture", "Iced White Matcha", 160, 180, { name_ar: "ايس وايت ماتشا", description: "Matcha, white chocolate sauce, ice" }),
  cold("Matcha Kulture", "Iced Banana Bread Matcha", 155, 175, { name_ar: "ايس بنانا بريد ماتشا" }),
  cold("Matcha Kulture", "Blended Matcha", 155, 175, { name_ar: "ماتشا المخلوطة", description: "Matcha blended with milk", bestseller: true }),
  cold("Matcha Kulture", "Blended Strawberry Matcha", 165, 185, { name_ar: "بليندد استروبري ماتشا" }),
  cold("Matcha Kulture", "Blended Salted Karamel Matcha", 165, 185, { description: "Matcha, crushed ice, salted caramel" }),
  cold("Matcha Kulture", "Blended Pistachio Matcha", 180, 195, { name_ar: "بليندد بستاشيو ماتشا" }),
  cold("Matcha Kulture", "Blended White Matcha", 165, 185, { name_ar: "بليندد وايت ماتشا" }),
  cold("Matcha Kulture", "Blended Mango Matcha", 175, 195, { description: "Matcha, mango" }),
  cold("Matcha Kulture", "Strawberry Matcha", 165, 185, { description: "Matcha, strawberry sauce" }),
  cold("Matcha Kulture", "Blended Peachy Matcha", 165, 185, { description: "Matcha with fresh peach" }),
  cold("Matcha Kulture", "Blended Dirty Matcha", 165, 185, { name_ar: "بلندد ديرتى ماتشا", description: "Espresso blend with matcha" }),
  cold("Matcha Kulture", "Blended Banana Bread Matcha", 155, 175, { name_ar: "بليندد بنانا بريد ماتشا" }),
  cold("Matcha Kulture", "Raspberry Matcha", 165, 185, { name_ar: "رزبيري ماتشا", description: "Raspberry, matcha, milk, vanilla, ice" }),

  // REFRESHERS — egmenus Sept 2026 prices
  it("Refreshers Kulture", "Raspberry Mojito", 140, { name_ar: "موهيتو راسبيري", description: "Raspberry, mint, lemon, sugar", bestseller: true }),
  it("Refreshers Kulture", "Blueberry Mojito", 140, { name_ar: "موهيتو بلوبيري", description: "Blueberry, mint, lemon, sugar, ice" }),
  it("Refreshers Kulture", "Passion Mojito", 150, { name_ar: "باشن موهيتو", description: "Passion fruit, mint, lemon, sugar, ice" }),
  it("Refreshers Kulture", "Tropical Mojito", 145, { description: "Kiwi, pineapple, lime, peach" }),
  it("Refreshers Kulture", "Ocean Breeze", 150, { name_ar: "أوشن بريز", description: "Lemon soda, coconut, blue curaçao syrup", bestseller: true }),
  it("Refreshers Kulture", "Pink Redbull", 190, { name_ar: "بنك ريد بول", description: "Red Bull, whipped cream, strawberry, vanilla-cherry" }),
  it("Refreshers Kulture", "Coco Berry Redbull", 190, { name_ar: "كوكو بيرى ريد بول", description: "Red Bull, coconut, strawberry, raspberry", bestseller: true }),
  it("Refreshers Kulture", "Green Redbull", 190, { description: "Red Bull, green apple" }),
  it("Refreshers Kulture", "Bonbon Refresher", 155, { name_ar: "بونبون ريفريشر", description: "Pineapple, strawberry, blueberry, whipped cream, ice" }),
  it("Refreshers Kulture", "Peach Ice Tea", 130, { name_ar: "شاي مثلج بالخوخ" }),
  it("Refreshers Kulture", "Mango Passion Ice Tea", 140, { name_ar: "مانجو باشون ايس تى", description: "Iced tea, mango, peach" }),
  it("Refreshers Kulture", "Blueberry Lemonade", 130, { name_ar: "بلوبيري ليمونيد", description: "Lemon, blueberry, pineapple, soda" }),
  it("Refreshers Kulture", "Pina Colada Lemonade", 140, { name_ar: "بيناكولادا ليمونيد", description: "Coconut, lemon" }),
  it("Refreshers Kulture", "Passion Lemonade", 140, { name_ar: "باشون ليمونيد", description: "Passion fruit, lemon" }),
  it("Refreshers Kulture", "Sparkling Pink Lemonade", 140, { name_ar: "سباركلينج بينك ليمونيد", description: "Strawberry, raspberry, lemon, soda" }),
  it("Refreshers Kulture", "Still Water", 30, { description: "Natural water" }),
  it("Refreshers Kulture", "Sparkling Water", 45, { description: "Carbonated water" }),
  it("Refreshers Kulture", "Red Bull", 85, { name_ar: "ريد بول" }),

  // SMOOTHIES — egmenus Sept 2026 where listed
  it("Smoothies", "Love Story Smoothie", 170, { name_ar: "لاف ستوري سموزي", description: "Pineapple, passion fruit, peach", bestseller: true }),
  it("Smoothies", "Blueberry Smoothie", 135, { name_ar: "سموثي توت أزرق", description: "Fresh blueberry, touch of honey" }),
  it("Smoothies", "Pina Colada Smoothie", 170, { name_ar: "سموذي بنا كولادا", description: "Coconut, pineapple, cream, vanilla powder" }),
  it("Smoothies", "Lemon Mint Smoothie", 100, { price_note: P2025 }),

  // THE BAKERY KULTURE — egmenus Sept 2026
  it("The Bakery Kulture", "All Butter Kroissant", 80, { description: "Viennoise, butter-rich" }),
  it("The Bakery Kulture", "Pistachio Kroissant", 120, { description: "Pistachio sauce and pistachio filling, pistachio sourced from Italy" }),
  it("The Bakery Kulture", "Pistachio Konafa Kroissant", 180, { description: "Kunafa, pistachio sauce, chocolate sauce", bestseller: true }),
  it("The Bakery Kulture", "Almond Kroissant", 110, { description: "Almond cream, toasted sliced almonds" }),
  it("The Bakery Kulture", "Lotus Biscoff Kroissant", 110, { description: "Caramel biscuit spread" }),
  it("The Bakery Kulture", "Choko Kroissant", 110, { name_ar: "كرواسون شوكو", description: "Chocolate-filled" }),
  it("The Bakery Kulture", "Bueno Kroissant", 115, { description: "Kinder sauce" }),
  it("The Bakery Kulture", "Pain Au Chocolat", 95, { price_note: P2025 }),
  it("The Bakery Kulture", "Pain Suisse", 95, { price_note: P2025 }),
  it("The Bakery Kulture", "Caprese Kroissant", 250, { description: "Baby mozzarella, pesto, cherry tomatoes" }),
  it("The Bakery Kulture", "Turkey & Cheese Kroissant", 250, { price_note: P2025, description: "Melted cheddar, turkey, mayo pesto" }),
  it("The Bakery Kulture", "Labneh & Zaatar Kroissant", 270, { description: "Turkish labneh, fresh zaatar, molasses glaze" }),

  // THE EGG KULTURE — print (2025) prices; served with savory salad + roasted baby potatoes
  it("The Egg Kulture", "The LA Benedict", 320, { price_note: P2025, description: "Smoked salmon, avocado spread, dill hollandaise", bestseller: true }),
  it("The Egg Kulture", "Shroom Truffle Benedict", 225, { price_note: P2025, description: "Marinated mushrooms, sautéed spinach, cream cheese, truffle hollandaise" }),
  it("The Egg Kulture", "The Klassic Omelette", 190, { price_note: P2025, options: [OMELETTE_ADDONS], description: "Signature folded omelette with parmesan" }),
  it("The Egg Kulture", "Mushroom Invasion Omelette", 290, { price_note: P2025, description: "Thyme mushrooms, spinach cream, cheddar, fried brie", bestseller: true }),
  it("The Egg Kulture", "The Cheesy Omelette", 225, { price_note: P2025, description: "Walnuts, American, cheddar and parmesan" }),
  it("The Egg Kulture", "Savory Breakfast Bagel", 275, { price_note: P2025, options: [BAGEL], description: "Scrambled egg, marinated mushrooms, grilled halloumi, spinach" }),
  it("The Egg Kulture", "Sesame Weekday Bagel", 235, { price_note: P2025, description: "Avocado, arugula, fried egg, cream cheese, crushed pepper; with hash browns" }),
  it("The Egg Kulture", "Turkey Mix Tortilla", 290, { price_note: P2025, description: "Turkey, white cheddar, herbs, scrambled eggs in toasted tortilla" }),

  // THE BAGELS KULTURE — egmenus Sept 2026 where listed; served with sweet potato fries or salad
  it("The Bagels Kulture", "Cream Cheese Bagel", 170, { name_ar: "بيغل جبنة كريمي", options: [BAGEL, SIDE] }),
  it("The Bagels Kulture", "All-Time Favorite Bagel", 235, { price_note: P2025, options: [BAGEL, SIDE], description: "Turkey, emmental, lettuce, pickles, pesto mayo", bestseller: true }),
  it("The Bagels Kulture", "Italian Twist Bagel", 275, { name_ar: "تويست إيطالي", options: [BAGEL, SIDE], description: "Baby mozzarella, pesto, tomato, balsamic vinaigrette" }),
  it("The Bagels Kulture", "4 Cheese Garlic Bagel", 275, { name_ar: "فور تشيز جارليك", options: [BAGEL, SIDE], description: "Cream cheese, emmental, cheddar, parmesan, garlic, thyme" }),
  it("The Bagels Kulture", "Lunch Bagel", 285, { name_ar: "بيغل الغداء", options: [BAGEL, SIDE], description: "Grilled chicken, homemade Caesar dressing, parmesan" }),
  it("The Bagels Kulture", "Smoked to Perfection Bagel", 385, { options: [BAGEL, SIDE], description: "Smoked salmon, onion cream cheese, capers, dill" }),
  it("The Bagels Kulture", "Philly Steak Bagel", 395, { name_ar: "فيلي ستيك بيجل", options: [BAGEL, SIDE], description: "Steak fillet, mushrooms, cheddar" }),
  it("The Bagels Kulture", "Ultimate Halloumi Bagel", 285, { name_ar: "ألتميت حلومي", options: [BAGEL, SIDE], description: "Grilled halloumi, sun-dried tomato, pesto, arugula" }),
  it("The Bagels Kulture", "We've Got Beef Bagel", 295, { options: [BAGEL, SIDE], description: "Roast beef, pickled red onion, mascarpone, emmental, arugula" }),
  it("The Bagels Kulture", "Kulture Bagel", 390, { name_ar: "بيغل كالتشر", options: [BAGEL, SIDE], description: "Salmon, avocado, guacamole, honey mustard" }),
  it("The Bagels Kulture", "Salty Beef Truffle Bagel", 350, { options: [BAGEL, SIDE], description: "Roast beef, mustard mayo, arugula, caramelised onion, truffle oil" }),
  it("The Bagels Kulture", "Spicy Tunacado Bagel", 280, { name_ar: "سبايسي تونكادو بيغل", options: [BAGEL, SIDE], description: "Tuna on pesto, tomato, jalapeño, guacamole" }),
  it("The Bagels Kulture", "Sriracha Bagel", 350, { name_ar: "بيجل سيراتشا", options: [BAGEL, SIDE], description: "Grilled spicy chicken, sriracha mayo, cheese jalapeño bagel" }),

  // THE SANDWICH KULTURE — egmenus Sept 2026; white or brown baguette, sweet potato fries or salad
  it("The Sandwich Kulture", "Sub Out", 290, { name_ar: "صب أوت", options: [BREAD, SIDE, DIP], description: "Avocado, sun-dried tomato, chicken, sweet chili mayo" }),
  it("The Sandwich Kulture", "The Everything Klub", 325, { price_note: P2025, options: [BREAD, SIDE, DIP], description: "Roast beef, smoked turkey, cheddar, guacamole in toasted loaf" }),
  it("The Sandwich Kulture", "The Basic S", 400, { name_ar: "ذا بيزيك إس", options: [BREAD, SIDE, DIP], description: "Smoked salmon, capers, arugula, onion cream cheese" }),
  it("The Sandwich Kulture", "Philly Steak Wich", 400, { options: [BREAD, SIDE, DIP], description: "Caramelised beef steak, mushrooms, cheddar" }),
  it("The Sandwich Kulture", "Tahini Twist", 310, { name_ar: "تويست طحينة", options: [BREAD, SIDE, DIP], description: "Grilled chicken, guacamole, parmesan, tahini ranch" }),
  it("The Sandwich Kulture", "Spicy Tunacado", 310, { name_ar: "توناكادو سبايسي", options: [BREAD, SIDE, DIP], description: "Tuna on pesto, tomato, jalapeño, guacamole" }),
  it("The Sandwich Kulture", "Lazy Cheesy Toastie", 275, { name_ar: "تشيزي توستي", options: [SIDE], description: "Sourdough, cheddar mix, marinated mushrooms, truffle oil" }),

  // FLAT SOURDOUGH LOAFS — print prices
  it("Flat Sourdough Loafs", "Beetroot Hummus Avocado", 220, { price_note: P2025, description: "Vegan" }),
  it("Flat Sourdough Loafs", "Avocado on Toast", 230, { price_note: P2025 }),
  it("Flat Sourdough Loafs", "Halloumi Honey Avo on Toast", 285, { price_note: P2025 }),
  it("Flat Sourdough Loafs", "Caprese Avo on Toast", 285, { price_note: P2025 }),
  it("Flat Sourdough Loafs", "Salmon Avo on Toast", 315, { price_note: P2025 }),

  // SALADS — egmenus Sept 2026 where listed
  it("The Salad Klub", "The KK Caesar", 320, { name_ar: "ذا كي كي سلطة سيزر", description: "Baby mozzarella, pesto, grilled chicken skewers, Caesar dressing" }),
  it("The Salad Klub", "BBQ Rainbow", 320, { name_ar: "سلطة راينبو باربكيو", description: "Cherry tomatoes, black and red beans, corn, BBQ chicken, cheddar, ranch" }),
  it("The Salad Klub", "Mood Booster Bomb", 330, { name_ar: "سلطة مود بومب بوستر", description: "Grilled halloumi, avocado, pomegranate, walnuts, goat cheese, lemon mint dressing" }),
  it("The Salad Klub", "Well B Mex Chicken", 290, { name_ar: "ويل بي دجاج مكيس", description: "Grilled chicken, black beans, Batavia lettuce, roasted red pepper" }),
  it("The Salad Klub", "Well B Triple S", 295, { price_note: P2025 }),
  it("The Salad Klub", "Well B Sweet Earth", 190, { price_note: P2025 }),
  it("The Salad Klub", "Well B S.A.SS", 365, { price_note: P2025 }),
  it("The Salad Klub", "Well B OPA Greece", 250, { price_note: P2025 }),
  it("The Salad Klub", "Well B Bresaola", 290, { price_note: P2025 }),

  // SIDES — egmenus Sept 2026
  it("Sides", "Sweet Potato Fries", 80, { name_ar: "سويت بوتيتو", bestseller: true }),
  it("Sides", "Hash Brown", 85, { name_ar: "هاش براون", description: "Two crispy hash browns" }),

  // PANCAKES — egmenus Sept 2026
  it("Pancakes", "Pistachio Pancakes", 370, { name_ar: "بان كيك بستاشيو", description: "Pistachio sauce, fresh cream, toasted pistachio" }),
  it("Pancakes", "Nutella Lovers Pancakes", 325, { name_ar: "بان كيك عشاق النوتيلا" }),
  it("Pancakes", "Maple Pancakes", 305, { name_ar: "بان كيك مابل", description: "Maple syrup, butter, fresh fruit" }),
  it("Pancakes", "Salted Pecan Pancakes", 345, { name_ar: "بان كيك سولتيد بيكان" }),
  it("Pancakes", "Kinder Bueno Pancakes", 355, { name_ar: "بان كيك كيندر بوينو" }),

  // SWEET TOOTH — egmenus Sept 2026 where listed
  it("Sweet Tooth Kulture", "San Sebastian Cheesecake", 195, { name_ar: "تشيز كيك سان سيباستيان", options: [CHEESECAKE_UP], bestseller: true }),
  it("Sweet Tooth Kulture", "EBY's Millefeuille", 250, { price_note: P2025 }),
  it("Sweet Tooth Kulture", "Chokolate Kake", 150, { price_note: P2025 }),
  it("Sweet Tooth Kulture", "Karrot Kake", 145, { price_note: P2025 }),
  it("Sweet Tooth Kulture", "Mini Lotus Biscoff Cheesecake", 75, { price_note: P2025 }),
  it("Sweet Tooth Kulture", "Mini Salted Karamel Pretzel Cheesecake", 95, { name_ar: "ميني تشيزكيك بريتزل كراميل مملح" }),
  it("Sweet Tooth Kulture", "Tiramisu Jar", 190, { name_ar: "جرة تيراميسو", description: "Made with our koffee" }),
  it("Sweet Tooth Kulture", "Vanilla Berry Cake", 240, { name_ar: "فانيليا بيري كيك" }),
  it("Sweet Tooth Kulture", "Salted Caramel Tres Leches", 245),
  it("Sweet Tooth Kulture", "Almond Salted Caramel Cake", 245, { name_ar: "الموند سولتيد كراميل كيك" }),
  it("Sweet Tooth Kulture", "Chocolate Chip Cookie", 100),
  it("Sweet Tooth Kulture", "Double Chocolate Chip Cookie", 100, { name_ar: "دبل شوكليت شيب كوكيز" }),
  it("Sweet Tooth Kulture", "Kinder Cookie", 115, { name_ar: "كيندر كوكيز" }),
  it("Sweet Tooth Kulture", "Brookies", 110, { name_ar: "بروكيز" }),
  it("Sweet Tooth Kulture", "Chocolate Kan Kake", 170, { price_note: P2025 }),
  it("Sweet Tooth Kulture", "Chocolate Espresso Kan Kake", 170, { price_note: P2025 }),
  it("Sweet Tooth Kulture", "Birthday Kan Kake", 145, { price_note: P2025 }),
  it("Sweet Tooth Kulture", "Almond Karrot Kan Kake", 145, { price_note: P2025 }),
  it("Sweet Tooth Kulture", "Lemon Berry Kan Kake", 160, { price_note: P2025 }),
  it("Sweet Tooth Kulture", "Brownie Kan Kake", 220, { name_ar: "براوني كان كيك" }),
  it("Sweet Tooth Kulture", "Brownies Salted Caramel Kan Kake", 245, { name_ar: "براونيز سولتيد كراميل كان كيك" }),

  it("Retail", "KK Coffee Beans", 675, { description: "Brazilian and Colombian arabica blend" }),
];

const CATEGORIES = [
  "Hot Koffee", "Kold Koffee", "Blended Koffee", "Non Koffee", "Matcha Kulture", "Refreshers Kulture", "Smoothies",
  "The Bakery Kulture", "The Egg Kulture", "The Bagels Kulture", "The Sandwich Kulture", "Flat Sourdough Loafs",
  "The Salad Klub", "Sides", "Pancakes", "Sweet Tooth Kulture", "Retail",
].map((name, i) => ({ name, sort: i + 1 }));

// menu_items has no price_note column — it rides in `notes_internal`-style metadata; keep it in the
// description tail only when present so a human sees it in the dashboard menu editor.
const toRow = ({ price_note, ...m }) => ({
  available: true, ...m,
  ...(price_note ? { description: [m.description, `(${price_note})`].filter(Boolean).join(" ") } : {}),
});

// ---------- branches ----------
// Coordinates: Arkan from Tripadvisor's map link; District 5, Golf Central, Mivida Lake District and
// Villette (Ivory) geocoded from the compound names; U Venues and O1 are mall names the geocoder
// could not place — confirm those two with the café before the QR codes are printed.
const BRANCHES = [
  { key: "arkan", name: "Arkan Plaza", address: "Arkan Plaza, Sheikh Zayed", area: "Sheikh Zayed", lat: 30.02089, lng: 31.003292, hours: "7:30 AM – 12 AM" },
  { key: "uvenues", name: "U Venues", address: "U Venues Mall, New Cairo", area: "New Cairo", lat: null, lng: null, hours: "7:30 AM – 12 AM", note: "coordinates to confirm" },
  { key: "district5", name: "District 5", address: "District 5, New Cairo", area: "New Cairo", lat: 29.95599, lng: 31.45211, hours: "7:30 AM – 12 AM" },
  { key: "o1", name: "O1 Kitchen Mall", address: "O1 Kitchen Mall, New Cairo", area: "New Cairo", lat: null, lng: null, hours: "7:30 AM – 12 AM", note: "coordinates to confirm" },
  { key: "golfcentral", name: "Golf Central", address: "Golf Central, Palm Hills", area: "6th of October", lat: 29.99399, lng: 31.04306, hours: "7:30 AM – 12 AM" },
  { key: "mivida", name: "Lake District Mivida", address: "Lake District, Mivida, New Cairo", area: "New Cairo", lat: 30.00789, lng: 31.53549, hours: "7:30 AM – 12 AM" },
  { key: "ivory", name: "Ivory Sodic", address: "Ivory, Villette by Sodic, New Cairo", area: "New Cairo", lat: 30.02018, lng: 31.54693, hours: "7:30 AM – 12 AM" },
];

async function stageRow() {
  let logoUrl = null;
  if (fs.existsSync(LOGO_LOCAL)) {
    const { error: upErr } = await createClient(tcreds.url, tcreds.key).storage.from("brand")
      .upload(LOGO_PATH, fs.readFileSync(LOGO_LOCAL), { contentType: "image/jpeg", upsert: true });
    if (upErr) throw new Error(`logo upload: ${upErr.message}`);
    logoUrl = `${tcreds.url}/storage/v1/object/public/brand/${LOGO_PATH}?v=1`;
    console.log("logo:", logoUrl);
  } else console.log("logo: local file missing — set KK_LOGO=<path>; continuing without");

  const row = {
    slug: SLUG, name: "Koffee Kulture",
    phone_number: null, wpid: null, // no WhatsApp number — the chat widget is the channel
    integrations: { supabase: { ...tcreds, schema: SCHEMA } },
    basic_info: {
      name: "Koffee Kulture", name_ar: "كوفي كالتشر", area: "Sheikh Zayed & New Cairo", city: "Cairo",
      tagline: "Different People, Different Kultures, Different KOFFEE KUPS.",
      vibe: "Specialty koffee and breakfast kulture — croissants, bagels, matcha and a serious espresso bar.",
      restaurant_type: "casual", // "casual" = the walk-in ORDER engine (master.js gates on it); a café is one
      language: "en", timezone: "Africa/Cairo",
      brand: { mode: "light", primary: KK_GREEN, ...(logoUrl ? { logo_url: logoUrl } : {}) },
      address: "Arkan Plaza, Sheikh Zayed", google_maps: "https://maps.google.com/?q=30.02089,31.003292",
      contact: { phone: "01034999123", email: "amina@koffee-kulture.com" }, parking: "Mall parking", dress_code: "",
      policies: { service_charge: "12% service charge on dine-in" },
      // DINE-IN ONLY for the pilot: the widget sits on the table, nothing leaves the café
      services: { delivery: false, pickup: false, dine_in: true },
      branches: BRANCHES,
      delivery: { enabled: false, zones: [] },
    },
    hours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ open: "07:30", close: "00:00" }]])),
    sections: munadim.sections,
    reservation_policy: munadim.reservation_policy,
    payments: { tax: 0.14, service_charge: 12, methods: ["cash", "card"], currency: "EGP" },
    ai: {
      name: "KK", greeting: "Welcome to Koffee Kulture ☕ What can I get you?",
      personality: "Easy-going specialty-coffee barista — knows the beans, suggests the matcha, never pushy.",
      voice_mode: "auto", chat_enabled: true, orders_enabled: true,
      // table comes from the QR token, so the type question never fires
      ask_type_first: false, default_order_type: "dine_in", compact_messages: true,
      suggest_enabled: true, suggest_dishes: ["Pistachio Konafa Kroissant", "Hot Salted Karamel Matcha"],
      closed_orders: "refuse",
      // table-identity rules for the widget (docs/KOFFEE-KULTURE-DINE-IN.md)
      dine_in_widget: { enabled: true, table_token_ttl_min: 180, geofence_m: 120, geofence_required: true, showroom_tables: ["DEMO"] },
      demo_mode: false,
    },
    faqs: [
      { q: "Do you have plant-based milk?", a: "Yes — oat and coconut, 40 EGP extra on any drink." },
      { q: "Is there a service charge?", a: "12% on dine-in bills." },
      { q: "What time do you open?", a: "Every day 7:30 AM to midnight." },
    ],
    menu_config: { categories: CATEGORIES, upsell: { enabled: true, placement: "confirm" }, display: munadim.menu_config?.display || {} },
    // ticket lines route to the bar or kitchen screen by category
    pos: { stations: [{ name: "Bar", cats: "Hot Koffee, Kold Koffee, Blended Koffee, Non Koffee, Matcha Kulture, Refreshers Kulture, Smoothies" }, { name: "Kitchen", cats: "The Bakery Kulture, The Egg Kulture, The Bagels Kulture, The Sandwich Kulture, Flat Sourdough Loafs, The Salad Klub, Sides, Pancakes, Sweet Tooth Kulture, Retail" }] },
  };
  const { data: existing } = await sb.from("restaurants").select("id").eq("slug", SLUG).maybeSingle();
  if (existing) { const { error } = await sb.from("restaurants").update(row).eq("id", existing.id); if (error) throw error; console.log("restaurants row UPDATED"); }
  else { const { error } = await sb.from("restaurants").insert(row); if (error) throw error; console.log("restaurants row INSERTED"); }
}

async function stageMenu() {
  const { error: probe } = await tdb.from("menu_items").select("id").limit(1);
  if (probe) throw new Error(`${SCHEMA} not reachable — run migrations/044_tenant_schema_koffee.sql on the TENANT DB first (${probe.message})`);
  const { data: have } = await tdb.from("menu_items").select("name");
  const haveN = new Set((have || []).map((m) => m.name));
  let ins = 0;
  const UPDATE = process.argv.includes("--update");
  let upd = 0;
  for (const m of MENU) {
    if (haveN.has(m.name)) {
      if (!UPDATE) continue;
      const { price_note, ...row } = toRow(m);
      const { error } = await tdb.from("menu_items").update({ price: row.price, options: row.options || [], description: row.description || null, name_ar: row.name_ar || null, category: row.category, bestseller: !!row.bestseller, sort_order: row.sort_order }).eq("name", m.name);
      if (error) throw new Error(`${m.name}: ${error.message}`);
      upd++; continue;
    }
    const { error } = await tdb.from("menu_items").insert(toRow(m));
    if (error) throw new Error(`${m.name}: ${error.message}`);
    ins++;
  }
  console.log(`menu: ${ins} inserted, ${upd} updated, ${haveN.size} already there (${MENU.length} in the seed)`);
  const { data: tbl } = await tdb.from("restaurant_tables").select("id").limit(1);
  if (!tbl?.length) {
    // 12 tables per branch for the pilot sites; the QR token carries branch + table
    const rows = [];
    for (const b of BRANCHES.slice(0, 2)) for (let i = 1; i <= 12; i++) rows.push({ table_number: `${b.key === "arkan" ? "A" : "U"}${i}`, section: i <= 8 ? "indoor" : "outdoor", capacity: i % 4 === 0 ? 6 : 4, status: "free", branch: b.name });
    const { error } = await tdb.from("restaurant_tables").insert(rows);
    console.log(error ? `tables: ${error.message}` : `tables: ${rows.length} inserted (A1–A12 Arkan, U1–U12 U Venues)`);
  }
}

async function stageStatus() {
  const { data: r } = await sb.from("restaurants").select("slug,name,phone_number,wpid,ai").eq("slug", SLUG).maybeSingle();
  console.log("restaurants row:", r ? `present (dine_in_widget=${JSON.stringify(r.ai?.dine_in_widget)})` : "MISSING — run `row`");
  const { data: m, error } = await tdb.from("menu_items").select("name").limit(1000);
  console.log(`${SCHEMA} menu:`, error ? `not reachable (${error.message}) — run migrations/044_tenant_schema_koffee.sql` : `${m.length} items`);
  const { data: t } = await tdb.from("restaurant_tables").select("table_number").limit(100).catch?.(() => ({ data: null })) || {};
  if (t) console.log("tables:", t.length);
  const flagged = MENU.filter((x) => x.price_note).length;
  console.log(`seed: ${MENU.length} items, ${flagged} carry a 2025-print price to confirm, ${CATEGORIES.length} categories, ${BRANCHES.length} branches`);
}

const stages = { row: stageRow, menu: stageMenu, status: stageStatus };
if (!stages[STAGE]) { console.error("stages: row | menu | status"); process.exit(1); }
await stages[STAGE]();
