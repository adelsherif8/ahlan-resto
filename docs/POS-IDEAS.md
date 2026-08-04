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

## Looks & style (what the best-looking POS screens do)

24. **Image-first tiles with instant detail** — big photo tiles; selecting an item
    surfaces ingredients/modifiers inline without a page change (we half-do this;
    push photos larger, text smaller — cashiers recognize pictures faster than names).
25. **Color-coded categories** — each category gets a hue (chips + a thin tile edge),
    so the eye finds "Drinks" before reading; derived from the brand accent so it
    stays on-theme per restaurant.
26. **One-hand bottom action bar on tablets** — Park / Create / total pinned to the
    bottom within thumb reach (current layout is desktop-right; add a tablet breakpoint).
27. **Dim-light contrast pass** — dark mode is already the default; bump touch targets
    to ≥44px and raise text contrast for greasy-finger, low-light counters. Battery
    friendly on all-shift tablets.
28. **Zero-training layout discipline** — the #1 complaint about classic POS is training
    time; keep EVERY action ≤2 taps from the grid and never hide critical actions in
    menus (audit each new feature against this rule).

## Advanced functions (from the rest of the field: Lightspeed, TouchBistro, Clover, SpotOn, Nory-style AI)

29. **Menu engineering report** (Lightspeed) — per-item profitability + popularity
    quadrants (stars / plow-horses / puzzles / dogs) from order history; needs a
    cost-per-item field on menu_items, then it's pure code.
30. **Margin-leak alerts** (SpotOn "Profit Assist") — code watches discounts, voids,
    comps and cancellations per cashier/branch/day and flags anomalies on Overview
    ("voids at Maadi are 3× the other branches this week").
31. **Demand forecasting** (Nory-class AI) — predict tomorrow's orders per hour/branch
    from history (day-of-week + trend); drives prep quantities and staffing hints.
    Ahlan twist: we already store every order with timestamps — a small code model
    (moving averages per weekday-hour) gets 80% of the value with zero LLM cost.
32. **Sales by employee/time heatmap** (Clover) — once cashier PINs exist (#17), a
    weekly heatmap of orders and voids per staffer per shift.
33. **Tableside ordering mode** (TouchBistro) — the same POS on a phone in the waiter's
    hand: pick table on the Floor map, take the order at the table, fires straight to
    KDS. Mostly a responsive breakpoint + table-first flow of what exists.
34. **Multilingual smart suggestions** (2026 AI-POS trend) — the upsell chips (#12)
    localized: Arabic-speaking cashier sees Arabic prompts; suggestion ranking from
    real attach-rates (which pairs actually sell together), computed nightly by code.
35. **Prep-station load balancing** (iiko/Syrve pattern) — when the grill station's
    open-ticket count crosses a threshold, new tickets show a longer quoted ETA and
    the bot's promised times stretch automatically — one honest ETA everywhere.
36. **Low-stock prep alerts** (Lightspeed inventory) — pairs with #19: "patties at 12
    left at current pace you run out ~9pm" on Overview.

## Their weak points — Ahlan's openings

The consistent pain across the big names (founder ammo for pitches):

- **Contracts & lock-in** — Toast: 2-year contract + early-termination fees + setup fee;
  Lightspeed: auto-renewing contracts you can't exit early. → Ahlan: month-to-month,
  no lock-in.
- **Hidden costs** — Toast's offline mode needs a paid backup router; online ordering
  and accounting integrations cost extra; Lightspeed charges extra for online orders;
  Clover pricing varies by reseller (opaque). → Ahlan: WhatsApp ordering IS the online
  channel, included; one price.
- **Proprietary hardware** — Square, Toast and Clover all push their own terminals;
  high upfront cost. → Ahlan runs in a browser on any phone/tablet/laptop the
  restaurant already owns.
- **Support roulette** — Clover support depends entirely on the reseller (documented
  case: terminal frozen on a Saturday night, 45 min downtime, nobody answered).
  → Ahlan: the founder IS the support line during pilot; later a WhatsApp support bot
  (eat our own cooking).
- **Setup & training cost** — Micros Simphony is notoriously complex to configure and
  Oracle training is expensive; classic POS onboarding takes days. → Ahlan: settings
  are one dashboard page; the "≤2 taps" rule (#28) keeps training near zero.
- **Weak/expensive per-location scaling** — Square's per-location fees stack up
  multi-site; full-service coursing is basic. → Ahlan: branches are rows in config,
  not licenses.
- **They ALL miss the guest channel** — none of them lives where Egyptian guests
  actually order: WhatsApp. Their "online ordering" is a web page bolted on with fees.
  Ahlan's POS and AI waiter share one brain (menu, prices, options, CRM) — that's the
  moat, not a feature.
- **No conversational anything** — even Simphony's "conversational ordering" is a
  screen-layout trick, not language understanding. Idea #11 (LLM order entry, incl.
  Arabic/Franco) has no equivalent in any of them.

Weak-point sources: [Square vs Toast vs Clover vs Lightspeed](https://hustlerslibrary.com/square-vs-toast-vs-clover-vs-lightspeed-best-pos-system-for-small-business-2026/) ·
[Toast/Square/Clover guide](https://beancount.io/blog/2026/07/10/toast-square-clover-pos-system-guide) ·
[Toast vs Square vs Clover](https://smartrestaurantowner.com/blog/toast-vs-square-vs-clover) ·
[Odoo vs Oracle Micros whitepaper](https://www.odoo.com/page/odoo-vs-oracle-micros)

Sources: [Oracle Simphony POS](https://www.oracle.com/food-beverage/restaurant-pos-systems/simphony-pos/) ·
[Oracle MICROS](https://www.oracle.com/food-beverage/micros/) ·
[Odoo POS Restaurant features](https://www.odoo.com/app/point-of-sale-restaurant-features) ·
[Odoo POS review](https://www.posusa.com/odoo-pos-review/) ·
[Toast POS review](https://www.therestauranthq.com/restaurants/toast-pos-review/) ·
[Square vs Toast comparison](https://sonary.com/content/square-vs-toast-pos-which-is-better-for-your-restaurant/)
