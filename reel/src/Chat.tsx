/**
 * The screen-recording cut.
 *
 * Where `Post` is a brand page with a phone on it, this is just the phone — the
 * WhatsApp screen fills the whole frame, Android chrome and all, as if the guest
 * had screen-recorded their own conversation. No headline, no logo lockup, no
 * cream page. The only thing selling it is that the conversation is real.
 *
 * Realism is the whole point, so: the green Android header with a live "بيكتب…"
 * state, a date divider, ticks that go sent → delivered → read, the thread
 * scrolling as it fills, and the input bar sitting where your thumb expects it.
 */
import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, Img, Sequence, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { THREADS, type Turn, type Thread } from './lib/threads';

const FACES: [string, string, string][] = [
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-regular.woff2', '400'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-500.woff2', '500'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-600.woff2', '600'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-700.woff2', '700'],
  ['PlexMono', 'fonts/ibm-plex-mono-v20-latin-500.woff2', '500'],
];
function useFontsReady() {
  const [h] = useState(() => delayRender('chat-fonts'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all(FACES.map(([fam, file, w]) => new FontFace(fam, `url(${staticFile(file)})`, { weight: w }).load()))
      .then((fs) => { fs.forEach((x) => document.fonts.add(x)); setReady(true); continueRender(h); });
  }, [h]);
  return ready;
}

const UI = 'Plex';
const MONO = 'PlexMono';

// real WhatsApp-on-Android, not an approximation of it
const WA = {
  bar: '#017561',      // status bar
  header: '#008069',   // app bar
  bg: '#EFE7DE',       // chat ground
  out: '#D9FDD3',      // your own messages
  in: '#FFFFFF',       // theirs
  meta: '#667781',
  tick: '#53BDEB',
  tickGrey: '#8696A0',
  ink: '#111B21',
};

/** Reply rhythm: the bot "types", you answer fast, you pause before a new thought. */
const BOT_TYPING = 40;
const GUEST_AFTER_BOT = 30;
const GUEST_AGAIN = 18;
const LAND = 14;

export const chatTiming = (t: Thread) => {
  const starts: number[] = [];
  let f = 56;
  t.turns.forEach((turn, i) => {
    const prev = t.turns[i - 1];
    if (!turn.me) f += BOT_TYPING;
    else f += i === 0 ? 0 : prev && !prev.me ? GUEST_AFTER_BOT : GUEST_AGAIN;
    starts.push(f);
    f += LAND;
  });
  return { starts, end: f + 95 };
};

/** Clock that advances a minute or two as the conversation runs. */
const clockAt = (start: string, i: number, n: number) => {
  const [h, m] = start.split(':').map(Number);
  const mins = (h! * 60 + m!) + Math.floor((i / Math.max(n - 1, 1)) * 7);
  return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};

const Ticks = ({ read }: { read: boolean }) => (
  <svg viewBox="0 0 18 12" width={23} height={16} style={{ marginInlineStart: 5, flex: '0 0 auto' }}>
    {[0, 5].map((dx) => (
      <path key={dx} d={`M${1 + dx} 6.4 L${4.2 + dx} 9.4 L${10.4 + dx} 2.4`} fill="none"
        stroke={read ? WA.tick : WA.tickGrey} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    ))}
  </svg>
);

const Meta = ({ time, me, read }: { time: string; me: boolean; read: boolean }) => (
  <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 3, gap: 1 }}>
    <span style={{ fontFamily: MONO, fontSize: 22, color: WA.meta }}>{time}</span>
    {me && <Ticks read={read} />}
  </span>
);

const RULE = <span style={{ display: 'block', height: 1, background: 'rgba(17,27,33,0.13)', margin: '9px 0' }} />;

const Row = ({ l, v, bold }: { l: string; v: string; bold?: boolean }) => (
  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 24, fontWeight: bold ? 700 : 400, fontSize: 29 }}>
    <span style={{ flex: 1 }}>{l}</span>
    <span style={{ fontFamily: MONO, fontWeight: bold ? 700 : 500, flex: '0 0 auto' }}>{v}</span>
  </span>
);

const Body = ({ t }: { t: Turn }) => {
  if (t.kind === 'text') return <span dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{t.text}</span>;
  if (t.kind === 'ticket') {
    return (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 32 }}>{t.code}</span>
        <span>{t.eta}</span>
        {t.note && <span style={{ color: '#4A5B62' }}>{t.note}</span>}
      </span>
    );
  }
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {t.lines.map(([l, v], i) => <Row key={i} l={l} v={v} />)}
      {!!t.extras?.length && RULE}
      {(t.extras ?? []).map(([l, v], i) => <Row key={`x${i}`} l={l} v={v} />)}
      {RULE}
      <Row l={t.total[0]} v={t.total[1]} bold />
      {t.after && <span style={{ marginTop: 8 }}>{t.after}</span>}
    </span>
  );
};

const Bubble = ({ t, p, time, read, rtl }: { t: Turn; p: number; time: string; read: boolean; rtl: boolean }) => {
  const me = t.me;
  const wide = t.kind === 'bill';
  return (
    <div style={{
      alignSelf: me ? 'flex-end' : 'flex-start',
      maxWidth: wide ? '94%' : '82%',
      minWidth: wide ? '82%' : undefined,
      background: me ? WA.out : WA.in,
      borderRadius: 16,
      [me ? (rtl ? 'borderTopLeftRadius' : 'borderTopRightRadius') : (rtl ? 'borderTopRightRadius' : 'borderTopLeftRadius')]: 4,
      padding: '16px 20px 10px',
      boxShadow: '0 1px 1px rgba(11,20,26,0.13)',
      opacity: p,
      transform: `translateY(${interpolate(p, [0, 1], [22, 0])}px)`,
      color: WA.ink, fontFamily: UI, fontSize: 31, lineHeight: 1.5,
    }}>
      <Body t={t} />
      <Meta time={time} me={me} read={read} />
    </div>
  );
};

