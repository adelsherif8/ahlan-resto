# Stack & AI Updates — 14 August 2026

What changed in the world since we last looked, and what (if anything) we should do about it.
**Nothing in this document has been applied.** It is research + recommendations, awaiting a go-ahead.

---

## 1. Headline: there is now a model 10× cheaper than the one we run

Verified against OpenAI's own pricing page today (not a blog summary). USD per 1M tokens:

| Model | Input | Cached input | Output | Notes |
|---|---|---|---|---|
| **gpt-5.6-luna** | **$0.20** | **$0.02** | **$1.20** | new tier, cheapest capable model |
| gpt-5.6-terra | $2.00 | $0.20 | $12.00 | |
| gpt-5.6-sol | $5.00 | $0.50 | $30.00 | flagship |
| gpt-5.4 | $2.50 | $0.25 | $15.00 | the one we benchmarked on 11 Aug |
| gpt-5.4-mini | $0.75 | $0.075 | $4.50 | |
| gpt-5.4-nano | $0.20 | $0.02 | $1.25 | |
| **gpt-4.1** *(our SMART)* | $2.00 | $0.50 | $8.00 | every guest-facing reply |
| **gpt-4.1-mini** *(our FAST)* | $0.40 | $0.10 | $1.60 | extraction, classification |
| **gpt-4.1-nano** *(our NANO)* | $0.10 | $0.025 | $0.40 | router classify |

**gpt-5.6-luna is cheaper than gpt-4.1 on every axis: 10× on fresh input, 25× on cached input, 6.7× on output.** It is also cheaper than our *mini* tier on both input and output.

### Why this matters more than it looks — our workload is input-heavy

Real numbers from `flow_executions`, last 7 days (sampled: 1,000 executions per tenant, so a floor not a total):

| | Just Smash | Luci'z | Total |
|---|---|---|---|
| Executions | 1,000 | 1,000 | 2,000 |
| Cost | $1.76 | $1.05 | **$2.81** |
| Input tokens | 2,346,327 | 1,615,807 | 3,962,134 |
| Output tokens | 88,653 | 55,909 | 144,562 |

**Input:output ratio is 27:1.** We pay almost entirely for input — long system prompts carrying persona, facts, and the menu — which is exactly where Luna is 10–25× cheaper. A switch on the SMART tier alone should cut LLM spend by roughly 80–90%.

### Why this doesn't contradict the 11 August benchmark
That benchmark tested **gpt-5.4**, found it **+63% more expensive** than gpt-4.1 with 8 behaviour regressions, and the hybrid was correctly killed. The price table above shows why: 5.4 costs $2.50/$15.00. **Luna is a different, newer, far cheaper tier** — the cost argument is now inverted. The behaviour question is still open and must be answered the same way: benchmark, then the full suite.

### Bug found while checking: our price table is wrong
`flows/src/services/llm.js` has stale numbers that **understate** cost in every trace and metric:

| Model | We record | Actual | Error |
|---|---|---|---|
| gpt-5.4-mini | $0.375 / $2.25 | $0.75 / $4.50 | **half the real price** |
| gpt-5.4-nano | $0.10 / $0.625 | $0.20 / $1.25 | **half the real price** |

Also missing entirely: the whole gpt-5.6 family. Harmless today (we run none of them), but it silently corrupts any future benchmark — which is exactly what we're about to do. **Fix before benchmarking.**

### How new is it, and is it actually any good?

**Released 9 July 2026** — GA across ChatGPT, Codex and the API. About five weeks old. The family is three "capability tiers": **Sol** (flagship), **Terra** (mid), **Luna** (fastest and cheapest).

**Luna is the cheap tier of its family, not a flagship at a discount.** That framing matters — this is not "the same quality for 10× less". What the measured data says:

| Signal | Reading |
|---|---|
| Artificial Analysis intelligence index | Luna (medium) **38** vs gpt-5.4-mini (xhigh) **40** — roughly mini-class |
| Price for that | Luna is ~4× cheaper than gpt-5.4-mini |
| Generation | Luna clears **GPT-5.5** on Agents' Last Exam, HealthBench Professional, DeepSWE — i.e. newer-generation than our 2025-era gpt-4.1 |
| Context | 1.05M tokens |
| Speed | ~166 tok/s, comparable to gpt-5.4-mini |
| Cluster behaviour | Terra and Luna reportedly sit close behind Sol on most evals except computer-use/browsing |

