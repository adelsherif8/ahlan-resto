# Model benchmark — forced GPT-6 migration (2026-11-01)

## Why now (not a cost study any more)

OpenAI's model objects carry `shutdown_date`. Checked 2026-11-01 with our key:

| model        | shutdown     | our role                      |
|--------------|--------------|-------------------------------|
| gpt-4.1-nano | **2026-10-23 (gone)** | NANO — router classify (every call 404'd for 9 days) |
| gpt-4.1-mini | 2027-01-14   | FAST — extract, classify, summarize |
| gpt-4.1      | 2027-01-14   | SMART — guest-facing replies  |
| gpt-4o-mini  | 2027-01-14   | photo classification (media.js) |
| gpt-6-luna / gpt-6-sol / gpt-6-astra / gpt-6.1-sol / gpt-6.1-terra / gpt-5.6-luna | none | candidates |

Immediate fix: MODEL_NANO → gpt-4.1-mini (code default changed; the Railway variable must be set
by the founder — the CLI change was denied to the agent as a production deploy). Guard added:
`services/modelcheck.js` (boot + 6-hourly lookup, ntfy alarm, `/health.models`).

Hard deadline: all three tiers off gpt-4.1 before **2027-01-14**.

## Candidates and list prices (USD / 1M tokens, cached-input rate)

| tier  | today            | candidate       | input | output | cached |
|-------|------------------|-----------------|-------|--------|--------|
| SMART | gpt-4.1 $2/$8    | gpt-6.1-terra   | $1.00 | $5.00  | $0.05  |
| FAST  | gpt-4.1-mini $0.4/$1.6 | gpt-6-luna | $0.10 | $0.50  | $0.025 |
| FAST  |                  | gpt-5.6-luna    | $0.20 | $1.20  | $0.02  |
| NANO  | gpt-4.1-mini (stopgap) | gpt-6-luna | $0.10 | $0.50  | $0.025 |

Terra and luna prices from third-party trackers + OpenAI's Oct 28 announcement coverage; verify
on the pricing page before the final switch. Call shape already handled in `services/llm.js`
(`reasoning_effort:"none"`, `max_completion_tokens`, no temperature for gpt-5.x/6.x).

## Procedure (same as August)

Local server on :5142, env swap only, ONE suite at a time. Baseline first, then each candidate.
Persona suites: personas-munadim (6), personas-ar (17), personas-fr (19), personas-en (22),
all with `--judge`. Extractor contract (`tools/extract-contract.mjs`, 41 cases) for the FAST tier.

## Results

_(filled in below as runs complete)_

### Router stopgap — NANO=gpt-4.1-mini (local, 2026-11-01)
convos-munadim5 PASS 5/5 · convos-greetings30 PASS 30/30 · personas-munadim 6/6 ($0.0085) ·
0 OpenAI errors. Judge flags = the usual code-built upsell/bill lines. Safe to set in production.

### FAST tier — extractor contract (41 recorded cases, recorded on gpt-4.1-mini)

| MODEL_FAST    | match | cost   |
|---------------|-------|--------|
| gpt-4.1-mini  | 37/41 | $0.023 | (today; the 4 misses are the known intent flips)
| gpt-6-luna    | 31/41 | $0.008 |
| gpt-5.6-luna  | 31/41 | $0.013 |
| gpt-6.1-terra | 31/41 | $0.051 |

All three GPT-5.6/6-era models differ on the SAME cases, so this is prompt fit, not model size:
c08 «كلاسيك ساندوتش» mapped straight to Classic Burger (the recording leaves it literal for the
which-one path), c20 "coke"/"sprite" kept literal instead of "Soft Drink", c21 "add a loaded
fries too" → nothing (real miss), c23 "cash, coming in 15 min" → order not confirm, c24 «حار» →
order, c27 «خليهم اتنين» → a set_qty EDIT (arguably more correct than the recorded items[qty 2]),
c28 option "فانتا" not transliterated, c32 "fein el order?" → status (more precise than
"question"), c41 "2 spicy + 1 mild" as two lines (arguably better). Several are differences,
not defects — the recording is mini's output, not ground truth. The decision test for FAST is
the persona suites with MODEL_FAST swapped (end-to-end), run next.

### SMART tier — MODEL_SMART=gpt-6.1-terra, persona suites (local :5142, NANO=mini stopgap, FAST=4.1-mini)

| suite            | 4.1 baseline (16 Oct)      | terra (1–2 Nov)              |
|------------------|----------------------------|------------------------------|
| personas-munadim | 6/6 · $0.0073–0.0093       | **6/6** · $0.0073            |
| personas-ar      | 17/17 · $0.0575–0.0782     | **17/17** · $0.0518          |
| personas-fr      | 19/19 · $0.0515–0.0766     | 16/19 · $0.0516 (see below)  |
| personas-en      | 22/22 · $0.0981–0.1320     | 21/22 · $0.0844              |

Suite cost −10…−30 % (SMART is only part of the spend; the rest is the 4.1-mini extractor).
0 OpenAI errors. Judge flags are the usual code-built lines (upsell, bill, "first time? try…").

The 4 fails (fr06, fr21, fr27, en19) all sit on turns the harness timed at 17–34 MINUTES
(⏲ 1050790ms, 2022379ms, 2017506ms, 2001313ms) during the 22:54–03:27 UTC window, with
"buffer db insert failed, memory-only: TypeError: fetch failed" in the server log: the laptop
lost its network, the slow-turn "one sec" filler fired, and fr27 lost its pending draft (so
"shil el frayz" landed on an empty order and read as a cancel). Not model behaviour. Re-run of
exactly those four on Terra (03:29–03:49 UTC, turns back at 8–12 s): **4/4 pass** → Terra as SMART is
**64/64** on the persona suites, with no prompt change.

### FAST tier — MODEL_FAST=gpt-6-luna, persona suites (local :5142, SMART=4.1, NANO=mini)

| suite            | 4.1-mini (Terra run, same night) | luna                      |
|------------------|----------------------------------|---------------------------|
| personas-munadim | 6/6 · $0.0073                    | **6/6** · $0.0041         |
| personas-ar      | 17/17 · $0.0518                  | 13/17 · $0.0466 → re-run 4/4 |
| personas-fr      | 16/19 · $0.0516                  | **19/19** · $0.0217       |
| personas-en      | 21/22 · $0.0844                  | 20/22 · $0.0632 → re-run 1/2 |

Suite cost −10…−58 %. 0 OpenAI errors. The three ar "filler" fails were 17–93-minute network
stalls again (re-run clean). What was real:

- **en10 "honest no"**: luna writes "don’t deliver" with a typographic apostrophe; the gate (and
  six fixtures) expect "don't". Fixed in code, not in the fixtures: `services/llm.js` now maps
  ’ ‘ “ ” to ASCII on every model reply, so names and gates match whatever the model types.
- **en04 "sauce note"**: once in three runs luna wrote the kitchen note as "no pickles no onion
  sauce on side" (paraphrased, dropped "the"); 4.1-mini copies the guest's words. Passed on
  re-run. A real but small trait: luna rewrites free-text notes. Watch it in the hand gate.
- **ar10 — not luna's fault, OUR bug, live today**: «كلاسيك برجر ساندوتش دليفري المعادي شارع ٩
  دجلة» billed **9×** Classic Burger (1,710 EGP). Both extractors return qty 1 with the street in
  the address field; the single-dish "guest's number wins" block in `order.js` (which gained
  Arabic-digit conversion on 16 Oct) then read "٩ دجلة" as a count. The Terra/mini run printed
  the same 9× — the persona only checked the refusal wording, so it passed. Fixed: a number that
  sits in the extractor's address field, or right after an address word (street/شارع, floor/الدور,
  apartment/شقة, building/عمارة, point/بوينت, block, villa, km, رقم, …), is never a quantity.
  ar10 now asserts "1× *كلاسيك برجر" and forbids "9× ".

