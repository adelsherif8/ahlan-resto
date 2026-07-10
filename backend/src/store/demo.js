// In-memory demo tenant: seeded data + a repo implementing the same interface
// as the Supabase repo (list/get/insert/update/remove). Mutations persist until restart.
import crypto from "node:crypto";

const uid = () => crypto.randomUUID();
// Local dates (not UTC) so "today" matches what staff see on the dashboard
const localDate = (d) => d.toLocaleDateString("en-CA");
const todayISO = () => localDate(new Date());
function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
}

export const demoRestaurant = {
  id: "demo-resto-001",
  slug: "nine29-demo",
  name: "NINE29 (Demo)",
  phone_number: "+20 100 995 5923",
  basic_info: {
    name: "NINE29 (Demo)",
    address: "12 North Teseen St, New Cairo",
    area: "New Cairo",
    city: "Cairo",
    contact: { phone: "+20 100 995 5923", instagram: "@nine29.cairo", email: "hello@nine29.demo" },
    timezone: "Africa/Cairo",
    language: "en",
    dress_code: "Smart casual — no sportswear after 7pm",
    parking: "Valet at the door, EGP 50",
  },
  hours: {
    mon: [{ open: "12:00", close: "01:00" }],
    tue: [{ open: "12:00", close: "01:00" }],
    wed: [{ open: "12:00", close: "01:00" }],
    thu: [{ open: "12:00", close: "02:00" }],
    fri: [{ open: "13:00", close: "02:00" }],
    sat: [{ open: "12:00", close: "01:00" }],
    sun: [{ open: "12:00", close: "01:00" }],
    notes: "Kitchen closes 45 min before closing",
  },
  sections: [
    { key: "indoor", name: "Indoor", reservable: true },
    { key: "terrace", name: "Terrace", reservable: true },
    { key: "bar", name: "Bar", reservable: false },
  ],
  reservation_policy: {
    slot_minutes: 30,
    turn_minutes: { "2": 90, "4": 105, "6+": 120 },
    max_party_online: 8,
    grace_minutes: 15,
    waitlist_enabled: true,
    deposits: { enabled: true, per_person: 300, peak_only: true, peak_days: ["thu", "fri"], applies_from_party: 4 },
    drop: { enabled: true, release_dow: "mon", release_time: "18:00", horizon_days: 7, vip_early_minutes: 60 },
  },
  payments: { currency: "EGP", tax: 0.14, service_charge: 0.12, paymob_enabled: true, methods: ["card", "cash", "instapay"] },
  ai: {
    name: "Nina",
    personality: "warm, playful, a little cheeky — matches the NINE29 vibe",
    chat_enabled: true,
    greeting: "Hey! Welcome to NINE29 ✨ How can I help — table, menu, or tonight's plans?",
    off_hours: { enabled: true, start: "03:00", end: "11:00", reply: "We're closed right now — back at noon! Drop your question and we'll reply first thing." },
    reservations_enabled: true,
    orders_enabled: false,
  },
  faqs: [
    { q: "Do you take walk-ins?", a: "Yes — bar is walk-in only, and we keep 30% of indoor for walk-ins. Weekends fill by 8pm." },
    { q: "Is there a minimum charge?", a: "Thu–Fri after 8pm: EGP 600/person minimum spend on reserved tables." },
    { q: "Do you have vegan options?", a: "Yes — look for the 🌱 tag. The mushroom shawarma is the crowd favorite." },
    { q: "Can I bring a birthday cake?", a: "Yes! Corkage-free. Tell us at booking and we'll handle candles + a moment." },
  ],
  integrations: {},
};

export const demoUsers = [
  { id: uid(), email: "owner@demo.resto", password: "demo123", name: "Adel (Owner)", role: "admin" },
  { id: uid(), email: "manager@demo.resto", password: "demo123", name: "Laila (Manager)", role: "manager" },
  { id: uid(), email: "host@demo.resto", password: "demo123", name: "Omar (Host)", role: "host" },
  { id: uid(), email: "kitchen@demo.resto", password: "demo123", name: "Chef Karim", role: "kitchen" },
];

