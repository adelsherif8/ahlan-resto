# Munadim flows — the bot's orchestrator

This folder is the WhatsApp brain of Munadim: one Node service that receives every guest message, decides which agent should answer, builds the reply (menus, orders, delivery quotes, reservations, status cards), and sends it back. It serves every restaurant (tenant) from the same process.

Live: `https://flows.munadim.com` (Railway, `railway up --service flows` from this folder).

## The one-paragraph mental model

```
WhatsApp / web chat
   │  POST /api/wa/webhook  ·  POST /api/web/send
   ▼
buffering.js  (RESPOND)   waits ~1s for the burst to finish, merges it, loads the
   │                      1h history, runs zero-LLM fast paths, then …
   ▼
master.js     (MASTER)    the router: cheap rules first, small classifier last →
   │                      ONE agent gets the message
   ├─► order.js            ordering (pickup / delivery / dine-in), the flagship
   ├─► friendly.js         the restaurant's voice: menu, prices, hours, info, chit-chat
   ├─► reservation.js      book / quote / confirm / cancel a table
   └─► arrival.js          "I'm here" / "running late"
   ▼
buffering.js  delivers the reply (bubbles, buttons, PDFs, pins), logs it, appends history
```

Iron rules that shape every file: **the LLM phrases, code computes** (prices, distances, availability, order state are never a model's guess); **zero hallucination** (answers come only from the restaurant's config + DB); **every model output has a code backstop** (script, language, menu names).

---

## Folder map

```
flows/
├── src/
│   ├── server.js          HTTP entry: webhooks, web chat, ops/console API, public pages
│   ├── config.js          timing constants (burst window, SLA filler, model names)
│   ├── engine/flow.js     the tiny flow runtime (defineFlow / f.node / f.flow + tracing)
│   ├── flows/             the agents — one file per flow (see below)
│   └── services/          pure helpers the flows call (delivery, menu, PDFs, WhatsApp …)
├── persona-test.mjs       54-persona conversation suite (EN/AR/Franco) — the release gate
├── personas-{en,ar,fr}.json
├── convo-test.mjs         fixture runner: assertion-based conversations
├── convos-*.json          the fixtures (one file per bug family / feature)
├── timing-test.mjs, greet10.mjs, rsv300.mjs, _translit.mjs   one-off audits
├── tools/                 data import scripts
├── assets/                static assets served by the service
├── railway.json           Railway build config (Nixpacks)
└── package.json           `npm start` → node src/server.js
```

---

## `src/engine/flow.js` — the flow runtime

The n8n replacement, ~200 lines. `defineFlow({ id, nodes, run })` returns a flow; inside `run`, `f.node("name", fn)` executes a traced step and `f.flow("other", input)` calls another flow as a child. Every run writes one row to the tenant's `flow_executions` table (per-node inputs/outputs, model, tokens, cost, timing, errors) — that is what the ops console's traces view reads. Parent rows include their children's cost, so never `SUM(cost_usd)` across a tree.

## `src/flows/` — the agents

