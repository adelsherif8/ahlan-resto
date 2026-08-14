/**
 * One order, three outputs — shown as a rail of steps beside a single panel.
 * The panel auto-advances once on scroll (receipt → ticket → customer), then
 * rests on the customer, which is the position. The rail stays clickable.
 *
 * The artifacts themselves are Astro markup passed in as named slots, so the
 * receipt / thermal ticket / profile stay authored where the content lives.
 * SSR / no-JS / reduced-motion show the last panel with all rail items lit.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

interface Props {
  steps: string[];
  demoLabel: string;
  replay: string;
  p1?: ReactNode;
  p2?: ReactNode;
  p3?: ReactNode;
}

const DWELL = 3400;

export default function OrderOutputs({ steps, demoLabel, replay, p1, p2, p3 }: Props) {
  const panels = [p1, p2, p3];
  const [active, setActive] = useState(steps.length - 1); // rest state = the customer
  const [auto, setAuto] = useState(false);
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
    setAuto(true);
    setActive(0);
    steps.forEach((_, i) => {
      if (i === 0) return;
      timers.current.push(setTimeout(() => setActive(i), i * DWELL));
    });
    timers.current.push(
      setTimeout(() => {
        setAuto(false);
        setDone(true);
      }, (steps.length - 1) * DWELL + 600),
    );
  };

  useEffect(() => {
    if (inView && !reduced && !done) play();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced]);

  const pick = (i: number) => {
    clear();
    setAuto(false);
    setDone(true);
    setActive(i);
  };

  return (
    <div ref={ref} className="grid items-start gap-6 lg:grid-cols-[auto_1fr] lg:gap-10">
      {/* the rail */}
      <ul className="flex gap-2.5 overflow-x-auto pb-1 lg:flex-col lg:gap-3 lg:overflow-visible lg:pb-0">
        {steps.map((s, i) => {
          const on = i === active;
          const passed = i < active;
          return (
            <li key={s} className="relative shrink-0">
              <button
                type="button"
                onClick={() => pick(i)}
                aria-current={on ? 'step' : undefined}
                className={`flex min-h-[48px] w-full items-center gap-2.5 rounded-full border px-5 text-start transition-all duration-500 lg:w-[15.5rem] ${
                  on
                    ? 'border-brass-deep/60 bg-brass-15'
                    : passed
                      ? 'border-ink/15 bg-[#FFFDF8]'
                      : 'border-ink/10 bg-transparent hover:border-ink/25'
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full transition-all duration-500 ${
                    on ? 'scale-125 bg-brass-deep' : passed ? 'bg-brass-deep/70' : 'bg-ink/20'
                  }`}
                  aria-hidden="true"
                />
                <span
                  className={`whitespace-nowrap text-[0.98rem] font-semibold transition-opacity lg:whitespace-normal ${
                    on || passed ? 'opacity-100' : 'opacity-60'
                  }`}
                >
                  {s}
                </span>
              </button>

              {/* the line into the panel */}
              <span
                className={`pointer-events-none absolute top-1/2 hidden h-px w-10 -translate-y-1/2 transition-colors duration-500 lg:block ltr:left-full rtl:right-full ${
                  on ? 'bg-brass-deep' : 'bg-ink/12'
                }`}
                aria-hidden="true"
              />
            </li>
          );
        })}
      </ul>

      {/* the panel */}
      <div className="card relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink/10 px-5 py-3">
          <h3 className="text-[0.98rem]">{steps[active]}</h3>
          <div className="flex items-center gap-3">
            {done && !reduced && (
              <button
                type="button"
                onClick={play}
                className="text-[0.8rem] font-medium text-ink/55 transition-colors hover:text-ink"
              >
                {replay}
              </button>
            )}
            <span className="text-[0.68rem] text-ink/40">{demoLabel}</span>
          </div>
        </div>

        <div className="relative min-h-[420px] px-5 py-6">
          {panels.map((panel, i) => (
            <div
              key={i}
              aria-hidden={i !== active}
              className={`transition-all duration-500 ease-out ${
                i === active
                  ? 'relative z-10 translate-y-0 opacity-100'
                  : 'pointer-events-none absolute inset-x-5 top-6 translate-y-1.5 opacity-0'
              }`}
            >
              {panel}
            </div>
          ))}
        </div>

        {/* progress hairline while auto-playing */}
        <div className="h-0.5 w-full bg-ink/[0.06]">
          <div
            className="h-full bg-brass-deep transition-[width] duration-500 ease-linear"
            style={{ width: `${((active + 1) / steps.length) * 100}%`, opacity: auto ? 1 : 0.45 }}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
