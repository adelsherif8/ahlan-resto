# Reviews & Complaints — plan (FB14, PENDING — not building yet)

Founder ask: a reviews/complaints tab — good AND bad, bad ones specially flagged with a
handling workflow; ~1 hour after an order arrives, WhatsApp the guest the Google-reviews
link asking them to review.

## Phase 1 — Capture (the bot already asks "rate 1–5" after delivery)
1. `reviews` table: order_code, phone_number, rating (1–5), text, source
   (whatsapp | google-prompt | manual), status (new | handling | resolved), assigned_to,
   resolution_note, created_at. Migration.
2. Bot: when a guest replies with a rating or complaint after an order, the flow
   writes the review row (LLM extracts rating+sentiment, CODE stores). Complaints
   (≤2 stars or angry sentiment) also flip the chat to needs_attention.

## Phase 2 — Dashboard tab (Guests → Reviews)
3. List with filters (all / bad / unhandled); bad ones red-flagged at top.
4. Handling workflow: assign to a staff member → "handling" → resolution note →
   "resolved". A bad review left unhandled >24h shows on Overview as a warning.
5. KPI cards: avg rating (7/30d), NPS-ish split, response time to bad reviews.

## Phase 3 — Google review push
6. Settings: `google_reviews_url` field.
7. Scheduler (reminders flow already runs on a schedule): find orders delivered/served
   ~1h ago, guest not yet prompted, rating ≥4 or no complaint → push from the
   RESTAURANT WhatsApp: "Loved it? A quick Google review helps us a lot 🙏 <link>".
   Guests who complained get a "we're on it" follow-up instead, never the link.
8. 24h-window rule: if the last guest message is >24h old, WhatsApp needs a template
   message (Meta approval) — until templates are approved, only prompt guests whose
   last message is within the window (the 1h-after-delivery case always is).

## Idea pool (2026-08-05, competitor-grounded: Ovation / Tattle / Birdeye — founder picks)

### Capture
1. 2-tap star buttons in chat after delivery (⭐1–5 buttons, not free text) — Ovation's model, highest response rates.
2. QR on receipts/tables → lands in the WhatsApp rating flow (reuses receipt-QR machinery).
3. Photo complaints auto-attached to the review (vision already classifies complaint_photo).
4. Voice complaints transcribed into the record (transcription already live).

### Intelligence
5. AI theme tagging — food quality / delivery time / rider / wrong item / staff / price → "cold fries mentioned 6× this week".
6. Per-item complaint linking — Menu Engineering panel shows "Loaded Fries: 3 complaints this month" next to margin.
7. Per-branch rating scoreboard (league table).
8. Rider quality scores — delivery complaints tag the assigned courier, score in the Delivery tab.
9. Ratings × ops correlation — "orders >40 min rate 1.8 stars lower" (ratings vs prep/late data).

### Service recovery (the money features)
10. Instant recovery flow — ≤2 stars triggers apology + optional auto-voucher via the promos engine, BEFORE they reach Google.
11. Manager WhatsApp alert on bad reviews — guest + order + complaint, one-tap "I'll handle it".
12. 48h close-the-loop — "did we make it right?" after resolution; reopens if not.
13. Comeback voucher for resolved complainers after X days (needs Meta template).
14. Comp tracking — resolutions attach comps/refunds logged into the discounts/Z-report machinery.

### Public reputation
15. Feedback-first funnel — private rating first; promoters get the Google link, unhappy get recovery (soft-gating, Google-policy-safe phrasing).
16. Google reviews imported (Places API) → same inbox as in-chat reviews.
17. Reply to Google reviews from the dashboard with AI-drafted replies the owner approves (Ovation's newest feature).
18. 5-star quote cards — best reviews rendered as branded Instagram-story images (canvas, no AI cost).
19. Competitor rating watch — nearby competitors' Google ratings side-by-side.

### Analytics
20. Proper NPS ("would you recommend us?") occasionally, NPS trend on Overview.
21. Weekly digest — avg rating, themes, unhandled count on Overview or to the manager's WhatsApp.
22. Staff resolution leaderboard — who resolves, how fast.

Earlier open questions folded in: 5-star perk (see 10/13), bad-review SLA ping (see 11), weekly digest (see 21), Google import (see 16).

Claude's suggested pilot shortlist: 1, 5, 10, 11, 15, 16 (complete loop: capture → tags → recovery → escalation → funnel → unified inbox); 6 and 8 as the differentiators nobody in Egypt has.
