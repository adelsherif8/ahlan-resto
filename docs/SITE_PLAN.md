# Munadim — Feature Truth & Site Fact-Check

**Status:** reference doc · **Owner:** Adel · **Written:** 2026-08-13
**Scope:** munadim.com (the public marketing site). Not app.munadim.com (the staff dashboard).

> **Read this alongside `branding/`, which wins on structure, copy, and design.**
> `branding/website-copy.md` is the finished landing-page copy; `branding/BRAND-SPEC.md` is the build spec; `branding/positioning.md` sets the argument (customer ownership, not "AI chatbot").
> **This document's job is different:** every feature below was verified line-by-line against the actual source code. It is the list of what we may truthfully claim — and §0 flags where the current copy claims something the product doesn't do yet. Sections 3 and 7 of this doc are superseded by the brand kit's page structure; keep §4–§8 as the source of truth for claims.

---

## 0. Fact-check of the current landing copy (2026-08-13)

Checked `branding/website-copy.md` against the code. Almost everything holds. Two things to fix, one to know about.

### ❌ Fix — "per-branch menus and prices" is not true today
- §6 AR: «أكتر من فرع — **منيو وأسعار** ومناطق توصيل لكل فرع لوحده» / EN: "Multiple branches — separate **menu, prices**, and delivery zones for each."
- §5 step 2: "delivery zones, branches, **per-branch pricing**".

**Reality:** one menu and one price list per restaurant. What genuinely *is* per-branch: **delivery zones, delivery fees, ETAs, delivery hours, pause-right-now, branch address/pin, courier assignment, kitchen tickets, and staff accounts.**

**Suggested replacement (AR):** «أكتر من فرع — مناطق توصيل وأسعار توصيل ومواعيد لكل فرع لوحده، والأوردر بيروح لمطبخ الفرع الصح.»
**(EN):** "Multiple branches — separate delivery zones, fees, and hours for each, and the order goes to the right branch's kitchen."

### ⚠️ Know — the table QR doesn't carry the table number
§4's claim as written is true (guest scans, orders from their seat, number recorded — the bot asks which table). But the QR generator produces **one** click-to-chat code with a single prefilled message, not one code per table. Don't let a designer add "the code knows your table" to the copy. *(Making it per-table is a small build — worth doing before the dine-in section becomes the pitch.)*

### ✅ Verified true — everything else in §6, the differentiators
- **Voice notes** — transcribed and ordered from.
- **Franco** — `3ayez burger` understood, and replies stay in Franco.
- **Landmark addresses** — "next to El Ezaby" is captured as a real address field and reaches the rider.
- **Cash and change** — the guest's "معايا ٢٠٠" is captured, and the rider's page computes the change owed.
- **Order goes to the kitchen; the number and history are recorded** — including dine-in.
- **Our name never appears** — the bot speaks as the restaurant, with the restaurant's own persona.
- **No commission, nothing to download** — accurate.
- **§8 "I have a POS"** — the answer as written is fine and matches positioning. Worth knowing internally: we *do* ship a full register (split payments, discounts with reasons, tips, X/Z shift reports per cashier). Keep it off the page, but it's a strong answer if a prospect pushes.

---

## 1. What we are selling

**One line:** Munadim answers your restaurant's WhatsApp — takes the order, prices it, and follows it to the door.

**The frame:** not a chatbot, not a menu link. It is **a full ordering channel on the app your guests already have open**. No app to install, no marketplace commission, no one standing between the restaurant and its own customer.

**Who it's for:** Egyptian fast-casual, delivery, and multi-branch restaurants drowning in WhatsApp — losing orders to slow replies, wrong items, and "where's my order?" phone tag.

