// The rider's page. Rebuilt from the emoji-and-grey-pills version, which told the
// rider almost nothing: no ETA, no distance, no idea what was in the bag, no branch
// to collect from, and no times against the steps.
//
// Three deliberate choices:
//   · icons are inline SVG, not emoji — emoji render differently on every Android
//     build and read as a toy on a page someone uses while working
//   · the word is CUSTOMER, never "guest"
//   · distance is measured, ETA is derived from it and labelled as an estimate —
//     the page never states a time it cannot actually stand behind

import { itemMods } from "./orderline.js";

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const safeUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || "")) ? esc(u) : null);

// Lucide-style, 24px grid, currentColor so each one inherits its context.
const ICON = {
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>',
  store: '<path d="M3 9h18l-1-5H4L3 9Z"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
  bike: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h6l4-8h3"/><path d="M12 17 9 9H6"/>',
  door: '<path d="M14 21V4a1 1 0 0 0-1.2-1L5 4.6A1 1 0 0 0 4 5.6V21"/><path d="M2 21h18"/><circle cx="11" cy="12" r="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h5a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h5"/>',
};

const icon = (name, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ""}</svg>`;

const timeOf = (v, tz) =>
  v ? new Date(v).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }) : null;

export function renderDriverPage({ tenant, order, token, apiBase }) {
  const config = tenant.config;
  const tz = config.basic_info?.timezone || "Africa/Cairo";
  const brand = config.basic_info?.brand || {};
  const accent = /^#[0-9a-f]{6}$/i.test(brand.primary || "") ? brand.primary : "#ea0000";
  const logo = safeUrl(brand.logo_url);

  const branches = (config.basic_info?.branches || []).filter((b) => b?.key);
  const br = branches.find((b) => b.key === order.branch) || null;

  const custLat = Number(order.lat), custLng = Number(order.lng);
  const hasCustCoords = Number.isFinite(custLat) && Number.isFinite(custLng);
  const custMaps = safeUrl(order.map_link)
    || (hasCustCoords ? `https://maps.google.com/?q=${custLat},${custLng}`
                      : `https://maps.google.com/?q=${encodeURIComponent(order.address || "")}`);
  const brMaps = br?.lat && br?.lng ? `https://maps.google.com/?q=${Number(br.lat)},${Number(br.lng)}` : null;

  const cod = order.payment_method === "cash" ? Number(order.total) || 0 : 0;
  const phone = String(order.phone_number || "").replace(/[^+\d]/g, "");
  const callable = phone && !String(order.phone_number || "").startsWith("web") && !String(order.phone_number || "").startsWith("walkin");

  // What's actually in the bag — a rider handing over the wrong order is the one
  // mistake this page exists to prevent.
  const items = (order.items || []).map((i) => {
    const extras = itemMods(i).map(esc).join(" · ");
    return `<div class="item"><span class="q">${esc(i.qty || 1)}×</span><span><b>${esc(i.name)}</b>${extras ? `<em>${extras}</em>` : ""}</span></div>`;
  }).join("") || '<div class="item muted">No items listed</div>';

  const delivered = order.status === "delivered";
  const steps = [
    { label: "Order received", at: order.created_at, done: true },
    { label: "Kitchen started", at: order.started_at, done: !!order.started_at || ["preparing", "ready", "out_for_delivery", "delivered"].includes(order.status) },
    { label: "Packed & ready", at: order.ready_at, done: ["ready", "out_for_delivery", "delivered"].includes(order.status) },
    { label: "Picked up", at: order.out_at, done: ["out_for_delivery", "delivered"].includes(order.status) },
    { label: "At the door", at: order.courier_arrived_at, done: !!order.courier_arrived_at || delivered },
    { label: "Delivered", at: order.delivered_at, done: delivered },
  ].map((s) => {
    const t = timeOf(s.at, tz);
    return `<div class="step ${s.done ? "on" : ""}"><i>${s.done ? icon("check", 13) : ""}</i><span>${esc(s.label)}</span><b>${t ? esc(t) : ""}</b></div>`;
  }).join("");

  const rider = order.courier_name ? String(order.courier_name).split(" ")[0] : null;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(order.code)} — ${esc(config.name)}</title><style>
  :root{--accent:${accent};--ink:#16130f;--muted:#7a736c;--line:#e7e2dc;--bg:#f4f2ef;--card:#fff}
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);margin:0;padding:0 0 28px;color:var(--ink);-webkit-font-smoothing:antialiased}
  .top{background:var(--accent);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}
  .top img{height:30px;width:30px;border-radius:8px;background:#fff;object-fit:contain;padding:2px}
  .top .nm{font-weight:700;font-size:15px;letter-spacing:.2px}
  .top .rl{margin-left:auto;font-size:11px;opacity:.85;text-transform:uppercase;letter-spacing:1px}
  .wrap{padding:12px 14px;max-width:560px;margin:0 auto}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:11px}
  .code{font-size:31px;font-weight:800;letter-spacing:2px;text-align:center;margin:2px 0 2px}
  .state{text-align:center;font-size:11px;letter-spacing:1.4px;color:var(--muted);text-transform:uppercase;margin-bottom:10px}
  .eta{display:flex;align-items:center;justify-content:center;gap:8px;background:#f7f5f2;border:1px solid var(--line);border-radius:11px;padding:10px;font-size:14px;font-weight:600}
  .eta .est{color:var(--muted);font-weight:500;font-size:12px}
  .lbl{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
  .item{display:flex;gap:9px;padding:6px 0;font-size:14px;border-bottom:1px solid #f3f0ec;align-items:flex-start}
  .item:last-child{border-bottom:0}
  .item .q{color:var(--accent);font-weight:800;min-width:26px}
  .item em{display:block;font-style:normal;color:var(--muted);font-size:12px;margin-top:1px}
  .row{display:flex;justify-content:space-between;font-size:14px;padding:4px 0}
  .cod{display:flex;align-items:center;justify-content:center;gap:8px;background:#fff8e6;border:1.5px solid #e8b52e;border-radius:11px;padding:12px;font-weight:800;font-size:17px;margin-top:9px}
  .codform{margin-top:8px;display:flex;flex-direction:column;gap:7px}
  .codform input{width:100%;box-sizing:border-box;border:1.5px solid #d9d2c7;border-radius:10px;padding:11px 12px;font-size:16px;font-weight:700}
  .addr{font-size:16px;font-weight:650;line-height:1.45;margin-bottom:11px}
  a.link{display:flex;align-items:center;gap:9px;background:#fff;border:1.5px solid var(--line);border-radius:11px;padding:12px;font-weight:600;color:var(--ink);text-decoration:none;margin-bottom:8px;font-size:14px}
  a.link:active{background:#faf8f6}
  button{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:11px;padding:14px;font-size:15px;font-weight:700;margin-bottom:8px;cursor:pointer;font-family:inherit}
  .primary{background:var(--accent);color:#fff}
  .ghost{background:#fff;border:1.5px solid var(--line);color:var(--ink)}
  label.podbtn{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:11px;padding:14px;font-size:15px;font-weight:700;margin-bottom:8px;cursor:pointer}
  .ok{background:#0f7a4d;color:#fff}
  .step{display:flex;align-items:center;gap:9px;font-size:13.5px;padding:5px 0;color:var(--muted)}
  .step i{width:19px;height:19px;border-radius:50%;border:1.5px solid var(--line);display:flex;align-items:center;justify-content:center;flex:0 0 auto}
  .step.on{color:var(--ink);font-weight:600}
  .step.on i{background:#0f7a4d;border-color:#0f7a4d;color:#fff}
  .step b{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums;color:var(--muted);font-size:12.5px}
  #msg{text-align:center;color:#0f7a4d;font-weight:700;min-height:19px;font-size:13px;margin-top:2px}
  .muted{color:var(--muted);font-size:12px;text-align:center;line-height:1.5}
</style></head><body>
  <div class="top">
    ${logo ? `<img src="${logo}" alt="">` : ""}
    <span class="nm">${esc(config.name)}</span>
    <span class="rl">${rider ? esc(rider) : "Delivery"}</span>
  </div>
  <div class="wrap">
    <div class="card">
      <div class="code">${esc(order.code)}</div>
      <div class="state">${delivered ? "Delivered" : esc(String(order.status || "").replace(/_/g, " "))}</div>
      <div class="eta" id="eta"><span class="est">${hasCustCoords ? "Finding your location…" : "Distance needs the customer's map pin"}</span></div>
    </div>

    <div class="card">
      <div class="lbl">${icon("bag", 13)} In the bag</div>
      ${items}
      <div class="row"><span>Total</span><b>EGP ${Number(order.total || 0).toLocaleString()}</b></div>
      ${cod
        ? `<div class="cod">${icon("cash", 19)} Collect cash · EGP ${cod.toLocaleString()}</div>
      ${order.notes ? `<div class="row" style="color:#a15c00"><span>Note</span><b>${esc(order.notes)}</b></div>` : ""}
      <div class="codform">
        <input id="rcv" type="number" inputmode="numeric" placeholder="Cash received (EGP)" oninput="chg()">
        <div class="row"><span>Change to give back</span><b id="chgv">—</b></div>
        <button class="ghost" onclick="recordCod()">${icon("cash")} Record cash received</button>
      </div>`
        : `<div class="row"><span>Payment</span><b>${esc(String(order.payment_method || "paid").toUpperCase())} — nothing to collect</b></div>`}
    </div>

    <div class="card">
      <div class="lbl">${icon("pin", 13)} Deliver to</div>
      <div class="addr">${esc(order.address || "—")}</div>
      <a class="link" href="${custMaps}" target="_blank" rel="noopener">${icon("route")} Open customer location</a>
      ${callable ? `<a class="link" href="tel:${esc(phone)}">${icon("phone")} Call customer</a>` : ""}
      ${brMaps ? `<a class="link" href="${brMaps}" target="_blank" rel="noopener">${icon("store")} Collect from ${esc(br.name)}</a>` : ""}
    </div>

    <div class="card">
      <div class="lbl">${icon("clock", 13)} Progress</div>
      ${steps}
    </div>

    <div class="card">
      <button class="primary" onclick="act('out')">${icon("bike")} On my way</button>
      <button class="ghost" onclick="act('near')">${icon("pin")} I'm 2 minutes away</button>
      <button class="ghost" onclick="act('arrived')">${icon("door")} I've arrived</button>
      <button class="ghost" onclick="act('delay')">${icon("clock")} Running ~10 min late</button>
      <label class="ghost podbtn" for="podfile">${icon("check")} 📸 Proof of delivery (photo at the door)</label>
      <input id="podfile" type="file" accept="image/*" capture="environment" style="display:none" onchange="podUpload(this)">
      <div id="podstate" class="muted" style="display:none"></div>
      <button class="ok" onclick="if(confirm('Mark ${esc(order.code)} as DELIVERED?'))act('delivered')">${icon("check")} Delivered</button>
      <div id="msg"></div>
      <div class="muted">Each button sends the customer a WhatsApp update from the restaurant's number. Sharing your location keeps the ETA accurate.</div>
    </div>
  </div>
<script>
  const T = ${JSON.stringify(String(token))};
  const API = ${JSON.stringify(apiBase)};
  const CUST = ${hasCustCoords ? JSON.stringify({ lat: custLat, lng: custLng }) : "null"};
  // A scooter through Cairo traffic, not a straight-line car speed. Distance is
  // measured; the minutes are an ESTIMATE and the page says so rather than
  // presenting a guess as a promise.
  const KMH = 18;

  async function act(action, extra){
    const r = await fetch(API+'/api/driver/'+T+'/action', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action, ...(extra||{})})});
    const j = await r.json().catch(()=>({}));
    document.getElementById('msg').textContent = j.ok ? (j.note || 'Customer notified') : (j.error || 'Failed — try again');
    if(action==='delivered' && j.ok) setTimeout(()=>location.reload(), 800);
  }
  const COD = ${cod};
  function chg(){
    const el = document.getElementById('rcv'), out = document.getElementById('chgv');
    if(!el || !out) return;
    const rcv = Number(el.value)||0;
    out.textContent = rcv >= COD ? 'EGP ' + (rcv - COD).toLocaleString() : (rcv > 0 ? 'not enough — EGP ' + (COD - rcv).toLocaleString() + ' short' : '—');
  }
  function recordCod(){
    const rcv = Number((document.getElementById('rcv')||{}).value)||0;
    if(rcv <= 0) { document.getElementById('msg').textContent = 'Enter the cash you received first'; return; }
    act('cod', { received: rcv });
  }
  // Proof of delivery: downscale to ~1280px JPEG in the browser (phone photos are 3-8MB;
  // the server caps uploads), then send as a data URL.
  function podUpload(input){
    const f = input.files && input.files[0];
    if(!f) return;
    const st = document.getElementById('podstate');
    st.style.display=''; st.textContent='Uploading photo…';
    const img = new Image();
    img.onload = function(){
      const MAX = 1280;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', 0.72);
      fetch(API+'/api/driver/'+T+'/action', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'pod', photo:dataUrl})})
        .then(r=>r.json()).then(j=>{ st.textContent = j.ok ? '✅ Proof of delivery saved' : (j.error || 'Upload failed — try again'); })
        .catch(()=>{ st.textContent = 'Upload failed — try again'; });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  }

  function km(a, b){
    const R = 6371, rad = (d) => d * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const x = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function paint(d){
    const el = document.getElementById('eta');
    if (d == null) return;
    const mins = Math.max(1, Math.round((d / KMH) * 60));
    el.innerHTML = '<b>' + d.toFixed(1) + ' km</b><span class="est">·</span><b>~' + mins + ' min</b><span class="est">estimated</span>';
  }

  if (navigator.geolocation) {
    navigator.geolocation.watchPosition((p) => {
      const me = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (CUST) paint(km(me, CUST));
      fetch(API+'/api/driver/'+T+'/loc', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(me)}).catch(()=>{});
    }, () => {
      const el = document.getElementById('eta');
      el.innerHTML = '<span class="est">Turn on location to see distance and ETA</span>';
    }, { enableHighAccuracy: true, maximumAge: 20000 });
  }
</script></body></html>`;
}
