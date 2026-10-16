// ORDER BILL + RENDER — money and the text the guest reads, all computed by code.
// Extracted from flows/order.js (2026-10-16). priceOrder() is the single place a bill
// is totalled (VAT inclusive, service on dine-in only, the QUOTED delivery fee is the
// billed one); renderBill()/renderSplit() draw the receipt and the check split in the
// guest's language; statusTimeline() is the code-drawn progress ladder. The model never
// writes a number — it phrases around these blocks.
import { fmtMoney } from "./format.js";
import { pricingOf } from "./delivery.js";
import { publicLink } from "../config.js";
import { fromP } from "./checksplit.js";
import { normName, modifiers, itemPrice, arOptionWords } from "./orderoptions.js";

export function publicOrder(o) {
  return {
    code: o.code, status: o.status, order_type: o.order_type, table_number: o.table_number,
    items: o.items, total: o.total,
    created_at: o.created_at, started_at: o.started_at, ready_at: o.ready_at, out_at: o.out_at,
    courier_name: o.courier_name || null, branch: o.branch || null,
  };
}

// A code-drawn progress ladder — the guest sees exactly where their food is and
// how long each step took. Timestamps come from the board's own stamps, so the
// bot can never invent progress that didn't happen.
// Their real history, as taps: the saved custom build first (it is named, so it is the
// strongest offer), then their last order. Nothing invented — an empty history means
// no chips, and the model just asks what they'd like.
export function reorderChips(diner, config) {
  const chips = [];
  const build = (diner?.preferences?.builds || [])[0];
  if (build?.name && build.layers) chips.push(`${String(build.name).slice(0, 18)} 🔁`);
  const last = (diner?.preferences?.last_items || [])[0]?.name || diner?.preferences?.usual_item;
  if (last) chips.push(`${String(last).slice(0, 18)} 🔁`);
  return chips.length ? chips.slice(0, 2) : null;
}

export function statusTimeline(o, tz = "Africa/Cairo", lang = "en") {
  // the ladder speaks the guest's language — an Arabic guest was getting
  // "Kitchen started" under a حاضر line, half a bubble each way
  const T = (en, ar, fr) => (lang === "ar" ? ar : lang === "fr" ? fr : en);
  const t = (v) => v ? new Date(v).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }) : null;
  const delivery = o.order_type === "delivery";
  const steps = [
    { key: "placed", label: T("Order received", "استلمنا الطلب", "Estalamna el order"), at: o.created_at, done: true },
    { key: "preparing", label: T("Kitchen started", "المطبخ بيحضّر", "El kitchen sha3'al 3aleh"), at: o.started_at, done: !!o.started_at || ["preparing", "ready", "out_for_delivery", "served", "delivered"].includes(o.status) },
    { key: "ready", label: delivery ? T("Packed & ready", "اتجهز واتغلف", "Etgahhez w etghallaf") : (o.order_type === "dine_in" ? T("Coming to your table", "جاي على ترابيزتك", "Gay 3ala tarabezetak") : T("Ready for pickup", "جاهز للاستلام", "Gahez lel pickup")), at: o.ready_at, done: ["ready", "out_for_delivery", "served", "delivered"].includes(o.status) },
  ];
  if (delivery) steps.push({
    key: "out", label: o.courier_name ? T(`On the way with ${String(o.courier_name).split(" ")[0]}`, `في الطريق مع ${String(o.courier_name).split(" ")[0]}`, `Fel taree2 ma3 ${String(o.courier_name).split(" ")[0]}`) : T("On the way", "في الطريق", "Fel taree2"),
    at: o.out_at, done: ["out_for_delivery", "delivered"].includes(o.status),
  });
  const mins = o.created_at ? Math.round((Date.now() - new Date(o.created_at).getTime()) / 60000) : null;
  const ago = mins != null ? (lang === "ar" ? ` · من ${mins} دقيقة` : ` · ${mins} min ago`) : "";
  const body = steps.map((st) => `${st.done ? "✅" : "⬜"} ${st.label}${st.done && t(st.at) ? ` · ${t(st.at)}` : ""}`).join("\n");
  return `🎫 *${o.code}*${ago}\n${body}`;
}

