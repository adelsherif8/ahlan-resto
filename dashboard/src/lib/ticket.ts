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

// ONE thermal ticket template for every screen that prints
export function printTicket(o: any, opts: { typeLabel?: string; branchName?: string } = {}) {
  const rows = (o.items || []).map((i: any) =>
    `<div class="r"><b>${i.qty}x ${i.name}</b><span>${money(Number(i.unit_price ?? i.price) * Number(i.qty))}</span></div>` +
    modLines(i).map((m) => `<div class="m">&raquo; ${m}</div>`).join("")
  ).join("");
  const w = window.open("", "_blank", "width=330,height=640");
  if (!w) return;
  const typeLabel = opts.typeLabel || String(o.order_type || "").replace("_", "-").toUpperCase();
  w.document.write(`<html><head><title>${o.code}</title><style>
    body{font-family:ui-monospace,Menlo,monospace;width:280px;margin:8px auto;color:#000}
    .c{text-align:center}.big{font-size:30px;font-weight:800;letter-spacing:3px}
    .r{display:flex;justify-content:space-between;margin:2px 0}.m{color:#444;font-size:11px;padding-left:12px}
    hr{border:none;border-top:1px dashed #888;margin:6px 0}
  </style></head><body>
    <div class="c"><b>${typeLabel}${o.table_number ? " · T" + o.table_number : ""}</b></div>
    <div class="c big">${o.code}</div>
    <div class="c">${o.diner_name || o.phone_number || "guest"}${opts.branchName ? " · " + opts.branchName : ""}</div>
    <hr>${rows}<hr>
    <div class="r"><b>TOTAL</b><b>EGP ${money(o.total)}</b></div>
    ${o.payment_method ? `<div>PAYMENT: ${String(o.payment_method).toUpperCase()}</div>` : ""}
    ${o.address ? `<div>DELIVER TO: ${o.address}</div>` : ""}
    ${o.notes ? `<div>!! ${o.notes}</div>` : ""}
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 250);
}
