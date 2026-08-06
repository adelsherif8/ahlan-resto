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
  /* THREE columns only when there is genuinely room for three. At 821px a
     288 + 320 pair leaves the burger about 200px, which is worse than two columns. */
  @media (min-width:1100px){
    #app{display:grid;grid-template-columns:330px 1fr 370px;grid-template-rows:minmax(0,1fr) auto;height:100%;overflow:hidden}
    /* min-height:0 on every one of these. A grid item defaults to min-height:auto,
       which makes it grow to fit its content instead of scrolling — which is why
       neither sidebar would scroll and the 3D column ate the screen. */
    #scene-container{grid-column:2;grid-row:1;height:100%;min-height:0;min-width:0;position:relative}
    #panel{grid-column:3;grid-row:1;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}
    #bx-left{grid-column:1;grid-row:1;display:flex;flex-direction:column;min-height:0;overflow-y:auto;
      -webkit-overflow-scrolling:touch;padding-top:58px;padding-bottom:14px;
      border-right:1px solid rgba(var(--brand-red-rgb),.18);
      background:linear-gradient(180deg,var(--panel-grad-1),var(--panel-grad-2))}
    .panel-summary{grid-column:1 / -1;grid-row:2;border-top:1px solid rgba(var(--brand-red-rgb),.18)}
    #bx-tabs{display:none}
  }
  /* TABLET: burger left, panel right, tabs inside the panel */
  @media (min-width:821px) and (max-width:1099px){
    #app{flex-direction:row;overflow:hidden}
    #scene-container{flex:1 1 auto;height:100%;min-width:0}
    #panel{flex:0 0 400px;width:400px;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}
  }
  /* Hide the rail ONLY below the three-column breakpoint. An unconditional
     display:none after the media query wins on source order and hid every control
     on desktop while still reserving the column for them. */
  @media (max-width:1099px){ #bx-left{display:none} }

  /* ---------- tabs (phone) ---------- */
  #bx-tabs{display:flex;gap:4px;padding:8px 12px 4px;position:sticky;top:0;z-index:3;
    background:linear-gradient(180deg,var(--panel-grad-1),var(--panel-grad-2))}
  #bx-tabs button{flex:1;border:0;border-radius:9px;padding:11px 6px;font-size:12.5px;font-weight:700;
    font-family:inherit;background:rgba(var(--brand-red-rgb),.10);color:var(--text-muted);cursor:pointer}
  #bx-tabs button.on{background:var(--brand-red);color:var(--text-on-accent)}
  /* tab switching applies wherever the tabs are shown — phone AND tablet */
  @media (max-width:1099px){
    body.bx-tab-build #bx-opts,body.bx-tab-build #bx-extras{display:none}
    body.bx-tab-opts #panel-scroll,body.bx-tab-opts #bx-extras{display:none}
    body.bx-tab-extras #panel-scroll,body.bx-tab-extras #bx-opts{display:none}
  }

  /* The brand logo is position:fixed at the top-left and was landing on top of the
     left rail's first heading. Give whatever sits under it room, and on a phone the
     panel is not at the top-left at all, so it only needs clearing in the scene. */
  #brand-logo{z-index:1200}
  /* the prototype's "Customize" title duplicates the tabs and eats vertical space */
  #panel .panel-header h2{display:none}
  #panel .panel-header{padding:0}

  /* ---------- ingredient cards ---------- */
  #panel-scroll{overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1 1 auto;min-height:0}
  /* the stack list gets its own scroll so a long build never pushes the
     sliders and buttons off the bottom of the rail */
  #bx-left #stack-list{max-height:34vh}
  .bx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;padding:0 12px 10px}
  @media (min-width:1200px){.bx-grid{grid-template-columns:repeat(auto-fill,minmax(118px,1fr))}}
  .bx-card{background:rgba(var(--brand-red-rgb),.05);border:1px solid rgba(var(--brand-red-rgb),.16);
    border-radius:11px;padding:6px;display:flex;flex-direction:column;gap:3px;position:relative}
  .bx-card.sel{border-color:var(--brand-red);background:rgba(var(--brand-red-rgb),.12)}
  .bx-thumb{width:100%;aspect-ratio:1/1;border-radius:8px;background:rgba(var(--brand-red-rgb),.06);display:block}
  .bx-card .t{font-size:11.5px;font-weight:700;line-height:1.25;color:var(--text-main)}
  .bx-card .p{font-size:10.5px;color:var(--text-muted)}
  .bx-card .ctl{display:flex;align-items:center;gap:6px;margin-top:auto}
  .bx-card .ctl button{flex:1;border:0;border-radius:7px;height:30px;font-size:15px;font-weight:800;
    background:rgba(var(--brand-red-rgb),.14);color:var(--text-main);cursor:pointer;font-family:inherit}
  .bx-card .ctl .n{min-width:22px;text-align:center;font-weight:800;font-variant-numeric:tabular-nums}
  .bx-card .pick{width:100%;border:0;border-radius:7px;height:30px;font-size:11.5px;font-weight:800;
    background:rgba(var(--brand-red-rgb),.14);color:var(--text-main);cursor:pointer;font-family:inherit}
  .bx-card.sel .pick{background:var(--brand-red);color:var(--text-on-accent)}
  .bx-cat{padding:11px 14px 5px;font-size:10px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-dim)}
  /* category filters — 24 ingredients across 5 groups is a long scroll to hunt through */
  #bx-filters{display:flex;gap:5px;overflow-x:auto;padding:9px 12px 8px;position:sticky;top:0;z-index:4;
    background:linear-gradient(180deg,var(--panel-grad-1),var(--panel-grad-2));-webkit-overflow-scrolling:touch;
    scrollbar-width:none}
  #bx-filters::-webkit-scrollbar{display:none}
  #bx-filters button{flex:0 0 auto;border:1px solid rgba(var(--brand-red-rgb),.25);background:transparent;
    color:var(--text-muted);border-radius:20px;padding:7px 13px;font-size:12px;font-weight:600;
    cursor:pointer;font-family:inherit;white-space:nowrap}
  #bx-filters button.on{background:var(--brand-red);border-color:var(--brand-red);color:var(--text-on-accent)}
  #bx-filters button .c{opacity:.65;font-weight:500;margin-left:3px}
  #bx-search{margin:0 12px 8px;position:relative}
  #bx-search input{width:100%;padding:10px 32px 10px 12px;border-radius:10px;font-family:inherit;font-size:13px;
    border:1px solid rgba(var(--brand-red-rgb),.22);background:transparent;color:var(--text-main)}
  #bx-search input::placeholder{color:var(--text-dim)}
  #bx-search .x{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;
    color:var(--text-dim);font-size:16px;cursor:pointer;font-family:inherit;padding:2px 6px}
  .bx-none{padding:14px;font-size:13px;color:var(--text-dim);text-align:center}
  .bx-card.bx-block{opacity:.32;pointer-events:none}
  /* the demo's own logged-in-user strip has no place on a customer page */
  .user-bar{display:none !important}
