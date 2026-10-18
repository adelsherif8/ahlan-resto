/** FilmShort — the 12-second cut of «الطابور»: hook over the jump, the landing, the end card. Second life for the hero. */
import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, MONO } from './lib/brand';
import { FILM } from './lib/film';
import { PostEnd, useFontsReady } from './Post';

const AR = 'Amiri, NotoEmoji';
const UI = 'Plex, NotoEmoji';
const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
export const SHORT = { jump: 180, land: 100, endCard: 90 };
export const shortEnd = () => SHORT.jump + SHORT.land + SHORT.endCard;

export const FilmShort: React.FC = () => {
  const frame = useCurrentFrame();
  const ready = useFontsReady();
  if (!ready) return <AbsoluteFill style={{ background: C.ink }} />;
  const headA = interpolate(frame, [4, 22], [0, 1], clamp) * interpolate(frame, [SHORT.jump - 12, SHORT.jump], [1, 0], clamp);
  const endStart = SHORT.jump + SHORT.land - 10;
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: 'hidden' }}>
      <Audio src={staticFile('loop/sfx-ambience.wav')} volume={0.35} loop />
      <Sequence from={endStart} durationInFrames={120}><Audio src={staticFile('sfx/bed.wav')} volume={0.4} /></Sequence>
      <Sequence from={0} durationInFrames={SHORT.jump} layout="none">
        <OffthreadVideo src={staticFile('loop/shot-4.mp4')} volume={0.9} playbackRate={0.8} style={{ position: 'absolute', inset: 0, width: 1080, height: 1920, objectFit: 'cover' }} />
      </Sequence>
      <Sequence from={SHORT.jump} durationInFrames={SHORT.land} layout="none">
        <OffthreadVideo src={staticFile('loop/shot-5.mp4')} volume={0.9} playbackRate={0.8} style={{ position: 'absolute', inset: 0, width: 1080, height: 1920, objectFit: 'cover' }} />
        <AbsoluteFill style={{ background: C.ink, opacity: interpolate(frame - SHORT.jump, [0, 6], [1, 0], clamp) }} />
      </Sequence>
      <AbsoluteFill style={{ pointerEvents: 'none', backgroundImage: `url(${staticFile('loop/grain.png')})`, backgroundSize: '512px 512px', backgroundPosition: `${(frame * 97) % 512}px ${(frame * 61) % 512}px`, mixBlendMode: 'overlay', opacity: 0.28 }} />
      <AbsoluteFill style={{ pointerEvents: 'none', background: 'radial-gradient(ellipse 70% 62% at 50% 48%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)' }} />
      <div style={{ position: 'absolute', inset: '0 0 auto 0', height: 520, background: 'linear-gradient(180deg, rgba(20,17,16,0.9) 0%, rgba(20,17,16,0.5) 55%, rgba(20,17,16,0) 100%)', opacity: headA }} />
      <div style={{ position: 'absolute', top: 120, left: 70, right: 70, direction: 'rtl', textAlign: 'right', opacity: headA }}>
        <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 92, lineHeight: 1.36, color: C.semna }}>{FILM.headline}</div>
        <div style={{ width: 140, height: 6, background: C.karkadeh, borderRadius: 3, margin: '34px 0 22px' }} />
        <div style={{ fontFamily: UI, fontSize: 30, color: 'rgba(245,239,231,0.7)', direction: 'ltr', textAlign: 'right' }}>{FILM.english}</div>
      </div>
      <div style={{ position: 'absolute', inset: 'auto 0 0 0', height: 260, background: 'linear-gradient(0deg, rgba(20,17,16,0.9) 0%, rgba(20,17,16,0) 100%)' }} />
      <Img src={staticFile('20-lockup-horizontal-dark-nobg.svg')} style={{ position: 'absolute', left: 70, bottom: 80, width: 300 }} />
      <div style={{ position: 'absolute', right: 70, bottom: 92, fontFamily: MONO, color: C.brassLight, fontSize: 30, letterSpacing: 2 }}>01022034603</div>
      <PostEnd frame={frame} endStart={endStart} payoff={FILM.payoff} />
    </AbsoluteFill>
  );
};
