// Munadim QR set: 5 brand styles × 2 destinations (WhatsApp, site), SVG + logo plate.
// Output → branding/qr/ (local, untracked). Render PNGs + verify with zbarimg after.
//   node tools/make-qr.mjs
import QRCode from "qrcode";
import fs from "node:fs";
const OUT = "/Users/adel/Desktop/Ai Squared/ai2-resto/branding/qr";
const TARGETS = {
  // no prefilled text: the Arabic prefill tripled the link length and made the code
  // too dense to scan reliably at small print sizes. The guest's first message
  // opens the conversation just as well.
  whatsapp: "https://wa.me/201515066123",
  site: "https://munadim.com",
};
const C = { ink: "#141110", semna: "#F5EFE7", karkadeh: "#8C1D2F", brassDeep: "#8A601E", brassLight: "#D9A94E" };
// the brand mark (branding/03), stroke colour parameterised
const mark = (col) => `<circle cx="100" cy="100" r="76" fill="none" stroke="${col}" stroke-width="7"/><g fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round"><path d="M 58 138 V 100 A 42 42 0 0 1 142 100 V 118 A 21 21 0 0 1 100 118"/></g><circle cx="100" cy="100" r="11" fill="${col}"/>`;

function matrix(text) {
  const q = QRCode.create(text, { errorCorrectionLevel: "H" });
  const n = q.modules.size;
  return { n, on: (r, c) => !!q.modules.get(r, c) };
}
const isEye = (n, r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

// one QR as SVG. style: square | dots | rounded
function qrSvg(text, { style, fg, bg, eye, markCol, plate, frame, frameCol, quiet = 4 }) {
  const { n, on } = matrix(text);
  const S = 10;                           // px per module in the viewBox
  const side = (n + quiet * 2) * S;
  const o = quiet * S;
  // centre plate: clear modules under the logo (~22% of the code width — fine at EC-H)
  const pr = Math.round(n * 0.22 / 2 * S);
  const cx = o + (n * S) / 2, cy = cx;
  const underPlate = (r, c) => { const x = o + c * S + S / 2, y = o + r * S + S / 2; return Math.hypot(x - cx, y - cy) < pr + S * 0.8; };
  let body = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!on(r, c) || isEye(n, r, c) || underPlate(r, c)) continue;
    const x = o + c * S, y = o + r * S;
    if (style === "dots") body += `<circle cx="${x + S / 2}" cy="${y + S / 2}" r="${S * 0.43}"/>`;
    else if (style === "rounded") body += `<rect x="${x + 0.6}" y="${y + 0.6}" width="${S - 1.2}" height="${S - 1.2}" rx="${S * 0.32}"/>`;
    else body += `<rect x="${x}" y="${y}" width="${S + 0.02}" height="${S + 0.02}"/>`;
  }
  // finder eyes, styled per variant
  const eyes = [[0, 0], [0, n - 7], [n - 7, 0]].map(([r, c]) => {
    const x = o + c * S, y = o + r * S, e = 7 * S;
    const rOut = style === "square" ? 0 : style === "dots" ? e * 0.5 : e * 0.28;
    const rIn = style === "square" ? 0 : style === "dots" ? e * 0.5 : e * 0.22;
    return `<rect x="${x + S / 2}" y="${y + S / 2}" width="${e - S}" height="${e - S}" rx="${rOut}" fill="none" stroke="${eye}" stroke-width="${S}"/>`
      + `<rect x="${x + 2 * S}" y="${y + 2 * S}" width="${3 * S}" height="${3 * S}" rx="${rIn === 0 ? 0 : 3 * S * (style === "dots" ? 0.5 : 0.3)}" fill="${eye}"/>`;
  }).join("");
  const plateR = pr;
  const logo = `<circle cx="${cx}" cy="${cy}" r="${plateR}" fill="${plate}"/>`
    + `<g transform="translate(${cx - plateR * 0.94},${cy - plateR * 0.94}) scale(${(plateR * 1.88) / 200})">${mark(markCol)}</g>`;
  const pad = frame ? S * 3 : 0;
  const total = side + pad * 2;
  const frameRect = frame
    ? `<rect x="0" y="0" width="${total}" height="${total}" rx="${S * 6}" fill="${frameCol}"/><rect x="${pad}" y="${pad}" width="${side}" height="${side}" rx="${S * 3}" fill="${bg}"/>`
    : `<rect x="0" y="0" width="${total}" height="${total}" rx="${S * 3}" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}">${frameRect}`
    + `<g transform="translate(${pad},${pad})"><g fill="${fg}">${body}</g>${eyes}${logo}</g></svg>`;
}

const VARIANTS = {
  "1-karkadeh-classic": { style: "square", fg: C.karkadeh, bg: C.semna, eye: C.karkadeh, markCol: C.karkadeh, plate: C.semna },
  "2-ink-minimal":      { style: "square", fg: C.ink, bg: "#FFFFFF", eye: C.ink, markCol: C.karkadeh, plate: "#FFFFFF" },
  "3-karkadeh-dots":    { style: "dots", fg: C.karkadeh, bg: C.semna, eye: C.ink, markCol: C.karkadeh, plate: C.semna },
  "4-brass-rounded":    { style: "rounded", fg: C.brassDeep, bg: C.semna, eye: C.karkadeh, markCol: C.brassDeep, plate: C.semna },
  "5-ink-frame":        { style: "rounded", fg: C.ink, bg: C.semna, eye: C.ink, markCol: C.brassDeep, plate: C.semna, frame: true, frameCol: C.ink },
};
const html = [];
for (const [t, url] of Object.entries(TARGETS)) for (const [v, opt] of Object.entries(VARIANTS)) {
  const f = `munadim-qr-${t}-${v}`;
  fs.writeFileSync(`${OUT}/${f}.svg`, qrSvg(url, opt));
  html.push(f);
}
fs.writeFileSync(`${OUT}/_files.txt`, html.join("\n"));
console.log("svgs:", html.length);