// Delivery addresses the guest has actually used before, newest first.
export function savedAddresses(diner) {
  return (diner?.preferences?.addresses || [])
    .filter((a) => a && typeof a.text === "string" && a.text.trim())
    .slice(0, 3);
}

// WhatsApp truncates button titles, so an answer that is a PREFIX of a saved
// address still means that address.
export function matchSaved(message, saved) {
  // chips render as "🏠 Zahraa El Maadi, s" — drop the emoji/marker before matching
  const m = normName(String(message).replace(/^[\s🏠📍]+/u, ""));
  if (m.length < 4) return null;
  return saved.find((a) => {
    const t = normName(a.text);
    return t === m || t.startsWith(m) || m.startsWith(t);
  }) || null;
}


// ---------------------------------------------------------------------------
// Money — computed in code, always. Only charges the restaurant actually
// configured appear; an unset fee is absent, never guessed at.
// ---------------------------------------------------------------------------
// The VAT rate, for the receipt's Net/VAT/Total breakdown. Same >=1 → percent rule as
// the bill. Defaults to Egypt's 14% when unset — every restaurant here charges it and
// the printed receipt is legally required to show it, so this is a real national
// standard, not an invented number.
export function taxRate(config) {
  const p = config?.payments || {};
  for (const k of ["tax_pct", "vat_pct", "tax"]) {
    const v = Number(p[k]);
    if (Number.isFinite(v) && v > 0) return v >= 1 ? v / 100 : v;
  }
  return 0.14;
}

export function priceOrder(items, config, orderType, quotedDeliveryFee = null, deliveryKm = null) {
  const p = config.payments || {};
  const round = (n) => Math.round(n * 100) / 100;
  const subtotal = round(items.reduce((s, i) => s + itemPrice(i) * Number(i.qty), 0));

  const extras = [];
  // configs in the wild write these either as a fraction (0.14) or a percentage (14) —
  // accept both rather than silently charging nothing, or charging 100x
  const rateOf = (...keys) => {
    for (const k of keys) {
      const v = Number(p[k]);
      // >= 1 always means percent: 14 → 14%, 1 → 1%. (Nobody configures a 100%
      // charge; reading a whole-number 1 as the fraction 1.0 doubled bills.)
      if (Number.isFinite(v) && v > 0) return v >= 1 ? v / 100 : v;
    }
    return 0;
  };
  const charge = (label, rate) => {
    if (rate <= 0) return 0;
    const amount = round(subtotal * rate);
    extras.push({ label: `${label} (${Math.round(rate * 1000) / 10}%)`, amount });
    return amount;
  };
  // service charge is a dine-in convention — never added to a delivery or pickup bill
  const service_charge = orderType === "dine_in" ? charge("Service", rateOf("service_charge", "service_charge_pct")) : 0;
  // The fee the bot QUOTED (zone / flat / distance — computed by services/delivery.js
  // and stored on the draft) is the fee that's BILLED. payments.delivery_fee is only
  // the legacy fallback for restaurants with no delivery config at all. Quoting 30
  // and charging 70 was a real bug.
  const feeSrc = quotedDeliveryFee != null && Number.isFinite(Number(quotedDeliveryFee)) ? Number(quotedDeliveryFee) : (Number(p.delivery_fee) || 0);
  const delivery_fee = orderType === "delivery" ? round(feeSrc) : 0;
  // "(~0 km)" (guest standing at the branch) reads like a broken number — the distance
  // is only worth printing when it is one
  if (delivery_fee > 0) extras.push({ label: deliveryKm != null && Number(deliveryKm) >= 0.3 && pricingOf(config).mode === "distance" ? `Delivery (~${deliveryKm} km)` : "Delivery", amount: delivery_fee });

  // VAT is INCLUSIVE — menu prices already include it, exactly like the printed
  // receipt ("Prices are VAT inclusive"). It is NEVER added on top; it's shown as a
  // breakdown of the total: Net = total / (1 + rate), VAT = total − Net. Adding it as
  // an extra was overcharging ~14% on prices that already contained it.
  const total = round(subtotal + extras.reduce((s, x) => s + x.amount, 0));
  const rate = rateOf("tax", "tax_pct", "vat_pct") || 0.14;
  const vat = round(total - total / (1 + rate));
  const net = round(total - vat);
  return { subtotal, extras, service_charge, delivery_fee, tax: vat, vat, net, vat_inclusive: true, total };
}

