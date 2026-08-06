// PDF receipt — styled like a classic thermal cash receipt: narrow paper, Courier,
// dashed rules, and the order number BIG enough to read across a counter.
// Generated in code, uploaded to tenant storage, sent on WhatsApp.
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { log } from "../config.js";

const BUCKET = "receipts";

// thermal paper: 80mm ≈ 227pt wide; height grows with the order
const W = 227;
const M = 16;
const INNER = W - M * 2;

import { fmtMoney as fmt } from "./format.js";
import { uploadPublicPdf } from "./storage.js";

function dashed(doc, gap = 0.5) {
  doc.moveDown(0.35);
  doc.moveTo(M, doc.y).lineTo(W - M, doc.y)
    .dash(2, { space: 2 }).strokeColor("#888").lineWidth(0.7).stroke().undash();
  doc.moveDown(gap);
}

// kitchen-readable option lines under each item (chosen drink, "no onion", bundle slots)
function modLines(it) {
  const out = [];
  for (const [k, v] of Object.entries(it.options || {})) {
    if (k === "slots" && Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const sl = v[i] || {};
        const vals = Object.entries(sl).filter(([f]) => f !== "notes").map(([, x]) => x).join(" + ");
        out.push(`${i + 1}) ${vals}${sl.notes ? ` — ${sl.notes}` : ""}`);
      }
    } else out.push(Array.isArray(v) ? v.join(", ") : String(v));
  }
  if (it.notes) out.push(`* ${it.notes}`);
  return out;
}

async function buildPdf({ restaurant, order, branch, currency }) {
  // rendered once, up front — pdfkit draws synchronously and can't await mid-stream
  const qrPng = order.track_url ? await QRCode.toBuffer(order.track_url, { margin: 0, width: 240 }).catch(() => null) : null;
  return new Promise((resolve, reject) => {
    const items = order.items || [];
    const modCount = items.reduce((s, it) => s + modLines(it).length, 0);
    const billRows = 2 + (order.bill?.extras?.length || 0);
    const height = 235 + items.length * 15 + modCount * 11 + billRows * 14
      + (order.address ? 26 : 0) + (order.notes ? 13 : 0) + (qrPng ? 90 : 0);
    const doc = new PDFDocument({ size: [W, Math.max(height, 330)], margin: M });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const center = (txt, opts = {}) => doc.text(txt, M, doc.y, { width: INNER, align: "center", ...opts });
    const row = (left, right, { bold = false, size = 9, color = "#000" } = {}) => {
      const y = doc.y;
      doc.font(bold ? "Courier-Bold" : "Courier").fontSize(size).fillColor(color);
      doc.text(left, M, y, { width: INNER - 74 });
      const after = doc.y;
      doc.text(right, W - M - 72, y, { width: 72, align: "right" });
      doc.y = Math.max(after, doc.y);
      doc.moveDown(0.15);
    };

    // header
    doc.font("Courier-Bold").fontSize(14).fillColor("#000");
    center(String(restaurant).toUpperCase(), { characterSpacing: 1 });
    doc.font("Courier").fontSize(8).fillColor("#333");
    if (branch?.name) center(branch.name);
    if (branch?.address) center(branch.address);
    center("* CASH RECEIPT *");
    dashed(doc);

    // THE order number — the thing you shout across the counter
    doc.font("Courier-Bold").fontSize(30).fillColor("#000");
    center(order.code);
    doc.font("Courier").fontSize(7).fillColor("#555");
    center("ORDER NUMBER");
    doc.moveDown(0.4);

    doc.fontSize(8).fillColor("#000");
    center(new Date(order.created_at || Date.now()).toLocaleString("en-GB", { hour12: true }));
    center(`${String(order.order_type || "").replace("_", "-").toUpperCase()}${order.table_number ? `  ·  TABLE ${order.table_number}` : ""}`);
    dashed(doc);

    // items: name left, amount right, mods indented beneath
    for (const it of items) {
      row(`${it.qty}x ${it.name}`, fmt(Number(it.unit_price ?? it.price) * Number(it.qty)), { size: 9.5 });
      for (const ml of modLines(it)) {
        doc.font("Courier").fontSize(7.5).fillColor("#555").text(ml, M + 10, doc.y, { width: INNER - 10 });
      }
      doc.fillColor("#000").moveDown(0.1);
    }
    dashed(doc);

    // subtotal + each configured charge, then the total — mirrors the WhatsApp bill exactly
    const bill = order.bill;
    if (bill?.extras?.length) {
      row("Subtotal", `${fmt(bill.subtotal)} ${currency}`, { size: 8.5, color: "#333" });
      for (const x of bill.extras) row(x.label, `${fmt(x.amount)} ${currency}`, { size: 8.5, color: "#333" });
      doc.moveDown(0.1);
    }
    row("TOTAL", `${fmt(order.total)} ${currency}`, { bold: true, size: 12 });
    dashed(doc);

    doc.font("Courier").fontSize(8).fillColor("#000");
    doc.text(`PAYMENT: ${paymentLabel(order.payment_method)}`, M, doc.y, { width: INNER });
    if (order.address) doc.text(`DELIVER TO: ${order.address}`, M, doc.y, { width: INNER });
    if (order.notes) doc.text(`NOTES: ${order.notes}`, M, doc.y, { width: INNER });
    doc.moveDown(0.8);
    // scan-to-track — only exists for a delivery order, since that is the only
    // case where there is anything to watch move
    if (qrPng) {
      doc.moveDown(0.15);
      const qs = 72;
      doc.image(qrPng, (W - qs) / 2, doc.y, { width: qs, height: qs });
      doc.y += qs + 4;
      doc.font("Courier").fontSize(7).fillColor("#555");
      center("SCAN TO TRACK YOUR ORDER");
      doc.moveDown(0.3);
    }
    doc.fontSize(8).fillColor("#444");
    center("THANK YOU — COME AGAIN!");
    doc.end();
  });
}

function paymentLabel(m) {
  return m === "cash" ? "CASH"
    : m === "card" ? "CARD"
    : m === "instapay" ? "INSTAPAY"
    : "TO BE CONFIRMED";
}

export async function makeReceipt(db, { restaurant, order, branch, currency }) {
  try {
    const buffer = await buildPdf({ restaurant, order, branch, currency });   // buildPdf is now async
    return await uploadPublicPdf(db, BUCKET, `${order.code}.pdf`, buffer);
  } catch (e) {
    log("receipt failed:", e.message);
    return null; // a missing PDF must never block an order
  }
}
