/**
 * Feature reel — Layout A as motion, built for brand polish.
 *
 * Semna page, an Amiri headline that reveals with its karkadeh rule drawing in,
 * a floating phone running a convincing WhatsApp (status bar, real header,
 * doodle ground, message pops), then an ink end card with the WhatsApp CTA.
 * Everything is real text in Amiri / IBM Plex Arabic so the Arabic is always
 * correct — the reason these are built in code, not generated.
 */
import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, Img, Sequence, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from './lib/brand';
import { POSTS, type Bubble, type Post as PostData } from './lib/posts';
import { EMOJI_FACES } from './lib/emojiFaces';

const FACES: [string, string, string][] = [
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-regular.woff2', '400'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-500.woff2', '500'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-600.woff2', '600'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-700.woff2', '700'],
  ['PlexMono', 'fonts/ibm-plex-mono-v20-latin-500.woff2', '500'],
  ['Amiri', 'fonts/amiri-v30-arabic-700.woff2', '700'],
  ['Cinzel', 'fonts/cinzel-v26-latin-600.woff2', '600'],
];
export function useFontsReady() {
  const [h] = useState(() => delayRender('post-fonts'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([
      ...FACES.map(([fam, file, w]) => new FontFace(fam, `url(${staticFile(file)})`, { weight: w }).load()),
      ...EMOJI_FACES.map(([file, range]) => new FontFace('NotoEmoji', `url(${staticFile(file)})`, { unicodeRange: range }).load()),
    ])
      .then((fs) => { fs.forEach((x) => document.fonts.add(x)); setReady(true); continueRender(h); });
  }, [h]);
  return ready;
}

const AR = 'Amiri, NotoEmoji';
const UI = 'Plex, NotoEmoji';
const MONO = 'PlexMono';

const BUBBLE_IN = 18;
const GUEST_GAP = 16;
const TYPING = 24;
const END_CARD = 60;

export const postTiming = (p: PostData) => {
  const starts: number[] = [];
  let t = 36; // the headline reveal + rule draw read first
  for (const b of p.script) {
    if (b.kind === 'day') { starts.push(t); t += 28; continue; } // a date chip: no typing, short beat
    if (!b.me) t += p.real ? 12 : TYPING;
    starts.push(t);
    if (p.real) {
      // real bot messages run long (a bill is ~15 lines): hold a beat longer on the long ones
      const lines = b.kind === 'text' ? b.text.split('\n').length : 2;
      t += b.me ? 16 : 20 + Math.min(14, Math.round(lines * 1.3));
    } else t += BUBBLE_IN + GUEST_GAP;
  }
  const endStart = t + 22;
  // a payoff line needs its own beat to be read before the CTA lands
  return { starts, endStart, end: endStart + END_CARD + (p.payoff ? 42 : 12) };
};

/* ---------- small ui atoms ---------- */
const Tick = ({ blue }: { blue?: boolean }) => (
  <svg viewBox="0 0 18 12" width={24} height={16} style={{ marginInlineStart: 6 }}>
    {[0, 6].map((dx) => (
      <path key={dx} d={`M${1 + dx} 6.5 L${4 + dx} 9.5 L${10 + dx} 2.5`} fill="none"
        stroke={blue ? '#53BDEB' : '#8696A0'} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    ))}
  </svg>
);

const Wave = () => (
  <span style={{ display: 'flex', alignItems: 'center', gap: 3, height: 28 }}>
    {[7, 12, 19, 11, 16, 23, 13, 8, 16, 21, 12, 7, 11, 17, 24, 14, 9, 13].map((h, i) => (
      <span key={i} style={{ width: 4, height: h, borderRadius: 3, background: '#8696A0', display: 'block' }} />
    ))}
  </span>
);