// The bill as the guest sees it. Built here so the model never writes a number
// or a currency symbol — it phrases around this block, it doesn't compose it.
export const fmtAmount = fmtMoney;


// ---- Arabic DISPLAY translation for generic menu vocabulary ----
// Labels and generic choice words render in Arabic for Arabic guests; DISH NAMES
// stay as authored (house rule). Matching is unaffected: the resolver is semantic
// and arOptionWords maps the Arabic answers back.
export const AR_MENU_WORDS = [
  [/^which one$/i, "تحب تاخده إزاي؟"], [/^combo drink$/i, "مشروب الكومبو"],
  [/^combo size$/i, "حجم الكومبو"], [/^size$/i, "الحجم"], [/^which fries$/i, "البطاطس"],
  [/^drink$/i, "المشروب"], [/^side$/i, "الجانب"], [/^spice level$/i, "مستوى الحرارة"],
  [/^sandwich$/i, "ساندوتش"], [/^combo \(fries \+ drink\)$/i, "كومبو (بطاطس + مشروب)"],
  // bare condition words as they appear in "If Combo — …" — the choice NAME is
  // "Combo (fries + drink)" but the when-value is just "Combo"
  [/^combo$/i, "كومبو"], [/^meal$/i, "وجبة"], [/^full meal$/i, "وجبة كاملة"], [/^sandwich only$/i, "ساندوتش بس"],
  [/^full meal$/i, "وجبة كاملة"], [/^meal$/i, "وجبة"], [/^small$/i, "صغير"],
  [/^medium$/i, "وسط"], [/^large$/i, "كبير"], [/^mild$/i, "خفيف"],
  [/^medium spicy$/i, "وسط حراقة"], [/^hot 🔥$/i, "حار 🔥"], [/^hot$/i, "حار"],
  [/^french fries$/i, "بطاطس"], [/^coca - cola$/i, "كوكاكولا"],
  [/^coca - cola diet$/i, "كوكاكولا دايت"], [/^sprite$/i, "سبرايت"], [/^fanta$/i, "فانتا"],
  [/^fanta orange$/i, "فانتا برتقال"], [/^water$/i, "مية"],
];
// a CHOICE can be a menu item ("Munadim Karkadeh" as the combo drink) — its Arabic name
// lives on the menu row, so Arabic lists don't show one Latin line among the Arabic ones
export let _arMenuNames = new Map();
export function setArMenuNames(menu) {
  _arMenuNames = new Map((menu || []).filter((m) => m?.name && m?.name_ar).map((m) => [normName(m.name), m.name_ar]));
}
export const arWord = (w) => {
  const k = normName(String(w).trim());
  if (_arMenuNames.has(k)) return _arMenuNames.get(k);
  for (const [rx, ar] of AR_MENU_WORDS) if (rx.test(String(w).trim())) return ar;
  return w;
};
export const AR_PAY = { "cash on delivery": "كاش عند الاستلام", "cash at the counter": "كاش في الكاونتر", "cash at the cashier": "كاش عند الكاشير", "card": "كارت", "card at the cashier": "كارت عند الكاشير", "instapay": "انستاباي", "online link": "لينك أونلاين" };
export const arPay = (m) => AR_PAY[String(m).toLowerCase().trim()] || m;
export const arLabel = (l) => String(l).replace(/^If (.+?) — (.+)$/i, (m, cond, rest) => `لو ${arWord(cond)} — ${arWord(rest)}`)
  .replace(/^(?!لو )(.*)$/s, (m, x) => arWord(x));

