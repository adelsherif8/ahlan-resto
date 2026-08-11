# Model benchmark — gpt-4.1 family vs gpt-5.4 family (2026-08-11)

Full 99-case regression suite, same code, same day, env-var swap only.

|                       | gpt-4.1 / mini / nano | gpt-5.4 / mini / nano |
|-----------------------|----------------------|----------------------|
| Pass rate             | **99/99**            | 91/99                |
| Wall time             | 18m30s               | **13m22s** (–28%)    |
| Suite LLM cost        | **$0.53**            | $0.86 (+63%)         |
| smart avg latency     | 2316ms               | 2076ms               |
| fast/mini avg latency | 2254ms               | **1040ms** (–54%)    |
| nano avg latency      | 811ms                | 732ms                |

## 5.4 failures (behavioral drift, not test wording)
branchask + fulfillcombo (skips the branch ask), bundle4x4 (order never placed — no code,
no 999 total), colazeroitem (drops the ✍️ substitution notice), pepsidiet (asks "would you
like…" — banned), optnotaddress, runningsub (subtotal missing), waitlist.

## FINAL DECISION (founder, 2026-08-11): STAY ON gpt-4.1 — migration cancelled
Founder's rule: don't pursue 5.4 if it costs more. It does — every tier is pricier
(smart +41%, mini +96%, nano +134%, suite +63%). The 2× mini speed doesn't buy its way
past that. Revisit only if OpenAI reprices or a cheaper tier appears (check the models
list + pricing first, benchmark second).

## Original analysis — STAY ON gpt-4.1 family
- 5.4 is a big latency win on the mini tier (guest-facing snappiness, 2.2s → 1.0s)…
- …but 63% MORE expensive (newer ≠ cheaper here) and 8 real behavior regressions:
  our prompts are tuned on 4.1; 5.4 follows them differently at exactly the
  code-computes/zero-hallucination seams the product is built on.
- Migration is a PROJECT (prompt re-tune per failure, then two clean full-suite passes),
  not an env flip. The integration code (reasoning_effort:"none",
  max_completion_tokens, 5.4 prices in llm.js) is already in place for when we do it.

## Ops notes
- gpt-5.x API: `reasoning_effort:"minimal"` is dead — use `"none"`; `max_tokens` →
  `max_completion_tokens`; temperature rejected. (First leg 400'd on every call; the
  suite's NO-REPLY wall caught it, env reverted in ~2 min, zero real guests in window.)
- Benchmark procedure that worked: baseline full suite → env swap → 1-case probe
  (fail-fast) → full suite → cost pull from flow_executions nodes by model → revert.

## CORRECTION (2026-08-12): 5.4-mini/nano prices in the table were ~2× list
Real list: 5.4-mini $0.375/$2.25, 5.4-nano $0.10/$0.625 (verified vs published pricing).
Recomputed suite legs: 5.4-mini ≈ $0.20 (PARITY with 4.1-mini, at 2× the speed);
5.4-nano ≈ $0.005 (parity). gpt-5.4 smart is genuinely +41%. Full-5.4 verdict unchanged
(smart cost + 8 behavior failures), but a HYBRID — smart=4.1, fast=5.4-mini — is speed
for free once the 8-failure prompt tune passes. Parked as the follow-up.
