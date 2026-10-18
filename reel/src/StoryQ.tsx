/**
 * StoryQ — the daily question story, 7 s. Layout from the 2026 story research (safe zones, where the thumb rests,
 * one question, sticker mid-frame) — and from what the product photos actually are: screens full of small text.
 * So the photo is NOT a backdrop for more text. The frame is split:
 *  · top ~52 %: the real scene, full width, slow push-in, fading into ink at its foot
 *  · bottom ~48 %: an ink panel with ONE big centred question and the marked sticker zone right under it
 * Everything that matters sits inside y 250–1500 (Instagram covers the top ~220 px and the bottom ~400 px).
 */
import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from './lib/brand';
import { STORIES_Q } from './lib/storyq';
import { useFontsReady } from './Post';

const AR = 'Amiri, NotoEmoji';
const UI = 'Plex, NotoEmoji';
const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
export const STORY_FRAMES = 210;
const PHOTO_H = 1000;   // the scene band
const PANEL_Y = 930;    // the ink panel starts under a 70 px fade

/** One scene per question: a Pexels photo (free for commercial use, no attribution required) or, for 4 and 10, the real chat reel. */
/** `zoom` crops the post's own caption strip off the top of a photo (anchored at the bottom edge). */
type BG = { kind: 'image'; src: string; pos?: string; zoom?: number } | { kind: 'video'; src: string; from: number };
const BGS: BG[] = [
  { kind: 'image', src: 'storybg/px01.jpg', pos: '50% 60%' },  // 1  their numbers → regulars outside a Cairo café (Pexels 27520642)
  { kind: 'image', src: 'storybg/px02b.jpg', pos: '50% 45%' }, // 2  how they type → two phones out on the street (Pexels 6146937)
  { kind: 'image', src: 'storybg/px02.jpg', pos: '50% 40%' },  // 3  orders lost with no reply → thumbs on a phone in the dark (Pexels 9799395)
  { kind: 'video', src: 'loop/rR1.mp4', from: 150 },           // 4  a full order → the real full order, live
  { kind: 'image', src: 'storybg/px05.jpg', pos: '50% 50%' },  // 5  lost in the rush → kitchen in the rush, flame up (Pexels 13971183)
  { kind: 'image', src: 'storybg/px06.jpg', pos: '35% 50%' },  // 6  staff learning → a cashier on a touchscreen (Pexels 12935048)
  { kind: 'image', src: 'storybg/px07.jpg', pos: '15% 50%' },  // 7  what the app takes → card terminal and receipts (Pexels 3570240)
  { kind: 'image', src: 'storybg/px08.jpg', pos: '50% 45%' },  // 8  dine-in numbers → a family table at a restaurant (Pexels 36799056)
  { kind: 'image', src: 'storybg/px09.jpg', pos: '50% 50%' },  // 9  big-table bills → hands over the iftar spread (Pexels 20475941)
  { kind: 'video', src: 'loop/rR7.mp4', from: 150 },           // 10 who keeps the number → the returning guest, live
  { kind: 'image', src: 'storybg/px11.jpg', pos: '50% 50%' },  // 11 a clear receipt → a long receipt in hand (Pexels 4968388)
  { kind: 'image', src: 'storybg/px12.jpg', pos: '50% 60%' },  // 12 delivery pricing → Cairo flyovers at night (Pexels 11010692)
  { kind: 'image', src: 'storybg/px13.jpg', pos: '60% 50%' },  // 13 run it from outside → in the car, phone in hand (Pexels 36812491)
  { kind: 'image', src: 'storybg/px14.jpg', pos: '60% 40%' },  // 14 what it understands → a voice note on the street (Pexels 5447314)
];

