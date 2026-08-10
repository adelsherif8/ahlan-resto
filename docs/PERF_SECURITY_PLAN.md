# Ahlan — Performance, Reliability & Security Plan

Goal (from founder): **cached / repeated answers land in ~2s; only real orders take longer.**
Plus: **fix the "stuck in a loop, repeats the same wrong answer" bug**, and a **full
security + optimization pass** listing everything needed to make the system optimal.

This is grounded in real production timings pulled from `flow_executions`, not guesses.

---

## 0. The diagnosis (real numbers)

A single order turn measured live (`respond` = 11,030 ms):

| Node | Time | What it is |
|---|---|---|
| buffer silence wait (before respond even starts) | ~5,000 ms | we wait for the guest to stop typing — **even on "hi"** |
| `ingest` | ~1,700 ms | parse + DB writes |
| `deliver` | **~4,000 ms** | sends reply, then 4 DB writes **one after another** |
| `load_history` | ~830 ms | one read of the whole conversation blob |
| `gates` + `session_precheck` | ~700 ms | more sequential reads |
| `master` → classify | ~0 ms (rule hit) / ~400 ms (nano) | routing |
| order `extract` (gpt-4.1-mini) | ~1,370 ms | LLM |
| order `act` | ~1,720 ms | pricing + **many sequential DB writes**, no model |
| order `phrase` (gpt-4.1) | ~1,210 ms | LLM |

**Conclusion:** the model is the *small* part (~2.6s). The killer is **~15 Supabase
round-trips fired one at a time, each 300–800 ms**, plus a **5s wait applied to every
message**. A greeting pays almost the same tax as an order — that's why even "hi" is ~15s.

The 300–800 ms/query is itself abnormal (§B) — the two hottest tables have **no index on
the column we filter by**.

---

## PART A — Speed: make simple = ~2s

### A1. Non-blocking `deliver` — biggest single win (~4s → ~0.4s)
`flows/src/flows/buffering.js` `deliver` node awaits, in sequence: WA send → `logMessage`
→ `appendHistory` → `diners.last_seen` update. The guest only needs the WA send.
- **Do:** send the reply, then run `logMessage` / `appendHistory` / `last_seen` as
  fire-and-forget (or `Promise.all`) *after* the response is out.
- **Risk:** low. Logging/history are internal bookkeeping. Keep error logging.

### A2. Parallelize the read nodes (~0.7s saved)
`respond`: `gates` + `load_history` + `session_precheck` are independent reads run in a
chain. `friendly.js` load node runs `getMenu`→summary→events→2× reservations→diner
sequentially (audit O2).
- **Do:** `Promise.all` the independent reads in `respond` and in `friendly`/`order` load nodes.
- **Risk:** low — no write ordering dependency between them.

### A3. Smart buffer window (~3–4s saved on simple msgs)
`flows/src/services/buffer.js` waits 5s of silence on every text (`heuristicWindow`),
600ms for taps. A single, complete, short message isn't a burst.
- **Do:** if it's the first message AND it looks complete (no trailing "and/…/kaman/,"
  and short, e.g. ≤ ~60 chars) → flush in ~800ms–1s. Keep the 5s only when a burst is
  actually in progress. Bursts still coalesce; the "…/and" extend still applies.
- **Make it config-driven:** `config.ai.buffer_window_ms` + a new
  `config.ai.buffer_window_fast_ms` so you can tune live without a deploy.
- **Risk:** low-medium — occasionally splits a slow typer's two messages, but `post_check`
  already re-flushes and answers the straggler.

