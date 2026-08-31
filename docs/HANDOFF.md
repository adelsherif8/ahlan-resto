# AHLAN — PROJECT HANDOFF BRIEF (as of 2026-07-11)

## WHO WE ARE
Ahlan (formerly "AI²") is an Egyptian startup selling AI automation for hospitality.
THE PRODUCT IS THE WHATSAPP AGENTS — AI staff (host/greeter, booking agent, order agent…)
that handle the full guest journey over WhatsApp/Instagram. Dashboards are only the
control room for those agents. Two verticals:
1. HOTELS (original product, live): reception/booking/checkin/room-service agents.
2. RESTAURANTS (new product, in active build): targeting Gen-Z Cairo spots
   (Mattar/Split/929 style). This is the current focus.

## REPOS / FOLDERS (on Adel's Mac, "~/Desktop/Ai Squared/")
- `ai2-web/` — HOTEL product (legacy name kept): React dashboard + Express backend +
  `n8nnew/` (live n8n workflow exports) + `n8nnew/lanchainflows/` (Node service replacing n8n).
- `ai2-resto/` — RESTAURANT product, clean build. Git: github.com/adelsherif8/ahlan-resto (private).
  - `dashboard/` React 19+Vite+TS+Tailwind (restaurant-facing)
  - `backend/` Express API (multi-tenant)
  - `flows/` THE AI AGENTS — custom flow engine (no n8n, no heavy framework yet;
    direct OpenAI calls with per-node cost tracing; LangGraph planned for reservation agent)
  - `ops/` INTERNAL Ahlan console (n8n-style canvas, executions, costs) — restaurants never see it
  - `migrations/` SQL (001 control plane, 002 tenant schema, 003 executions+suggested FAQs)
  - `docs/` WORKFLOWS.md (22-workflow catalog), AGENT_WORKFLOWS.md (guest journey),
    FRIENDLY_EVAL_1.md (eval reports), HANDOFF.md (this)
- `railway-env-backup/` — all Railway env vars + MIGRATION.md (secrets, not in git)

## LIVE URLS (restaurant product)
- Restaurant dashboard: https://ahlan-resto.vercel.app
  (login: adelsherif8@gmail.com / Ahlan2026! · staff: manager|host|kitchen@ahlan.resto / Ahlan<Role>1!)
- Internal ops console: https://ahlan-ops.vercel.app (token: OPS_TOKEN env on the flows service — see CREDENTIALS.md, never committed)
- Flows service (agents): https://flows-production-e528.up.railway.app
- Backend API: https://api-production-34bb0.up.railway.app
- HOTEL backend: https://ai2-backend-production-e273.up.railway.app (frontend ai2-web.vercel.app)
Railway account: adelsherif22102022@gmail.com (migrated 2026-07-11 from old trial account;
hotel deploys from ai2-web/backend dir, resto via `railway up --service api|flows`).
Vercel: `vercel --prod --yes -b VITE_API_URL=... / VITE_FLOWS_URL=...` per app.

## DATABASES (Supabase ×2, restaurant)
- Control plane `npznnysudtkesnliibvl`: `restaurants` (config JSONB: basic_info incl.
  vibe/services/policies/google_maps, hours, sections, reservation_policy, payments, ai, faqs,
  integrations.supabase = tenant creds) + `restaurant_users`. Pilot: slug `ahlan-pilot`,
  id 493e59d1-849d-4eed-aca1-1e3af983f7bf, config FILLED with demo data (North 90th, New Cairo).
- Tenant DB (per restaurant) `sxthftiqvaojbdyjizjr`: diners, reservations, restaurant_tables (22),
  temp_reservation, waitlist, menu_items (15 seeded), orders, events, feedback, chat_sessions,
  chat_messages, message_full, messages_buffer, suggested_faqs, flow_executions (needs 003 run),
  notifications… Phone column is ALWAYS `phone_number`. Service keys live in local .env files +
  railway-env-backup (never paste into chats).

## THE FLOWS SERVICE (the heart) — what's LIVE
Custom engine: `defineFlow({nodes, run})`, every node traced (input/output/ms/tokens/cost),
executions viewable on ahlan-ops canvas (click node → real input/output, errors red,
click-through to sub-flow runs). 5 flows in production:
- INGEST: WhatsApp webhook (fully built, DORMANT until WA_TOKEN set) + web live chat →
  parses ALL WA payload types (voice→Whisper, photo→vision, reactions, locations, contacts,
  buttons; raw recorded) → DB dedup → spam guard (12/min) → chat gate → media→text →
  log to Chats → smart buffer (web 5s / WA 8s, typing-aware via POST /api/web/typing,
  completeness heuristics, first-contact 3s, 25s cap). Bursts merge into ONE reply.
- RESPOND: atomic claim (retry-safe) → gates (staff-takeover ai_enabled, blocked diner) →
  history (1h TTL = fresh visit fresh convo) → session_precheck (loop detect, circuit breakers,
  temp_reservation hooks ready) → MASTER → humanize delay → deliver (splits long replies,
  sends photos) → post_check (guest typed mid-reply → chained re-flush). Dead-letter after
  2 failures → apology + needs_attention. Boot sweep + SIGTERM drain.