**Why the price looks strange:** Luna launched at $1.00/$6.00, then on **30 July OpenAI cut it by ~80%**, landing at today's $0.20/$1.20. Most blog posts still quote the launch price. The pricing page is the truth.

### Revised recommendation — try the FAST tier first, not SMART

The founder's instinct is the lower-risk read and it matches the evidence: Luna is mini-class in measured intelligence, so it belongs where our *mini* runs, not automatically where gpt-4.1 runs.

1. **Fix the stale price table** (zero risk, must precede any benchmark or the numbers lie).
2. **Try Luna as MODEL_FAST first** — extraction, classification, summarisation. This is the safest place to test a new model because the work is mechanical, every returned value is re-validated in code, and a bad answer is caught rather than spoken to a guest. It's also cheaper than gpt-4.1-mini on both axes, so the saving is real even if we never touch SMART.
3. **Only then consider SMART.** Guest-facing replies are where hallucination and tone failures actually cost us, and where both previous experiments died — nano flaked, mini invented a dessert menu, gpt-5.4 failed 8 behaviours.
4. **Keep gpt-4.1-nano on the router** unless Luna clearly wins there too; nano's job is tiny and structural.

**Benchmark gates, unchanged:** the same 8 behaviours the 5.4 benchmark used, then the full 110-case suite **twice**, before anything reaches Luci'z.

**Two risks the benchmarks won't tell us:** 5.x are reasoning models — we run them with `reasoning_effort: "none"` because a WhatsApp guest waits about two seconds, and the published scores are at *medium* effort, so our effective quality will be lower than the table. And no public benchmark measures Egyptian Arabic or Franco, which is exactly where our product lives.

---

## 2. WhatsApp / Meta

**The October 1 change is confirmed.** Service messages and utility templates sent inside the 24-hour window become billable again, after being free since November 2024. This is the change our whole message-economy design already anticipates (compact mode, doc caption-merge, silent status updates, payment folded into fulfilment — 6 messages per order).

**The rate card still isn't published.** Meta committed to publishing October rates — including service messages — **no later than 1 September 2026**, and as of early August it had not. Rates are per-market and per-category, so Egypt's number can only come from Meta's own pricing page.
➜ **Diary 1 September:** pull the Egypt rate card, recompute the economics table (1/10/500/1000 restaurants), and check whether utility-template arbitrage is worth it.

**Graph API version.** We call **v24.0**; **v25.0** shipped in February 2026. Nothing we use is deprecated and Meta supports versions roughly two years, so this isn't urgent — but a bump should be scheduled rather than forgotten, since webhook payload shapes are version-pinned.

**Calling API (the parked voice phase).** Inbound — a customer choosing to call the business — is broadly available wherever Cloud API is. Outbound business-initiated calling is still restricted in several markets. If we do voice, inbound-first is the available path.

**Competitive note:** Meta's own AI agent product charges about $2 per 1M tokens, roughly 4–5 cents per message. Our per-message AI cost is far below that, which is worth knowing when a prospect asks why they shouldn't just use Meta's built-in assistant.

---

## 3. Our dependencies

Nothing is broken and nothing is urgent. Patch drift only.

**flows** — `@langchain/core` 1.2.3→1.2.7, `@langchain/langgraph` 1.4.8→1.4.9. Worth noting: **neither is actually used at runtime** — the flow engine is our own 205-line `engine/flow.js`. Removing both would shrink installs and deploy time. `express` 4→5 is a major; skip.

**backend** — `@supabase/supabase-js` 2.110.1→2.112.3. Safe patch, worth taking (it's the version flows already runs).

**dashboard** — minor bumps available for react 19.2.7→19.2.8, tailwind, axios, react-router, types. Majors sitting there that we should **not** take before launch: vite 7→8, typescript 5→7, jspdf 2→4 (the menu-design PDF renderer — a breaking change would silently damage published menus), lucide-react 0.x→1.x, @vitejs/plugin-react 5→6.

**Recommendation:** take the patch-level updates in one batch after the current build queue lands; leave every major until after launch.

---

## 4. What was changed by this review

**Nothing.** No dependency upgraded, no model switched, no config touched. The only concrete follow-ups are the price-table fix and the 1 September diary date.
