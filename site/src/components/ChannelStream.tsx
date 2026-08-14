/**
 * The channel, demonstrated: delivery, pickup and dine-in all pour into ONE
 * customer list that belongs to the restaurant. Orders arrive one by one; the
 * list grows; the counter climbs.
 *
 * SSR / no-JS / reduced-motion render the finished list.
 */
import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

export interface StreamRow {
  name: string;
  phone: string;
  item: string;
  /** index into `channels` */
  channel: number;
  visits: string;
  egp: string;
  ago: string;
  badge: string;
}

export interface StreamLabels {
  channels: string[];
  panelTitle: string;
  counter: string;
  counterOne: string;
  captured: string;
  replay: string;
  demoLabel: string;
  filters: string[];
  rows: StreamRow[];
}

const STEP_MS = 1100;

export default function ChannelStream({ labels }: { labels: StreamLabels }) {
  const total = labels.rows.length;
  const [count, setCount] = useState(total); // complete by default
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35, once: true });
  const reduced = useReducedMotion();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const play = () => {
    clear();
    setDone(false);
    setCount(0);
    labels.rows.forEach((_, i) => {
      timers.current.push(setTimeout(() => setCount(i + 1), 600 + i * STEP_MS));
    });
    timers.current.push(setTimeout(() => setDone(true), 600 + total * STEP_MS));
  };

  useEffect(() => {
    if (inView && !reduced && !done) play();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced]);

  /** which channel is firing right now (the row that just landed) */
  const firing = count > 0 && count <= total ? labels.rows[count - 1]!.channel : -1;

  return (
    <div ref={ref} className="grid items-center gap-8 lg:grid-cols-[auto_1fr] lg:gap-12">
      {/* the three channels */}
      <ul className="flex justify-center gap-3 lg:flex-col lg:justify-start lg:gap-4">
        {labels.channels.map((c, i) => {
          const used = labels.rows.slice(0, count).some((r) => r.channel === i);
          const active = firing === i;
          return (
            <li
              key={c}
              className={`relative flex items-center gap-2.5 rounded-full border px-5 py-3 transition-all duration-500 ${
                active
                  ? 'border-brass-deep/60 bg-brass-15'
                  : used
                    ? 'border-ink/15 bg-[#FFFDF8]'
                    : 'border-ink/10 bg-transparent'
              }`}
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full transition-all duration-500 ${
                  active ? 'scale-125 bg-brass-deep' : used ? 'bg-brass-deep/70' : 'bg-ink/20'
                }`}
                aria-hidden="true"
              />
              <span className={`text-[1.02rem] font-semibold transition-opacity ${used || active ? 'opacity-100' : 'opacity-55'}`}>
                {c}
              </span>

              {/* the line into the panel (desktop only) */}
              <span
                className={`pointer-events-none absolute top-1/2 hidden h-px w-10 -translate-y-1/2 transition-colors duration-500 lg:block ltr:left-full rtl:right-full ${
                  active ? 'bg-brass-deep' : 'bg-ink/12'
                }`}
                aria-hidden="true"
              />
            </li>
          );
        })}
      </ul>

      {/* the one list they all pour into */}
      <div className="card overflow-hidden">
        <div className="border-b border-ink/10 px-5 pb-3 pt-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2.5">
              <h3 className="text-[1rem]">{labels.panelTitle}</h3>
              <span className="num text-[0.9rem] font-medium text-brass-deep">
                {count}
                <span className="ms-1 text-[0.8rem] text-ink/60">{count === 1 ? labels.counterOne : labels.counter}</span>
              </span>
            </div>
            <span className="text-[0.7rem] text-ink/60">{labels.demoLabel}</span>
          </div>

          {/* the real page's filter chips */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {labels.filters.map((f, i) => (
              <span
                key={f}
                className={`rounded-full px-2.5 py-1 text-[0.72rem] ${
                  i === 0 ? 'bg-ink text-semna' : 'bg-ink/[0.06] text-ink/65'
                }`}
              >
                {f}
              </span>
            ))}
          </div>
        </div>

        <ul className="divide-y divide-ink/[0.07]">
          {labels.rows.map((r, i) => {
            const shown = i < count;
            return (
              <li
                key={r.phone}
                className={`flex items-center gap-3.5 px-5 transition-all duration-500 ease-out ${
                  shown ? 'max-h-24 py-3.5 opacity-100' : 'max-h-0 overflow-hidden py-0 opacity-0'
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-karkadeh-10 text-[0.95rem] font-bold text-karkadeh">
                  {r.name.trim().charAt(0)}
                </span>

                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-[0.98rem] font-semibold">{r.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.8rem] text-ink/60">
                    <span className="num" dir="ltr">{r.phone}</span>
                    <span aria-hidden="true">·</span>
                    <span>{r.visits}</span>
                    <span aria-hidden="true">·</span>
                    <span className="num">{r.egp}</span>
                    <span aria-hidden="true">·</span>
                    <span className="num">{r.ago}</span>
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="rounded-full bg-brass-15 px-2 py-0.5 text-[0.72rem] font-medium text-ink/75">
                    {r.badge}
                  </span>
                  <span className="hidden text-[0.75rem] text-ink/65 sm:block">{labels.channels[r.channel]}</span>
                </div>
              </li>
            );
          })}
        </ul>

        <div
          className={`flex items-center gap-2 border-t border-ink/[0.07] bg-brass-15 px-5 py-3 transition-opacity duration-500 ${
            count >= total ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brass-deep" aria-hidden="true" />
          <span className="text-[0.85rem] font-medium text-ink/80">{labels.captured}</span>
        </div>
      </div>

      {done && !reduced && (
        <div className="lg:col-span-2 lg:justify-self-center">
          <button
            type="button"
            onClick={play}
            className="mx-auto flex min-h-[44px] items-center rounded-full border border-ink/20 px-5 text-[0.9rem] font-medium text-ink/70 transition-colors hover:border-ink/40 hover:text-ink"
          >
            {labels.replay}
          </button>
        </div>
      )}
    </div>
  );
}
