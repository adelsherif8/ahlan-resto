/**
 * Loop (video) + LoopStill — see lib/loop.ts for the words and beats, lib/loopGeo.ts for the
 * screen anchors the 3D camera projected.
 *
 * The plate is the Blender render (public/loop/bg-video.mp4): the queue on the wall and the
 * Munadim car doing the run. This layer adds only what must be real text: the Amiri headline, the
 * guest's order popping from the last car in the queue, the bot's real ticket line landing at the
 * restaurant, the lockup and the end card.
 */
import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, MONO } from './lib/brand';
import { LOOP, LOOP_STILL, loopTiming } from './lib/loop';
import { LOOP_GEO } from './lib/loopGeo';
import { PostEnd, useFontsReady } from './Post';

const AR = 'Amiri, NotoEmoji';
const UI = 'Plex, NotoEmoji';
const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

/** A WhatsApp bubble exactly as the app draws it — the guest's green is WhatsApp's own. */
const Bubble: React.FC<{ me: boolean; text: string; time: string; scale?: number; ticks?: boolean }> = ({ me, text, time, scale = 1, ticks = true }) => (
  <div style={{
    background: me ? C.waOut : C.waIn, color: '#111B21', borderRadius: 18 * scale,
    padding: `${14 * scale}px ${18 * scale}px ${10 * scale}px`, fontFamily: UI, fontSize: 34 * scale, lineHeight: 1.45,
    direction: 'rtl', maxWidth: 560 * scale, boxShadow: '0 10px 30px rgba(0,0,0,0.55)', position: 'relative',
  }}>
    <div>{text}</div>
    <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 6 * scale, alignItems: 'center', marginTop: 4 * scale, fontSize: 22 * scale, color: '#667781', direction: 'ltr' }}>
      <span>{time}</span>{me && ticks ? <span style={{ color: '#53BDEB' }}>✓✓</span> : null}
    </div>
  </div>
);

/** A bubble anchored to a point in the plate, with the little tail toward it. */
const Anchored: React.FC<{ x: number; y: number; from: number; children: React.ReactNode; side?: 'left' | 'right'; below?: boolean }> = ({ x, y, from, children, side = 'right', below = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from) return null;
  const p = spring({ frame: frame - from, fps, config: { damping: 13, stiffness: 170 }, durationInFrames: 22 });
  const float = Math.sin((frame - from) / 18) * 4;
  return (
    <div style={{ position: 'absolute', left: x, top: y + float, transform: `translate(${side === 'right' ? '-14%' : '-86%'}, ${below ? '0%' : '-100%'}) scale(${0.6 + 0.4 * p})`, transformOrigin: `${side === 'right' ? '14%' : '86%'} ${below ? '0%' : '100%'}`, opacity: Math.min(1, p * 1.4) }}>
      {children}
      <div style={{ position: 'absolute', [below ? 'top' : 'bottom']: -10, [side === 'right' ? 'left' : 'right']: '12%', width: 0, height: 0, borderLeft: '12px solid transparent', borderRight: '12px solid transparent', [below ? 'borderBottom' : 'borderTop']: `12px solid ${below ? C.waIn : C.waOut}` }} />
    </div>
  );
};

/** `video: true` uses public/loop/bg-video.mp4 (the Blender render) instead of the still plate. */
export const Loop: React.FC<{ video?: boolean }> = ({ video = false }) => {
  const frame = useCurrentFrame();
  const T = loopTiming();
  const fontsReady = useFontsReady();
  if (!fontsReady) return <AbsoluteFill style={{ background: C.ink }} />;

  const zoom = interpolate(frame, [0, T.endStart], [1.0, 1.05], clamp);
  const headA = interpolate(frame, [T.headIn + 6, T.headIn + 28], [0, 1], clamp);
  const headX = (1 - interpolate(frame, [T.headIn + 6, T.headIn + 32], [0, 1], clamp)) * 50;
  const rule = interpolate(frame, [T.headIn + 20, T.headIn + 40], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ background: C.ink, overflow: 'hidden' }}>
      <Audio src={staticFile('sfx/bed.wav')} volume={0.35} />
      <Sequence from={T.orderAt} durationInFrames={30}><Audio src={staticFile('sfx/pop-out.wav')} /></Sequence>
      <Sequence from={T.replyAt} durationInFrames={30}><Audio src={staticFile('sfx/pop-in.wav')} /></Sequence>

      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: '50% 62%' }}>
        {video
          ? <OffthreadVideo src={staticFile('loop/bg-video.mp4')} muted style={{ width: 1080, height: 1920, objectFit: 'cover' }} />
          : <Img src={staticFile('loop/bg-video.jpg')} style={{ width: 1080, height: 1920, objectFit: 'cover' }} />}

        {/* the last car in the queue sends the order */}
        <Anchored x={LOOP_GEO.order.x} y={LOOP_GEO.order.y} from={T.orderAt} side="right">
          <Bubble me text={LOOP.order} time={LOOP.orderTime} scale={0.8} />
        </Anchored>
        {/* the restaurant's real ticket line lands as the Munadim car arrives */}
        {/* hangs below the sign, tail up at the restaurant — the headline owns the top band */}
        <Anchored x={LOOP_GEO.top.x + 40} y={LOOP_GEO.top.y + 300} from={T.replyAt} side="right" below>
          <Bubble me={false} text={LOOP.reply} time={LOOP.replyTime} scale={0.8} />
        </Anchored>
      </AbsoluteFill>

      {/* readable top band for the headline: an ink gradient, never a flat box */}
      <div style={{ position: 'absolute', inset: '0 0 auto 0', height: 520, background: 'linear-gradient(180deg, rgba(20,17,16,0.92) 0%, rgba(20,17,16,0.55) 55%, rgba(20,17,16,0) 100%)' }} />
      <div style={{ position: 'absolute', top: 120, left: 70, right: 70, direction: 'rtl', textAlign: 'right' }}>
        <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 92, lineHeight: 1.36, color: C.semna, opacity: headA, transform: `translateX(${headX}px)` }}>{LOOP.headline}</div>
        <div style={{ width: 140 * rule, height: 6, background: C.karkadeh, borderRadius: 3, margin: '34px 0 22px', marginInlineStart: 0 }} />
        <div style={{ fontFamily: UI, fontSize: 30, color: 'rgba(245,239,231,0.7)', direction: 'ltr', textAlign: 'right', opacity: rule }}>{LOOP.english}</div>
      </div>

      {/* bottom: the horizontal lockup on an ink fade */}
      <div style={{ position: 'absolute', inset: 'auto 0 0 0', height: 300, background: 'linear-gradient(0deg, rgba(20,17,16,0.95) 0%, rgba(20,17,16,0) 100%)' }} />
      <Img src={staticFile('20-lockup-horizontal-dark-nobg.svg')} style={{ position: 'absolute', left: 70, bottom: 80, width: 300, opacity: interpolate(frame, [20, 44], [0, 1], clamp) }} />
      <div style={{ position: 'absolute', right: 70, bottom: 92, fontFamily: MONO, color: C.brassLight, fontSize: 30, letterSpacing: 2, opacity: interpolate(frame, [28, 52], [0, 1], clamp) }}>01022034603</div>

      <PostEnd frame={frame} endStart={T.endStart} payoff={LOOP.payoff} />
    </AbsoluteFill>
  );
};

