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

## Ideas to decide on (founder input wanted)
- Auto-reply thanking 5-star reviewers with a small perk ("free drink next visit")?
- Bad-review SLA: who gets pinged (manager WhatsApp?) when a complaint sits unhandled?
- Show a "reviews this week" digest on Overview?
- Pipe Google reviews back in (scrape/API) so the tab shows BOTH in-chat and Google?
