/**
 * The reference site's choreography, rebuilt for Munadim.
 * Hero is fixed; the .hero-spacer is what actually scrolls. Every stage is a
 * scrub against that spacer — plus one pinned section and one-shot entrances
 * everywhere else. Reduced motion gets a complete alternate path.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export function initCinema() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s: string) => document.querySelector<HTMLElement>(s);
  const $$ = (s: string) => Array.from(document.querySelectorAll<HTMLElement>(s));

  const hero = $('#hero');
  const spacer = document.querySelector('.hero-spacer');

  if (reduce) {
    // flat: hero sits in flow, everything visible, no pin, no scrub
    if (hero) {
      hero.style.position = 'relative';
      hero.style.height = '100svh';
    }
    (spacer as HTMLElement | null)?.style.setProperty('display', 'none');
    $$('.hw i').forEach((i) => (i.style.transform = 'none'));
    const s2 = $('#sub2');
    if (s2) s2.style.opacity = '0';
    const s1 = $('#sub1');
    if (s1) s1.style.opacity = '1';
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  /* ── the opening: card → full bleed, headline masks up ───────────────── */
  const words = $$('.hw i');
  const sub1 = $('#sub1');
  const sub2 = $('#sub2');
  gsap.set([sub1, sub2], { autoAlpha: 0 });

  const intro = gsap.timeline({ onComplete: () => ScrollTrigger.refresh() });
  intro.to('#hero-frame', {
    width: '100%',
    height: '100%',
    borderRadius: 0,
    duration: 1.05,
    ease: 'power3.inOut',
  });
  intro.to(words, { y: 0, duration: 0.85, stagger: 0.07, ease: 'power4.out' }, 0.45);
  intro.to(sub1, { autoAlpha: 1, duration: 0.5, ease: 'power2.out' }, 0.95);
  intro.to(['#hero-hint', 'header', '#sticky-cta'], { opacity: 1, duration: 0.5, ease: 'power2.out' }, 0.9);

  if (!spacer) return;

  /* ── stage 1: the hint clears ────────────────────────────────────────── */
  gsap.to('#hero-hint', {
    autoAlpha: 0,
    ease: 'none',
    scrollTrigger: { trigger: spacer, start: 'top top', end: '8% top', scrub: 0.3 },
  });

  /* ── stage 2: the line swaps halves in the same slot ─────────────────── */
  ScrollTrigger.create({
    trigger: spacer,
    start: '18% top',
    onEnter: () => {
      gsap.to(sub1, { autoAlpha: 0, y: -18, duration: 0.35, ease: 'power2.in' });
      gsap.fromTo(sub2, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.45, delay: 0.2, ease: 'power3.out' });
    },
    onLeaveBack: () => {
      gsap.to(sub2, { autoAlpha: 0, y: 18, duration: 0.3, ease: 'power2.in' });
      gsap.to(sub1, { autoAlpha: 1, y: 0, duration: 0.4, delay: 0.15, ease: 'power3.out' });
    },
  });

  /* ── stage 3: the copy drifts up, then fades ─────────────────────────── */
  gsap.to('#hero-copy', {
    y: '-30vh',
    ease: 'none',
    scrollTrigger: { trigger: spacer, start: 'top top', end: '52% top', scrub: 0.25 },
  });
  gsap.to('#hero-copy', {
    autoAlpha: 0,
    ease: 'none',
    scrollTrigger: { trigger: spacer, start: '46% top', end: '58% top', scrub: 0.25 },
  });

  /* ── stage 4: the frame shrinks back to a card and lifts away ────────── */
  const exit = gsap.timeline({
    scrollTrigger: { trigger: spacer, start: '55% top', end: '96% top', scrub: 0.3 },
  });
  exit.to('#hero-frame', { scale: 0.92, borderRadius: '14px', duration: 0.3, ease: 'power2.inOut' });
  exit.to('#hero-frame', { scale: 0.34, borderRadius: '18px', duration: 0.8, ease: 'power1.inOut' }, '>-.05');
  exit.to('#hero-frame', { yPercent: -95, autoAlpha: 0, duration: 0.7, ease: 'power2.in' }, '>-.35');
  exit.set('#hero', { display: 'none' });

  /* ── quiet entrances everywhere else ─────────────────────────────────── */
  gsap.utils.toArray<HTMLElement>('[data-rise]').forEach((el) => {
    gsap.from(el, {
      y: 26,
      autoAlpha: 0,
      duration: 0.65,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });

  let w = window.innerWidth;
  addEventListener('resize', () => {
    if (window.innerWidth !== w) {
      w = window.innerWidth;
      ScrollTrigger.refresh();
    }
  });
}