const Ic = ({ d, s = '#54656F', w = 2.1, size = 34, fill = 'none' }: { d: string; s?: string; w?: number; size?: number; fill?: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke={s} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/* iphone-style status bar */
const StatusBar = ({ clock = '9:41' }: { clock?: string }) => (
  <div style={{ background: '#F6F7F8', padding: '14px 30px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#111B21', fontFamily: UI }}>
    <span style={{ fontWeight: 700, fontSize: 28, letterSpacing: 0.5 }}>{clock}</span>
    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {/* signal */}
      <svg width={34} height={24} viewBox="0 0 34 24">{[0,1,2,3].map((i)=>(<rect key={i} x={i*8} y={16-i*5} width={5.5} height={6+i*5} rx={1.5} fill="#111B21" />))}</svg>
      {/* wifi */}
      <svg width={30} height={24} viewBox="0 0 24 20" fill="none" stroke="#111B21" strokeWidth={2.2} strokeLinecap="round"><path d="M2 7a15 15 0 0 1 20 0M6 11a9 9 0 0 1 12 0M10 15a3.5 3.5 0 0 1 4 0" /><circle cx="12" cy="17.5" r="0.6" fill="#111B21" /></svg>
      {/* battery */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <span style={{ width: 44, height: 22, border: '2.5px solid #111B21', borderRadius: 6, padding: 2.5 }}>
          <span style={{ display: 'block', width: '82%', height: '100%', background: '#111B21', borderRadius: 2 }} />
        </span>
        <span style={{ width: 4, height: 9, background: '#111B21', borderRadius: 2 }} />
      </span>
    </span>
  </div>
);

/* WhatsApp formatting, exactly as the bot writes it: *bold*, _italic_, ―― rules, blank lines */
// emoji that default to text style (🍽 ⏱) need U+FE0F to draw in colour, as phones do
const emo = (s: string) => s.replace(/([🍽⏱☎⚠✔])(?!\uFE0F)/gu, '$1\uFE0F');
const inline = (s: string) => emo(s).split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((x, i) =>
  /^\*.+\*$/.test(x) ? <b key={i} style={{ fontWeight: 700 }}>{x.slice(1, -1)}</b>
    : /^_.+_$/.test(x) ? <i key={i}>{x.slice(1, -1)}</i> : x);
const RichText = ({ text }: { text: string }) => (
  <span style={{ display: 'flex', flexDirection: 'column' }}>
    {text.split('\n').map((ln, i) => /^―{3,}/.test(ln.trim())
      ? <span key={i} style={{ borderTop: '1.5px solid rgba(17,27,33,0.16)', margin: '9px 0' }} />
      : ln.trim() === '' ? <span key={i} style={{ height: '0.55em' }} />
        : <span key={i} dir="auto" style={{ textAlign: 'start' }}>{inline(ln)}</span>)}
  </span>
);
/* a WhatsApp interactive row under the message: reply button or list opener */
const BtnRow = ({ label, list }: { label: string; list?: boolean }) => (
  <span style={{ borderTop: '1px solid rgba(17,27,33,0.10)', padding: '15px 12px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 10, color: '#027EB5', fontWeight: 500, fontSize: 29 }}>
    {list
      ? <Ic d="M4 6h16M4 12h16M4 18h16" s="#027EB5" w={2.2} size={28} />
      : <Ic d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2" s="#027EB5" w={2.2} size={28} />}
    <span dir="auto">{emo(label)}</span>
  </span>
);

const Bubble = ({ b, p, pop, small, rtl = true }: { b: Bubble; p: number; pop: number; small?: boolean; rtl?: boolean }) => {
  const me = b.me;
  const a = Math.min(p, 1);
  const y = (1 - a) * 28;
  const sc = 0.94 + 0.06 * Math.min(p, 1.08);
  return (
    <div style={{
      alignSelf: me ? 'flex-end' : 'flex-start',
      maxWidth: small ? '88%' : '85%',
      background: me ? C.waOut : C.waIn,
      borderRadius: 20,
      [me === rtl ? 'borderTopLeftRadius' : 'borderTopRightRadius']: 5,
      padding: small ? '16px 20px 11px' : '20px 24px 13px',
      boxShadow: pop > 0 ? `0 2px 10px rgba(185,132,50,${0.35 * pop}), 0 1px 2px rgba(0,0,0,0.12)` : '0 1px 2px rgba(0,0,0,0.12)',
      opacity: a,
      transform: `translateY(${y}px) scale(${sc})`,
      transformOrigin: me === rtl ? 'bottom left' : 'bottom right',
      color: '#111B21',
      fontFamily: UI,
      fontSize: small ? 30 : 38,
      lineHeight: small ? 1.42 : 1.5,
      whiteSpace: 'pre-wrap',
    }}>
      {b.kind === 'voice' && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ width: 46, height: 46, borderRadius: 999, background: '#25D366', display: 'grid', placeItems: 'center' }}>
            <Ic d="M8 5v14l11-7z" s="#fff" w={0} size={26} fill="#fff" />
          </span>
          <Wave /><b style={{ fontFamily: MONO, fontWeight: 500, fontSize: 26 }}>{b.dur}</b>
        </span>
      )}
      {b.kind === 'location' && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ width: 440, height: 240, borderRadius: 14, background: '#D9D2C7', position: 'relative', overflow: 'hidden' }}>
            <span style={{ position: 'absolute', inset: 0, background:
              'repeating-linear-gradient(90deg,#CFC7BA 0 2px,transparent 2px 46px),repeating-linear-gradient(0deg,#CFC7BA 0 2px,transparent 2px 46px)' }} />
            <span style={{ position: 'absolute', left: '50%', top: '44%', width: 30, height: 30, marginLeft: -15,
              borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)', background: C.karkadeh, boxShadow: '0 6px 14px rgba(140,29,47,0.4)' }} />
          </span>
          <span style={{ fontSize: 27, color: '#5A6B72' }}>الموقع المرسَل</span>
        </span>
      )}
      {b.kind === 'text' && (small ? <RichText text={b.text} /> : <span dir="auto">{b.text}</span>)}
      {b.kind === 'doc' && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#F5F6F6', borderRadius: 12, padding: '14px 18px', minWidth: 420 }}>
          <span style={{ width: 50, height: 60, borderRadius: 8, background: '#E5483B', color: '#fff', fontSize: 16, fontWeight: 700, display: 'grid', placeItems: 'center' }}>PDF</span>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
            <span dir="ltr" style={{ fontSize: 28, fontWeight: 500 }}>{b.name}</span>
            <span style={{ fontSize: 22, color: '#667781' }}>PDF</span>
          </span>
        </span>
      )}
      {b.kind === 'doc' && b.caption && <span style={{ display: 'block', marginTop: 10 }}><RichText text={b.caption} /></span>}
      {b.kind === 'bill' && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {b.lines.map(([label, val], i) => (
            <span key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 30, fontSize: 30 }}>
              <span>{label}</span>{val && <b style={{ fontFamily: MONO, fontWeight: 500 }}>{val}</b>}
            </span>
          ))}
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 30, borderTop: '1.5px solid rgba(17,27,33,0.16)', marginTop: 7, paddingTop: 9, fontWeight: 700 }}>
            <span>{b.total[0]}</span><b style={{ fontFamily: MONO }}>{b.total[1]}</b>
          </span>
          {b.after && <span style={{ marginTop: 7 }}>{b.after}</span>}
        </span>
      )}
      {b.kind === 'status' && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <span style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
            <b style={{ fontFamily: MONO }}>{b.code}</b><span style={{ color: '#5A6B72', fontSize: 27 }}>· {b.ago}</span>
          </span>
          {b.steps.map(([label, done], i) => (
            <span key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', opacity: done ? 1 : 0.5 }}>
              <span style={{ color: done ? '#1FA855' : '#8696A0', fontWeight: 700 }}>{done ? '✓' : '○'}</span><span>{label}</span>
            </span>
          ))}
        </span>
      )}
      <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 5 }}>
        <span style={{ fontFamily: MONO, fontSize: small ? 20 : 22, color: '#667781' }}>{b.time}</span>
        {me && <Tick blue />}
      </span>
      {b.kind === 'text' && !b.me && (b.list || b.buttons?.length) ? (
        <span style={{ display: 'flex', flexDirection: 'column', margin: small ? '10px -20px -11px' : '12px -24px -13px' }}>
          {b.list ? <BtnRow label={b.list} list /> : b.buttons!.map((l, i) => <BtnRow key={i} label={l} />)}
        </span>
      ) : null}
    </div>
  );
};

