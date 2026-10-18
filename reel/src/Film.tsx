/** Film — the six-shot «الطابور» cut. See lib/film.ts. */
import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, MONO } from './lib/brand';
import { FILM, SHOTS, SHOT_FRAMES, filmTiming } from './lib/film';
import { PostEnd, useFontsReady } from './Post';

const AR = 'Amiri, NotoEmoji';
const UI = 'Plex, NotoEmoji';
const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

const Bubble: React.FC<{ me: boolean; text: string; time: string }> = ({ me, text, time }) => (
  <div style={{ background: me ? C.waOut : C.waIn, color: '#111B21', borderRadius: 18, padding: '16px 20px 11px', fontFamily: UI, fontSize: 36, lineHeight: 1.45,
    direction: 'rtl', maxWidth: 640, boxShadow: '0 14px 40px rgba(0,0,0,0.6)' }}>
    <div>{text}</div>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, fontSize: 22, color: '#667781', direction: 'ltr' }}>
      <span>{time}</span>{me ? <span style={{ color: '#53BDEB' }}>✓✓</span> : null}
    </div>
  </div>
);

/** A bubble that pops at `from` and leaves at `until`, pinned to a frame position. */
const Pop: React.FC<{ from: number; until: number; x: number; y: number; children: React.ReactNode }> = ({ from, until, x, y, children }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  if (frame < from || frame >= until) return null;
  const p = spring({ frame: frame - from, fps, config: { damping: 13, stiffness: 170 }, durationInFrames: 22 });
  const out = interpolate(frame, [until - 8, until], [1, 0], clamp);
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `scale(${0.7 + 0.3 * p})`, transformOrigin: '50% 100%', opacity: Math.min(1, p * 1.4) * out }}>
      {children}
    </div>
  );
};

export const Film: React.FC = () => {
  const frame = useCurrentFrame();
  const T = filmTiming();
  const fontsReady = useFontsReady();
  if (!fontsReady) return <AbsoluteFill style={{ background: C.ink }} />;

  const headA = interpolate(frame, [T.headIn, T.headIn + 22], [0, 1], clamp) * interpolate(frame, [T.headOut - 10, T.headOut], [1, 0], clamp);
  const headX = (1 - interpolate(frame, [T.headIn, T.headIn + 26], [0, 1], clamp)) * 50;
  const rule = interpolate(frame, [T.headIn + 14, T.headIn + 34], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ background: C.ink, overflow: 'hidden' }}>
      <Audio src={staticFile('sfx/bed.wav')} volume={0.35} />
      <Sequence from={T.orderAt} durationInFrames={30}><Audio src={staticFile('sfx/pop-out.wav')} /></Sequence>
      <Sequence from={T.replyAt} durationInFrames={30}><Audio src={staticFile('sfx/pop-in.wav')} /></Sequence>

      {SHOTS.map((n) => (
        <Sequence key={n} from={T.shotStart(n)} durationInFrames={SHOT_FRAMES} layout="none">
          <OffthreadVideo src={staticFile(`loop/shot-${n}.mp4`)} muted playbackRate={0.8} style={{ position: 'absolute', inset: 0, width: 1080, height: 1920, objectFit: 'cover' }} />
          {/* a 6-frame dip to ink between shots, so the cuts feel edited, not pasted */}
          <AbsoluteFill style={{ background: C.ink, opacity: interpolate(frame - T.shotStart(n), [0, 6, SHOT_FRAMES - 6, SHOT_FRAMES], [1, 0, 0, 1], clamp), pointerEvents: 'none' }} />
        </Sequence>
      ))}

      {/* headline over shot 1 */}
      <div style={{ position: 'absolute', inset: '0 0 auto 0', height: 520, background: 'linear-gradient(180deg, rgba(20,17,16,0.9) 0%, rgba(20,17,16,0.5) 55%, rgba(20,17,16,0) 100%)', opacity: headA }} />
      <div style={{ position: 'absolute', top: 120, left: 70, right: 70, direction: 'rtl', textAlign: 'right', opacity: headA }}>
        <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 92, lineHeight: 1.36, color: C.semna, transform: `translateX(${headX}px)` }}>{FILM.headline}</div>
        <div style={{ width: 140 * rule, height: 6, background: C.karkadeh, borderRadius: 3, margin: '34px 0 22px', marginInlineStart: 0 }} />
        <div style={{ fontFamily: UI, fontSize: 30, color: 'rgba(245,239,231,0.7)', direction: 'ltr', textAlign: 'right' }}>{FILM.english}</div>
      </div>

      {/* the guest's real order, over the phone on the dash (shot 2) */}
      <Pop from={T.orderAt} until={T.orderOut} x={200} y={1180}><Bubble me text={FILM.order} time={FILM.orderTime} /></Pop>
      {/* the bot's real ticket line, as the bag lands (shot 3) */}
      <Pop from={T.replyAt} until={T.replyOut} x={120} y={330}><Bubble me={false} text={FILM.reply} time={FILM.replyTime} /></Pop>

      {/* lockup + number, always */}
      <div style={{ position: 'absolute', inset: 'auto 0 0 0', height: 260, background: 'linear-gradient(0deg, rgba(20,17,16,0.9) 0%, rgba(20,17,16,0) 100%)' }} />
      <Img src={staticFile('20-lockup-horizontal-dark-nobg.svg')} style={{ position: 'absolute', left: 70, bottom: 80, width: 300, opacity: interpolate(frame, [20, 44], [0, 1], clamp) }} />
      <div style={{ position: 'absolute', right: 70, bottom: 92, fontFamily: MONO, color: C.brassLight, fontSize: 30, letterSpacing: 2, opacity: interpolate(frame, [28, 52], [0, 1], clamp) }}>01022034603</div>

      <PostEnd frame={frame} endStart={T.endStart} payoff={FILM.payoff} />
    </AbsoluteFill>
  );
};
