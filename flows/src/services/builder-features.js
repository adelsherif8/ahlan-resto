// Builder features from docs/SANDWICH-BUILDER-PLAN.md, injected into the prototype
// page. Everything here is PURE CODE — no model calls, and nothing invents restaurant
// data: allergens describe the ingredient itself (cheese contains dairy), the "your
// build ≈" comparison uses the restaurant's own menu prices, and the protein counter
// only appears when protein data has actually been configured.

export function featuresScript({ menu = [], currency = "EGP", kidsMode = false, allergens = {}, protein = {}, presets = [], sides = [], limited = {}, restaurant = "", compare = false, doneness = false, kidsHide = [] }) {
  const data = { menu, currency, allergens, protein, kidsMode, presets, sides, limited, restaurant, compare, doneness, kidsHide };
  return `
<style>
  #bx-bar{display:flex;flex-wrap:wrap;gap:6px;padding:8px 14px 2px}
  #bx-bar button{flex:1;min-width:88px;border:0;border-radius:9px;padding:9px 8px;font-size:12px;font-weight:700;
    cursor:pointer;font-family:inherit;background:rgba(var(--brand-red-rgb),.13);color:var(--text-main)}
  #bx-bar button.on{background:var(--brand-red);color:var(--text-on-accent)}
  #bx-name{width:100%;margin:8px 14px 0;width:calc(100% - 28px);padding:10px;border-radius:9px;
    border:1px solid rgba(var(--brand-red-rgb),.25);background:transparent;color:var(--text-main);
    font-family:inherit;font-size:13px}
  #bx-name::placeholder{color:var(--text-dim)}
  .bx-sl{padding:6px 14px 0}
  .bx-sl label{display:flex;justify-content:space-between;font-size:11px;letter-spacing:.6px;
    text-transform:uppercase;color:var(--text-dim);margin-bottom:3px}
  .bx-sl label b{color:var(--text-main);text-transform:none;letter-spacing:0;font-size:12px}
  .bx-sl input[type=range]{width:100%;accent-color:var(--brand-red)}
  #bx-near{padding:6px 14px 0;font-size:12px;color:var(--text-muted)}
  #bx-near b{color:var(--text-main)}
  #bx-allergy{padding:6px 14px 0;display:flex;flex-wrap:wrap;gap:5px}
  #bx-allergy button{border:1px solid rgba(var(--brand-red-rgb),.3);background:transparent;color:var(--text-muted);
    border-radius:20px;padding:5px 11px;font-size:11.5px;cursor:pointer;font-family:inherit}
  #bx-allergy button.on{background:var(--brand-red);border-color:var(--brand-red);color:var(--text-on-accent)}
  .chip.bx-block{opacity:.32;pointer-events:none;position:relative}
  #bx-note{padding:4px 14px 0;font-size:10.5px;color:var(--text-dim);line-height:1.45}
  body.bx-kids .chip,body.bx-kids .bread-chip{padding:16px 14px;font-size:15px}
  body.bx-kids .stepper button{width:42px;height:42px;font-size:19px}
  body.bx-kids #panel h2{font-size:22px}
  #bx-presets,#bx-meal{padding:6px 14px 0;display:flex;flex-wrap:wrap;gap:5px}
  #bx-presets .stack-title,#bx-meal .stack-title{flex:0 0 100%}
  .bx-preset{border:1px solid rgba(var(--brand-red-rgb),.3);background:transparent;color:var(--text-main);
    border-radius:9px;padding:8px 12px;font-size:12.5px;cursor:pointer;font-family:inherit}
  .bx-preset.on{background:var(--brand-red);border-color:var(--brand-red);color:var(--text-on-accent)}
  .bx-lt{display:inline-block;margin-left:6px;background:var(--brand-red);color:var(--text-on-accent);
    border-radius:20px;padding:1px 7px;font-size:10px;font-weight:800;vertical-align:middle}
  @keyframes bx-sizzle{0%{transform:translateY(-14px) scale(.97);opacity:.25}
    60%{transform:translateY(2px) scale(1.015);opacity:1}100%{transform:none}}
  body.bx-confirm #scene-container{animation:bx-sizzle .55s cubic-bezier(.2,.9,.25,1)}
  @media (prefers-reduced-motion:reduce){body.bx-confirm #scene-container{animation:none}}
  #bx-cardview{position:fixed;inset:0;z-index:9999;background:rgba(12,8,8,.72);display:flex;
    align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px)}
  .bx-cv-box{background:#fff;border-radius:16px;padding:14px;max-width:min(92vw,420px);
    max-height:92vh;display:flex;flex-direction:column;gap:11px;box-shadow:0 18px 50px rgba(0,0,0,.35)}
  .bx-cv-box img{width:100%;height:auto;max-height:70vh;object-fit:contain;border-radius:10px;display:block}
  .bx-cv-row{display:flex;gap:7px}
  .bx-cv-row button{flex:1;border:0;border-radius:10px;padding:12px;font-size:13.5px;font-weight:800;
    cursor:pointer;font-family:inherit}
  .bx-cv-primary{background:var(--brand-red);color:var(--text-on-accent)}
  .bx-cv-ghost{background:#f1eeeb;color:#16130f}
  @media (max-width:820px){#bx-bar button{min-width:74px;padding:11px 6px}}
</style>
<script>
(function(){
  // SECURITY: data.restaurant/menu[].name/sides[].name are restaurant-controlled
  // strings (config.name, menu_items.name) embedded straight into this script block.
  // We escape every "<" to < (the same thing builder.js's jsonScript() does for
  // window.__AHLAN__), so a name carrying a script-closing tag can't break out of the
  // block. NOTE: keep the literal close-tag sequence OUT of this comment too — a raw
  // one here would itself close the script element early. (It did once. Not again.)
  var D = ${JSON.stringify(data).replace(/</g, "\\u003c")};
  var B = null;
  var state = { doneness: 1, sauce: 1, name: '', avoid: {}, meal: {}, kids: ${kidsMode ? "true" : "false"} };

  function ready(fn){ if (window.__BUILD__) return fn(); setTimeout(function(){ ready(fn); }, 60); }

  ready(function(){
    B = window.__BUILD__;
    mount();
    apply();
  });

  function el(tag, attrs, parent){
    var n = document.createElement(tag);
    for (var k in attrs) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
    if (parent) parent.appendChild(n);
    return n;
  }

  function mount(){
    var panel = document.getElementById('panel');
    var scroll = document.getElementById('panel-scroll');
    if (!panel || !scroll) return;

    // ---- action bar: surprise me / kids mode / photo card ----
    var bar = el('div', { id: 'bx-bar' });
    panel.insertBefore(bar, scroll);

    var rnd = el('button', { text: 'Surprise me', type: 'button' }, bar);
    rnd.onclick = randomBuild;

    var kids = el('button', { text: 'Kids mode', type: 'button' }, bar);
    kids.onclick = function(){
      state.kids = !state.kids;
      document.body.classList.toggle('bx-kids', state.kids);
      kids.classList.toggle('on', state.kids);
      applyKids();
    };
    if (state.kids) { document.body.classList.add('bx-kids'); kids.classList.add('on'); applyKids(); }

    var card = el('button', { text: 'Photo card', type: 'button' }, bar);
    card.onclick = photoCard;

    // ---- name your burger ----
    var name = el('input', { id: 'bx-name', placeholder: 'Name your burger (optional)', maxlength: '32' });
    panel.insertBefore(name, scroll);
    name.oninput = function(){ state.name = name.value; };

    // ---- allergy filter ----
    var av = el('div', { id: 'bx-allergy' });
    panel.insertBefore(av, scroll);
    var kinds = {};
    Object.keys(D.allergens).forEach(function(k){ (D.allergens[k] || []).forEach(function(a){ kinds[a] = 1; }); });
    Object.keys(kinds).sort().forEach(function(a){
      var b = el('button', { text: 'No ' + a, type: 'button' }, av);
      b.onclick = function(){
        state.avoid[a] = !state.avoid[a];
        b.classList.toggle('on', !!state.avoid[a]);
        dropBlocked();
        apply();
      };
    });

    // ---- sauce (and doneness, only where it means anything) ----
    // Nobody orders a smash patty medium-rare. Doneness is a table-service question,
    // so a fast-casual kitchen never sees it; sauce amount is real everywhere.
    var sl = el('div', { class: 'bx-sl' });
    panel.insertBefore(sl, scroll);
    sl.innerHTML = (D.doneness
        ? '<label>Doneness <b id="bx-dv">Medium</b></label>'
          + '<input id="bx-d" type="range" min="0" max="2" step="1" value="1">'
          + '<label style="margin-top:6px">Sauce <b id="bx-sv">Regular</b></label>'
        : '<label>Sauce <b id="bx-sv">Regular</b></label>')
      + '<input id="bx-s" type="range" min="0" max="2" step="1" value="1">';
    var DN = ['Well done', 'Medium', 'Juicy'], SA = ['Light', 'Regular', 'Extra'];
    var dEl = sl.querySelector('#bx-d');
    if (dEl) dEl.oninput = function(e){ state.doneness = +e.target.value; document.getElementById('bx-dv').textContent = DN[state.doneness]; };
    sl.querySelector('#bx-s').oninput = function(e){
      state.sauce = +e.target.value;
      document.getElementById('bx-sv').textContent = SA[state.sauce];
      // the burger shows it, not just the label
      if (B && B.setSauce) B.setSauce(state.sauce);
    };

    // ---- "your build ≈" + protein ----
    panel.insertBefore(el('div', { id: 'bx-near' }), scroll);
    panel.insertBefore(el('div', { id: 'bx-note', text: 'Allergen info is a guide — please tell us and the kitchen will confirm.' }), scroll);

    // recompute whenever the panel redraws (the page rerenders it on every change)
    var mo = new MutationObserver(function(){ apply(); });
    mo.observe(scroll, { childList: true });

    // ---- chef's presets: start from something, not an empty bun ----
    if (D.presets && D.presets.length) {
      var pw = el('div', { id: 'bx-presets' });
      panel.insertBefore(pw, scroll);
      pw.innerHTML = '<div class="stack-title">Start from</div>';
      D.presets.forEach(function(p){
        var b = el('button', { text: p.name, type: 'button', class: 'bx-preset' }, pw);
        b.onclick = function(){
          Object.keys(B.qty).forEach(function(k){ B.qty[k] = 0; });
          Object.keys(p.layers || {}).forEach(function(k){ if (B.qty[k] !== undefined) B.qty[k] = p.layers[k]; });
          state.name = p.name;
          var ni = document.getElementById('bx-name'); if (ni) ni.value = p.name;
          B.rerender();
        };
      });
    }

    // (make it a meal lives in the CHECKOUT, after Review — a second copy in the
    //  sidebar was the duplicate the founder spotted)

    // preloaded build from a receipt QR: ?b=patty:2,cheese_cheddar:1
    var pre = new URLSearchParams(location.search).get('b');
    if (pre) {
      pre.split(',').forEach(function(part){
        var bits = part.split(':');
        if (B.qty[bits[0]] !== undefined) B.qty[bits[0]] = Math.max(0, Math.min(3, parseInt(bits[1], 10) || 0));
      });
      B.rerender();
    }
  }

  // Kids mode: a smaller sandwich, a shorter list, and one of anything. Whatever is
  // already on the build and is not for kids comes straight back off.
  function applyKids(){
    if (B && B.setKids) B.setKids(state.kids);
    if (state.kids) {
      var changed = false;
      (D.kidsHide || []).forEach(function(id){ if (B.qty[id] > 0) { B.qty[id] = 0; changed = true; } });
      Object.keys(B.qty).forEach(function(id){ if (B.qty[id] > 1) { B.qty[id] = 1; changed = true; } });
      if (changed) B.rerender();
    }
    if (window.__BX_REDRAW__) window.__BX_REDRAW__();
    apply();
  }

  // the layout layer asks this before drawing a card
  window.__BX_HIDDEN__ = function(id){
    return state.kids && (D.kidsHide || []).indexOf(id) !== -1;
  };
  window.__BX_MAXQ__ = function(){ return state.kids ? 1 : (window.__AHLAN__ && window.__AHLAN__.maxPerLayer) || 3; };

  function blocked(id){
    var list = D.allergens[id] || [];
    for (var i = 0; i < list.length; i++) if (state.avoid[list[i]]) return true;
    return false;
  }

  // anything the customer just said they cannot eat comes straight back off the build
  function dropBlocked(){
    var changed = false;
    Object.keys(B.qty).forEach(function(id){ if (B.qty[id] > 0 && blocked(id)) { B.qty[id] = 0; changed = true; } });
    if (changed) B.rerender();
  }

  function apply(){
    // grey out what the customer cannot eat
    document.querySelectorAll('#panel-scroll [data-id]').forEach(function(node){
      var id = node.getAttribute('data-id');
      var chip = node.closest ? (node.closest('.chip') || node.closest('.bread-chip')) : null;
      if (chip) chip.classList.toggle('bx-block', blocked(id));
    });

    // limited-time layers: a countdown badge, and gone once it expires
    var now = Date.now();
    Object.keys(D.limited || {}).forEach(function(id){
      var until = Date.parse(D.limited[id]);
      if (!until) return;
      document.querySelectorAll('#panel-scroll [data-id="' + id + '"]').forEach(function(node){
        var chip = node.closest ? (node.closest('.chip') || node.closest('.bread-chip')) : null;
        if (!chip) return;
        if (until <= now) { chip.classList.add('bx-block'); return; }
        if (chip.querySelector('.bx-lt')) return;
        var days = Math.max(1, Math.ceil((until - now) / 86400000));
        var tag = document.createElement('span');
        tag.className = 'bx-lt';
        tag.textContent = days + 'd left';
        chip.appendChild(tag);
      });
    });

    // "Your build ≈" is OFF. Matching on price alone produced nonsense — a burger came
    // back as "≈ Cheezy Hot Dog — same price", because price similarity says nothing
    // about whether two things are alike. A real comparison needs each menu item's
    // LAYER LIST to diff against (the Blender export has one per item in layers.txt);
    // until that data is loaded this stays hidden rather than shipping a bad answer.
    var near = document.getElementById('bx-near');
    if (near && D.compare) {
      var total = B.totals().price;
      if (!total || !D.menu.length) near.textContent = '';
      else {
        var best = null;
        D.menu.forEach(function(m){
          var d = Math.abs(m.price - total);
          if (!best || d < best.d) best = { d: d, m: m };
        });
        if (best) {
          var delta = total - best.m.price;
          // SECURITY: best.m.name is a menu item's name — restaurant-controlled text,
          // not a hardcoded string. innerHTML concatenation here let a menu item named
          // e.g. '<img src=x onerror=...>' execute in every customer's browser. Built
          // as real DOM nodes with textContent instead, same as the rest of this file.
          near.textContent = '';
          near.appendChild(document.createTextNode('Your build \\u2248 '));
          var bEl = document.createElement('b');
          bEl.textContent = best.m.name;
          near.appendChild(bEl);
          near.appendChild(document.createTextNode(
            delta === 0 ? ' — same price' : (delta > 0 ? ' +' : ' \\u2212') + D.currency + ' ' + Math.abs(delta)
          ));
        }
      }
    }

    // protein counter, only when the restaurant has configured protein data — the
    // number is code-computed, never restaurant/customer text, so plain nodes suffice
    if (Object.keys(D.protein).length) {
      var g = 0;
      Object.keys(B.qty).forEach(function(id){ g += (D.protein[id] || 0) * (B.qty[id] || 0); });
      var n2 = document.getElementById('bx-near');
      if (n2 && g > 0) {
        n2.appendChild(document.createTextNode(' \\u00b7 '));
        var pEl = document.createElement('b');
        pEl.textContent = Math.round(g) + 'g protein';
        n2.appendChild(pEl);
      }
    }
  }

  // re-apply the chosen amount whenever the stack is rebuilt, so a sauce added after
  // the slider was moved matches the rest of the build
  var origApply = null;
  function reapplySauce(){ if (B && B.setSauce && state.sauce !== 1) B.setSauce(state.sauce); }

  function randomBuild(){
    var byCat = {};
    B.catalog.forEach(function(d){ if (!blocked(d.id)) (byCat[d.category] = byCat[d.category] || []).push(d); });
    Object.keys(B.qty).forEach(function(k){ B.qty[k] = 0; });
    function pick(a){ return a[Math.floor(Math.random() * a.length)]; }
    if (byCat.bread) B.qty[pick(byCat.bread).id] = 1;
    if (byCat.protein) B.qty[pick(byCat.protein).id] = 1 + Math.floor(Math.random() * 2);
    if (byCat.cheese && Math.random() > 0.2) B.qty[pick(byCat.cheese).id] = 1;
    if (byCat.veggie) { var n = 1 + Math.floor(Math.random() * 3); for (var i = 0; i < n; i++) B.qty[pick(byCat.veggie).id] = 1; }
    if (byCat.sauce) { var s = 1 + Math.floor(Math.random() * 2); for (var j = 0; j < s; j++) B.qty[pick(byCat.sauce).id] = 1; }
    B.rerender();
  }

  // A shareable card drawn on a canvas — no AI, no upload, just the build.
  function photoCard(){
    var lines = [];
    B.catalog.forEach(function(d){ var q = B.qty[d.id] || 0; if (q > 0) lines.push((q > 1 ? q + '\\u00d7 ' : '') + d.name); });
    if (!lines.length) return;
    var W = 900, H = 1200, c = document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext('2d');
    var accent = getComputedStyle(document.documentElement).getPropertyValue('--brand-red').trim() || '#e81b23';
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
    x.fillStyle = accent; x.fillRect(0, 0, W, 210);
    x.fillStyle = '#fff'; x.font = 'bold 46px Georgia, serif';
    x.fillText(D.restaurant || 'Build your own', 56, 100);
    x.font = '26px -apple-system, Segoe UI, Roboto, sans-serif';
    x.fillText(state.name || 'My custom burger', 56, 152);

    // the 3D canvas itself, so the card shows the actual creation. The scene is
    // redrawn first: without a fresh render the preserved buffer can still be a frame
    // behind (or empty on the very first capture).
    try {
      if (window.__BUILD__ && window.__BUILD__.render) window.__BUILD__.render();
      var src = document.getElementById('c');
      if (src && src.width) {
        // letterbox rather than stretch — a squashed burger is worse than a smaller one
        var bw = W - 112, bh = 470;
        var r = Math.min(bw / src.width, bh / src.height);
        var dw = src.width * r, dh = src.height * r;
        x.drawImage(src, 56 + (bw - dw) / 2, 250 + (bh - dh) / 2, dw, dh);
      }
    } catch (e) { /* tainted or unavailable — the text card still works */ }

    x.fillStyle = '#16130f'; x.font = 'bold 30px -apple-system, Segoe UI, Roboto, sans-serif';
    x.fillText('What\\u2019s in it', 56, 790);
    x.font = '25px -apple-system, Segoe UI, Roboto, sans-serif';
    x.fillStyle = '#4a443e';
    lines.slice(0, 10).forEach(function(t, i){ x.fillText('\\u2022 ' + t, 56, 840 + i * 34); });

    x.fillStyle = accent; x.fillRect(0, H - 96, W, 96);
    x.fillStyle = '#fff'; x.font = 'bold 34px -apple-system, Segoe UI, Roboto, sans-serif';
    x.fillText(D.currency + ' ' + B.totals().price, 56, H - 36);

    // Show it before it downloads — a file appearing in Downloads with no idea what
    // it looks like is not a share feature.
    var url;
    try { url = c.toDataURL('image/png'); } catch (e) { return; }
    var file = (state.name || 'my-burger').replace(/[^\\w-]+/g, '-').toLowerCase() + '.png';
    showCard(url, file);
  }

  function showCard(url, file){
    var back = document.getElementById('bx-cardview');
    if (back) back.remove();
    back = el('div', { id: 'bx-cardview' }, document.body);
    var box = el('div', { class: 'bx-cv-box' }, back);
    var img = el('img', { src: url, alt: 'Your burger' }, box);
    var row = el('div', { class: 'bx-cv-row' }, box);

    var dl = el('button', { type: 'button', class: 'bx-cv-primary', text: 'Save image' }, row);
    dl.onclick = function(){
      var a = document.createElement('a');
      a.download = file; a.href = url; a.click();
    };

    // Web Share carries the actual image on a phone; without it there is nothing
    // honest to offer, so the button simply is not shown.
    if (navigator.canShare) {
      var sh = el('button', { type: 'button', class: 'bx-cv-ghost', text: 'Share' }, row);
      sh.onclick = function(){
        fetch(url).then(function(r){ return r.blob(); }).then(function(b){
          var f = new File([b], file, { type: 'image/png' });
          if (navigator.canShare({ files: [f] })) return navigator.share({ files: [f] });
        }).catch(function(){});
      };
    }

    // one close path — removing the card via the button or the backdrop used to leave
    // the keydown listener attached (only Escape cleaned itself up), so every reopen
    // stacked another live listener on document
    function esc(e){ if (e.key === 'Escape') close(); }
    function close(){ back.remove(); document.removeEventListener('keydown', esc); }
    var cl = el('button', { type: 'button', class: 'bx-cv-ghost', text: 'Close' }, row);
    cl.onclick = close;
    back.onclick = function(e){ if (e.target === back) close(); };
    document.addEventListener('keydown', esc);
  }

  // the build "settles" when it is sent — one short cue, and skipped entirely for
  // anyone who has asked for reduced motion
  window.__BX_CONFIRM__ = function(){
    document.body.classList.add('bx-confirm');
    setTimeout(function(){ document.body.classList.remove('bx-confirm'); }, 600);
  };

  // the layout layer redraws the ingredient grid, and calls this to re-apply the
  // allergy greying and limited-time badges to the new nodes
  window.__BX_APPLY__ = function(){ apply(); reapplySauce(); };

  // hand the extras to the order when it is sent
  window.__BX_EXTRAS__ = function(){
    var DN = ['well done', 'medium', 'juicy'], SA = ['light sauce', 'regular sauce', 'extra sauce'];
    return {
      name: state.name || null,
      doneness: D.doneness ? DN[state.doneness] : null,
      sauce: SA[state.sauce],
      avoid: Object.keys(state.avoid).filter(function(k){ return state.avoid[k]; }),
      meal: Object.keys(state.meal).filter(function(k){ return state.meal[k]; }),
      kids: state.kids,
    };
  };
})();
</script>`;
}

// Allergens are properties of the INGREDIENT, not restaurant data we invented — cheese
// contains dairy wherever it is served. A restaurant can override any of these from
// config, and the page tells the customer to confirm with the kitchen regardless.
export const DEFAULT_ALLERGENS = {
  bun_plain: ["gluten"], bun_potato: ["gluten"], bun_pretzel: ["gluten"], bun_sesame: ["gluten", "sesame"],
  cheese_american: ["dairy"], cheese_cheddar: ["dairy"], cheese_emmental: ["dairy"],
  cheese_blue: ["dairy"], cheese_queso: ["dairy"],
  sauce_mayo: ["egg"], sauce_sriracha: ["egg"], sauce_crown: ["egg"], sauce_heel: ["egg"],
  fried_egg: ["egg"], coleslaw: ["egg", "dairy"], guacamole: [],
  chicken_crispy: ["gluten"], onion_strings: ["gluten"], patty_plant: ["soy"],
};
