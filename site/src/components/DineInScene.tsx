/**
 * Dine-in, demonstrated: the code on the table → the guest scans and orders →
 * the record lands in the owner's dashboard. Three beats, played on scroll.
 *
 * Honesty guards (feature-truth §0): the QR is one click-to-chat code — it does
 * NOT know the table, so the agent asks. Nothing here claims otherwise.
 * SSR / no-JS / reduced-motion render the final state of all three beats.
 */
import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

export interface SceneLabels {
  step1: string;
  step2: string;
  step3: string;
  captured: string;
  replay: string;
  restaurant: string;
  demoLabel: string;
  dashTitle: string;
  chat: { from: 'in' | 'out'; text: string }[];
  guestName: string;
  guestPhone: string;
  chips: string[];
  stats: { value: string; label: string }[];
  noteLabel: string;
  noteValue: string;
  orderLabel: string;
  orderCode: string;
  orderItem: string;
  orderMeta: string;
  orderTotal: string;
}

interface Props {
  labels: SceneLabels;
}

const BEAT = [900, 2100, 3600]; // ms at which beats 1..3 land

export default function DineInScene({ labels }: Props) {
  const [step, setStep] = useState(3); // complete by default
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4, once: true });
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
    BEAT.forEach((at, i) => {
      timers.current.push(setTimeout(() => setStep(i + 1), at));
    });
    timers.current.push(setTimeout(() => setDone(true), BEAT[BEAT.length - 1]! + 900));
  };

  useEffect(() => {
    if (inView && !reduced && !done) play();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced]);

  const beats = [labels.step1, labels.step2, labels.step3];

  return (
    <div ref={ref} className="relative">
      {/* the three beats */}
      <ol className="grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:gap-3">
        {/* 1 — the table */}
        <Beat index={0} step={step} label={beats[0]!}>
          <div className="relative flex h-[236px] w-full items-end justify-center overflow-hidden rounded-[var(--radius-md)] bg-[#E7DCCB]">
            {/* table surface */}
            <div className="absolute inset-x-0 bottom-0 h-[62%] bg-[#D8C9B2]" aria-hidden="true" />
            <div className="absolute inset-x-6 bottom-[62%] h-px bg-ink/10" aria-hidden="true" />

            {/* tent card */}
            <div className="relative mb-7 w-[104px] rounded-t-[3px] bg-[#FFFDF8] px-3 pb-3 pt-2.5 text-center shadow-[0_10px_20px_-10px_rgba(20,17,16,0.45)]">
              <p className="truncate text-[8.5px] font-bold text-ink">{labels.restaurant}</p>
              <div className="relative mx-auto mt-1.5 w-fit">
                <MiniQR active={step >= 1} />
                {/* scan beam */}
                <span
                  className={`pointer-events-none absolute inset-x-0 h-[2px] bg-brass-deep shadow-[0_0_8px_2px_rgba(138,96,30,0.5)] transition-opacity duration-200 ${
                    step === 1 ? 'animate-scan opacity-100' : 'opacity-0'
                  }`}
                  aria-hidden="true"
                />
              </div>
              <p className="mt-1.5 text-[7px] leading-tight text-ink/70">امسح واطلب</p>
            </div>

            {/* the guest's phone entering to scan */}
            <div
              className={`absolute bottom-4 end-4 h-[74px] w-[42px] rounded-[7px] border-[2.5px] border-[#26211f] bg-[#EFEAE2] transition-all duration-700 ease-out ${
                step >= 1 ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
              }`}
              aria-hidden="true"
            >
              <div className="mx-auto mt-1.5 h-1 w-3 rounded-full bg-[#26211f]/40" />
              <div className="mt-2 flex justify-center">
                <span className="block h-6 w-6 rounded-[2px] border border-brass-deep/70" />
              </div>
            </div>
          </div>
        </Beat>

        <Connector active={step >= 2} />

        {/* 2 — the conversation */}
        <Beat index={1} step={step} label={beats[1]!}>
          <div className="relative flex h-[236px] w-full flex-col overflow-hidden rounded-[var(--radius-md)] bg-[#EFEAE2]" dir="rtl">
            <div className="flex items-center gap-2 bg-[#F0F2F5] px-3 py-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#6B4226] text-[9px] font-bold text-white">
                {labels.restaurant.trim().charAt(0)}
              </span>
              <span className="truncate text-[10px] font-semibold text-[#111B21]">{labels.restaurant}</span>
              <span className="ms-auto rounded-full bg-[#111B21]/55 px-1.5 text-[7.5px] text-[#F5EFE7]">
                {labels.demoLabel}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-2.5">
              {labels.chat.map((m, i) => (
                <p
                  key={i}
                  dir="auto"
                  className={`w-fit max-w-[86%] rounded-md px-2 py-1 text-[10px] leading-[1.5] text-[#111B21] shadow-sm transition-all duration-300 ${
                    m.from === 'out' ? 'self-end rounded-es-none bg-[#D9FDD3]' : 'self-start rounded-ss-none bg-white'
                  } ${step >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'}`}
                  style={{ transitionDelay: step >= 2 ? `${i * 260}ms` : '0ms' }}
                >
                  {m.text}
                </p>
              ))}
            </div>
          </div>
        </Beat>

        <Connector active={step >= 3} />

        {/* 3 — the dashboard */}
        <Beat index={2} step={step} label={beats[2]!} highlight>
          <div className="flex h-[236px] w-full flex-col overflow-hidden rounded-[var(--radius-md)] border border-ink/10 bg-[#FFFDF8]">
            <div className="flex items-center justify-between border-b border-ink/10 px-3 py-2">
              <span className="text-[9.5px] font-medium text-ink/60">{labels.dashTitle}</span>
              <span className="text-[8px] text-ink/40">{labels.demoLabel}</span>
            </div>

            <div
              className={`flex flex-1 flex-col gap-2 overflow-hidden px-3 pb-2 transition-all duration-500 ${
                step >= 3 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
              }`}
            >
              {/* identity */}
              <div className="flex items-center gap-2.5 pt-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-karkadeh-10 text-[0.8rem] font-bold text-karkadeh">
                  {labels.guestName.trim().charAt(0)}
                </span>
                <div className="min-w-0 leading-tight">
                  <p className="text-[0.8rem] font-semibold">{labels.guestName}</p>
                  <p className="num text-[0.68rem] text-ink/60" dir="ltr">
                    {labels.guestPhone}
                  </p>
                </div>
                <span className="ms-auto rounded-full bg-brass-15 px-2 py-0.5 text-[0.62rem] font-medium text-ink/75">
                  {labels.chips[1]}
                </span>
              </div>

              {/* the stat tiles from the real profile */}
              <div className="grid grid-cols-3 gap-1">
                {labels.stats.map((st, i) => (
                  <div
                    key={st.label}
                    className="rounded-[4px] bg-ink/[0.04] px-1.5 py-1.5 text-center transition-all duration-500"
                    style={{ transitionDelay: step >= 3 ? `${180 + i * 110}ms` : '0ms' }}
                  >
                    <p className="num text-[0.82rem] font-semibold leading-none">{st.value}</p>
                    <p className="mt-0.5 truncate text-[0.55rem] uppercase tracking-wide text-ink/50">{st.label}</p>
                  </div>
                ))}
              </div>

              {/* the note the bot actually reads */}
              <div
                className="rounded-[4px] border border-ink/10 px-2 py-1.5 transition-all duration-500"
                style={{ transitionDelay: step >= 3 ? '460ms' : '0ms' }}
              >
                <p className="text-[0.55rem] uppercase tracking-wide text-ink/45">{labels.noteLabel}</p>
                <p className="mt-0.5 text-[0.72rem] font-medium">{labels.noteValue}</p>
              </div>

              {/* the order it came from */}
              <div
                className="rounded-[4px] border border-ink/10 px-2 py-1.5 transition-all duration-500"
                style={{ transitionDelay: step >= 3 ? '600ms' : '0ms' }}
              >
                <p className="text-[0.55rem] uppercase tracking-wide text-ink/45">{labels.orderLabel}</p>
                <div className="mt-0.5 flex items-baseline justify-between gap-2">
                  <span className="num text-[0.7rem] font-semibold" dir="ltr">{labels.orderCode}</span>
                  <span className="num text-[0.68rem] text-ink/70" dir="ltr">{labels.orderTotal}</span>
                </div>
                <p className="num truncate text-[0.62rem] text-ink/55" dir="ltr">{labels.orderItem}</p>
              </div>
            </div>
          </div>
        </Beat>
      </ol>

      {done && !reduced && (
        <div className="mt-6 flex justify-center">
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

function Beat({
  index,
  step,
  label,
  highlight = false,
  children,
}: {
  index: number;
  step: number;
  label: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const active = step >= index + 1;
  return (
    <li
      className={`card flex flex-col p-4 transition-all duration-500 ${
        active ? 'opacity-100' : 'opacity-55'
      } ${highlight && active ? '!border-[1.5px] !border-brass-deep/45' : ''}`}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className={`num flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.78rem] font-medium transition-colors duration-500 ${
            active ? (highlight ? 'bg-brass-deep text-semna' : 'bg-ink text-brass') : 'bg-ink/15 text-ink/50'
          }`}
        >
          {index + 1}
        </span>
        <h3 className="text-[0.98rem]">{label}</h3>
      </div>
      {children}
    </li>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <li className="flex items-center justify-center py-1" aria-hidden="true">
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full border bg-[#FFFDF8] transition-colors duration-500 ${
          active ? 'border-brass-deep/45' : 'border-ink/12'
        }`}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 rtl:-scale-x-100">
          <path
            d="M2 8h11m0 0-4-4m4 4-4 4"
            fill="none"
            stroke={active ? 'var(--brass-deep)' : 'rgba(20,17,16,0.25)'}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </li>
  );
}

function MiniQR({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 44 44"
      className={`h-12 w-12 transition-transform duration-300 ${active ? 'scale-105' : 'scale-100'}`}
      role="img"
      aria-label="QR"
    >
      <rect width="44" height="44" fill="#FFFDF8" />
      <g fill="#8C1D2F">
        <path d="M3 3h12v12H3zM6 6v6h6V6z" fillRule="evenodd" />
        <path d="M29 3h12v12H29zM32 6v6h6V6z" fillRule="evenodd" />
        <path d="M3 29h12v12H3zM6 32v6h6V32z" fillRule="evenodd" />
        <rect x="20" y="4" width="4" height="4" />
        <rect x="20" y="12" width="4" height="4" />
        <rect x="18" y="20" width="5" height="5" />
        <rect x="27" y="22" width="4" height="4" />
        <rect x="35" y="20" width="4" height="4" />
        <rect x="6" y="20" width="4" height="4" />
        <rect x="20" y="29" width="4" height="4" />
        <rect x="28" y="31" width="5" height="4" />
        <rect x="22" y="37" width="4" height="4" />
        <rect x="36" y="36" width="5" height="5" />
      </g>
    </svg>
  );
}
