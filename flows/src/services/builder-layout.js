// Layout: three columns on a big screen (controls · burger · ingredients), tabs on a
// phone. The prototype stacked everything into one endless scrolling panel, which put
// the ingredients — the thing people came to tap — below the fold under sliders.
//
// Ingredient cards carry a thumbnail RENDERED FROM THE INGREDIENT'S OWN MODEL, made
// lazily in the browser the first time a card is seen and cached, so nothing extra is
// downloaded and a phone never pays for 37 images it may not scroll to.

export function layoutScript() {
  return `
<style>
  /* ---------- three-column shell (desktop / tablet) ---------- */
  @media (min-width: 821px){
    #app{display:grid;grid-template-columns:288px 1fr 320px;grid-template-rows:1fr auto;height:100%}
    #scene-container{grid-column:2;grid-row:1;height:100%}
    #panel{grid-column:3;grid-row:1;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden}
    #bx-left{grid-column:1;grid-row:1;overflow-y:auto;border-right:1px solid rgba(var(--brand-red-rgb),.18);
      background:linear-gradient(180deg,var(--panel-grad-1),var(--panel-grad-2));padding-bottom:14px}
    .panel-summary{grid-column:1 / -1;grid-row:2;border-top:1px solid rgba(var(--brand-red-rgb),.18)}
    #bx-tabs{display:none}
  }
  /* everything the builder controls lives in the left rail on desktop */
  #bx-left{display:none}
  @media (min-width:821px){#bx-left{display:block}}

  /* ---------- tabs (phone) ---------- */
  #bx-tabs{display:flex;gap:4px;padding:8px 12px 4px;position:sticky;top:0;z-index:3;
    background:linear-gradient(180deg,var(--panel-grad-1),var(--panel-grad-2))}
  #bx-tabs button{flex:1;border:0;border-radius:9px;padding:11px 6px;font-size:12.5px;font-weight:700;
    font-family:inherit;background:rgba(var(--brand-red-rgb),.10);color:var(--text-muted);cursor:pointer}
  #bx-tabs button.on{background:var(--brand-red);color:var(--text-on-accent)}
  @media (max-width:820px){
    body.bx-tab-build #bx-opts,body.bx-tab-build #bx-extras{display:none}
    body.bx-tab-opts #panel-scroll,body.bx-tab-opts #bx-extras{display:none}
    body.bx-tab-extras #panel-scroll,body.bx-tab-extras #bx-opts{display:none}
  }

  /* ---------- ingredient cards ---------- */
  #panel-scroll{overflow-y:auto;flex:1}
  .bx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px;padding:0 12px 10px}
  .bx-card{background:rgba(var(--brand-red-rgb),.05);border:1px solid rgba(var(--brand-red-rgb),.16);
    border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:5px;position:relative}
  .bx-card.sel{border-color:var(--brand-red);background:rgba(var(--brand-red-rgb),.12)}
  .bx-thumb{width:100%;aspect-ratio:4/3;border-radius:8px;background:rgba(var(--brand-red-rgb),.06);
    object-fit:contain;display:block}
  .bx-card .t{font-size:12.5px;font-weight:700;line-height:1.25;color:var(--text-main)}
  .bx-card .p{font-size:11.5px;color:var(--text-muted)}
  .bx-card .ctl{display:flex;align-items:center;gap:6px;margin-top:auto}
  .bx-card .ctl button{flex:1;border:0;border-radius:8px;height:34px;font-size:16px;font-weight:800;
    background:rgba(var(--brand-red-rgb),.14);color:var(--text-main);cursor:pointer;font-family:inherit}
  .bx-card .ctl .n{min-width:22px;text-align:center;font-weight:800;font-variant-numeric:tabular-nums}
  .bx-card .pick{width:100%;border:0;border-radius:8px;height:34px;font-size:12.5px;font-weight:800;
    background:rgba(var(--brand-red-rgb),.14);color:var(--text-main);cursor:pointer;font-family:inherit}
  .bx-card.sel .pick{background:var(--brand-red);color:var(--text-on-accent)}
  .bx-cat{padding:12px 14px 6px;font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-dim)}
  .bx-card.bx-block{opacity:.32;pointer-events:none}
  /* the demo's own logged-in-user strip has no place on a customer page */
  .user-bar{display:none !important}
</style>
<script>
(function(){
  function ready(fn){ if (window.__BUILD__ && document.getElementById('panel-scroll')) return fn(); setTimeout(function(){ ready(fn); }, 60); }
  ready(function(){
    var B = window.__BUILD__;
    var panel = document.getElementById('panel');
    var scroll = document.getElementById('panel-scroll');
    var app = document.getElementById('app');

    // ---- left rail (desktop) / tab panes (phone) ----
    var left = document.createElement('div'); left.id = 'bx-left';
    app.appendChild(left);

    var opts = document.createElement('div'); opts.id = 'bx-opts';
    var extras = document.createElement('div'); extras.id = 'bx-extras';

    // move the pieces the feature layer added into the right groups
    function grab(id, into){ var n = document.getElementById(id); if (n) into.appendChild(n); }
    ['stack-panel'].forEach(function(id){ grab(id, opts); });
    ['bx-name', 'bx-allergy', 'bx-note'].forEach(function(id){ grab(id, opts); });
    var sl = document.querySelector('.bx-sl'); if (sl) opts.appendChild(sl);
    ['bx-bar', 'bx-presets', 'bx-meal', 'bx-near'].forEach(function(id){ grab(id, extras); });

    // ---- tabs, phone only ----
    var tabs = document.createElement('div'); tabs.id = 'bx-tabs';
    var defs = [['build', 'Ingredients'], ['opts', 'Your build'], ['extras', 'Extras']];
    defs.forEach(function(d){
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = d[1]; b.dataset.tab = d[0];
      b.onclick = function(){ setTab(d[0]); };
      tabs.appendChild(b);
    });
    function setTab(t){
      document.body.classList.remove('bx-tab-build', 'bx-tab-opts', 'bx-tab-extras');
      document.body.classList.add('bx-tab-' + t);
      tabs.querySelectorAll('button').forEach(function(b){ b.classList.toggle('on', b.dataset.tab === t); });
    }

    if (window.matchMedia('(min-width: 821px)').matches) {
      left.appendChild(opts); left.appendChild(extras);
    } else {
      panel.insertBefore(tabs, scroll);
      panel.insertBefore(opts, scroll);
      panel.insertBefore(extras, scroll);
      setTab('build');
    }
    panel.insertBefore(tabs, panel.firstChild.nextSibling || null);

    // ---- ingredient cards ----
    var CAT = { bread: 'Buns & wraps', protein: 'Protein', cheese: 'Cheese', veggie: 'Veggies', sauce: 'Sauces' };
    var ORDER = ['bread', 'protein', 'cheese', 'veggie', 'sauce'];
    var MAX = (window.__AHLAN__ && window.__AHLAN__.maxPerLayer) || 3;
    var CUR = (window.__AHLAN__ && window.__AHLAN__.currency) || 'EGP';

    function draw(){
      scroll.innerHTML = '';
      ORDER.forEach(function(cat){
        var items = B.catalog.filter(function(d){ return d.category === cat; });
        if (!items.length) return;
        var h = document.createElement('div'); h.className = 'bx-cat'; h.textContent = CAT[cat] || cat;
        scroll.appendChild(h);
        var g = document.createElement('div'); g.className = 'bx-grid';
        scroll.appendChild(g);
        items.forEach(function(d){
          var q = B.qty[d.id] || 0;
          var c = document.createElement('div');
          c.className = 'bx-card' + (q > 0 ? ' sel' : '');
          c.dataset.id = d.id;
          var img = document.createElement('canvas');
          img.className = 'bx-thumb'; img.width = 160; img.height = 120; img.dataset.thumb = d.id;
          c.appendChild(img);
          var t = document.createElement('div'); t.className = 't'; t.textContent = d.name; c.appendChild(t);
          var p = document.createElement('div'); p.className = 'p';
          p.textContent = d.price > 0 ? CUR + ' ' + d.price : 'included';
          c.appendChild(p);

          if (cat === 'bread') {
            var pick = document.createElement('button');
            pick.className = 'pick'; pick.type = 'button';
            pick.textContent = q > 0 ? 'Chosen' : 'Choose';
            pick.onclick = function(){
              B.catalog.forEach(function(x){ if (x.category === 'bread') B.qty[x.id] = 0; });
              B.qty[d.id] = 1; B.rerender(); draw();
            };
            c.appendChild(pick);
          } else {
            var ctl = document.createElement('div'); ctl.className = 'ctl';
            var m = document.createElement('button'); m.type = 'button'; m.textContent = '\\u2212';
            var n = document.createElement('span'); n.className = 'n'; n.textContent = q;
            var pl = document.createElement('button'); pl.type = 'button'; pl.textContent = '+';
            m.onclick = function(){ B.qty[d.id] = Math.max(0, (B.qty[d.id] || 0) - 1); B.rerender(); draw(); };
            pl.onclick = function(){ B.qty[d.id] = Math.min(MAX, (B.qty[d.id] || 0) + 1); B.rerender(); draw(); };
            ctl.appendChild(m); ctl.appendChild(n); ctl.appendChild(pl);
            c.appendChild(ctl);
          }
          g.appendChild(c);
        });
      });
      thumbs();
      if (window.__BX_APPLY__) window.__BX_APPLY__();
    }

    // The page redraws the old list on every change; ours replaces it. Re-draw after
    // the page's own render so the two never fight over the same container.
    var origRerender = B.rerender;
    B.rerender = function(){ origRerender(); draw(); };

    // ---- lazy thumbnails, rendered from each ingredient's own model ----
    var cache = {};
    function thumbs(){
      if (!window.__BUILD__ || !window.__BUILD__.thumbnail) return;
      var seen = new IntersectionObserver(function(entries){
        entries.forEach(function(e){
          if (!e.isIntersecting) return;
          var cv = e.target, id = cv.dataset.thumb;
          seen.unobserve(cv);
          if (cache[id]) { paint(cv, cache[id]); return; }
          window.__BUILD__.thumbnail(id, function(url){
            if (!url) return;
            cache[id] = url;
            paint(cv, url);
          });
        });
      }, { rootMargin: '160px' });
      scroll.querySelectorAll('[data-thumb]').forEach(function(cv){ seen.observe(cv); });
    }
    function paint(cv, url){
      var im = new Image();
      im.onload = function(){
        var x = cv.getContext('2d');
        x.clearRect(0, 0, cv.width, cv.height);
        var r = Math.min(cv.width / im.width, cv.height / im.height);
        x.drawImage(im, (cv.width - im.width * r) / 2, (cv.height - im.height * r) / 2, im.width * r, im.height * r);
      };
      im.src = url;
    }

    draw();
  });
})();
</script>`;
}
