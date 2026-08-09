// Menu PDF — a real branded menu generated from the live menu: an embedded logo
// masthead, styled section headers, classic dotted-leader item rows, muted
// descriptions, a "popular" tag, and a footer. Cached in tenant storage and reused
// until the menu (or brand) changes. Guests get a document they can open and zoom
// instead of tapping through a WhatsApp list.
import PDFDocument from "pdfkit";
import crypto from "node:crypto";
import { log } from "../config.js";
import { uploadPublicPdf } from "./storage.js";

const BUCKET = "menus";
// bump when the layout changes so cached PDFs regenerate with the new look
const LAYOUT = 4;

// stable fingerprint of everything PRINTED — menu OR brand edits bust the cache
function menuHash(restaurant, menu, currency, accent, logoUrl, tagline) {
  const shape = menu.map((m) => [m.category, m.name, m.price, m.description || "", m.bestseller ? 1 : 0]);
  return crypto.createHash("sha1")
    .update(JSON.stringify([LAYOUT, restaurant, currency, accent, logoUrl || "", tagline || "", shape]))
    .digest("hex")
    .slice(0, 12);
}

// pdfkit's built-in fonts are WinAnsi only — anything outside it renders as a wrong
// glyph. Map the characters menus actually contain, then drop the rest.
const GLYPHS = [
  [/[‘’ʼ]/g, "'"], [/[“”]/g, '"'],
  [/[–—]/g, "-"], [/…/g, "..."],
  [/[•·‧]/g, "-"], [/×/g, "x"],
  [/[★☆⭐]/g, ""], [/ /g, " "],
];
function ascii(s) {
  let out = String(s ?? "");
  for (const [re, to] of GLYPHS) out = out.replace(re, to);
  return out.replace(/[^\x20-\x7E¡-ÿ]/g, "").replace(/\s{2,}/g, " ").trim();
}

// pdfkit embeds PNG/JPEG only — a WebP logo would throw mid-render, so sniff the
// bytes and skip (fall back to the name) if it isn't embeddable.
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

