# Meta message templates — drafts for founder approval (2026-08-05)

Templates are the ONLY way to message a guest whose last message is older than 24h.
Approve the wording below and I submit them via the WhatsApp Business Management API
(our token already has the permission — verified). Meta review is usually hours.

Rules Meta enforces: no aggressive selling, no misleading claims, variables must be
real values (never "click here"), and the category decides the price
(MARKETING costs more than UTILITY; both ~$0.03–0.11 in Egypt).

---

## 1. `reorder_reminder` — MARKETING
**Use:** a regular who ordered weekly has been silent N days (Settings toggle, default 10).
**Language:** English + Arabic versions (Meta treats them as one template with locales).

**EN body**
> Hey {{1}} 👋 It's been a while since your last {{2}} from {{3}}.
> Craving the usual? Reply and I'll have it ready.

- {{1}} = guest first name (from CRM; falls back to "there")
- {{2}} = their most-ordered item name
- {{3}} = restaurant name

**AR body**
> أهلاً {{1}} 👋 بقالك فترة عن آخر {{2}} من {{3}}.
> نفسك في الطلب المعتاد؟ رد عليا وأجهزهولك.

**Buttons:** Quick reply — "Order the usual" · "Not now"

---

## 2. `win_back` — MARKETING
**Use:** guest silent 30+ days. One send per guest per 60 days, founder-approved audience.

**EN body**
> {{1}}, we miss you at {{2}} 🧡
> Your last order was {{3}}. Come back and it's on the house to say hi — just reply and I'll sort it.

- {{1}} = first name · {{2}} = restaurant name · {{3}} = last order summary

**AR body**
> {{1}}، وحشتنا في {{2}} 🧡
> آخر طلب ليك كان {{3}}. ارجعلنا ورد عليا وأنا أظبطهالك.

**Buttons:** Quick reply — "See the menu" · "Order now"

> ⚠️ Decide before submitting: does "on the house" mean a real perk? If yes it must
> be a configured promo (the promos engine already supports it) — the bot can never
> promise something the restaurant hasn't set up. Safer alternative line:
> "Come back and see what's new — reply and I'll take your order."

---

## 3. `order_ready_late` — UTILITY (cheaper tier)
**Use:** rare — an order becomes ready long after the guest's last message (window closed).

**EN body**
> Your order {{1}} from {{2}} is ready 🎫 {{3}}

- {{1}} = order code · {{2}} = branch · {{3}} = "Come pick it up" / "Your rider is on the way"

**AR body**
> طلبك {{1}} من {{2}} جاهز 🎫 {{3}}

**Buttons:** none (utility notification)

---

## What I need from you
1. Approve/edit the wording of each (they can't change after approval without re-review).
2. Decide the win-back perk question above.
3. Then I submit all three and wire the sends behind their existing Settings toggles.

Cost reminder: every template send is billed by Meta (~0.03–0.11 USD ≈ 1.5–5.4 EGP).
The plan prices campaigns at 1.5 EGP/message to the restaurant, so heavy campaigns
should be priced per-send, not bundled.