**The three beliefs a visitor must leave with:**
1. It genuinely takes a complete order — correctly, in the guest's own language, with no human involved.
2. It cannot invent a price, a dish, or a promise. *(Our sharpest differentiator — nearly every competitor's demo hallucinates.)*
3. There is real operational software behind it — kitchen board, POS, couriers, CRM — not just a chat window.

**The one-sentence proof to repeat everywhere:** *the AI writes the words, the code writes the numbers.*

---

## 2. Site map

| Page | Purpose | Priority |
|---|---|---|
| **Home** | The whole story in one scroll, one CTA | P0 — launch |
| **How it works** | The order lifecycle, guest side and kitchen side | P0 (can start as a Home section) |
| **Features** | The deep list for the buyer who reads everything (§4–6 are its source) | P1 |
| **Pricing** | Plan + what's included (decision needed — §9) | P1 |
| **Live demo** | "Message our demo restaurant" — a real WhatsApp thread | P1 · highest-converting page we can build |
| **About / Contact** | welcome@munadim.com · footer is enough at launch | P0 |

**Languages:** English + Arabic (RTL) versions of every page. Franco is a *product* capability, not a site language.

---

## 3. Home page, section by section

### 3.1 Hero
- **Headline:** Your restaurant's WhatsApp, answered.
- **Arabic:** مساعد ذكي يرد على واتساب مطعمك — ياخد الأوردر ويتابع التوصيل، بالعربي والفرانكو والإنجليزي.
- **Sub:** Takes orders, answers questions, tracks deliveries, and remembers your regulars — 24/7, in whatever language they write in.
- **CTA:** Get in touch → (later) Try it on WhatsApp.
- **Visual:** a real WhatsApp thread in a phone frame — Arabic message in, order + receipt out. **This single asset will sell more than any paragraph on the page.**

### 3.2 The problem (3 lines, no more)
Guests message all day. Staff answer between orders. Items get missed, prices get guessed, "where's my order?" eats the shift — and marketplaces take 20–30% to stand between you and your own customer.

### 3.3 How it works
1. **The guest messages your number** — the same one on your posters and Instagram bio.
2. **Munadim takes it from there** — menu, choices, address, payment, confirmation.
3. **The kitchen gets a ticket, the guest gets a live tracking link.**

### 3.4 The six pillars (cards, each opening into detail)
Ordering · Three languages · Never invents · Live delivery · Remembers your guests · Runs your floor.

### 3.5 The "wow" strip — pick 4 of these for screenshots (§7)
Voice note ordering · one-tap location · live tracking page · the 3D burger builder.

### 3.6 Proof & trust
Built for Egypt (EGP, VAT-inclusive pricing, Cairo delivery zones, Arabic + Franco). Official WhatsApp Business API — your number, your brand. Every menu, price, and hour answered from the restaurant's own data. Every release tested against 110 real-conversation scenarios before it ships.

### 3.7 Pricing teaser → 3.8 FAQ → 3.9 Final CTA

---

## 4. THE WHATSAPP AGENT — the star of the site

> Site copy rule: describe what the **guest experiences**, never the mechanism. "It asks which burger you meant" beats "disambiguation logic."

### 4.1 Ordering
- Orders in plain language — "2 chicken ranch combo and a cola" understood in one message.
- **Voice notes** — guests can talk instead of type; the note is transcribed and ordered from. *(Huge in Egypt; lead with it.)*
- **Photos** — a guest can send a picture and ask about it.
- Asks *which one* instead of guessing: say "burger" and it lists the burgers you actually sell.
- Knows serving styles — sandwich vs combo vs meal — and asks only when it matters.
- Walks options one dish at a time: size, drink, spice, sides.
- Understands answers given early or out of order ("medium fries and a cola" before it asked).
- Splits per-unit choices like a real ticket — "one coke and one sprite" across two meals.
- **Change your mind like with a person:** add, remove, "make it 2", "actually give me the Nashville instead", "no — the slaw is the combo, the other isn't".
- Multi-choice bundles (4×4 boxes) via a fill-in template it parses back tolerantly.
- Items you don't carry are **named out loud**, never silently dropped.
- Near-equivalents offered honestly: "cola zero → closest we carry is Coca-Cola Diet ✍️ say the word to switch".
- Sold-out items get the truth — "ran out today, back soon" — not "we don't have that".
- Stock counts down as orders come in; at zero the dish 86s itself across WhatsApp, POS, and the board.
- **Reorder in ~4 messages** — "the usual", "same as last Tuesday", "the truffle one I got", offered as a one-tap chip.
- Cancel rules that protect the kitchen: an unconfirmed order clears instantly; a confirmed one is never auto-cancelled — staff are pinged and decide.
- **If it gets stuck, a human takes over** — three misses and a team member joins the same chat with a briefing. Never a dead end.

### 4.2 Three languages, properly
- **English, Egyptian Arabic, and Franco** — replies in whatever the guest writes, and switches mid-chat.
- Handles real writing: misspellings, "سلام عليكو", "heyyy", mixed script.
- **Arabic dish names** — dishes are spoken by their official Arabic menu name (سيجناتشر برجر), taken from your menu, never machine-translated.
- Bills, buttons, payment names, and every question exist pre-written in all three — so quality never depends on the AI improvising.
- A Latin-script message can never receive an Arabic-script reply. Enforced in code, not hoped for in a prompt.

### 4.3 Never invents — the trust pillar
- **Prices, totals, VAT, and delivery fees are computed by code.** The AI is structurally forbidden from writing a number; stray totals are stripped before sending.
- Menu, hours, delivery areas, fees, and ingredients come from your data. **No data → it says the team will confirm**, never a guess.
- It never claims an order was placed unless a ticket actually exists.
- It never claims you chose something before you answered.
- Offers and specials: only the ones you configured, never an invented discount.
- Allergies: never recommends a dish carrying a known allergen. Health conditions (diabetes, pregnancy…) are **never stored**, and every such reply ends with the kitchen double-check line.
- Prompt-injection attempts ("ignore your instructions") are stripped and refused.
- **110 real-conversation scenarios** run against the live system before every release — roughly 25 of them exist because of a specific bug a real guest once hit.

### 4.4 Delivery, pickup, dine-in
- Handles all three: dine-in with a real table number, pickup at a branch, delivery to a door.
- **One-tap location** — WhatsApp's native location picker instead of typing an address.
- Saved addresses offered back as buttons ("🏠 Zahraa El Maadi…", "Somewhere new").
- Pasted Google/Waze links resolved to real coordinates.
- Delivery zones by area name **or Arabic/Franco alias or a dropped pin** — with your fee and your ETA quoted verbatim.
- Honest refusals instead of a doomed order: outside the zone (offers pickup at the nearest branch), below minimum, kitchen paused, outside delivery hours.
- Multi-branch: nearest branch that actually covers the address, chosen automatically.
- **Smart pickup timing** — "when are you passing by?" so the kitchen fires late and the food is hot.
- Payment method folded into the same message — cash, card, or InstaPay, worded for how they're paying.

### 4.5 The bill and the receipt
- A properly itemised bill: lines with modifiers, subtotal, VAT (inclusive — never added on top), service charge on dine-in only, delivery fee, total due.
- **A real PDF receipt** in thermal-till style with your logo, the order code, and a QR that opens their live tracking.
- An explicit confirm step — the guest sees the full bill before anything reaches the kitchen. *(Never removed, even to save a message.)*

### 4.6 After the order
- **Live tracking page** — order code, status ladder, real ETA, rider name, vehicle and plate with tap-to-call, and "have 265 EGP ready". Refreshes itself.
- "Where's my order?" answered with real timestamps: received → kitchen started → ready → on the way.
- Rider taps send the guest updates from *your* number: on the way, 2 minutes away, arrived, delivered.
- A delay shows quietly on the tracking page instead of spamming the chat.
- **Abandoned-order recovery** — a nudge 45 minutes later if they walked away mid-order. ⚙️
- One tasteful add-on suggestion — priced by code, offered once, never nagging. ⚙️
- A Google review invite to guests who were actually happy — never to an unhappy one. ⚙️

### 4.7 It remembers your guests
- Names, usual orders, favourite dishes, saved addresses, visit history — built automatically from real conversations and real orders.
- Greets a regular by name with their usual; welcomes a first-timer properly and can suggest your signature dishes. ⚙️
- Birthdays and long-time-no-see handled with grace. ⚙️
- Allergies remembered and respected on every future order.
- Asked "what do you know about me?" it deflects — it never recites a guest's file back at them.

### 4.8 It answers the questions staff answer 100 times a day — instantly and free
Hours (with open/closed right now) · address, parking, and a real WhatsApp map pin · phone · delivery areas and fees · "what's in the Nashville?" from your ingredient list · "is it spicy?" · item prices · **"how much for 2 meals and a cola?"** — arithmetic done in code · what's in a category · dish photos with prices · your FAQs, plus questions it couldn't answer collected for you to approve into new FAQs.

**Owner-facing value:** these answers use **no AI at all**, so the most common messages are effectively free — which is what keeps the per-order cost stable as volume grows.

### 4.9 It behaves like a person, not a bot
- Your host's name, your personality, your greeting — with corporate bot-speak explicitly banned.
- Matches the guest's energy; formal Arabic gets polite Arabic, not street slang.
- One line of genuine empathy first when someone's had a bad day.
- Rapid-fire messages get **one** considered answer instead of three fragments.
- Read receipts and "typing…" appear immediately; a long think says "one sec 🙏" rather than going silent.
- Emoji reactions on genuinely emotional moments. Rare, on purpose.
- Never lies about being a bot.
- Waitlist joins, complaints, lost property, refund requests — handled or escalated, never promised away.

### 4.10 The 3D burger builder ⚙️ *(exists, currently off for pilots — decide whether to show it)*
A signed one-guest link opens a **3D builder**: stack layers, watch the price update live, name your burger, allergy filters that grey out unsafe ingredients, sauce amount, kids mode, chef's presets, "surprise me", a shareable photo card of your creation, and a "make it a meal?" checkout. The build comes back into WhatsApp as a real priced line, and gets saved as a one-tap "usual" for next time. It falls back to a 2D version on older phones.

**This is the most demo-able thing we own.** If we show it, it deserves its own page section with a video.

---

## 5. The restaurant's side (keep to ONE home-page section; full detail on /features)

- **Kitchen board** — WhatsApp, POS, and phone orders on one 5-column screen, TV mode, station filters, per-branch, one-tap advance with a 5-second undo, printed tickets in cook order.
- **Live chats** — every conversation, one-tap human takeover (the AI steps back automatically the moment a human replies), an AI-drafted reply staff can edit, and the guest's full profile beside the thread.
- **POS** — the same ordering brain at the register: type the order as spoken, PLU shortcuts, split payments, discounts with reasons, tips, parked tickets, an offline queue, and X/Z shift reports per cashier.
- **Menu** — prices, photos, stock, and the option questions the bot asks; changes go live instantly. Menu-engineering quadrants show what actually sells from real order data.
- **Menu design** — three print templates, published straight to WhatsApp as the guest-facing PDF.
- **Delivery** — courier roster, smart auto-assignment that batches nearby drops onto one rider, driver links with no app, and cash reconciliation at end of shift.
- **Guests (CRM)** — built automatically, with editable memory: you can make the AI forget something.
- **Floor map, waitlist, reservations** — for table-service restaurants.
- **QR codes** — branded click-to-chat codes for tables and posters that open WhatsApp with the order already started.
- **Settings** — personality, offers, delivery zones, charges, promotions, button wording, and FAQ approval, all without a developer.

---

## 6. Platform (for the buyer who asks "is this real software?")
Official WhatsApp Business API on your own number · multi-branch and multi-restaurant, with each restaurant's data in its own database · every conversation traceable step by step · encrypted tenant credentials, signed webhooks, rate limits, and row-level security · 110-scenario regression suite gating every release.

---

## 7. The four screenshots that will carry the site
1. **An Arabic order, start to receipt** — proves language + ordering + the bill in one image.
2. **The "which one did you mean?" moment** — proves it doesn't guess.
3. **The live tracking page** with rider and ETA — the most polished surface we own.
4. **The 3D builder** (if we're showing it) — the "nobody else has this" moment.

---

## 8. Do NOT claim (verified gaps — keep marketing honest)
- **No payments taken in chat.** The method is recorded; money is collected at the door/counter. (Paymob is roadmap.)
- **No opening-hours or branch editor in the dashboard yet** — both are set up for the restaurant during onboarding. Don't write "edit your hours anytime".
- **No broadcast/marketing campaigns** — the button exists but is disabled pending Meta template approval. Same for reorder reminders.
- **Instagram is not shipped.** It appears in the inbox UI and the data model, but there is no Instagram connection in the product. Say "WhatsApp" only.
- **No proactive "your order is being prepared" messages by default** — this is deliberate (the tracking page is the source of truth, and it keeps message costs down). Cancellations and "pickup ready" still send. Frame it as design, not absence.
- **No calorie counts** in the builder, and no "your build ≈ X on the menu" price comparison (disabled — it was wrong too often).
- **Don't say "built on LangGraph"** — the engine is our own. That's the stronger claim anyway.
- **Don't invent metrics.** No "increases sales by X%" until we can prove it from Luci'z data.
- The regression suite is **110 cases** — cite 110 or "100+", nothing higher.

---

## 9. Open decisions (need Adel)
1. **Pricing** — publish the plan, or "contact us"? Publishing filters time-wasters; hiding it keeps room to price per restaurant.
2. **Show the 3D builder?** It's the best demo we have, but it's currently off at both pilots — showing it invites "can I have it today?"
3. **Live demo number** — by far the best converter. Point it at a demo restaurant, or hold until after launch because of support load?
4. **Named customers** — can we show Luci'z and Just Smash (logo + a line of quote), or stay anonymous for now?
5. **Arabic-first or English-first** landing? Guests are Arabic; the *buyers* — owners — often read English marketing.
6. **Publish the "110 tested scenarios" number?** Strong trust signal, but invites "what about the 111th?"
7. **Do we position POS as a headline** (it's genuinely a full register) **or as a bonus** so the WhatsApp story stays sharp?

---

## 10. Build order once the content is agreed
1. Rewrite Home with real WhatsApp screenshots + the six pillars (replaces today's placeholder).
2. Arabic (RTL) version of Home.
3. /features (from §4–6), /pricing, FAQ.
4. Live demo number + a short video of a real order, start to receipt.
