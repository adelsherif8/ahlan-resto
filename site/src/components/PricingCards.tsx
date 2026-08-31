/**
 * Pricing — the slider drives the cards. The visitor sets their volume; every
 * plan card shows what they would actually pay at it, the cheapest lifts with
 * «الباقة المناسبة», and one line carries the comparison with the apps.
 * Rate card source: branding/pricing.md. The app's cut is a stated assumption.
 */
import { useState } from 'react';

const PLANS = [
  { name: 'Start', fee: 3500, included: 300, over: 9 },
  { name: 'Grow', fee: 8500, included: 1000, over: 8 },
  { name: 'Chain', fee: 20000, included: 2500, over: 7 },
] as const;

const APP_RATE = 0.2;

export interface PricingLabels {
  aov: string;
  orders: string;
  egp: string;
  perMonth: string;
  yourPlan: string;
  appSide: string;
  diff: string;
  rows: { monthly: string; included: string; overage: string };
  plans: { name: string; monthly: string; included: string; overage: string; fits: string }[];
  payAt: string; // «هتدفع عند»
  ordersWord: string; // «أوردر»
  cta: string;
  ctaHref: string;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export default function PricingCards({ labels, dir = 'rtl' }: { labels: PricingLabels; dir?: 'rtl' | 'ltr' }) {
  const [aov, setAov] = useState(150);
  const [orders, setOrders] = useState(600);

  const totals = PLANS.map((p) => p.fee + Math.max(0, orders - p.included) * p.over);
  const fit = totals.indexOf(Math.min(...totals));
  const app = orders * aov * APP_RATE;
  const diff = app - totals[fit]!;

  return (
    <div dir={dir} className="mx-auto max-w-6xl">
      {/* the controls */}
      <div className="card grid gap-7 p-6 sm:grid-cols-2 sm:p-7">
        <label className="block">
          <span className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{labels.orders}</span>
            <span className="num text-[1.3rem] font-medium">{fmt(orders)}</span>
          </span>
          <input type="range" min="100" max="3000" step="50" value={orders} onChange={(e) => setOrders(+e.target.value)} className="calc-range mt-3 w-full" />
        </label>
        <label className="block">
          <span className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{labels.aov}</span>
            <span className="num text-[1.3rem] font-medium">
              {fmt(aov)} <span className="text-[0.85rem] text-ink/60">{labels.egp}</span>
            </span>
          </span>
          <input type="range" min="80" max="400" step="10" value={aov} onChange={(e) => setAov(+e.target.value)} className="calc-range mt-3 w-full" />
        </label>
      </div>

      {/* the cards */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {labels.plans.map((p, i) => {
          const on = i === fit;
          return (
            <article
              key={p.name}
              className={`card relative flex flex-col p-6 transition-all duration-500 ${on ? '!border-karkadeh -translate-y-1.5 shadow-[0_28px_50px_-30px_rgba(140,29,47,0.5)]' : ''}`}
            >
              <span
                className={`absolute -top-3 start-5 rounded-full bg-karkadeh px-3 py-0.5 text-[0.75rem] font-semibold text-semna transition-all duration-300 ${on ? 'opacity-100' : 'translate-y-1 opacity-0'}`}
                aria-hidden={!on}
              >
                {labels.yourPlan}
              </span>
              <h3 className="text-[1.25rem]" dir="ltr">{p.name}</h3>
              <p className="mt-1 text-[0.95rem] text-ink/70">{p.fits}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-ink/10 pt-4">
                <div>
                  <dt className="text-[0.72rem] font-semibold text-ink/55">{labels.rows.monthly}</dt>
                  <dd className="num mt-0.5 text-[0.95rem] font-semibold">{p.monthly}</dd>
                </div>
                <div>
                  <dt className="text-[0.72rem] font-semibold text-ink/55">{labels.rows.included}</dt>
                  <dd className="num mt-0.5 text-[0.95rem] font-semibold">{p.included}</dd>
                </div>
                <div>
                  <dt className="text-[0.72rem] font-semibold text-ink/55">{labels.rows.overage}</dt>
                  <dd className="mt-0.5 text-[0.95rem] font-semibold">{p.overage}</dd>
                </div>
              </dl>
              <div className="mt-4 rounded-[var(--radius-md)] bg-semna px-4 py-3">
                <p className="text-[0.75rem] text-ink/60">
                  {labels.payAt} <span className="num font-semibold text-ink/80">{fmt(orders)}</span> {labels.ordersWord}
                </p>
                <p className="mt-0.5 flex items-baseline justify-end gap-2">
                  <span className={`num text-[2rem] font-medium leading-none ${on ? 'text-karkadeh' : 'text-ink'}`}>{fmt(totals[i]!)}</span>
                  <span className="text-[0.78rem] text-ink/60">{labels.perMonth}</span>
                </p>
              </div>
              <a href={labels.ctaHref} className="mt-5 inline-flex w-fit items-center gap-1.5 border-b-2 border-karkadeh pb-0.5 text-[0.95rem] font-semibold text-ink hover:text-karkadeh">
                {labels.cta} <span aria-hidden="true" className="rtl:-scale-x-100">→</span>
              </a>
            </article>
          );
        })}
      </div>

      {/* the comparison, once */}
      <div className="on-ink mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-[var(--radius-md)] px-5 py-3.5 text-[0.95rem]">
        <span>
          {labels.appSide}: <span className="num text-[1.15rem] font-medium">{fmt(app)}</span> {labels.egp}
        </span>
        {diff > 0 && (
          <span>
            {labels.diff} <span className="num text-[1.15rem] font-medium text-brass-light">{fmt(diff)}</span> {labels.egp} {labels.perMonth}
          </span>
        )}
      </div>
    </div>
  );
}