</style>
<script>
(function(){
  // Wait for the FEATURE layer too. Both scripts poll for __BUILD__, and when this one
  // won the race the left rail collected nothing and rendered as a big empty column.
  function ready(fn){
    if (window.__BUILD__ && document.getElementById('panel-scroll') && document.getElementById('bx-bar')) return fn();
    setTimeout(function(){ ready(fn); }, 60);
  }
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

    if (window.matchMedia('(min-width: 1100px)').matches) {
      left.appendChild(opts); left.appendChild(extras);
    } else {
      // tabs sit immediately above the list they switch, never above the header
      panel.insertBefore(tabs, scroll);
      panel.insertBefore(opts, scroll);
      panel.insertBefore(extras, scroll);
      setTab('build');
    }


    // ---- ingredient cards ----
    var CAT = { bread: 'Buns & wraps', protein: 'Protein', cheese: 'Cheese', veggie: 'Veggies', sauce: 'Sauces' };
    var ORDER = ['bread', 'protein', 'cheese', 'veggie', 'sauce'];
    var MAX = (window.__AHLAN__ && window.__AHLAN__.maxPerLayer) || 3;
    var CUR = (window.__AHLAN__ && window.__AHLAN__.currency) || 'EGP';

    var filter = 'all';
    var query = '';
    var POPULAR = (window.__AHLAN__ && window.__AHLAN__.popular) || [];

    function drawSearch(){
      var wrap = document.createElement('div');
      wrap.id = 'bx-search';
      var inp = document.createElement('input');
      inp.type = 'search'; inp.placeholder = 'Search ingredients'; inp.value = query;
      inp.oninput = function(){
        query = inp.value.trim().toLowerCase();
        var at = inp.selectionStart;
        draw();
        var again = document.querySelector('#bx-search input');
        if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) {} }
      };
      wrap.appendChild(inp);
      if (query) {
        var x = document.createElement('button');
        x.type = 'button'; x.className = 'x'; x.textContent = '\u00d7';
        x.onclick = function(){ query = ''; draw(); };
        wrap.appendChild(x);
      }
      scroll.appendChild(wrap);
    }

    function drawFilters(){
      var bar = document.createElement('div');
      bar.id = 'bx-filters';
      var groups = [['all', 'All']]
        .concat(POPULAR.length ? [['popular', 'Most ordered']] : [])
        .concat(ORDER
        .filter(function(c){ return B.catalog.some(function(d){ return d.category === c; }); })
        .map(function(c){ return [c, CAT[c] || c]; }));
      groups.forEach(function(g){
        var b = document.createElement('button');
        b.type = 'button';
        b.className = filter === g[0] ? 'on' : '';
        var n = g[0] === 'all' ? B.catalog.length
          : g[0] === 'popular' ? B.catalog.filter(function(d){ return POPULAR.indexOf(d.id) !== -1; }).length
          : B.catalog.filter(function(d){ return d.category === g[0]; }).length;
        b.innerHTML = '';
        b.appendChild(document.createTextNode(g[1]));
        var c = document.createElement('span'); c.className = 'c'; c.textContent = n;
        b.appendChild(c);
        b.onclick = function(){ filter = g[0]; draw(); scroll.scrollTop = 0; };
        bar.appendChild(b);
      });
      scroll.appendChild(bar);
    }

    function match(d){
      if (query && d.name.toLowerCase().indexOf(query) === -1) return false;
      if (filter === 'popular') return POPULAR.indexOf(d.id) !== -1;
      return true;
    }

    function draw(){
      scroll.innerHTML = '';
      drawFilters();
      drawSearch();
      var shown = 0;
      ORDER.forEach(function(cat){
        if (filter !== 'all' && filter !== 'popular' && cat !== filter) return;
        var items = B.catalog.filter(function(d){ return d.category === cat && match(d); });
        if (filter === 'popular') items.sort(function(a, b){ return POPULAR.indexOf(a.id) - POPULAR.indexOf(b.id); });
        shown += items.length;
        if (!items.length) return;
        if (filter === 'all' || filter === 'popular') {
          var h = document.createElement('div'); h.className = 'bx-cat'; h.textContent = CAT[cat] || cat;
          scroll.appendChild(h);
        }
        var g = document.createElement('div'); g.className = 'bx-grid';
        scroll.appendChild(g);
        items.forEach(function(d){
          var q = B.qty[d.id] || 0;
          var c = document.createElement('div');
          c.className = 'bx-card' + (q > 0 ? ' sel' : '');
          c.dataset.id = d.id;
          var img = document.createElement('canvas');
          img.className = 'bx-thumb'; img.width = 150; img.height = 150; img.dataset.thumb = d.id;
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
      if (!shown) {
        var none = document.createElement('div');
        none.className = 'bx-none';
        none.textContent = query ? 'Nothing matches "' + query + '"' : 'Nothing here yet';
        scroll.appendChild(none);
      }
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

    // The renderer sized itself to the ORIGINAL two-column layout before this script
    // rebuilt the grid, so its centre — and the burger with it — stayed where the old,
    // wider canvas used to be. Ask it to re-measure once the new grid has been laid
    // out, again next frame, and once more after fonts and scrollbars settle.
    function remeasure(){ window.dispatchEvent(new Event('resize')); }
    requestAnimationFrame(function(){ remeasure(); requestAnimationFrame(remeasure); });
    setTimeout(remeasure, 300);

    // never leave a dead column: if there is nothing in the rail, collapse it
    if (!left.textContent.trim() && !left.querySelector('button,input')) {
      left.style.display = 'none';
      document.getElementById('app').style.gridTemplateColumns = '1fr 340px';
    }
  });
})();
</script>`;
}
