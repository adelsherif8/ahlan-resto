# Munadim Ops Console — Complete Handoff

> Self-contained brief for editing the internal ops console (`ops/`). What it is, how it's wired to the flows service, every view + its endpoints, the design system, and how to add views. Written 2026-08-16, rebuilt to the 3-pane layout the same day.

---

## 1. What it is

The **internal control room for the WhatsApp bot** — dev/founder-facing, not restaurant staff. It shows every flow (ingest → respond → master → friendly/order/…), every execution's node-by-node trace (inputs, outputs, ms, tokens, cost, errors), platform metrics, an error/health rollup, a cost + tenant rollup, a test chat that talks to the real bot, and a button to run the regression suite.

| | |
|---|---|
| Folder | `ops/` — React 19 + Vite + TypeScript + Tailwind v4, ~1,700 lines, 11 files |
| Live | `https://ahlan-ops.vercel.app` (Vercel project `ahlan-ops`) |
| Talks to | **the flows service only** — `https://flows.munadim.com` (Railway service `flows`, code in `flows/`) |
| Auth | one shared **ops token** sent as header `x-ops-token` (value in `flows/.env` `OPS_TOKEN`; Railway var on the flows service). Verified against `GET /api/ops/verify` |
| Data | reads flows' in-memory execution ring **merged with** the persisted `flow_executions` table of **every** tenant schema (rows tagged with `restaurant`) |
| Local dev | `cd ops && npm i && npm run dev` → `http://localhost:5174`. `.env` has `VITE_FLOWS_URL=https://flows.munadim.com` (change to a local flows port to point at your own server). Optional `VITE_OPS_TOKEN` pre-fills the token so you don't paste it |
| Deploy | `cd ops && vercel --prod` (env `VITE_FLOWS_URL` is set on the Vercel project). Nothing else — it's a static bundle |

**Layout**: the shell owns the viewport (`h-screen`, `overflow-hidden`) — the page itself never scrolls, each pane does. **All view state lives in the URL hash** (`#/flows?flow=respond&exec=ex_123&rest=luciz&status=error&q=web:ab12&group=sessions`), so a trace is a link you can paste and a refresh puts you back where you were.

**Keyboard**: `j`/`k` walk the execution list · `↵` opens the cursor row · `esc` closes the trace (or blurs the search box) · `/` focuses search.

It has **no backend of its own** and **no database access** — everything is `axios` calls to flows with the token header (`ops/src/config.ts`).

```
ops (static React) ──x-ops-token──► flows service ──► in-memory executions + every r_<slug>.flow_executions
                                          └──► real bot (web channel) for the Test Chat
```

---

## 2. Files