// ---------- seed tables ----------
const tables = [];
let t = 1;
for (const [section, count, cap] of [["indoor", 10, 4], ["terrace", 6, 4], ["bar", 6, 2]]) {
  for (let i = 0; i < count; i++) {
    tables.push({
      id: uid(),
      table_number: `${section === "indoor" ? "T" : section === "terrace" ? "TR" : "B"}${i + 1}`,
      section,
      capacity: section === "bar" ? 2 : i % 3 === 0 ? 6 : cap,
      status: "free",
      vip: section === "indoor" && i === 9,
      current_reservation_id: null,
    });
    t++;
  }
}

const dinersSeed = [
  { name: "Sarah Mansour", phone_number: "+201001234567", is_vip: true, visit_count: 14, total_spend: 42800, allergies: ["nuts"], tags: ["regular", "influencer"], preferences: { favorite_table: "T10", favorite_items: ["Truffle Rigatoni"], occasions: { birthday: "03-14" } }, status: "vip" },
  { name: "Youssef El Sherif", phone_number: "+201227654321", is_vip: false, visit_count: 6, total_spend: 11200, allergies: [], tags: ["regular"], preferences: {}, status: "regular" },
  { name: "Nour Hassan", phone_number: "+201115550001", is_vip: false, visit_count: 2, total_spend: 3100, allergies: ["gluten"], tags: [], preferences: { seating: "terrace" }, status: "customer" },
  { name: "Karim Adel", phone_number: "+201009998887", is_vip: false, visit_count: 1, total_spend: 950, allergies: [], tags: [], preferences: {}, status: "customer" },
  { name: "Malak Ibrahim", phone_number: "+201554443332", is_vip: true, visit_count: 22, total_spend: 88000, allergies: [], tags: ["vip", "big-spender"], preferences: { favorite_table: "TR1" }, status: "vip" },
  { name: "Ahmed Samir", phone_number: "+201112223334", is_vip: false, visit_count: 0, total_spend: 0, allergies: [], tags: ["lead"], preferences: {}, status: "lead" },
].map((d) => ({ id: uid(), email: null, last_visit_at: null, notes: null, wa_id: null, ...d }));

const code = () => "R-" + crypto.randomBytes(2).toString("hex").toUpperCase();

function seedReservations() {
  const today = todayISO();
  const rows = [
    { diner_name: "Sarah Mansour", diner_phone: "+201001234567", party_size: 4, date: today, time_slot: "20:00", occasion: "birthday", status: "confirmed", source: "whatsapp", deposit_amount: 1200, deposit_status: "paid", section_pref: "indoor", special_requests: "Birthday cake at 9:30, candles" },
    { diner_name: "Youssef El Sherif", diner_phone: "+201227654321", party_size: 2, date: today, time_slot: "19:00", occasion: null, status: "seated", source: "whatsapp", section_pref: "terrace" },
    { diner_name: "Nour Hassan", diner_phone: "+201115550001", party_size: 3, date: today, time_slot: "21:00", occasion: null, status: "confirmed", source: "instagram", section_pref: "terrace" },
    { diner_name: "Malak Ibrahim", diner_phone: "+201554443332", party_size: 6, date: today, time_slot: "21:30", occasion: "business", status: "pending", source: "whatsapp", deposit_amount: 1800, deposit_status: "pending", section_pref: "indoor" },
    { diner_name: "Walk-in", diner_phone: "+201000000001", party_size: 2, date: today, time_slot: "18:30", status: "completed", source: "walk_in" },
    { diner_name: "Hana Tarek", diner_phone: "+201005556667", party_size: 5, date: dayOffset(1), time_slot: "20:30", occasion: "anniversary", status: "confirmed", source: "whatsapp", deposit_amount: 1500, deposit_status: "paid" },
    { diner_name: "Seif Nabil", diner_phone: "+201223334445", party_size: 2, date: dayOffset(1), time_slot: "19:30", status: "awaiting_deposit", source: "whatsapp", deposit_amount: 600, deposit_status: "pending" },
    { diner_name: "Farida Amr", diner_phone: "+201118887776", party_size: 8, date: dayOffset(2), time_slot: "21:00", occasion: "birthday", status: "confirmed", source: "dashboard" },
    { diner_name: "Omar Khaled", diner_phone: "+201009990001", party_size: 2, date: dayOffset(-1), time_slot: "20:00", status: "no_show", source: "whatsapp" },
    { diner_name: "Dina Fouad", diner_phone: "+201227778889", party_size: 4, date: dayOffset(-1), time_slot: "21:00", status: "completed", source: "whatsapp" },
  ];
  return rows.map((r) => ({
    id: uid(), code: code(), end_slot: null, table_id: null, payment_link: null,
    reminder_sent_at: null, arrived_at: null, seated_at: null, completed_at: null,
    cancelled_reason: null, special_requests: null, occasion: null, section_pref: null,
    deposit_amount: null, deposit_status: "none",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...r,
  }));
}

