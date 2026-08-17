# Munadim Restaurant Dashboard — Complete Handoff

> Self-contained brief for anyone (or any chat) picking up the dashboard. Covers what it is, how every piece is linked, the data model, the design system, and exactly how to add things. Written 2026-08-16, last updated 2026-08-17.

---

## 1. The three services and how they connect

Munadim is **three separately deployed services** plus two Supabase projects. The dashboard is one of the three.

| Service | Folder | Stack | Deployed on | Live URL | Talks to |
|---|---|---|---|---|---|
| **Dashboard** (this doc) | `dashboard/` | React 19 + Vite + TypeScript + Tailwind v4 | **Cloudflare Pages** → `app.munadim.com`; Vercel (project `ahlan-resto`) → `ahlan-resto.vercel.app` | `https://app.munadim.com` | → **API** only |
| **API** (dashboard backend) | `backend/` | Node + Express (ESM) | Railway (service `api`) | `https://api.munadim.com` | → Supabase control plane, → tenant DB, → **Flows** for a few actions |
| **Flows** (the WhatsApp bot brain) | `flows/` | Node, custom flow engine, OpenAI | Railway (service `flows`) | `https://flows.munadim.com` | → tenant DB, → WhatsApp Cloud API, → OpenAI |
| Ops console (internal, dev only) | `ops/` | Vite + React | Vercel (`ahlan-ops`) | `https://ahlan-ops.vercel.app` | → Flows (`x-ops-token`) |

**Two Supabase projects:**

- **Control plane** — project `npznnysudtkesnliibvl`. Tables: `restaurants` (one row per restaurant = *all its config as JSON columns*), `restaurant_users` (dashboard logins). Env: `SUPABASE_AHLAN_URL` / `SUPABASE_AHLAN_SERVICE_KEY`.
- **Tenant data** — project `sxthftiqvaojbdyjizjr`, **one Postgres schema per restaurant**: `r_luciz`, `r_justsmash`. Each schema has identical tables (menu, orders, diners, chats…). Each `restaurants` row stores its own tenant credentials (url/key/schema, encrypted) in `restaurants.integrations.supabase`.

**The rule that ties it together:** the *bot* and the *dashboard* read and write **the same tenant tables**. A guest orders on WhatsApp → Flows inserts into `r_luciz.orders` → the dashboard's Orders/KDS page (polling the API) shows it seconds later. Staff edit the menu in the dashboard → API writes `r_luciz.menu_items` → the bot's next reply uses it (menu cache 20s). Nothing is duplicated between the two.

```
WhatsApp guest ──► Flows (bot) ──┐
                                 ├──► tenant schema r_<slug>  (orders, menu_items, diners, chat_*, …)
Dashboard ──► API ───────────────┘            ▲
                └──► control plane restaurants (config JSON) ──── read by Flows too
```

---

## 2. Auth, tenancy and roles

**Login** (`POST /api/auth/login`): email + password checked against `restaurant_users` (bcrypt). Returns a **JWT** carrying `restaurantId`, `role`, `name`, `branch`. Dashboard stores it in `localStorage` (`resto_token`, `resto_role`, `resto_name`, `resto_restaurant`, `resto_branch`) — see `dashboard/src/config/api.ts`. Every request sends `Authorization: Bearer <jwt>`; a 401 clears the session and bounces to `/login`.

**Tenant resolution** happens on the API for every request (`backend/src/middleware/restaurantContext.js`): JWT → `restaurantId` → `restaurants` row → decrypt its tenant creds → build a Supabase client pinned to that schema → attach to the request as:
- `req.restaurant` — the control-plane row (config JSON columns)
- `req.repo` — a tiny generic data layer (`list/get/insert/update/remove` on any tenant table) — `backend/src/store/supabaseRepo.js`
- `req.tenantClient` — the raw Supabase client (storage, custom queries)

Cached 60s per restaurant. So **a route never needs to know which restaurant it's serving** — it just uses `req.repo` / `req.restaurant`.

**Roles** (`restaurant_users.role`) and what they see (`dashboard/src/App.tsx` + `layout/DashboardLayout.tsx` nav):

| Role | Home page | Pages |
|---|---|---|
| `admin` | Overview | everything |
| `manager` | Overview | everything |
| `host` | Reservations | Reservations, Waitlist, Floor, POS, Chats, Diners, Reviews |
| `kitchen` | Orders | Orders/KDS, POS, Delivery, Menu |
| `livechat` | Chats | Chats |

Server side, `allowRoles("manager")` gates mutating routes; `admin` always passes. **Both** the nav filter and the route guard must be updated when adding a page (see §7).