| File | Role |
|---|---|
| `src/main.tsx` | mounts `<App/>` |
| `src/App.tsx` | token login screen → header with 4 tabs (Flows & Executions / Test Chat / Health / Cost) → renders the active view inside a fixed-height shell. Cross-tab jumps live here: health/cost rows open a trace in Flows, the test chat opens its own session timeline |
| `src/urlstate.ts` | `useUrl()` — parses/writes the hash (`#/tab?k=v`). `setTab` pushes, `setParams` replaces by default so filter typing doesn't spam the back button |
| `src/config.ts` | `FLOWS_URL`, the `ops` axios instance (adds `x-ops-token`), `getToken/setToken/clearToken` (localStorage key `ahlan_ops_token`, falls back to `VITE_OPS_TOKEN`) |
| `src/ui.tsx` | the component kit: `Card`, `Btn`, `Input`, `Select`, `Segments`, `Badge`, `Stat`, `Bar`, `LiveDot`, `Empty` + the formatters every view shares (`ago`, `clock`, `full`, `ms`, `usd`, `tokens`) |
| `src/FlowsView.tsx` | the console proper. Toolbar (mode · search · restaurant · status · live toggle · metrics · suite) over 3 panes: **flows rail** → **executions list** → **detail**. Three modes: `Runs` (flat, server-filtered by flow), `Sessions` (grouped by `session_id`, runs nested by `parent_id` so ingest → respond → master → order reads as a tree), `Live tail` (all flows, 3s poll, new rows pulse). Owns the regression panel and metrics strip |
| `src/FlowCanvas.tsx` | draws one flow as a node chain, overlays per-node status/ms/tokens/cost, plus the **node inspector**: LLM payloads render as chat bubbles (system prompts collapsed), other JSON as a collapsible tree, raw toggle + copy per block. Also surfaces **undeclared steps** (recorded by the run but missing from the flow def) and exports `traceToMarkdown()` for the Copy-trace button |
| `src/HealthView.tsx` | error rollup for the last N hours: grouped by flow+node+error, counts, last seen, fatal vs recovered, filters by restaurant and kind, and every row opens its real trace |
| `src/CostView.tsx` | the money view, in four layers: four headline numbers → spend-per-day chart (with a `table` twin) → **one** breakdown at a time (`By flow \| By restaurant \| By model`) → a collapsed "Slow & expensive" section. Hosts `PlansCard` |
| `src/PlansCard.tsx` | what restaurants owe us, month-to-date: allowance usage, **run-rate projection** ("on pace for ~N"), `underusing plan` / `on pace to exceed` / `stopped ordering` badges, cost per order to them, AOV, cancellation rate, 7-day trend |
| `src/pricing.ts` | the rate card (`branding/pricing.md`), plan arithmetic, `suggestPlan()` from branch count, `project()`, and `EGP_PER_USD` — an assumption, shown wherever it's applied |
| `src/InsightsView.tsx` | does the bot sell: conversion, cost per order, first-reply latency, repeat guests, language split, order mix, hour/weekday heat, plus restaurant pre-flight, deploy history and the dead-letter list |
| `src/hooks.ts` | `usePageVisible` (a background tab polls nothing), `useDebounced` (the search box no longer writes the URL per keystroke), `useFirstSeen` (pulses new rows, and prunes itself) |
| `src/ChatView.tsx` | a web-channel chat with the real bot (session id `web:<random>` in localStorage), polling for replies, typing indicator, media rendering, "new guest", and "Watch trace" which opens that session's timeline in Flows |
| `src/index.css` | Tailwind import + dark body + scrollbar. That's all the custom CSS |

---

## 3. Endpoints it uses (all on flows, all need `x-ops-token`)