const menuSeed = [
  ["Starters", [
    ["Burrata & Confit Tomatoes", 320, ["vegetarian"], "Creamy burrata, slow tomatoes, basil oil"],
    ["Tuna Tostada", 380, [], "Bluefin, avocado crema, crispy corn"],
    ["Mushroom Shawarma", 260, ["vegan"], "Oyster mushrooms, tahini, pickles — the famous one"],
    ["Spicy Edamame", 180, ["vegan", "spicy"], "Chili garlic glaze"],
  ]],
  ["Mains", [
    ["Truffle Rigatoni", 520, ["vegetarian"], "Black truffle cream, aged parmesan"],
    ["Short Rib", 780, [], "12h braise, smoked mash, jus"],
    ["Miso Glazed Salmon", 690, ["gf"], "Baby bok choy, sesame"],
    ["Smash Burger 929", 420, [], "Double patty, secret sauce, brioche"],
    ["Za'atar Chicken", 480, ["gf"], "Charcoal half chicken, garlic toum"],
  ]],
  ["Desserts", [
    ["Basque Cheesecake", 280, ["vegetarian"], "Burnt top, salted caramel"],
    ["Pistachio Kunafa", 300, ["nuts", "vegetarian"], "Viral for a reason"],
    ["Dark Chocolate Fondant", 290, ["vegetarian"], "Vanilla gelato"],
  ]],
  ["Drinks", [
    ["Passionfruit Mojito", 190, ["vegan"], "Virgin, fresh mint"],
    ["Matcha Cloud", 170, ["vegetarian"], "Iced, oat milk"],
    ["Fresh Mango Juice", 140, ["vegan"], "Seasonal"],
  ]],
];
const menu = [];
let sort = 0;
for (const [category, items] of menuSeed)
  for (const [name, price, dietary_tags, description] of items)
    menu.push({ id: uid(), name, category, price, description, dietary_tags, available: !(name === "Tuna Tostada"), available_from: null, available_to: null, photo_url: null, sort_order: sort++, created_at: new Date().toISOString() });

const waitlistSeed = [
  { id: uid(), phone_number: "+201009991111", name: "Mariam A.", party_size: 2, quoted_wait_min: 25, status: "waiting", position: 1, notified_at: null, created_at: new Date(Date.now() - 18 * 60000).toISOString() },
  { id: uid(), phone_number: "+201227772222", name: "Ali & friends", party_size: 4, quoted_wait_min: 40, status: "waiting", position: 2, notified_at: null, created_at: new Date(Date.now() - 9 * 60000).toISOString() },
  { id: uid(), phone_number: "+201115553333", name: "Jana", party_size: 2, quoted_wait_min: 25, status: "notified", position: 0, notified_at: new Date(Date.now() - 3 * 60000).toISOString(), created_at: new Date(Date.now() - 31 * 60000).toISOString() },
];

