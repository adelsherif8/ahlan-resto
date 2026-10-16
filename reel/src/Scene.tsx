/**
 * The storyline cut — a short film, with WhatsApp as a beat inside it.
 *
 * Not a chat recording and not a brand page: a night in a restaurant, told in
 * Arabic cards over the café set, where the conversation appears as a card *in*
 * the room — the space stays visible behind it — and the film carries on past it
 * to the kitchen, the food and the mark.
 *
 * The beats come from lib/stories.ts, so a new film is a data entry, not a new
 * component. Each beat gets its own frames and the machine below lays them out.
 */
import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, Img, Sequence, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from './lib/brand';
import { STORIES, beatStarts, type Beat, type Line } from './lib/stories';

const FACES: [string, string, string][] = [
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-regular.woff2', '400'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-500.woff2', '500'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-600.woff2', '600'],
  ['PlexMono', 'fonts/ibm-plex-mono-v20-latin-500.woff2', '500'],
  ['Amiri', 'fonts/amiri-v30-arabic-700.woff2', '700'],
  ['Cinzel', 'fonts/cinzel-v26-latin-600.woff2', '600'],
];
function useFontsReady() {
  const [h] = useState(() => delayRender('scene-fonts'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all(FACES.map(([f, file, w]) => new FontFace(f, `url(${staticFile(file)})`, { weight: w }).load()))
      .then((fs) => { fs.forEach((x) => document.fonts.add(x)); setReady(true); continueRender(h); });
  }, [h]);
  return ready;
}

const AR = 'Amiri';
const UI = 'Plex';
const MONO = 'PlexMono';

/** The café set was rendered for the OLD demo restaurant: its QR table tent, mark and
 *  menu prices are baked into every frame, dead centre. So the plate is never shown
 *  sharp — it is driven far out of focus and graded down, which leaves a real room with
 *  real light and real bokeh and no legible branding at all. Shooting this set sharp
 *  needs a Blender re-render with Munadim's own tent. */
const PLATE_LO = 0;
const PLATE_HI = 78;
const plateSrc = (f: number) => {
  const span = PLATE_HI - PLATE_LO;
  const t = Math.floor(f / 3.2) % (span * 2);
  return staticFile(`bl/${String(PLATE_LO + (t < span ? t : span * 2 - t)).padStart(4, '0')}.jpg`);
};

