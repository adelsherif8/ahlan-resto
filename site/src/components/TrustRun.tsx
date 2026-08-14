/**
 * The 110 scenarios — shown as the suite actually running, not asserted.
 * Scenario lines tick through, the counter climbs to 110, and it ends on
 * "110 / 110". Process, never a guarantee (decision 6).
 *
 * SSR / no-JS / reduced-motion render the finished run.
 */
import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

export interface RunLabels {
  title: string;
  sentence: string;
  num: string;
  ofLabel: string;
  passing: string;
  cases: string[];
  replay: string;
}

export default function TrustRun({ labels }: { labels: RunLabels }) {
  const target = parseInt(labels.num, 10) || 110;
  const [count, setCount] = useState(target);
  const [line, setLine] = useState(labels.cases.length);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5, once: true });
  const reduced = useReducedMotion();
  const raf = useRef<number>(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    cancelAnimationFrame(raf.current);
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const play = () => {
    clear();
    setCount(0);
    setLine(0);

    labels.cases.forEach((_, i) => {
      timers.current.push(setTimeout(() => setLine(i + 1), 350 + i * 620));
    });

    const dur = 350 + labels.cases.length * 620;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      setCount(Math.round(target * (1 - Math.pow(1 - p, 2))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (inView && !reduced) play();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced]);

  const finished = count >= target;

  return (
    <div ref={ref} className="mx-auto max-w-3xl">
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-semna/12 bg-[#1D1917]">
        {/* head */}
        <div className="flex items-center justify-between gap-4 border-b border-semna/10 px-5 py-3">
          <p className="num text-[0.78rem] tracking-[0.1em] text-semna/55">{labels.title}</p>
          <p className="flex items-baseline gap-1.5">
            <span className="num text-[1.05rem] font-semibold text-brass">{count}</span>
            <span className="num text-[0.8rem] text-semna/45">
              {labels.ofLabel} {labels.num}
            </span>
          </p>
        </div>

        {/* the run */}
        <ul className="space-y-2 px-5 py-4">
          {labels.cases.map((c, i) => {
            const on = i < line;
            return (
              <li
                key={c}
                className={`flex items-center gap-3 transition-all duration-400 ${on ? 'opacity-100' : 'opacity-25'}`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-all duration-400 ${
                    on ? 'bg-brass' : 'bg-semna/15'
                  }`}
                  aria-hidden="true"
                >
                  {on && (
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5">
                      <path d="M2 6.2 4.6 8.8 10 3.4" fill="none" stroke="#141110" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="text-[0.92rem] text-semna/85">{c}</span>
                <span className="num ms-auto text-[0.75rem] text-semna/40">{on ? labels.passing : '…'}</span>
              </li>
            );
          })}
        </ul>

        {/* progress */}
        <div className="h-0.5 w-full bg-semna/10">
          <div
            className="h-full bg-brass transition-[width] duration-300 ease-linear"
            style={{ width: `${(count / target) * 100}%` }}
            aria-hidden="true"
          />
        </div>

        <div className="flex items-center justify-between gap-4 px-5 py-3.5">
          <p className="text-[0.95rem] text-semna/85">{labels.sentence}</p>
          {finished && !reduced && (
            <button
              type="button"
              onClick={play}
              className="shrink-0 text-[0.82rem] font-medium text-semna/50 transition-colors hover:text-brass-light"
            >
              {labels.replay}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
