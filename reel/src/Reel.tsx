import { useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig, Img } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import * as THREE from 'three';
import { Scene } from './scene/Scene';
import { CAPTIONS, T } from './lib/timeline';
import { prog, easeOut } from './lib/anim';
import { C, FONT } from './lib/brand';

const FACES: [string, string, string][] = [
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-regular.woff2', '400'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-500.woff2', '500'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-600.woff2', '600'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-700.woff2', '700'],
  ['PlexMono', 'fonts/ibm-plex-mono-v20-latin-500.woff2', '500'],
];

export function useFonts() {
  const [handle] = useState(() => delayRender('fonts'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all(
      FACES.map(([fam, file, weight]) => new FontFace(fam, `url(${staticFile(file)})`, { weight }).load()),
    ).then((faces) => {
      faces.forEach((ff) => document.fonts.add(ff));
      setReady(true);
    });
  }, [handle]);
  useEffect(() => {
    if (!ready) return;
    // release only after the ThreeCanvas has mounted and registered its own delayRender
    const id = requestAnimationFrame(() => continueRender(handle));
    return () => cancelAnimationFrame(id);
  }, [ready, handle]);
  return ready;
}

export function Caption() {
  const f = useCurrentFrame();
  const c = CAPTIONS.find((x) => f >= x.in && f <= x.out);
  if (!c) return null;
  const a = Math.min(prog(f, c.in, c.in + 10), 1 - prog(f, c.out - 8, c.out));
  const y = (1 - easeOut(prog(f, c.in, c.in + 12))) * 30;
  return (
    <>
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 520, opacity: a, background: 'linear-gradient(to bottom, rgba(8,6,5,0.72), rgba(8,6,5,0.35) 60%, rgba(8,6,5,0))' }} />
    <div
      style={{
        position: 'absolute',
        top: 230,
        left: 0,
        right: 0,
        textAlign: 'center',
        direction: 'rtl',
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: 66,
        color: '#FFF8EE',
        opacity: a,
        transform: `translateY(${y}px)`,
        textShadow: '0 4px 30px rgba(0,0,0,0.65), 0 1px 3px rgba(0,0,0,0.6)',
        padding: '0 50px',
        lineHeight: 1.35,
      }}
    >
      {c.text}
    </div>
    </>
  );
}

export function EndCard() {
  const f = useCurrentFrame();
  const a = easeOut(prog(f, T.end[0], T.end[1]));
  if (a <= 0) return null;
  const s = (k: number) => easeOut(prog(f, T.end[0] + k, T.end[0] + k + 18));
  return (
    <AbsoluteFill
      style={{
        background: `rgba(20,17,16,${0.9 * a})`,
        backdropFilter: `blur(${14 * a}px)`,
        alignItems: 'center',
        justifyContent: 'center',
        direction: 'rtl',
        fontFamily: FONT,
      }}
    >
      <Img src={staticFile('23-lockup-stacked-dark-nobg.svg')} style={{ width: 560, opacity: s(4), transform: `translateY(${(1 - s(4)) * 30}px)` }} />
      <div style={{ color: C.semna, fontSize: 58, fontWeight: 600, marginTop: 40, opacity: s(10), transform: `translateY(${(1 - s(10)) * 24}px)` }}>
        قناة الطلبات المباشرة لمطعمك
      </div>
      <div style={{ color: C.brassLight, fontSize: 44, fontWeight: 500, marginTop: 26, opacity: s(16), fontFamily: 'PlexMono', letterSpacing: 2 }}>
        munadim.com
      </div>
    </AbsoluteFill>
  );
}

