/* CFT Storage redesign — screens 1–3.
 *
 * PackOnce's choreography (preloader → hero card opens → headline masks up →
 * copy swaps on scroll → hero shrinks and lifts away → pinned reveal), with
 * its costs cut: preloader capped at 1.8 s instead of 8 s, one pin instead of
 * six, and a full reduced-motion path that skips all of it.
 */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $  = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  /* ─────────────────── the pinned dial: our arithmetic ───────────────── */

  /* Their rig morphs a 20 ft container to 40 ft and rests on both real sizes.
   * Ours dials the published tiers — 300 / 1,000 / 2,500 orders — and never
   * quotes a plan that doesn't exist. Rate card: branding/pricing.md. */
  var TIERS = [
    { orders: 300,  name: 'Start', fee: 3500,  over: 9, included: 300  },
    { orders: 1000, name: 'Grow',  fee: 8500,  over: 8, included: 1000 },
    { orders: 2500, name: 'Chain', fee: 20000, over: 7, included: 2500 }
  ];
  var AOV = 150, APP_RATE = 0.2;
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var counters = $$('[data-count]');

  function renderRig(p) {
    var scaled = p * 2;
    var i = Math.min(Math.floor(scaled), 1);
    var local = Math.min(Math.max((scaled - i - 0.3) / 0.4, 0), 1);
    var sm = local * local * (3 - 2 * local);
    var a = TIERS[i], b = TIERS[i + 1];
    var orders = a.orders + (b.orders - a.orders) * sm;
    var tier = sm > 0.5 ? b : a;
    var ours = tier.fee + Math.max(0, orders - tier.included) * tier.over;
    var app = orders * AOV * APP_RATE;

    var set = function (id, v) { var el = $(id); if (el) el.textContent = v; };
    set('#m-orders', fmt(orders));
    set('#m-plan', tier.name);
    set('#m-plan2', tier.name);
    set('#m-app', fmt(app));
    set('#m-ours', fmt(ours));
    set('#m-diff', fmt(Math.max(0, app - ours)));
    var fill = $('#m-fill'); if (fill) fill.style.width = (p * 100).toFixed(1) + '%';

    counters.forEach(function (el) {
      var from = +el.dataset.from, to = +el.dataset.to;
      el.textContent = fmt(from + (to - from) * p);
    });
  }

