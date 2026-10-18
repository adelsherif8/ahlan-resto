/** Carousel slide — 1080×1350 still. See lib/carousels.ts. */
import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { C, MONO } from './lib/brand';
import { DECKS } from './lib/carousels';
import { useFontsReady } from './Post';

const AR = 'Amiri, NotoEmoji';
const UI = 'Plex, NotoEmoji';

const Lockup: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <Img src={staticFile(dark ? '20-lockup-horizontal-dark-nobg.svg' : '21-lockup-horizontal-light-nobg.svg')} style={{ position: 'absolute', left: 64, bottom: 56, width: 250 }} />
);
const Counter: React.FC<{ i: number; n: number; dark?: boolean }> = ({ i, n, dark }) => (
  <div style={{ position: 'absolute', right: 64, top: 56, fontFamily: MONO, fontSize: 26, letterSpacing: 2, color: dark ? C.brassLight : C.brass, direction: 'ltr' }}>{i} / {n}</div>
);
const Phone: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <div style={{ position: 'absolute', right: 64, bottom: 66, fontFamily: MONO, fontSize: 28, letterSpacing: 2, color: dark ? C.brassLight : C.brass }}>01022034603</div>
);

export const Carousel: React.FC<{ deck?: string; slide?: number }> = ({ deck = 'A', slide = 0 }) => {
  const ready = useFontsReady();
  const d = DECKS[deck] ?? DECKS['A']!;
  const s = d.slides[Math.min(slide, d.slides.length - 1)]!;
  const n = d.slides.length;
  if (!ready) return <AbsoluteFill style={{ background: C.semna }} />;

  if (s.k === 'cover' || s.k === 'cta') {
    return (
      <AbsoluteFill style={{ background: C.ink, padding: s.k === 'cover' && s.bg ? '0 96px 200px' : '0 96px', justifyContent: s.k === 'cover' && s.bg ? 'flex-end' : 'center', alignItems: 'flex-end', direction: 'rtl' }}>
        {s.k === 'cover' && s.bg && <>
          <Img src={staticFile(`storybg/${s.bg}`)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7 }} />
          <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(20,17,16,0.35) 0%, rgba(20,17,16,0.55) 40%, rgba(20,17,16,0.96) 72%)' }} />
        </>}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ fontFamily: AR, fontWeight: 700, fontSize: s.k === 'cover' ? 96 : 104, lineHeight: 1.32, color: C.semna, textAlign: 'right', whiteSpace: 'pre-line' }}>{s.title}</div>
          <div style={{ width: 160, height: 6, background: C.brassLight, borderRadius: 3, margin: '40px 0 30px' }} />
          <div style={{ fontFamily: UI, fontSize: 36, color: 'rgba(245,239,231,0.75)', textAlign: 'right' }}>{s.sub}</div>
        </div>
        {s.k === 'cta' && s.foot && <div style={{ position: 'absolute', left: 96, right: 96, bottom: 150, fontFamily: UI, fontSize: 22, lineHeight: 1.6, color: 'rgba(245,239,231,0.5)', textAlign: 'right' }}>{s.foot}</div>}
        {s.k === 'cover' && <div style={{ position: 'absolute', left: 64, top: 56, fontFamily: 'Cinzel', fontSize: 20, letterSpacing: '0.22em', color: C.brassLight }}>MUNADIM</div>}
        <Counter i={slide + 1} n={n} dark />
        <Lockup dark />
        {s.k === 'cta' && <Phone dark />}
      </AbsoluteFill>
    );
  }

  if (s.k === 'image') {
    return (
      <AbsoluteFill style={{ background: C.semna }}>
        <AbsoluteFill style={{ background: 'radial-gradient(120% 70% at 50% 10%, rgba(255,253,248,0.9), rgba(245,239,231,0) 60%)' }} />
        <div style={{ position: 'absolute', left: 64, right: 64, top: 118, bottom: 150, display: 'grid', placeItems: 'center' }}>
          <Img src={staticFile(`posts/${s.src}`)} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 22, boxShadow: '0 40px 90px -40px rgba(20,17,16,0.45)' }} />
        </div>
        <Counter i={slide + 1} n={n} />
        {/* the post carries its own lockup */}
      </AbsoluteFill>
    );
  }

  if (s.k === 'number') {
    return (
      <AbsoluteFill style={{ background: C.semna, padding: '0 96px', justifyContent: 'center', alignItems: 'flex-end', direction: 'rtl' }}>
        <div style={{ fontFamily: UI, fontWeight: 600, fontSize: 34, color: C.ink, opacity: 0.7, textAlign: 'right' }}>{s.eyebrow}</div>
        <div style={{ fontFamily: MONO, fontSize: 220, lineHeight: 1, color: C.karkadeh, letterSpacing: -4, margin: '26px 0 8px', direction: 'ltr' }}>{s.big}</div>
        {s.unit && <div style={{ fontFamily: UI, fontSize: 40, color: C.brass, fontWeight: 600 }}>{s.unit}</div>}
        <div style={{ width: 160, height: 6, background: C.karkadeh, borderRadius: 3, margin: '36px 0 26px' }} />
        <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 60, lineHeight: 1.35, color: C.ink, textAlign: 'right' }}>{s.line}</div>
        <Counter i={slide + 1} n={n} />
        <Lockup />
      </AbsoluteFill>
    );
  }

  if (s.k === 'qa') {
    return (
      <AbsoluteFill style={{ background: C.semna, padding: '330px 96px 0', justifyContent: 'center', alignItems: 'flex-end', direction: 'rtl' }}>
        {s.bg && <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 420, overflow: 'hidden' }}>
          <Img src={staticFile(`storybg/${s.bg}`)} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85)' }} />
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, rgba(20,17,16,0.25) 0%, rgba(245,239,231,0) 55%, ${C.semna} 100%)` }} />
        </div>}
        <div style={{ fontFamily: 'Cinzel', fontSize: 20, letterSpacing: '0.22em', color: C.brass, alignSelf: 'flex-end', marginBottom: 30 }}>THE OWNER ASKS</div>
        <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 70, lineHeight: 1.36, color: C.karkadeh, textAlign: 'right' }}>{s.q}</div>
        <div style={{ width: 160, height: 6, background: C.karkadeh, borderRadius: 3, margin: '40px 0 34px' }} />
        <div style={{ fontFamily: UI, fontWeight: 500, fontSize: 40, lineHeight: 1.7, color: C.ink, textAlign: 'right' }}>{s.a}</div>
        <Counter i={slide + 1} n={n} />
        <Lockup />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ background: C.semna, padding: '0 96px', justifyContent: 'center', alignItems: 'flex-end', direction: 'rtl' }}>
      <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 96, lineHeight: 1.32, color: C.ink, textAlign: 'right' }}>{s.title}</div>
      {s.body && <><div style={{ width: 160, height: 6, background: C.karkadeh, borderRadius: 3, margin: '40px 0 30px' }} /><div style={{ fontFamily: UI, fontSize: 42, lineHeight: 1.7, color: C.ink, opacity: 0.8, textAlign: 'right' }}>{s.body}</div></>}
      <Counter i={slide + 1} n={n} />
      <Lockup />
    </AbsoluteFill>
  );
};
