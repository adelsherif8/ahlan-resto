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
/** One background per question, matched to what it asks — a real product photo (the band cropped out of the
 *  brand post) or a real-chat reel for the chat questions. Never the same scene twice in a row. */
type BG = { kind: 'image'; src: string } | { kind: 'video'; src: string };
const BGS: BG[] = [
  { kind: 'image', src: 'storybg/01.jpg' },     // 1  do you have their numbers → the dashboard's customer list
  { kind: 'video', src: 'loop/r2B.mp4' },       // 2  how do you type → the Franco order
  { kind: 'image', src: 'storybg/03.jpg' },     // 3  told it was available → the honest «مش موجود» scene
  { kind: 'video', src: 'loop/rR1.mp4' },       // 4  how long for a full order → the real full order
  { kind: 'image', src: 'storybg/05.jpg' },     // 5  what gets lost in the rush → the kitchen ticket
  { kind: 'image', src: 'storybg/06.jpg' },     // 6  do staff learn new systems → the kitchen tablet
  { kind: 'image', src: 'storybg/07.jpg' },     // 7  what the app takes → one receipt, two outcomes
  { kind: 'image', src: 'storybg/08.jpg' },     // 8  dine-in numbers → the table QR
  { kind: 'image', src: 'storybg/09.jpg' },     // 9  big-table bills → the feast
  { kind: 'video', src: 'loop/rR7.mp4' },       // 10 who keeps the number → the returning guest
  { kind: 'image', src: 'storybg/11.jpg' },     // 11 a clear receipt → the receipt
  { kind: 'image', src: 'storybg/12.jpg' },     // 12 delivery pricing → the distance map
  { kind: 'image', src: 'storybg/13.jpg' },     // 13 run it from outside → the phone in the car
  { kind: 'image', src: 'storybg/14.jpg' },     // 14 what it understands → three phones, three languages
];

export const StoryQ: React.FC<{ index?: number }> = ({ index = 0 }) => {
  const frame = useCurrentFrame();
  const ready = useFontsReady();
  const s = STORIES_Q[Math.min(index, STORIES_Q.length - 1)]!;
  const bg = BGS[Math.min(index, BGS.length - 1)]!;
  if (!ready) return <AbsoluteFill style={{ background: C.ink }} />;
  const a = interpolate(frame, [6, 26], [0, 1], clamp);
  const x = (1 - a) * 40;
  const rule = interpolate(frame, [18, 40], [0, 1], clamp);
  const zoom = interpolate(frame, [0, 180], [1.04, 1.1]);
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: 'hidden' }}>
      {/* a chat reel carries its own headline at the top — the frame is pushed up so only the phone is in view */}
      {bg.kind === 'video' ? (
        <AbsoluteFill style={{ clipPath: 'inset(0 0 480px 0)' }}><AbsoluteFill style={{ transform: `translateY(-380px) scale(${zoom * 1.25})`, transformOrigin: '50% 50%' }}>
          <OffthreadVideo src={staticFile(bg.src)} muted playbackRate={0.8} style={{ width: 1080, height: 1920, objectFit: 'cover' }} />
        </AbsoluteFill></AbsoluteFill>
      ) : (
        <>
          {/* the photo itself, soft and full-bleed, as the room; then the same photo sharp as a card the question sits above */}
          <AbsoluteFill style={{ transform: `scale(${zoom * 1.15})`, transformOrigin: '50% 50%', filter: 'blur(28px) brightness(0.55)' }}>
            <Img src={staticFile(bg.src)} style={{ width: 1080, height: 1920, objectFit: 'cover' }} />
          </AbsoluteFill>
          <div style={{ position: 'absolute', left: 90, right: 90, top: 640, height: 720, borderRadius: 28, overflow: 'hidden', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)', transform: `scale(${1 + (zoom - 1.04) * 0.5})` }}>
            <Img src={staticFile(bg.src)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 45%' }} />
          </div>
        </>
      )}
      {/* the film grade, so it matches the feed */}
      <AbsoluteFill style={{ backgroundImage: `url(${staticFile('loop/grain.png')})`, backgroundSize: '512px 512px', backgroundPosition: `${(frame * 97) % 512}px ${(frame * 61) % 512}px`, mixBlendMode: 'overlay', opacity: 0.25 }} />
      {/* ink from the top for the question, ink from the bottom for the sticker */}
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(20,17,16,0.94) 0%, rgba(20,17,16,0.72) 34%, rgba(20,17,16,0.15) 52%, rgba(20,17,16,0.55) 78%, rgba(20,17,16,0.92) 100%)' }} />

      <div style={{ position: 'absolute', top: bg.kind === 'image' ? 150 : 200, left: 80, right: 80, direction: 'rtl', textAlign: 'right', opacity: a, transform: `translateX(${x}px)` }}>
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
