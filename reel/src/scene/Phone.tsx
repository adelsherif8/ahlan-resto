import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';
import { useCurrentFrame } from 'remotion';
import { track, prog, easeOut, easeInOut, wobble, clamp } from '../lib/anim';
import { T, ITEMS } from '../lib/timeline';
import { mk, SW, SH, drawPhoneScreen, Bubble } from '../lib/textures';

import { phoneAt, PW, PH, PD } from './phonePose';
export { phoneAt, PW, PH, PD };
const HALF = Math.PI / 2;

function roundedRectGeo(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ShapeGeometry(s, 16);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - x) / w, (p.getY(i) - y) / h);
  return g;
}

export function Phone({ card, bubbles }: { card: HTMLCanvasElement; bubbles: Bubble[] }) {
  const f = useCurrentFrame();
  const { pos, rot } = phoneAt(f);
  const screen = useMemo(() => {
    const { c, ctx } = mk(SW, SH);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return { c, ctx, t };
  }, []);
  const chatCanvas = useMemo(() => mk(SW, SH), []);
  const geo = useMemo(() => roundedRectGeo(PW - 0.004, PH - 0.004, 0.0085), []);
  const front = useMemo(() => roundedRectGeo(PW - 0.0012, PH - 0.0012, 0.0095), []);

  useLayoutEffect(() => {
    const { ctx, t } = screen;
    drawPhoneScreen(ctx, chatCanvas.ctx, f, card, bubbles);
    t.needsUpdate = true;
  });

  const bright = 0.92;
  return (
    <group position={pos} rotation={rot}>
      <RoundedBox args={[PW, PH, PD]} radius={0.0095} smoothness={6} castShadow receiveShadow>
        <meshPhysicalMaterial color="#3a3a3d" metalness={0.9} roughness={0.32} clearcoat={0.3} />
      </RoundedBox>
      <mesh geometry={front} position={[0, 0, PD / 2 + 0.0001]}>
        <meshPhysicalMaterial color="#050505" roughness={0.05} clearcoat={1} />
      </mesh>
      <mesh geometry={geo} position={[0, 0, PD / 2 + 0.0003]}>
        <meshBasicMaterial map={screen.t} toneMapped={false} color={new THREE.Color(bright, bright, bright)} />
      </mesh>
      {/* glass reflection layer */}
      <mesh geometry={geo} position={[0, 0, PD / 2 + 0.0005]}>
        <meshPhysicalMaterial transparent opacity={0.1} roughness={0.02} metalness={0.6} clearcoat={1} depthWrite={false} />
      </mesh>
      {/* camera bump */}
      <group position={[-0.017, 0.052, -PD / 2 - 0.0012]}>
        <RoundedBox args={[0.03, 0.03, 0.0024]} radius={0.006} castShadow>
          <meshPhysicalMaterial color="#3a3a3d" metalness={0.85} roughness={0.25} clearcoat={0.6} />
        </RoundedBox>
        {[
          [-0.0068, 0.0068],
          [-0.0068, -0.0068],
          [0.0072, 0],
        ].map(([x, y], i) => (
          <mesh key={i} position={[x, y, -0.0014]} rotation={[HALF, 0, 0]}>
            <cylinderGeometry args={[0.0048, 0.0048, 0.0014, 32]} />
            <meshPhysicalMaterial color="#0b0b0e" metalness={0.5} roughness={0.08} clearcoat={1} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
