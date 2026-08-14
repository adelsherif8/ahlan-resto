/**
 * الحسبة — interactive. The visitor sets their own numbers; the code computes
 * both sides. No claim is made about their business: the assumption (the apps
 * take ~a fifth) is stated on screen, and the plan is picked by arithmetic.
 * Rate card source: branding/pricing.md — the single published numbers.
 */
import { useState } from 'react';

const PLANS = [
  { name: 'Start', fee: 3500, included: 300, over: 9 },
  { name: 'Grow', fee: 8500, included: 1000, over: 8 },
  { name: 'Chain', fee: 20000, included: 2500, over: 7 },
] as const;

const APP_RATE = 0.2; // «حوالي خُمس» — stated as an assumption in the UI

export interface CalcLabels {
  aov: string;
  orders: string;
  appSide: string;
  ourSide: string;
  perMonth: string;
  onPlan: string;
  diff: string;
  assumption: string;
  egp: string;
}

interface Props {
  labels: CalcLabels;
  dir?: 'rtl' | 'ltr';
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export default function CostCalc({ labels, dir = 'rtl' }: Props) {
  const [aov, setAov] = useState(150);
  const [orders, setOrders] = useState(600);

  const appCost = orders * aov * APP_RATE;
  const munadim = PLANS.map((p) => ({
    ...p,
    total: p.fee + Math.max(0, orders - p.included) * p.over,
  })).reduce((a, b) => (b.total < a.total ? b : a));
  const diff = appCost - munadim.total;

  return (
    <div dir={dir} className="card p-7 sm:p-9">
      {/* Inputs */}
      <div className="grid gap-8 sm:grid-cols-2">
        <label className="block">
          <span className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{labels.aov}</span>
            <span className="num text-[1.3rem] font-medium">{fmt(aov)} <span className="text-[0.85rem] text-ink/60">{labels.egp}</span></span>
          </span>
          <input
            type="range"
            min="80"
            max="400"
            step="10"
            value={aov}
            onChange={(e) => setAov(+e.target.value)}
            className="calc-range mt-4 w-full"
          />
        </label>
        <label className="block">
          <span className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{labels.orders}</span>
            <span className="num text-[1.3rem] font-medium">{fmt(orders)}</span>
          </span>
          <input
            type="range"
            min="100"
            max="3000"
            step="50"
            value={orders}
            onChange={(e) => setOrders(+e.target.value)}
            className="calc-range mt-4 w-full"
          />
        </label>
      </div>

      {/* Outputs — computed, never asserted */}
      <div className="mt-9 grid gap-5 sm:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-ink/10 bg-semna p-6 text-center">
          <p className="text-[0.92rem] text-ink/70">{labels.appSide}</p>
          <p className="mt-2.5 flex items-baseline justify-center gap-2 text-karkadeh">
            <span className="num text-[2.6rem] font-medium leading-none sm:text-[3.2rem]">{fmt(appCost)}</span>
            <span className="text-[1rem]">{labels.egp} {labels.perMonth}</span>
          </p>
        </div>
        <div className="rounded-[var(--radius-md)] border border-ink/10 bg-semna p-6 text-center">
          <p className="text-[0.92rem] text-ink/70">
            {labels.ourSide} <span className="font-semibold" dir="ltr">{munadim.name}</span> {labels.onPlan}
          </p>
          <p className="mt-2.5 flex items-baseline justify-center gap-2 text-ink">
            <span className="num text-[2.6rem] font-medium leading-none sm:text-[3.2rem]">{fmt(munadim.total)}</span>
            <span className="text-[1rem]">{labels.egp} {labels.perMonth}</span>
          </p>
        </div>
      </div>

      {diff > 0 && (
        <p className="mt-7 text-center text-[1.15rem] font-semibold">
          {labels.diff} <span className="num text-karkadeh">{fmt(diff)}</span> {labels.egp} {labels.perMonth}
        </p>
      )}

      <p className="mt-4 text-center text-[0.85rem] text-ink/60">{labels.assumption}</p>
    </div>
  );
}
