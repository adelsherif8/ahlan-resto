/**
 * StoryQ — the daily question story as a 6-second VIDEO, not a text card.
 * A muted film shot moves behind the question (people skip still text in under a second); the question lives in
 * the top 40%; the lower half is left clear for the poll / quiz sticker the founder adds by hand — stickers cannot
 * be published through the API, so the clip is built around the empty space.
 */
import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, MONO } from './lib/brand';
import { STORIES_Q } from './lib/storyq';
import { useFontsReady } from './Post';

const AR = 'Amiri, NotoEmoji';
const UI = 'Plex, NotoEmoji';
const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
/** the film shots, rotated so consecutive days never show the same clip */
const CLIPS = ['loop/shot-1.mp4', 'loop/shot-4.mp4', 'loop/shot-2.mp4', 'loop/shot-6.mp4', 'loop/shot-3.mp4', 'loop/shot-5.mp4'];

export const StoryQ: React.FC<{ index?: number }> = ({ index = 0 }) => {
  const frame = useCurrentFrame();
  const ready = useFontsReady();
  const s = STORIES_Q[Math.min(index, STORIES_Q.length - 1)]!;
  if (!ready) return <AbsoluteFill style={{ background: C.ink }} />;
  const a = interpolate(frame, [6, 26], [0, 1], clamp);
  const x = (1 - a) * 40;
  const rule = interpolate(frame, [18, 40], [0, 1], clamp);
  const zoom = interpolate(frame, [0, 180], [1.04, 1.1]);
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: '50% 40%' }}>
        <OffthreadVideo src={staticFile(CLIPS[index % CLIPS.length]!)} muted playbackRate={0.8} style={{ width: 1080, height: 1920, objectFit: 'cover' }} />
      </AbsoluteFill>
      {/* the film grade, so it matches the feed */}
      <AbsoluteFill style={{ backgroundImage: `url(${staticFile('loop/grain.png')})`, backgroundSize: '512px 512px', backgroundPosition: `${(frame * 97) % 512}px ${(frame * 61) % 512}px`, mixBlendMode: 'overlay', opacity: 0.25 }} />
      {/* ink from the top for the question, ink from the bottom for the sticker */}
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(20,17,16,0.94) 0%, rgba(20,17,16,0.72) 34%, rgba(20,17,16,0.15) 52%, rgba(20,17,16,0.55) 78%, rgba(20,17,16,0.92) 100%)' }} />

      <div style={{ position: 'absolute', top: 200, left: 80, right: 80, direction: 'rtl', textAlign: 'right', opacity: a, transform: `translateX(${x}px)` }}>
        <div style={{ fontFamily: 'Cinzel', fontSize: 20, letterSpacing: '0.24em', color: C.brassLight, marginBottom: 26 }}>{s.kind.toUpperCase()} · MUNADIM</div>
        <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 86, lineHeight: 1.38, color: C.semna }}>{s.q}</div>
        <div style={{ width: 150 * rule, height: 6, background: C.karkadeh, borderRadius: 3, margin: '36px 0 22px' }} />
        <div style={{ fontFamily: UI, fontSize: 30, color: 'rgba(245,239,231,0.7)', direction: 'ltr', textAlign: 'right' }}>{s.en}</div>
      </div>

      {/* bottom: lockup + number; the space above it stays empty for the sticker */}
      <Img src={staticFile('20-lockup-horizontal-dark-nobg.svg')} style={{ position: 'absolute', left: 80, bottom: 120, width: 280 }} />
      <div style={{ position: 'absolute', right: 80, bottom: 132, fontFamily: MONO, color: C.brassLight, fontSize: 30, letterSpacing: 2 }}>01022034603</div>
    </AbsoluteFill>
  );
};
