# Suite checklist — what to verify in the NEXT full regression run

Process (founder decision, 2026-08-10): don't run the full suite after every change
(~$0.36 each). Accumulate changes here, verify each with a cheap targeted `only` run,
and run **one full suite at the very end** to lock everything in. This file is the memory
of what that final run must confirm.

How to run the full suite: `POST /api/ops/run-regression` (x-ops-token), poll
`GET /api/ops/regression`. Targeted: `POST … {only:["caseId",…]}`.

---

## ⏳ Pending full-suite verification (changed since last full green)

Last full green baseline: **79/0** (routing-fix deploy, before the question-intent change).

- [ ] **Order "question" intent** (order.js extract + act) — a real question during an
      order (delivery/hours/ingredients) is handed to friendly, never absorbed. Bare
      answers (size/drink/cash/branch/yes) must NOT be flagged as questions and must still
      complete the order. *Targeted-verified 7/0; needs full-suite confirmation it didn't
      shift any order case.*
- [ ] **Delivery coverage feature** (when built) — see below.

## ✅ Already added regression cases (keep them green)
- `midorderq` — question mid-order answered, not menu-dumped.
- `midorderresume` — order completes after a mid-order question (state kept).
- `midconfigq` — question while configuring an item isn't force-progressed to payment.

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