const ordersSeed = [
  { id: uid(), code: "O-1A2B", phone_number: "+201227654321", diner_name: "Youssef El Sherif", order_type: "table_reorder", table_number: "TR2", reservation_id: null, items: [{ name: "Passionfruit Mojito", qty: 2, price: 190 }], subtotal: 380, service_charge: 45.6, tax: 53.2, total: 478.8, status: "preparing", payment_status: "unpaid", payment_link: null, notes: null, created_at: new Date(Date.now() - 6 * 60000).toISOString(), updated_at: new Date().toISOString() },
  { id: uid(), code: "O-3C4D", phone_number: "+201001234567", diner_name: "Sarah Mansour", order_type: "pre_order", table_number: null, reservation_id: null, items: [{ name: "Truffle Rigatoni", qty: 2, price: 520 }, { name: "Burrata & Confit Tomatoes", qty: 1, price: 320 }], subtotal: 1360, service_charge: 163.2, tax: 190.4, total: 1713.6, status: "pending", payment_status: "unpaid", payment_link: null, notes: "For 8pm reservation", created_at: new Date(Date.now() - 45 * 60000).toISOString(), updated_at: new Date().toISOString() },
];

const chatSessionsSeed = [
  { id: uid(), session_id: "+201001234567", phone_number: "+201001234567", channel: "whatsapp", status: "open", session_type: "reservation", ai_enabled: true, needs_attention: false, handoff_reason: null, handoff_briefing: null, last_message: "Perfect, see you at 8! 🎉", last_message_at: new Date(Date.now() - 40 * 60000).toISOString(), created_at: new Date(Date.now() - 2 * 3600000).toISOString() },
  { id: uid(), session_id: "+201554443332", phone_number: "+201554443332", channel: "whatsapp", status: "open", session_type: "reservation", ai_enabled: false, needs_attention: true, handoff_reason: "VIP requesting full terrace buyout for 20 pax", handoff_briefing: "Malak (VIP, 22 visits) wants the terrace privately on Friday for a work event, ~20 people, asking about min spend.", last_message: "Can someone from management call me?", last_message_at: new Date(Date.now() - 12 * 60000).toISOString(), created_at: new Date(Date.now() - 3 * 3600000).toISOString() },
  { id: uid(), session_id: "+201115550001", phone_number: "+201115550001", channel: "instagram", status: "open", session_type: "friendly", ai_enabled: true, needs_attention: false, handoff_reason: null, handoff_briefing: null, last_message: "Is the kunafa gluten free? 🙏", last_message_at: new Date(Date.now() - 5 * 60000).toISOString(), created_at: new Date(Date.now() - 30 * 60000).toISOString() },
];

const chatMessagesSeed = [
  { session_id: "+201001234567", sender: "guest", message: "hey! table for 4 tonight around 8?" },
  { session_id: "+201001234567", sender: "ai", message: "Hey Sarah! 🎉 Welcome back. Indoor or terrace? I have 8:00 indoor or 8:30 terrace for 4." },
  { session_id: "+201001234567", sender: "guest", message: "indoor pls, it's my bday 🎂" },
  { session_id: "+201001234567", sender: "ai", message: "Happy birthday!! 🥳 Booked: 4 people, tonight 8:00 PM, indoor. Since it's Thursday there's a EGP 300/person deposit — here's your link. Bring the cake, we've got the candles 😉" },
  { session_id: "+201001234567", sender: "guest", message: "paid ✅" },
  { session_id: "+201001234567", sender: "ai", message: "Perfect, see you at 8! 🎉" },
  { session_id: "+201554443332", sender: "guest", message: "I want to book the whole terrace friday for a work thing, around 20 people" },
  { session_id: "+201554443332", sender: "ai", message: "That sounds amazing! For private buyouts our events team takes over — connecting you with a manager now 🤝" },
  { session_id: "+201554443332", sender: "guest", message: "Can someone from management call me?" },
  { session_id: "+201115550001", sender: "guest", message: "Is the kunafa gluten free? 🙏" },
].map((m, i) => ({ id: i + 1, media_url: null, media_type: null, wa_message_id: `demo-${i}`, status: "read", created_at: new Date(Date.now() - (60 - i * 5) * 60000).toISOString(), ...m }));

