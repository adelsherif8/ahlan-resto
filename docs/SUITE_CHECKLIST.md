# Suite checklist — what to verify in the NEXT full regression run

Process (founder decision, 2026-08-10): don't run the full suite after every change
(~$0.36 each). Accumulate changes here, verify each with a cheap targeted `only` run,
and run **one full suite at the very end** to lock everything in. This file is the memory
of what that final run must confirm.

How to run the full suite: `POST /api/ops/run-regression` (x-ops-token), poll
`GET /api/ops/regression`. Targeted: `POST … {only:["caseId",…]}`.

---

## ⏳ Pending full-suite verification (changed since last full green)

Last full green baseline: **84/0** — FINAL milestone run 2026-08-10 (everything below verified:
question-intent, delivery coverage+gates, all 5 new intents, Sprint-3 security deploy).

- [ ] **Habiba fixes (2026-08-10 evening)** — targeted-verified 10/0; confirm in next full run:
      address-capture yields to awaiting_option (`optnotaddress`) · per-item option asks —
      3 leaks closed: loose inference / strict matcher / resolver answering an unseen ask
      (`peritemopts`) · variant tie = re-ask, never picked[0] · unknown items surfaced
      ("Couldn't find X 🙏") · "Noted — pickup + cash ✅" ack · where-deliver + where-am-I
      FAQ guards (`wheredeliver`).
- [ ] The 84/0 baseline predates these — one full suite at the next milestone re-locks everything.

## ✅ Already added regression cases (keep them green)
- `midorderq` — question mid-order answered, not menu-dumped.
- `midorderresume` — order completes after a mid-order question (state kept).
- `midconfigq` — question while configuring an item isn't force-progressed to payment.

## 🚚 Delivery coverage (BUILT + live for Luci'z — verify in final run)
- [x] Inquiry covered → quotes exact zone fee/ETA (Tagamoa 30 ✓, live).
- [x] Inquiry uncovered → honest "not covered + pickup", no invented fee (Maadi ✓, live).
- [x] Order to uncovered area → `no_delivery_area` block (Maadi order ✓).
- [x] Order to covered area → proceeds w/ zone fee on bill (Tagamoa ✓).
- [x] Tenant WITHOUT zones (Just Smash) unaffected — deliverybranch still completes ✓.
- [ ] Full-suite confirm the delivery gate didn't shift any other order case.
- Luci'z zones FINAL per founder (do NOT ask again): Tagamoa/New Cairo 30 · Rehab 35 · Nasr City 45.

## 🆕 New intents (BUILT + targeted-verified — confirm in final run)
- [x] `lostfound` — reassure + branch team/phone, never claims found ✓
- [x] `refundask` — refund treated as complaint + follow-up, never processed on WA ✓
- [x] `careers` — jobs/CV/franchise politely declined (guest line only) ✓
- [x] `loyaltyask` — balance answered from pos.loyalty config, never invented ✓
- [x] reorder-specific — "same as last Tuesday"/"the truffle one" picks that order (repeatorder/usual/usualchip still green) ✓
- [ ] Full-suite confirm none of these shifted other friendly/order cases.
- NOT BUILT: promo CODES (typed discount codes on the chat bill) — real pricing feature, founder to green-light separately.

## 🆕 Regression cases to ADD before the final run
- [ ] **Delivery in-zone**: "do you deliver to New Cairo and how much" → quotes the real
      zone fee (not a guess), for the covering branch.
- [ ] **Delivery out-of-zone**: "do you deliver to Maadi" → honest "not covered, pickup
      available", never invents a fee.
- [ ] **Delivery fee on the bill matches the quote**: order to an in-zone address → the
      bill's delivery fee == the zone fee the bot quoted.
- [ ] **Multi-branch coverage**: an area covered by branch B (not the sticky branch) →
      picks the branch that actually covers it.
- [ ] **Min-order enforcement** (if configured): below min → says so, doesn't place.

## 🛵 COD + delivery analytics (BUILT — manual checks)
- [ ] Driver page (cash order): enter cash received → change auto-computed → Record works.
- [ ] Dashboard → Delivery → analytics strip: COD expected/received/change, per-destination times, per-rider stats.
- [x] Migrations 027 + 028 ran (founder confirmed).
- [ ] Guest "change for 500" lands in order notes and shows on the rider's page.

## 🔐 Sprint 3 security (BUILT + verified live 2026-08-10)
- [x] WA webhook signature FAIL-CLOSED (unset secret → drop, not accept) — real WA traffic still flowing ✓
- [x] opsAuth fail-closed in prod + timingSafeEqual (wrong token → 401 ✓)
- [x] /api/web/send + /typing locked behind ops token (no token → 401 ✓, ops console unaffected ✓)
- [x] Rate limits live: webhook 600/m/IP · build submit 20/m + share 10/m per token (429 proven ✓) · driver action 30/m + loc 240/m per token · web/send 60/m
- [x] CORS scoped to vercel domain + localhost on flows AND backend
- [x] Prod boot guards: builder token secret + backend JWT_SECRET must be set
- [ ] DEFERRED: courier-token signing/expiry (would break printed links; revisit), prompt-injection deep pass (D8), RLS policies (D9)
- [ ] FOUNDER: rotate the WA token pasted in chat (Meta → System User → regenerate → Railway WA_TOKEN)

## 👀 Manual / live checks the suite can't fully cover (do on real WhatsApp)
- [ ] Menu PDF sends **text-first** then the document (no long silence).
- [ ] No **forced buttons** on a plain delivery question.
- [ ] EU-West latency holds (simple ~2s, order turn ~5s server-side).
- [ ] Per-session lock: two fast messages don't produce duplicate replies / lost state.

---

## Notes
- `usualchip` is a known-flaky greeting-wording assertion (passes on re-run) — not a real
  failure if it's the only miss.
- The suite over-represents first-timers (every case is a fresh session), so its blended
  cost/escalation is higher than real traffic.
