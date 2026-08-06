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
   **Pricing mode (founder decision 2026-08-05: BOTH, per restaurant):**
   - `pricing: "fixed"` — one set price for the custom sandwich (layer limits from
     config keep it fair, e.g. max 2 patties included, extras charge deltas)
   - `pricing: "per_layer"` — the total is the sum of chosen layers
   The restaurant flips between them in Settings → Builder.

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

## SELECTED by founder (2026-08-05) — build these when the builder gets the go

1. **Doneness & sauce sliders** — well-done ↔ juicy, sauce light ↔ extra, chips on the build.
2. **Allergy filter** — guest marks no dairy/gluten/nuts first → incompatible layers grey
   out, from the menu's dietary data only (never guessed).
3. **Random burger button** — "surprise me" builds a valid random stack.
4. **"Your build ≈" comparison** — ⚠️ BUILT, THEN HIDDEN (2026-08-06). The first cut
   matched on PRICE alone and produced nonsense: a burger came back "≈ Cheezy Hot Dog
   — same price". Price similarity says nothing about whether two things are alike.
   TO FINISH: load each menu item's LAYER LIST (the Blender export already has one per
   item — `Blender Layers/lucizmenu/<item>/layers.txt`), store it against the menu item,
   and diff layer-sets instead of prices. Re-enable with
   `menu_config.build_your_own.compare = true` once that data exists.
5. **Build photo card** — branded image of the creation (name + layers + logo) for
   receipt/WhatsApp/story. PURE CODE: canvas render, no AI.
6. **Assembly animation** — layers drop into place with a sizzle on confirm.
7. **QR re-order from the receipt** — scan → builder preloaded with that exact build.
8. **Light mode fallback** — 2D stacked-list version for weak phones/slow data
   (13MB 3D assets must never lose an order).
9. **Kids mode** — smaller portions, bigger buttons, sillier names.
10. **Sides builder** — same engine for loaded fries (base + toppings).
11. **Limited-time layers** — seasonal ingredient with countdown badge, auto-expires
    like specials.
12. **Protein counter** — protein per layer for the gym crowd (configured data only).

## In consideration (trend watch — not committed)
- **Half/half sandwich** — left half one setup, right half another (two people, one burger).
- **Build challenges** — "beat the chef": restaurant posts a weekly target build,
  ordering it earns a configured perk.

## Idea pool (founder round, 2026-08-05 — each is an ON/OFF toggle in Settings → Builder)

- **Make-it-a-meal step**: after the sandwich is built → "add fries & a drink?" with the
  real sides/beverages from the menu. Toggle: `builder.upsell_meal`. Off = sandwich only.
- **Beverages & fries modules**: each menu category can be enabled as a builder step
  (drinks picker, fries picker) — the restaurant decides which appear.
- **Saved builds + reorder**: the guest's creation is saved under their WhatsApp number
  ("Adel's Double Smash"); next time the bot offers "your usual custom build?" — one tap
  reorders it. Same for the builder page: "build again".
- **Name your burger**: guest names the creation; the name prints on the KDS ticket and
  receipt ("1x ADEL'S INFERNO — double patty, jalapeño…"). Fun + shareable.
- **Share the build**: a link/image of the build a friend can open and order as-is.
- **Chef's presets**: 3–4 starter builds (from config) the guest customizes from,
  instead of an empty bun.
- **Layer rules from config**: max patties, max cheese, required layers — CODE enforces.
- **Live price ticker**: total updates with every layer (code-priced from config).
- **Calories per layer** (optional, only if data entered — never invented).
- **Same pipeline as everything**: submitted build → same orders table, same KDS board,
  same station routing (grill), same receipt PDF, same WhatsApp confirmation from the
  restaurant number, same CRM bump. The builder is just another order source.
- **Group build**: one order, several people each build their own (slots-style, like the 4X4).
- **Counter kiosk mode**: same page fullscreen on a tablet in-store.
- **Trending builds**: weekly "most built" — the bot can pitch it ("this week everyone's
  making double-cheese + mushroom — want to try it?").
- **Interactive layer boxes**: besides the 3D view, each layer is a visual CARD/box
  (photo + name + price) you tap to stack — the 3D burger updates live as boxes are
  picked; tap a stacked layer to remove it. Choose-how-it-looks, not a dropdown form.
- **Full brand theming**: the page pulls the restaurant's `brand.primary` color, logo
  and fonts from Settings (same as the dashboard does) — buttons, progress, highlights
  all in the restaurant's identity, logo in the header. Multi-tenant by design: every
  restaurant's builder looks like THEIR page, zero code changes.

Total: ~2 days of focused work. Decision needed from founder before starting:
- (a) phone-entry or bot-link-only access?
- (b) is Build-Your-Own a fixed-price item + per-layer deltas, or pure per-layer sum?
- (c) which branches offer it?
