/**
 * How it starts — a vertical journey: the line draws itself, nodes light, and
 * each artifact builds in turn. Photos → a real menu → the first order.
 *
 * Deliberately a different shape from the what-is rail and the dine-in beats:
 * this one runs down the page, alternating sides.
 * SSR / no-JS / reduced-motion render every step complete.
 */
import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

export interface JourneyLabels {
  steps: { title: string; body: string }[];
  replay: string;
  demoLabel: string;
  menuTitle: string;
  menuItems: { name: string; price: string }[];
  setupChips: string[];
  orderTitle: string;
  orderItem: string;
  orderFrom: string;
  photosCaption: string;
}

const STEP_MS = 1500;

export default function StepsJourney({ labels }: { labels: JourneyLabels }) {
  const total = labels.steps.length;
  const [step, setStep] = useState(total);
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.25, once: true });
  const reduced = useReducedMotion();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const play = () => {
    clear();
    setDone(false);
    setStep(0);
    labels.steps.forEach((_, i) => {
      timers.current.push(setTimeout(() => setStep(i + 1), 500 + i * STEP_MS));
    });
    timers.current.push(setTimeout(() => setDone(true), 500 + total * STEP_MS));
  };

  useEffect(() => {
    if (inView && !reduced && !done) play();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced]);

  return (
    <div ref={ref} className="mx-auto max-w-4xl">
      <div className="relative">
      {/* the spine — scoped to the steps, never past the last node */}
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-ink/12 start-[13px] lg:start-1/2 lg:-translate-x-1/2 rtl:lg:translate-x-1/2"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute top-0 w-px bg-brass-deep transition-[height] duration-[1400ms] ease-out start-[13px] lg:start-1/2 lg:-translate-x-1/2 rtl:lg:translate-x-1/2"
        style={{ height: `${(step / total) * 100}%` }}
        aria-hidden="true"
      />

      <ol className="space-y-10 lg:space-y-5">
        {labels.steps.map((s, i) => {
          const on = step >= i + 1;
          const flip = i % 2 === 1;
          return (
            <li key={s.title} className="relative ps-10 lg:ps-0">
              {/* node */}
              <span
                className={`num absolute top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full text-[0.8rem] font-medium transition-all duration-500 start-0 lg:start-1/2 lg:-translate-x-1/2 rtl:lg:translate-x-1/2 ${
                  on ? 'scale-100 bg-ink text-brass' : 'scale-90 bg-ink/15 text-ink/65'
                }`}
              >
                {i + 1}
              </span>

              <div className="grid items-center gap-6 lg:grid-cols-2 lg:gap-0">
                {/* words */}
                <div
                  className={`transition-all duration-700 ${on ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-40'} ${
                    flip ? 'lg:col-start-2 lg:ps-14 lg:text-start' : 'lg:col-start-1 lg:pe-14 lg:text-end'
                  }`}
                >
                  <h3 className="text-[1.25rem]">{s.title}</h3>
                  <p className="mt-2 leading-relaxed text-ink/75">{s.body}</p>
                </div>

                {/* artifact */}
                <div
                  className={`transition-all duration-700 ${on ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'} ${
                    flip
                      ? 'lg:col-start-1 lg:row-start-1 lg:justify-self-end lg:pe-14'
                      : 'lg:col-start-2 lg:row-start-1 lg:justify-self-start lg:ps-14'
                  }`}
                >
                  {i === 0 && <Photos on={on} caption={labels.photosCaption} />}
                  {i === 1 && (
                    <MenuBuild
                      on={on}
                      title={labels.menuTitle}
                      items={labels.menuItems}
                      chips={labels.setupChips}
                      demoLabel={labels.demoLabel}
                    />
                  )}
                  {i === 2 && (
                    <FirstOrder
                      on={on}
                      title={labels.orderTitle}
                      item={labels.orderItem}
                      from={labels.orderFrom}
                      demoLabel={labels.demoLabel}
                    />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      </div>
    </div>
  );
}

/** 1 — phone photos of a paper menu, fanned */
function Photos({ on, caption }: { on: boolean; caption: string }) {
  const tilts = ['-8deg', '3deg', '10deg'];
  const offsets = ['-56px', '0px', '56px'];
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative h-[118px] w-[240px]">
        {tilts.map((t, i) => (
          <div
            key={i}
            className="absolute start-1/2 top-2 h-[104px] w-[84px] rounded-[3px] border border-ink/10 bg-[#FFFDF8] p-2 shadow-[0_8px_20px_-10px_rgba(20,17,16,0.4)] transition-all duration-700 ease-out"
            style={{
              transform: on
                ? `translateX(calc(-50% + ${offsets[i]})) rotate(${tilts[i]})`
                : 'translateX(-50%) rotate(0deg) translateY(10px)',
              transitionDelay: on ? `${i * 130}ms` : '0ms',
              opacity: on ? 1 : 0,
            }}
            aria-hidden="true"
          >
            {/* a paper menu: a heading rule and price lines */}
            <div className="h-1.5 w-8 rounded-full bg-ink/25" />
            <div className="mt-2 space-y-1.5">
              {[0, 1, 2, 3, 4].map((r) => (
                <div key={r} className="flex items-center gap-1">
                  <span className="h-[3px] flex-1 rounded-full bg-ink/12" />
                  <span className="h-[3px] w-3 rounded-full bg-ink/20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[0.78rem] text-ink/65">{caption}</p>
    </div>
  );
}

/** 2 — the menu we build from them, filling in line by line */
function MenuBuild({
  on,
  title,
  items,
  chips,
  demoLabel,
}: {
  on: boolean;
  title: string;
  items: { name: string; price: string }[];
  chips: string[];
  demoLabel: string;
}) {
  return (
    <div className="card w-[268px] p-4">
      <div className="flex items-center justify-between">
        <p className="text-[0.85rem] font-semibold">{title}</p>
        <span className="text-[0.62rem] text-ink/60">{demoLabel}</span>
      </div>

      <ul className="mt-3 space-y-1.5 border-t border-ink/10 pt-3">
        {items.map((it, i) => (
          <li
            key={it.name}
            className="flex items-baseline justify-between gap-3 text-[0.82rem] transition-all duration-500"
            style={{
              opacity: on ? 1 : 0,
              transform: on ? 'none' : 'translateY(4px)',
              transitionDelay: on ? `${200 + i * 160}ms` : '0ms',
            }}
          >
            <span>{it.name}</span>
            <span className="num text-ink/70">{it.price}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink/10 pt-3">
        {chips.map((c, i) => (
          <span
            key={c}
            className="rounded-full border border-brass-deep/30 bg-brass-15 px-2.5 py-0.5 text-[0.72rem] transition-all duration-500"
            style={{
              opacity: on ? 1 : 0,
              transform: on ? 'none' : 'translateY(4px)',
              transitionDelay: on ? `${700 + i * 140}ms` : '0ms',
            }}
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 3 — the first order landing */
function FirstOrder({
  on,
  title,
  item,
  from,
  demoLabel,
}: {
  on: boolean;
  title: string;
  item: string;
  from: string;
  demoLabel: string;
}) {
  return (
    <div className="w-[268px] rounded-[var(--radius-md)] bg-[#EFEAE2] p-3" dir="rtl">
      <div
        className="rounded-lg rounded-ss-none bg-white px-3 py-2.5 shadow-sm transition-all duration-600"
        style={{ opacity: on ? 1 : 0, transform: on ? 'none' : 'translateY(6px)', transitionDelay: on ? '250ms' : '0ms' }}
      >
        <p className="text-[0.82rem] font-semibold text-[#111B21]">{title}</p>
        <p className="mt-1 text-[0.8rem] text-[#111B21]">{item}</p>
        <p className="mt-1 text-[0.72rem] text-[#667781]">{from}</p>
        <div className="mt-1.5 flex items-center justify-end">
          <span className="num text-[0.62rem] text-[#667781]">9:41</span>
        </div>
      </div>
      <p className="mt-2 text-center text-[0.6rem] font-medium text-[#667781]">{demoLabel}</p>
    </div>
  );
}