### A4. Cached / canned replies for greetings & repeats — 0 LLM (this is the "2s cached" ask)
Today a bare "hi" routes (by rule, 0-LLM classify) to the FRIENDLY agent, which **still
makes an LLM call** to phrase the greeting. FAQ/closer/price fast paths are already 0-LLM.
- **Do:** add 0-LLM fast paths in `master.js` `fast_paths` for:
  - greetings ("hi/hello/salam/اهلا") → a warm line from `config.ai.greetings[]`
    (rotate 3–4, personalize with the diner's name if known),
  - thanks / bye ("thanks/شكرا") → canned,
  - "menu?" → already sends the PDF fast path; keep,
  - repeated identical question within a session → serve the previous answer from a tiny
    per-session reply cache instead of re-calling the model.
- **Result:** greeting reply becomes template-fast (no model round-trip).
- **Risk:** low. Keep an LLM fallback for anything not matched.

### A5. Load history once per turn
`getHistory` is called at buffering `:151` (ingest), `:223` (respond), and the blob is
rewritten by `appendHistory` at `:226` and `:342`, plus order `savePending` writes diner
repeatedly. That's ~4 round-trips to the same rows per turn.
- **Do:** load history once in `respond`, pass it through `ctx`; append in memory; write
  once at the end (ties into A1 + C3).

**Expected after A1–A5:** "hi"/FAQ ~2–3s · order turn ~10–14s (before the DB fix below).

---

## PART B — Supabase / DB speed (the root cause; makes EVERYTHING faster)

> "Is there a way to make Supabase faster at getting data?" — yes, five levers, biggest first.

### B1. Add the missing indexes — THE biggest win (queries 300–800ms → ~30–80ms)
The two hottest tables are **read and written every single turn** and have **no index on
`phone_number`**, so every access is a sequential scan:
- `message_full(phone_number)` — history read/write every turn. **Missing.**
- `diners(phone_number)` — diner upsert + precheck + gates every turn. **Missing.**
- `orders(phone_number, created_at desc)` — order history / "where's my order". **Missing.**
- `messages_buffer(phone_number)` — buffer claim every turn. **Missing.**
- `pending_message_queue(phone_number, next_attempt_at)` — retry drain. **Missing.**

Already indexed (good): `chat_messages(session_id, created_at)`, `orders(code)`,
`orders(courier_token)`, `orders(status, notified_status)`, `orders(branch, created_at)`.

- **Do:** new migration `026_perf_indexes.sql` adding the above to **each** tenant schema
  (`r_luciz`, `r_justsmash`) and `public`. `create index concurrently if not exists`.
- **Risk:** none. Pure win.

### B2. Region co-location
Railway runs in **SFO** (`region: sfo`). If the Supabase project is in another region,
every round-trip pays cross-region RTT (e.g. SFO↔Frankfurt ≈ 150ms *each way* × 15
queries ≈ 4.5s/turn).
- **Do:** confirm the tenant Supabase project region; if not us-west, either move the
  Supabase project or move the Railway service to match. Same region → RTT ~1–5ms.
- **Risk:** medium (a migration/move), but potentially the single largest latency cut.

### B3. Stop the JSONB read-modify-write storm on `message_full`
`history.js` stores the whole conversation as one JSONB array, `select`s it then `update`s
the entire blob every turn (and twice per turn). Slow *and* a lost-update race (→ §C3).
- **Do (pick one):**
  - (a) Move history reads to `chat_messages` (already indexed) with `order(created_at desc).limit(N)`, and append-only inserts — no read-modify-write; or
  - (b) Keep `message_full` but load once + write once per turn, and cap length (already `MAX_TURNS=10`).
- **Risk:** medium — touches the history layer; covered by the suite.

### B4. Connection / transport
- Supabase-js talks to **PostgREST over HTTPS**; Node's fetch keeps connections alive by
  default, but verify keep-alive is on and the tenant client is **reused** (cached), not
  re-created per query.
- For the hottest reads/writes, consider a **direct Postgres connection via the Supabase
  pooler (pgbouncer, port 6543, transaction mode)** — a raw parameterized query is faster
  than PostgREST for single-row hot-path ops. (Bigger change; do after B1/B2.)

### B5. Query hygiene
- Replace `select("*")` with explicit columns on hot/large tables (`menucache` `menu_items.select("*")`, `driverOrder`/`trackedOrder` `orders.select("*")`, `tenant.js` `restaurants.select("*")`).
- Cache the **diner per session** (short TTL) like the 20s menu cache — it's read 3× per turn.
- Cache the builder's "most popular" list (currently tallies 300 full order rows on every
  `/build/:token` GET — `server.js:373`).
