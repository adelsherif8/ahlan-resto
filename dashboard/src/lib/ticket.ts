import { money } from "./format";

// modifiers in the order a cook thinks: format → size → fries → drink → the rest
const KEY_ORDER = ["format", "size", "side", "drink"];

// an option value can be a string, an array, or (from POS / older orders) an object
// like {name, price} — never render that as "[object Object]". Pull a human label.
export function optVal(v: any): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(optVal).filter(Boolean).join(", ");
  if (typeof v === "object") return String(v.label ?? v.name ?? v.value ?? "").trim();
  return String(v).trim();
}

// "just the sandwich" / "sandwich only" is the default, not a modification — a plain
// sandwich needs no annotation. Only a MEAL earns extra lines (its fries + drink).
const SANDWICH_ONLY = /^(sandwich[\s-]*only|just[\s-]*(a|the)?[\s-]*sandwich|no[\s-]*meal|بس|ساندوتش بس|لوحده)$/i;

export function modLines(i: any): string[] {
  const entries = Object.entries(i.options || {}).filter(([k]) => k !== "slots");
  entries.sort(([a], [b]) => {
    const ia = KEY_ORDER.indexOf(a), ib = KEY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const out: string[] = [];
  for (const [, v] of entries) {
    const s = optVal(v);
    if (!s || SANDWICH_ONLY.test(s)) continue; // drop empties + the sandwich-only default
    out.push(s);
  }
  const slots = (i.options || {}).slots;
  if (Array.isArray(slots)) {
    slots.forEach((sl: any, si: number) => {
      const vals = Object.entries(sl || {}).filter(([f]) => f !== "notes").map(([, x]) => optVal(x)).filter(Boolean).join(" + ");
      if (vals || sl?.notes) out.push(`${si + 1}) ${vals}${sl?.notes ? ` — ${sl.notes}` : ""}`);
    });
  }
  if (i.notes && !SANDWICH_ONLY.test(String(i.notes).trim())) out.push(`* ${i.notes}`);
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
    ${o.payment_method ? `<div><b>${String(o.payment_method) === "cash" ? `PAYMENT: CASH — COLLECT EGP ${money(o.total)}` : `PAID (${String(o.payment_method).toUpperCase()}) — DO NOT COLLECT`}</b></div>` : ""}
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
