// PDF receipt — modelled on the restaurant's real 80mm thermal check: centered logo,
// tagline, branch address, cashier, a CHK/TBL line, the order under a TYPE header,
// a transaction block (Subtotal / Payment / Change / tender), the "Check Closed"
// divider, the Net/VAT/Total tax breakdown, a thank-you + hotline, and a QR.
// Everything is dynamic — nothing about "Luci'z" is hardcoded; a different restaurant's
// logo, tagline, branches, currency and VAT rate all flow in from config.
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { log } from "../config.js";
import { fmtMoney as fmt } from "./format.js";
import { uploadPublicPdf } from "./storage.js";

const BUCKET = "receipts";

// 80mm thermal ≈ 227pt wide; height grows with the order
const W = 227;
const M = 16;
const INNER = W - M * 2;

// "8 Aug' 26" — the receipt's short date style
const shortDate = (d) => {
  const dt = new Date(d);
  const mon = dt.toLocaleString("en-GB", { month: "short" });
  return `${dt.getDate()} ${mon}' ${String(dt.getFullYear()).slice(2)}`;
};
const shortDateTime = (d) => {
  const dt = new Date(d);
  return `${shortDate(dt)} ${dt.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
};

// One item's chosen options + notes, as plain lines under it (the drink in a combo,
// "no onion", each slot of a bundle) — customer-readable, not the KDS shorthand.
function subLines(it) {
  const out = [];
  for (const [k, v] of Object.entries(it.options || {})) {
    if (k === "slots" && Array.isArray(v)) {
      for (const sl of v) {
        const vals = Object.entries(sl).filter(([f]) => f !== "notes").map(([, x]) => x).join(" + ");
        if (vals) out.push(vals);
        if (sl.notes) out.push(sl.notes);
      }
    } else if (v) out.push(Array.isArray(v) ? v.join(", ") : String(v));
  }
  if (it.notes) out.push(it.notes);
  return out;
}

// pdfkit embeds PNG and JPEG only — a WebP logo (some brands) would throw mid-render,
// so we sniff the bytes and fall back to the name if it isn't embeddable.
async function fetchImage(url) {
  if (!/^https?:\/\//i.test(String(url || ""))) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    return isPng || isJpg ? buf : null;
  } catch {
    return null;
  }
}

async function buildPdf({ restaurant, order, branch, currency, brand = {}, tagline = "", hotline = "", vatRate = 0.14 }) {
  // everything async is resolved up front — pdfkit draws synchronously
  const [qrPng, logoPng] = await Promise.all([
    (order.scan_url || order.track_url) ? QRCode.toBuffer(order.scan_url || order.track_url, { margin: 0, width: 300 }).catch(() => null) : Promise.resolve(null),
    fetchImage(brand.logo_url),
  ]);

  return new Promise((resolve, reject) => {
    const items = order.items || [];
    const subCount = items.reduce((s, it) => s + subLines(it).length, 0);
    const cur = currency || "EGP";

    // ---- money, derived from the ONE source of truth: order.total ----
    // Total is what the customer pays. VAT is the real tax line if the bill added one,
    // otherwise the inclusive portion of the total (prices already include VAT — which
    // is how the printed receipt reads). Net = Total − VAT. This reconciles to the
    // photo exactly: 370 → Net 324.56 + VAT 45.44 at 14%.
    const total = Number(order.total) || 0;
    const itemsSum = items.reduce((s, it) => s + Number(it.unit_price ?? it.price ?? 0) * Number(it.qty || 1), 0);
    const nonVatExtras = (order.bill?.extras || []).filter((x) => !/vat|tax/i.test(x.label || ""));
    const vatAmount = Number(order.bill?.tax) > 0
      ? Number(order.bill.tax)
      : Math.round((total - total / (1 + vatRate)) * 100) / 100;
    const netAmount = Math.round((total - vatAmount) * 100) / 100;

    const height = 300
      + (logoPng ? 54 : 20) + (tagline ? 12 : 0)
      + items.length * 15 + subCount * 11
      + nonVatExtras.length * 13
      + (order.address ? 26 : 0)
      + (qrPng ? 96 : 0) + (hotline ? 12 : 0);
    const doc = new PDFDocument({ size: [W, Math.max(height, 360)], margin: M });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const center = (txt, opts = {}) => doc.text(txt, M, doc.y, { width: INNER, align: "center", ...opts });
    // a label-left / amount-right line, amount two-decimal with a currency suffix
    const money = (label, amount, { bold = false, size = 9, indent = 0, suffix = cur, color = "#000" } = {}) => {
      const y = doc.y;
      doc.font(bold ? "Courier-Bold" : "Courier").fontSize(size).fillColor(color);
      doc.text(label, M + indent, y, { width: INNER - 80 - indent });
      const after = doc.y;
      doc.text(`${fmt(amount)}${suffix}`, W - M - 84, y, { width: 84, align: "right" });
      doc.y = Math.max(after, doc.y);
      doc.moveDown(0.12);
    };
    const solid = (col = "#000", w = 0.8) => {
      doc.moveDown(0.3);
      doc.moveTo(M, doc.y).lineTo(W - M, doc.y).lineWidth(w).strokeColor(col).stroke();
      doc.moveDown(0.4);
    };
    const dashed = () => {
      doc.moveDown(0.3);
      doc.moveTo(M, doc.y).lineTo(W - M, doc.y).dash(2, { space: 2 }).lineWidth(0.7).strokeColor("#555").stroke().undash();
      doc.moveDown(0.4);
    };
    // "--------- Check Closed ---------" — text centered over a dashed rule
    const labelledRule = (text) => {
      doc.moveDown(0.4);
      doc.font("Courier").fontSize(8).fillColor("#555");
      const half = "-".repeat(9);
      center(`${half} ${text} ${half}`);
      doc.moveDown(0.3);
    };

    // ---- header: logo (or name), tagline, address, cashier ----
    if (logoPng) {
      const lw = 108;
      try {
        const { width: iw, height: ih } = doc.openImage(logoPng);
        const lh = Math.min(46, (ih / iw) * lw);
        doc.image(logoPng, (W - lw) / 2, doc.y, { width: lw, height: lh });
        doc.y += lh + 4;
      } catch {
        doc.font("Courier-Bold").fontSize(16).fillColor("#000"); center(String(restaurant).toUpperCase());
      }
    } else {
      doc.font("Courier-Bold").fontSize(16).fillColor("#000"); center(String(restaurant).toUpperCase(), { characterSpacing: 1 });
    }
    if (tagline) { doc.font("Courier-Oblique").fontSize(8.5).fillColor("#555"); center(tagline); }
    doc.moveDown(0.5);

    doc.font("Courier").fontSize(8).fillColor("#222");
    // The address line already identifies the branch (like the printed receipt), so
    // show it alone. Only prepend the branch name when it isn't already in the address,
    // and fall back to the name when there's no address at all.
    const addr = branch?.address || order.branch_address;
    const bn = branch?.name;
    if (addr) center(bn && !addr.toLowerCase().includes(bn.toLowerCase()) ? `${bn} — ${addr}` : addr);
    else if (bn) center(bn);
    if (order.cashier) { doc.moveDown(0.25); doc.text(String(order.cashier), M, doc.y, { width: INNER }); }
    dashed();

    // ---- CHK + TBL, date ----
    const y0 = doc.y;
    doc.font("Courier-Bold").fontSize(11).fillColor("#000");
    doc.text(`CHK ${order.code}`, M, y0, { width: INNER / 2 });
    if (order.table_number) doc.text(`TBL ${order.table_number}`, W - M - 90, y0, { width: 90, align: "right" });
    doc.moveDown(0.1);
    doc.font("Courier").fontSize(8).fillColor("#333"); center(shortDate(order.created_at || Date.now()));
    dashed();

    // ---- order type + items ----
    doc.font("Courier-Bold").fontSize(11).fillColor("#000");
    center(String(order.order_type || "").replace(/_/g, " ").toUpperCase() || "ORDER");
    doc.moveDown(0.3);
    for (const it of items) {
      const y = doc.y;
      doc.font("Courier").fontSize(9).fillColor("#000");
      doc.text(`${it.qty || 1} ${it.name}`, M, y, { width: INNER - 66 });
      const after = doc.y;
      doc.text(fmt(Number(it.unit_price ?? it.price ?? 0) * Number(it.qty || 1)), W - M - 66, y, { width: 66, align: "right" });
      doc.y = Math.max(after, doc.y);
      for (const sl of subLines(it)) {
        doc.font("Courier").fontSize(7.5).fillColor("#666").text(sl, M + 10, doc.y, { width: INNER - 12 });
      }
      doc.fillColor("#000").moveDown(0.15);
    }
    doc.moveDown(0.2);

    // ---- transaction block ----
    money("Subtotal", itemsSum, { indent: 8, color: "#222" });
    for (const x of nonVatExtras) money(x.label, x.amount, { indent: 8, color: "#222" });
    money("Payment", total, { bold: true, size: 10 });
    money("Change Due", 0, { bold: true, size: 10 });
    money(paymentLabel(order.payment_method), total, { indent: 8, color: "#222" });

    // ---- close + tax breakdown ----
    labelledRule("Check Closed");
    center(shortDateTime(order.created_at || Date.now()));
    doc.moveDown(0.5);
    doc.font("Courier").fontSize(8.5).fillColor("#000");
    const taxRow = (label, amount) => {
      const y = doc.y;
      doc.text(`${label}`, M, y, { width: 90 });
      doc.text(":", M + 78, y, { width: 8 });
      doc.text(`${fmt(amount)}${cur}`, W - M - 90, y, { width: 90, align: "right" });
      doc.moveDown(0.2);
    };
    taxRow("Net Amount", netAmount);
    taxRow("VAT Amount", vatAmount);
    taxRow("Total Due", total);
    solid();

    // ---- footer ----
    doc.font("Courier").fontSize(8).fillColor("#333");
    center("Prices are VAT inclusive.");
    doc.moveDown(0.5);
    doc.fillColor("#000");
    center(`Thanks for choosing ${restaurant}`);
    center("See you on your next craving!");
    if (hotline) center(`Hotline ${hotline}`);
    if (order.address) { doc.moveDown(0.4); doc.fontSize(7.5).fillColor("#555"); center(`Deliver to: ${order.address}`); }
    doc.moveDown(0.4);

    // decorative divider, then the QR
    doc.font("Courier").fontSize(8).fillColor("#999");
    center("=-".repeat(14));
    if (qrPng) {
      doc.moveDown(0.5);
      const qs = 84;
      doc.image(qrPng, (W - qs) / 2, doc.y, { width: qs, height: qs });
      doc.y += qs + 4;
      doc.fontSize(7).fillColor("#666");
      center(order.track_url ? "Scan to track your order" : "Scan to view your order");
    }
    doc.end();
  });
}

function paymentLabel(m) {
  return m === "cash" ? "Cash"
    : m === "card" ? "Visa"
    : m === "instapay" ? "InstaPay"
    : m === "online" ? "Online" : "Card";
}

export async function makeReceipt(db, opts) {
  try {
    const buffer = await buildPdf(opts);
    return await uploadPublicPdf(db, BUCKET, `${opts.order.code}.pdf`, buffer);
  } catch (e) {
    log("receipt failed:", e.message);
    return null; // a missing PDF must never block an order
  }
}