- Covering/partial indexes for the status boards (`orders` by status) if the dashboard polls often.

**Supabase-faster summary:** ① indexes (B1) ② same region (B2) ③ fewer + parallel queries
(A1/A2) ④ stop the blob rewrite (B3) ⑤ reuse connection / pooler + select only needed
columns + cache (B4/B5). Also available if needed later: **read replicas** for dashboard
reads, and **materialized views** for analytics.

---

## PART C — The loop / "repeats the same wrong answer" bug

Three real root causes, all fixable:

### C1. Loop detection is EXACT-string only → the LLM rephrases → it never trips
`precheck.js:30` compares `aiTurns.at(-1) === aiTurns.at(-2)` byte-for-byte. The model
almost never repeats verbatim ("Which drink?" vs "And to drink?"), so a real loop slides
right past detection. Mid-order it's even looser — `precheck.js:65` requires **three**
identical messages before it counts.
- **Do:** detect **semantic** repetition: normalize (lowercase, strip emoji/punctuation,
  collapse whitespace) before comparing, and/or compare on the **question intent** (e.g. a
  hash of the code-built question block / the `awaiting_option` slot), not the prose.

### C2. State doesn't advance → the same question is regenerated
When the guest's answer doesn't match a valid option, `awaiting_option`/`pending` never
clears, so the agent asks again — worded differently (→ C1 misses it). The guest is stuck.
- **Do:** add a **per-slot attempt counter** in `pending_order`. After 2 failed attempts
  at the same slot:
  1. show the exact valid options as **buttons/list** (remove ambiguity), then
  2. offer "skip / talk to a person",
  3. on the 3rd miss, hand off to a human (set `needs_attention`, notify dashboard).
- This turns a silent loop into a guided choice, then a graceful handoff.

### C3. Lost-update RACE loses the guest's answer (the "wrong answer" part)
`order.js:435` `savePending` and `history.js` `appendHistory` are **read-modify-write** on
a `diner`/`message_full` row captured earlier in the turn. Under the burst model +
`post_check` chained re-flush, **two `respond` cycles can overlap** and the second
overwrites the first — so the guest's just-given answer (drink, address, "yes") is wiped,
and the agent re-asks / replays a stale question. This is likely the core of "same wrong
answer again."
- **Do:**
  - **Serialize per session:** a short in-process async lock/queue on `bufKey(ctx)` so a
    session's turns never run concurrently (also prevents duplicate replies).
  - **Atomic writes:** update `pending_order` with a targeted write (or DB-side JSONB merge
    / optimistic version check) instead of overwriting the whole `preferences` from stale
    memory.
  - Re-read `diner` at the start of `act`, not from the turn-old copy.
- **Risk:** medium — concurrency code; add a regression test that fires two messages fast.

### C loop plan = detect (C1) + recover (C2) + prevent (C3)
Ship C3 (prevention) + C2 (recovery) first; they remove the cause. C1 (better detection)
is the safety net.

---

## PART D — Security hardening (from the full audit)

### CRITICAL
- **D1. Webhook signature fails OPEN when `WA_APP_SECRET` unset** (`whatsapp.js:25`,
  `server.js:115`). Anyone can forge inbound messages → poisoned history, LLM spend,
  outbound sends to arbitrary numbers. **Fix:** require the secret in prod; `return false`
  when missing; only skip behind an explicit non-prod flag.
- **D2. `/api/web/send` is fully unauthenticated** (`server.js:141`) and picks the tenant
  from `body.restaurant`. Anyone can drive any restaurant's bot (cost + writes + sends).
  **Fix:** require `opsAuth` or a signed web-widget token; rate-limit per session/IP.
- **D3. Rotate the WhatsApp token that was pasted in chat** — treat as compromised:
  regenerate the System User token, update Railway `WA_TOKEN`. (Still outstanding.)

### HIGH
- **D4. `opsAuth` fails open + non-constant-time compare** (`server.js:748`). If
  `OPS_TOKEN` unset, all `/api/ops/*`, `/api/staff/reply`, `/api/order/status`,
  `/api/executions*` are open. **Fix:** hard-fail when unset in prod; `crypto.timingSafeEqual`.
