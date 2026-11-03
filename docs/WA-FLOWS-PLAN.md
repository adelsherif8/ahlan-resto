# WhatsApp Flows — native address form (plan, 2026-11-01)

Status (2 Nov 2026): CODE-COMPLETE, OFF BY DEFAULT. `services/addressflow.js` (Flow JSON 7.3,
completion → address line, per-tenant Flow lookup/create), `whatsapp.js` (`nfm_reply` parsing,
`sendFlow`, `listFlows`/`createFlow`/`publishFlow`), `buffering.js` (ingest + delivery with the
location request as fallback), `server.js` boot warm-up, `test/addressflow.test.mjs` (round-trip
×100, envelope parsing). Nothing is sent to Meta until a tenant has
`integrations.whatsapp.waba_id` AND `ai.address_flow = true`. Still to do, in order: rotate the
Meta system-user token (docs/SECRETS-ROTATION-2026-11.md), store Munadim's WABA id, draft-mode
send to a tester phone (the no-encryption proof), fixture `convos-addressflow3.json`, hand gate.

## Why

The delivery address is the weakest moment in the order. Today the bot sends a five-bullet
template (`services/address.js` → `ADDRESS_TEMPLATE_EN/AR`) plus a native location-request,
and `parseAddress()` tears the typed blob apart with regexes (floor / apartment / building /
landmark, everything else = street + area). Real guests send one line, skip the floor, or put
the landmark first. A WhatsApp Flow is a real form inside the chat: labelled fields, required
markers, no typos in the labels, and the completion comes back as JSON. Same message cost as
the text ask (a Flow message is an ordinary service message inside the 24h window; no Flow fee).

A second use, later: option picks with more than 3 buttons or 10 list rows (bundle slots).
RadioButtonsGroup takes 20 options, Dropdown 200. Not in this batch.

## What Meta gives us (verified against the developer docs on 2026-11-01)

- Create + publish in one call: `POST /{WABA_ID}/flows` with `name`, `categories:["OTHER"]`,
  `flow_json` (string), `publish:true`. Response `{id, success, validation_errors}`.
- Flow JSON version to use: **7.3** (recommended for publishing and sending; message version 3).
- No endpoint, no encryption: a Flow whose Footer action is `complete` returns the form values
  in the chat; `endpoint_uri`, `data_api_version` and the business public key are only for
  `data_exchange` Flows. One test send confirms this before we build on it.
- Send: `type:"interactive"`, `interactive.type:"flow"`, `action.name:"flow"`,
  `parameters: {flow_message_version:"3", flow_id, flow_cta, flow_action:"navigate",
  flow_token, flow_action_payload:{screen:"ADDRESS"}}`. `flow_cta` ≤ 30 chars, no emoji.
- Completion webhook: a normal `messages` event, `type:"interactive"`,
  `interactive.type:"nfm_reply"`, `nfm_reply.response_json` = a STRING to `JSON.parse`,
  containing `flow_token` plus the payload fields. `context.id` = the Flow message we sent.
- Token scopes: `whatsapp_business_management` + `whatsapp_business_messaging`, both granted on
  the WABA. Publishing needs a verified business (Munadim's verification is still pending →
  draft Flows can be tested with `mode:"draft"` meanwhile).
- Open question from the docs: whether a PUBLISHED Flow's JSON can be edited (two pages
  disagree). Plan for "no": version the Flow name (`munadim-address-v1`) and re-create.

## Design — zero changes to the order logic

The Flow completion is turned into exactly the text a careful guest would have typed, in the
labelled form `parseAddress()` already understands. The order flow never learns that a Flow
exists.

```
nfm_reply.response_json
  → {street, area, building, floor, apartment, landmark}
  → "Street 9 Maadi, building 14, floor 3, apartment 7, near Metro Market"
  → the normal INGEST → RESPOND path, as a guest text event
```

### 1. `services/whatsapp.js`
- `parseEnvelope`: when `msg.interactive.type === "nfm_reply"`, set
  `interactive = {kind:"nfm_reply", id:null, title:null, flow: JSON.parse(response_json)}`.
  (Today it would become the text `[button]`.)