/* ───────────────────── reduced-motion short circuit ────────────────── */

  if (reduce || !window.gsap) {
    renderRig(1);
    var pre = $('#pre'); if (pre) pre.remove();
    document.body.style.overflow = '';
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  renderRig(0);

  /* ───────────────────────────── preloader ──────────────────────────── */

  var letters = $$('.pre__word b');
  var counterEl = $('#pre-n');
  document.body.style.overflow = 'hidden';
  window.scrollTo(0, 0);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  gsap.timeline()
    .to('.pre__top', { opacity: 1, duration: .45, ease: 'power2.out' })
    .to(letters, { y: 0, duration: 1.0, stagger: .035, ease: 'power4.out' }, .15);

  /* Hard 1.8 s ceiling — the video keeps loading behind the page. */
  var t0 = performance.now();
  var shown = 0;
  (function tick() {
    var p = Math.min((performance.now() - t0) / 1800, 1);
    shown += (100 * p - shown) * .2;
    counterEl.textContent = p >= 1 ? '100' : String(Math.min(99, Math.round(shown)));
    if (p < 1) return requestAnimationFrame(tick);
    openHero();
  })();

  /* ───────────────────────── hero choreography ──────────────────────── */

  function openHero() {
    var spacer = $('.hero-spacer');
    var words  = $$('.ln .w i');
    var sub1 = $('#sub1'), sub2 = $('#sub2');

    gsap.set([sub1, sub2], { autoAlpha: 0 });

    var intro = gsap.timeline({
      onComplete: function () {
        document.body.style.overflow = '';
        ScrollTrigger.refresh();
      }
    });

    intro.to('.pre__mark', { y: -60, autoAlpha: 0, duration: .7, ease: 'power3.in' }, 0);
    intro.to('.pre__top', { autoAlpha: 0, duration: .4 }, 0);
    intro.to('#pre', { autoAlpha: 0, duration: .5, onComplete: function () { $('#pre').style.display = 'none'; } }, .55);
    // the card opens to full bleed
    intro.to('#hero-frame', { width: '100%', height: '100%', borderRadius: 0, duration: 1.1, ease: 'power3.inOut' }, .45);
    intro.to('#hero-bar', { height: 0, opacity: 0, padding: 0, duration: .9, ease: 'power3.inOut' }, .45);
    // headline masks up, word by word
    intro.to(words, { y: 0, duration: .85, stagger: .07, ease: 'power4.out' }, 1.05);
    intro.to(sub1, { autoAlpha: 1, duration: .5, ease: 'power2.out' }, 1.5);
    intro.to(['#nav', '#pill'], {
      opacity: 1, duration: .5, ease: 'power2.out',
      onComplete: function () { $('#nav').classList.add('is-on'); $('#pill').classList.add('is-on'); }
    }, 1.4);

    /* Scroll stages. The hero is fixed, so the spacer is what actually moves —
     * but unlike PackOnce every one of these is a scrub, never a hard pin. */
    gsap.to('#hero-hint', {
      autoAlpha: 0, ease: 'none',
      scrollTrigger: { trigger: spacer, start: 'top top', end: '8% top', scrub: .3 }
    });

    // copy swap: line 1 out, line 2 in
    ScrollTrigger.create({
      trigger: spacer, start: '18% top',
      onEnter: function () {
        gsap.to(sub1, { autoAlpha: 0, y: -18, duration: .35, ease: 'power2.in' });
        gsap.fromTo(sub2, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: .45, delay: .2, ease: 'power3.out' });
      },
      onLeaveBack: function () {
        gsap.to(sub2, { autoAlpha: 0, y: 18, duration: .3, ease: 'power2.in' });
        gsap.to(sub1, { autoAlpha: 1, y: 0, duration: .4, delay: .15, ease: 'power3.out' });
      }
    });

    // title drifts up and out as you scroll through the hero
    gsap.to('#hero-copy', {
      y: '-32vh', ease: 'none',
      scrollTrigger: { trigger: spacer, start: 'top top', end: '52% top', scrub: .25 }
    });
    /* fade the whole copy block — tweening autoAlpha on #sub1/#sub2 here as
     * well would stamp visibility:hidden on them at setup and the intro's
     * opacity tween would never bring it back. */
    gsap.to('#hero-copy', {
      autoAlpha: 0, ease: 'none',
      scrollTrigger: { trigger: spacer, start: '46% top', end: '58% top', scrub: .25 }
    });

    // and the whole frame shrinks back to a card, then lifts away
    var exit = gsap.timeline({
      scrollTrigger: { trigger: spacer, start: '55% top', end: '96% top', scrub: .3 }
    });
    exit.to('#hero-frame', { scale: .92, borderRadius: '14px', duration: .3, ease: 'power2.inOut' });
    exit.to('#hero-frame', { scale: .34, borderRadius: '18px', duration: .8, ease: 'power1.inOut' }, '>-.05');
    exit.to('#hero-frame', { yPercent: -95, autoAlpha: 0, duration: .7, ease: 'power2.in' }, '>-.35');
    exit.set('#hero', { display: 'none' });
  }

  /* ───────────────────── the one pinned section ─────────────────────── */

  window.addEventListener('load', function () { ScrollTrigger.refresh(); });

  ScrollTrigger.create({
    trigger: '#scale-pin',
    start: 'top top',
    end: '+=' + Math.round(window.innerHeight * 1.2),
    pin: true,
    anticipatePin: 1,
    scrub: .4,
    onUpdate: function (self) {
      /* CFT sells 20 ft and 40 ft — not 28. The scroll rests on a real size
       * at both ends and only the middle fifth morphs, so the counter reads
       * as a spinning dial instead of quoting a size that doesn't exist. */
      var p = gsap.utils.clamp(0, 1, (self.progress - 0.40) / 0.20);
      renderRig(p * p * (3 - 2 * p));
    }
  });

  /* quiet entrances everywhere else */
  gsap.utils.toArray('.card, .bar, .sec-head, .tile, .deal, .steps li, .grade, .quote, .qf').forEach(function (el) {
    gsap.from(el, { y: 26, autoAlpha: 0, duration: .65, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
  });


  /* ─────────────────────────── FAQ accordion ────────────────────────── */

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
      if (animate && !reduce) gsap.to(panel, { height: h, duration: .38, ease: 'power2.out' });
      else gsap.set(panel, { height: open ? 'auto' : 0 });
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
        if (it.classList.contains('is-open')) gsap.set(it.querySelector('.faq__a'), { height: 'auto' });
      });
    });
  })();

  /* ───────────────────────────── quote form ─────────────────────────── */

  (function () {
    var form = $('#qf');
    if (!form) return;
    var tabs  = $$('.qf__tab', form);
    var steps = $$('.qf__step', form);
    var next  = $('#qf-next');

    function show(i) {
      tabs.forEach(function (t, k) { t.classList.toggle('is-active', k === i); });
      steps.forEach(function (s, k) { s.classList.toggle('is-active', k === i); });
      if (!reduce) {
        gsap.fromTo(steps[i].children, { y: 14, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, stagger: .04, duration: .35, ease: 'power3.out' });
      }
    }
    tabs.forEach(function (t, i) { t.addEventListener('click', function () { show(i); }); });

    function check(ids) {
      var ok = true;
      ids.forEach(function (id) {
        var el = document.getElementById(id);
        var bad = !el.value.trim();
        if (id === 'q-email' && el.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim())) bad = true;
        el.closest('.qf__field').classList.toggle('is-bad', bad);
        if (bad && ok) { el.focus(); ok = false; }
      });
      return ok;
    }

    next.addEventListener('click', function () { if (check(['q-type', 'q-when'])) show(1); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!check(['q-name', 'q-phone', 'q-email'])) return;
      /* Prototype only. Wire this to the server-side GHL relay before launch —
       * the token must never reach client-side JS. */
      form.innerHTML = '<div class="qf__done"><h4>Got it.</h4>' +
        '<p>We\'ll come back with a price shortly. Need it faster? Call 613-702-5501 — phones are answered 24/7.</p></div>';
    });
  })();

  var w = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth !== w) { w = window.innerWidth; ScrollTrigger.refresh(); }
  });
})();
