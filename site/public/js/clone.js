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
        var tier = TIERS.filter(function (x) { return x.name === c.getAttribute('data-plan'); })[0];
        c.classList.toggle('is-fit', tier === pick.tier);
        var tot = c.querySelector('[data-total]'), o = c.querySelector('[data-ord]');
        if (tot) tot.textContent = fmt(costOn(tier, orders));
        if (o) o.textContent = fmt(orders);
      });
    }
    aovR.addEventListener('input', run);
    ordR.addEventListener('input', run);
    run();
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
  ScrollTrigger.config({ ignoreMobileResize: true });
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

    var intro = gsap.timeline();
    // release the page as soon as the frame has opened — the bubbles keep
    // landing on their own; nobody should be held for six seconds
    intro.add(function () {
      document.body.style.overflow = '';
      buildTear();
      ScrollTrigger.sort();
      ScrollTrigger.refresh();
    }, 2.1);

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
    gsap.to('#hero-chat', { y: window.innerWidth > 900 ? '-9vh' : '-2vh', ease: 'none',
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

  /* ───────────────── the one pinned section: the torn receipt ──────────── */

  window.addEventListener('load', function () { ScrollTrigger.refresh(); });

  function buildTear() {
    var stage = $('#tear-stage'); if (!stage) return;
    var rcpts = $$('.rcpt', stage);
    var tears = $$('.rcpt__tear', stage);
    var tallyApp = $('#tally-app'), tallyOurs = $('#tally-ours');
    var appN = $('#tally-app-n'), oursN = $('#tally-ours-n');
    var label = $('#stack-label'), diff = $('#tear-diff'), close = $('#tear-close');
    var APP = 30, OURS = 8.5, N = rcpts.length;

    function flyTarget(tear) {
      // where the strip lands: the app tally, in stage coordinates
      var a = tallyApp.getBoundingClientRect(), b = tear.getBoundingClientRect();
      return { x: (a.left + a.width / 2) - (b.left + b.width / 2), y: (a.top + a.height / 2) - (b.top + b.height / 2) };
    }

    var tl = gsap.timeline({
      scrollTrigger: { trigger: '#scale-pin', start: 'top top', end: '+=' + Math.round(window.innerHeight * .8), pin: true, pinType: 'fixed', anticipatePin: 1, scrub: .4,
        invalidateOnRefresh: true, refreshPriority: 1 }
    });
    var app = { v: 0 }, ours = { v: 0 };
    gsap.set(rcpts.slice(1), { autoAlpha: 0, y: 20 });
    gsap.set([tallyOurs, label, diff, close], { autoAlpha: 0, y: 10 });
    appN.textContent = '0'; oursN.textContent = '0';

    // 1 · the first strip tears off and flies to the app tally
    tl.to(tears[0], { rotate: -6, y: 6, duration: .3, ease: 'power2.in' })
      .to(tears[0], { x: function () { return flyTarget(tears[0]).x; }, y: function () { return flyTarget(tears[0]).y; }, scale: .5, autoAlpha: 0, duration: .8, ease: 'power2.inOut' })
      .to(app, { v: APP, duration: .5, ease: 'none', onUpdate: function () { appN.textContent = fmt(app.v); } }, '<.4');
    // 2 · the same customer, seven more times
    tl.to(rcpts.slice(1), { autoAlpha: 1, y: function (i) { return -(i + 1) * 7; }, x: function (i) { return ((i % 2) ? 1 : -1) * (i + 1) * 9; }, rotate: function (i) { return ((i % 2) ? 1 : -1) * (i + 1) * 1.2; }, duration: .6, stagger: .08, ease: 'power2.out' }, '+=.1')
      .to(label, { autoAlpha: 1, y: 0, duration: .3 }, '<.3');
    // 3 · every strip tears and flies; the tally piles up
    tears.slice(1).forEach(function (t, i) {
      tl.to(t, { x: function () { return flyTarget(t).x; }, y: function () { return flyTarget(t).y; }, scale: .5, autoAlpha: 0, duration: .55, ease: 'power2.inOut' }, i ? '<.12' : '+=.1');
    });
    tl.to(app, { v: APP * N, duration: 1.2, ease: 'none', onUpdate: function () { appN.textContent = fmt(app.v); } }, '<-.3');
    // 4 · Munadim's side, then the difference
    tl.to(tallyOurs, { autoAlpha: 1, y: 0, duration: .3 }, '+=.1')
      .to(ours, { v: OURS * N, duration: .6, ease: 'none', onUpdate: function () { oursN.textContent = fmt(ours.v); } }, '<')
      .to(diff, { autoAlpha: 1, y: 0, duration: .4 }, '+=.15')
      .to(close, { autoAlpha: 1, y: 0, duration: .4 }, '<.1');
  }

  /* ─────────────────────── quiet entrances ─────────────────────────────── */

  var groups = [
    { sel: '.sec-head', y: 22 },
    { sel: '.panel, .tile, .strip__cell, .steps li, .deal, .card, .calc, .faq__item, .composer', y: 26 }
  ];
  groups.forEach(function (g) {
    gsap.utils.toArray(g.sel).forEach(function (el) {
      gsap.from(el, { y: g.y, autoAlpha: 0, duration: .65, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 80%', once: true } });
    });
  });



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
  var SCENE_START = 'top 55%';
  function scene(root, build, startAt) {
    if (!root) return;
    var tl = gsap.timeline({ paused: true });
    build(tl, root);
    ScrollTrigger.create({ trigger: root, start: SCENE_START, once: true, onEnter: function () { tl.play(0); } });
    $$('[data-replay="' + root.id + '"]').forEach(function (b) {
      b.addEventListener('click', function () { tl.play(0); });
    });
    return tl;
  }

  /* 2 · one order, three destinations: lines draw, panels print on arrival */
  scene($('#scene-outputs'), function (tl, root) {
    var voice = root.querySelector('.fan__voice');
    var wave = root.querySelector('.chat__wave--live');
    var lines = $$('.fan__line', root);
    var panels = $$('.panel', root);
    var arts = [
      $$('.panel:nth-child(1) .wa__b, .panel:nth-child(1) .wa__b > *', root),
      $$('.panel:nth-child(2) .ticket > *', root),
      $$('.panel:nth-child(3) .record > *, .panel:nth-child(3) .record__stats span', root)
    ];
    var stats = $$('[data-count]', root);
    lines.forEach(function (l) { var L = l.getTotalLength(); l.style.strokeDasharray = L; l.style.strokeDashoffset = L; });
    tl.set(arts, { autoAlpha: 0, y: 8 })
      .set(panels, { borderColor: 'rgba(20,17,16,.12)' })
      .add(function () { wave && wave.classList.add('is-live'); })
      .fromTo(voice, { scale: 1 }, { scale: 1.06, duration: .35, yoyo: true, repeat: 3, ease: 'sine.inOut' })
      .add(function () { wave && wave.classList.remove('is-live'); });
    lines.forEach(function (l, i) {
      tl.to(l, { strokeDashoffset: 0, duration: .55, ease: 'power2.inOut' }, i ? '-=.25' : '+=0')
        .to(panels[i], { borderColor: '#8C1D2F', duration: .2 }, '-=.05')
        .to(arts[i], { autoAlpha: 1, y: 0, duration: .22, stagger: .08, ease: 'power2.out' }, '-=.05');
    });
    stats.forEach(function (el, i) {
      var to = parseFloat(el.getAttribute('data-count').replace(/,/g, ''));
      tl.add(counter(el, to, .8), i ? '<' : '-=.3');
    });
    tl.to(panels, { borderColor: 'rgba(20,17,16,.12)', duration: .6 }, '+=.4');
  }, 'top 65%');

  /* 3 · five little conversations, one after another */
  scene($('#scene-bento'), function (tl, root) {
    var tiles = $$('.tile:not(.tile--cta)', root);
    tiles.forEach(function (tile, i) {
      var inb = tile.querySelector('.tile__in');
      var typed = tile.querySelector('[data-type]');
      var timer = tile.querySelector('[data-timer]');
      var wave = tile.querySelector('.chat__wave--live');
      var typing = tile.querySelector('.tile__typing');
      var reply = tile.querySelector('.tile__reply');
      var chips = $$('.tile__chips span', tile);
      var sub = gsap.timeline();
      sub.set([inb, reply], { autoAlpha: 0, y: 8 })
         .set(chips, { autoAlpha: 0, scale: .8 })
         .set(typing, { display: 'none' })
         .to(inb, { autoAlpha: 1, y: 0, duration: .3, ease: 'power2.out' });
      if (typed) sub.add(typeInto(typed, typed.getAttribute('data-type'), .7));
      if (timer) {
        var parts = timer.getAttribute('data-timer').split(':'), secs = +parts[0] * 60 + +parts[1];
        sub.add(function () { wave && wave.classList.add('is-live'); });
        sub.add(counter(timer, secs, .9, function (v) { v = Math.round(v); return '0:' + (v < 10 ? '0' : '') + v; }));
        sub.add(function () { wave && wave.classList.remove('is-live'); });
      }
      sub.set(typing, { display: 'flex', autoAlpha: 1 })
         .to({}, { duration: .5 })
         .set(typing, { display: 'none' })
         .to(reply, { autoAlpha: 1, y: 0, duration: .35, ease: 'power3.out' })
         .to(chips, { autoAlpha: 1, scale: 1, duration: .25, stagger: .1, ease: 'back.out(2)' }, '-=.1');
      tl.add(sub, i ? '-=1.1' : 0);
    });
  }, 'top 70%');

  /* 1 · the dining room: one phone scans, orders, and lands on the dashboard */
  scene($('#scene-dine'), function (tl, root) {
    var phone = root.querySelector('.ph');
    var cam = root.querySelector('.ph__cam'), line = root.querySelector('.ph__line'), ok = root.querySelector('.ph__ok');
    var chat = root.querySelector('.ph__chat'), bubbles = $$('.ph__body .wa__b', root), toast = root.querySelector('.ph__toast');
    var row = $('#dine-row'), captured = $('#dine-captured');
    var rtl = document.documentElement.dir === 'rtl';
    tl.set(phone, { autoAlpha: 0, x: rtl ? -160 : 160, y: 30, rotate: rtl ? 6 : -6 })
      .set(cam, { autoAlpha: 1 }).set(chat, { autoAlpha: 0 })
      .set(ok, { scale: 0 }).set(bubbles, { autoAlpha: 0, y: 10 }).set(toast, { autoAlpha: 0, y: 10 })
      .set([row, captured], { autoAlpha: 0, y: 14 })
      .add(function () { cam.classList.remove('is-locked'); })
      // the phone comes to the table
      .to(phone, { autoAlpha: 1, x: 0, y: 0, rotate: 0, duration: .7, ease: 'power3.out' })
      // camera view: the code is framed, the line sweeps, lock
      .fromTo(line, { top: 92 }, { top: 92 + 166, duration: .7, ease: 'power1.inOut', repeat: 1, yoyo: true })
      .add(function () { cam.classList.add('is-locked'); })
      .to(ok, { scale: 1, duration: .35, ease: 'back.out(2)' })
      // the same screen becomes the chat
      .to(cam, { autoAlpha: 0, duration: .4, delay: .3 })
      .to(chat, { autoAlpha: 1, duration: .3 }, '<.1')
      .to(bubbles, { autoAlpha: 1, y: 0, duration: .35, stagger: .5, ease: 'power2.out' })
      .to(toast, { autoAlpha: 1, y: 0, duration: .4, ease: 'power3.out' }, '+=.1')
      // and the guest lands on the dashboard
      .to(phone, { y: -14, duration: .45, ease: 'power2.out' }, '+=.2')
      .to(row, { autoAlpha: 1, y: 0, duration: .45, ease: 'power3.out' }, '<')
      .to(captured, { autoAlpha: 1, y: 0, duration: .4 }, '<.1');
  });

  /* 4 · the 3 steps: one object travels the rail */
  scene($('#steps'), function (tl, root) {
    var lis = $$('.steps li', root), fill = $('#steps-fill');
    var trav = root.querySelector('.trav'), pcards = $$('.pcard', root), menu = root.querySelector('.tmenu');
    var rows = $$('.tmenu > b, .tmenu__row', root), stamps = $$('.stamp', root), order = root.querySelector('.torder'), ping = root.querySelector('.torder__ping');
    var wide = window.innerWidth > 760;
    var dx = function (n) { return wide ? (lis[n].getBoundingClientRect().left - lis[0].getBoundingClientRect().left) : 0; };
    tl.set(trav, { x: 0 })
      .set(fill, { width: '0%' })
      .set(pcards, { autoAlpha: 0, y: -40, rotate: function (i) { return (i - 1) * 10; }, x: function (i) { return (document.documentElement.dir === 'rtl' ? -1 : 1) * i * 30; } })
      .set(menu, { autoAlpha: 0, scale: .92 }).set(rows, { autoAlpha: 0 })
      .set(stamps, { autoAlpha: 0, scale: 1.6, rotate: -8 })
      .set(order, { autoAlpha: 0, y: 40, scale: .8 }).set(ping, { opacity: 0, scale: 1 })
      // 1 · the photos land, then become the menu
      .to(pcards, { autoAlpha: 1, y: 0, duration: .4, stagger: .15, ease: 'power3.out' })
      .to(pcards, { x: 0, rotate: 0, scale: .7, autoAlpha: 0, duration: .5, ease: 'power2.in', stagger: .04 }, '+=.35')
      .to(menu, { autoAlpha: 1, scale: 1, duration: .4, ease: 'power3.out' }, '-=.2')
      .to(rows, { autoAlpha: 1, duration: .25, stagger: .1 }, '-=.1')
      // 2 · it travels to step two and gets stamped
      .to(trav, { x: function () { return dx(1); }, duration: .8, ease: 'power2.inOut' }, '+=.3')
      .to(fill, { width: '50%', duration: .8, ease: 'power2.inOut' }, '<');
    stamps.forEach(function (st, i) { tl.to(st, { autoAlpha: 1, scale: 1, rotate: -3 + i * 2, duration: .3, ease: 'back.out(3)' }, i ? '+=.15' : '+=.1'); });
    // 3 · to step three, and the first order pops out
    tl.to(trav, { x: function () { return dx(2); }, duration: .8, ease: 'power2.inOut' }, '+=.35')
      .to(fill, { width: '100%', duration: .8, ease: 'power2.inOut' }, '<')
      .to(menu, { y: 62, scale: .96, autoAlpha: .6, duration: .4, ease: 'power2.out' }, '+=.1')
      .to(order, { autoAlpha: 1, y: 0, scale: 1, duration: .5, ease: 'back.out(1.6)' }, '<')
      .fromTo(ping, { opacity: .9, scale: 1 }, { opacity: 0, scale: 1.12, duration: .9, ease: 'power2.out', repeat: 1 }, '-=.1');
  });

  /* 7 · the suite runs: cases tick, the counters climb to 1,500 conversations / 5,500 turns, the stamp lands */
  scene($('#trust'), function (tl, root) {
    var big = root.querySelector('[data-count]');
    var n = $('#run-n'), tn = $('#run-t'), bar = $('#run-bar'), stamp = $('#run-stamp');
    var cases = $$('.run-panel__list li', root);
    var o = { v: 0 };
    tl.set(bar, { width: '0%' }).set(stamp, { autoAlpha: 0, scale: 1.6, rotate: -14 })
      .set(cases, { autoAlpha: 0, x: 16 })
      .add(function () { cases.forEach(function (c) { c.classList.remove('is-on'); }); })
      .add(function () { big.textContent = '0'; n.textContent = '0'; tn.textContent = '0'; });
    cases.forEach(function (li, i) {
      tl.to(li, { autoAlpha: 1, x: 0, duration: .3, ease: 'power2.out' }, i ? '-=.05' : '+=.1')
        .add(function () { li.classList.add('is-on'); }, '+=.15');
    });
    tl.to(o, { v: 1, duration: 1.9, ease: 'power2.out', onUpdate: function () { big.textContent = fmt(1500 * o.v); n.textContent = fmt(1500 * o.v); tn.textContent = fmt(5500 * o.v); } }, .2)
      .to(bar, { width: '100%', duration: 1.7, ease: 'power2.out' }, .2)
      .to(stamp, { autoAlpha: 1, scale: 1, rotate: -6, duration: .4, ease: 'back.out(2)' }, '>-.1');
  });

  /* 9 · the objections land as a conversation, each reply after typing dots */
  scene($('#faq-list'), function (tl, root) {
    var pairs = $$('.faq__pair', root);
    pairs.forEach(function (pr, i) {
      var q = pr.querySelector('.faq__q'), typ = pr.querySelector('.faq__typing'), a = pr.querySelector('.faq__a');
      var sub = gsap.timeline();
      sub.set([q, a], { autoAlpha: 0, y: 10 }).set(typ, { display: 'none' })
         .to(q, { autoAlpha: 1, y: 0, duration: .35, ease: 'power2.out' })
         .set(typ, { display: 'flex', autoAlpha: 1 }, '+=.1')
         .to({}, { duration: .5 })
         .set(typ, { display: 'none' })
         .to(a, { autoAlpha: 1, y: 0, duration: .4, ease: 'power3.out' });
      tl.add(sub, i ? '-=.5' : 0);
    });
  }, 'top 75%');

  /* 10 · the composer writes itself; tapping sends, then opens WhatsApp */
  (function () {
    var comp = $('#composer'); if (!comp) return;
    var hi = $('#comp-hi'), sent = $('#comp-sent'), field = $('#comp-field'), send = $('#comp-send');
    var text = field.getAttribute('data-type');
    var armed = false;
    scene(comp, function (tl) {
      tl.set(sent, { autoAlpha: 0, y: 12 }).set(hi, { autoAlpha: 0, y: 10 })
        .add(function () { field.textContent = ''; send.classList.remove('is-ready'); armed = false; })
        .to(hi, { autoAlpha: 1, y: 0, duration: .4, ease: 'power2.out' })
        .add(typeInto(field, text, 1.1), '+=.4')
        .add(function () { send.classList.add('is-ready'); armed = true; });
    }, 'top 70%');
    comp.addEventListener('click', function (e) {
      if (!armed || sent.__done) return;
      e.preventDefault();
      sent.__done = true;
      var href = comp.getAttribute('href');
      gsap.timeline({ onComplete: function () { window.location.href = href; } })
        .add(function () { field.textContent = ''; send.classList.remove('is-ready'); })
        .to(sent, { autoAlpha: 1, y: 0, duration: .35, ease: 'power3.out' })
        .to({}, { duration: .35 });
    });
  })();

  /* 8 · the calculator rolls instead of jumping */
  (function () {
    var targets = ['c-app', 'c-diff'];
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
    $$('.card [data-total]').forEach(function (el, i) { el.id = el.id || ('c-total-' + i); targets.push(el.id); obs.observe(el, { childList: true, characterData: true, subtree: true }); });
  })();

  var w = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth !== w) { w = window.innerWidth; ScrollTrigger.refresh(); }
  });
})();
