# Koffee Kulture — dine-in chat widget (pilot design, 5 Nov 2026)

Status: tenant row seeded (`koffee-kulture`, schema `r_koffee`), menu seed written, widget NOT built.
Founder's constraints: dine-in only; no pay-first; no Wi-Fi check; **nothing for staff or waiters
to do**. Verification = the table's QR + the phone's location. Nothing else.

## 1. How a guest orders

1. Scans the QR on the table → `kk.munadim.com/t/<token>` (we host it; the café needs no website).
2. The page asks the browser for location once ("so we know you're at the café"), opens the chat
   bubble bottom-right, and greets: "Table A7 at Arkan — what can I get you?"
3. Guest chats, the bot builds the order (sizes, milk, extras, add-ons all from the menu data),
   shows the bill with the 12% service charge, guest confirms.
4. The ticket lands on the counter screen (our kitchen board) as **Table A7 · 14:32 · O-XXXX**.
   Payment stays at the counter / with the bill, exactly as today.

## 2. Table identity — two checks, both automatic

**A. Signed table token in the QR.** `token = base64url(branch|table|HMAC(secret_of_the_day, branch|table))`.
The secret rotates daily at 04:00 Cairo (derived from `ENCRYPTION_KEY` + date, so nothing to store);
yesterday's QR photo stops working. QR codes are printed once per table with a long-lived
token variant (`v=static`) whose HMAC uses a per-tenant secret, and the DAILY rotation applies to
the *session* the scan creates (see C), not to the print — otherwise the café re-prints every day.
Scanning the QR is the first proof: you had to be at the table to read it.

**B. Geofence.** The widget sends `{lat, lng, accuracy}` from the browser's Geolocation API with
every order confirmation. The flows service checks the haversine distance to the branch named in
the token (`basic_info.branches[].lat/lng`) against `ai.dine_in_widget.geofence_m` (120 m,
plus the reported accuracy up to 100 m — indoor GPS is 20–60 m off). Outside the fence or
location denied → the bot says "I can only send a table order from inside the café — allow
location, or order at the counter". Menu browsing still works without location.
Spoofing GPS needs a developer-mode phone; combined with needing the physical QR it is not a
realistic prank vector for a coffee order.

**C. Table session.** The first scan creates a session `{branch, table, started_at, expires_at:
+180 min}` keyed to the browser (cookie + localStorage). Orders inside the session reuse it;
a second scan of a different table ends it. After expiry the guest scans again. A session that
has placed an order and then goes quiet for 90 min is closed (table turned).

What is deliberately NOT here: staff confirmation, reverse codes, Wi-Fi/IP checks, pay-first.

## 3. Pieces to build (≈ 2.5 days)

| Piece | Where | Effort |
|---|---|---|
| Public chat endpoint: `POST /api/widget/:slug/send` with table-token auth, per-token rate limit, geofence check on confirm, forces `order_type=dine_in` + `table_number` from the token | flows `server.js` + a `services/tabletoken.js` | 0.5 d |
| QR landing page + chat widget (vanilla JS, brand colour from `basic_info.brand`, Geolocation prompt, session cookie) served by flows at `/t/:token`; same script embeddable on munadim.com Koffee Kulture page | flows `public/widget/` | 1 d |
| Kitchen board shows `Table A7 · unverified-location` badge only when the geofence was skipped (never for a normal order) | dashboard KDS | 0.25 d |
| QR generator: `tools/make-qr.mjs` already exists → add `--table A1..A12 --branch arkan` output as a printable sheet | flows tools | 0.25 d |
| Munadim.com "Koffee Kulture" page with the live widget in the café's brand | site | 0.5 d |

Hand-off beyond our board (printer / POS such as Foodics) is a separate track once the café says
what they run.

## 4. Data seeded (tools/seed-koffee.mjs)

- `restaurants` row: 7 branches (Arkan Plaza Sheikh Zayed with Tripadvisor coordinates; District 5,
  Golf Central, Mivida Lake District, Ivory/Villette geocoded from the compound names; **U Venues
  and O1 Kitchen Mall coordinates still to confirm**), hours 7:30–00:00 daily, payments
  `service_charge: 12`, `tax: 0.14`, cash + card, services dine-in only, `ai.dine_in_widget`
  config, brand green `#3DAE2B`, logo in the brand bucket.
- Menu: **170 items in 17 categories** from the café's own printed menu (menuegypt, Oct 2025) merged
  with the egmenus listing (Sept 2026 prices, Arabic names). Sizes M/L on all cold drinks, extras
  (shot, flavour, plant milk, lactose-free), milk choice on hot drinks, side + bagel + bread choices,
  omelette add-ons, cheesecake toppings. **79 items carry a 2025-print price** (marked in the
  description) — confirm those with the café before launch; the remaining 91 are Sept 2026 prices.
- Tables: A1–A12 (Arkan) and U1–U12 (U Venues) seeded with the menu stage.

Open: run `migrations/044_tenant_schema_koffee.sql` on the TENANT Supabase project
(sxthftiqvaojbdyjizjr, SQL editor, one go) → then `node tools/seed-koffee.mjs menu`.
Engine note: option groups are single-pick today; "extras" therefore takes one extra per drink
(multi-pick is a small resolver change if the café wants shot + oat milk on one latte).

Sources: menuegypt.com/koffee-kulture (print images, hotline 01034999123, branch list),
egmenus.com/restaurant/koffee-kulture (Sept 2026 prices), Tripadvisor + RestaurantGuru (Arkan
address, hours, coordinates, table service, outdoor seating). The brand site koffee-kulture.com
was unreachable (HTTP 402).