async function buildPdf({ restaurant, menu, currency, accent, tagline, phone, website, logoUrl }) {
  const logo = await fetchImage(logoUrl);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const LEFT = 48;
    const RIGHT = 547;              // A4 width 595 − margin
    const PRICE_W = 66;
    const NAME_MAX = RIGHT - LEFT - PRICE_W - 14;
    const INK = "#1a1a1a";
    const MUTED = "#8a8a8a";

    // truncate a name to a single line so the dotted leader always lands right
    const fit = (s, font, size, max) => {
      doc.font(font).fontSize(size);
      let t = ascii(s);
      if (doc.widthOfString(t) <= max) return t;
      while (t.length > 1 && doc.widthOfString(t + "…") > max) t = t.slice(0, -1);
      return t + "…";
    };

    // ---- masthead: logo (or name), tagline, accent rule ----
    if (logo) {
      const lw = 120;
      try {
        const { width: iw, height: ih } = doc.openImage(logo);
        const lh = Math.min(70, (ih / iw) * lw);
        doc.image(logo, (595 - lw) / 2, doc.y, { width: lw, height: lh });
        doc.y += lh + 8;
      } catch {
        doc.font("Helvetica-Bold").fontSize(28).fillColor(accent).text(ascii(restaurant).toUpperCase(), { align: "center" });
      }
    } else {
      doc.font("Helvetica-Bold").fontSize(28).fillColor(accent).text(ascii(restaurant).toUpperCase(), { align: "center", characterSpacing: 1 });
    }
    if (tagline) doc.moveDown(0.1).font("Helvetica-Oblique").fontSize(10.5).fillColor(MUTED).text(ascii(tagline), { align: "center" });
    doc.moveDown(0.7);
    doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor(accent).lineWidth(2.5).stroke();
    doc.moveDown(1);

    // "popular" only means something if it's a minority — some menus flag everything
    const flagged = menu.filter((m) => m.bestseller).length;
    const markBestsellers = flagged > 0 && flagged <= Math.ceil(menu.length * 0.4);

    const categories = [...new Set(menu.map((m) => m.category).filter(Boolean))];
    for (const cat of categories) {
      const items = menu.filter((m) => m.category === cat);
      if (!items.length) continue;

      // never orphan a heading at the bottom of a page
      if (doc.y > 690) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(13).fillColor(accent).text(ascii(cat).toUpperCase(), LEFT, doc.y, { characterSpacing: 1.5 });
      doc.moveDown(0.15);
      doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor(accent).opacity(0.3).lineWidth(0.8).stroke().opacity(1);
      doc.moveDown(0.5);

      for (const it of items) {
        if (doc.y > 772) doc.addPage();
        const y = doc.y;
        const popular = markBestsellers && it.bestseller;
        const name = fit(it.name, "Helvetica-Bold", 11.5, NAME_MAX - (popular ? 58 : 0));

        doc.font("Helvetica-Bold").fontSize(11.5).fillColor(INK).text(name, LEFT, y, { lineBreak: false });
        const nameW = doc.widthOfString(name);
        if (popular) {
          doc.font("Helvetica-Bold").fontSize(7).fillColor(accent).text("POPULAR", LEFT + nameW + 8, y + 2, { lineBreak: false, characterSpacing: 0.5 });
        }
        const priceStr = it.price != null ? `${it.price} ${currency}` : "";
        doc.font("Helvetica-Bold").fontSize(11.5).fillColor(INK).text(priceStr, RIGHT - PRICE_W, y, { width: PRICE_W, align: "right", lineBreak: false });

        // classic dotted leader between name and price, on the text baseline
        if (priceStr) {
          const leadStart = LEFT + nameW + (popular ? 56 : 0) + 10;
          const leadEnd = RIGHT - PRICE_W - doc.widthOfString(priceStr) - 8;
          if (leadEnd > leadStart) {
            doc.moveTo(leadStart, y + 9).lineTo(leadEnd, y + 9).dash(1, { space: 2.5 }).lineWidth(0.6).strokeColor("#cfcfcf").stroke().undash();
          }
        }
        doc.y = y + 15;
        if (it.description) {
          doc.font("Helvetica-Oblique").fontSize(8.8).fillColor(MUTED).text(ascii(it.description).slice(0, 160), LEFT, doc.y, { width: NAME_MAX });
        }
        doc.moveDown(0.5);
      }
      doc.moveDown(0.6);
    }

    // ---- footer ----
    const parts = [phone, website].filter(Boolean).map(ascii);
    if (doc.y > 740) doc.addPage();
    doc.moveDown(0.5);
    doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor("#e5e5e5").lineWidth(1).stroke();
    doc.moveDown(0.5);
    if (parts.length) doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(parts.join("   ·   "), { align: "center" });
    doc.moveDown(0.2).font("Helvetica").fontSize(8).fillColor("#aaa").text("Prices are VAT inclusive.", { align: "center" });
    doc.end();
  });
}

// process-lifetime {storagePath → publicUrl} — a hit costs zero I/O
const urlCache = new Map();

// Returns { url, filename } or null — a missing PDF must never block a reply.
export async function menuPdfUrl(db, { restaurant, menu, currency = "EGP", accent = "#111111", tagline, phone, website, logoUrl }) {
  try {
    if (!menu?.length) return null;
    const hash = menuHash(restaurant, menu, currency, accent, logoUrl, tagline);
    const safe = String(restaurant).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "menu";
    const path = `${safe}-${hash}.pdf`;
    const filename = `${safe}-menu.pdf`;

    if (urlCache.get(path)) return { url: urlCache.get(path), filename };
    const { data: found } = await db.storage.from(BUCKET).list("", { search: path });
    if (found?.some((f) => f.name === path)) {
      const { data } = db.storage.from(BUCKET).getPublicUrl(path);
      if (data?.publicUrl) { urlCache.set(path, data.publicUrl); return { url: data.publicUrl, filename }; }
    }

    const buffer = await buildPdf({ restaurant, menu, currency, accent, tagline, phone, website, logoUrl });
    const url = await uploadPublicPdf(db, BUCKET, path, buffer, { cacheControl: "31536000" });
    if (url) { urlCache.set(path, url); return { url, filename }; }
    return null;
  } catch (e) {
    log("menu pdf failed:", e.message);
    return null;
  }
}
