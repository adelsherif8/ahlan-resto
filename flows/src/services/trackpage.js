// The customer's side of a delivery. Until now they got text pushes and nothing to
// look at; the rider had a live page and the person waiting for the food had none.
//
// Same honesty rules as the rider page: distance is measured from the rider's last
// known position, the countdown is labelled an estimate, and anything we do not
// actually know (no rider assigned yet, no location shared) is said plainly rather
// than filled in with a plausible number.

import { itemMods } from "./orderline.js";

const esc = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || "")) ? esc(u) : null);

const ICON = {
  bike: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h6l4-8h3"/><path d="M12 17 9 9H6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = (n, s = 18) =>
  `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[n] || ""}</svg>`;

const timeOf = (v, tz) =>
  v ? new Date(v).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }) : null;

export function renderTrackPage({ config, brand, order, courier, apiBase, token }) {
  const tz = config.basic_info?.timezone || "Africa/Cairo";
  const accent = /^#[0-9a-f]{6}$/i.test(brand.primary || "") ? brand.primary : "#e81b23";
  const light = brand.mode === "light";
  const logo = safeUrl(brand.logo_url);
  const delivered = order.status === "delivered";

  const steps = [
    { label: "Order received", at: order.created_at, done: true },
    { label: "Kitchen started", at: order.started_at, done: !!order.started_at || ["preparing", "ready", "out_for_delivery", "delivered"].includes(order.status) },
    { label: "Packed & ready", at: order.ready_at, done: ["ready", "out_for_delivery", "delivered"].includes(order.status) },
    { label: courier?.name ? `On the way with ${String(courier.name).split(" ")[0]}` : "On the way", at: order.out_at, done: ["out_for_delivery", "delivered"].includes(order.status) },
    { label: "Delivered", at: order.delivered_at, done: delivered },
  ].map((s) => {
    const t = timeOf(s.at, tz);
    return `<div class="step ${s.done ? "on" : ""}"><i>${s.done ? icon("check", 13) : ""}</i><span>${esc(s.label)}</span><b>${t ? esc(t) : ""}</b></div>`;
  }).join("");

  const items = (order.items || []).map((i) => {
    const extra = itemMods(i).map(esc).join(" · ");
    return `<div class="item"><span class="q">${esc(i.qty || 1)}×</span><span><b>${esc(i.name)}</b>${extra ? `<em>${extra}</em>` : ""}</span></div>`;
  }).join("");

  // Only offer a live distance when the rider has actually shared a position recently.
  const fresh = order.courier_seen_at && (Date.now() - new Date(order.courier_seen_at).getTime() < 15 * 60_000);
  const riderPos = fresh && Number.isFinite(Number(order.courier_lat)) ? { lat: Number(order.courier_lat), lng: Number(order.courier_lng) } : null;
  const dest = Number.isFinite(Number(order.lat)) ? { lat: Number(order.lat), lng: Number(order.lng) } : null;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(order.code)} — ${esc(config.name)}</title><style>
  :root{--accent:${accent};
    --ink:${light ? "#16130f" : "#f5ece7"};--muted:${light ? "#6f6862" : "#b8a29a"};
    --bg:${light ? "#f4f2ef" : "#0d0808"};--card:${light ? "#fff" : "#1a0f0f"};--line:${light ? "#e7e2dc" : "#3a2020"}}
  *{box-sizing:border-box}
  body{margin:0;padding:0 0 26px;background:var(--bg);color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
  .top{background:var(--accent);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}
  .top img{height:30px;width:30px;border-radius:8px;background:#fff;object-fit:contain;padding:2px}
  .top b{font-size:15px}
  .wrap{max-width:520px;margin:0 auto;padding:12px 14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:11px}
  .code{font-size:30px;font-weight:800;letter-spacing:2px;text-align:center;margin:2px 0}
  .state{text-align:center;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
  .eta{display:flex;align-items:center;justify-content:center;gap:8px;background:${light ? "#f7f5f2" : "#241313"};
    border:1px solid var(--line);border-radius:11px;padding:12px;font-size:15px;font-weight:700}
  .eta .est{font-weight:500;font-size:12px;color:var(--muted)}
  .lbl{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
  .rider{display:flex;align-items:center;gap:11px}
  .rider .av{width:42px;height:42px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;flex:0 0 auto}
  .rider .who b{display:block;font-size:15px}
  .rider .who span{font-size:12.5px;color:var(--muted)}
  a.call{margin-left:auto;display:flex;align-items:center;gap:7px;border:1.5px solid var(--line);border-radius:10px;
    padding:9px 13px;text-decoration:none;color:var(--ink);font-weight:600;font-size:13px}
  .item{display:flex;gap:9px;padding:6px 0;font-size:14px;border-bottom:1px solid var(--line);align-items:flex-start}
  .item:last-of-type{border-bottom:0}
  .item .q{color:var(--accent);font-weight:800;min-width:26px}
  .item em{display:block;font-style:normal;color:var(--muted);font-size:12px;margin-top:1px}
  .row{display:flex;justify-content:space-between;font-size:14px;padding:4px 0}
  .step{display:flex;align-items:center;gap:9px;font-size:13.5px;padding:5px 0;color:var(--muted)}
  .step i{width:19px;height:19px;border-radius:50%;border:1.5px solid var(--line);display:flex;align-items:center;justify-content:center;flex:0 0 auto}
  .step.on{color:var(--ink);font-weight:600}
  .step.on i{background:#0f7a4d;border-color:#0f7a4d;color:#fff}
  .step b{margin-left:auto;font-weight:600;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
  .muted{color:var(--muted);font-size:12px;text-align:center;line-height:1.5}
</style></head><body>
  <div class="top">${logo ? `<img src="${logo}" alt="">` : ""}<b>${esc(config.name)}</b></div>
  <div class="wrap">
    <div class="card">
      <div class="code">${esc(order.code)}</div>
      <div class="state">${delivered ? "Delivered" : esc(String(order.status || "").replace(/_/g, " "))}</div>
      <div class="eta" id="eta">${delivered
        ? `${icon("check", 18)} Delivered — enjoy`
        : `<span class="est">Getting the latest…</span>`}</div>
    </div>

    ${courier?.name ? `<div class="card">
      <div class="lbl">${icon("bike", 13)} Your rider</div>
      <div class="rider">
        <div class="av">${esc(String(courier.name).trim().charAt(0).toUpperCase())}</div>
        <div class="who"><b>${esc(courier.name)}</b><span>${esc(courier.vehicle || "On the way to you")}</span></div>
        ${courier.phone_number ? `<a class="call" href="tel:${esc(String(courier.phone_number).replace(/[^+\d]/g, ""))}">${icon("phone", 15)} Call</a>` : ""}
      </div>
    </div>` : ""}

    <div class="card">
      <div class="lbl">${icon("bag", 13)} Your order</div>
      ${items}
      <div class="row"><span>Total</span><b>${esc(config.payments?.currency || "EGP")} ${Number(order.total || 0).toLocaleString()}</b></div>
      ${order.payment_method === "cash" ? `<div class="row"><span>Please have ready</span><b>Cash ${Number(order.total || 0).toLocaleString()}</b></div>` : ""}
    </div>

    <div class="card">
      <div class="lbl">${icon("clock", 13)} Progress</div>
      ${steps}
    </div>
    <div class="muted">This page updates itself. ${esc(config.basic_info?.phone || "")}</div>
  </div>
<script>
  var RIDER = ${riderPos ? JSON.stringify(riderPos) : "null"};
  var DEST  = ${dest ? JSON.stringify(dest) : "null"};
  var DONE  = ${delivered ? "true" : "false"};
  var KMH = 18;   // a scooter in Cairo traffic, not a straight-line car speed

  function km(a, b){
    var R = 6371, rad = function(d){ return d * Math.PI / 180; };
    var dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    var x = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)*Math.sin(dLng/2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function paint(){
    if (DONE) return;
    var el = document.getElementById('eta');
    if (RIDER && DEST) {
      var d = km(RIDER, DEST);
      var mins = Math.max(1, Math.round((d / KMH) * 60));
      el.innerHTML = '<b>~' + mins + ' min away</b><span class="est">\\u00b7 ' + d.toFixed(1) + ' km \\u00b7 estimated</span>';
    } else {
      // no fresh rider position — say so rather than invent a countdown
      el.innerHTML = '<span class="est">We\\u2019ll show a live ETA once the rider is on the road</span>';
    }
  }
  paint();

  // keep it current without the customer refreshing
  setInterval(function(){
    fetch(${JSON.stringify(`${apiBase}/api/track/${token}/state`)})
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (!j || !j.ok) return;
        if (j.delivered && !DONE) return location.reload();
        if (j.status_changed) return location.reload();
        if (j.rider) { RIDER = j.rider; paint(); }
      })
      .catch(function(){});
  }, 25000);
</script></body></html>`;
}
