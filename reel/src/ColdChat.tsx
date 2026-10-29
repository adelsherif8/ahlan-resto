/**
 * ColdChat — a real-looking kitchen shot as the cold open, then an existing chat reel.
 * Measured 24 Oct: live-action openings hold 7-8 s, screen/text openings ~2 s.
 * The kitchen's own sound plays under the hook; the reel keeps its audio after the cut.
 */
import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, interpolate, useCurrentFrame, CalculateMetadataFunction } from 'remotion';
import { ColdBeat } from './Kinetic';
import { useFontsReady } from './Post';
import { C } from './lib/brand';

export type ColdChatProps = { clip: string; clipFrom: number; text: string; coldFrames: number; reel: string; reelFrames: number; reelFrom?: number; zoom?: number };

export const coldChatMeta: CalculateMetadataFunction<ColdChatProps> = ({ props }) => ({ durationInFrames: props.coldFrames + props.reelFrames - (props.reelFrom ?? 0) });

export const ColdChat: React.FC<ColdChatProps> = ({ clip, clipFrom, text, coldFrames, reel, reelFrom = 0, zoom = 1 }) => {
  const frame = useCurrentFrame();
  const ready = useFontsReady();
  if (!ready) return <AbsoluteFill style={{ background: C.ink }} />;
  const out = interpolate(frame, [coldFrames - 6, coldFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Sequence durationInFrames={coldFrames}>
        <AbsoluteFill style={{ opacity: out }}>
          <ColdBeat b={{ k: 'cold', src: clip, text, d: coldFrames }} f={frame} startFrom={clipFrom} sound zoom={zoom} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={coldFrames}>
        {/* skip the reel's own empty-phone build-up so the cut lands on the first message */}
        <OffthreadVideo src={staticFile(reel)} startFrom={reelFrom} />
      </Sequence>
    </AbsoluteFill>
  );
};
