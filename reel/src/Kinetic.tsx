/**
 * Kinetic reel — statement / founder-POV reels on an ink ground.
 *
 * The counterpart to Post: where Post is a cream page with a phone, this is the
 * dark beat between chats in the feed. Amiri lines reveal word by word (brass for
 * *starred* words), a hairline at the top tracks progress so people stay to the
 * end, and it closes on the same payoff end card as the chat reels.
 */
import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, DEMO_LABEL } from './lib/brand';
import { KINETIC, kineticTiming, type Beat } from './lib/kinetic';
import { PostEnd, useFontsReady } from './Post';

const AR = 'Amiri, NotoEmoji';
const UI = 'Plex, NotoEmoji';
const MONO = 'PlexMono';
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/* one line of words, each rising in on a stagger; *word* is brass */
const Words: React.FC<{ text: string; f: number; size: number; stagger?: number }> = ({ text, f, size, stagger = 3 }) => {
  let n = 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: size * 0.18 }}>
      {text.split('\n').map((line, li) => (
        <div key={li} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: size * 0.26, direction: 'rtl' }}>
          {line.split(' ').filter(Boolean).map((w, wi) => {
            const k = n++;
            const hi = /^\*.*\*[.،؟…]*$/.test(w);
            const word = w.replace(/\*/g, '');
            const a = interpolate(f, [k * stagger, k * stagger + 10], [0, 1], clamp);
            return (
              <span key={wi} style={{
                fontFamily: AR, fontWeight: 700, fontSize: size, lineHeight: 1.3,
                color: hi ? C.brassLight : C.semna, opacity: a,
                transform: `translateY(${(1 - a) * 34}px)`, filter: `blur(${(1 - a) * 6}px)`, display: 'inline-block',
              }}>{word}</span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const ListBeat: React.FC<{ b: Extract<Beat, { k: 'list' }>; f: number }> = ({ b, f }) => {
  const per = Math.floor(b.d / (b.items.length + 0.6));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 52, width: 960 }}>
      {b.items.map((it, i) => {
        const t0 = i * per;
        const a = interpolate(f, [t0, t0 + 10], [0, 1], clamp);
        const strike = interpolate(f, [t0 + 16, t0 + 28], [0, 1], clamp);
        const stamp = spring({ frame: f - (t0 + 24), fps: 30, config: { damping: 11, stiffness: 160 } });
        return (
          <div key={i} style={{ position: 'relative', opacity: a, transform: `translateY(${(1 - a) * 30}px)`,
            background: '#1d1813', border: '1.5px solid #3a332a', borderRadius: 26, padding: '44px 40px 38px', direction: 'rtl' }}>
            <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 54, lineHeight: 1.45, color: `rgba(245,239,231,${1 - strike * 0.45})` }}>{it}</div>
            <div style={{ position: 'absolute', right: 36, left: 36, top: '52%', height: 5, background: C.karkadeh, borderRadius: 3,
              transform: `scaleX(${strike})`, transformOrigin: 'right' }} />
            <div style={{ position: 'absolute', left: 26, top: -22, background: C.karkadeh, color: C.semna, fontFamily: AR, fontWeight: 700,
              fontSize: 40, padding: '6px 26px 12px', borderRadius: 999, transform: `scale(${Math.max(0, stamp)}) rotate(-4deg)`,
              boxShadow: '0 8px 22px rgba(140,29,47,0.45)' }}>{b.stamp}</div>
          </div>
        );
      })}
    </div>
  );
};

const MathBeat: React.FC<{ b: Extract<Beat, { k: 'math' }>; f: number }> = ({ b, f }) => {
  const cut = (b.base * b.pct) / 100;
  const W = 940;
  const barIn = interpolate(f, [0, 14], [0, 1], clamp);
  const slice = interpolate(f, [26, 50], [0, 1], clamp);           // the commission slides off
  const left = Math.round(interpolate(f, [30, 58], [b.base, b.base - cut], clamp));
  const ar = (n: number) => n.toLocaleString('ar-EG');
  return (
    <div style={{ width: W, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40, direction: 'rtl' }}>
      <div style={{ fontFamily: AR, color: C.semna, fontSize: 190, fontWeight: 700, lineHeight: 1, direction: 'rtl', opacity: barIn }}>
        {ar(left)} <span style={{ fontFamily: UI, fontSize: 56, color: 'rgba(245,239,231,0.6)' }}>جنيه للمطعم</span>
      </div>
      <div style={{ position: 'relative', width: W, height: 150, opacity: barIn }}>
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: W * (1 - b.pct / 100), background: C.semna, borderRadius: '0 18px 18px 0' }} />
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: W * (b.pct / 100) - 6, background: C.karkadeh,
          borderRadius: '18px 0 0 18px', transform: `translate(${slice * 30}px, ${slice * 130}px) rotate(${-slice * 7}deg)`, opacity: 1 - slice * 0.15,
          display: 'grid', placeItems: 'center', color: C.semna, fontFamily: AR, fontWeight: 700, fontSize: 64 }}>−{ar(cut)}</div>
      </div>
      <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 72, color: C.brassLight, marginTop: 150, opacity: interpolate(f, [44, 58], [0, 1], clamp) }}>
        لو عمولة التطبيق {ar(b.pct)}٪
      </div>
      <div style={{ fontFamily: UI, fontSize: 34, color: 'rgba(245,239,231,0.5)', opacity: interpolate(f, [56, 70], [0, 1], clamp) }}>
        مثال توضيحي — النسبة بتختلف حسب الاتفاق
      </div>
    </div>
  );
};