| Endpoint | Used by | Returns |
|---|---|---|
| `GET /api/ops/verify` | App (login) | `{ok:true}` or 401 |
| `GET /api/flows` | FlowsView cards | every registered flow (name, description, trigger, nodes) **+ stats** (runs, ok, errors, cost_usd, avg_ms) — memory + all tenants' DB rows |
| `GET /api/executions?flow=&limit=` | FlowsView list | summaries `{id, flow, session_id, restaurant, trigger, status, error, started_at, duration_ms, tokens_*, cost_usd}` newest first, all tenants |
| `GET /api/executions/:id` | FlowsView → FlowCanvas | one full execution incl. `nodes[]` (each with `input`/`output` JSON strings) and `children[]` |
| `GET /api/metrics` | FlowsView metrics strip | messages_in, bursts, merge_ratio, spam_blocks, fast-path hit counters, llm_replies, zero_llm_rate, dead_letters, near-misses |
| `GET /api/ops/health?hours=` | HealthView | `{available, runs, failed_runs, error_rate, groups[], recent[]}` across all tenants |
| `GET /api/ops/rollup?hours=` | CostView | `{totals, by_day[], by_flow[], by_restaurant[], by_model[], slow_steps[], slowest[], costliest[], counted, truncated, retention_days}` across all tenants. **`hours` is capped at the janitor's 14-day trace retention** — a 30-day total built from 14 days of surviving rows is a lie |
| `GET /api/ops/plans` | CostView → PlansCard | month-to-date order facts per restaurant: `orders_mtd`, `orders_billable`, `order_value_billable`, `aov`, `orders_7d`, `orders_prev_7d`, `orders_prev_month`, `plan`, `branches`. Returns **facts only** — the rate card lives in `ops/src/pricing.ts` |
| `GET /api/ops/insights?days=` | InsightsView | per restaurant: conversion (sessions→orders by phone), `cost_per_order_usd`, `first_reply` (median/p90/worst), repeat-guest rate, `languages` (from the bot's own `detectLang`), `orders_by_hour`/`orders_by_dow`, `order_types`, `handoffs_open`, `dead_letters[]` |
| `GET /api/ops/preflight` | InsightsView | per restaurant config checks — menu readable/non-empty/sellable, hours, delivery zones, tables, wpid, plan. Each `{ok, level: error\|warn\|info, label, detail}` |
| `GET /api/ops/deploys?days=` | InsightsView | rows from the control-plane `service_boots` table — one per flows process start, written on boot. `available:false` until migration 033 |
| `POST /api/ops/run-regression` / `GET /api/ops/regression` | FlowsView regression panel | starts / reports the suite (113 cases today; the status now carries `total`/`suite_size` so the UI never hardcodes a count). Runs against the **ahlan-pilot** tenant |
| `POST /api/web/send` `{sessionId,message,restaurant?}` · `GET /api/web/poll?sessionId=` · `POST /api/web/typing` | ChatView | the bot's **web channel** — same brain as WhatsApp, replies land in `chat_messages` and are polled back |

Server side these live in `flows/src/server.js` (search `opsAuth`). Adding an endpoint = add it there behind `opsAuth`, then call it from a view with `ops.get(...)`.

Where the *data* comes from: `flows/src/engine/flow.js` — `listFlows()`, `listExecutions()` (memory ring), `listExecutionsDb()` / `getExecutionDb()` (tenant table `flow_executions`, written by `persistExecution` after every run). Tenant enumeration: `resolveAllRestaurants()` in `flows/src/services/tenant.js`.

---

## 4. Design system

Same family as the restaurant dashboard, but simpler and **fixed dark** (no light mode, no per-restaurant brand):

- **Palette**: zinc surfaces (`bg-zinc-950` page, `bg-zinc-900/60` cards, `border-zinc-800`), **amber** as the single accent (`bg-amber-500` logo tile, `text-amber-400` active tab, `border-amber-500/60` selected execution). Status: emerald ok, red error, zinc pending/dashed.
- **Type**: system sans, small — `text-sm` body, `text-xs text-zinc-500` meta, `tabular-nums` for ms/$/tokens.
- **Shape**: `rounded-2xl` cards, `rounded-lg` buttons/tabs, `px-4 py-2.5` card rows, `p-6` main.
- **Kit** (`ui.tsx`): `Card`, `Btn variant="primary"|"ghost"`, `Input`, `Select`, `Segments`, `Badge tone=`, `Stat`, `Bar`, `LiveDot`, `Empty`. Icons `lucide-react` (11–16 px).
- **Formatting is centralised** — use `ago/clock/full/ms/usd/tokens` from `ui.tsx`, never `new Date().toISOString().slice(...)`. Timestamps render in **local time**; the old raw ISO slice was UTC and silently lied by 3h.
- **Patterns**: views are single files with local `useState` + polling `useEffect`s. Polling no longer has to pause for the canvas (the detail pane is its own scroll container and the open trace is keyed off the URL, not the list), but the toolbar has an explicit **pause** button and a `LiveDot` so a frozen list is always visible as frozen. Panes scroll, the page doesn't.
- **Recipes** — list row: `flex w-full items-center gap-2.5 border-l-2 py-2 pr-3` + selected `border-l-amber-500 bg-amber-500/5`; tab: `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm` + active `bg-amber-500/10 font-semibold text-amber-400`; table head cell: `px-3 py-2 text-left text-[10px] uppercase tracking-wide text-zinc-500`; error text `text-xs text-red-400 truncate`.

---

## 5. How to add things

**A new tab/view** — 1) `src/MyView.tsx` (copy `HealthView.tsx` as the smallest full example: fetch + interval + cards; give it `h-full overflow-y-auto p-6` since the shell no longer scrolls). 2) `App.tsx`: add an entry to `TABS` and a branch in `<main>`. Done — no router, the hash is the state.

