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
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
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

  var letters = $$('.pre__word b');
  var counterEl = $('#pre-n');
  document.body.style.overflow = 'hidden';
  window.scrollTo(0, 0);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  gsap.timeline()
    .to('.pre__top', { opacity: 1, duration: .45, ease: 'power2.out' })
    .to(letters, { y: 0, duration: 1.0, stagger: .035, ease: 'power4.out' }, .15);

  var t0 = performance.now();
  var shown = 0;
  (function tick() {
    var p = Math.min((performance.now() - t0) / 1800, 1);
    shown += (100 * p - shown) * .2;
    counterEl.textContent = p >= 1 ? '100' : String(Math.min(99, Math.round(shown)));
    if (p < 1) return requestAnimationFrame(tick);
    openHero();
  })();

  /* ───────────────────────── hero choreography ─────────────────────────── */

  var bubbles = $$('#hero-chat .chat__b');
  gsap.set(bubbles, { autoAlpha: 0, y: 14 });

  function openHero() {
    var spacer = $('.hero-spacer');
    var words  = $$('.ln .w i');
    var sub1 = $('#sub1'), sub2 = $('#sub2');

    gsap.set([sub1, sub2], { autoAlpha: 0 });
    gsap.set('.hero__cta', { autoAlpha: 0, y: 12 });

    var intro = gsap.timeline({
      onComplete: function () {
        document.body.style.overflow = '';
        ScrollTrigger.refresh();
      }
    });

    intro.to('.pre__mark', { y: -60, autoAlpha: 0, duration: .7, ease: 'power3.in' }, 0);
    intro.to('.pre__top', { autoAlpha: 0, duration: .4 }, 0);
    intro.to('#pre', { autoAlpha: 0, duration: .5, onComplete: function () { $('#pre').style.display = 'none'; } }, .55);
    intro.to('#hero-frame', { width: '100%', height: '100%', borderRadius: 0, duration: 1.1, ease: 'power3.inOut' }, .45);
    intro.to('#hero-bar', { height: 0, opacity: 0, padding: 0, duration: .9, ease: 'power3.inOut' }, .45);
    intro.to(words, { y: 0, duration: .85, stagger: .07, ease: 'power4.out' }, 1.05);
    intro.to(sub1, { autoAlpha: 1, duration: .5, ease: 'power2.out' }, 1.6);
    intro.to('.hero__cta', { autoAlpha: 1, y: 0, duration: .5, ease: 'power2.out' }, 1.75);
    // the first two bubbles land on their own; the rest wait for the scroll
    intro.to(bubbles.slice(0, 2), { autoAlpha: 1, y: 0, duration: .5, stagger: .35, ease: 'power3.out' }, 1.3);
    intro.to(['#nav', '#pill'], {
      opacity: 1, duration: .5, ease: 'power2.out',
      onComplete: function () { $('#nav').classList.add('is-on'); $('#pill').classList.add('is-on'); }
    }, 1.4);

    gsap.to('#hero-hint', {
      autoAlpha: 0, ease: 'none',
      scrollTrigger: { trigger: spacer, start: 'top top', end: '8% top', scrub: .3 }
    });

    // the conversation plays out across the first half of the runway
    var rest = bubbles.slice(2);
    if (rest.length) {
      gsap.timeline({ scrollTrigger: { trigger: spacer, start: '4% top', end: '48% top', scrub: .35 } })
        .to(rest, { autoAlpha: 1, y: 0, duration: 1, stagger: 1, ease: 'power2.out' });
    }

    // copy swap: line 1 out, line 2 in
    ScrollTrigger.create({
      trigger: spacer, start: '22% top',
      onEnter: function () {
        gsap.to(sub1, { autoAlpha: 0, y: -18, duration: .35, ease: 'power2.in' });
        gsap.fromTo(sub2, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: .45, delay: .2, ease: 'power3.out' });
      },
      onLeaveBack: function () {
        gsap.to(sub2, { autoAlpha: 0, y: 18, duration: .3, ease: 'power2.in' });
        gsap.to(sub1, { autoAlpha: 1, y: 0, duration: .4, delay: .15, ease: 'power3.out' });
      }
    });

    // copy drifts up and fades as the frame prepares to leave
    gsap.to('#hero-copy', {
      yPercent: -18, ease: 'none',
      scrollTrigger: { trigger: spacer, start: '30% top', end: '60% top', scrub: .25 }
    });
    gsap.to('#hero-copy', {
      autoAlpha: 0, ease: 'none',
      scrollTrigger: { trigger: spacer, start: '50% top', end: '62% top', scrub: .25 }
    });

    // the frame shrinks back to a card, then lifts away
    var exit = gsap.timeline({
      scrollTrigger: { trigger: spacer, start: '58% top', end: '96% top', scrub: .3 }
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

  var w = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth !== w) { w = window.innerWidth; ScrollTrigger.refresh(); }
  });
})();