// THE SPLIT, AS THE GUEST SEES IT. Same rule as renderBill: every figure here comes
// from the engine (checksplit.js), so the model can never compose a number. Arabic gets
// Arabic labels and dish names; Franco keeps Latin labels, exactly like the bill above.
export function renderSplit(outcome, { lang, currency, arName }) {
  const AR = lang === "ar";
  const FR = lang === "fr";
  const T = (en, ar, fr) => (AR ? ar : FR ? (fr || en) : en);
  const money = (n) => `${fmtAmount(n)} ${currency}`;
  const nameOf = (l) => (AR && (l.name_ar || arName) ? (l.name_ar || arName(l.name)) : l.name);
  const r = outcome.split || {};
  const out = [];

  out.push(`🧮 *${T("CHECK SPLIT", "تقسيم الحساب", "Check Split")}*${outcome.order_code ? ` · ${outcome.order_code}` : ""}`);

  if (outcome.opening && !(r.participants || []).length) {
    out.push(T(
      "Tell me who took what and I'll work out each share — e.g. \"Omar took the burger and cola, Ahmed took the pasta\".",
      "قوللي مين خد إيه وأنا أحسب نصيب كل واحد — مثلاً: «عمر خد البرجر والكولا، أحمد خد الباستا».",
      "2olly meen khad eh w ana a7seb naseeb kol wa7ed — masalan: \"Omar khad el burger wel cola, Ahmed khad el pasta\".",
    ));
  }

  for (const p of r.participants || []) {
    const lines = (p.lines || []).map((l) => `  • ${l.qty}× ${nameOf(l)}${l.shared ? ` (${T("shared", "مشترك", "shared")} ÷${l.sharedWith})` : ""} — ${money(fromP(l.amountP))}`);
    out.push([
      `*${p.name}*`,
      ...lines,
      `  ${T("Items", "الأصناف", "Items")}: ${money(p.items)}`,
      p.service ? `  ${T("Service", "الخدمة", "Service")}: ${money(p.service)}` : null,
      p.delivery ? `  ${T("Delivery", "التوصيل", "Delivery")}: ${money(p.delivery)}` : null,
      `  *${T("TOTAL", "الإجمالي", "TOTAL")}: ${money(p.total)}*${p.vat ? ` _(${T("incl. VAT", "شامل الضريبة", "incl. VAT")} ${money(p.vat)})_` : ""}`,
    ].filter(Boolean).join("\n"));
  }

  if ((r.unassigned || []).length) {
    out.push([
      `*${T("UNASSIGNED", "لسه متقسمش", "Msh met2asem")}*`,
      ...r.unassigned.map((u) => `  • ${u.qty}× ${nameOf(u)} — ${money(u.amount)}`),
      `  ${T("Total", "الإجمالي", "Total")}: ${money(r.unassignedTotal)}`,
    ].join("\n"));
    if ((r.participants || []).length) {
      out.push(T(
        `Say \"split the rest equally\" and I'll spread it over ${r.participants.length}.`,
        `قوللي «قسم الباقي عليهم» وأنا أوزعه على ${r.participants.length}.`,
        `2olly "2asem el ba2y 3alehom" w ana awaza3o 3ala ${r.participants.length}.`,
      ));
    }
  } else if ((r.participants || []).length) {
    out.push(T("Everything is assigned ✅", "كل حاجة اتقسمت ✅", "Kollo et2asem ✅"));
  }

  if (r.orderTotal != null) {
    out.push(`${T("Receipt total", "إجمالي الفاتورة", "Receipt total")}: ${money(r.orderTotal)}${r.reconciles ? "" : " ⚠️"}`);
  }

  if (outcome.clarify && (outcome.clarify_lines || []).length) {
    out.push(T(
      `Which one did you mean by "${outcome.clarify.said}"? ${outcome.clarify_lines.map((l) => `*${nameOf(l)}*`).join(" / ")}`,
      `تقصد أنهي واحد بـ«${outcome.clarify.said}»؟ ${outcome.clarify_lines.map((l) => `*${nameOf(l)}*`).join(" / ")}`,
      `Te2sod anhy be "${outcome.clarify.said}"? ${outcome.clarify_lines.map((l) => `*${nameOf(l)}*`).join(" / ")}`,
    ));
  }
  return out.join("\n\n");
}

