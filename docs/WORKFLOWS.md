# Ahlan Resto — Workflow Catalog

Every workflow in the system, fully specified. This is the build contract for the flows service.
Companion doc: [AGENT_WORKFLOWS.md](AGENT_WORKFLOWS.md) (the guest-journey overview).

**Architecture recap:** each workflow = a `defineFlow` in the LangChain flows service (Express, Node ESM),
every node traced to Langfuse (cost per conversation per restaurant), tri-mode (memory / test / real),
testable from the `/chat` browser page and `test/simulate.js` before any real WhatsApp number.

**Iron rules (apply to ALL workflows):**
- LLM extracts & phrases. **Code computes** — dates, availability, prices, hours. The LLM never invents facts.
- Anti-hallucination: agents only offer what exists in the restaurant config / tenant DB.
- Language mirroring: reply in the guest's language (English / عربي / Franco-Arabizi).
- Circuit breakers: 5 turns stuck in one stage or 20 turns in a session → human handoff with briefing.
- Every user-visible send goes through MESSAGES (#3). Every message logged to `chat_sessions`/`chat_messages` → dashboard Chats page.
- Prompt-injection sanitization on all guest text before it reaches a prompt.

**Legend:** 🟢 v1 (build now) · 🟡 v1.5 (crons + go-live) · 🔵 Phase C (inside + marketing)

| # | Workflow | Type | Phase |
|---|---|---|---|
| 1 | BUFFERING (ingest) | plumbing | 🟢 |
| 2 | MASTER (router) | plumbing | 🟢 |
| 3 | MESSAGES (sender) | plumbing | 🟢 |
| 4 | RETRY WORKER | cron | 🟡 |
| 5 | STAFF-REPLY | plumbing | 🟡 |
| 6 | FRIENDLY (host) | agent | 🟢 |
| 7 | RESERVATION | agent | 🟢 |
| 8 | CONFIRM RESERVATION | agent | 🟢 |
| 9 | CANCEL / MODIFY RESERVATION | agent | 🟢 |
| 10 | ARRIVAL | agent | 🟢 |
| 11 | WAITLIST | agent | 🟡 |
| 12 | ORDER | agent | 🔵 |
| 13 | EVENTS | agent | 🟡 |
| 14 | FEEDBACK | agent | 🟡 |
| 15 | RESERVATION REMINDERS | cron | 🟡 |
| 16 | ABANDONED RECOVERY | cron | 🟡 |
| 17 | NO-SHOW RECONCILIATION | cron | 🟡 |
| 18 | FEEDBACK TRIGGER | cron | 🟡 |
| 19 | EVENT MARKETING | cron | 🔵 |
| 20 | OCCASION RE-ENGAGEMENT | cron | 🔵 |
| 21 | WIN-BACK | cron | 🔵 |
| 22 | HYPE DROP | cron | 🔵 |

---

## 1. BUFFERING (ingest) 🟢
*Hotel equivalent: `buffering/buffering.json` (51 nodes) — the front door.*

**Trigger:** `POST /api/wa/webhook` (Meta WhatsApp Cloud API), later IG DMs on the same endpoint;
`POST /api/web/send` (browser test channel) feeds the identical pipeline.

**Purpose:** turn raw webhook noise into exactly one clean, merged guest message per burst, with
media already converted to text — so every downstream workflow only ever sees text.

**Steps:**
1. **Verify** — Meta signature check (`WA_APP_SECRET`); `WA_SKIP_SIGNATURE=1` in dev. GET handshake for Meta verification.
2. **Ack fast** — respond 200 immediately, process async (Meta retries slow webhooks → duplicates).
3. **Resolve restaurant** — by `phone_number_id` in the webhook → control-plane `restaurants` row →
   tenant DB client (decrypt `integrations.supabase`). Cache 60s.
4. **Dedup** — `wa_message_id` already in `messages_buffer`? drop.
5. **Typing indicator + read receipt** — guest sees the restaurant "typing".
6. **Media normalize:**
   - voice note → download → **Whisper** → text (prefix `[voice] `)
   - photo → download → vision classify → `menu_question | complaint_photo | general` + description text
   - document/location/sticker/video → friendly fallback text ("[sticker]" etc.)
7. **Buffer** — write to `messages_buffer`; a flush worker waits **8s of silence per phone**, then
   claims-and-deletes atomically (no double processing) and joins the burst into one message
   ("hey" + "table for 4" + "tonight?" → one line).
8. **Log inbound** — upsert `chat_sessions`, insert `chat_messages` (sender=guest) → appears live in dashboard Chats.
9. **Gates** — restaurant `ai.chat_enabled` off → stop (optionally canned reply). Per-chat
   `ai_enabled` off (staff took over from dashboard) → stop silently. Test whitelist honored.
10. **Call MASTER** with ctx: `{ restaurant, diner_phone, message, media_context, history }`.
11. **Error fallback** — any downstream crash → log `routing_failures` + polite fallback message.

**Reads:** `restaurants` (control plane), `messages_buffer`, `chat_sessions`.
**Writes:** `messages_buffer`, `chat_sessions`, `chat_messages`, `routing_failures`.
**Config used:** `ai.chat_enabled`, `integrations.whatsapp`, `integrations.supabase`.
**Dashboard touchpoints:** every inbound visible in Chats instantly; failures visible later in ops UI.
**Edge cases:** duplicate webhooks (dedup), 20-message burst (one merged reply), voice in Arabic
(Whisper handles), unsupported media (fallback text), unknown phone_number_id (log + drop).

---

## 2. MASTER (router) 🟢
*Hotel equivalent: `master/master.json` (54 nodes) — the reusable brain.*

**Trigger:** called by BUFFERING with the clean merged message.

**Purpose:** decide which ONE agent handles this message. Never answers the guest itself.

**Steps:**
1. **Sanitize** — strip prompt-injection delimiters from guest text.
2. **Diner upsert** — `diners` by `phone_number`: create as `lead` w/ WhatsApp profile name, or load
   existing (VIP, allergies, visit_count → passed to agents).
3. **Session precheck** (code, no LLM) — read `temp_reservation`:
   - session TTL: stale > 4h → archive, start fresh
   - `active_flow` = reservation in progress? which stage?
   - affirmative detection ("yes/aywa/tmam/ok/yep") + self-correction ("wait/actually/la2 khalas")
   - loop detection (last 2 bot messages identical → force handoff)
   - circuit breakers: `turns_in_stage ≥ 5` or `turns_in_session ≥ 20` → handoff
4. **Override rules** (code, before any LLM):
   - active reservation session + short affirmative → `confirm_reservation` (no classifier call)
   - active reservation session + numbers/date/time content → `reservation`
5. **Bucket classifier** (LLM, JSON mode, cheap model) → `{ bucket, confidence, mood, language }`
   Buckets: `reservation | arrival | events | order | friendly`. `friendly` is the default;
   confidence < 0.35 → friendly.
6. **Sub-intent** (per bucket, code + small LLM where needed):
   - reservation → `reserve | confirm_reservation | cancel_reservation | modify_reservation`
   - arrival → `im_here | running_late`
   - friendly → `friendly_chat | handoff_request | feedback_reply`
7. **Dispatch** — `intentHandlers[intent](ctx)`. Unknown/unbuilt intent → FRIENDLY (never dead-ends).

**Reads:** `diners`, `temp_reservation`, `message_full` (history).
**Writes:** `diners` (upsert), `temp_reservation` (turn counters).
**LLM:** 1 cheap classification call (skipped entirely when override rules fire).
**Edge cases:** "yes wait make it 6 people" → self-correction → reservation (not confirm);
mixed intent ("are you open? also book me a table") → reservation wins (actionable > informational);
food complaint → friendly (service recovery), never order.

---

## 3. MESSAGES (sender) 🟢
*Hotel equivalent: `messages/messages.json` "Message Soap" — every agent's exit door.*

**Trigger:** called by every agent/cron with `{ to, type, text|buttons|list|image, session_meta }`.

**Purpose:** the single place that talks to WhatsApp — payload building, delivery, logging, retries.

**Steps:**
1. **Validate** — length cap 3500 chars, strip forbidden formatting per channel.
2. **Build payload** — text / interactive buttons (up to 3 — "Confirm ✅ / Change 🔄 / Cancel ❌") /
   list message (menu categories) / image (menu photos).
3. **Channel switch** — WhatsApp Graph API v24 / web-test outbox (`/chat` page) / IG (Phase C).
   `DRY_RUN=1` logs instead of sending.
4. **Log outbound** — insert `chat_messages` (sender=ai|staff), update `chat_sessions.last_message`,
   append to `message_full.conversation` (trimmed to last 20 turns).
5. **Failure classify** — permanent (invalid number → mark diner `blocked`) vs retryable
   (rate limit / 5xx → insert `pending_message_queue` with backoff).
6. **Handoff check** — if reply flagged `needs_attention` → insert `notifications` (dashboard bell).

**Writes:** `chat_messages`, `chat_sessions`, `message_full`, `pending_message_queue`, `notifications`.
**Edge cases:** guest blocked the number (permanent fail), message too long (split), emoji-only replies.

---

## 4. RETRY WORKER 🟡
*Hotel equivalent: `messages/retry_worker.json`.*

**Trigger:** cron every 5 min.
**Steps:** fetch due rows from `pending_message_queue` (`next_attempt_at <= now`, attempts < 5) →
resend via MESSAGES → success: delete row · fail: attempts+1, exponential backoff (5m→15m→1h→4h) →
5 fails: drop + `staff_alerts`.
**Edge cases:** never retry stale messages (> 24h old — a "table ready" ping from yesterday is harmful).

---

## 5. STAFF-REPLY 🟡
*Hotel equivalent: `staff-reply/staff-reply.json`.*

**Trigger:** dashboard Chats page → backend `POST /api/chat/sessions/:id/messages` → flows service.
**Purpose:** the human path — staff message goes out through the same MESSAGES pipe.
**Steps:** dedup (don't double-send on backend retry) → MESSAGES (sender=staff) → delivery status
back to `chat_messages.status`. Sending a staff reply auto-sets `ai_enabled=false` on that session
(staff took over); the dashboard toggle hands back.
**Edge cases:** 24h window expired → must use a template message or surface "can't deliver — window closed" to staff.

---

## 6. FRIENDLY (host agent) 🟢
*Hotel equivalent: `friendly/friendly.json` + its 50-signal context builder — the persona.*

**Trigger:** MASTER dispatch, `friendly_chat` (the default — highest volume).

**Purpose:** be the restaurant's voice: answer anything answerable from config + DB, warmly,
in the guest's language, and know when to hand off to a human.

**Steps:**
1. **Build context** (code — the big one):
   - restaurant config: name, address, parking, dress code, `hours` (+ **computed** `open_now`,
     `opens_at`, `closes_at` — code, never LLM), payments methods, FAQs
   - **menu snapshot**: available items only (86'd excluded), grouped by category, dietary tags,
     prices — from tenant `menu_items`
   - tonight/upcoming `events` (pre-computed dates)
   - diner CRM: name, VIP, visit_count tier (first-timer / returning / regular / VIP), allergies —
     **used silently** (never "I see you're allergic to nuts", just steer away from the item)
   - upcoming reservation for this phone (context: "your table Friday 8pm")
   - conversation history (last 20) + rolling summary
   - signals: language detected, mood (from MASTER), off-hours?, loop risk, name correction present?
2. **Off-hours gate** — closed + `ai.off_hours.enabled` → canned reply + `needs_attention` if urgent, no LLM.
3. **Reply LLM** — persona prompt from `ai.name` + `ai.personality`; hard rules:
   only facts from context; menu answers must cite real items/prices; never promise
   what staff must do without flagging them; reservation interest → hand to RESERVATION bucket
   next turn (write intent hint to session); 1–3 sentences, mirror language, emoji per persona.
4. **Side effects** (parallel, code):
   - name correction → update `diners.name`
   - handoff needed (anger / "get me a human" / unanswerable) → `chat_sessions.needs_attention=true`
     + LLM-generated 2-line briefing → `handoff_briefing` + `notifications` → AI silent on this chat
   - every 10 turns → refresh `message_full.conversation_summary`
   - complaint detected → `staff_alerts` (severity by mood)

**Reads:** config, `menu_items`, `events`, `diners`, `reservations`, `message_full`.
**Writes:** `diners`, `chat_sessions`, `notifications`, `staff_alerts`, `message_full`.
**LLM:** 1 main reply call (mid-tier model), occasional briefing/summary calls (cheap model).
**Example:**
> Guest: "3andoko 7aga vegan? w eh el dress code" →
> "أيوة عندنا 🌱 el mushroom shawarma (260) w el spicy edamame (180) — el nas bet7ebhom awi!
> Dress code smart casual — no sportswear after 7. تحب أحجزلك ترابيزة؟"
**Edge cases:** asks about an 86'd item (it's simply not in context → "not available tonight");
question outside restaurant scope → polite redirect; photo of a dish → vision description + match to menu.

---

## 7. RESERVATION 🟢
*Hotel equivalent: `BOOKING/BOOKING.JSON` (84 nodes) — rebuilt for tables & slots.*

**Trigger:** MASTER dispatch, `reserve` / `modify_reservation` mid-collection.

**Purpose:** collect the 3 required slots, quote REAL availability, drive to confirmation.
Never confirms by itself (that's #8 — separation prevents premature bookings).

**State machine** (persisted in `temp_reservation`, PK = phone_number):
```
stage: collecting → quoted → awaiting_confirm     (then #8 takes over → confirmed)
```

**Steps:**
1. **Extract** (LLM, JSON mode): `{ party_size, date_phrase, time_phrase, section_pref, occasion,
   special_requests, correction? }` — extracts only; no validation.
2. **Validate & enrich** (code):
   - date/time parsing in `Africa/Cairo` — "bokra" → tomorrow, "Friday" → next Friday, "8" → 20:00
     if evening context; reject past dates ("that was yesterday 😅")
   - open-hours check (`hours` config): requested time outside → offer nearest valid slot
   - `party_size > reservation_policy.max_party_online` → human handoff with briefing
     ("large party — needs a manager") + `notifications`
   - merge with existing session state (guest may add info across messages)
3. **Missing slots?** → ask ONLY for what's missing, one question at a time
   ("For how many people?" — never a form-like interrogation).
4. **Availability** (code — the core algorithm):
   - turn time from `reservation_policy.turn_minutes` by party size (2p=90 / 4p=105 / 6+=120)
   - candidate tables: `restaurant_tables` where `capacity ≥ party_size`, section reservable
     (+ section_pref if given), status ≠ blocked
   - conflict check: existing active `reservations` (confirmed/arrived/seated) whose
     [time_slot, end_slot] window overlaps the requested window on the same date
   - result: free table exists → available; none → nearest 2–3 alternative slots
     (scan ±30/60/90 min within open hours); nothing that day → offer next day + waitlist
5. **Quote** — write `temp_reservation` (stage=quoted, `quoted` jsonb with exact offer +
   quote hash), reply: offer + "Shall I book it? ✅" (button). Deposit line if
   `reservation_policy.deposits.enabled` (config toggle — off for pilot).
6. Turn counters++ → circuit breakers per iron rules.

**Reads:** `restaurant_tables`, `reservations`, `temp_reservation`, config.
**Writes:** `temp_reservation`.
**LLM:** 1 extract call (JSON, cheap) + 1 phrasing call (or template phrasing for speed).
**Example:**
> "tarabeza l 4 el gom3a" → "Friday for 4 🎉 What time?" → "8" →
> "Friday 8:00 PM, 4 people — terrace or indoor?" → "terrace" →
> "✨ Terrace it is — Friday 8:00 PM for 4. Shall I confirm? ✅"
**Edge cases:** "tonight" at 11:30 PM near close → offer tomorrow; asks for 25 people → handoff;
changes date mid-flow → re-validate + re-quote; two rapid corrections → merged by buffering.

---

## 8. CONFIRM RESERVATION 🟢
*Hotel equivalent: `BOOKING/confirm_booking.json` — with the strict gating rules.*

**Trigger:** MASTER dispatch: `confirm_reservation` (affirmative while stage=quoted/awaiting_confirm).

**Purpose:** the ONLY workflow that writes a reservation. Guarded like a bank transaction.

**Guards (ALL must pass — else route back to RESERVATION to re-quote):**
1. `temp_reservation.stage ∈ {quoted, awaiting_confirm}` — can't confirm what was never quoted
2. quote freshness < 30 min — stale → re-check availability first
3. re-run availability at confirm time (someone may have booked meanwhile) — gone →
   apologize + fresh alternatives
4. no duplicate: same phone + same date with an active reservation → "you already have R-XXXX —
   want to change it instead?"
5. idempotency: same quote hash already converted → resend existing confirmation (double-tap safe)

**Steps on pass:**
1. INSERT `reservations`: code `R-XXXX` (crockford, no 0/O/1/I), status=`confirmed`,
   source=`whatsapp`, occasion, special_requests, table_id (best-fit smallest table).
2. Update `temp_reservation` → stage=confirmed, then archive.
3. Upsert `diners` (name if learned, occasion → `preferences.occasions`).
4. `notifications` → dashboard bell: "New reservation — Sarah, Fri 8 PM ×4 (birthday)".
5. Confirmation message: code, date/time, party, section + occasion flourish
   ("🎂 We've noted the birthday — the candles are on us").

**Writes:** `reservations`, `temp_reservation`, `diners`, `notifications`.
**Dashboard:** card appears in Reservations (live), bell rings.
**Edge cases:** "yes" with no session at all → friendly ("yes to what? 😄 want me to book you a table?");
guest confirms twice → idempotent; slot taken in the 10s since quote → graceful re-offer.

---

## 9. CANCEL / MODIFY RESERVATION 🟢
*Hotel equivalent: `Cancel Booking` + `Confirm Cancel` pair.*

**Trigger:** MASTER dispatch: `cancel_reservation` / `modify_reservation` (with an existing reservation).

**Cancel steps:** find nearest upcoming active reservation for this phone → none: "nothing to cancel 🤔"
→ found: **always one confirmation step** ("Cancel R-4F2K — Friday 8 PM for 4? This frees your table.")
→ confirmed affirmative → status=`cancelled` + reason=guest_request → slot freed implicitly →
`notifications` → warm goodbye ("Sad to miss you! Book again anytime 💛").
Deposit refunds (when deposits are on): per policy — auto-refund if > policy window, else flag staff.

**Modify steps:** identify what changes (LLM extract) → treat as new availability check for the
delta (party/time/date) → available: update row + confirm; not: keep original + offer alternatives
("couldn't move you to 9 — kept your 8 PM. Alternatives: …").

**Reads/Writes:** `reservations`, `notifications`.
**Edge cases:** multiple upcoming reservations → ask which (list w/ codes); modify to bigger party
than max → handoff; cancel after arrival window → treat as no-show conversation, be graceful.

---

## 10. ARRIVAL 🟢
*Hotel equivalent: `checkin/` (minus passports — no ID capture in restaurants).*

**Trigger:** MASTER dispatch: `im_here` / `running_late`.

**"I'm here" steps:**
1. Find today's active reservation for this phone.
2. None → friendly walk-in handling: table free now (code check)? "Welcome! Ask the host for
   TR3 🎉" (+ notify host) : offer waitlist (#11).
3. Found → status=`arrived` + `arrived_at` → `notifications` (host bell: "Sarah has arrived —
   T4, birthday 🎂") → guest: "Welcome in! 🥳 The host is expecting you — table T4."
4. Host seats them from dashboard (status=seated) — floor map updates.

**"Running late" steps:**
1. LLM extract ETA if stated ("15 mins" / "el za7ma moot").
2. ETA within `grace_minutes` (+15 tolerance) → hold: "No stress, table's held til 8:25 🙌" + notify host.
3. Beyond grace → best-effort re-quote: same night later slot available? offer swap : honest
   "we can hold till X, after that it goes to the waitlist — want a later slot?"
4. Either way `notifications` so the host knows.

**Reads/Writes:** `reservations`, `restaurant_tables`, `notifications`, `waitlist`.
**Edge cases:** "I'm here" 3 hours early (clarify: tonight's reservation is at 8); arrival for a
cancelled reservation (gentle: "that one was cancelled — table's free now if you want it!").

---

## 11. WAITLIST 🟡
*(No hotel equivalent — restaurant native.)*

**Trigger:** MASTER dispatch (`join_waitlist`, or RESERVATION offers it when full);
dashboard Waitlist page state changes trigger the notify path; door QR (Phase C) joins directly.

**Join:** party_size → code computes est. wait (parties ahead × avg turn / matching free-soon tables)
→ INSERT `waitlist` (position auto) → "You're #3 — about 25 min. I'll ping you 📲".
**Notify (staff marks `notified` or a table frees):** "Table's ready! You have 10 min to claim it 🏃"
→ `notified_at` set.
**Claim window cron:** 10 min silent after notify → status=`expired` → next party notified + bumped.
**Position updates:** when someone ahead is seated/leaves → "You're up next 👀".

**Reads/Writes:** `waitlist`, `restaurant_tables`, `notifications`.
**Edge cases:** guest leaves ("خلاص مشينا") → status=left, thank them; joins twice → update not duplicate.

---

## 12. ORDER 🔵 (Phase C — deferred by decision)
*Hotel equivalent: `order Nader` (n8n export still missing from the hotel repo — retrieve before porting).*

Table QR (wa.me deep link with embedded table code) / pre-order for a reservation / pickup / delivery.
Cart state in `temp_order` (add later to schema — mirror of temp_reservation), menu browse via
WhatsApp list messages built from `menu_items` (86-aware), totals computed in code
(service_charge + tax from `payments` config), Paymob payment link, order lands in `orders` →
Orders/KDS dashboard page → status updates ping the guest ("on its way 🍝").
Also: call-waiter and bill-request intents (no cart — straight `notifications` to staff).
**Full spec written when Phase C starts.**

---

## 13. EVENTS 🟡
*Hotel equivalent: `events/events.json` + `buffet.json` — the "pre-compute, LLM phrases" pattern.*

**Trigger:** MASTER dispatch: `event_info` / `rsvp`.
**Info:** read `events` (status=upcoming) → **code** computes "this Friday", capacity left, price →
LLM phrases only. No events → honest + tease ("nothing this week — big one coming, want me to
tell you first? 😏" → tags diner `events_optin`).
**RSVP:** capacity left? INSERT `event_rsvps` + `rsvp_count`++ → confirm w/ event details :
offer waitlist status. Cancel RSVP supported (rsvp status=cancelled, count--).
**Reads/Writes:** `events`, `event_rsvps`, `diners` (optin tag).
**Edge cases:** RSVP for a past/cancelled event; party bigger than remaining capacity (partial offer).

---

## 14. FEEDBACK 🟡
*Hotel equivalent: review intent + guest_feedback table.*

**Trigger:** guest replies to the rating ask sent by #18 (or spontaneous praise/complaint any time —
MASTER routes `feedback_reply`).
**Steps:** LLM extract `{ rating?, food, service, vibe, comments, sentiment }` → INSERT `feedback` →
branch:
- positive → warm thanks + Google Maps review link (from config) — the review funnel
- negative → apology + "the manager will call you today" + `feedback.escalated=true` +
  `staff_alerts` (severity=high) + `notifications` — service recovery
- mid → thanks + one soft follow-up question max
**Writes:** `feedback`, `staff_alerts`, `notifications`.
**Edge cases:** rant with no rating (sentiment carries it); feedback about a visit weeks ago (accept, don't link a reservation).

---

## 15. RESERVATION REMINDERS 🟡
*Hotel equivalent: `checkin/checkin_reminders.json`.*

**Trigger:** cron hourly.
**Steps:** select confirmed reservations in the T-24h window (not yet `reminder_sent_at`) →
"Tomorrow 8 PM, 4 people 🎉 Still good? ✅ Yes / 🔄 Change / ❌ Cancel" (buttons) → mark
`reminder_sent_at`, status=`reminded`. T-3h second touch, same buttons, only if unanswered.
Replies route through MASTER: ✅ → no-op ack · 🔄 → MODIFY (#9) · ❌ → CANCEL (#9) → slot freed early.
**Guards:** quiet hours (no 3 AM reminders — send window 10:00–22:00 Cairo); WhatsApp 24h rule →
reminders are **template messages** once on the real number.

---

## 16. ABANDONED RECOVERY 🟡
*Hotel equivalent: `BOOKING/abandoned_booking_recovery.json`.*

**Trigger:** cron every 4h.
**Steps:** `temp_reservation` where stage ∈ {collecting, quoted}, updated 1–24h ago,
`recovery_attempts < 1` → ONE gentle nudge, context-aware ("Still want Friday for 4? The terrace
is filling up 👀") → attempts++. Older than 24h → archive silently. Never nudge twice.
**Guards:** quiet hours; skip if the guest messaged anything since; skip if they booked meanwhile.

---

## 17. NO-SHOW RECONCILIATION 🟡
*Hotel equivalent: `BOOKING/booking_reconciliation.json` + room_ready_watcher patterns.*

**Trigger:** cron every 15 min.
**Steps:** confirmed/reminded reservations where `time_slot + grace_minutes < now` and not
arrived → status=`no_show` → free the table implicitly → `waitlist` has matching-size party
waiting? → trigger WAITLIST notify (#11) → `notifications` ("T4 freed — no-show; waitlist notified").
Guest gets a soft message ("We missed you tonight 💔 — rebook any time"). Deposit forfeit/refund
logic when deposits are enabled. Daily 4 AM sweep: archive stale sessions, expire dead waitlist rows,
`staff_alerts` on anomalies (double-booked table, orphaned holds).

---

## 18. FEEDBACK TRIGGER 🟡
**Trigger:** cron every 30 min.
**Steps:** reservations status=`completed`, `completed_at` 2–4h ago, no `feedback` row for that
reservation, diner not asked in the last 30 days (no survey fatigue) → send the one-tap rating ask →
replies handled by #14. Quiet hours guard (a 1 AM checkout → ask at 11 AM next day).

---

## 19. EVENT MARKETING 🔵
*Hotel equivalent: `events/eventmarketing.json`.*
Cron / manual dashboard trigger. Broadcast an `events` row to segments (all opted-in / regulars /
VIP / occasion-matched) via **template messages**, mark `broadcast_sent`, RSVPs flow to #13.
Rate-limited sends (Meta quality score protection), unsubscribe honored (`diners.tags: no_marketing`).

## 20. OCCASION RE-ENGAGEMENT 🔵
Cron daily. `diners.preferences.occasions` (birthday/anniversary captured at booking) 2 weeks out →
"Sarah! The big day is coming 🎂 Same table as last year?" → straight into RESERVATION flow.
Once per occasion per year, opt-out honored.

## 21. WIN-BACK 🔵
Cron weekly. Regulars (visit_count ≥ 3) with `last_visit_at` > 6 weeks → one warm template
("We miss you! The short rib misses you more 🥩") + optional perk per config. Max once per quarter
per diner.

## 22. HYPE DROP 🔵
Cron per `reservation_policy.drop` config: at release hour, open the horizon weekend's slots;
VIP tier notified `vip_early_minutes` before everyone else ("Early access: Friday tables are live 🔥").
Creates demand spike → RESERVATION flow handles the rush (idempotency + availability guards above
are what make this safe).

---

# Build order recap

**🟢 v1 (next build):** 1 BUFFERING → 3 MESSAGES → 2 MASTER → 6 FRIENDLY → 7 RESERVATION →
8 CONFIRM → 9 CANCEL/MODIFY → 10 ARRIVAL — tested end-to-end from the `/chat` browser page,
every action visible live at ahlan-resto.vercel.app.

**🟡 v1.5 (go-live pack):** 4 RETRY, 5 STAFF-REPLY, 11 WAITLIST, 13 EVENTS, 14 FEEDBACK +
crons 15–18 + real WhatsApp number + template message registration.

**🔵 Phase C:** 12 ORDER (+ temp_order + QR deep links), 19–22 marketing engine, IG DM channel.