### Verdict so far

- **SMART → gpt-6.1-terra: ready.** 64/64 with the current prompts, 10–30 % cheaper suites,
  cached input at 5 %. Needs the founder's 5-conversation hand gate, then the env flip.
- **FAST → gpt-6-luna: close, not an env flip.** 58/64 first pass, all but one re-run clean;
  the extractor contract differs on 10/41 recorded cases, several arguably better. Before the
  switch: re-record the contract on luna and review the diff case by case, then two clean
  persona passes, then the hand gate. Deadline is 14 Jan 2027, so this is the November project.
- **NANO: mini now, luna later** — same prompt family as FAST; swap with FAST once FAST is done.

### Side findings from the verification fixtures (2 Nov, FAST/SMART unchanged, NANO=mini)

- **Typed address lost after a Maps pin** (`convos-delivery-pin2`, EN case, old fixture from Aug):
  "villa 7 street 12 next to the pharmacy" → asked for a pin → link sent → the ticket showed only
  the link. The extractor files the link as `address` and it overwrote the typed text. Fixed in
  `order.js`: a link-shaped `address` never replaces a typed one (the link stays in `map_link`).
- **Fixture harness kept the previous run's pin**: `convo-test.mjs` reset `pending_order` but not
  `last_location` (persona-test already did), so a re-run minutes later opened with "we don't
  deliver to this address" before any address was typed. Aligned.