/** The mark on its solid ink panel — the one way a logo may sit on a photograph. */
const SignMark: React.FC<{ x: number; y: number; w: number; h: number; a?: number }> = ({ x, y, w, h, a = 1 }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, background: C.ink, borderRadius: 10, display: 'grid', placeItems: 'center', opacity: a, boxShadow: '0 0 40px rgba(185,132,50,0.25)' }}>
    <Img src={staticFile('01-mark-fine-brass-on-ink-nobg.svg')} style={{ width: w * 0.72 }} />
  </div>
);

/** 4:5 still — the plate with the chat on the giant phone, the mark on the sign, headline on top. */
export const LoopStill: React.FC = () => {
  const fontsReady = useFontsReady();
  if (!fontsReady) return <AbsoluteFill style={{ background: C.ink }} />;
  const S = LOOP_STILL;
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: 'hidden' }}>
      <Img src={staticFile('loop/bg-still.jpg')} style={{ width: 1080, height: 1350, objectFit: 'cover' }} />
      <div style={{ position: 'absolute', left: S.screen.x, top: S.screen.y, width: S.screen.w, height: S.screen.h, background: C.waBg, borderRadius: 26, overflow: 'hidden', padding: 18, display: 'flex', flexDirection: 'column', gap: 14, direction: 'rtl', boxShadow: 'inset 0 0 60px rgba(0,0,0,0.25)' }}>
        <div style={{ background: '#F6F6F6', margin: -18, marginBottom: 6, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #E0E0E0' }}>
          <Img src={staticFile('avatar-whatsapp.svg')} style={{ width: 40, height: 40, borderRadius: 20 }} />
          <div style={{ fontFamily: UI, fontSize: 24, fontWeight: 600, color: '#111B21' }}>مُنادم</div>
        </div>
        {S.thread.map((b, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: b.me ? 'flex-end' : 'flex-start' }}>
            <Bubble me={b.me} text={b.text} time={b.time} scale={0.62} />
          </div>
        ))}
      </div>
      <SignMark {...S.sign} />
      <div style={{ position: 'absolute', inset: '0 0 auto 0', height: 420, background: 'linear-gradient(180deg, rgba(20,17,16,0.92) 0%, rgba(20,17,16,0.5) 55%, rgba(20,17,16,0) 100%)' }} />
      <div style={{ position: 'absolute', top: 90, left: 70, right: 70, direction: 'rtl', textAlign: 'right' }}>
        <div style={{ fontFamily: AR, fontWeight: 700, fontSize: 84, lineHeight: 1.36, color: C.semna }}>{S.headline}</div>
        <div style={{ width: 140, height: 6, background: C.karkadeh, borderRadius: 3, margin: '30px 0 18px' }} />
        <div style={{ fontFamily: UI, fontSize: 28, color: 'rgba(245,239,231,0.7)', direction: 'ltr', textAlign: 'right' }}>{S.english}</div>
      </div>
      <div style={{ position: 'absolute', inset: 'auto 0 0 0', height: 240, background: 'linear-gradient(0deg, rgba(20,17,16,0.95) 0%, rgba(20,17,16,0) 100%)' }} />
      <Img src={staticFile('20-lockup-horizontal-dark-nobg.svg')} style={{ position: 'absolute', left: 70, bottom: 64, width: 280 }} />
      <div style={{ position: 'absolute', right: 70, bottom: 74, fontFamily: MONO, color: C.brassLight, fontSize: 28, letterSpacing: 2 }}>01022034603</div>
    </AbsoluteFill>
  );
};
