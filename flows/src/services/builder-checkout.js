// Checkout. "Send order" used to be the first step of a checkout wearing the label of
// the last one — one tap and it was gone, with no name, no number, no meal, no receipt.
//
// Two different endings, because there are two different customers:
//   · came from WhatsApp → the build goes BACK to that conversation, where they already
//     choose delivery/pickup, address and payment. It never jumps the queue to the kitchen.
//   · came from a QR or the counter → we take a name and number (the receipt tells them
//     to message that number to track it) and the ticket goes straight to the kitchen.

export function checkoutScript() {
  return `
<style>
  #co{position:fixed;inset:0;z-index:9998;background:rgba(12,8,8,.6);display:flex;align-items:flex-end;
    justify-content:center;backdrop-filter:blur(3px)}
  @media (min-width:700px){#co{align-items:center}}
  .co-box{background:var(--panel-grad-1,#fff);color:var(--text-main,#16130f);width:100%;max-width:440px;
    border-radius:18px 18px 0 0;padding:18px 18px max(18px,env(safe-area-inset-bottom));max-height:92vh;
    overflow-y:auto;display:flex;flex-direction:column;gap:12px}
  @media (min-width:700px){.co-box{border-radius:18px}}
  .co-steps{display:flex;gap:5px;margin-bottom:2px}
  .co-steps i{flex:1;height:3px;border-radius:2px;background:rgba(var(--brand-red-rgb),.18)}
  .co-steps i.on{background:var(--brand-red)}
  .co-h{font-size:18px;font-weight:800;margin:0}
  .co-sub{font-size:13px;color:var(--text-muted);margin:-6px 0 0;line-height:1.5}
  .co-f{display:flex;flex-direction:column;gap:5px}
  .co-f label{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);font-weight:700}
  .co-f input{padding:13px;border-radius:11px;border:1px solid rgba(var(--brand-red-rgb),.25);
    background:transparent;color:var(--text-main);font-family:inherit;font-size:15px}
  .co-err{color:#c2410c;font-size:12.5px;min-height:16px}
  .co-list{display:flex;flex-direction:column;gap:6px}
  .co-item{display:flex;gap:9px;font-size:14px;padding:7px 0;border-bottom:1px solid rgba(var(--brand-red-rgb),.12)}
  .co-item b{color:var(--brand-red);min-width:24px}
  .co-item span{flex:1}
  .co-tot{display:flex;justify-content:space-between;font-size:17px;font-weight:800;padding-top:6px}
  .co-side{display:flex;align-items:center;gap:10px;border:1px solid rgba(var(--brand-red-rgb),.2);
    border-radius:11px;padding:11px;font-size:14px;cursor:pointer;font-family:inherit;background:transparent;
    color:var(--text-main);text-align:left;width:100%}
  .co-side.on{border-color:var(--brand-red);background:rgba(var(--brand-red-rgb),.09);font-weight:700}
  .co-side .p{margin-left:auto;color:var(--text-muted);font-size:13px}
  .co-row{display:flex;gap:8px;margin-top:2px}
  .co-row button{flex:1;border:0;border-radius:12px;padding:15px;font-size:15px;font-weight:800;
    cursor:pointer;font-family:inherit}
  .co-primary{background:var(--brand-red);color:var(--text-on-accent)}
  .co-ghost{background:rgba(var(--brand-red-rgb),.10);color:var(--text-main)}
  .co-primary:disabled{opacity:.5;cursor:default}

  /* sending: the bag lifts, wraps and travels — it should feel like it went somewhere */
  .co-send{display:flex;flex-direction:column;align-items:center;gap:14px;padding:26px 0}
  .co-bag{width:76px;height:76px;border-radius:18px;background:var(--brand-red);display:flex;
    align-items:center;justify-content:center;color:#fff;animation:co-fly 1.15s cubic-bezier(.5,0,.3,1) forwards}
  @keyframes co-fly{
    0%{transform:translate(0,14px) scale(.82);opacity:0}
    28%{transform:translate(0,0) scale(1);opacity:1}
    58%{transform:translate(0,-6px) scale(1.04)}
    100%{transform:translate(150px,-120px) scale(.35) rotate(12deg);opacity:0}
  }
  .co-track{width:190px;height:3px;border-radius:2px;background:rgba(var(--brand-red-rgb),.16);overflow:hidden}
  .co-track i{display:block;height:100%;width:0;background:var(--brand-red);animation:co-fill 1.15s linear forwards}
  @keyframes co-fill{to{width:100%}}
  .co-code{font-size:30px;font-weight:800;letter-spacing:2px}
  @media (prefers-reduced-motion:reduce){
    .co-bag{animation:none}.co-track i{animation:none;width:100%}
  }
</style>
<script>
(function(){
  function ready(fn){ if (window.__BUILD__ && document.getElementById('send-order')) return fn(); setTimeout(function(){ ready(fn); }, 60); }

  ready(function(){
    var B = window.__BUILD__, A = window.__AHLAN__ || {};
    var btn = document.getElementById('send-order');
    var meal = {};

    // the page's own click handler would post immediately — replace the node to drop it
    var fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', open);

    function lines(){
      var out = [];
      B.catalog.forEach(function(d){ var q = B.qty[d.id] || 0; if (q > 0) out.push({ n: d.name, q: q, p: d.price * q }); });
      return out;
    }

    function open(){
      var l = lines();
      if (!l.length) return;
      var x = (typeof window.__BX_EXTRAS__ === 'function') ? window.__BX_EXTRAS__() : {};
      // a customer we already know (link came from the chat) skips straight to the meal
      var step = A.fromChat ? 1 : 0;
      var who = { name: x.name || '', phone: '' };
      var mealAsked = false;
      render();

      function render(){
        var back = document.getElementById('co');
        if (back) back.remove();
        back = document.createElement('div'); back.id = 'co';
        var box = document.createElement('div'); box.className = 'co-box';
        back.appendChild(box);
        document.body.appendChild(back);
        back.onclick = function(e){ if (e.target === back && step < 3) back.remove(); };

        var bar = document.createElement('div'); bar.className = 'co-steps';
        for (var i = 0; i < 3; i++) { var t = document.createElement('i'); if (i <= step) t.className = 'on'; bar.appendChild(t); }
        box.appendChild(bar);

        if (step === 0) return stepWho(box);
        if (step === 1) return stepMeal(box);
        if (step === 2) return stepReview(box);
      }

      function h(box, title, sub){
        var a = document.createElement('h3'); a.className = 'co-h'; a.textContent = title; box.appendChild(a);
        if (sub) { var b = document.createElement('p'); b.className = 'co-sub'; b.textContent = sub; box.appendChild(b); }
      }

      function field(box, label, value, type, oninput){
        var w = document.createElement('div'); w.className = 'co-f';
        var la = document.createElement('label'); la.textContent = label; w.appendChild(la);
        var inp = document.createElement('input'); inp.type = type || 'text'; inp.value = value || '';
        inp.oninput = function(){ oninput(inp.value); };
        w.appendChild(inp); box.appendChild(w);
        return inp;
      }

      function stepWho(box){
        h(box, 'Who is this for?', 'We need a number so you can track the order — and so we remember your build next time.');
        field(box, 'Name', who.name, 'text', function(v){ who.name = v; });
        field(box, 'Phone number', who.phone, 'tel', function(v){ who.phone = v; });
        var err = document.createElement('div'); err.className = 'co-err'; box.appendChild(err);
        var row = document.createElement('div'); row.className = 'co-row';
        var back2 = document.createElement('button'); back2.className = 'co-ghost'; back2.textContent = 'Back';
        back2.onclick = function(){ document.getElementById('co').remove(); };
        var next = document.createElement('button'); next.className = 'co-primary'; next.textContent = 'Continue';
        next.onclick = function(){
          if (String(who.phone).replace(/\\D/g, '').length < 8) { err.textContent = 'Please enter a valid phone number.'; return; }
          step = 1; render();
        };
        row.appendChild(back2); row.appendChild(next); box.appendChild(row);
      }

      // Ask the QUESTION first, then show the picker only to someone who said yes.
      // Leading with a wall of sides makes the answer look like work.
      function stepMeal(box){
        var sides = A.sides || [];
        if (!sides.length) { step = 2; return render(); }

        if (!mealAsked) {
          h(box, 'Make it a meal?', 'Add fries, a side or a drink from the menu.');
          var row0 = document.createElement('div'); row0.className = 'co-row';
          var no = document.createElement('button'); no.className = 'co-ghost'; no.textContent = 'No thanks';
          no.onclick = function(){ meal = {}; step = 2; render(); };
          var yes = document.createElement('button'); yes.className = 'co-primary'; yes.textContent = 'Yes please';
          yes.onclick = function(){ mealAsked = true; render(); };
          row0.appendChild(no); row0.appendChild(yes); box.appendChild(row0);
          return;
        }

        h(box, 'Pick your extras', 'Tap anything you want with it.');
        sides.forEach(function(sd){
          var b = document.createElement('button');
          b.className = 'co-side' + (meal[sd.name] ? ' on' : '');
          b.type = 'button';
          b.appendChild(document.createTextNode(sd.name));
          var p = document.createElement('span'); p.className = 'p'; p.textContent = A.currency + ' ' + sd.price;
          b.appendChild(p);
          b.onclick = function(){ meal[sd.name] = !meal[sd.name]; render(); };
          box.appendChild(b);
        });
        var picked = Object.keys(meal).filter(function(k){ return meal[k]; }).length;
        var row = document.createElement('div'); row.className = 'co-row';
        var back = document.createElement('button'); back.className = 'co-ghost'; back.textContent = 'Back';
        back.onclick = function(){ mealAsked = false; meal = {}; render(); };
        var next = document.createElement('button'); next.className = 'co-primary';
        next.textContent = picked ? 'Add ' + picked + ' and continue' : 'Continue';
        next.onclick = function(){ step = 2; render(); };
        row.appendChild(back); row.appendChild(next); box.appendChild(row);
      }

      function stepReview(box){
        h(box, 'Your order', A.fromChat ? 'We\\u2019ll send this back to your WhatsApp chat to finish.' : null);
        var wrap = document.createElement('div'); wrap.className = 'co-list';
        lines().forEach(function(it){
          var r = document.createElement('div'); r.className = 'co-item';
          var q = document.createElement('b'); q.textContent = it.q + '\\u00d7';
          var n = document.createElement('span'); n.textContent = it.n;
          var p = document.createElement('em'); p.style.fontStyle = 'normal'; p.textContent = it.p ? A.currency + ' ' + it.p : 'included';
          r.appendChild(q); r.appendChild(n); r.appendChild(p);
          wrap.appendChild(r);
        });
        var chosen = Object.keys(meal).filter(function(k){ return meal[k]; });
        chosen.forEach(function(k){
          var sd = (A.sides || []).find(function(x){ return x.name === k; }) || { price: 0 };
          var r = document.createElement('div'); r.className = 'co-item';
          var q = document.createElement('b'); q.textContent = '1\\u00d7';
          var n = document.createElement('span'); n.textContent = k;
          var p = document.createElement('em'); p.style.fontStyle = 'normal'; p.textContent = A.currency + ' ' + sd.price;
          r.appendChild(q); r.appendChild(n); r.appendChild(p);
          wrap.appendChild(r);
        });
        box.appendChild(wrap);

        var extra = chosen.reduce(function(t, k){
          var sd = (A.sides || []).find(function(x){ return x.name === k; });
          return t + (sd ? sd.price : 0);
        }, 0);
        var tot = document.createElement('div'); tot.className = 'co-tot';
        var tl = document.createElement('span'); tl.textContent = 'Total';
        var tv = document.createElement('span'); tv.textContent = A.currency + ' ' + (B.totals().price + extra);
        tot.appendChild(tl); tot.appendChild(tv); box.appendChild(tot);

        var err = document.createElement('div'); err.className = 'co-err'; box.appendChild(err);
        var row = document.createElement('div'); row.className = 'co-row';
        var back2 = document.createElement('button'); back2.className = 'co-ghost'; back2.textContent = 'Back';
        back2.onclick = function(){ step = A.fromChat ? 1 : 0; mealAsked = false; render(); };
        var go = document.createElement('button'); go.className = 'co-primary';
        go.textContent = A.fromChat ? 'Send to my chat' : 'Send to kitchen';
        go.onclick = function(){ send(box, go, err); };
        row.appendChild(back2); row.appendChild(go); box.appendChild(row);
      }

      async function send(box, go, err){
        go.disabled = true;
        var items = [];
        B.catalog.forEach(function(d){ var q = B.qty[d.id] || 0; if (q > 0) items.push({ id: d.id, quantity: q }); });
        var x2 = (typeof window.__BX_EXTRAS__ === 'function') ? window.__BX_EXTRAS__() : {};
        x2.meal = Object.keys(meal).filter(function(k){ return meal[k]; });
        try {
          var r = await fetch(A.submitUrl, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ items: items, extras: x2, customer: { name: who.name, phone: who.phone } }),
          });
          var j = await r.json();
          if (!j.ok) { go.disabled = false; err.textContent = j.error === 'phone required' ? 'We need a phone number.' : (j.error || 'Could not send.'); return; }
          step = 3;
          sending(box, j);
        } catch (e) {
          go.disabled = false;
          err.textContent = 'No connection — try again.';
        }
      }

      function sending(box, j){
        box.innerHTML = '';
        var w = document.createElement('div'); w.className = 'co-send';
        var bag = document.createElement('div'); bag.className = 'co-bag';
        bag.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';
        var tr = document.createElement('div'); tr.className = 'co-track'; tr.innerHTML = '<i></i>';
        var msg = document.createElement('div'); msg.className = 'co-sub';
        msg.textContent = j.handoff ? 'Sending to your WhatsApp chat\\u2026' : 'Sending to the kitchen\\u2026';
        w.appendChild(bag); w.appendChild(tr); w.appendChild(msg);
        box.appendChild(w);
        setTimeout(function(){ done(box, j); }, 1250);
      }

      function done(box, j){
        box.innerHTML = '';
        if (j.handoff) {
          h(box, 'Sent to your chat \\u2713', 'Open WhatsApp to choose delivery or pickup and finish your order.');
        } else {
          var c = document.createElement('div'); c.className = 'co-code'; c.textContent = j.code || '';
          box.appendChild(c);
          h(box, 'The kitchen has it \\u2713', 'Message us on WhatsApp with this code any time to track it.');
        }
        var row = document.createElement('div'); row.className = 'co-row';
        var share = document.createElement('button'); share.className = 'co-ghost'; share.textContent = 'Share this build';
        share.onclick = async function(){
          var items = [];
          B.catalog.forEach(function(d){ var q = B.qty[d.id] || 0; if (q > 0) items.push({ id: d.id, quantity: q }); });
          share.textContent = 'Getting link\u2026';
          try {
            var r = await fetch(A.submitUrl.replace('/submit', '/share'), {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ items: items }),
            });
            var j = await r.json();
            if (!j.url) { share.textContent = 'Share this build'; return; }
            if (navigator.share) { await navigator.share({ title: 'My burger', url: j.url }); share.textContent = 'Share this build'; return; }
            await navigator.clipboard.writeText(j.url);
            share.textContent = 'Link copied \u2713';
          } catch (e) { share.textContent = 'Share this build'; }
        };
        box.appendChild(share);

        var again = document.createElement('button'); again.className = 'co-ghost'; again.textContent = 'Build another';
        again.onclick = function(){
          Object.keys(B.qty).forEach(function(k){ B.qty[k] = 0; });
          B.rerender();
          document.getElementById('co').remove();
        };
        var close = document.createElement('button'); close.className = 'co-primary'; close.textContent = 'Done';
        close.onclick = function(){ document.getElementById('co').remove(); };
        row.appendChild(again); row.appendChild(close); box.appendChild(row);
      }
    }
  });
})();
</script>`;
}