- Final state: ar10 1/1, en04+en10 2/2, convos-delivery6 / street6 / delivery-pin2 / place4 /
  qty4 / reel6 all PASS, unit+fuzz 59/59, 0 OpenAI errors.

## DECISION (founder, 2026-11-02): SMART → gpt-6.1-terra. LIVE.

Official prices (developers.openai.com/api/docs/pricing, 2 Nov): terra $1.00 / $5.00, cached
$0.05, cache write $1.25 · gpt-4.1 $2.00 / $8.00, cached $0.50 · gpt-6-luna $0.10 / $0.50,
cached $0.01 · gpt-4.1-mini $0.40 / $1.60, cached $0.10. Deprecations page: GPT-4.1 and 4.1-mini
removed 2027-01-14, recommended replacement gpt-6-luna.

Railway `flows` vars set 10:38 UTC (SMART=gpt-6.1-terra, NANO=gpt-4.1-mini, FAST unchanged),
deploy 0587cb87 SUCCESS 10:41, /health ok. convos-munadim5 against production: PASS. A cancel +
a "same as last time" probe: `order.phrase` on gpt-6.1-terra, classify on gpt-4.1-mini, 0 errors.
Note for cost reading: in Munadim's casual flow SMART only phrases `order_cancelled`,
`no_delivery`, `no_history`, `nothing_matched`, `bad_table`, `sold_out_today`, friendly
escalations and arrival — most turns never touch it, so the saving is small in absolute terms.
`services/llm.js` now also bills terra's cache-write surcharge (1.25× on written tokens).

## Full battery on Terra (2 Nov, local :5142, 113-case regression + 34 fixture files)

Regression: 106/114 first pass → the 8 misses re-run in isolation on both models:
4 were artifacts of the 2-hour run (bundle4x4, bundle4x4bill, combodrink, photo pass alone on
Terra); 3 failed on gpt-4.1 too (pre-existing); 1 was Terra-specific (`desserts`). All fixed:

| case | cause | fix |
|---|---|---|
| desserts (Terra) | model deflects: "let me pull up the menu" / "the full menu will be in my next message" / "I don't have the dessert menu in front of me" | **code answers**: `fastpaths.missingCategoryReply` — a category word (desserts, soup, sushi, koshary, shisha, coffee, …) that no dish NAME or CATEGORY carries gets "We don't have X — here it's A, B, C" in the guest's language; plus a STALL guard in the host's first-reply contract and a standing rule |
| bdaysoon (both) | canned "welcome back" fast path ignored a birthday 3 days away | master skips the canned welcome when the birthday is ≤14 days out → the host says 🎂 |
| refundask (both) | "the order was wrong, I want a refund" → cancel/status stage → "No active order found" | refund words hand off to FRIENDLY (apologise once, team follows up, never "process") |
| itemcorrection (both) | the 16 Oct change notice "*Iconic Meal* → *American Truck Meal* ✅" trips `forbid /iconic/` | the forbid ignores the notice line |
| photo (Terra, flaky) | "the iconic" = 3 dishes; Terra asks which one, 4.1 guesses the first | the case accepts an honest which-one question (`media_unless`) |

