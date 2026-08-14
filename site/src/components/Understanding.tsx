/**
 * "It understands your customers the way they actually talk" — proven as a
 * translation table: the messy thing the customer sends on one side, the
 * structured order it becomes on the other. Rows land one by one.
 *
 * Every pair is a verified capability (feature-truth §4.1–4.4).
 * SSR / no-JS / reduced-motion render the whole table.
 */
import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

export interface Pair {
  head: string;
  /** what the customer sends */
  input: { kind: 'voice' | 'text' | 'location'; text?: string; duration?: string };
  /** what the code ends up with */
  fields: { label: string; value: string }[];
}

export interface UnderstandingLabels {
  pairs: Pair[];
  sends: string;
  gets: string;
  replay: string;
}

const ROW_MS = 900;
const WAVE = [4, 8, 13, 7, 11, 15, 9, 5, 11, 14, 8, 4, 8, 12, 16, 10, 6, 9, 13, 7];

export default function Understanding({ labels }: { labels: UnderstandingLabels }) {
  const total = labels.pairs.length;
  const [shown, setShown] = useState(total);
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.2, once: true });
  const reduced = useReducedMotion();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const play = () => {
    clear();
    setDone(false);
    setShown(0);
    labels.pairs.forEach((_, i) => {
      timers.current.push(setTimeout(() => setShown(i + 1), 400 + i * ROW_MS));
    });
    timers.current.push(setTimeout(() => setDone(true), 400 + total * ROW_MS));
  };

  useEffect(() => {
    if (inView && !reduced && !done) play();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced]);

  return (
    <div ref={ref}>
      {/* column headings */}
      <div className="mb-3 hidden items-baseline gap-5 px-1 lg:grid lg:grid-cols-[0.85fr_1.05fr_auto_1.15fr]">
        <span />
        <span className="label-cap text-ink/45">{labels.sends}</span>
        <span />
        <span className="label-cap text-ink/45">{labels.gets}</span>
      </div>

      <ol className="divide-y divide-ink/[0.09] border-y border-ink/[0.09]">
        {labels.pairs.map((p, i) => {
          const on = i < shown;
          return (
            <li
              key={p.head}
              className={`grid items-center gap-4 py-5 transition-all duration-600 ease-out lg:grid-cols-[0.85fr_1.05fr_auto_1.15fr] lg:gap-5 ${
                on ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
              }`}
            >
              {/* capability */}
              <h3 className="flex items-center gap-2.5 text-[1.05rem]">
                <span className="h-2 w-2 shrink-0 rounded-full bg-brass-deep" aria-hidden="true" />
                {p.head}
              </h3>

              {/* what he sends */}
              <div dir="rtl" className="flex">
                {p.input.kind === 'voice' ? (
                  <div className="flex w-fit items-center gap-2.5 rounded-lg rounded-ss-none bg-white px-3 py-2 shadow-sm">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-[#54656F]" aria-hidden="true">
                      <path d="M8 5.5v13l10-6.5-10-6.5Z" />
                    </svg>
                    <span className="flex h-4 items-center gap-[2px]" aria-hidden="true">
                      {WAVE.map((h, k) => (
                        <span
                          key={k}
                          className="w-[2px] rounded-full transition-colors duration-300"
                          style={{
                            height: `${h}px`,
                            backgroundColor: on ? '#54656F' : '#AEBAC1',
                            transitionDelay: on ? `${k * 45}ms` : '0ms',
                          }}
                        />
                      ))}
                    </span>
                    <span className="num text-[11px] text-[#667781]">{p.input.duration}</span>
                  </div>
                ) : (
                  <p
                    dir="auto"
                    className="w-fit rounded-lg rounded-ss-none bg-white px-3 py-2 text-[0.85rem] leading-[1.55] text-[#111B21] shadow-sm"
                  >
                    {p.input.kind === 'location' && <span className="me-1">📍</span>}
                    {p.input.text}
                  </p>
                )}
              </div>

              {/* the turn */}
              <span className="hidden justify-self-center lg:block" aria-hidden="true">
                <svg viewBox="0 0 20 12" className="h-3.5 w-6 rtl:-scale-x-100">
                  <path
                    d="M2 6h14m0 0-4-4m4 4-4 4"
                    fill="none"
                    stroke="var(--brass-deep)"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ opacity: on ? 1 : 0.25, transition: 'opacity .5s' }}
                  />
                </svg>
              </span>

              {/* what the code ends up with */}
              <dl className="rounded-[var(--radius-md)] border border-ink/10 bg-[#FFFDF8] px-4 py-3">
                {p.fields.map((f, k) => (
                  <div
                    key={f.label}
                    className="flex items-baseline justify-between gap-3 py-0.5 text-[0.88rem] transition-all duration-500"
                    style={{
                      opacity: on ? 1 : 0,
                      transform: on ? 'none' : 'translateY(3px)',
                      transitionDelay: on ? `${220 + k * 140}ms` : '0ms',
                    }}
                  >
                    <dt className="shrink-0 text-[0.8rem] text-ink/50">{f.label}</dt>
                    <dd className="text-end font-medium">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ol>

      {done && !reduced && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={play}
            className="flex min-h-[40px] items-center rounded-full border border-ink/20 px-5 text-[0.9rem] font-medium text-ink/70 transition-colors hover:border-ink/40 hover:text-ink"
          >
            {labels.replay}
          </button>
        </div>
      )}
    </div>
  );
}
