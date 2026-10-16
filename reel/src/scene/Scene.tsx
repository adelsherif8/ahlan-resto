import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { continueRender, delayRender } from 'remotion';
import * as THREE from 'three';
import { useCurrentFrame } from 'remotion';
import { EffectComposer, Bloom, DepthOfField, Vignette, Noise, ToneMapping, ChromaticAberration } from '@react-three/postprocessing';
import { ToneMappingMode, BlendFunction } from 'postprocessing';
import { Env, Rig } from './Env';
import { Table, QRStand, Candle, Napkin, useWood } from './Table';
import { Phone } from './Phone';
import { Holo } from './Holo';
import { Tray } from './Tray';
import { bubble, qrCard, SCRIPT } from '../lib/textures';
import { cam } from '../lib/timeline';
import { track } from '../lib/anim';

function Lights() {
  return (
    <>
      <spotLight
        position={[0.08, 1.05, 0.35]}
        angle={0.62}
        penumbra={0.95}
        intensity={5.5}
        decay={2}
        color="#ffd2a1"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-radius={6}
        target-position={[0, 0, -0.05]}
      />
      <directionalLight position={[-0.6, 0.5, -1.2]} intensity={0.9} color="#a9c4ff" />
      <hemisphereLight args={['#3a2a1e', '#0a0605', 0.35]} />
    </>
  );
}

/** Render one extra pass per frame so the effect composer has a settled frame before capture. */
function Settle() {
  const f = useCurrentFrame();
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    const h = delayRender(`settle ${f}`);
    let id = requestAnimationFrame(() => {
      advance(performance.now());
      id = requestAnimationFrame(() => {
        advance(performance.now());
        continueRender(h);
      });
    });
    return () => {
      cancelAnimationFrame(id);
      continueRender(h);
    };
  }, [f, advance]);
  return null;
}

function Effects({ only }: { only?: string }) {
  const has = (k: string) => !only || only.split(',').includes(k);
  const f = useCurrentFrame();
  const focus = useMemo(() => new THREE.Vector3(), []);
  focus.set(...cam(f).focus);
  // lighter lens blur while the hologram text is on screen
  const bokeh = track(f, [[150, 3.5], [175, 1.6], [495, 1.6], [520, 3.5]]);
  return (
    <EffectComposer multisampling={4}>
      <>{has('dof') && <DepthOfField target={focus} worldFocusRange={0.3} bokehScale={bokeh} />}</>
      <>{has('bloom') && <Bloom mipmapBlur intensity={0.8} luminanceThreshold={1.0} luminanceSmoothing={0.1} />}</>
      <>{has('tm') && <ToneMapping mode={ToneMappingMode.NEUTRAL} />}</>
      <>{has('ca') && <ChromaticAberration offset={new THREE.Vector2(0.0005, 0.0004)} radialModulation modulationOffset={0.3} />}</>
      <>{has('vig') && <Vignette offset={0.28} darkness={0.62} />}</>
      <>{has('noise') && <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.12} />}</>
    </EffectComposer>
  );
}

export function Scene({ fx = true, only }: { fx?: boolean; only?: string }) {
  const wood = useWood();
  const card = useMemo(() => qrCard(), []);
  const bubbles = useMemo(() => SCRIPT.map(bubble), []);
  return (
    <>
      <Env />
      <Rig />
      <Lights />
      <Table wood={wood} />
      <QRStand />
      <Candle />
      <Napkin />
      <Phone card={card} bubbles={bubbles} />
      <Holo bubbles={bubbles} />
      <Tray wood={wood} />
      {fx && <Effects only={only} />}
      <Settle />
    </>
  );
}
