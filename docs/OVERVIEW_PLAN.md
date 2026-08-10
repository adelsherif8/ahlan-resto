# FB-F — Overview page v2: plan

Goal: the Overview is the FIRST screen a manager sees. It should answer, in 5 seconds:
**"how is today going, is anything broken, and what needs me right now?"** — not be a
museum of numbers.

## What the best restaurant dashboards lead with (research summary)

Looked at the patterns in Toast, Square for Restaurants, Owner.com, and Deliverect:

- **One hero row: today vs the same day last week** — revenue, orders, avg ticket. Always
  a comparison, never a lone number (a lone "3,400 EGP" means nothing at a glance).
- **A "needs attention" strip at the top** — failed orders, unanswered chats, long-waiting
  tickets, negative reviews. The alert strip IS the product; numbers are secondary.
- **An hourly sales curve for today** overlaid on the same weekday's average — managers
  instantly see "tonight is slow/busy for a Tuesday".
- **Channel split** (for us: WhatsApp bot vs POS walk-in vs phone) — shows what the AI is
  actually contributing (= the number that sells Ahlan itself).
- **Top movers** — items selling unusually more/less than usual, not just "best sellers".
- **Everything clicks through** to the page where you act on it.

## What our Overview has today
KPIs (sampled), agent activity, recent guests, some cards — but: no day-over-day
comparison, no needs-attention strip, no hourly curve, no channel split, and several
cards are static/duplicated from other pages.

## Proposed v2 (build order)

1. **Needs-attention strip** (top, red/amber chips, each links to its page):
   unanswered chats needing human (needs_attention sessions) · orders stuck >X min ·
   unhandled negative reviews · delivery paused flag · riders on the road >60 min.
2. **Hero row**: Today's revenue / orders / avg ticket, each with **vs last <same weekday>**
   (↑12% green / ↓8% red). Data: orders table, two date windows — no new tables.
3. **Hourly curve**: today's orders/revenue by hour vs 4-week same-weekday average
   (tiny SVG area chart, no chart lib).
4. **Channel split**: WhatsApp-bot orders vs POS orders (phone_number prefix web:/walkin: vs
   real) — count + revenue + "the bot took N orders today (X%)".
5. **Top movers**: items ±50% vs their 4-week average (reuses /api/menu/performance).
6. Keep: agent activity card, guests card. Drop/merge anything duplicated from other pages.

All computable from existing endpoints/tables (orders, chat sessions, feedback, menu
performance) — **no migrations needed**. Estimated: one focused pass, dashboard-only deploy,
zero suite cost (no flows changes).

## Open question for the founder
OK to build v2 as above (replacing the current top half of Overview), or keep the current
layout and only ADD the needs-attention strip + hero comparison row?