Current logins: `CREDENTIALS.md` (Luci'z admin = `luciz@munadim.com`).

---

## 3. Where every piece of configuration lives

The `restaurants` row **is** the settings. Each JSON column is a "section" and the Settings page saves a whole section at once via `PUT /api/settings/:section` (allowed sections: `basic_info, hours, sections, reservation_policy, payments, ai, faqs, menu_config, pos`).

| Column | What's inside (highlights) | Edited in |
|---|---|---|
| `basic_info` | name, address, contact, timezone, `restaurant_type` (casual/fine — decides whether the bot takes **orders** or **reservations**), `services` {delivery, pickup, dine_in, table_numbers}, `branches[]` (name, address, lat/lng, delivery_zones), **`delivery`** {enabled, paused, zones[], min_order, free_over, hours, uncovered_message}, `brand` {primary, logo_url, mode} | Settings → Restaurant info / Delivery coverage / Branding |
| `hours` | opening hours per day | Settings |
| `payments` | currency, methods, `tax` (VAT rate, inclusive), `delivery_fee` (legacy flat), service charge | Settings → Charges |
| `ai` | host name, greeting, `entry_buttons`, `labels` (button wording), `ask_type_first`, `compact_messages`, `pickup_smart_timing`, `pickup_prep_min`, offers, specials, automations (recovery/upsell/reorder), approved FAQs, **`snippets`** (staff quick replies — see below), **`sla_minutes`** (answer-waiting-guests target; 0 = none) | Settings → AI host / Button wording / Offers / Specials / Staff quick replies |
| `menu_config` | `pdf_url` (designed menu), `prep_minutes`, `delivery_minutes`, combo config, builder (3D sandwich), **`categories`** (ordered sections — see below) | Settings → Menu display / Build your own; Menu design page; Menu → Manage sections |
| `pos` | cashiers + PINs, promotions | Settings → POS cashiers / Promotions |
| `faqs` | Q&A the bot answers from | Settings → FAQs |
| `reservation_policy` | turn times, deposits, party limits | Settings → Reservation policy |
| `sections` | floor sections | Floor page |
| `integrations` | tenant Supabase creds (encrypted), WhatsApp ids — **not editable from the UI** | — |
| `wpid` | WhatsApp phone-number id → which restaurant an inbound message belongs to | — |

Everything the bot "knows" about a restaurant comes from these columns + the tenant tables. **No restaurant-specific logic is in code.**

### 3.1 Two config keys with a shape worth knowing

**`ai.snippets`** — `string[]`, the one-tap replies staff send from Chats. These were once four English lines hardcoded in `Chats.tsx`, which gave every restaurant the same voice and let none of them change it. Supports `{name}` (guest) and `{order}` (their latest order code). **A snippet whose placeholder has no value is dropped, not sent with a hole in it** — "Hi {name}!" reaching a guest verbatim is worse than the shortcut not appearing. Empty/absent → a deliberately plain built-in fallback.

**`menu_config.categories`** — the ordered menu sections, so a category is a real thing rather than a string repeated on items:

```json
[{ "name": "Drinks", "name_ar": "مشروبات", "sort": 0 },
 { "name": "Mains",  "sort": 1 }]
```

- `sort` is 0-based and contiguous (assigned from array index on save). It is **`sort`, not `sort_order`**.
- `name_ar` is **omitted entirely** when blank — never `null` or `""`. Treat it as optional.
- **Items still store the category NAME** in `menu_items.category`, not an id. Deliberate: no migration, and the bot keeps reading what it already reads. The cost is that renaming rewrites every affected item (the Manage-sections dialog does this for you, renames first so config and items can't disagree).
- **Consumers must never drop a section.** Any category present on items but missing from config is appended *after* the configured ones in item-derived order. Null/empty config → today's item-derived behaviour exactly.
- ⚠️ **Flows does not read this yet.** `flows/src/services/menupdf.js` and three places in `friendly.js` still derive order via `[...new Set(menu.map(m => m.category))]`. Until a shared `orderedCategories(menu, config)` helper lands there, the configured order and Arabic names affect the **dashboard only**.

---

## 4. Tenant tables (per schema `r_<slug>`) and which pages use them

| Table | Purpose | Written by | Read by |
|---|---|---|---|
| `menu_items` | name, `name_ar`, category, price, description, `ingredients`, `ingredients_ar`, `spice_level`, `options` (JSON option groups), `photo_url`, `available`, `stock_count`, `bestseller`, `cost` | Dashboard Menu page | Bot (fast paths + order flow), POS, Menu design |
| `orders` | code, items (JSON), type, branch, address, payment, status ladder, totals, `pickup_eta_at`, courier | Bot (WhatsApp orders), POS (walk-ins) | Orders/KDS, Delivery, Overview KPIs, shift report |
| `diners` | phone, name, visit_count, allergies, `preferences` JSON (incl. `pending_order` = the bot's in-progress draft, `last_location`) | Bot, Dashboard Diners | Bot (greeting by name, "the usual"), Diners page |
| `chat_sessions` / `chat_messages` / `message_full` | conversation log, session flags (needs_attention, handoff), rolling history for the bot, `chat_messages.rating` (staff 👍/👎 on AI replies) | Bot, Chats page | Chats page (staff can reply, take over, hand back), **Bot quality** (reads the ratings back) |
| `reservations`, `restaurant_tables`, `waitlist`, `temp_reservation`, `slot_inventory` | booking system | Bot (fine dining), Dashboard | Reservations, Floor, Waitlist |
| `notifications` | staff alerts from the bot (handoff needed, new order, cancel request) | Bot | Bell icon (polls every 12s), Overview |
| `feedback` | ratings/reviews captured by the bot | Bot | Reviews page |
| `events`, `event_rsvps` | events + RSVPs | Dashboard, Bot | Events page |
| `couriers` | delivery riders | Dashboard | Delivery page (assign), driver page |
| `suggested_faqs` | questions the bot couldn't answer → staff approve → becomes a free FAQ | Bot | Settings (approve/dismiss) |
| `flow_executions` | every bot run's node-by-node trace | Bot | Ops console (full traces); dashboard **Bot quality** reads summary columns only — never `select("*")` here, the `nodes`/`children` jsonb hold whole traces |
| `messages_buffer`, `pending_message_queue`, `routing_failures` | bot internals | Bot | — |

Migrations: `migrations/*.sql` (numbered, idempotent — `create table if not exists` / `add column if not exists`). Run against the tenant project; new schemas need the whole set.

---

## 5. Page-by-page (what each does, which API it calls)

All under `dashboard/src/pages/`. Each page is one file, self-contained (state + fetch + render). Sizes: POS 1.3k lines, Menu 800, Chats 780, Settings 690, Orders 600, Overview 500, Diners 440.

| Page | Route | Job | Main API calls |
|---|---|---|---|
| **Overview** | `/overview` | answer-first headline, two-tier alerts, Today/7d/30d range, hero revenue + bullet KPIs vs the restaurant's own usual, food-cost half of prime cost, peak-hour staffing hint, forecast, crew, guests | `GET /api/dashboard/kpis`, `/agent-stats`, `/notifications`, `/api/orders`, `/api/menu` |
| **Profit** *(hidden — admin only)* | `/profit` | what was *kept*, not taken: gross profit / margin from `menu_items.cost` × what sold, profit by day and category, dishes selling below cost, discount drag. Items with no recorded cost are **excluded and reported as a coverage gap — never estimated**. Parked until item costs are entered | `GET /api/dashboard/profit?days=N` |
| **Bot quality** *(hidden — admin only)* | `/quality` | the AI feedback loop: 👎'd replies each shown with the guest question that preceded it (+ deep link into that chat), handoff reasons, questions the bot couldn't answer (answer inline → becomes a free FAQ), engine error rate / p95 / AI spend from `flow_executions`. Internal tool — destined for the ops console, not a staff page | `GET /api/quality?days=N`, `POST /api/settings/suggested-faqs/:id` |

> **Hidden pages.** `/profit` and `/quality` are intentionally absent from the sidebar (`DashboardLayout.tsx` NAV) and gated to `admin` on **both** sides — `ProtectedRoute roles={["admin"]}` in `App.tsx` *and* `allowRoles("admin")` on their routes, so a manager gets a `403` from the API rather than merely not seeing a link. To un-hide either, add its line back to NAV and widen both guards together; changing only the nav leaves the API refusing the request.
| **Orders (KDS)** | `/orders` | kitchen board: pending → accepted → preparing → ready → done; status changes ping the guest through Flows | `GET/PATCH /api/orders`, `GET /api/orders/shift-report` |
| **Delivery** | `/delivery` | delivery tickets, assign a courier, tracking links | `GET /api/orders?type=delivery`, `POST /api/orders/:id/assign`, `GET/POST /api/couriers` |
| **POS** | `/pos` | walk-in register: menu grid, options, cart, promos, cashier PIN switch, discounts (manager approval), receipt print, shift report; also natural-language "type the order" via `POST /api/orders/pos-extract` (proxied to Flows' AI) | `GET /api/menu`, `POST /api/orders`, `GET /api/settings` |
| **Menu** | `/menu` | **readiness panel** (what's missing, named by what it breaks) · per-row readiness dots · **tabbed item dialog** (dish / what guests hear / Arabic / options / money) · **bulk edit** (move category, ±% price, availability) · **Manage sections** (order, Arabic name, empty sections) · **CSV import/export** with a review-before-write preview · **bulk Arabize** with an approval diff · dense table view · modifier price & margin ranges · photos, stock/86, bestseller, "tidy menu" | `GET/POST/PATCH/DELETE /api/menu`, `POST /api/menu/:id/photo`, `POST /api/menu/arabize`, `POST /api/menu/tidy`, `GET /api/menu/performance`, `PUT /api/settings/menu_config` |
| **Menu design** | `/menu-design` | pick a template → renders the live menu to a PDF (html2canvas + jsPDF) → publish → becomes the PDF the bot sends | `POST /api/menu/pdf` (stored in tenant storage, sets `menu_config.pdf_url`) |
| **Chats** | `/chats` | inbox sorted by **longest wait first** (+ SLA breach flag) · transcript · **staff reply** via Flows · take over / hand back **with undo** · 👍👎 · **live itemised cart** with allergy / stock / duplicate / closed-kitchen guards and pairing suggestions · **stalled-for-N-minutes** + what's blocking the order · **friction banner** (looping / complaint wording) · guest profile (how they order, what they write in, past reviews, saved addresses) · **past answers** to the same question · outcome tags · config-driven quick replies | `GET /api/chat/sessions`, `/messages`, `/context`, `/search`, `POST …/messages`, `PATCH /api/chat/sessions/:id`, `POST /api/chat/messages/:id/rate` |

> **⚠ `unitPrice()` in `chatRoutes.js` mirrors `itemPrice()` in `flows/src/flows/order.js`.** A chosen option can *replace* the base price (`choice.price`) or *add* to it (`choice.delta`); the draft cart shown to staff has to match what the guest was quoted. If you change option pricing in Flows, change it here too — **Flows is the authority**, because its number is the one the guest actually saw.
| **Diners** | `/diners` | CRM: search, VIP flag, allergies, notes, visit history, spend | `GET/PATCH /api/diners` |
| **Reservations / Floor / Waitlist** | `/reservations` `/floor` `/waitlist` | bookings by day, table map with sections, walk-in waitlist | `/api/reservations`, `/api/tables`, `/api/waitlist` |
| **Reviews** | `/reviews` | feedback captured by the bot | `GET /api/reviews` |
| **Events** | `/events` | events + RSVPs the bot can pitch/collect | `/api/events` |
| **QR codes** | `/qr` | generate table / menu / order-now QR codes (client-side `qrcode`) | — |
| **Staff** | `/users` | manage dashboard logins & roles, change own password | `/api/users` |
| **Settings** | `/settings` | everything in §3, section by section, each with its own Save | `GET /api/settings`, `PUT /api/settings/:section`, suggested-FAQ approve, builder preview |
| **Login** | `/login` | — | `POST /api/auth/login` |

### 5.1 Deep links — every page is addressable

Pages carry intent across a navigation instead of dumping you at the top of another screen. All of these clear their own query param after firing, so a refresh doesn't re-trigger and the URL stays clean.

| Link | Lands on |
|---|---|
| `/orders?code=O-8H2W` | that ticket, scrolled to centre and ringed. Switches the date filter if it's from an earlier day, and turns on "show cancelled" if it was cancelled — otherwise the board looks empty and the link seems broken |
| `/orders?filter=late` | the board filtered to late tickets only (joins the "reset filters" control) |
| `/chats?session=+2010…` | that conversation |
| `/chats?session=…&msg=123` | that conversation, scrolled to that message, flashed |
| `/chats?filter=attention` | the inbox filtered, longest-waiting conversation already open |
| `/menu?item=Passionfruit%20Mojito` | the Menu with that item's editor open and the search pre-filled |
| `/diners?item=Smoky%20BBQ%20Burger` | Diners filtered to guests who actually ordered that dish (walks order history), with a clearable banner |

**Back-links** (`components/BackLink.tsx`): send someone across with `nav(url, backTrip(returnUrl, "Adel's chat"))` and render `<BackLink/>` at the top of the destination. The origin travels in **router state, not the URL**, so it survives navigation but never leaks into a copied or bookmarked link, and the back-navigation itself carries no state so you can't build an infinite chain. Renders nothing when the page was reached directly — free to leave in place everywhere.

**Hover peek** (`components/OrderPeek.tsx`): wrap any order code to show the ticket on hover (status, age, total, items) without navigating. All peeks on a page share one 30s cache, so a mouse crossing ten codes costs one request. Opens after a 220ms delay so brushing past doesn't flash cards. ⚠️ It renders a `<Link>` — **never place it inside a `<button>`**; nested interactive elements are invalid HTML with two competing click targets.

**Live updates:** there is no websocket. Pages that need freshness **poll** (Orders every few seconds, Chats, notification bell every 12s). Simple, robust, cheap at this scale.

---

## 6. Design system

**Look:** dark, dense, operational — a control room, not a marketing site. Zinc surfaces, one **brand accent** per restaurant, small type, rounded-xl cards, generous but tight spacing. Everything is Tailwind utility classes; there is almost no custom CSS.

- **Tokens** (`dashboard/src/index.css`): `--accent` and `--accent-contrast` are set at runtime from `basic_info.brand.primary` (contrast auto-computed by luminance). Default accent amber `#f59e0b`.
- **Light mode**: `basic_info.brand.mode = "light"` sets `data-theme="light"` on `<html>`, which **inverts the zinc scale via CSS variables** — the whole app re-skins with zero class changes. Keep using `zinc-*` classes and it just works in both.
- **Brand logo**: `basic_info.brand.logo_url` shows in the sidebar.
- **Shared components** (`dashboard/src/components/ui.tsx`): `Card`, `PageHeader` (title / subtitle / actions slot), `Pill` (status chips), `Btn`, `Input`, `Select`, `Empty`, `ArmButton` (two-tap destructive button: first tap arms with a warning label, second confirms — use this for delete/reset). Use these before inventing new ones.
- **Icons**: `lucide-react` only.
- **Layout**: `layout/DashboardLayout.tsx` = collapsible grouped sidebar (Front of house / Guests / Back office), role-filtered, notification bell, restaurant switcher name, logout. Pages render into `<Outlet/>` with a max-width content column.
- **Conventions**: page = one file; local `useState` + `useEffect` fetch; no global store; optimistic UI is fine but re-fetch after mutations; `alert()` for hard errors is accepted in this codebase (kept simple on purpose); money via `lib/format.ts`; ticket helpers in `lib/ticket.ts`.
- **Language**: dashboard UI is English (staff-facing); *guest-facing* text (bot) is EN/AR/Franco and lives in Flows, not here — except menu fields (`name_ar`, `ingredients_ar`) which staff enter here.

---

## 7. How to add things (recipes)

### A. A new field on an existing screen (e.g. add "calories" to a menu item)
1. **DB**: `migrations/0NN_calories.sql` → `alter table menu_items add column if not exists calories int;` (run on the tenant project; add the same for each `r_<slug>` schema if the migration is per-schema).
2. **API**: `backend/src/routes/menuRoutes.js` → add `"calories"` to the allowed keys list in the `PATCH /:id` route (and to `POST /` if creatable).
3. **UI**: `dashboard/src/pages/Menu.tsx` → add to `DetailsEditor` state + an `<Input>` + include in the `api.patch(...)` payload (and in the add-item modal if needed).
4. **Bot** (optional): if the bot should *say* it, add it to the menu facts builder in `flows/src/flows/friendly.js` (`buildMenuText`) or a fast path in `flows/src/services/fastpaths.js`.

### B. A new settings option (e.g. a toggle the bot reads)
1. Decide the section (`ai` for behaviour, `basic_info` for facts, `payments` for money, `menu_config` for menu display).
2. **UI**: `Settings.tsx` → inside that section's block add the control, bound with `upd("ai", { my_flag: … })`; the section's existing **Save** button already `PUT`s the whole section — nothing else needed.
3. **Bot**: read `config.ai?.my_flag` in Flows. Config is cached ~60s in the API and read fresh per turn in Flows.
No API change is needed for settings — sections are saved wholesale.

### C. A new page (e.g. "Inventory")
1. **Route + guard**: `App.tsx` → `<Route path="/inventory" element={<ProtectedRoute roles={["manager","kitchen"]}><Inventory/></ProtectedRoute>} />`.
2. **Nav**: `layout/DashboardLayout.tsx` → add `{ to: "/inventory", label: "Inventory", icon: Boxes, roles: [...] }` to the right group.
3. **Page**: `pages/Inventory.tsx` — copy the shape of a small page (e.g. `Reviews.tsx`): `PageHeader`, fetch in `useEffect`, `Card` list, `Empty` state.
4. **API**: `backend/src/routes/inventoryRoutes.js` → `router.use(requireAuth, restaurantContext)`, use `req.repo.list("inventory", …)`; register in `server.js` with `app.use("/api/inventory", inventoryRoutes)`.
5. **DB**: migration for the new tenant table.
6. Deploy API (`railway up --service api`) then dashboard (`vercel --prod` in `dashboard/`).

### D. A new API endpoint that needs the AI or WhatsApp
The API has **no OpenAI key and no WhatsApp token** on purpose. Add the capability in **Flows** as an ops endpoint (`flows/src/server.js`, protected by `opsAuth`), then **proxy** from the API using `FLOWS_URL` + `FLOWS_OPS_TOKEN` (see `menuRoutes.js` `/arabize`, `ordersRoutes.js` `/pos-extract`, `chatRoutes.js` staff replies for the pattern).

### E. A new tenant (restaurant)
Insert a `restaurants` row (slug, name, config columns, `integrations.supabase` creds for a new `r_<slug>` schema), run all migrations for that schema, add a `restaurant_users` row, set `wpid` when their WhatsApp number exists. Flows and the dashboard need **no code change**.

---

## 8. Local dev & deploy

```bash
# API
cd backend && npm i && npm run dev            # http://localhost:5051  (needs .env: SUPABASE_AHLAN_URL/KEY, JWT_SECRET, FLOWS_URL, FLOWS_OPS_TOKEN)
# Dashboard
cd dashboard && npm i && npm run dev          # http://localhost:5173, VITE_API_URL=http://localhost:5051 (defaults there)
# Flows (only if you're touching bot behaviour)
cd flows && PORT=5099 node src/server.js
```
`DEMO_MODE=true` on the API runs everything against an in-memory demo restaurant (`backend/src/store/demo.js`) — handy for UI work without touching real data.

**Deploy:** API → `cd backend && railway up --service api --detach`; Flows → `cd flows && railway up --service flows --detach`. Always confirm the *specific* deployment id reached `SUCCESS` (`railway deployment list --service api --json`), not just that the newest is green.

**Dashboard deploy — read this before shipping UI.** The live domain `app.munadim.com` is served by **Cloudflare Pages**, *not* Vercel (`curl -sI https://app.munadim.com` → `server: cloudflare`). There are two independent hosts:

```bash
cd dashboard && npm run build
npx wrangler pages deploy dist --project-name munadim-dashboard   # → app.munadim.com   (the one guests/staff use)
vercel --prod                                                     # → ahlan-resto.vercel.app (secondary)
```
`vercel --prod` alone leaves `app.munadim.com` on the old bundle — it looks like a clean deploy and changes nothing staff can see. Wrangler reads `CLOUDFLARE_API_TOKEN` from `dashboard/.env` (git-ignored; set 2026-08-17) — export it before the command: `export $(grep CLOUDFLARE_API_TOKEN dashboard/.env)`. Use Node ≥22 (`export PATH=/opt/homebrew/bin:$PATH`). Verify by grepping the served bundle at app.munadim.com for a new string.

**Verify what actually shipped**, don't trust "Ready" — hash the served bundle against something new in your change:
```bash
JS=$(curl -s https://app.munadim.com | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://app.munadim.com/$JS" | grep -c "Some New String From Your Change"   # 0 = your code is NOT live
```
Both hosts point at the same API, so `.env.production` (`VITE_API_URL=https://api.munadim.com`) applies to both.

CORS: the API and Flows allow `app.munadim.com`, `ahlan-resto.vercel.app`, `ahlan-ops.vercel.app` (+ preview pattern) and any `localhost:*`. A new dashboard domain must be added to both allowlists (`backend/src/server.js`, `flows/src/server.js`).

---

## 9. Non-negotiables to keep

- **Config-driven, never restaurant-specific code.** If Luci'z needs something, add a setting every restaurant can use.
- **The bot and the dashboard share tables** — never create a parallel copy of orders/menu for the UI.
- **Money and facts are computed by code**, phrased by the AI. The dashboard is where those facts are entered; keep fields structured (numbers, enums, JSON with a shape), not free text the bot would have to interpret.
- **Two names per dish** (EN + AR) and EN + AR ingredients — the bot depends on them for Arabic guests.
- Destructive actions use `ArmButton`.
- Keep pages self-contained; keep the API generic (`req.repo`) unless a query genuinely needs the raw client.

---

## 10. Backend deep-dive (adding anything server-side)

### 10.1 Anatomy of a route file
Every file in `backend/src/routes/` follows the same shape. Copy this when adding one:

```js
import { Router } from "express";
import { requireAuth, allowRoles } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);   // 1) JWT → req.user   2) tenant → req.repo / req.restaurant / req.tenantClient

// READ — any logged-in role
router.get("/", async (req, res, next) => {
  try {
    const rows = await req.repo.list("feedback", { order: "created_at", desc: true, limit: 200 });
    res.json(rows);
  } catch (e) { next(e); }              // the global error handler turns this into 500 {error}
});

// WRITE — gated by role; validate + whitelist fields; never spread req.body straight into the DB
router.patch("/:id", allowRoles("manager", "host"), async (req, res, next) => {
  try {
    const patch = {};
    if ("status" in req.body && ["new", "handling", "resolved"].includes(req.body.status)) patch.status = req.body.status;
    if ("note" in req.body) patch.note = String(req.body.note || "").slice(0, 800) || null;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing to update" });
    const row = await req.repo.update("feedback", req.params.id, patch);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

export default router;
```
Then register in `backend/src/server.js`: `app.use("/api/feedback", feedbackRoutes);`.

### 10.2 The three things a route can reach
| Handle | What it is | Use it for |
|---|---|---|
| `req.repo` | `list / get / insert / update / remove` on **any tenant table**, already pinned to the right schema | 90% of routes — CRUD by id, simple filters (`where: {status:"pending"}`), ordering, limit |
| `req.tenantClient` | the raw Supabase client for this restaurant's schema | anything the repo can't express: `.in()`, `.gte()`, `.ilike()`, joins, `count`, **Storage** uploads (`.storage.from("menus").upload(...)`), RPC |
| `req.restaurant` | the control-plane row (`basic_info`, `ai`, `payments`, …) | reading config; writing config goes through `supabaseAhlan.from("restaurants").update(...)` (see `settingsRoutes.js`) — the control plane is a *different* Supabase project from tenant data |

`req.user` = `{ sub, email, name, role, restaurantId, branch }` from the JWT.

### 10.3 Conventions that keep it safe
- **Whitelist fields on write** (`for (const k of ["name","price",…]) if (k in req.body) patch[k] = req.body[k]`) — never `req.repo.update(table, id, req.body)`.
- **Clamp and coerce**: `Number()`, `.slice(0, N)`, enum checks; return `400` with a plain-English `error` string — the dashboard shows `e.response?.data?.error` in an `alert()`.
- **Never expose another tenant's data**: you can't by accident if you only use `req.repo`/`req.tenantClient` — both are already scoped. Don't create clients from env vars inside routes.
- **Test data**: rows whose phone starts with `web:regress-`/`web:convo-`/`web:test-` are bot test traffic; filter them out of anything customer-facing or KPI-ish (see `isTest` in `reviewsRoutes.js`).
- **Long work**: routes must answer fast (dashboard polls). Anything slow or AI/WhatsApp-related belongs in Flows behind an ops endpoint and gets proxied (§7-D).
- **Errors**: `try { … } catch (e) { next(e) }` everywhere; the handler in `server.js` logs and returns `500 {error: message}`.

### 10.4 Env & secrets (`backend/src/config/env.js`)
`PORT` (5051), `JWT_SECRET` (**required in production — boot fails without it**), `SUPABASE_AHLAN_URL/SERVICE_KEY` (control plane), `ENCRYPTION_KEY` (AES-256-GCM for tenant creds stored in `restaurants.integrations`), `FLOWS_URL` + `FLOWS_OPS_TOKEN` (proxying to the bot service). `DEMO_MODE` is automatic when no Supabase URL is set → in-memory demo restaurant (`store/demo.js`) so you can run the UI with zero infra. Set on Railway service `api` (`railway variables --service api`).

### 10.5 Adding a table + full CRUD (checklist)
1. `migrations/0NN_<name>.sql` — `create table if not exists <name> (id uuid primary key default gen_random_uuid(), … , created_at timestamptz default now());` (+ an index on what you'll filter by). Run for each `r_<slug>` schema.
2. Route file as in 10.1 → register in `server.js`.
3. Page or section in the dashboard calling it via `api.get/post/patch/delete` from `config/api.ts`.
4. If the **bot** should read/write it too: touch `flows/` (it uses its own tenant client, `ctx.tenant.db`).
5. Deploy API → deploy dashboard → smoke-test on `app.munadim.com`.

---

## 11. Styling deep-dive (CSS / Tailwind)

### 11.1 Setup facts
- **Tailwind v4** via `@tailwindcss/vite`. There is **no `tailwind.config.js`** — v4 is configured in CSS. `dashboard/src/index.css` starts with `@import "tailwindcss";` and that's the whole setup.
- Utility classes only. The **entire** custom CSS is ~30 lines (`index.css`): the two accent variables, the light-theme variable inversion, body defaults, scrollbar. Don't add stylesheets per page — add classes.
- No component library (no shadcn/MUI). `components/ui.tsx` is the whole kit.

### 11.2 The theme mechanism (why every page is dark **and** light for free)
Tailwind v4 exposes its palette as CSS variables (`--color-zinc-900` …). The app is written dark-first with `zinc-*` classes. When a restaurant sets `basic_info.brand.mode = "light"`, `DashboardLayout` sets `data-theme="light"` on `<html>`, and `index.css` **remaps the zinc variables to their inverse** — so `bg-zinc-950` *becomes* white, `text-zinc-100` *becomes* near-black, everywhere, with zero class changes. Rule: **always use `zinc-*` for surfaces/text** and it will theme correctly. Fixed colours (`red-`, `emerald-`, `amber-`…) are for status/semantic meaning and stay the same in both modes.

The **brand accent** is a CSS variable, not a Tailwind colour: `--accent` / `--accent-contrast` (set from `brand.primary` at runtime; contrast computed by luminance). Use it as `bg-[var(--accent)] text-[var(--accent-contrast)]` for the primary action, active nav, highlights.

### 11.3 Class recipes (copy these; they're what the app already uses)
| Thing | Classes |
|---|---|
| Card | `rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4` (or `<Card className="p-4">`) |
| Page title | `text-2xl font-semibold tracking-tight` + subtitle `mt-1 text-sm text-zinc-400` (or `<PageHeader>`) |
| Section label | `text-xs uppercase tracking-wide text-zinc-500` |
| KPI number | `text-2xl font-bold` with unit `text-sm font-normal text-zinc-500` |
| Primary button | `rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:opacity-90` (or `<Btn>`) |
| Secondary button | `rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800` |
| Danger (two-tap) | `<ArmButton armedLabel="Sure? …">` — never `confirm()` |
| Input / select | `rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200` (or `<Input>` / `<Select>`); Arabic fields add `dir="rtl"` |
| Status pill | `rounded-full px-2 py-0.5 text-[11px] font-medium bg-<color>-500/15 text-<color>-300` — or `<Pill value="confirmed"/>` which maps status → colour (`PILL_COLORS` in `ui.tsx`; add new statuses there) |
| Toggle chip (selected/unselected) | `rounded-full px-2.5 py-1 text-[11px] bg-emerald-500/20 text-emerald-300` / `bg-zinc-800/70 text-zinc-500` |
| KPI grid | `grid grid-cols-2 gap-3 md:grid-cols-4` |
| Form grid | `grid gap-2 md:grid-cols-3` (Menu editor) / `md:grid-cols-2` (modals) |
| Modal | overlay `fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4` → panel `w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950` with `grid-rows-[auto_1fr_auto]` + `overflow-y-auto` body |
| Row hover / clickable | `cursor-pointer transition hover:border-zinc-600` |
| Muted / meta text | `text-xs text-zinc-500`; numbers in tables `tabular-nums` |
| Empty state | `<Empty text="No orders yet"/>` |

Semantic colours used consistently: emerald = ok/confirmed/free, amber = attention/reserved/bestseller, sky = in-progress/seated, purple = bill, red = bad/cancelled/danger, zinc = neutral/done.

### 11.5 Rules learned the hard way (Overview, Chats and Menu all set precedent)

A restaurant dashboard is read in ten seconds by someone who is busy. These rules exist because breaking them actively misleads — follow them on any new analytical panel:

- **Brand accent ≠ status.** `--accent` carries *identity only* (hero figure, the "now" marker, active nav). Data bars use neutral `zinc-400`/`zinc-500`; status uses the fixed semantic colours above. Luci'z's accent **is red** — when charts were drawn in the accent, nothing on the page could look urgent, because everything was already red.
- **Never colour alone.** Every up/down carries an arrow *and* a word ("up 12% vs last Friday"); every alert carries an icon *and* a text tag (`Now` / `When you can`). It has to survive greyscale.
- **Suppress comparisons below `MIN_SAMPLE` (5).** A percentage off one order is noise dressed as signal — show the count and say "too few to compare" instead. Same for forecasts: fewer than 2 same-weekdays on record is not a forecast.
- **Under 4 data points, don't draw a chart.** Render figures. A single full-width bar reads as an enormous value when it's one order.
- **Alerts must be clearable.** Anything that can never reach zero (a permanently "late" ticket) trains staff to ignore every alert. Thresholds come from the restaurant's own baseline — "late" is `median prep × 1.5`, not a hardcoded 20 minutes — and housekeeping is a separate, calm tier from "someone is waiting".
- **Space follows content.** An empty panel collapses to one line of text, never a full-height empty box.
- **12px is the floor** for any text a manager reads (`text-xs`), including meta and axis labels.
- **Light mode only inverts zinc.** `index.css` remaps the zinc scale under `[data-theme="light"]` and nothing else, so a pale fixed colour (`text-amber-200`, `text-red-100`) is **dark-mode-only** and disappears on white. Luci'z runs light. For tinted alert blocks use theme-independent pairs — `bg-amber-500 text-amber-950`, `bg-red-50 text-red-900` — not `text-amber-300` on `bg-amber-500/15`.
- **A warning that fires on healthy data is worse than none.** Staff learn to scroll past it and then miss the real one. Two alarms had to be retuned for exactly this: "orders running late" counted every never-closed ticket forever, and frustration detection fired on three messages in two minutes (which is just how people use WhatsApp). Prefer strong evidence alone, weak signals only in combination.
- **`<Input>` has no `w-full`.** It stretches as a grid child and collapses to ~20 characters anywhere else. Wrap labelled fields in `[&_input]:w-full [&_select]:w-full` or set it explicitly.
- **`\b` does not work on Arabic.** Word boundaries are defined on `[A-Za-z0-9_]`, so `/\bمش فاهم\b/` can never match and the check silently skips Arabic guests. Keep Latin and Arabic patterns separate.
- **English help text must stay out of `dir="rtl"` inputs** — it gets flipped to the wrong side and reads as nonsense. Label outside, Arabic-only placeholder inside.
- **Bulk writes are N sequential PATCHes, not a transaction.** Report which ones failed by name; a half-applied bulk edit that claims success is how a menu ends up with three items on the old price.
- **Never write straight from an import.** Match, diff, show old → new, apply on approval. A blank cell means "leave alone", never "erase"; an absent column means "don't touch this field at all".

### 11.4 Adding a visual thing
- New status? → add it to `PILL_COLORS` in `ui.tsx` (one line) so `<Pill>` renders it.
- New primitive (e.g. a tab bar)? → add to `ui.tsx`, styled with the recipes above, then use it from pages. Keep props tiny.
- Per-restaurant look? → it comes from `basic_info.brand` (`primary`, `logo_url`, `mode`), edited in Settings → Branding. Don't hardcode brand colours anywhere.
- Icons → `lucide-react`, size 12–16 inline, 18–22 in nav.
- Responsiveness → mobile-first classes with `md:` breakpoints; the sidebar collapses; POS is designed for tablets (large tap targets).

Related docs: `docs/HANDOFF.md` (whole platform), `CREDENTIALS.md`, `docs/ANSWER-INTEGRITY-AUDIT-2026-08-14.md`, `docs/WHATSAPP-FEATURES-TESTING.md`.
