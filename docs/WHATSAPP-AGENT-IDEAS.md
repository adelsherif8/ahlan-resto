# WhatsApp chat agent — competitor scan & idea pool (2026-08-05)

Goal: make the chat agent perfect. Scanned the founder's list + the wider field.

## Who does what

**OrderOnWhats.app** (direct) — AI chatbot 24/7 orders + FAQs, natural language, human
handover, free online storefront w/ unlimited products & variables, stock management,
pre-orders, payment links, broadcasts + automated campaigns, discount codes, reorder
reminders, demand forecasting dashboard, Google Sheets sync, internal POS. $13–129/mo,
no commission.

**OlaClick** (direct) — WhatsApp robot ordering, digital menu on own domain + QR builder,
order customization, AI order-status notifications, discount coupons, frictionless
loyalty w/ auto discount validation, AI product suggestions, mass messaging with AI,
delivery system w/ driver app + AI order routing, POS + KDS + inventory. From $8/mo.

**Foodics** (semi, MENA giant) — POS ecosystem: pay-at-table QR (view/split/pay),
customer display, self-order kiosk, waiter app, KDS, Foodics Pay daily settlements,
accounting, BI, loyalty + gift cards, app marketplace, multi-branch. KSA/UAE/Egypt.

**Simple Touch** (semi, Egypt) — 19 integrated apps; Talabat/Mrsool/Instashop order hub;
queue management (Hagzen); cloud kitchen; loyalty; e-invoice compliance; Paymob/
MyFatoorah/Fawry payments; SAP/Odoo integration; 24/7 support.

**Deonde** (semi) — white-label apps + web, QR ordering, subscription orders, auto driver
assignment + live tracking + proof of delivery + driver payouts, push/SMS/email/WhatsApp
campaigns, loyalty points, promocodes, 30+ payment gateways, delivery SLA monitoring.

**Zoko / WATI / field patterns** — specialized sub-agents (product Q&A / order status /
guided selling), abandoned-cart recovery (20–25% recovery, first nudge at 30–60 min),
status pings at every step, catalog/interactive messages, multilingual, CRM sync.

