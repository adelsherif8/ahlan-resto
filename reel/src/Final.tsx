import { AbsoluteFill, Audio, Img, staticFile, useCurrentFrame } from 'remotion';
import { Caption, EndCard, useFonts } from './Reel';
import { C, FONT, MONO } from './lib/brand';
import { Img as RImg } from 'remotion';
import { setVariant } from './lib/timeline';
import { clamp, easeOut, prog } from './lib/anim';

export const CITY_IN = 470, CITY_OUT = 830;
const pad = (n: number) => String(n).padStart(4, '0');

/** quick GTA-style whip: motion blur + punch at the seams between the table and the city */
function whip(f: number, at: number, half = 12) {
  return clamp(1 - Math.abs(f - at) / half);
}

/** Maps-style card while the rider is on the road */
function RideCard({ f }: { f: number }) {
  const a = easeOut(prog(f, 726, 748)) * (1 - prog(f, 806, 822));
  if (a <= 0.01) return null;
  return (
    <div
      style={{
        position: 'absolute', left: 48, right: 48, bottom: 250, opacity: a,
        transform: `translateY(${(1 - a) * 40}px)`,
        background: 'rgba(255,253,248,0.97)', borderRadius: 40, padding: '38px 42px',
        direction: 'rtl', fontFamily: FONT, boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 34, color: '#7A7268', fontWeight: 600 }}>الأوردر في الطريق</div>
          <div style={{ fontSize: 62, color: C.ink, fontWeight: 700, marginTop: 6 }}>30 دقيقة</div>
        </div>
        <div style={{ width: 92, height: 92, borderRadius: 46, background: '#1A73E8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" />
            <path d="M6 17l3-6h6v6M15 11l2-4" /><rect x="4.5" y="6" width="5" height="4" />
          </svg>
        </div>
      </div>
      <div style={{ height: 2, background: 'rgba(20,17,16,0.12)', margin: '26px 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, background: C.karkadeh }} />
        <div style={{ fontSize: 34, color: C.ink, fontWeight: 600 }}>شارع 9 — نفس العنوان</div>
        <div style={{ marginInlineStart: 'auto', fontFamily: MONO, fontSize: 30, color: '#7A7268' }}>#1042</div>
      </div>
    </div>
  );
}

/** small standing brand mark: this agent is Munadim */
function Watermark({ f }: { f: number }) {
  const a = easeOut(prog(f, 96, 120)) * (1 - prog(f, 760, 790));
  if (a <= 0.01) return null;
  return (
    <div
      style={{
        position: 'absolute', top: 86, right: 48, display: 'flex', alignItems: 'center', gap: 14,
        opacity: a, direction: 'rtl', background: 'rgba(20,17,16,0.72)', border: '2px solid rgba(185,132,50,0.75)',
        borderRadius: 999, padding: '12px 22px 12px 26px', backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      }}
    >
      <RImg src={staticFile('01-mark-fine-brass-on-ink-nobg.svg')} style={{ width: 46, height: 46 }} />
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 34, color: '#F5EFE7', lineHeight: 1 }}>
        منادم
        <div style={{ fontSize: 20, fontWeight: 500, color: C.brassLight, marginTop: 4 }}>الرد ده مننا</div>
      </div>
    </div>
  );
}

export function Final({ variant = 'holo' }: { variant?: 'holo' | 'map' }) {
  // must run per frame: the render workers don't share the module state set in calculateMetadata
  setVariant(variant);
  const ready = useFonts();
  const f = useCurrentFrame();

  let src: string;
  if (variant === 'map') {
    if (f < CITY_IN) src = `bl_map/${pad(f)}.jpg`;
    else if (f <= CITY_OUT) src = `city/${pad(f - CITY_IN)}.jpg`;
    else src = `bl_map/${pad(f)}.jpg`;
  } else {
    src = `bl_holo/${pad(f)}.jpg`;
  }

  const w = variant === 'map' ? Math.max(whip(f, CITY_IN), whip(f, CITY_OUT)) : 0;
  const blurPx = 26 * w * w;
  const scale = 1 + 0.14 * w;
  const flash = 0.45 * Math.pow(w, 3);

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Audio src={staticFile(`audio-${variant}.wav`)} volume={0.9} />
      <Img src={staticFile(src)} style={{ width: '100%', height: '100%', filter: `blur(${blurPx}px)`, transform: `scale(${scale})` }} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.38) 100%)' }} />
      {flash > 0.002 && <AbsoluteFill style={{ background: `rgba(255,255,255,${flash})` }} />}
      {ready && variant === 'map' && <RideCard f={f} />}
      {ready && <Watermark f={f} />}
      {ready && <Caption />}
      {ready && <EndCard />}
    </AbsoluteFill>
  );
}
