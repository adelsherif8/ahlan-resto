# 3D Sandwich Builder — step-by-step plan (FB12, PLAN ONLY — nothing built yet)

What exists: `sandwich builder/` — Three.js r128 + GLTFLoader page (67KB HTML), J Smash
themed, 7 .glb layers (topbun 3.1MB, patty 6.1MB, bottombun 2.1MB, tomato 0.9MB, 2×
cheese, lettuce; ~13MB total), a demo login screen, `__MACOSX` junk to strip.

## Phase 1 — Host it (½ day)
1. Strip `__MACOSX`, compress the .glb files (Draco/meshopt: 13MB → target ≤3MB total;
   patty alone is 6.1MB and will choke mobile data).
2. Move to `dashboard/public/build/` → served at **ahlan-resto.vercel.app/build** (same
   domain as the dashboard, zero new infra).
3. Replace the demo login with a single phone-number entry (WhatsApp number), or accept
   a `?t=<token>` magic link so the bot can send a pre-authed link (same pattern as the
   courier driver page).

## Phase 2 — Price engine (½ day, iron rules apply)
4. New `menu_config.build_your_own` config: each layer = {name, price, max_qty}. CODE
   computes the running total in the page; prices come from Settings, never hardcoded.
   Any layer without a configured price = not offered (never invent a number).

## Phase 3 — Orders (½ day)
5. "Send to kitchen" → POST backend `/api/orders` with source `builder`, the layer list
   as the item's options (e.g. "Custom Smash: double patty, cheddar ×2, no tomato"),
   order_type + branch chosen in a final step (same combined question the bot asks).
6. Ticket lands on the SAME KDS board; receipt PDF generated like any other order.

## Phase 4 — WhatsApp loop (½ day)
7. On submit, flows pushes the confirmation from the RESTAURANT WhatsApp number: order
   code, the build summary, ETA, receipt link (existing pushGuest machinery).
8. Bot integration: when a guest asks to customize ("can I build my own burger?"),
   the bot replies with the magic link. Hook: `menu_config.build_your_own.enabled`.

## Phase 5 — Polish (as needed)
9. Mobile QA (the page is desktop-oriented today), brand colors from Settings,
   Arabic/Franco labels, camera controls tuning.

Total: ~2 days of focused work. Decision needed from founder before starting:
- (a) phone-entry or bot-link-only access?
- (b) is Build-Your-Own a fixed-price item + per-layer deltas, or pure per-layer sum?
- (c) which branches offer it?