Also found by the battery (code, not model): a boot-time sweep deleted a running regression's
seeded guests (now waits 60 s and stands down while a run is live); the fixture harness kept
the previous run's pin; hallucination fixture H10/H11/H14/H21 guards tripped on honest echoes
("I can't promise … in 10 minutes", "I don't know what level 5 means", "3ard 3ala" matched
`3ard \d+`) and a stale branch name — tightened to real promises; price talk ("price 0 EGP",
«ببلاش») is dropped from kitchen notes; and «كولا» inside «شوكولاته» turned Arabic *chocolate*
into a Coca-Cola (`arOptionWords` substring replace → whole-word; unit-tested).

Fixture files run on the wrong tenant (my mistake, Munadim-menu files on Luci'z): abuse20,
split4, split-edge3, fix3, qty4, tenders3, context5, abuse6 — re-run on Munadim: 6 PASS;
`qty4` and `context5` are stale (written for the pre-rename menu: "Chicken Tenders 3 Pcs
Nashville", bare "chocolate" ambiguity) and expose three pre-existing gaps, parked:
1. after a which-one for an unknown dish, answering with a DIFFERENT dish drops the count
   ("3 tenders" → "nashville" → 1× Nashville Chicken);
2. "lets add chocolate" / "zawed chocolate" while an option question is open is swallowed
   (bare "add chocolate" works) — and "3andoko milkshake?" mid-order re-asks the options
   instead of answering;
3. "hot for the first 2 and mild for the third" is not parsed against the new Spice Level
   option group ("you can mix across your 3" wants "2 hot, 1 mild").

Late finds from the last fixture files (code, not model):
- `streetCore` (delivery.js) stripped Arabic prepositions BEFORE the villa/building words, so
  «فيلا ١٢» → «يلا ١٢» and the geocoder query "ibrahim el mahdy yla 12" found nothing → a pin
  was asked for a street Photon knows (score 1 for "ibrahim el mahdy"). Reordered; unit-tested.
- `convos-order6` expected the first-turn invite wording on the reply to "pickup"; the reply
  now invites with "What would you like?" — expectation widened, behaviour unchanged.
- `ضيف` (Egyptian "add") was missing from the order flow's EDIT_VERB list — added.

Fixture harness/stale-fixture notes: `qty4`, `context5` need rewriting for the renamed Munadim
menu before their three parked gaps can be worked.

## Round 2 — 2 Nov afternoon: hand gate on production, luna as FAST

Deployed 15:53 UTC (flows 005b2daf): Terra as SMART + everything above. The founder's
5-conversation hand gate was then run by the harness AGAINST PRODUCTION (`convos-gate5.json`,
Munadim, web channel — the Meta transport leg is unchanged by the deploy). What it found:

1. **A dish added while a choice question is open was dropped with no notice** — both
   "add an om ali then" and «ضيف أم علي» (parked gap #2 above, now understood). Three
   separate guards each killed it: the short-reply block (`≤ 28 chars`) reset `items` to the
   draft whenever `awaiting_option` was set, before the option-aware merge could run; the
   edits path's `guestNamed()` needed one non-brand token of ≥ 4 letters ("om", "ali" have
   none); and the matcher's `namedInArabic` counted the brand word «مُنادم» as a required
   token, so «أم علي» alone read as an "answer fragment". All three fixed; the Franco/Egyptian
   add-verbs («ضيف», "zawed", "deef") and the Arabic menu name now count as naming the dish.
   Reproduced and verified locally in EN and AR (scratch `repro-addopt.json`).
2. **"confirm" while a required choice is still open** re-printed the same question with no
   explanation (3 of 5 conversations). Now a one-line lead-in: "Almost there — just this choice
   and I'll place it 👇" (AR/Franco variants).
3. **An English address line flipped the bot into Franco** — "3rd floor" is a digit glued to
   letters, which `francoScore` counts as a Franco marker. English ordinals/units (`3rd`, `2nd`,
   `5km`, `3pm`) are excluded; unit-tested.
4. **A refund ask mid-draft was treated as a cancel** ("Order cancelled ✅" to "the last order
   was cold") because the refund hand-off was gated on no open option question. Gate removed:
   refund words always go to the complaint path.
5. Not bugs, fixture design: option questions block the flow by design (a real guest answers
   them); «كولا» appears legitimately in the printed drink choices; the cancel wording is
   «تم مسح الطلب». The gate fixture was rewritten so guests answer the choices, and it now
   asserts the real behaviours (dish added mid-ask, confirm lead-in, no Franco flip, address
   kept, refund → apology, status finds the placed order).

### gpt-6-luna as FAST (the 2027-01-14 deadline)
- Extractor contract vs the recorded (4.1-mini) expectations: 31/41 match. Of the 10
  differences, 6 are harmless or better (luna uses `edits` instead of echoing `items` for
  "add"/"make it 2" — the code applies both paths; keeps "coke"/"sprite" literally so the
  flavour note survives; reads "fein el order?" as `status`, which is right; maps «كلاسيك
  ساندوتش» straight to the Classic Burger; "Fanta" vs "fanta" — the compare is now
  case-insensitive). Two to watch in conversation: "cash, coming in 15 min" (luna: order_type
  null, intent order — code still has payment and the pickup default) and «نفس طلب امبارح
  وزوّدلي حاجة ساقعة» (luna adds the literal «حاجة ساقعة» as an item → a which-drink question
  rather than silently dropping it, arguably better).
- Persona suites on a local luna server (`MODEL_FAST=gpt-6-luna`): Munadim 6/6 at $0.0038 total
  (vs ~$0.008 on 4.1-mini); EN 22/22 ($0.042), AR 17/17 ($0.041), FR 19/19 ($0.020) — 64/64,
  first clean pass, ~45% of the 4.1-mini cost per conversation. Fixture battery + regression on
  luna, then a second clean pass and the hand gate, before the FAST flip (Aug rule).
- Luna fixture battery (3 Nov morning, local 5142): everything green that is green on 4.1-mini
  except `tenders3` FR — "3ayez el chicken tenders nashville": luna extracts the generic
  "chicken tenders" (→ which-one 3 Pcs / 5 Pcs) where 4.1-mini picks Nashville Chicken; the
  follow-up "pickup" then dropped the which-one and sent the menu (that second step is
  pre-existing code behaviour, not luna). Prompt tune for luna: "nashville" names a dish — keep
  the distinguishing word. `js` (positional per-unit split) and `qty4`/`context5` fail on both
  models (parked gaps / stale fixtures). Stall-induced fails (laptop slept mid-run, turns of
  hours) were re-run in isolation and pass.
- 4.1-mini side (local 5143, same code): regression 114/114; Munadim fixtures all green after
  isolated re-runs; gate5 needed the pickup-time + final-confirm turns a real guest gives.
- Luna regression (3 Nov, local 5142, Just Smash fixture tenant): **106/114** — the first battery
  is NOT clean. Fails: `itemnotes` (NO REPLY 50 s — stall, re-run), `perunitpos` (positional
  per-unit drinks "coke for the first 2, sprite for the third" → luna merges them; 4.1-mini splits),
  `bundle4x4` (compound option answer → "didn't catch that"), `acceptrec` (accepting the
  recommended Loaded Fries not added), `repeatorder` ("same as last time" lost the Iconic),
  `compound3` (parking half of a two-part question dropped), `branchflow`/`editadd` (order never
  reached a code — flow stalled on the type/branch ask). `photos4` 5/5 fails on luna too. All are
  extractor-shape differences (luna returns `edits` without `items`, drops the second half of
  compound messages) → the luna prompt needs its own tuning pass (extractPrompt + options resolver)
  before a second battery. 4.1-mini on the same code: 114/114.
