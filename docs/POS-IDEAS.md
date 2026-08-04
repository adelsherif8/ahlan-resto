# POS — parked ideas (2026-08-05)

Round-2 additions for the POS tab, saved after the FB3 redesign shipped
(cards with photos/details, item sheet with progress + quick notes, edit-in-place
cart lines, duplicate-line merge, `/` search). Do these when the founder picks
them up again:

1. **Number-pad qty** — tap the qty to type it (12 waters without 11 taps).
2. **Discounts/comps** — % or fixed EGP off with a reason, manager PIN, logged on the ticket.
3. **Split payment** — half cash half card, recorded as such on the order.
4. **Repeat-guest one-tap reorder** — CRM lookup already shows the guest; add a
   "usual: Iconic Meal ×1 — add it" chip built from their order history.
5. **Open tickets rail** — today's active POS orders + statuses inside POS,
   tap to reprint, no tab-switch to Orders.
6. **Kitchen-fire control** — hold / fire-now per line for dine-in courses.
7. **PLU keyboard shortcuts** — type `2 ic ⏎` = 2 iconic meals (power-cashier speed).
8. **Shift summary** — end-of-shift card: orders, cash expected in drawer,
   card/instapay totals.
9. **Offline queue** — network drops → orders queue locally, sync when back
   (Egypt internet reality).
10. **Bigger touch mode** — toggle that scales the whole POS up for a wall
    tablet at the counter.

## Competitor-inspired (Oracle Micros Simphony · Odoo POS · Toast · Square · Foodics)

11. **Conversational order entry** (Simphony's flagship) — a free-text bar where the
    cashier types the order exactly as spoken: "2 iconic meals no pickles and a sprite"
    → parsed into cart lines. Ahlan twist: reuse the SAME LLM extractor the WhatsApp
    bot already runs, so POS and bot understand identical language (incl. Arabic/Franco).
12. **Upsell prompts at add-time** (Simphony cross-sell) — when an item is added, show
    its `pairs_with` from the menu DB as one-tap add chips ("Goes well with: Loaded Fries").
13. **Split the bill by item/seat** (Odoo) — divide one ticket into separate checks,
    each with its own payment method (different from split-payment on one check, #3).
14. **Tips** (Odoo/Toast) — tip capture at payment, printed on the receipt, totaled
    per cashier in the shift summary.
15. **Station routing** (Odoo kitchen/bar tickets) — tag categories to stations
    (grill / fryer / drinks); the KDS ticket splits per station so the drinks screen
    never shows burgers.
16. **Floor-map table pick** (Odoo floor integration) — for dine-in, tap the table on
    the existing Floor map instead of typing "T3"; table state flips to occupied.
17. **Cashier PINs & attribution** (Foodics/Toast) — quick PIN switch between staff on
    one terminal; every order records who rang it; per-cashier drawer expectation at
    shift end.
18. **X / Z reports** (Micros/Foodics classic) — mid-shift X report and end-of-day Z
    report: orders, discounts, voids, payment-method breakdown, VAT total — printable
    like a ticket. (Extends parked idea #8.)
19. **Inventory depletion + auto-86** (Toast/Foodics) — optional per-item stock counter
    that decrements on each sale; at zero the item flips to sold-out today everywhere
    (POS, bot, menu) — one source of truth.
20. **Voids & refunds with reasons** (all of them) — void line/ticket with a reason +
    manager PIN, logged and shown on the Z report; refunds mirror to the CRM.
21. **Guest-facing confirmation screen** (Simphony kiosk pattern) — after Create, flip
    the tablet to show the guest their code + a QR that opens WhatsApp ("track your
    order here") — feeds guests straight into the AI channel.
22. **Loyalty chips from the CRM** (Foodics cashback / Square loyalty) — configured rule
    like "every 6th order: free drink"; when the phone lookup matches, the POS surfaces
    an "eligible: free drink" chip the cashier can apply — computed by code from
    visit_count, never invented.
23. **Arabic RTL cashier mode** (Simphony multilingual) — one toggle flips the POS UI
    to Arabic for staff who prefer it; menu item names stay as configured.

Sources: [Oracle Simphony POS](https://www.oracle.com/food-beverage/restaurant-pos-systems/simphony-pos/) ·
[Oracle MICROS](https://www.oracle.com/food-beverage/micros/) ·
[Odoo POS Restaurant features](https://www.odoo.com/app/point-of-sale-restaurant-features) ·
[Odoo POS review](https://www.posusa.com/odoo-pos-review/) ·
[Toast POS review](https://www.therestauranthq.com/restaurants/toast-pos-review/) ·
[Square vs Toast comparison](https://sonary.com/content/square-vs-toast-pos-which-is-better-for-your-restaurant/)
