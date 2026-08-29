/* Munadim · the reference site's choreography, our content.
 *
 * preloader (1.8 s cap) → hero card opens → headline masks up → bubbles land
 * as you scroll → copy swaps → hero shrinks and lifts away → one pinned
 * reveal (the arithmetic) → quiet entrances → accordion → the slider maths.
 * Reduced motion skips every bit of it and shows the final states.
 */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $  = function (s) { return document.querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };

  /* ───────────────────────── the plans (code computes) ─────────────────── */

  var TIERS = [
    { name: 'Start', monthly: 3500,  included: 300,  over: 9 },
    { name: 'Grow',  monthly: 8500,  included: 1000, over: 8 },
    { name: 'Chain', monthly: 20000, included: 2500, over: 7 }
  ];
  var APP_RATE = 0.2;

  function costOn(tier, orders) {
    return tier.monthly + Math.max(0, orders - tier.included) * tier.over;
  }
  function cheapest(orders) {
    var best = TIERS[0], bestCost = costOn(TIERS[0], orders);
    for (var i = 1; i < TIERS.length; i++) {
      var c = costOn(TIERS[i], orders);
      if (c < bestCost) { best = TIERS[i]; bestCost = c; }
    }
    return { tier: best, cost: bestCost };
  }

  /* ─────────────────────── the pinned dial ─────────────────────────────── */

  var ORD_MIN = 300, ORD_MAX = 2500, DIAL_AOV = 150;
  function renderRig(p) {
    var orders = ORD_MIN + (ORD_MAX - ORD_MIN) * p;
    var app = orders * DIAL_AOV * APP_RATE;
    var pick = cheapest(orders);
    var el;
    if ((el = $('#m-orders'))) el.textContent = fmt(orders);
    if ((el = $('#m-plan2')))  el.textContent = pick.tier.name;
    if ((el = $('#m-app')))    el.textContent = fmt(app);
    if ((el = $('#m-ours')))   el.textContent = fmt(pick.cost);
    if ((el = $('#m-diff')))   el.textContent = fmt(app - pick.cost);
    if ((el = $('#m-fill')))   el.style.width = (p * 100) + '%';
    if ((el = $('#m-bar-app'))) el.style.width = '100%';
    if ((el = $('#m-bar-ours'))) el.style.width = Math.max(4, (pick.cost / app) * 100) + '%';
  }

  /* ─────────────────────── the slider calculator ───────────────────────── */

  (function () {
    var aovR = $('#c-aov-r'), ordR = $('#c-ord-r');
    if (!aovR || !ordR) return;
    function run() {
      var aov = +aovR.value, orders = +ordR.value;
      var app = orders * aov * APP_RATE;
      var pick = cheapest(orders);
      $('#c-aov').textContent = fmt(aov);
      $('#c-ord').textContent = fmt(orders);
      $('#c-app').textContent = fmt(app);
      $('#c-plan').textContent = pick.tier.name;
      $('#c-ours').textContent = fmt(pick.cost);
      $('#c-diff').textContent = fmt(app - pick.cost);
      $$('.card[data-plan]').forEach(function (c) {
        c.classList.toggle('is-fit', c.getAttribute('data-plan') === pick.tier.name);
      });
    }
    aovR.addEventListener('input', run);
    ordR.addEventListener('input', run);
    run();
  })();

  /* ───────────────────────── FAQ accordion ─────────────────────────────── */

  (function () {
    var items = $$('#faq-list .faq__item');
    if (!items.length) return;
    function setOpen(item, open, animate) {
      var panel = item.querySelector('.faq__a');
      var btn = item.querySelector('.faq__q');
      var inner = panel.firstElementChild;
      item.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      var h = open ? inner.offsetHeight : 0;
      if (animate && !reduce && window.gsap) gsap.to(panel, { height: h, duration: .38, ease: 'power2.out' });
      else panel.style.height = open ? 'auto' : '0px';
    }
    items.forEach(function (item, i) {
      setOpen(item, i === 0, false);
      item.querySelector('.faq__q').addEventListener('click', function () {
        var open = !item.classList.contains('is-open');
        items.forEach(function (o) { if (o !== item) setOpen(o, false, true); });
        setOpen(item, open, true);
      });
    });
    window.addEventListener('resize', function () {
      items.forEach(function (it) {
        if (it.classList.contains('is-open')) it.querySelector('.faq__a').style.height = 'auto';
      });
    });
  })();

  /* ───────────────────── reduced-motion short circuit ──────────────────── */

  if (reduce || !window.gsap) {
    renderRig(1);
    var pre = $('#pre'); if (pre) pre.remove();
    document.body.style.overflow = '';
    return;
  }

  document.documentElement.classList.add('js');
  gsap.registerPlugin(ScrollTrigger);
  renderRig(0);

  /* ───────────────────────────── preloader ─────────────────────────────── */

  document.body.style.overflow = 'hidden';
  window.scrollTo(0, 0);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* one piece of joined script rises through the mask; the rule is the only
   * "progress" and it's tied to the fonts actually being ready */
  gsap.timeline({ onComplete: openHero })
    .to('.pre__word b', { y: 0, duration: .75, ease: 'power4.out' }, .1)
    .to('.pre__rule i', { scaleX: 1, duration: .7, ease: 'power2.inOut' }, .25)
    .to('.pre__brand', { opacity: 1, duration: .4 }, .5)
    .to({}, { duration: .15 });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {});

  /* ───────────────────────── hero choreography ─────────────────────────── */

  var bubbles = $$('#hero-chat .chat__b:not(.chat__typing)');
  var typings = $$('#hero-chat .chat__typing');
  gsap.set(bubbles, { autoAlpha: 0, y: 14 });
  gsap.set(typings, { display: 'none' });
  function landSeq(list, tl, at) {
    list.forEach(function (b, i) {
      var typ = b.previousElementSibling && b.previousElementSibling.classList.contains('chat__typing') ? b.previousElementSibling : null;
      var pos = (i === 0 && at != null) ? at : '>';
      if (typ) {
        tl.set(typ, { display: 'flex', autoAlpha: 1 }, pos)
          .to({}, { duration: .55 })
          .set(typ, { display: 'none' });
        pos = '>';
      }
      tl.to(b, { autoAlpha: 1, y: 0, duration: .45, ease: 'power3.out' }, pos);
      if (i === 0 || typ) tl.to({}, { duration: .2 });
    });
  }

  function openHero() {
    var spacer = $('.hero-spacer');
    var words  = $$('.ln .w i');
    var sub1 = $('#sub1'), sub2 = $('#sub2'), sub3 = $('#sub3');
    var beats = $$('#hero-beat span');
    var card = $('#hero-card');
    function beat(n) { beats.forEach(function (b, i) { b.classList.toggle('is-on', i === n); }); }

    gsap.set([sub1, sub2, sub3], { autoAlpha: 0 });
    gsap.set(card, { autoAlpha: 0, x: 40, y: 30 });
    gsap.set('.hero__cta', { autoAlpha: 0, y: 12 });

    var intro = gsap.timeline({
      onComplete: function () {
        document.body.style.overflow = '';
        ScrollTrigger.refresh();
      }
    });

    intro.to('.pre__word b', { y: '-110%', duration: .5, ease: 'power3.in' }, 0);
    intro.to(['.pre__rule', '.pre__brand'], { autoAlpha: 0, duration: .3 }, 0);
    intro.to('#pre', { autoAlpha: 0, duration: .35, onComplete: function () { $('#pre').style.display = 'none'; } }, .4);
    intro.to('#hero-frame', { width: '100%', height: '100%', borderRadius: 0, duration: 1.0, ease: 'power3.inOut' }, .75);
    intro.to('#hero-bar', { height: 0, opacity: 0, padding: 0, duration: .8, ease: 'power3.inOut' }, .75);
    intro.to(words, { y: 0, duration: .85, stagger: .07, ease: 'power4.out' }, 1.2);
    intro.to(sub1, { autoAlpha: 1, duration: .5, ease: 'power2.out' }, 1.7);
    intro.to('.hero__cta', { autoAlpha: 1, y: 0, duration: .5, ease: 'power2.out' }, 1.85);
    // the first two bubbles land on their own; the rest wait for the scroll
    landSeq(bubbles.slice(0, 3), intro, 1.45);
    intro.to(['#nav', '#pill'], {
      opacity: 1, duration: .5, ease: 'power2.out',
      onComplete: function () { $('#nav').classList.add('is-on'); $('#pill').classList.add('is-on'); }
    }, 1.4);

    gsap.to('#hero-hint', {
      autoAlpha: 0, ease: 'none',
      scrollTrigger: { trigger: spacer, start: 'top top', end: '8% top', scrub: .3 }
    });

    // the conversation plays out across the first half of the runway
    var rest = bubbles.slice(3);
    if (rest.length) {
      var restTl = gsap.timeline({ scrollTrigger: { trigger: spacer, start: '3% top', end: '38% top', scrub: .35 } });
      landSeq(rest, restTl, 0);
    }
    // the phone never sits still: a slow drift across the whole runway
    gsap.to('#hero-chat', { y: '-9vh', ease: 'none',
      scrollTrigger: { trigger: spacer, start: 'top top', end: '60% top', scrub: .3 } });
    // the payoff: the record card slides fully out from behind the phone
    gsap.set(card, { autoAlpha: 0, x: 140, y: 40 });
    gsap.timeline({ scrollTrigger: { trigger: spacer, start: '36% top', end: '50% top', scrub: .3 } })
      .to(card, { autoAlpha: 1, x: 0, y: 0, ease: 'power2.out' });
    // the beat under the kicker follows the story: order → kitchen → customer kept
    ScrollTrigger.create({ trigger: spacer, start: '18% top', onEnter: function () { beat(1); }, onLeaveBack: function () { beat(0); } });
    ScrollTrigger.create({ trigger: spacer, start: '36% top', onEnter: function () { beat(2); }, onLeaveBack: function () { beat(1); } });

    // copy swap: three lines in one slot
    function swap(out, into) {
      gsap.to(out, { autoAlpha: 0, y: -18, duration: .35, ease: 'power2.in', overwrite: true });
      gsap.fromTo(into, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: .45, delay: .2, ease: 'power3.out', overwrite: true });
    }
    ScrollTrigger.create({ trigger: spacer, start: '18% top', onEnter: function () { swap(sub1, sub2); }, onLeaveBack: function () { swap(sub2, sub1); } });
    ScrollTrigger.create({ trigger: spacer, start: '36% top', onEnter: function () { swap(sub2, sub3); }, onLeaveBack: function () { swap(sub3, sub2); } });

    // copy drifts up and fades as the frame prepares to leave
    gsap.to('#hero-copy', {
      yPercent: -18, ease: 'none',
      scrollTrigger: { trigger: spacer, start: '44% top', end: '62% top', scrub: .25 }
    });
    gsap.to('#hero-copy', {
      autoAlpha: 0, ease: 'none',
      scrollTrigger: { trigger: spacer, start: '52% top', end: '62% top', scrub: .25 }
    });

    // the frame shrinks back to a card, then lifts away
    var exit = gsap.timeline({
      scrollTrigger: { trigger: spacer, start: '56% top', end: '96% top', scrub: .3 }
    });
    exit.to('#hero-frame', { scale: .92, borderRadius: '14px', duration: .3, ease: 'power2.inOut' });
    exit.to('#hero-frame', { scale: .34, borderRadius: '18px', duration: .8, ease: 'power1.inOut' }, '>-.05');
    exit.to('#hero-frame', { yPercent: -95, autoAlpha: 0, duration: .7, ease: 'power2.in' }, '>-.35');
    exit.set('#hero', { display: 'none' });
  }

  /* ───────────────────── the one pinned section ────────────────────────── */

  window.addEventListener('load', function () { ScrollTrigger.refresh(); });

  ScrollTrigger.create({
    trigger: '#scale-pin',
    start: 'top top',
    end: '+=' + Math.round(window.innerHeight * 1.3),
    pin: true,
    anticipatePin: 1,
    scrub: .4,
    onUpdate: function (self) {
      /* rest on 300 at the top and 2,500 at the bottom; only the middle
       * window spins, so the dial reads as a dial, not a random number */
      var p = gsap.utils.clamp(0, 1, (self.progress - 0.25) / 0.5);
      renderRig(p * p * (3 - 2 * p));
    }
  });

  /* ─────────────────────── quiet entrances ─────────────────────────────── */

  var groups = [
    { sel: '.sec-head, .scale__head', y: 22 },
    { sel: '.panel, .tile, .strip__cell, .steps li, .deal, .card, .calc, .faq__item, .composer', y: 26 }
  ];
  groups.forEach(function (g) {
    gsap.utils.toArray(g.sel).forEach(function (el) {
      gsap.from(el, { y: g.y, autoAlpha: 0, duration: .65, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
    });
  });

  // the steps rail draws itself as you pass
  var stepsFill = $('#steps-fill');
  if (stepsFill) {
    gsap.to(stepsFill, { width: '100%', ease: 'none',
      scrollTrigger: { trigger: '#steps', start: 'top 80%', end: 'bottom 60%', scrub: .5 } });
  }


  /* ─────────────────────── the scenes (auto-play once, replay) ─────────── */

  function counter(el, to, dur, fmtFn) {
    var o = { v: 0 };
    return gsap.to(o, { v: to, duration: dur || 1.2, ease: 'power2.out',
      onUpdate: function () { el.textContent = (fmtFn || fmt)(o.v); } });
  }
  function typeInto(el, text, dur) {
    var o = { n: 0 };
    return gsap.fromTo(o, { n: 0 }, { n: text.length, duration: dur || .9, ease: 'none',
      onStart: function () { el.classList.add('type-caret'); },
      onUpdate: function () { el.textContent = text.slice(0, Math.round(o.n)); },
      onComplete: function () { el.textContent = text; el.classList.remove('type-caret'); } });
  }
  function scene(root, build, startAt) {
    if (!root) return;
    var tl = gsap.timeline({ paused: true });
    build(tl, root);
    ScrollTrigger.create({ trigger: root, start: startAt || 'top 72%', once: true, onEnter: function () { tl.play(0); } });
    $$('[data-replay="' + root.id + '"]').forEach(function (b) {
      b.addEventListener('click', function () { tl.play(0); });
    });
    return tl;
  }

  /* 2 · one order → three outputs */
  scene($('#scene-outputs'), function (tl, root) {
    var runner = root.querySelector('.rail__runner');
    var panels = $$('.panel', root);
    var receipt = $$('.panel:nth-child(2) .wa__b > *', root);
    var ticket = $$('.panel:nth-child(3) .ticket > *', root);
    var stats = $$('.panel:nth-child(4) [data-count]', root);
    var rows = $$('.panel:nth-child(4) .record__row, .panel:nth-child(4) .record__badge', root);
    var rtl = document.documentElement.dir === 'rtl';
    tl.set(runner, { autoAlpha: 0, xPercent: 0 })
      .set([receipt, ticket, rows], { autoAlpha: 0, y: 8 })
      .to(runner, { autoAlpha: 1, duration: .3 })
      .to(runner, { x: rtl ? '-=' + (panels[0].offsetWidth * 0.35) : '+=' + (panels[0].offsetWidth * 0.35), duration: .6, ease: 'power2.inOut' })
      .to(receipt, { autoAlpha: 1, y: 0, duration: .25, stagger: .12 }, '-=.1')
      .to(runner, { x: rtl ? '-=' + (panels[0].offsetWidth * 1.1) : '+=' + (panels[0].offsetWidth * 1.1), duration: .7, ease: 'power2.inOut' })
      .to(ticket, { autoAlpha: 1, y: 0, duration: .18, stagger: .07 }, '-=.1')
      .to(runner, { x: rtl ? '-=' + (panels[0].offsetWidth * 1.1) : '+=' + (panels[0].offsetWidth * 1.1), duration: .7, ease: 'power2.inOut' })
      .to(runner, { autoAlpha: 0, duration: .25 });
    stats.forEach(function (el, i) {
      var to = parseFloat(el.getAttribute('data-count').replace(/,/g, ''));
      tl.add(counter(el, to, .9), '-=' + (i ? 1 : .3));
    });
    tl.to(rows, { autoAlpha: 1, y: 0, duration: .25, stagger: .12 }, '-=.6');
  });

  /* 3 · the bento fills itself */
  $$('#scene-bento .tile.scene').forEach(function (tile, i) {
    tile.id = tile.id || ('scene-tile-' + i);
    scene(tile, function (tl) {
      var typed = tile.querySelector('[data-type]');
      var timer = tile.querySelector('[data-timer]');
      var wave = tile.querySelector('.chat__wave--live');
      var fields = $$('.tile__out > div', tile);
      tl.set(fields, { autoAlpha: 0, x: -10 });
      if (typed) tl.add(typeInto(typed, typed.getAttribute('data-type'), .8));
      if (timer) {
        var parts = timer.getAttribute('data-timer').split(':'), secs = +parts[0] * 60 + +parts[1];
        tl.add(function () { wave && wave.classList.add('is-live'); });
        tl.add(counter(timer, secs, 1.1, function (v) { v = Math.round(v); return '0:' + (v < 10 ? '0' : '') + v; }));
        tl.add(function () { wave && wave.classList.remove('is-live'); });
      }
      tl.to(fields, { autoAlpha: 1, x: 0, duration: .3, stagger: .18, ease: 'power2.out' }, '+=.15');
    }, 'top 80%');
  });

  /* 1 · the dining room: scan → order → on record */
  scene($('#scene-dine'), function (tl, root) {
    var scanner = root.querySelector('.scanner');
    var line = root.querySelector('.scanner__line');
    var ok = root.querySelector('.scanner__ok');
    var bubbles = $$('.wa--phone .wa__b', root);
    var rec = root.querySelector('.record');
    var recBits = $$('.record__head, .record__chips span, .record__row', root);
    tl.set(bubbles, { autoAlpha: 0, y: 10 })
      .set(recBits, { autoAlpha: 0, y: 8 })
      .set(scanner, { autoAlpha: 0, y: 30, scale: .9 })
      .set(ok, { scale: 0 })
      .set(scanner, { className: 'scanner' })
      .to(scanner, { autoAlpha: 1, y: 0, scale: 1, duration: .5, ease: 'power3.out' })
      .fromTo(line, { top: 0 }, { top: 76, duration: .7, ease: 'power1.inOut', repeat: 1, yoyo: true })
      .add(function () { scanner.classList.add('is-locked'); })
      .to(ok, { scale: 1, duration: .35, ease: 'back.out(2)' })
      .to(scanner, { autoAlpha: 0, y: -20, duration: .4, delay: .3 })
      .to(bubbles, { autoAlpha: 1, y: 0, duration: .35, stagger: .45, ease: 'power2.out' }, '-=.2')
      .fromTo(rec, { boxShadow: '0 0 0 0 rgba(140,29,47,0)' }, { boxShadow: '0 0 0 4px rgba(140,29,47,.25)', duration: .3, yoyo: true, repeat: 1 })
      .to(recBits, { autoAlpha: 1, y: 0, duration: .3, stagger: .12, ease: 'power2.out' }, '-=.3');
  });

  /* 4 · the 3 steps, as a journey */
  scene($('#steps'), function (tl, root) {
    var photos = $$('.photos i', root);
    var menu = root.querySelector('.menu');
    var menuRows = $$('.menu > *', root);
    var ticks = $$('.chips__tick', root);
    var chips = $$('.chips span', root);
    var order = root.querySelector('.order');
    tl.set(photos, { autoAlpha: 0, rotate: 0, x: 0 })
      .set(menuRows, { autoAlpha: 0 })
      .set(chips, { autoAlpha: 0, y: 8 })
      .set(order, { autoAlpha: 0, x: 24 })
      .to(photos, { autoAlpha: 1, duration: .3, stagger: .15 })
      .to(photos, { x: function (i) { return i * 26; }, rotate: function (i) { return (i - 1) * 8; }, duration: .5, ease: 'power2.out' }, '-=.2')
      .to(photos, { x: 0, rotate: 0, scale: .6, autoAlpha: 0, duration: .45, ease: 'power2.in', stagger: .05 }, '+=.3')
      .to(menuRows, { autoAlpha: 1, duration: .25, stagger: .12 }, '-=.15')
      .to(chips, { autoAlpha: 1, y: 0, duration: .3, stagger: .2 }, '+=.2');
    ticks.forEach(function (t, i) { tl.add(function () { t.classList.add('is-on'); }, '-=' + (i ? .1 : .0)).to(t, { scale: 1, duration: .3, ease: 'back.out(2.5)' }); });
    tl.to(order, { autoAlpha: 1, x: 0, duration: .45, ease: 'power3.out' }, '+=.2')
      .fromTo(order, { boxShadow: '0 0 0 0 rgba(140,29,47,.4)' }, { boxShadow: '0 0 0 12px rgba(140,29,47,0)', duration: .8 });
  });

  /* 7 · 110 counts up and the suite runs */
  scene($('#trust'), function (tl, root) {
    var big = root.querySelector('[data-count]');
    var cases = $$('.run li:not(.run__sum)', root);
    var sum = root.querySelector('.run__sum');
    tl.set(sum, { autoAlpha: 0 })
      .add(counter(big, +big.getAttribute('data-count'), 1.4, function (v) { return String(Math.round(v)); }));
    cases.forEach(function (li, i) { tl.add(function () { li.classList.add('is-on'); }, i ? '+=.22' : '-=.8'); });
    tl.to(sum, { autoAlpha: 1, duration: .4 }, '+=.2');
  });

  /* 8 · the calculator rolls instead of jumping */
  (function () {
    var targets = ['c-app', 'c-ours', 'c-diff'];
    var last = {};
    var obs = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        var el = m.target.nodeType === 3 ? m.target.parentNode : m.target;
        if (!el.id || targets.indexOf(el.id) < 0 || el.__rolling) return;
        var to = parseFloat(el.textContent.replace(/,/g, ''));
        var from = last[el.id] == null ? to : last[el.id];
        last[el.id] = to;
        if (from === to) return;
        el.__rolling = true;
        var o = { v: from };
        gsap.to(o, { v: to, duration: .45, ease: 'power2.out', overwrite: true,
          onUpdate: function () { el.textContent = fmt(o.v); },
          onComplete: function () { el.__rolling = false; el.textContent = fmt(to); } });
      });
    });
    targets.forEach(function (id) { var el = $('#' + id); if (el) obs.observe(el, { childList: true, characterData: true, subtree: true }); });
  })();

  var w = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth !== w) { w = window.innerWidth; ScrollTrigger.refresh(); }
  });
})();