| File | Flow | What it does |
|---|---|---|
| `buffering.js` | **RESPOND** (+ INGEST) | The front door. Ingest stores the raw message in `messages_buffer`; Respond claims the burst atomically, merges it, applies gates (rate limit, staff takeover, loop detection), loads 1-hour history, runs the zero-LLM fast paths (`services/fastpaths.js`), calls MASTER, then delivers the reply — splitting bubbles, attaching PDFs/photos/pins, merging photo + caption into one bubble, saving Maps links — and appends history. Also chains re-flushes if more messages arrived meanwhile. |
| `master.js` | **MASTER** | The router. Sanitizes, upserts the diner, then classifies with deterministic rules first (bare dish name → order; dish + order-type word → order; full dish name + ordering cue → order; status/cancel question after a placed order → order; short message inside an active order → order; pasted location → order …) and a small LLM classifier only when no rule fires. Dispatches to exactly one agent and returns its reply. |
| `order.js` | **ORDER** | The flagship. An extractor model reads the message into JSON (items, edits, type, address, payment, time); everything after that is code: menu matching with which-one questions instead of guesses, option groups (sandwich/combo, drink, spice) with per-unit splits, removal notes vs phantom removals ("no ranch" on a dish with no ranch), anaphora ("add one", "one of those") resolved from *our own last message*, delivery address → landmark/OSM point → zone/distance fee, type-first opener, payment, upsell (once per order, inside the confirm bubble), confirm gate, receipt PDF, ticket, status card, cancel-with-staff. Most of the file is guards that catch the extractor drifting. |
| `friendly.js` | **FRIENDLY** | The restaurant's voice for everything that isn't an order: greetings, menu (PDF or category lists in the restaurant's own order and Arabic names), dish info cards with photos, prices, hours, location, FAQs, recommendations. Answers only from config + DB; final script/language guarantee before sending. |
| `reservation.js` | **RESERVATION** | Collect → quote (availability is pure code) → guarded confirm → cancel/modify. Tri-lingual, with deposits when the restaurant requires them. |
| `arrival.js` | **ARRIVAL** | "I'm here" / "running late 10 min" — completes book → arrive → seat. |
| `reminders.js` | **REMINDERS** | T-3h "see you tonight" with Confirm/Cancel buttons; window-aware. Triggered by `/api/ops/run-reminders` (cron). |
| `janitor.js` | **JANITOR** | Hourly cleanup: expired buffers, stale sessions, old executions. `/api/ops/run-janitor`. |

## `src/services/` — helpers (no flow logic, mostly pure functions)

**Tenancy & data**
- `tenant.js` — resolves the restaurant from the control-plane `restaurants` row (config JSON columns) and opens its tenant DB client (`r_luciz`, `r_justsmash` schemas). `resolveAllRestaurants()` for cross-tenant ops views.
- `menucache.js` — one menu read per turn, shared by every path.
- `categories.js` — categories in the order/Arabic names the restaurant set (`menu_config.categories`).
- `history.js` — conversation memory (`message_full`, last turns, 1h TTL applied by the caller).
- `chatlog.js` — writes conversations into the tables the dashboard's Chats page reads.
- `buffer.js` — the DB-backed message buffer with trailing windows.
- `precheck.js` — session state before routing: active flow/stage, affirmative detection, loop / circuit-breaker detection (the order status card is exempt).
- `storage.js` — Supabase Storage uploads with bucket bootstrap.

**Ordering**
- `delivery.js` — coverage and pricing, one source of truth: pricing modes (`zone_fixed` / `flat_in_zone` / `distance`), polygon zones, curated landmarks, `resolvePlace()` chain (landmarks → Photon → Nominatim → area-centre → outside → ask for a pin) with a hard time cap, road-km estimate, `deliveryQuote()`.
- `translit.js` — Egyptian Arabic → Latin the way street signs / OSM spell it, so Arabic-script addresses geocode.
- `address.js` — structured delivery address (street / building / floor / apartment / landmark).
- `branches.js` — branch pick by distance (code, never the model).
- `availability.js` — table availability, pure code.
- `ordercode.js` — order codes (`O-XXXX`) for every front (chat, POS, builder).
- `orderline.js` — turns item options/notes into human modifier lines for tickets and receipts.
- `receipt.js` — PDF receipt modelled on an 80mm thermal check.
- `menupdf.js` — branded menu PDF generated from the live menu (categories, Arabic names, photos), cached by content hash.
- `format.js` — money/number formatting.
- `labels.js` — button wording per restaurant.
- `ridercopy.js` — one voice for every delivery status update.
- `trackpage.js` — the customer's live tracking page (`/track/:token`).
- `driverpage.js` — the rider's page (`/driver/:token`): accept, picked up, delivered, live location.
- `builder*.js`, `builder-catalog.json` — build-your-own sandwich web page (`/build/:token`): catalog, layout, lite 2D renderer, checkout back into the chat order.

**Models, channels, ops**
- `llm.js` — OpenAI chat wrapper with per-call token/cost accounting (feeds `flow_executions`).
- `media.js` — voice → Whisper transcript, images → vision classify/describe.
- `whatsapp.js` — WhatsApp Cloud API adapter (text, buttons, lists, documents, images, locations, typing).
- `fastpaths.js` — zero-LLM answers: closings, FAQ cache (hours / location / contact), menu category taps.
- `metrics.js` — in-memory ops metrics (buffer savings, latency).
- `regression.js` — the assertion-based regression suite run from the ops console (`/api/ops/run-regression`), results persisted as a `flow_executions` row so the console shows the last run after restarts.

## `src/server.js` — HTTP surface

| Group | Endpoints |
|---|---|
| Channels | `GET/POST /api/wa/webhook` (WhatsApp) · `POST /api/web/send`, `GET /api/web/poll`, `POST /api/web/typing` (web live chat / test chat) · `POST /api/staff/reply` (human takeover) |
| Public pages | `/track/:token` (customer tracking) · `/driver/:token` (+ `/api/driver/:token/action`, `/loc`) · `/build/:token` (sandwich builder) · `/api/ops/coverage-map` (read-only delivery map) |
| Ops console API (`x-ops-token`) | `/api/flows`, `/api/executions`, `/api/executions/:id`, `/api/ops/health`, `/api/ops/rollup`, `/api/ops/cost-summary`, `/api/ops/breakdown`, `/api/ops/history`, `/api/ops/insights`, `/api/ops/plans`, `/api/ops/restaurants`, `/api/ops/deploys`, `/api/ops/preflight`, `/api/metrics` |
| Ops actions | `/api/ops/run-regression`, `/api/ops/regression`, `/api/ops/run-reminders`, `/api/ops/run-janitor`, `/api/ops/snapshot-costs`, `/api/ops/arabize-item`, `/api/ops/tidy-menu`, `/api/ops/pos-extract`, `/api/ops/draft-reply`, `/api/ops/build-link`, `/api/order/status` (dashboard → guest status pushes) |
| Health | `GET /health` |

All ops endpoints read every tenant (`resolveAllRestaurants()`), so the console shows executions from all restaurants.

---

## Tests

Two harnesses, both run real conversations through the live pipeline (a local server or production) on test phone numbers, and read cost from `flow_executions`.

**`persona-test.mjs` — the release gate.** 54 personas × 3 languages (`personas-en.json`, `personas-ar.json`, `personas-fr.json` = Franco/Latin Egyptian). Each persona is a scripted guest (turns, seeded history, expectations, forbidden strings, a completion rule: order confirmed / ticket / question answered). A turn can be conditional — `{"if": "<regex on our last reply>", "say": "…"}` — so a script answers a which-one only when it was asked. The harness also checks the script of every reply (no Arabic to a Latin guest, Arabic to an Arabic guest), repeated questions, filler, and prints pass/fail + cost per conversation.

```bash
# against production (needs OPS_TOKEN in flows/.env)
node persona-test.mjs https://flows.munadim.com luciz personas-en.json
node persona-test.mjs https://flows.munadim.com luciz personas-ar.json
node persona-test.mjs https://flows.munadim.com luciz personas-fr.json
# against a local server
PORT=5142 node src/server.js &   # then point the harness at http://localhost:5142
```

Last full live run: **54/54**, ≈ $0.0054 per conversation.

**`convo-test.mjs` + `convos-*.json` — fixtures.** Short assertion-based conversations, one file per bug family; assertions run against the last reply. Names tell you what each covers:

| File | Covers |
|---|---|
| `convos-order12` / `order6` / `flow6` | ordering from scratch: intent → type first → options → payment → confirm (AR/EN) |
| `convos-qty4`, `tenders3`, `js` | quantities ("3 tenders"), spice level asks, per-unit drink splits |
| `convos-notes9`, `dontadd4` | kitchen notes, removals, phantom removals ("no ranch" on a dish without ranch) |
| `convos-context5` | context picks ("lets add chocolate" after we listed the shakes) |
| `convos-addons3`, `confirm3` | upsell inside the confirm bubble (once per order); confirm screen script |
| `convos-delivery6`, `delivery-pin2`, `place4`, `street6`, `arstreet3`, `poly3` | delivery: landmarks, pins, streets (Latin + Arabic script), polygon coverage, fees |
| `convos-iteminfo9`, `halluc`, `menu3`, `friendlymenu`, `cats3` | dish info cards, no invented dishes/prices, menu requests, Arabic categories |
| `convos-greet12`, `greetings30`, `msg1`, `name3`, `keep3`, `lang3`, `crash` | greetings, returning guests, sticky language, names |
| `convos-luciz`, `adel` | founder-reported live cases |

```bash
node convo-test.mjs http://localhost:5142 luciz convos-notes9.json
```

Rules of the road: test on a local server before deploying; run the full persona suite **last**, after all changes; keep test data after runs (delete only when the founder says so).

**One-off audits:** `timing-test.mjs` (why did the guest see "one sec"), `greet10.mjs` (greeting scenarios), `rsv300.mjs` (300 reservation scenarios), `_translit.mjs` (transliteration spot-checks).

---

## Configuration

Environment (`flows/.env`, never committed): `OPENAI_API_KEY`, `SUPABASE_AHLAN_URL` + `SUPABASE_AHLAN_SERVICE_KEY` (control plane), `OPS_TOKEN` (ops console + harnesses), `ENCRYPTION_KEY` (tenant credentials), `BUFFER_WINDOW_MS`, `PORT`, and `WA_TOKEN` etc. when WhatsApp Cloud is wired.

Per-restaurant behaviour lives in the control-plane `restaurants` row (edited from the dashboard): `basic_info` (hours, branches, `delivery` — pricing, zones, landmarks), `ai` (type-first, pickup timing, compact messages), `menu_config` (categories, upsell), `payments`, `faqs`, `reservation_policy`.

## Deploy

```bash
cd flows && railway up --service flows --detach
# then: railway deployment list --service flows --json   → wait for SUCCESS
curl -s -o /dev/null -w "%{http_code}\n" https://flows.munadim.com/health
```

Sister folders: `../dashboard` (restaurant dashboard) and `../backend` (its API), `../ops` (internal console that reads this service's `/api/ops/*`), `../migrations` (control-plane + tenant SQL), `../docs` (handoffs and plans).