const GRAIN =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='0.55'/></svg>`
  );

const Grain = ({ f }: { f: number }) => (
  <AbsoluteFill style={{
    backgroundImage: `url("${GRAIN}")`, backgroundSize: '160px 160px',
    backgroundPosition: `${(f * 37) % 160}px ${(f * 61) % 160}px`,
    opacity: 0.075, mixBlendMode: 'overlay', pointerEvents: 'none',
  }} />
);

const Vignette = ({ k }: { k: number }) => (
  <AbsoluteFill style={{
    background: 'radial-gradient(130% 78% at 50% 44%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.42) 74%, rgba(0,0,0,0.72) 100%)',
    opacity: k, pointerEvents: 'none',
  }} />
);

const Plate = ({ f, total, blur, dark }: { f: number; total: number; blur: number; dark: number }) => {
  const k = interpolate(f, [0, total], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#0B0A09' }}>
      <Img src={plateSrc(f)} style={{
        width: '100%', height: '100%', objectFit: 'cover',
        transform: `scale(${interpolate(k, [0, 1], [1.3, 1.46])}) translateX(${interpolate(k, [0, 1], [26, -26])}px)`,
        filter: `saturate(0.8) contrast(1.04) brightness(0.62) blur(${blur}px)`,
      }} />
      <AbsoluteFill style={{ background: `rgba(11,10,9,${dark})` }} />
    </AbsoluteFill>
  );
};

/** Fade a beat in at its head and out at its tail. */
const beatFade = (f: number, start: number, len: number, head = 26, tail = 24) =>
  Math.min(
    interpolate(f, [start, start + head], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    interpolate(f, [start + len - tail, start + len], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  );

const Msg = ({ l, p }: { l: Line; p: number }) => (
  <div style={{
    alignSelf: l.me ? 'flex-end' : 'flex-start',
    maxWidth: l.bill ? '100%' : '86%', minWidth: l.bill ? '96%' : undefined,
    background: l.me ? C.waOut : C.waIn,
    borderRadius: 14, [l.me ? 'borderTopLeftRadius' : 'borderTopRightRadius']: 4,
    padding: '13px 17px', color: '#111B21', fontFamily: UI, fontSize: 25, lineHeight: 1.46,
    opacity: p, transform: `translateY(${(1 - p) * 14}px)`,
    boxShadow: '0 1px 2px rgba(0,0,0,0.12)', whiteSpace: 'pre-wrap',
  }}>
    {l.text}
    {l.bill && (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {l.bill.map(([a, b], i) => (
          <span key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 18 }}>
            <span style={{ flex: 1 }}>{a}</span><b style={{ fontFamily: MONO, fontWeight: 500 }}>{b}</b>
          </span>
        ))}
        <span style={{ height: 1, background: 'rgba(17,27,33,0.15)', margin: '6px 0' }} />
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 18, fontWeight: 700 }}>
          <span>{l.total![0]}</span><b style={{ fontFamily: MONO }}>{l.total![1]}</b>
        </span>
      </span>
    )}
  </div>
);

const Notif = ({ text, time, p }: { text: string; time: string; p: number }) => (
  <div style={{
    background: 'rgba(252,250,247,0.97)', borderRadius: 30, padding: '26px 30px',
    display: 'flex', alignItems: 'center', gap: 22, direction: 'rtl',
    transform: `translateY(${(1 - p) * -70}px)`, opacity: p,
    boxShadow: '0 30px 60px -20px rgba(0,0,0,0.6)',
  }}>
    <Img src={staticFile('01-mark-fine-brass-on-ink-nobg.svg')}
      style={{ width: 70, height: 70, borderRadius: 999, background: C.ink, padding: 10, flex: '0 0 auto' }} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: UI, fontSize: 26, fontWeight: 600, color: '#111B21' }}>واتساب</div>
      <div style={{ fontFamily: UI, fontSize: 28, color: '#3B4A51', marginTop: 3 }}>{text}</div>
    </div>
    <div style={{ fontFamily: MONO, fontSize: 23, color: '#8696A0' }}>{time}</div>
  </div>
);

export const Scene: React.FC<{ story?: string }> = ({ story = 'night' }) => {
  const ready = useFontsReady();
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = STORIES[story] ?? STORIES['night']!;
  const starts = beatStarts(s);
  if (!ready) return <AbsoluteFill style={{ background: '#0B0A09' }} />;

  let i = 0;
  for (let n = 0; n < starts.length; n++) if (frame >= starts[n]!) i = n;
  const beat = s.beats[i] as Beat;
  const start = starts[i]!;
  const local = frame - start;

  const onPaper = beat.kind === 'food';
  const onInk = beat.kind === 'end';
  const inChat = beat.kind === 'chat';

  const fade = interpolate(frame, [0, 26], [0, 1], { extrapolateRight: 'clamp' })
    * interpolate(frame, [durationInFrames - 24, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });

  return (
    <AbsoluteFill style={{ background: '#0B0A09', opacity: fade }}>
      <Plate f={frame} total={durationInFrames} blur={inChat ? 52 : 38} dark={inChat ? 0.46 : 0.28} />

      {beat.kind === 'title' && (
        <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 110px' }}>
          <div style={{ textAlign: 'center', direction: 'rtl', opacity: beatFade(frame, start, beat.frames) }}>
            <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 92, lineHeight: 1.34, color: '#F7F1E8', textShadow: '0 4px 40px rgba(0,0,0,0.6)' }}>{beat.line}</div>
            {beat.sub && <div style={{ marginTop: 26, fontFamily: UI, fontSize: 32, color: 'rgba(247,241,232,0.62)', direction: 'ltr' }}>{beat.sub}</div>}
          </div>
        </AbsoluteFill>
      )}

      {beat.kind === 'notif' && (
        <AbsoluteFill style={{ padding: '96px 70px 0' }}>
          <Notif text={beat.text} time={beat.time}
            p={spring({ frame: local - 8, fps, config: { damping: 180 }, durationInFrames: 26 }) * beatFade(frame, start, beat.frames, 1, 26)} />
        </AbsoluteFill>
      )}

      {beat.kind === 'burst' && (
        <AbsoluteFill style={{ padding: '96px 70px 0', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {beat.items.map(([text, time], n) => (
            <Notif key={n} text={text} time={time}
              p={spring({ frame: local - 8 - n * 22, fps, config: { damping: 180 }, durationInFrames: 24 }) * beatFade(frame, start, beat.frames, 1, 26)} />
          ))}
        </AbsoluteFill>
      )}

      {beat.kind === 'chat' && (() => {
        const inP = spring({ frame: local, fps, config: { damping: 200 }, durationInFrames: 34 });
        const gap = Math.max(26, Math.floor((beat.frames - 80) / Math.max(beat.lines.length, 1)));
        return (
          <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 86px' }}>
            <div style={{
              width: '100%', background: 'rgba(239,231,222,0.97)', borderRadius: 34, padding: '26px 24px 30px',
              display: 'flex', flexDirection: 'column', gap: 11, direction: 'rtl',
              opacity: inP * beatFade(frame, start, beat.frames, 1, 26),
              transform: `translateY(${(1 - inP) * 46}px) scale(${interpolate(inP, [0, 1], [0.96, 1])})`,
              boxShadow: '0 50px 110px -30px rgba(0,0,0,0.75)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 14, borderBottom: '1px solid rgba(17,27,33,0.1)' }}>
                <Img src={staticFile('01-mark-fine-brass-on-ink-nobg.svg')}
                  style={{ width: 56, height: 56, borderRadius: 999, background: C.ink, padding: 8 }} />
                <div style={{ lineHeight: 1.2 }}>
                  <div style={{ fontFamily: UI, fontSize: 28, fontWeight: 600, color: '#111B21' }}>مُنادم</div>
                  <div style={{ fontFamily: UI, fontSize: 21, color: '#667781' }}>واتساب</div>
                </div>
              </div>
              {beat.lines.map((l, n) => {
                const p = spring({ frame: local - 40 - n * gap, fps, config: { damping: 200 }, durationInFrames: 15 });
                if (p <= 0) return null;
                return <Msg key={n} l={l} p={p} />;
              })}
            </div>
          </AbsoluteFill>
        );
      })()}

      {beat.kind === 'stat' && (() => {
        const p = spring({ frame: local - 6, fps, config: { damping: 200 }, durationInFrames: 28 }) * beatFade(frame, start, beat.frames, 1, 22);
        return (
          <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 110px', opacity: p }}>
            <div style={{ textAlign: 'center', direction: 'rtl' }}>
              {beat.code && <div style={{ fontFamily: MONO, fontSize: 70, fontWeight: 500, color: C.brassLight, letterSpacing: 2 }}>{beat.code}</div>}
              <div style={{ width: 150, height: 5, background: C.karkadeh, borderRadius: 3, margin: beat.code ? '26px auto 24px' : '0 auto 28px' }} />
              <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 70, color: '#F7F1E8', lineHeight: 1.35 }}>{beat.line}</div>
              {beat.sub && <div style={{ marginTop: 18, fontFamily: UI, fontSize: 31, color: 'rgba(247,241,232,0.6)', direction: 'ltr' }}>{beat.sub}</div>}
            </div>
          </AbsoluteFill>
        );
      })()}

      {beat.kind === 'food' && (() => {
        const p = spring({ frame: local, fps, config: { damping: 200 }, durationInFrames: 30 }) * beatFade(frame, start, beat.frames, 1, 22);
        const k = interpolate(local, [0, beat.frames], [0, 1], { extrapolateRight: 'clamp' });
        return (
          <AbsoluteFill style={{ background: C.semna, opacity: p }}>
            <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 420 }}>
              <Img src={staticFile(`photos/${beat.photo}`)}
                style={{ width: '74%', objectFit: 'contain', mixBlendMode: 'multiply', transform: `scale(${interpolate(k, [0, 1], [1, 1.07])})` }} />
            </AbsoluteFill>
            <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 260, direction: 'rtl' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 68, color: C.ink }}>{beat.line}</div>
                {beat.sub && <div style={{ marginTop: 14, fontFamily: UI, fontSize: 30, color: 'rgba(20,17,16,0.55)', direction: 'ltr' }}>{beat.sub}</div>}
              </div>
            </AbsoluteFill>
          </AbsoluteFill>
        );
      })()}

      {beat.kind === 'end' && (() => {
        const p = spring({ frame: local, fps, config: { damping: 200 }, durationInFrames: 30 });
        return (
          <AbsoluteFill style={{ background: C.ink, opacity: p, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <Img src={staticFile('23-lockup-stacked-dark-nobg.svg')} style={{ width: 460, transform: `scale(${interpolate(p, [0, 1], [0.94, 1])})` }} />
              <div style={{ marginTop: 44, fontFamily: AR, fontWeight: 700, fontSize: 54, color: '#F7F1E8', direction: 'rtl' }}>{beat.line}</div>
              <div style={{ marginTop: 20, fontFamily: 'Cinzel', fontSize: 28, letterSpacing: 6, color: C.brassLight }}>MUNADIM.COM</div>
            </div>
          </AbsoluteFill>
        );
      })()}

      {/* Audio sits OUTSIDE the per-beat conditionals on purpose: a Sequence that only
          exists while the playhead is inside its beat never registers with the renderer,
          and the films came out completely silent. Bed across the whole piece, message
          tones on the conversation beat. */}
      <Audio src={staticFile('sfx/bed.wav')} volume={0.9} />
      {s.beats.map((b, bi) =>
        b.kind === 'chat'
          ? b.lines.map((l, n) => (
              <Sequence key={`sfx${bi}-${n}`}
                from={starts[bi]! + 40 + n * Math.max(26, Math.floor((b.frames - 80) / Math.max(b.lines.length, 1)))}
                durationInFrames={10}>
                <Audio src={staticFile(l.me ? 'sfx/pop-out.wav' : 'sfx/pop-in.wav')} />
              </Sequence>
            ))
          : null
      )}

      <Vignette k={onPaper ? 0 : onInk ? 0.25 : 1} />
      <Grain f={frame} />
    </AbsoluteFill>
  );
};
