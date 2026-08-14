# Answer-integrity audit — 14 August 2026

Triggered by three live failures in one evening, all the same shape:
**the guest answered a question we asked, and code decided the answer wasn't real.**

The rule this audit enforces:

> If we asked a question and the guest replied, we either understand the reply
> or we say we didn't. We never silently ignore it, and we never quietly
> substitute something else.

Suite after the fixes: **112 passed / 0 failed** (110 existing + 2 new cases).

---

## The root cause behind most of it

`order.js` bails out early when an "other"-intent message carries no order content:

```js
const notAwaiting = !pending.awaiting_option && pending.awaiting_confirm !== true;
if (notAwaiting && noOrderContent) return { kind: "handoff_to_friendly" };
```

Only **two** asks ever set a waiting flag: the option walk and the confirm step.
The **which-one** ask and the **payment** ask set nothing. So a bare `Online` or
`nashville` scored as zero order content and was handed to the chit-chat brain
**before reaching the matchers built to understand it**. This is why fixing those
matchers appeared to change nothing — they were never called.

Fixed: a pending which-one, or a payment word while a draft is open, now counts as
answering an open question.

---

## Every finding

| # | What happened | Guest impact | Status |
|---|---|---|---|
| 1 | Early guard handed which-one and payment answers to chit-chat | Order silently stalled; bot wished the guest a good meal for an order that was never placed | **Fixed** |
| 2 | Payment matched internal keys (`cash`/`card`/`instapay`), not the labels we printed — plus a 14-char cap that also rejected the *tapped* button ("cash at the cashier" is 19) | Every multi-word payment option was unmatched | **Fixed** — matches printed labels, typed or tapped, no cap |
| 3 | `payKeyOf` used substring matching: "card at the cashier" contains "cash" inside "cashier" | Card orders booked as cash | **Fixed** — keys off the label's first word |
| 4 | A which-one pick only applied *if the extractor returned nothing* | Guest picked tenders, model guessed "Nashville Slaw", guess won — walked through options for a dish he never asked for, 570 EGP | **Fixed** — the guest's pick beats the model's guess |
| 5 | Which-one answers matched by exact containment only | A typo ("nashvile") re-searched the whole menu and produced a **wider** question than the one just answered | **Fixed** — edit-distance on distinguishing tokens; refuses to guess when two candidates are equally close; accepts "1"/"2" |
| 6 | Short-message guard overwrote items with the draft unless the message had an add-word or leading digit | A dish the guest named outright was discarded | **Fixed** — anything spoken, any which-one answer, and every dish in a multi-dish message is kept |
| 7 | Edits that matched nothing were skipped in silence | "remove the fries" appeared to work; the fries stayed on the bill | **Fixed** — names what it couldn't find and lists what's actually on the order |
| 8 | No re-ask tracking on which-one (only option asks had it) | Same question repeated forever with no acknowledgement | **Fixed** — says it didn't catch it, re-asks the **same** list, hands to a human on the 4th miss |

**Judged correct, left alone:** unknown dishes, sold-out items, the chicken guard,
and bad table numbers all already speak up honestly.

---

## Known and still open

**Per-unit option splitting from natural language.** The guest said *"hot for the
first 2 and the third one medium spicy"* — and we had even printed "you can mix
across your 3" — but a single spice level was applied to all three. The per-unit
split exists (it handles "one coke and one sprite"), it just doesn't parse
"the first two / the third one". Should produce 2× Hot + 1× Medium as separate lines.

---

## Process lessons from tonight

1. **Verify the deployment id, not "the latest deployment is SUCCESS".** A stale
   build reported ready and I told the founder to test against code that didn't
   contain the fix.
2. **The suite runs against the Just Smash tenant.** Two cases I wrote used Luci'z
   dishes that don't exist there, so they could never pass regardless of the fix.
   New cases must use the suite tenant's real menu.
3. **Test the branch, not just the helper.** The which-one matcher passed in
   isolation while the branch that calls it was never reached.
4. **Read the failing transcript before patching.** Every wrong turn tonight was
   diagnosable from `flow_executions` in under a minute.
