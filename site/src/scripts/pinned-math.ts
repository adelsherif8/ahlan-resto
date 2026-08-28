/**
 * Drives the pinned arithmetic dial from scroll progress.
 * Rests on the three published tiers (300 / 1,000 / 2,500) and only morphs
 * between them, so the figures always quote a plan that actually exists.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const TIERS = [
  { orders: 300, name: 'Start', fee: 3500, over: 9, included: 300 },
  { orders: 1000, name: 'Grow', fee: 8500, over: 8, included: 1000 },
  { orders: 2500, name: 'Chain', fee: 20000, over: 7, included: 2500 },
];
const AOV = 150;
const APP_RATE = 0.2;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function initPinnedMath() {
  const sec = document.querySelector('#math-pin');
  if (!sec) return;

  const el = {
    orders: document.querySelector('#m-orders'),
    plan: document.querySelector('#m-plan'),
    plan2: document.querySelector('#m-plan2'),
    app: document.querySelector('#m-app'),
    ours: document.querySelector('#m-ours'),
    diff: document.querySelector('#m-diff'),
    fill: document.querySelector<HTMLElement>('#m-fill'),
  };

  const render = (p: number) => {
    // p 0..1 across the three tiers; rest on each stop
    const scaled = p * 2; // 0..2
    const i = Math.min(Math.floor(scaled), 1);
    const local = gsap.utils.clamp(0, 1, (scaled - i - 0.3) / 0.4); // rest, morph, rest
    const smooth = local * local * (3 - 2 * local);
    const a = TIERS[i]!;
    const b = TIERS[i + 1]!;

    const orders = a.orders + (b.orders - a.orders) * smooth;
    const tier = smooth > 0.5 ? b : a;
    const ourCost = tier.fee + Math.max(0, orders - tier.included) * tier.over;
    const appCost = orders * AOV * APP_RATE;

    if (el.orders) el.orders.textContent = fmt(orders);
    if (el.plan) el.plan.textContent = tier.name;
    if (el.plan2) el.plan2.textContent = tier.name;
    if (el.app) el.app.textContent = fmt(appCost);
    if (el.ours) el.ours.textContent = fmt(ourCost);
    if (el.diff) el.diff.textContent = fmt(Math.max(0, appCost - ourCost));
    if (el.fill) el.fill.style.width = `${p * 100}%`;
  };

  render(0);

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    render(1);
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.create({
    trigger: sec,
    start: 'top top',
    end: '+=' + Math.round(window.innerHeight * 1.3),
    pin: true,
    anticipatePin: 1,
    scrub: 0.4,
    onUpdate: (self) => render(self.progress),
  });
}
