# Ahlan Resto — The Guest Journey (Agent Workflow Plan)

The product = the full guest journey automated over WhatsApp/IG, with the dashboard as the
staff control room. LangChain-only (no n8n), the flow-engine architecture proven in the hotel's
`lanchainflows` (defineFlow / traced nodes / Langfuse cost per conversation / tri-mode / simulator).

Decisions locked (2026-07-09):
- **Instant auto-confirm** reservations (deposit gate is a per-restaurant config toggle, later)
- **Browser test chat first** (`/chat` drives the real pipeline), real WhatsApp number after
- **Language mirroring**: English / عربي / Franco-Arabizi — reply in whatever the guest uses
- Order agent deferred (journey Phase C)

## Shared pipeline (all phases)

```
message → INGEST (dedup, typing, voice→Whisper, image→vision, 8s merge of rapid messages)
        → GATES (restaurant chat_enabled; per-chat ai_enabled — staff-takeover from dashboard)
        → MASTER (session precheck → bucket classify → dispatch, friendly=default,
                  override: active reservation session + short affirmative stays in reservation)
        → agent → SEND (deliver, log to chat_sessions/chat_messages → dashboard Chats, retry queue)
```

Iron rules ported from the hotel: LLM extracts & phrases, **code computes** (dates, availability,
prices); strict anti-hallucination (only config/DB facts); circuit breakers (5 turns/stage,
20/session → human handoff with briefing); prompt-injection sanitization.

---

# The Journey

## 1) AT HOME — planning (BEFORE)

**HOST agent** (default bucket) — the restaurant's voice:
hours ("open now?" computed in code), menu Qs from `menu_items` (86'd items invisible,
dietary tags), FAQs, dress code, parking, occasion planning. Knows the diner from CRM
(VIP, allergies, visit count — used silently). Can't answer / anger / "get me a person"
→ `needs_attention` + 2-line staff briefing + AI goes quiet on that chat.

**RESERVATION agent** — strict state machine, state in `temp_reservation`:
```
COLLECT party/date/time (ask only what's missing)
→ QUOTE  code computes availability from restaurant_tables + reservations
         (turn times 2p=90/4p=105/6+=120 min) → offer slot or 2–3 alternatives → full? waitlist
→ CONFIRM guarded (must have been quoted, no double-book, party ≤ max_party_online)
         → INSERT reservations (status=confirmed, source=whatsapp) → R-CODE to guest
         → dashboard notification + card appears in Reservations
```
Modify/cancel same guarded path (cancel asks "sure?" once). Occasion captured → kitchen prep note.

**Cron: reminders** — T-24h and T-3h "still coming?" (reply updates status / frees the slot).
**Cron: abandoned recovery** — incomplete `temp_reservation` 1–24h old, one gentle nudge, quiet-hours guard.

## 2) ARRIVING

**ARRIVAL agent** — "I'm here" → find today's reservation → status=arrived → host dashboard ping
→ "Welcome! Table T4 🎉". "Running late/traffic" → hold within grace_minutes, notify host, else
offer next slot. **Cron: no-show reconciliation** — grace passed → no_show, release table,
promote waitlist, (deposit rule when enabled).

**WAITLIST live** — walk-in full house: host adds from dashboard (later: door QR) → guest gets
position updates → "table ready, 10 min to claim" → seat or expire.

## 3) INSIDE — at the table (Phase C)

**Table QR → WhatsApp thread with table number embedded:**
reorder drinks/food (ORDER agent → Orders/KDS page), call waiter, request bill, split & pay
(Paymob link). **Mid-meal complaint = gold**: instant manager alert while the guest is still
in the chair (service recovery before the bad review exists).
**Occasion moment**: birthday reservation → timed kitchen cue (cake/candles at 9:30).

## 4) AFTER — just left

**FEEDBACK agent** (cron ~2h after completed): one-tap rating ask, sentiment-gated:
- happy → thank + Google Maps review link
- unhappy → apology + manager callback promise + `feedback.escalated` + optional voucher
Visit written back to CRM: visit_count++, spend, items, table → fuels the next visit's context.

## 5) BETWEEN VISITS — at home (marketing engine, Phase C)

All broadcast flows respect Meta's 24h rule (outside the window → approved template messages)
and per-diner opt-in:
- **Event broadcasts** — DJ nights / menu drops / brunch launches → RSVP flow (`event_rsvps`)
- **Occasion re-engagement** — birthday/anniversary next year: "table for the big day?"
- **Win-back** — regulars gone quiet 6+ weeks: "we miss you" (+ optional perk)
- **Hype drops** — weekend tables released at a set hour; VIP tier gets early access
- **Loyalty** — visit-tier unlocks (secret menu, priority booking)

---

# Build phases

| Phase | Journey slice | Contents |
|---|---|---|
| **A (now)** | Before + Arriving core | ingest/gates/master + HOST + RESERVATION + ARRIVAL, browser `/chat`, everything writing to the live dashboard |
| **B** | Journey completion | reminder/no-show/abandoned/feedback crons, waitlist notifications, WhatsApp number go-live |
| **C** | Inside + Between visits | table-QR ordering + bill/pay, marketing engine + templates, events RSVP, hype drops, IG DM channel |

Testing: `/chat` page + simulator (burst test proves the 8s merge), DRY_RUN + whitelist,
Langfuse trace per turn (cost per conversation per restaurant), lift to real WhatsApp only
after Phase A feels right in the browser.
