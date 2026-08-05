import { money } from "./format";

// modifiers in the order a cook thinks: format → size → fries → drink → the rest
const KEY_ORDER = ["format", "size", "side", "drink"];
export function modLines(i: any): string[] {
  const entries = Object.entries(i.options || {}).filter(([k]) => k !== "slots");
  entries.sort(([a], [b]) => {
    const ia = KEY_ORDER.indexOf(a), ib = KEY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const out = entries.map(([, v]) => (Array.isArray(v) ? v.join(", ") : String(v)));
  const slots = (i.options || {}).slots;
  if (Array.isArray(slots)) {
    slots.forEach((sl: any, si: number) => {
      const vals = Object.entries(sl || {}).filter(([f]) => f !== "notes").map(([, x]) => x).join(" + ");
      out.push(`${si + 1}) ${vals}${sl?.notes ? ` — ${sl.notes}` : ""}`);
    });
  }
  if (i.notes) out.push(`* ${i.notes}`);
  return out;
}

// ONE thermal ticket template for every screen that prints.
// Prints via a hidden iframe — no popup tab. With the counter PC's Chrome
// started with --kiosk-printing the dialog is skipped entirely (true silent
// print to the default thermal printer); otherwise the dialog appears once.
export function printTicket(o: any, opts: { typeLabel?: string; branchName?: string; waNumber?: string } = {}) {
  const rows = (o.items || []).map((i: any) =>
    `<div class="r"><b>${i.qty}x ${i.name}</b><span>${money(Number(i.unit_price ?? i.price) * Number(i.qty))}</span></div>` +
    modLines(i).map((m) => `<div class="m">&raquo; ${m}</div>`).join("")
  ).join("");
  const typeLabel = opts.typeLabel || String(o.order_type || "").replace("_", "-").toUpperCase();
  const wa = String(opts.waNumber || "").replace(/[^\d]/g, "");
  const waLink = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(`Order ${o.code}`)}` : null;
  const html = `<html><head><title>${o.code}</title><style>
    body{font-family:ui-monospace,Menlo,monospace;width:280px;margin:8px auto;color:#000}
    .c{text-align:center}.big{font-size:30px;font-weight:800;letter-spacing:3px}
    .r{display:flex;justify-content:space-between;margin:2px 0}.m{color:#444;font-size:11px;padding-left:12px}
    .track{margin-top:8px;text-align:center;font-size:11px}
    hr{border:none;border-top:1px dashed #888;margin:6px 0}
  </style></head><body>
    <div class="c"><b>${typeLabel}${o.table_number ? " · T" + o.table_number : ""}</b></div>
    <div class="c big">${o.code}</div>
    <div class="c">${o.diner_name || o.phone_number || "guest"}${opts.branchName ? " · " + opts.branchName : ""}</div>
    <hr>${rows}<hr>
    <div class="r"><b>TOTAL</b><b>EGP ${money(o.total)}</b></div>
    ${o.discount ? `<div class="r"><span>DISCOUNT${o.discount_reason ? ` (${o.discount_reason})` : ""}</span><span>-EGP ${money(o.discount)}</span></div>` : ""}
    ${o.payment_method ? `<div>PAYMENT: ${String(o.payment_method).toUpperCase()}</div>` : ""}
    ${o.address ? `<div>DELIVER TO: ${o.address}</div>` : ""}
    ${o.notes ? `<div>!! ${o.notes}</div>` : ""}
    ${waLink ? `<div class="track"><hr>TRACK YOUR ORDER ON WHATSAPP<br>${wa}<br>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(waLink)}" width="110" height="110" style="margin-top:4px"></div>` : ""}
  </body></html>`;

  // hidden iframe: render, wait for the QR image, print, remove
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();
  const fire = () => {
    try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } catch { /* ignore */ }
    setTimeout(() => frame.remove(), 4000);
  };
  // give the QR image a beat to load; kiosk-printing makes the rest silent
  setTimeout(fire, waLink ? 700 : 150);
}