/* WhatsApp's centred date chip — time passing inside one thread */
const DayChip = ({ label, p }: { label: string; p: number }) => (
  <div style={{ alignSelf: 'center', background: '#FFFFFF', color: '#54656F', fontFamily: UI, fontSize: 26, fontWeight: 500,
    padding: '9px 24px', borderRadius: 14, boxShadow: '0 1px 2px rgba(0,0,0,0.10)', margin: '10px 0',
    opacity: Math.min(p, 1), transform: `scale(${0.9 + 0.1 * Math.min(p, 1)})` }}>
    {label}
  </div>
);

const Typing = ({ rtl = true }: { rtl?: boolean }) => (
  <div style={{ alignSelf: 'flex-start', background: C.waIn, borderRadius: 20, [rtl ? 'borderTopRightRadius' : 'borderTopLeftRadius']: 5,
    padding: '22px 26px', display: 'flex', gap: 9, boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }}>
    {[0, 1, 2].map((i) => <span key={i} style={{ width: 12, height: 12, borderRadius: 999, background: '#8696A0', display: 'block' }} />)}
  </div>
);

export const PostEnd: React.FC<{ frame: number; endStart: number; payoff?: string }> = ({ frame, endStart, payoff }) => {
  const a = interpolate(frame, [endStart, endStart + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (a <= 0) return null;
  const s = (k: number) => interpolate(frame, [endStart + k, endStart + k + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (payoff) {
    // the answer to the hook lands first and big; the brand + CTA follow once it has been read
    return (
      <AbsoluteFill style={{ background: `rgba(20,17,16,${0.98 * a})`, alignItems: 'center', justifyContent: 'center', direction: 'rtl', fontFamily: AR, padding: '0 90px' }}>
        <div style={{ color: C.semna, fontFamily: AR, fontSize: 84, fontWeight: 700, lineHeight: 1.4, textAlign: 'center', maxWidth: 900, whiteSpace: 'pre-line',
          opacity: s(2), transform: `translateY(${(1 - s(2)) * 26}px)` }}>{payoff}</div>
        <div style={{ width: 120 * s(16), height: 5, background: C.brassLight, borderRadius: 3, margin: '52px 0 48px', opacity: s(16) }} />
        <Img src={staticFile('23-lockup-stacked-dark-nobg.svg')} style={{ width: 340, opacity: s(30), transform: `translateY(${(1 - s(30)) * 20}px)` }} />
        <div style={{ color: 'rgba(245,239,231,0.8)', fontFamily: AR, fontSize: 46, fontWeight: 700, marginTop: 34, opacity: s(38) }}>كل طلب يبقى زبون</div>
        <div style={{ color: 'rgba(245,239,231,0.7)', fontFamily: UI, fontSize: 30, lineHeight: 1.6, marginTop: 22, textAlign: 'center', maxWidth: 820, opacity: s(42) }}>مُنادم: نظام أوردرات على واتساب باسم مطعمك — من غير تطبيق، ومن غير عمولة على الأوردر</div>
        <div style={{ color: 'rgba(245,239,231,0.62)', fontFamily: UI, fontSize: 30, marginTop: 18, opacity: s(46) }}>اطلب على واتساب</div>
        <div style={{ color: C.brassLight, fontSize: 48, fontWeight: 500, marginTop: 10, opacity: s(46), fontFamily: MONO, letterSpacing: 3, direction: 'ltr' }}>01022034603</div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: `rgba(20,17,16,${0.98 * a})`, alignItems: 'center', justifyContent: 'center', direction: 'rtl', fontFamily: AR }}>
      <Img src={staticFile('23-lockup-stacked-dark-nobg.svg')} style={{ width: 500, opacity: s(2), transform: `translateY(${(1 - s(2)) * 28}px)` }} />
      <div style={{ width: 120 * s(8), height: 5, background: C.brassLight, borderRadius: 3, margin: '44px 0 36px', opacity: s(8) }} />
      <div style={{ color: C.semna, fontFamily: AR, fontSize: 66, fontWeight: 700, opacity: s(12), transform: `translateY(${(1 - s(12)) * 20}px)` }}>كل طلب يبقى زبون</div>
      <div style={{ color: 'rgba(245,239,231,0.7)', fontFamily: UI, fontSize: 30, lineHeight: 1.6, marginTop: 24, textAlign: 'center', maxWidth: 820, opacity: s(16) }}>مُنادم: نظام أوردرات على واتساب باسم مطعمك — من غير تطبيق، ومن غير عمولة على الأوردر</div>
      <div style={{ color: 'rgba(245,239,231,0.62)', fontFamily: UI, fontSize: 32, marginTop: 18, opacity: s(18) }}>اطلب على واتساب</div>
      <div style={{ color: C.brassLight, fontSize: 50, fontWeight: 500, marginTop: 14, opacity: s(20), fontFamily: MONO, letterSpacing: 3, direction: 'ltr' }}>01022034603</div>
    </AbsoluteFill>
  );
};

export const Post: React.FC<{ post?: string }> = ({ post = '1A' }) => {
  const data = POSTS[post] ?? POSTS['1A']!;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { starts, endStart } = postTiming(data);
  const fontsReady = useFontsReady();
  if (!fontsReady) return <AbsoluteFill style={{ background: C.semna }} />;

  // headline reveal: slide in from the right (RTL), rule draws, english fades
  const headA = interpolate(frame, [0, 22], [0, 1], { extrapolateRight: 'clamp' });
  const headX = (1 - interpolate(frame, [0, 26], [0, 1], { extrapolateRight: 'clamp' })) * 60;
  const rule = interpolate(frame, [14, 34], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const engA = interpolate(frame, [26, 42], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const phone = spring({ frame: frame - 20, fps, config: { damping: 180 }, durationInFrames: 46 });
  const float = Math.sin((frame - 20) / 24) * 7;
  const logoA = interpolate(frame, [30, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const zoom = interpolate(frame, [0, endStart], [1.012, 1.055], { extrapolateRight: 'clamp' });
  // real recordings: the restaurant's own chat (name + avatar), and the diner's phone language
  const rtl = (data.ui ?? 'ar') === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const small = !!data.real;
  const lead = data.real ? 20 : TYPING;

  return (
    <AbsoluteFill style={{ background: C.semna, fontFamily: UI }}>
      {/* warm paper depth */}
      <AbsoluteFill style={{ background: 'radial-gradient(130% 80% at 50% 8%, rgba(255,253,248,0.9), rgba(245,239,231,0) 60%)' }} />
      <AbsoluteFill style={{ boxShadow: 'inset 0 -220px 240px -160px rgba(20,17,16,0.10)' }} />

      <AbsoluteFill style={{ transform: `scale(${zoom})`, padding: '96px 78px 0', display: 'flex', flexDirection: 'column' }}>
        {/* headline — Arabic leads, karkadeh rule draws, small English */}
        <div style={{ direction: 'rtl', textAlign: 'right' }}>
          <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 92, lineHeight: 1.32, color: C.ink, maxWidth: 960, opacity: headA, transform: `translateX(${headX}px)` }}>
            {data.headline}
          </div>
          <div style={{ width: 210, height: 7, background: C.karkadeh, borderRadius: 4, margin: '34px 0 22px', transform: `scaleX(${rule})`, transformOrigin: 'right' }} />
          <div style={{ fontFamily: UI, fontSize: 32, color: 'rgba(20,17,16,0.5)', direction: 'ltr', textAlign: 'right', opacity: engA }}>
            {data.english}
          </div>
        </div>

        {/* the phone, floating */}
        <div style={{
          marginTop: 40, alignSelf: 'center', width: 770, height: 1210,
          borderRadius: 60, border: '15px solid #1C1917', background: '#1C1917',
          boxShadow: '0 60px 120px -40px rgba(20,17,16,0.5)',
          opacity: phone, transform: `translateY(${(1 - phone) * 46 + float}px)`, overflow: 'hidden',
        }}>
          <div style={{ background: C.waBg, height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            {/* whatsapp doodle ground */}
            <div style={{ position: 'absolute', inset: 0, opacity: 0.5, backgroundImage: 'radial-gradient(rgba(17,27,33,0.045) 1.4px, transparent 1.4px)', backgroundSize: '26px 26px' }} />

            <StatusBar clock={data.clock} />
            {/* chat header */}
            <div style={{ background: '#F6F7F8', padding: '12px 24px 18px', display: 'flex', alignItems: 'center', gap: 14, direction: dir, borderBottom: '1px solid rgba(17,27,33,0.06)', position: 'relative' }}>
              <Ic d={rtl ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} s="#0B7A6A" w={2.6} size={34} />
              {data.real
                ? <Img src={staticFile('avatar-whatsapp.svg')} style={{ width: 66, height: 66, borderRadius: 999 }} />
                : <div style={{ width: 66, height: 66, borderRadius: 999, background: C.karkadeh, display: 'grid', placeItems: 'center', color: '#fff', fontFamily: AR, fontWeight: 700, fontSize: 36 }}>ش</div>}
              <div style={{ lineHeight: 1.22 }}>
                <div style={{ fontSize: 32, fontWeight: 600, color: '#111B21' }}>{data.real ? (rtl ? 'مُنادم' : 'Munadim') : 'شنام'}</div>
                <div style={{ fontSize: 24, color: '#1FA855' }}>{rtl ? 'متصل الآن' : 'online'}</div>
              </div>
              <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 24, alignItems: 'center' }}>
                <Ic d="M23 7l-7 5 7 5V7zM1 5h14v14H1z" s="#54656F" w={2} size={34} />
                <Ic d="M5 3h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z" s="#54656F" w={2} size={34} />
              </span>
            </div>

            {/* a tone as each message lands — a reel with no audio track gets buried */}
            {data.script.map((b, i) => b.kind === 'day' ? null : (
              <Sequence key={`sfx${i}`} from={starts[i]!} durationInFrames={10}>
                <Audio src={staticFile(b.me ? 'sfx/pop-out.wav' : 'sfx/pop-in.wav')} />
              </Sequence>
            ))}

            {/* thread — anchored to the bottom like a live chat */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: '26px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: small ? 14 : 18, direction: dir, position: 'relative' }}>
              {data.script.map((b, i) => {
                const p = spring({ frame: frame - starts[i]!, fps, config: { damping: b.me ? 200 : 13, stiffness: 140 }, durationInFrames: BUBBLE_IN });
                if (p <= 0) return null;
                if (b.kind === 'day') return <DayChip key={i} label={b.label} p={p} />;
                const pop = b.me ? 0 : interpolate(frame, [starts[i]!, starts[i]! + 8, starts[i]! + 26], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
                const el = <Bubble b={b} p={p} pop={pop} small={small} rtl={rtl} />;
                if (!small) return <React.Fragment key={i}>{el}</React.Fragment>;
                // a long message grows in and pushes the thread up smoothly, like a live chat scroll
                const g = interpolate(frame, [starts[i]!, starts[i]! + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateRows: `${g}fr`, flexShrink: 0 }}>
                    <div style={{ minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '0 2px 3px' }}>{el}</div>
                  </div>
                );
              })}
              {data.script.map((b, i) => {
                if (b.me || b.kind === 'day') return null;
                const show = frame >= starts[i]! - lead && frame < starts[i]!;
                return show ? <Typing key={`t${i}`} rtl={rtl} /> : null;
              })}
            </div>

            {/* input bar */}
            <div style={{ background: '#F6F7F8', padding: '16px 22px calc(16px + 10px)', display: 'flex', alignItems: 'center', gap: 16, direction: dir }}>
              <div style={{ flex: 1, background: '#fff', borderRadius: 999, padding: '18px 24px', fontSize: 27, color: '#8696A0', display: 'flex', alignItems: 'center', gap: 14 }}>
                <Ic d="M12 5v14M5 12h14" s="#8696A0" w={2.2} size={30} />
                <span>{rtl ? 'اكتب رسالة' : 'Message'}</span>
                <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 16 }}>
                  <Ic d="M23 7l-7 5 7 5V7zM1 5h14v14H1z" s="#8696A0" w={2} size={28} />
                </span>
              </div>
              <div style={{ width: 62, height: 62, borderRadius: 999, background: '#0B7A6A', display: 'grid', placeItems: 'center' }}>
                <Ic d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v4" s="#fff" w={2.1} size={30} />
              </div>
            </div>
          </div>
        </div>
      </AbsoluteFill>

      {/* logo, bottom-left on the cream page */}
      <Img src={staticFile('21-lockup-horizontal-light-nobg.svg')}
        style={{ position: 'absolute', left: 78, bottom: 60, width: 300, opacity: logoA }} />

      <PostEnd frame={frame} endStart={endStart} payoff={data.payoff} />
    </AbsoluteFill>
  );
};