- MASTER: sanitize → diner upsert → 0-LLM fast paths (FAQ hours/location/phone + closers,
  EN/AR/Franco templates) → classify (buckets: reservation|arrival|events|order|friendly) →
  dispatch. v1: all buckets land on FRIENDLY (specialists not built yet).
- FRIENDLY (host agent, gpt-4.1-mini): persona = greeter at the door + waiter who knows the
  menu. Rules: mirror guest's LAST message language (Franco → Latin letters), menu names stay
  English, greet only on first message, empathy-first for sad guests, NEVER invent (empty config
  field = "team will confirm"), never claim "booked" (passes reservation requests to staff with
  briefing + dashboard notification), silent allergy steering, hours humanized ("1 PM – 2 AM").
  Side effects: name+allergy capture→CRM, handoff briefings, rolling summary (14+ turns),
  suggested FAQs (unanswerable question → suggestion → staff approve in Settings → becomes FAQ),
  photo sending (menu photo_url). Tested: 70+ adversarial conversations, all failures fixed.
- JANITOR: hourly cleanup (idle conversations, stray buffers, stale queue).
Regression suite: 20 assertion cases through the real pipeline, 🧪 Run button in ops.
Metrics strip in ops: merge ratio, 0-LLM rate, spam blocks, dead letters.
Test convention: single session `web:test-mode`; ALWAYS delete test sessions from tenant DB after.

## CLAUDE CODE SKILLS AVAILABLE (user-level, ~/.claude/skills/ — work in every chat/project)
- `/langchain` — BEFORE writing any LangChain JS code: check npm versions (langchain,
  @langchain/core, @langchain/openai), fetch js.langchain.com/llms.txt + relevant pages +
  release notes. Fetched docs beat memory. Use for any chains/runnables/tool-calling work.
- `/langgraph` — same for @langchain/langgraph: StateGraph API, checkpointers, interrupts,
  human-in-the-loop, langchain-ai.github.io/langgraphjs/llms.txt. MUST be used when building
  the RESERVATION agent (its collect→quote→confirm state machine = LangGraph StateGraph).
- `/langfuse` — query Langfuse traces/prompts/datasets/costs via CLI + its docs
  (hotel lanchainflows uses Langfuse; resto flows have their own cost tracing but Langfuse
  integration is a future option).

## HOTEL PRODUCT STATUS (context)
Runs on n8n (n8ns.run.place): buffering → MASTER → specialists → Message Soap.
Live workflows patched 2026-07-11 to the new backend domain ("Buffering Whatsapp Soap" +
"Send Message"). n8n→Node migration exists in ai2-web/n8nnew/lanchainflows (buffering, master,
friendly done). Hotel stays on n8n for now; restaurant NEVER touches n8n.

## ROADMAP (docs/WORKFLOWS.md has full specs, 22 workflows)
🟢 DONE: plumbing (1-3), FRIENDLY (6), janitor.
NEXT IN ORDER:
1. RESERVATION + CONFIRM + CANCEL/MODIFY (#7-9): slot-filling (party/date/time) → availability
   computed in CODE from restaurant_tables+reservations (turn times 2p=90/4p=105/6+=120min) →
   guarded instant auto-confirm (quote-first, 30min freshness, re-check at confirm, no dupes)
   → R-CODE → dashboard. State in temp_reservation. Build as LangGraph StateGraph (use /langgraph skill).
2. ARRIVAL (#10): "I'm here" → mark arrived → host ping; running late → grace hold.
3. WHATSAPP GO-LIVE: user provides Meta creds → set WA_TOKEN/WA_APP_SECRET/WA_VERIFY_TOKEN
   on Railway flows → point Meta webhook to /api/wa/webhook → real payloads visible in ops.
4. v1.5 crons (#15-18): reminders (T-24h/T-3h buttons), abandoned recovery, no-show
   reconciliation + waitlist promotion, feedback funnel (sentiment-gated Google review link).
   Requires Meta template messages for >24h window.
5. Phase C: table-QR ordering + Paymob payments, marketing engine (hype drops, win-backs,
   birthday re-engagement), Instagram DMs, ORDER agent (#12).
PENDING SMALL: run migrations/003 in tenant SQL editor (activates flow_executions +
suggested_faqs) · run regression after · finish encrypting tenant creds in control plane
(code+key deployed, row still plaintext) · revoke the n8n API key shared in chat ·
Railway Hobby plan (flows must never sleep).

## IRON RULES (learned/decided with the founder)
- Agents ARE the product; every dashboard feature must feed or surface agent work.
- LLM extracts & phrases; CODE computes (dates, availability, prices, hours).
- Zero hallucination: only config/DB facts; empty field ≠ "none", it's "team will confirm".
- Restaurant dashboard never shows flows/executions/costs — that's ahlan-ops (internal).
- Instant auto-confirm reservations (deposits = config toggle later).
- Mirror guest language exactly; Franco in Latin letters; dish names stay English.
- The bot never claims to be human, but leans maximally human in voice.
- Clean up all test data from tenant DB after any testing; one test session: web:test-mode.
