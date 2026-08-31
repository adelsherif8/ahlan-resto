# Munadim

WhatsApp-first automation platform for restaurants (reservations, host chat, orders, waitlist) with a full management dashboard. Sister product of `ai2-web` (hotels) — independent codebase, same architectural DNA.

## Layout

```
ai2-resto/
  flows/        THE BOT — the WhatsApp orchestrator: message pipeline, router, and the
                order / friendly / reservation / arrival agents, delivery engine, PDFs,
                tracking + rider pages, ops API, and the persona + fixture test suites.
                → flows/README.md maps every file.            live: flows.munadim.com
  dashboard/    React 19 + Vite + TS + Tailwind SPA — the restaurant dashboard
                (orders, chats, menu editor with Arabic names, POS, settings incl.
                delivery map + upsell).                         live: app.munadim.com
  backend/      Express API behind the dashboard (auth, tenant resolution, menu,
                reservations, tables, diners, waitlist).        live: api.munadim.com
  ops/          Internal ops console (flows/executions traces, health, cost, test chat)
                — reads flows' /api/ops/* endpoints.
  site/         Marketing site (Astro).
  migrations/   SQL for the Munadim control-plane DB and per-restaurant tenant schemas
  docs/         HANDOFF.md (full brief), DASHBOARD-HANDOFF.md, OPS-CONSOLE-HANDOFF.md,
                agent workflow plans, payload contracts
  .claude/      /dashboard and /ops skills that load the handoffs for a new chat
```

## Architecture (mirrors ai2-web, cleaned up)

- **Control plane**: `restaurants` table in the Munadim control-plane Supabase — config JSONB (`basic_info`, `hours`, `sections`, `reservation_policy`, `ai`, `payments`, `faqs`) + encrypted per-tenant Supabase creds in `integrations.supabase`.
- **Tenant DBs**: each restaurant gets its own Supabase project (diners, reservations, orders, menu, waitlist, chat tables). Canonical phone column everywhere: `phone_number` (snake_case — the hotel repo's 5-convention mess is fixed here from day 1).
- **Auth**: JWT (`{ id, email, name, role, restaurantId }`), roles: `admin`, `manager`, `host`, `kitchen`, `livechat`.
- **Flows**: no n8n. WhatsApp agents run on the LangChain flow-engine pattern proven in `ai2-web/n8nnew/lanchainflows` (defineFlow / traced nodes / Langfuse cost tracing). See `docs/AGENT_WORKFLOWS.md`.

## Dev quickstart

```bash
# backend (port 5051) — runs in DEMO MODE with seeded in-memory data when no Supabase env is set
cd backend && npm install && npm run dev

# dashboard (port 5174)
cd dashboard && npm install && npm run dev
```

Demo logins (demo mode only): `owner@demo.resto` / `demo123` (admin), `host@demo.resto` / `demo123` (host), `kitchen@demo.resto` / `demo123` (kitchen).

## Modes

- **Demo mode** (default, no env): in-memory seeded data — full dashboard works instantly, mutations persist until restart.
- **Real mode**: set `SUPABASE_AHLAN_URL` / `SUPABASE_AHLAN_SERVICE_KEY` (+ per-restaurant creds in the control plane). Run `migrations/*.sql` first.

## Deploy (planned, same as hotel product)

- dashboard → Vercel (`vite build` → `dist`)
- backend + flows → Railway (`railway up`)
