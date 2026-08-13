/**
 * The hero: a WhatsApp conversation that plays itself.
 *
 * Design rules honoured here:
 * - SSR/no-JS/reduced-motion render the COMPLETE conversation (final state).
 * - All bubbles keep their layout slot; animation is opacity/transform only → zero CLS.
 * - WhatsApp's own colours appear ONLY inside the phone screen — that's the
 *   customer's environment showing through (BRAND-SPEC §1), our palette never joins in.
 * - «عرض توضيحي» is rendered inside the screen — it cannot be cropped off.
 * - The restaurant is fictional; Munadim never appears in the conversation.
 */
import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import type { ChatMsg } from '../content/types';

interface Props {
  restaurant: string;
  status: string;
  demoLabel: string;
  replayLabel: string;
  chat: ChatMsg[];
  /** Direction of chat text (the demo conversation is Arabic on both pages). */
  rtlChat?: boolean;
}

/** Fixed waveform so SSR and client render identically. */
const WAVE = [5, 9, 14, 8, 12, 17, 10, 6, 12, 16, 9, 5, 8, 13, 18, 11, 7, 10, 15, 8, 5, 9, 12, 6];

const IN_DELAY = 1050;
const TYPING_MS = 1200;

export default function PhoneChat({ restaurant, status, demoLabel, replayLabel, chat, rtlChat = true }: Props) {
  const n = chat.length;
  // Start complete: SSR markup and no-JS view show the whole conversation.
  const [visible, setVisible] = useState(n);
  const [typing, setTyping] = useState(false);
  const [played, setPlayed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.45, once: true });
  const reduced = useReducedMotion();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const play = () => {
    clearTimers();
    setVisible(0);
    setTyping(false);
    let at = 500;
    chat.forEach((m, i) => {
      if (m.from === 'out') {
        timers.current.push(setTimeout(() => setTyping(true), at));
        at += TYPING_MS;
        timers.current.push(
          setTimeout(() => {
            setTyping(false);
            setVisible(i + 1);
          }, at),
        );
      } else {
        timers.current.push(setTimeout(() => setVisible(i + 1), at));
      }
      at += m.from === 'in' ? IN_DELAY : 900;
    });
    timers.current.push(setTimeout(() => setPlayed(true), at));
  };

  useEffect(() => {
    if (inView && !reduced && !played) play();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced]);

  return (
    <div ref={ref} className="w-[min(88vw,330px)]">
      {/* Phone frame */}
      <div className="overflow-hidden rounded-[2.1rem] border-[7px] border-[#26211f] bg-[#26211f] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.55)]">
        <div className="relative flex h-[640px] flex-col overflow-hidden rounded-[1.65rem] bg-[#EFEAE2]" dir={rtlChat ? 'rtl' : 'ltr'}>
          {/* Chat header — the restaurant's identity, never ours */}
          <div className="flex items-center gap-3 bg-[#F0F2F5] px-4 pb-2.5 pt-3.5">
            <div
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#6B4226] text-[15px] font-bold text-white"
            >
              {restaurant.trim().charAt(0)}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[15px] font-semibold text-[#111B21]">{restaurant}</p>
              <p className="text-[12px] text-[#667781]">{status}</p>
            </div>
          </div>

          {/* Demo label — inside the screen, un-croppable */}
          <div className="pointer-events-none absolute inset-x-0 top-[62px] z-10 flex justify-center">
            <span className="rounded-full bg-[#111B21]/60 px-3 py-0.5 text-[11px] font-medium text-[#F5EFE7]">
              {demoLabel}
            </span>
          </div>

          {/* Messages */}
          <div className="flex flex-1 flex-col gap-1.5 overflow-hidden px-3 pb-3 pt-8">
            {chat.map((m, i) => (
              <Bubble
                key={i}
                msg={m}
                shown={i < visible}
                /* ticks go blue once the customer has "seen" it — i.e. play moved past */
                seen={i < visible - 1 || (played && i < n)}
              />
            ))}

            {/* Typing indicator occupies its own slot only while typing */}
            <div
              className={`flex w-fit items-center gap-1 self-end rounded-lg rounded-es-none bg-white px-3.5 py-2.5 shadow-sm transition-opacity duration-200 ${typing ? 'opacity-100' : 'h-0 overflow-hidden py-0 opacity-0'}`}
              aria-hidden="true"
            >
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8696A0]"
                  style={{ animationDelay: `${d * 0.15}s`, animationDuration: '0.9s' }}
                />
              ))}
            </div>
          </div>

          {/* Replay — only after the sequence finished, JS present */}
          {played && !reduced && (
            <button
              type="button"
              onClick={() => {
                setPlayed(false);
                play();
              }}
              className="absolute bottom-2.5 start-2.5 z-10 flex min-h-[36px] items-center rounded-full bg-[#111B21]/55 px-3 text-[12px] font-medium text-[#F5EFE7]"
            >
              {replayLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Bubble({ msg, shown, seen }: { msg: ChatMsg; shown: boolean; seen: boolean }) {
  const out = msg.from === 'out';
  return (
    <div
      className={`w-fit max-w-[85%] rounded-lg px-2.5 py-1.5 shadow-sm transition-all duration-300 ease-out ${
        out ? 'self-end rounded-es-none bg-[#D9FDD3]' : 'self-start rounded-ss-none bg-white'
      } ${shown ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'}`}
    >
      {msg.voice ? (
        <VoiceNote duration={msg.voice.duration} playing={shown} />
      ) : msg.bill ? (
        <BillCard bill={msg.bill} />
      ) : (
        <p dir="auto" className="text-[13.5px] leading-[1.55] text-[#111B21]">{msg.text}</p>
      )}

      <div className="mt-0.5 flex items-center justify-end gap-1">
        <span className="num text-[10px] text-[#667781]">{msg.time}</span>
        {out && <Ticks blue={seen} />}
      </div>
    </div>
  );
}

function VoiceNote({ duration, playing }: { duration: string; playing: boolean }) {
  return (
    <div className="flex min-w-[190px] items-center gap-2 py-1">
      <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0 fill-[#54656F]" aria-hidden="true">
        <path d="M8 5.5v13l10-6.5-10-6.5Z" />
      </svg>
      <div className="flex h-6 flex-1 items-center gap-[2px]" aria-hidden="true">
        {WAVE.map((h, i) => (
          <span
            key={i}
            className="w-[2.5px] rounded-full bg-[#8696A0]"
            style={{
              height: `${h}px`,
              transition: 'background-color 0.25s',
              transitionDelay: `${i * 0.08}s`,
              backgroundColor: playing ? '#54656F' : '#AEBAC1',
            }}
          />
        ))}
      </div>
      <span className="num text-[11px] text-[#667781]">{duration}</span>
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-[#54656F]" aria-hidden="true">
        <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
      </svg>
    </div>
  );
}

function BillCard({ bill }: { bill: NonNullable<ChatMsg['bill']> }) {
  return (
    <div className="min-w-[210px] py-0.5 text-[13px] leading-relaxed text-[#111B21]">
      {bill.lines.map((l) => (
        <div key={l.label} className="flex items-baseline justify-between gap-4">
          <span>{l.label}</span>
          <span className="num">{l.price}</span>
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-[#111B21]/10 pt-1 font-semibold">
        <span>{bill.total.label}</span>
        <span className="num">{bill.total.price}</span>
      </div>
      {bill.after && <p className="mt-1.5">{bill.after}</p>}
    </div>
  );
}

function Ticks({ blue }: { blue: boolean }) {
  return (
    <svg viewBox="0 0 18 12" className="h-3 w-[18px]" aria-hidden="true">
      <path
        d="M1 6.5 4 9.5 10 2.5"
        fill="none"
        stroke={blue ? '#53BDEB' : '#8696A0'}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 6.5 10 9.5 16 2.5"
        fill="none"
        stroke={blue ? '#53BDEB' : '#8696A0'}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