export function renderBill({ items, bill, currency, orderType, tableNumber, branchName, address, payment, code, eta, trackUrl, restaurant, slug, when, branchPin, lang, arName }) {
  // The bill mirrors the guest's language (Arabic gets full Arabic labels; Franco
  // keeps the Latin/EN labels — transliterated accounting words read as noise).
  const AR = lang === "ar";
  const money = (n) => `${fmtAmount(n)} ${currency}`;
  const lines = items.map((it) => {
    const mods = modifiers(it).map((m) => (AR ? arWord(m) : m));
    const nm = AR && arName ? arName(it.name) : it.name;
    return `• ${it.qty}× *${nm}*${mods.length ? ` (${mods.join(" · ")})` : ""} — ${money(itemPrice(it) * Number(it.qty))}`;
  });

  const totals = [`${AR ? "الإجمالي الجزئي" : "Subtotal"}: ${money(bill.subtotal)}`];
  for (const x of bill.extras) {
    const lbl = AR ? String(x.label).replace(/^Delivery(\s*\(~([0-9.]+) km\))?$/, (m, _p, km) => (km ? `التوصيل (~${km} كم)` : "التوصيل")).replace(/^Service/, "الخدمة") : x.label;
    totals.push(`${lbl}: ${money(x.amount)}`);
  }
  // The CHAT bill shows what the guest pays, full stop — the Net/VAT breakdown
  // ("Net Amount: 192.98") read like a different price and confused people. The
  // accounting split still lives on the printed PDF receipt where it belongs.
  totals.push(`*${AR ? "الإجمالي المطلوب" : "Total Due"}: ${money(bill.total)}*`);
  if (bill.vat_inclusive) totals.push(AR ? "_الأسعار شاملة الضريبة._" : "_Prices are VAT inclusive._");

  const where = orderType === "dine_in" ? `${AR ? "في المطعم" : "Dine-in"}${tableNumber ? ` · ${AR ? "ترابيزة" : "table"} ${tableNumber}` : ""}${!tableNumber && branchName ? ` · ${branchName}` : ""}`
    : orderType === "pickup" ? `${AR ? "تيك أواي" : "Pickup"}${branchName ? ` · ${branchName}` : ""}${branchPin?.address ? `\n📍 ${branchPin.address}` : ""}${branchPin?.lat && branchPin?.lng ? `\n🗺 maps.google.com/?q=${branchPin.lat},${branchPin.lng}` : ""}`
    : `${AR ? "دليفري" : "Delivery"}${branchName ? ` · ${AR ? "من" : "from"} ${branchName}` : ""}`;

  const RULE = "―".repeat(24);
  // placed orders read like the paper receipt: header with the code and where/when,
  // items, totals, then payment + destination + ETA + the branded receipt link
  const header = code
    ? [`🧾 *${AR ? "إيصال" : "RECEIPT"} ${code}*`, restaurant ? `${restaurant}${branchName ? ` — ${branchName}` : ""}` : null, `${when || ""} · ${where}`.trim()]
    : [`🧾 *${AR ? "طلبك" : "YOUR ORDER"}*`];
  const footer = [
    payment ? `💳 ${payment === "cash" ? (AR ? "كاش" : "Cash") : payment === "card" ? (AR ? "كارت" : "Card") : (AR ? "انستاباي" : "InstaPay")}` : null,
    orderType === "delivery" && address ? `📍 ${address}` : null,
    code && eta ? `⏱ ${AR ? `حوالي ${eta} دقيقة` : `about ${eta} min`}` : null,
    code ? `📄 ${publicLink(`/receipt/${code}`, slug)}` : null,
    trackUrl ? `📍 ${AR ? "تابع طلبك لايف" : "Track live"}: ${trackUrl}` : null,
  ].filter(Boolean);
  return [
    ...header.filter(Boolean),
    RULE,
    lines.join("\n"),
    RULE,
    totals.join("\n"),
    RULE,
    ...( code ? footer : [where, ...footer] ),
  ].filter(Boolean).join("\n");
}