- New sender `sendFlow(phoneNumberId, to, bodyText, {flowId, cta, screen, token})` next to
  `sendLocationRequest`. Same `graphPost`, same 1024-char body cap.
- New `ensureAddressFlow(wabaId)`: `GET /{WABA_ID}/flows`, find `munadim-address-v1`
  (status PUBLISHED, or DRAFT while unverified), else create+publish from the JSON in
  `services/addressflow.js`. Cache the id in memory; run at boot after `warmMenus()`.

### 2. `services/addressflow.js` (new)
- `ADDRESS_FLOW_JSON(lang)` — one screen `ADDRESS`, `terminal:true`, SingleColumnLayout:
  TextInput `street` (required, 80), TextInput `area` (required, 40), TextInput `building`
  (required, 20), TextInput `floor` (10), TextInput `apartment` (10), TextArea `landmark`
  (200). Footer label «تأكيد العنوان» / "Confirm address", action `complete` with payload
  `{street:"${form.street}", …}`. Labels ≤ 20 chars (Meta's cap). Two Flows, one per script
  (`munadim-address-ar-v1`, `munadim-address-en-v1`); Franco guests get the English form
  (the labels are nouns; the guest types in whatever they like).
- `flowReplyToText(payload)` → the labelled one-liner above, using the SAME keywords
  `parseAddress()` matches (`building`, `floor`, `apartment`, `near` / `عمارة`, `الدور`, `شقة`,
  `جنب`). Unit test: `parseAddress(flowReplyToText(x))` round-trips every field for 50 random
  payloads, both scripts.

### 3. `flows/buffering.js`
- Ingest (line ~90, where an interactive tap becomes text): `kind:"nfm_reply"` →
  `{kind:"text", text: flowReplyToText(e.interactive.flow)}`. The `flow_token` carries
  `restaurantId|sessionId|address` so a stale completion (Flow finished after the order was
  placed) is recognisable: if `pending_order` is gone, reply once with the saved-address
  notice instead of starting a new order.
- Delivery (line ~422, the `wantLocation` branch): when the tenant has an address Flow id and
  `outcome.need_address` (not `need_pin`), send `sendFlow` with the reply text as the body and
  CTA «📍 اكتب العنوان» → "Enter address" (no emoji in CTA per Meta: «اكتب العنوان»). Keep the
  location-request as the fallback when `sendFlow` throws, and for `need_pin` (a pin is still
  the right answer when the address could not be placed).
- The Flow and the location request cannot ride one message. Order of preference for
  `need_address`: Flow (structured) → location request (today's behaviour). The body text keeps
  the line "or paste a Google Maps link 🔗" so the pin path stays open.

### 4. Config
- `restaurants.integrations.whatsapp.waba_id` (new, per tenant) — the WABA that owns the
  number. Munadim's is read from WhatsApp Manager once and stored. No WABA id → feature off,
  bot behaves exactly as today.
- `ai.address_flow` = `true|false` (default false until the first hand gate passes).

### 5. Tests, in order
1. `node --test` round-trip test (free).
2. Draft-mode send to a tester number from the local server (`mode:"draft"`), complete the
   form on the phone, confirm the webhook arrives as `nfm_reply` and the order continues to
   the payment ask with the address printed in the bill. This is the no-encryption proof.
3. Fixture `convos-addressflow3.json`: a seeded `nfm_reply` event (the harness posts the raw
   envelope to the webhook with `WA_SKIP_SIGNATURE`) for AR, EN, Franco.
4. Founder's hand gate (5 conversations, [[ahlan-manual-conversation-gate]]) with
   `ai.address_flow=true` on Munadim only.

## Effort

About a day: ~120 lines in `whatsapp.js` + `addressflow.js`, ~25 in `buffering.js`, one
migration-free config key, one fixture. No change to `order.js`.

## Not doing

- `data_exchange` Flows (live validation against the delivery zones while the guest types).
  Needs the encryption endpoint and a public key per number; the zone check already runs on the
  completed address and asks for a pin when needed.
- Flow buttons in message templates (re-engagement). Templates are a separate track
  (`docs/META-TEMPLATES.md`).
