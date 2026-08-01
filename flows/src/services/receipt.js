// PDF receipt — generated in code, uploaded to tenant storage, sent on WhatsApp.
import PDFDocument from "pdfkit";
import { log } from "../config.js";

const BUCKET = "receipts";

function buildPdf({ restaurant, order, branch, currency }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A5", margin: 36 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text(restaurant, { align: "center" });
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor("#666").text(`Receipt ${order.code}`, { align: "center" });
    if (branch?.name) doc.text(`${branch.name}${branch.address ? ` — ${branch.address}` : ""}`, { align: "center" });
    doc.moveDown(0.8).fillColor("#000");

    doc.fontSize(9).fillColor("#666")
      .text(new Date(order.created_at || Date.now()).toLocaleString("en-GB", { hour12: true }))
      .text(`${String(order.order_type || "").replace("_", "-")}${order.table_number ? ` · table ${order.table_number}` : ""}`);
    if (order.address) doc.text(`Deliver to: ${order.address}`, { width: 320 });
    doc.moveDown(0.6).fillColor("#000");

    doc.moveTo(36, doc.y).lineTo(384, doc.y).strokeColor("#ddd").stroke();
    doc.moveDown(0.5);
    for (const it of order.items || []) {
      const line = `${it.qty}× ${it.name}`;
      const amount = `${Number(it.unit_price ?? it.price) * Number(it.qty)} ${currency}`;
      const y = doc.y;
      doc.fontSize(11).fillColor("#000").text(line, 36, y, { width: 250 });
      doc.text(amount, 286, y, { width: 98, align: "right" });
      // the kitchen reads this line too — chosen drink and "no onion" belong on it
      const mods = [
        ...Object.entries(it.options || {}).flatMap(([k, v]) =>
          k === "slots" && Array.isArray(v)
            ? v.map((sl, i) => `${i + 1}) ${Object.entries(sl || {}).filter(([f]) => f !== "notes").map(([, x]) => x).join(" + ")}${sl?.notes ? ` — ${sl.notes}` : ""}`)
            : [Array.isArray(v) ? v.join(", ") : v]),
        it.notes || null,
      ].filter(Boolean);
      if (mods.length) doc.fontSize(9).fillColor("#777").text(mods.join(" · "), 46, doc.y, { width: 240 });
      doc.fillColor("#000").moveDown(0.2);
    }
    doc.moveDown(0.3);
    doc.moveTo(36, doc.y).lineTo(384, doc.y).strokeColor("#ddd").stroke();
    doc.moveDown(0.5);

    // subtotal + each configured charge, then the total — mirrors the WhatsApp bill exactly
    const money = (n) => `${Number(n)} ${currency}`;
    const bill = order.bill;
    if (bill?.extras?.length) {
      const rowLine = (label, amount, size = 10, color = "#444") => {
        const y = doc.y;
        doc.fontSize(size).fillColor(color).text(label, 36, y, { width: 250 });
        doc.fontSize(size).fillColor(color).text(amount, 286, y, { width: 98, align: "right" });
        doc.moveDown(0.25);
      };
      rowLine("Subtotal", money(bill.subtotal));
      for (const x of bill.extras) rowLine(x.label, money(x.amount));
      doc.moveDown(0.15);
    }
    const totalY = doc.y;
    doc.fontSize(13).fillColor("#000").text("TOTAL", 36, totalY);
    doc.fontSize(13).text(money(order.total), 286, totalY, { width: 98, align: "right" });
    doc.moveDown(0.8);

    doc.fontSize(10).fillColor("#666")
      .text(`Payment: ${paymentLabel(order.payment_method)}`)
      .text(order.notes ? `Notes: ${order.notes}` : "");
    doc.moveDown(1).fontSize(9).fillColor("#999").text("Thanks for ordering 🍔", { align: "center" });
    doc.end();
  });
}

function paymentLabel(m) {
  return m === "cash" ? "Cash on delivery / at the counter"
    : m === "card" ? "Card"
    : m === "instapay" ? "InstaPay"
    : "To be confirmed";
}

export async function makeReceipt(db, { restaurant, order, branch, currency }) {
  try {
    const buffer = await buildPdf({ restaurant, order, branch, currency });
    const path = `${order.code}.pdf`;
    let { error } = await db.storage.from(BUCKET).upload(path, buffer, { contentType: "application/pdf", upsert: true });
    if (error) {
      await db.storage.createBucket(BUCKET, { public: true }).catch(() => {});
      ({ error } = await db.storage.from(BUCKET).upload(path, buffer, { contentType: "application/pdf", upsert: true }));
      if (error) throw new Error(error.message);
    }
    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (e) {
    log("receipt failed:", e.message);
    return null; // a missing PDF must never block an order
  }
}
