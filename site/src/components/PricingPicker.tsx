/**
 * Pricing — the plans and the arithmetic in one instrument. Move your numbers,
 * the matching plan lights up and the comparison recomputes.
 * Rate card source: branding/pricing.md. The one assumption is on screen.
 */
import { useState } from 'react';

export interface PickerPlan {
  name: string;
  fee: number;
  included: number;
  over: number;
  fits: string;
}

export interface PickerLabels {
  plans: PickerPlan[];
  rows: { included: string; overage: string; fits: string };
  perMonth: string;
  egp: string;
  aov: string;
  orders: string;
  yourPlan: string;
  appSide: string;
  ourSide: string;
  diff: string;
  assumption: string;
  perOrder: string;
}

const APP_RATE = 0.2;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export default function PricingPicker({ labels }: { labels: PickerLabels }) {
  const [aov, setAov] = useState(150);
  const [orders, setOrders] = useState(600);

  const costFor = (p: PickerPlan) => p.fee + Math.max(0, orders - p.included) * p.over;
  const best = labels.plans.reduce((a, b) => (costFor(b) < costFor(a) ? b : a));
  const appCost = orders * aov * APP_RATE;
  const ourCost = costFor(best);
  const diff = appCost - ourCost;

  return (
    <div>
      {/* plans — the recommended one lights up as the sliders move */}
      <div className="grid gap-5 lg:grid-cols-3">
        {labels.plans.map((p) => {
          const on = p.name === best.name;
          return (
            <article
              key={p.name}
              className={`card p-7 transition-all duration-500 ${
                on ? '!border-[1.5px] !border-karkadeh lg:-my-1.5 lg:py-8' : 'opacity-90'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[1.15rem] font-semibold" dir="ltr">
                  {p.name}
                </h3>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[0.72rem] font-medium transition-opacity duration-300 ${
                    on ? 'bg-karkadeh text-semna opacity-100' : 'opacity-0'
                  }`}
                >
                  {labels.yourPlan}
                </span>
              </div>

              <p className="mt-4 flex items-baseline gap-2.5">
                <span className="num text-[2.4rem] font-medium leading-none">{fmt(p.fee)}</span>
                <span className="text-[0.95rem] text-ink/70">{labels.perMonth}</span>
              </p>

              <dl className="mt-6 space-y-3 border-t border-ink/10 pt-5 text-[1rem]">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink/70">{labels.rows.included}</dt>
                  <dd className="num font-medium">{fmt(p.included)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink/70">{labels.rows.overage}</dt>
                  <dd className="font-medium">
                    <span className="num">{p.over}</span> {labels.perOrder}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink/70">{labels.rows.fits}</dt>
                  <dd className="font-medium">{p.fits}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>

      {/* the instrument */}
      <div className="card mt-8 p-7 sm:p-9">
        <div className="grid gap-8 sm:grid-cols-2">
          <label className="block">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{labels.aov}</span>
              <span className="num text-[1.3rem] font-medium">
                {fmt(aov)} <span className="text-[0.85rem] text-ink/60">{labels.egp}</span>
              </span>
            </span>
            <input
              type="range"
              min="80"
              max="400"
              step="10"
              value={aov}
              onChange={(e) => setAov(+e.target.value)}
              className="calc-range mt-4 w-full"
              aria-label={labels.aov}
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
              aria-label={labels.orders}
            />
          </label>
        </div>

        {/* the two sides */}
        <div className="mt-9">
          <div className="flex overflow-hidden rounded-[var(--radius-md)]">
            <div
              className="flex items-center bg-karkadeh px-4 py-4 transition-[width] duration-300"
              style={{ width: `${Math.max(12, Math.min(88, (appCost / Math.max(appCost, ourCost)) * 100))}%` }}
            >
              <span className="num text-[1.05rem] font-semibold text-semna">{fmt(appCost)}</span>
            </div>
            <div className="flex flex-1 items-center bg-ink px-4 py-4">
              <span className="num text-[1.05rem] font-semibold text-semna">{fmt(ourCost)}</span>
            </div>
          </div>
          <div className="mt-2.5 flex justify-between gap-4 text-[0.92rem]">
            <span className="font-medium text-karkadeh">{labels.appSide}</span>
            <span className="text-ink/75">
              {labels.ourSide} <span className="font-semibold" dir="ltr">{best.name}</span>
            </span>
          </div>
        </div>

        {diff > 0 && (
          <p className="mt-7 text-center text-[1.2rem] font-semibold">
            {labels.diff} <span className="num text-karkadeh">{fmt(diff)}</span> {labels.egp} {labels.perMonth}
          </p>
        )}

        <p className="mt-4 text-center text-[0.85rem] text-ink/65">{labels.assumption}</p>
      </div>
    </div>
  );
}