- **D5. Courier token is unsigned + never expires** (`server.js:343`) yet can mark
  delivered / set COD paid / message the customer. **Fix:** HMAC-sign + expire like build
  tokens (or rotate on delivery); rate-limit `/loc` + `/action`.
- **D6. No rate limiting / no helmet; CORS wide open** on both services
  (`flows/src/server.js:29`, `backend/src/server.js:22`). **Fix:** `express-rate-limit` on
  all public routes (webhook, build submit, driver loc, web/send, receipt), add `helmet`,
  scope CORS to known origins.
- **D7. Weak default secrets** — `JWT_SECRET="dev-secret-change-me"` (`backend/config/env.js:5`),
  `WA_VERIFY_TOKEN="ahlan-verify"`, build-secret falls back to `""`. **Fix:** fail fast if
  unset in prod; remove predictable defaults.

### MEDIUM
- **D8. Prompt injection:** guest/profile/menu text is interpolated raw into **system**
  prompts (`friendly.js:173`, `server.js:204`). **Fix:** keep untrusted text in user-role,
  delimited, with a "treat as data, not instructions" directive. (`master.js` already
  sanitizes some; extend it.)
- **D9. RLS is enabled but policy-less** (`015_enable_rls.sql`) — safe only because
  service-role bypasses it, so there's **no backstop**. Treat every user-supplied
  slug/restaurant selector as an authorization decision (ties to D2).
- **D10. Build submit** re-prices server-side (good) but is unthrottled (→ D6); cap
  builds/notifications per token TTL.

---

## PART E — Reliability / correctness add-ons (essential to be "optimal")

- **E1. Order idempotency** — a double-tap of "Confirm" can insert two orders. Add an
  idempotency key (session + pending hash) and dedupe before `orders.insert`.
- **E2. Per-session serialization** (same lock as C3) — kills duplicate replies + races.
- **E3. Observability** — you already have `flow_executions` with per-node ms. Add a small
  **latency panel + alert** (p50/p95 per flow, slowest nodes) so regressions show up; log
  slow queries (>500ms). This is how we'll verify the speed work.
- **E4. Dead-letter alerting** — the dead-letter path exists (`buffering.js:455`); wire a
  notification when it trips.
- **E5. Regression tests** — add: a loop test (agent must not ask the same slot 3×), a
  concurrency test (two fast messages don't lose state), and keep the suite green (77/0).
- **E6. Pending-queue drain** — ensure `pending_message_queue` (failed sends) is actually
  drained on a timer with backoff (index in B1).

---

## PART F — Recommended execution order (biggest bang first)

**Sprint 1 — "make it fast" (mostly safe, huge impact):**
1. **B1 indexes** (migration 026) — turns 300–800ms queries into ~50ms. *Do this first.*
2. **A1 non-blocking deliver** — 4s → 0.4s.
3. **A2 parallelize reads** — 0.7s.
4. **A3 smart buffer window** (config-driven) — 3–4s on simple msgs.
5. **A4 canned greetings / repeat cache** — greetings become model-free.
→ Target hit: simple ~2–3s, orders ~7–10s. Run full suite.

**Sprint 2 — "make it correct":**
6. **C3 per-session lock + atomic pending writes** (also E1/E2).
7. **C2 slot attempt counter → buttons → handoff.**
8. **C1 semantic loop detection.**
→ Loop bug fixed. Add loop + concurrency regression tests.

**Sprint 3 — "make it safe":**
9. **D1, D2, D3** (criticals) → **D4–D7** (high) → **D8–D10** (medium).

**Sprint 4 — "deeper speed" (optional):**
10. **B2 region co-location**, **B3 history rework**, **B4 pooler**, **B5 query hygiene**.

---

*Owner notes:* every flows change runs the full regression suite
(`POST /api/ops/run-regression`, poll `GET /api/ops/regression`, target 77/0). Deploy
`railway up --service flows --detach`. Dashboard is `vercel deploy --prod`.