**A new stat/column on executions** — the summary shape comes from `execSummary` in `flows/src/engine/flow.js`; add the field there (and to `listExecutionsDb`'s select if it must survive restarts), extend the `Execution` type in `FlowCanvas.tsx`, render in `FlowsView.tsx`.

**A new server endpoint** — `flows/src/server.js`: `app.get("/api/ops/thing", opsAuth, async (req,res)=>{ … })`; for per-tenant data loop `await resolveAllRestaurants()` and tag rows with `t.config.slug` (see `/api/executions`). Deploy flows (`cd flows && railway up --service flows --detach`) before the console change goes live.

**Filters** (by restaurant / session / status) — the API already returns `restaurant` and `session_id`; filter client-side in `FlowsView` first; move to a query param on `/api/executions` only if lists get long.

**Auth changes** — a single shared token by design (internal tool). If it ever needs per-person logins, that's a flows-server change (`opsAuth`), not a console change.

---

## 6. Gotchas that already bit us
- **Blank/"Invalid ops token"** with a correct token = the console is pointing at the wrong `VITE_FLOWS_URL` (default is `localhost:5052`) or the origin isn't in flows' CORS list (`ALLOWED_ORIGINS` + `OPS_CONSOLE_ORIGIN` regex in `flows/src/server.js`). Vercel preview URLs match the regex; a brand-new domain must be added.
- **"0 runs" on flow cards right after a deploy** — the in-memory ring resets on every flows deploy; cards now merge the DB rows so this is fixed, but remember memory ≠ history.
- **Executions missing for a tenant** — endpoints must aggregate **all** tenants (`resolveAllRestaurants`), never `resolveRestaurant()` (that's only the default tenant).
- After redeploying the console, **hard-refresh** (Cmd+Shift+R) — Vercel caches the old bundle in the tab.
- Test-run phones follow `+201555xxxx`; they're kept after runs on purpose (founder inspects them here) and deleted only on request.
- **PostgREST silently caps any single response at 1000 rows.** `/api/ops/rollup` asked for 5,000 and got exactly 1,000 per tenant — a week that cost $38.21 rendered as $2.13, with no error anywhere. It now counts first (`count: "exact", head: true`), pulls pages of 1000 eight at a time, and returns `counted` + `truncated` so the view can say "read 20,000 of 22,715".
- `/api/ops/health` had the same bug (a bare `.limit(1000)` per tenant, then sliced to 1000 overall: the error rate was divided by "1000 runs" however many really ran, and older failures in the window vanished). It now (a) takes `runs` from an exact COUNT, and (b) fetches **failures only** instead of every run — `.eq("status","error")` for outright failures plus a jsonb containment filter for recovered ones — so the heavy `nodes` column is read only for rows that actually broke. Over 7 days that moved `runs` from 1,000 to 26,458.
- **jsonb filters need a JSON string, not an array.** `.contains("nodes", [{status:"error"}])` makes supabase-js emit PostgREST's array literal and Postgres answers `invalid input syntax for type json`; pass `JSON.stringify([...])`. The health endpoint reports a `degraded` reason if that filter ever fails rather than rendering a clean bill of health it can't back up.
- A node's `error` is only ever set together with `status:"error"` (`engine/flow.js`), which is what makes the containment filter exact — verified against a hand scan: 902 hits, 0 false positives.

- **NEVER `sum(cost_usd)` OVER `flow_executions` ROWS.** `engine/flow.js` rolls a sub-flow's cost up into its parent (`exec.cost_usd += child.exec.cost_usd`) and then persists **both** rows. One LLM call is therefore stored once per level of nesting, and a typical turn nests respond → master → friendly. Summing rows reported **$78.81 for a month that actually cost $26.18 — 3.01×**, and the founder caught it because he knew he had never paid that.
  - **Correct**: sum each row's own `nodes[].cost_usd` (a node records a call exactly once, and it attributes per flow honestly), or sum only `where parent_id is null` (same platform total, cheaper, but attributes nothing per flow and loses a child whose parent the janitor already purged).
  - Migration **035** rewrites the 033/034 SQL functions to the node-level sum and stamps `ops_agg_version() = 2`. `costRpcTrusted()` refuses any RPC **money** figure below v2 and falls back to root-row summing, because confidently reporting 3× is worse than being slow.
  - The same rollup applies to **tokens**. It does **not** apply to `duration_ms` — a parent genuinely takes as long as its children, and for `respond` that nested total *is* the guest-facing latency.
  - `/api/flows` per-flow cost still includes sub-flows (that is a meaningful per-flow figure), so the rail labels it "incl. sub-flows" and deliberately shows **no summed total** — the Cost tab owns the real number.
  - Two lessons that cost real time here: a `python` string-replace patch silently missed the `select(...)` line, so `parent_id` was never fetched and the "fix" changed nothing — **always grep the file afterwards**. And an intermediate version reported `$0` instead of an inflated figure, which is just a different wrong answer; if a number can't be computed, return `null` and say so.
  - **Verified** against an independent JS count: `ops_rollup_totals` now returns $26.178927 where the raw node sum is $26.1789, and `ops_spend_split`'s three buckets add up to its own total, on both schemas.

- **`ops_rollup_totals` over a month-wide window can hit Supabase's 8s statement timeout** on a busy schema (41k rows): the costly parts are the ones that can't be grouped — one global `percentile_cont` sorts every row, and `count(distinct session_id)` hashes all of them. Its grouped siblings are fine (days 1.9s, flows 1.6s, split 3.2s). Two responses: migration **036** raises just these functions to `statement_timeout = 25s` (safe — ops reads behind a 60s cache, never on a guest's path), and the insights roster **stopped asking for month totals at all**, taking MTD cost from `ops_spend_split`, which it already called.
- **`tryRpc` must distinguish transient from permanent failures.** It originally cached "unavailable" on *any* error, so one timeout permanently downgraded the busiest schema for the life of the process. Only `Could not find the function` / `does not exist` / `schema cache` are permanent; a timeout is retried next call.

**Cost of a polled console** (fixed 2026-08-16, keep it fixed):
- `/api/flows` was re-reading **300 execution rows per tenant on every 15s poll** — 684ms — to render "426 runs · $0.69" on the flow cards. The DB half is now behind a 30s `cached()` memo (5ms warm); the in-memory half stays live so a just-finished run still appears at once.
- `resolveAllRestaurants()` ran on **every** ops request (a `select *` plus a fresh Supabase client per tenant). Now cached for `CACHE_MS` and reusing warm clients. Call `invalidateTenantCache()` after a config write.
- `/api/executions` accepts **`?since=`**; the console sends the newest `started_at` it holds, so a quiet 3s live-tail poll transfers `[]` (2 bytes) instead of 100 rows (~39KB).
- The console **gates every poll on `document.visibilityState`** — a tab left open on another desktop costs nothing. The live dot reads "tab hidden".
- **Aggregation belongs in Postgres.** Migration 033 adds `ops_rollup_days/flows/totals` and `ops_order_stats` per tenant schema; endpoints call them via `tryRpc()` and **fall back to reading rows** when absent, so running 033 is an optimisation and never a requirement. `tryRpc` remembers a missing function instead of retrying per request, and logs once telling you to run 033.
- Plan/billing data: `restaurants.plan` (migration 032, control DB, `text` + CHECK). The endpoint reads the column and falls back to `basic_info.billing.plan`.
- Deploy markers: `service_boots` (migration 033, control DB), written fire-and-forget on boot. `railway up` carries no git metadata, so this is the only record of when behaviour changed.
- **Anything the console can't show, say out loud.** Caps, samples and skipped tenants are rendered (the truncation banner, "sampled from N recent runs", the `unreadable` badge on the tenant roster) — a silently trimmed number in an ops console is worse than no number.
- The regression panel's case count comes from the server (`total` / `suite_size`). It used to be hardcoded to 20 against a 113-case suite, so a full run looked hung a fifth of the way in.

Related: `docs/DASHBOARD-HANDOFF.md` (restaurant dashboard), `docs/HANDOFF.md` (whole platform), `flows/src/engine/flow.js` (execution model).