const notificationsSeed = [
  { id: 1, type: "handoff", title: "Human handoff requested", body: "Malak Ibrahim (VIP) — terrace buyout inquiry for Friday", ref_id: "+201554443332", read: false, created_at: new Date(Date.now() - 12 * 60000).toISOString() },
  { id: 2, type: "reservation", title: "Deposit pending", body: "Seif Nabil — tomorrow 7:30 PM, party of 2 — deposit link sent 2h ago", ref_id: null, read: false, created_at: new Date(Date.now() - 2 * 3600000).toISOString() },
  { id: 3, type: "reservation", title: "New reservation", body: "Nour Hassan — tonight 9:00 PM ×3 (Instagram)", ref_id: null, read: true, created_at: new Date(Date.now() - 3 * 3600000).toISOString() },
];

// mark two tables to match seeded state
const trTable = tables.find((x) => x.table_number === "TR2");
if (trTable) trTable.status = "seated";
const t10 = tables.find((x) => x.table_number === "T10");
if (t10) t10.status = "reserved";

const db = {
  restaurant_tables: tables,
  diners: dinersSeed,
  reservations: seedReservations(),
  waitlist: waitlistSeed,
  menu_items: menu,
  orders: ordersSeed,
  chat_sessions: chatSessionsSeed,
  chat_messages: chatMessagesSeed,
  notifications: notificationsSeed,
  events: [
    { id: uid(), title: "Deep House Friday — DJ Aly B", description: "Doors 10pm, terrace", date: dayOffset(2), start_time: "22:00", end_time: "02:00", capacity: 120, rsvp_count: 74, price: null, status: "upcoming", broadcast_sent: true, created_at: new Date().toISOString() },
    { id: uid(), title: "Chef's Table — 7 course tasting", description: "8 seats only", date: dayOffset(6), start_time: "20:00", end_time: "23:00", capacity: 8, rsvp_count: 5, price: 2500, status: "upcoming", broadcast_sent: false, created_at: new Date().toISOString() },
  ],
  feedback: [
    { id: uid(), phone_number: "+201227778889", reservation_id: null, rating: 5, food_rating: 5, service_rating: 4, vibe_rating: 5, comments: "The kunafa is insane. Music a bit loud indoors.", sentiment: "positive", escalated: false, created_at: new Date(Date.now() - 20 * 3600000).toISOString() },
    { id: uid(), phone_number: "+201009990001", reservation_id: null, rating: 2, food_rating: 3, service_rating: 1, vibe_rating: 4, comments: "Waited 25 min past our reservation time.", sentiment: "negative", escalated: true, created_at: new Date(Date.now() - 26 * 3600000).toISOString() },
  ],
};

function matches(row, where) {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

export const demoRepo = {
  async list(table, { where = {}, order, desc = true, limit } = {}) {
    let rows = (db[table] || []).filter((r) => matches(r, where));
    if (order) rows = [...rows].sort((a, b) => (a[order] < b[order] ? 1 : -1) * (desc ? 1 : -1));
    if (limit) rows = rows.slice(0, limit);
    return rows;
  },
  async get(table, id) {
    return (db[table] || []).find((r) => String(r.id) === String(id)) || null;
  },
  async insert(table, row) {
    const withId = { id: uid(), created_at: new Date().toISOString(), ...row };
    (db[table] ||= []).push(withId);
    return withId;
  },
  async update(table, id, patch) {
    const row = await this.get(table, id);
    if (!row) return null;
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    return row;
  },
  async remove(table, id) {
    const arr = db[table] || [];
    const i = arr.findIndex((r) => String(r.id) === String(id));
    if (i >= 0) arr.splice(i, 1);
    return i >= 0;
  },
};