export const StoryQ: React.FC<{ index?: number }> = ({ index = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ready = useFontsReady();
  const s = STORIES_Q[Math.min(index, STORIES_Q.length - 1)]!;
  const bg = BGS[Math.min(index, BGS.length - 1)]!;
  if (!ready) return <AbsoluteFill style={{ background: C.ink }} />;

  const push = interpolate(frame, [0, STORY_FRAMES], [1.0, 1.08]);
  const settle = spring({ frame, fps, config: { damping: 16, stiffness: 110 }, durationInFrames: 16 });
  const rule = interpolate(frame, [6, 30], [0, 1], clamp);
  const zoneA = interpolate(frame, [14, 34], [0, 1], clamp);
  const zoneY = interpolate(frame, [14, 34], [24, 0], clamp);
  const breathe = 1 + 0.025 * Math.exp(-Math.pow((frame - 100) / 12, 2));   // one pulse around 3.3 s
  const nudge = interpolate(frame, [95, 110, 125], [0, 8, 0], clamp);          // the arrow dips once with it
  const long = s.q.length > 28;
  const label = s.kind === 'Quiz' ? 'جاوب هنا' : s.kind === 'Slider' ? 'اسحب هنا' : 'اختار هنا';

  return (
    <AbsoluteFill style={{ background: C.ink, overflow: 'hidden' }}>
      {/* the scene band */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: PHOTO_H, overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%', transform: `scale(${push})`, transformOrigin: '50% 60%' }}>
          {bg.kind === 'image'
            ? <Img src={staticFile(bg.src)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: bg.pos ?? '50% 50%', transform: `scale(${bg.zoom ?? 1})`, transformOrigin: '50% 100%' }} />
            : <OffthreadVideo src={staticFile(bg.src)} startFrom={bg.from} muted playbackRate={0.8}
                style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 60%', transform: 'scale(1.5)', transformOrigin: '50% 50%' }} />}
        </div>
        {/* a chat reel's phone bezel sits just outside the crop; soft ink at the sides hides what's left of it */}
        {bg.kind === 'video' && <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${C.ink} 0%, rgba(20,17,16,0) 7%, rgba(20,17,16,0) 93%, ${C.ink} 100%)` }} />}
        {/* the foot of the scene melts into the panel; the head is dimmed under Instagram's own bar */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 180, background: `linear-gradient(180deg, rgba(20,17,16,0) 0%, ${C.ink} 100%)` }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 240, background: 'linear-gradient(180deg, rgba(20,17,16,0.55) 0%, rgba(20,17,16,0) 100%)' }} />
      </div>

      {/* the ink panel: question, rule, sticker zone — all inside the safe band */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: PANEL_Y, height: 1500 - PANEL_Y, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '0 64px' }}>
        <Img src={staticFile('20-lockup-horizontal-dark-nobg.svg')} style={{ width: 190, opacity: 1 }} />
        <div style={{ direction: 'rtl', textAlign: 'center', transform: `translateY(${(1 - settle) * 26}px)`, opacity: 0.4 + 0.6 * settle }}>
          <div style={{ fontFamily: AR, fontWeight: 700, fontSize: long ? 84 : 98, lineHeight: 1.28, color: C.semna }}>{s.q}</div>
          <div style={{ width: 150 * rule, height: 6, background: C.brassLight, borderRadius: 3, margin: '20px auto 18px' }} />
          <div style={{ fontFamily: UI, fontSize: 31, lineHeight: 1.55, color: 'rgba(245,239,231,0.8)', maxWidth: 880, margin: '0 auto', opacity: interpolate(frame, [40, 60], [0, 1], clamp) }}>{s.a}</div>
        </div>
        <div style={{ width: 760, height: 190, borderRadius: 28, opacity: zoneA, transform: `translateY(${zoneY}px) scale(${breathe})`,
          border: '2px dashed rgba(217,169,78,0.6)', background: 'rgba(245,239,231,0.05)', display: 'grid', placeItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, direction: 'rtl' }}>
            <div style={{ fontFamily: UI, fontSize: 32, fontWeight: 600, color: 'rgba(245,239,231,0.78)' }}>{label}</div>
            <div style={{ fontFamily: UI, fontSize: 34, color: C.brassLight, transform: `translateY(${nudge}px)` }}>↓</div>
          </div>
        </div>
      </div>

      {/* grain over everything, so the photo and the panel feel like one print */}
      <AbsoluteFill style={{ backgroundImage: `url(${staticFile('loop/grain.png')})`, backgroundSize: '512px 512px', backgroundPosition: `${(frame * 97) % 512}px ${(frame * 61) % 512}px`, mixBlendMode: 'overlay', opacity: 0.18, pointerEvents: 'none' }} />

    </AbsoluteFill>
  );
};