## What Ahlan already wins on
True conversational AI (they're mostly button-flow bots), Arabic/Franco for real,
code-computed bills, zero hallucination policy, per-restaurant persona, POS + KDS +
CRM + driver page in one box, no commission.

## Idea pool for the chat agent (pick and I build)

### Revenue
1. **Abandoned-order recovery** — guest built a draft (items in pending) then went
   silent → 30–60 min later, one nudge from the restaurant number: "your 2 Iconic
   Meals are still waiting — send *yes* and it's in the kitchen". Field data: 15–25%
   recovery. We already store drafts; this is a janitor-flow sweep + one push.
2. **Post-order upsell ping** — 5 min after confirmation: "add a dessert/drink to
   O-041 before the kitchen closes it?" (+12–18% ticket lift in the field). One-tap.
3. **Reorder reminders** — guest ordered weekly, silent for 10 days → "the usual?"
   (respect 24h template rules; needs Meta template approval).
4. **Smart cross-sell in-chat** — attach-rate-ranked pairs_with (same data as POS
   chips): after items chosen, one short suggestion line max.
5. **Payment links in chat** — Paymob/Fawry link right in the confirm message
   (config keys already planned; kills COD-only friction).

### Experience
6. **WhatsApp-native interactive everything** — we use buttons/lists; add product
   carousel cards w/ photos for "show me the burgers" (catalog message), tap = add.
7. **Order tracking sub-flow** — "where's my order" already fast-pathed; add live
   stage timeline message (confirmed → cooking → rider assigned → at your door)
   with the rider's first name once assigned.
8. **Pre-orders / scheduled orders** — "deliver at 9pm" → order lands with
   pickup_time, KDS shows it in the pre-order lane (lane exists).
9. **Group order links** — "ordering for the office?" → link where each colleague
   adds items to ONE order (like the 4X4 slots, but per-person).
10. **Voice-note orders** — guests send voice notes constantly in Egypt; transcribe
    (Whisper) → same extraction pipeline. Big differentiator.
11. **Location-pin-first delivery** — we do this; add "saved addresses" quick-reply
    chips ("Home 🏠 / Work 🏢") from the CRM.

### Retention
12. **Loyalty in chat** — same pos.loyalty rule: "this is your 6th order — free
    drink added 🎁" (code checks visit_count, never invents).
13. **Win-back campaigns** — 30-day-silent guests get one template broadcast
    (needs Meta templates + explicit founder approval per send).
14. **Post-delivery review ask** — already planned (FB14): 1h after delivery →
    Google-review link; complainers get "we're on it" instead.
15. **Birthday/occasion pings** — CRM has occasions from chats; one template a year.

### Ops & robustness
16. **Order-status webhooks → guest** — every board move already pushes; add rider
    assigned/near/arrived (driver page does this — unify copy).
17. **Multi-number routing** — one WhatsApp number per branch (Meta supports
    multiple numbers per WABA); route by wpid — the multi-tenant roadmap item.
18. **Talabat/Mrsool order ingestion** (Simple Touch's hub) — their orders appear
    on the same KDS; Talabat partner API is on the roadmap already.
19. **Catalog sync to WhatsApp Business catalog** — menu_items pushed to the Meta
    catalog so the storefront tab inside WhatsApp always matches the menu.
20. **SLA guard** — if no reply in 20s (LLM outage), auto-fallback: "got it, one
    sec 🙏" + retry, then dead-letter to staff with a notification (partially
    exists via routing_failures; make the guest-side fallback graceful).

## Triage (2026-08-05) — what needs what

The rule that decides everything: WhatsApp allows FREE-FORM messages only within 24h of
the guest's last message. Outside that window, ONLY Meta-approved template messages.

### FOUNDER DECISIONS (2026-08-05)
- BUILD bucket A now. Item 8 (pre-orders polish) and 15 (birthdays): NOT NOW.
- 18 Talabat/Mrsool: REMOVED for now.
- 3 Reorder reminders: per-restaurant TOGGLE in Settings (sends unlock when its
  Meta template is approved).
- A-items get dashboard Settings toggles ("Automations" block in AI host tab).
- Costs: all A pushes are free-form in-window = $0 Meta cost, 0 LLM (code-built
  text). Voice notes ALREADY LIVE (whisper-1, ~$0.006/min). Template sends (B)
  will cost per message when approved (~$0.02–0.06 in Egypt, marketing tier).

### A. Build now — no template, no external anything
- **1 Abandoned-order recovery** — the draft is <24h old by definition; janitor sweep + one push.
- **2 Post-order upsell ping** — 5 min after confirm = deep inside the window.
- **4 Smart cross-sell** — nightly attach-rate compute + one suggestion line.
- **7 Order-tracking timeline** — guest asked = window open.
- **10 Voice-note orders** — ALREADY LIVE (media.js: whisper-1 → same pipeline).
- **11 Saved-address chips** — CRM addresses as quick replies.
- **12 Loyalty in chat** — pos.loyalty rule, code-checked.
- **16 Rider-status copy unify** + **20 SLA guard** — internal hardening.

### B. Needs Meta TEMPLATE approval first (founder approves wording, I submit via API)
- **3 Reorder reminders** (guest silent 10 days = window closed)
- **13 Win-back campaigns** (30-day silent; also needs a dashboard broadcast screen w/ audience + opt-out)
- **15 Birthday/occasion pings**
- **14 Review ask** — usually in-window (1h after delivery) so it works WITHOUT a
  template; the template is only the fallback for late arrivals. Can ship in A-mode.

### C. Needs DASHBOARD work (ours to build, part of the feature)
- Settings toggles + timing for 1/2/3 (recovery delay, upsell on/off)
- Broadcast screen for 13 (audience, preview, send log, opt-outs)
- google_reviews_url field for 14 · birthday field on Diners for 15
- Group-order page for **9** (token page like the driver link) + contributors shown on the order
- Near-miss/attach-rate views already exist for 4

### D. Blocked on EXTERNAL parties (not our tech — founder must obtain)
- **5 Payment links** → Paymob/Fawry merchant account + API keys
- **6 Catalog carousels** + **19 catalog sync** → Meta Commerce Manager catalog
  connected to the WABA (founder grants asset access; then our code syncs menu_items)
- **17 Multi-number routing** → extra phone numbers bought + verified on the WABA

Nothing on the list is technically impossible for us — D items are credentials/approvals,
not capability gaps.

Sources: orderonwhats.app · olaclick.com · foodics.com · simpletouch-sw.com · deonde.co ·
unite.ai/best-ai-whatsapp-tools · aisensy.com/blog/whatsapp-for-food-delivery ·
helo.ai WhatsApp cart-recovery · gallabox.com abandoned-cart guide · ordersetu.app
