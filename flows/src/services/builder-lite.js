// The 2D builder. 19MB of models and a WebGL context are a lot to ask of a cheap
// Android on Egyptian mobile data, and a phone that cannot render the 3D scene must
// still be able to order — losing the sale is a far worse outcome than losing the
// spinning burger. Same prices, same submit endpoint, same ticket.

const esc = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

const CAT_NAME = { bread: "Choose your bun", protein: "Protein", cheese: "Cheese", veggie: "Veggies", sauce: "Sauces" };
const CAT_ORDER = ["bread", "protein", "cheese", "veggie", "sauce"];

export function renderLitePage({ config, brand, catalog, currency, basePrice, maxPerLayer, submitUrl, token }) {
  const accent = /^#[0-9a-f]{6}$/i.test(brand.primary || "") ? brand.primary : "#e81b23";
  const light = brand.mode === "light";
  const logo = /^https?:\/\/[^\s"'<>]+$/i.test(brand.logo_url || "") ? brand.logo_url : null;

  const sections = CAT_ORDER.map((cat) => {
    const items = catalog.filter((c) => c.category === cat);
    if (!items.length) return "";
    const rows = items.map((c) => `
      <div class="row" data-id="${esc(c.id)}" data-cat="${esc(c.category)}" data-price="${Number(c.price)}">
        <div class="nm"><b>${esc(c.name)}</b><em>${c.price > 0 ? `${esc(currency)} ${c.price}` : "included"}</em></div>
        ${cat === "bread"
          ? `<button class="pick" data-act="bread">Choose</button>`
          : `<div class="stp"><button data-act="dec">−</button><span class="q">0</span><button data-act="inc">+</button></div>`}
      </div>`).join("");
    return `<section><h2>${esc(CAT_NAME[cat] || cat)}</h2>${rows}</section>`;
  }).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(config.name)} — build your own</title><style>
  :root{--accent:${accent};
    --ink:${light ? "#16130f" : "#f5ece7"};--muted:${light ? "#6f6862" : "#b8a29a"};
    --bg:${light ? "#faf8f6" : "#0d0808"};--card:${light ? "#fff" : "#1a0f0f"};
    --line:${light ? "#e7e2dc" : "#3a2020"}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding-bottom:120px}
  header{background:var(--accent);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:5}
  header img{height:30px;width:30px;border-radius:8px;background:#fff;object-fit:contain;padding:2px}
  header b{font-size:15px}
  header span{margin-left:auto;font-size:11px;opacity:.85;letter-spacing:1px;text-transform:uppercase}
  .wrap{max-width:560px;margin:0 auto;padding:12px 14px}
  section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:6px 14px 10px;margin-bottom:11px}
  h2{font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:var(--muted);margin:12px 0 6px}
  .row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)}
  .row:last-child{border-bottom:0}
  .nm{flex:1;min-width:0}
  .nm b{display:block;font-size:14.5px;font-weight:600}
  .nm em{font-style:normal;font-size:12px;color:var(--muted)}
  .stp{display:flex;align-items:center;gap:6px}
  .stp button,.pick{border:0;background:rgba(0,0,0,.06);color:var(--ink);width:38px;height:38px;border-radius:10px;
    font-size:19px;cursor:pointer;font-family:inherit;line-height:1}
  .pick{width:auto;padding:0 16px;font-size:13px;font-weight:700}
  .row.on .pick,.stp button:active{background:var(--accent);color:#fff}
  .q{min-width:20px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}
  .bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);
    padding:12px 14px max(12px,env(safe-area-inset-bottom));z-index:6}
  .bar .in{max-width:560px;margin:0 auto}
  .tot{display:flex;justify-content:space-between;font-size:15px;font-weight:700;margin-bottom:8px}
  #go{width:100%;border:0;border-radius:12px;padding:15px;background:var(--accent);color:#fff;font-size:16px;
    font-weight:800;font-family:inherit;cursor:pointer}
  #go:disabled{opacity:.45}
  #msg{text-align:center;font-size:13px;margin-top:7px;min-height:18px;font-weight:600}
  .note{font-size:11.5px;color:var(--muted);text-align:center;padding:2px 14px 14px;line-height:1.5}
</style></head><body>
<header>${logo ? `<img src="${esc(logo)}" alt="">` : ""}<b>${esc(config.name)}</b><span>Build your own</span></header>
<div class="wrap">${sections}</div>
<div class="note">Lite version — same menu, same prices, no 3D. Your phone or connection couldn't run the 3D builder.</div>
<div class="bar"><div class="in">
  <div class="tot"><span>Total</span><span id="total">${esc(currency)} ${basePrice}</span></div>
  <button id="go" disabled>Send to the kitchen</button>
  <div id="msg"></div>
</div></div>
<script>
  var BASE = ${Number(basePrice) || 0}, MAX = ${Number(maxPerLayer) || 3}, CUR = ${JSON.stringify(currency)};
  var qty = {}, bread = null;

  function total(){
    var t = BASE;
    document.querySelectorAll('.row').forEach(function(r){
      var id = r.dataset.id, p = +r.dataset.price;
      if (r.dataset.cat === 'bread') { if (bread === id) t += p; }
      else t += p * (qty[id] || 0);
    });
    return t;
  }
  function paint(){
    document.querySelectorAll('.row').forEach(function(r){
      var id = r.dataset.id;
      if (r.dataset.cat === 'bread') r.classList.toggle('on', bread === id);
      else { var q = r.querySelector('.q'); if (q) q.textContent = qty[id] || 0; }
    });
    document.getElementById('total').textContent = CUR + ' ' + total();
    // a bun and at least one filling is the minimum that makes a sandwich
    var fillings = Object.keys(qty).some(function(k){ return qty[k] > 0; });
    document.getElementById('go').disabled = !(bread && fillings);
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest('[data-act]'); if (!b) return;
    var row = b.closest('.row'), id = row.dataset.id;
    if (b.dataset.act === 'bread') bread = (bread === id ? null : id);
    if (b.dataset.act === 'inc') qty[id] = Math.min(MAX, (qty[id] || 0) + 1);
    if (b.dataset.act === 'dec') qty[id] = Math.max(0, (qty[id] || 0) - 1);
    paint();
  });
  document.getElementById('go').addEventListener('click', async function(){
    var items = [];
    if (bread) items.push({ id: bread, quantity: 1 });
    Object.keys(qty).forEach(function(k){ if (qty[k] > 0) items.push({ id: k, quantity: qty[k] }); });
    var msg = document.getElementById('msg');
    msg.textContent = 'Sending…';
    try {
      var r = await fetch(${JSON.stringify(submitUrl)}, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: items, lite: true }),
      });
      var j = await r.json();
      msg.textContent = j.ok ? (j.preview ? j.note : 'Sent — order ' + j.code) : (j.error || 'Could not send');
      if (j.ok && !j.preview) document.getElementById('go').disabled = true;
    } catch (err) { msg.textContent = 'No connection — try again'; }
  });
  paint();
</script></body></html>`;
}
