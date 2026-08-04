// Menu PDF — generated from the live menu, branded per restaurant, cached in tenant
// storage and re-used until the menu changes. Guests get a real document they can
// open, zoom and scroll instead of tapping through a WhatsApp list.
import PDFDocument from "pdfkit";
import crypto from "node:crypto";
import { log } from "../config.js";
import { uploadPublicPdf } from "./storage.js";

const BUCKET = "menus";
// bump when the layout or text handling changes, or cached PDFs keep the old look
const LAYOUT = 3;

// stable fingerprint of what's actually printed — menu edits bust the cache, nothing else does
function menuHash(restaurant, menu, currency, accent) {
  const shape = menu.map((m) => [m.category, m.name, m.price, m.description || "", m.bestseller ? 1 : 0]);
  return crypto.createHash("sha1")
    .update(JSON.stringify([LAYOUT, restaurant, currency, accent, shape]))
    .digest("hex")
    .slice(0, 12);
}

// pdfkit's built-in fonts are WinAnsi only — anything outside it renders as a
// wrong glyph ("★" came out as "&"). Map the characters menus actually contain,
// then drop the rest rather than printing junk on a guest-facing document.
const GLYPHS = [
  [/[‘’ʼ]/g, "'"], [/[“”]/g, '"'],
  [/[–—]/g, "-"], [/…/g, "..."],
  [/[•·‧]/g, "-"], [/×/g, "x"],
  [/[★☆⭐]/g, ""], [/ /g, " "],
];
function ascii(s) {
  let out = String(s ?? "");
  for (const [re, to] of GLYPHS) out = out.replace(re, to);
  // strip emoji and anything else the base fonts can't draw
  return out.replace(/[^\x20-\x7E¡-ÿ]/g, "").replace(/\s{2,}/g, " ").trim();
}

function buildPdf({ restaurant, menu, currency, accent, tagline, phone, website }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const LEFT = 48;
    const RIGHT = 547; // A4 width 595 - margin
    const PRICE_W = 70;

    doc.fontSize(26).fillColor(accent).text(ascii(restaurant).toUpperCase(), { align: "center" });
    if (tagline) doc.moveDown(0.15).fontSize(10).fillColor("#777").text(ascii(tagline), { align: "center" });
    doc.moveDown(0.6);
    doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor(accent).lineWidth(2).stroke();
    doc.moveDown(0.9);

    // "popular" only means something if it's a minority — some menus flag everything
    const flagged = menu.filter((m) => m.bestseller).length;
    const markBestsellers = flagged > 0 && flagged <= Math.ceil(menu.length * 0.4);

    const categories = [...new Set(menu.map((m) => m.category).filter(Boolean))];
    for (const cat of categories) {
      const items = menu.filter((m) => m.category === cat);
      if (!items.length) continue;

      // keep a heading with at least one item — never orphan it at the page break
      if (doc.y > 700) doc.addPage();
      doc.fontSize(14).fillColor(accent).text(ascii(cat).toUpperCase());
      doc.moveDown(0.35);

      for (const it of items) {
        if (doc.y > 770) doc.addPage();
        const y = doc.y;
        const name = `${ascii(it.name)}${markBestsellers && it.bestseller ? "  (popular)" : ""}`;
        doc.fontSize(11).fillColor("#111").text(name, LEFT, y, { width: RIGHT - LEFT - PRICE_W - 10 });
        doc.fontSize(11).fillColor("#111")
          .text(it.price != null ? `${it.price} ${currency}` : "", RIGHT - PRICE_W, y, { width: PRICE_W, align: "right" });
        if (it.description) {
          doc.fontSize(9).fillColor("#888")
            .text(ascii(it.description).slice(0, 160), LEFT, doc.y, { width: RIGHT - LEFT - PRICE_W - 10 });
        }
        doc.moveDown(0.45);
      }
      doc.moveDown(0.5);
    }

    const footer = [phone, website].filter(Boolean).join("   ·   ");
    if (footer) {
      if (doc.y > 750) doc.addPage();
      doc.moveDown(0.5);
      doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor("#e5e5e5").lineWidth(1).stroke();
      doc.moveDown(0.4).fontSize(9).fillColor("#999").text(ascii(footer), { align: "center" });
    }
    doc.end();
  });
}

// process-lifetime {storagePath → publicUrl} — a hit costs zero I/O
const urlCache = new Map();

// Returns { url, filename } or null — a missing PDF must never block a reply.
export async function menuPdfUrl(db, { restaurant, menu, currency = "EGP", accent = "#111111", tagline, phone, website }) {
  try {
    if (!menu?.length) return null;
    const hash = menuHash(restaurant, menu, currency, accent);
    const safe = String(restaurant).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "menu";
    const path = `${safe}-${hash}.pdf`;
    const filename = `${safe}-menu.pdf`;

    // hot path: same menu hash → same URL, zero I/O (process-lifetime cache)
    if (urlCache.get(path)) return { url: urlCache.get(path), filename };
    // already generated for this exact menu? reuse it — no pdfkit, no upload
    const { data: found } = await db.storage.from(BUCKET).list("", { search: path });
    if (found?.some((f) => f.name === path)) {
      const { data } = db.storage.from(BUCKET).getPublicUrl(path);
      if (data?.publicUrl) { urlCache.set(path, data.publicUrl); return { url: data.publicUrl, filename }; }
    }

    const buffer = await buildPdf({ restaurant, menu, currency, accent, tagline, phone, website });
    const url = await uploadPublicPdf(db, BUCKET, path, buffer, { cacheControl: "31536000" });
    if (url) { urlCache.set(path, url); return { url, filename }; }
    return null;
  } catch (e) {
    log("menu pdf failed:", e.message);
    return null;
  }
}