const Icon = ({ d, size = 40, color = '#fff', fill = false }: { d: string; size?: number; color?: string; fill?: boolean }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} style={{ flex: '0 0 auto' }}>
    <path d={d} fill={fill ? color : 'none'} stroke={fill ? 'none' : color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Chat: React.FC<{ thread?: string }> = ({ thread = 'T1' }) => {
  const ready = useFontsReady();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const data = THREADS[thread] ?? THREADS['T1']!;
  const { starts } = chatTiming(data);
  const rtl = data.lang === 'ar';
  if (!ready) return <AbsoluteFill style={{ background: WA.bg }} />;

  // the bot is "typing" in the gap before each of its messages
  const typing = data.turns.some((t, i) => !t.me && frame >= starts[i]! - BOT_TYPING && frame < starts[i]!);
  const shown = data.turns.filter((_, i) => frame >= starts[i]!).length;

  return (
    <AbsoluteFill style={{ background: WA.bg, fontFamily: UI, display: 'flex', flexDirection: 'column' }}>
      {/* android status bar */}
      <div style={{ background: WA.bar, padding: '16px 34px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff', direction: rtl ? 'rtl' : 'ltr' }}>
        <span style={{ fontFamily: MONO, fontSize: 27, fontWeight: 500 }}>{clockAt(data.clock, Math.max(shown - 1, 0), data.turns.length)}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          {[11, 16, 21, 26].map((h, i) => (
            <span key={i} style={{ width: 6, height: h, borderRadius: 1, background: i === 3 ? 'rgba(255,255,255,0.45)' : '#fff', display: 'block' }} />
          ))}
          <span style={{ width: 44, height: 23, border: '2.5px solid #fff', borderRadius: 5, position: 'relative', display: 'block', marginInlineStart: 6 }}>
            <span style={{ position: 'absolute', inset: 3, right: 13, background: '#fff', borderRadius: 2, display: 'block' }} />
          </span>
        </span>
      </div>

      {/* app bar */}
      <div style={{ background: WA.header, padding: '18px 28px', display: 'flex', alignItems: 'center', gap: 20, color: '#fff', direction: rtl ? 'rtl' : 'ltr' }}>
        <Icon d={rtl ? 'M5 12h14M13 18l6-6-6-6' : 'M19 12H5M11 18l-6-6 6-6'} size={38} />
        <Img src={staticFile('01-mark-fine-brass-on-ink-nobg.svg')}
          style={{ width: 76, height: 76, borderRadius: 999, background: '#141110', padding: 10, flex: '0 0 auto' }} />
        <div style={{ flex: 1, lineHeight: 1.22, minWidth: 0 }}>
          <div style={{ fontSize: 34, fontWeight: 600 }}>مُنادم</div>
          <div style={{ fontSize: 25, color: 'rgba(255,255,255,0.85)' }}>{typing ? 'بيكتب…' : 'متصل'}</div>
        </div>
        <Icon d="M23 7l-7 5 7 5V7zM14 5H3a2 2 0 00-2 2v10a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2z" size={38} />
        <Icon d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012 4.2 2 2 0 014 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.1a2 2 0 012.1-.5c.9.3 1.8.6 2.8.7A2 2 0 0122 16.9z" size={38} />
      </div>

      {/* thread — clips at the top as it fills, which is what scrolled-to-bottom looks like */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: '20px 26px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 13, direction: rtl ? 'rtl' : 'ltr' }}>
        <div style={{ alignSelf: 'center', background: 'rgba(255,255,255,0.75)', color: WA.meta, fontSize: 23, padding: '7px 18px', borderRadius: 9, marginBottom: 6 }}>
          {rtl ? 'اليوم' : 'TODAY'}
        </div>
        {data.turns.map((t, i) => {
          const p = spring({ frame: frame - starts[i]!, fps, config: { damping: 200 }, durationInFrames: LAND });
          if (p <= 0) return null;
          return (
            <Bubble key={i} t={t} p={p} rtl={rtl}
              time={clockAt(data.clock, i, data.turns.length)}
              read={i < shown - 1} />
          );
        })}
      </div>

      {/* a tone as each message lands — a reel with no audio track at all gets buried */}
      {data.turns.map((t, i) => (
        <Sequence key={`sfx${i}`} from={starts[i]!} durationInFrames={10}>
          <Audio src={staticFile(t.me ? 'sfx/pop-out.wav' : 'sfx/pop-in.wav')} />
        </Sequence>
      ))}

      {/* input bar */}
      <div style={{ padding: '14px 24px 26px', display: 'flex', alignItems: 'center', gap: 16, direction: rtl ? 'rtl' : 'ltr' }}>
        <div style={{ flex: 1, background: '#fff', borderRadius: 999, padding: '18px 26px', display: 'flex', alignItems: 'center', gap: 18, boxShadow: '0 1px 1px rgba(11,20,26,0.1)' }}>
          <Icon d="M12 8v8M8 12h8M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={34} color="#8696A0" />
          <span style={{ flex: 1, fontSize: 28, color: '#8696A0' }}>{rtl ? 'اكتب رسالة' : 'Message'}</span>
          <Icon d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z" size={34} color="#8696A0" />
        </div>
        <div style={{ width: 76, height: 76, borderRadius: 999, background: '#00A884', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
          <Icon d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v3" size={36} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
