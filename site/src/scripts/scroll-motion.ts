/**
 * Scroll-linked motion — the thing that makes the reference site feel alive.
 * It is NOT a binary "add .revealed" toggle: every element interpolates
 * continuously from translateY(26px)/opacity 0 to 0/1 based on how far it has
 * entered the viewport. Runs on rAF, reads once per frame, writes once.
 */
export function initScrollMotion() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const els = [...document.querySelectorAll<HTMLElement>('[data-rise]')];
  if (!els.length) return;

  if (reduced) {
    els.forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    return;
  }

  const RISE = 26; // px, matching the reference
  let ticking = false;

  const frame = () => {
    ticking = false;
    const vh = window.innerHeight;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) continue;
      // 0 when the element's top is at the viewport bottom, 1 once it has
      // risen 35% of the viewport height
      const p = Math.min(Math.max((vh - r.top) / (vh * 0.35), 0), 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.style.opacity = String(eased);
      el.style.transform = `translate3d(0, ${((1 - eased) * RISE).toFixed(2)}px, 0)`;
    }
  };

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(frame);
    }
  };

  els.forEach((el) => {
    el.style.willChange = 'opacity, transform';
    el.style.opacity = '0';
    el.style.transform = `translate3d(0, ${RISE}px, 0)`;
  });

  frame();
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
}