/* munadim.com's calculator as motion: two bars grow, the difference counts up */
const CompareBeat: React.FC<{ b: Extract<Beat, { k: 'compare' }>; f: number }> = ({ b, f }) => {
  const W = 900;
  const g1 = interpolate(f, [6, 34], [0, 1], clamp);
  const g2 = interpolate(f, [40, 64], [0, 1], clamp);
  const diff = Math.round(interpolate(f, [72, 104], [0, b.app - b.munadim], clamp));
  const n = (x: number) => x.toLocaleString('en-US');
  const row = (label: string, val: number, w: number, col: string, g: number) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: Math.min(1, g * 3) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', direction: 'rtl' }}>
        <span style={{ fontFamily: AR, fontWeight: 700, fontSize: 52, color: C.semna }}>{label}</span>
        <span style={{ fontFamily: MONO, fontSize: 56, color: col === C.karkadeh ? C.semna : col, direction: 'ltr' }}>{n(Math.round(val * g))} <span style={{ fontFamily: UI, fontSize: 30, color: 'rgba(245,239,231,0.55)' }}>جنيه</span></span>
      </div>
      <div style={{ height: 34, borderRadius: 17, background: 'rgba(245,239,231,0.08)', direction: 'rtl', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${w * g * 100}%`, background: col, borderRadius: 17 }} />
      </div>
    </div>
  );
  return (
    <div style={{ width: W, display: 'flex', flexDirection: 'column', gap: 54 }}>
      <div style={{ fontFamily: UI, fontSize: 34, color: 'rgba(245,239,231,0.6)', direction: 'rtl', textAlign: 'center' }}>600 أوردر · متوسط الأوردر 150 جنيه · في الشهر</div>
      {row('التطبيق', b.app, 1, C.karkadeh, g1)}
      {row(`مُنادِم · ${b.plan}`, b.munadim, b.munadim / b.app, C.brassLight, g2)}
      <div style={{ textAlign: 'center', direction: 'rtl', opacity: interpolate(f, [70, 82], [0, 1], clamp) }}>
        <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 56, color: C.semna }}>الفرق في جيبك</div>
        <div style={{ fontFamily: MONO, fontSize: 120, color: C.brassLight, direction: 'ltr', lineHeight: 1.1 }}>{n(diff)}</div>
      </div>
      <div style={{ fontFamily: UI, fontSize: 26, lineHeight: 1.6, color: 'rgba(245,239,231,0.45)', direction: 'rtl', textAlign: 'center', opacity: interpolate(f, [90, 104], [0, 1], clamp) }}>
        على افتراض إن التطبيق بياخد حوالي خُمس قيمة الأوردر — زي حاسبة munadim.com. عمولتك الفعلية في فاتورتك الشهرية.
      </div>
    </div>
  );
};

const ChatBeat: React.FC<{ b: Extract<Beat, { k: 'chat' }>; f: number }> = ({ b, f }) => {
  const card = spring({ frame: f, fps: 30, config: { damping: 200 }, durationInFrames: 18 });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34, opacity: card, transform: `translateY(${(1 - card) * 40}px)` }}>
      <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 84, color: C.brassLight, direction: 'rtl' }}>{b.stamp}</div>
      <div style={{ width: 960, background: C.waBg, borderRadius: 38, overflow: 'hidden', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.7)', position: 'relative' }}>
        <div style={{ background: '#F6F7F8', padding: '18px 26px', display: 'flex', alignItems: 'center', gap: 14, direction: 'rtl' }}>
          <Img src={staticFile('avatar-whatsapp.svg')} style={{ width: 56, height: 56, borderRadius: 999 }} />
          <div style={{ fontFamily: UI, fontSize: 30, fontWeight: 600, color: '#111B21' }}>مُنادم</div>
          <div style={{ marginInlineStart: 'auto', fontFamily: UI, fontSize: 22, color: '#667781' }}>{DEMO_LABEL}</div>
        </div>
        <div style={{ padding: '28px 24px 32px', display: 'flex', flexDirection: 'column', gap: 18, direction: 'rtl' }}>
          {b.msgs.map(([me, text], i) => {
            const p = spring({ frame: f - (8 + i * 18), fps: 30, config: { damping: me ? 200 : 13, stiffness: 140 }, durationInFrames: 18 });
            if (p <= 0) return null;
            return (
              <div key={i} style={{ alignSelf: me ? 'flex-end' : 'flex-start', maxWidth: '86%', background: me ? C.waOut : C.waIn,
                borderRadius: 22, padding: '22px 26px', fontFamily: UI, fontSize: 42, lineHeight: 1.5, color: '#111B21',
                boxShadow: '0 1px 2px rgba(0,0,0,0.12)', opacity: Math.min(p, 1), transform: `translateY(${(1 - Math.min(p, 1)) * 24}px)` }}>
                <span dir="auto">{text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* the cold open: footage full-bleed, a dark floor rising from the bottom, the hook over it */
export const ColdBeat: React.FC<{ b: Extract<Beat, { k: 'cold' }>; f: number; startFrom?: number; sound?: boolean }> = ({ b, f, startFrom = 0, sound = false }) => {
  const floor = interpolate(f, [0, 18], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <OffthreadVideo src={staticFile(b.src)} muted={!sound} startFrom={startFrom} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <AbsoluteFill style={{ background: `linear-gradient(to top, rgba(20,17,16,${0.94 * floor}) 0%, rgba(20,17,16,${0.68 * floor}) 42%, rgba(20,17,16,0.05) 100%)` }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', padding: '0 80px 420px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 44 }}>
          {/* a long hook over busy footage wraps to four lines at 150; drop it so it stays two or three */}
          <Words text={b.text} f={f - 6} size={b.text.replace(/\*/g, '').length > 24 ? 128 : 150} />
          <div style={{ width: 200, height: 6, background: C.karkadeh, borderRadius: 3, transform: `scaleX(${interpolate(f, [18, 36], [0, 1], clamp)})` }} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const KineticReel: React.FC<{ reel?: string }> = ({ reel = 'R3' }) => {
  const data = KINETIC[reel] ?? KINETIC['R3']!;
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { starts, endStart } = kineticTiming(data);
  const fontsReady = useFontsReady();
  if (!fontsReady) return <AbsoluteFill style={{ background: C.ink }} />;

  const progress = interpolate(frame, [0, endStart], [0, 1], clamp);
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.06]);

  return (
    <AbsoluteFill style={{ background: C.ink }}>
      {/* warm glow + brass dot ground, slowly breathing */}
      <AbsoluteFill style={{ background: 'radial-gradient(90% 55% at 50% 30%, rgba(185,132,50,0.16), rgba(20,17,16,0) 70%)', transform: `scale(${drift})` }} />
      <AbsoluteFill style={{ opacity: 0.35, backgroundImage: 'radial-gradient(rgba(217,169,78,0.10) 1.6px, transparent 1.6px)', backgroundSize: '30px 30px' }} />
      <AbsoluteFill style={{ boxShadow: 'inset 0 0 260px 60px rgba(0,0,0,0.55)' }} />

      {/* measured 25 Oct: at 0.22 the kinetic reels sat at -40 dBFS RMS, ~20 dB under the film —
          a bed nobody hears. 1.0 brings the floor up without the pops clipping (their peaks set the ceiling). */}
      <Audio src={staticFile('sfx/bed.wav')} volume={2.6} />

      {/* progress hairline */}
      <div style={{ position: 'absolute', top: 70, right: 78, left: 78, height: 4, background: 'rgba(245,239,231,0.10)', borderRadius: 2 }}>
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: C.brassLight, borderRadius: 2 }} />
      </div>

      {data.beats.map((b, i) => {
        const s = starts[i]!;
        if (frame < s || frame >= s + b.d) return null;
        const f = frame - s;
        const out = interpolate(f, [b.d - 9, b.d], [1, 0], clamp);
        const lift = (1 - out) * -26;
        if (b.k === 'cold') return <AbsoluteFill key={i} style={{ opacity: out }}><ColdBeat b={b} f={f} /></AbsoluteFill>;
        return (
          <AbsoluteFill key={i} style={{ alignItems: 'center', justifyContent: 'center', padding: '0 80px', opacity: out, transform: `translateY(${lift}px)` }}>
            {b.k === 'line' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 44 }}>
                <Words text={b.text} f={f} size={b.big ? 150 : 128} />
                {b.big && (
                  <div style={{ width: 200, height: 6, background: C.karkadeh, borderRadius: 3,
                    transform: `scaleX(${interpolate(f, [12, 30], [0, 1], clamp)})` }} />
                )}
              </div>
            )}
            {b.k === 'list' && <ListBeat b={b} f={f} />}
            {b.k === 'math' && <MathBeat b={b} f={f} />}
            {b.k === 'compare' && <CompareBeat b={b} f={f} />}
            {b.k === 'chat' && <ChatBeat b={b} f={f} />}
          </AbsoluteFill>
        );
      })}

      {/* a soft tick as each beat lands */}
      {data.beats.map((_, i) => (
        <Sequence key={`sfx${i}`} from={starts[i]!} durationInFrames={10}>
          <Audio src={staticFile('sfx/pop-in.wav')} volume={0.7} />
        </Sequence>
      ))}

      <Img src={staticFile('20-lockup-horizontal-dark-nobg.svg')}
        style={{ position: 'absolute', left: '50%', bottom: 80, width: 260, marginLeft: -130, opacity: 0.85 }} />

      <PostEnd frame={frame} endStart={endStart} payoff={data.payoff} />
    </AbsoluteFill>
  );
};
