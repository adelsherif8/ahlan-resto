import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useCurrentFrame } from 'remotion';
import { prog, easeOut, easeIn, easeOutBack, lerp, smooth, rng, clamp } from '../lib/anim';
import { T, ITEMS, cam } from '../lib/timeline';
import { Bubble, M, glowFor, scanlines, typingBubble, drawTypingDots } from '../lib/textures';
import { C } from '../lib/brand';
import { phoneAt, PD } from './Phone';

const S = 0.00019; // metres per canvas px
const COL = 0.172;
const GAP = 0.0075;
const BASE = 0.03; // first bubble bottom above the screen
const TOP = 0.3; // fade out above this

const HOLO = new THREE.Color(C.holo);

function canvasTex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const beamVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const beamFrag = `varying vec2 vUv; uniform float uI; uniform float uT; uniform vec3 uC;
void main(){
  float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.6) * 0.09 * uI;
  float s = 0.75 + 0.25 * sin(vUv.y * 90.0 - uT * 0.25);
  float edge = 0.6 + 0.4 * sin(vUv.x * 6.2831 * 9.0 + uT * 0.05);
  gl_FragColor = vec4(uC * 1.6, a * s * edge);
}`;

export function Holo({ bubbles }: { bubbles: Bubble[] }) {
  const f = useCurrentFrame();

  const typing = useMemo(() => {
    const b = typingBubble();
    return { b, t: canvasTex(b.c) };
  }, []);
  const scan = useMemo(() => {
    const t = canvasTex(scanlines());
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 6);
    return t;
  }, []);
  const mats = useMemo(
    () =>
      ITEMS.map((it) => {
        const b = it.msg < 0 ? typing.b : bubbles[it.msg];
        const map = it.msg < 0 ? typing.t : canvasTex(b.c);
        const glow = canvasTex(glowFor(b));
        return { b, map, glow };
      }),
    [bubbles, typing],
  );
  const beamMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: beamVert,
        fragmentShader: beamFrag,
        uniforms: { uI: { value: 0 }, uT: { value: 0 }, uC: { value: HOLO.clone() } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );

  // particles
  const N = 60;
  const pdata = useMemo(() => {
    const R = rng(5);
    return Array.from({ length: N }, () => ({ a: R() * Math.PI * 2, r: 0.01 + R() * 0.07, sp: 0.4 + R() * 0.9, ph: R(), sz: R() }));
  }, []);
  const pgeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    return g;
  }, []);
  const dot = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);

  const on = prog(f, T.rise[1] - 8, T.rise[1] + 12) * (1 - easeIn(prog(f, T.collapse[0], T.collapse[1])));
  const collapse = easeIn(prog(f, T.collapse[0], T.collapse[1] - 4));

  useLayoutEffect(() => {
    drawTypingDots(typing.b, f);
    typing.t.needsUpdate = true;
    scan.offset.y = -f * 0.02;
    beamMat.uniforms.uI.value = on;
    beamMat.uniforms.uT.value = f;
    const p = pgeo.attributes.position as THREE.BufferAttribute;
    pdata.forEach((d, i) => {
      const t = (d.ph + (f / 30) * 0.18 * d.sp) % 1;
      const ang = d.a + t * 2.0;
      const rad = d.r * (0.6 + t * 0.9);
      p.setXYZ(i, Math.cos(ang) * rad, t * 0.3, Math.sin(ang) * rad);
    });
    p.needsUpdate = true;
  });

  if (f < T.rise[1] - 10 || f > T.collapse[1] + 2) return null;

  // anchor at the phone screen, turned to face the camera around Y
  const ph = phoneAt(f);
  const c = cam(f);
  const origin: [number, number, number] = [ph.pos[0], ph.pos[1] + PD / 2 + 0.001, ph.pos[2]];
  const yaw = Math.atan2(c.pos[0] - origin[0], c.pos[2] - origin[2]);
  const midY = origin[1] + 0.15;
  const pitch = -Math.atan2(c.pos[1] - midY, Math.hypot(c.pos[0] - origin[0], c.pos[2] - origin[2])) * 0.7;

  // layout: newest item sits at the bottom, older ones are pushed up
  const space = ITEMS.map((it) => {
    const inP = easeOut(prog(f, it.in, it.in + 12));
    const outP = it.out ? easeOut(prog(f, it.out - 2, it.out + 6)) : 0;
    return inP * (1 - outP);
  });
  const H = mats.map((m) => m.b.h * S);

  return (
    <group position={origin}>
      <group rotation={[0, yaw, 0]}>
        {/* beam */}
        <mesh position={[0, 0.16, 0]} material={beamMat}>
          <cylinderGeometry args={[0.1, 0.034, 0.32, 64, 1, true]} />
        </mesh>
        <points geometry={pgeo}>
          <pointsMaterial
            map={dot}
            size={0.0028}
            color={HOLO.clone().multiplyScalar(2)}
            transparent
            opacity={0.7 * on}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </points>
        <pointLight position={[0, 0.04, 0]} color={C.holo} intensity={0.06 * on} distance={0.6} decay={2} />
        <group rotation={[pitch, 0, 0]}>
          {ITEMS.map((it, i) => {
            if (f < it.in) return null;
            if (it.out && f > it.out + 6) return null;
            const m = mats[i];
            let above = 0;
            for (let j = i + 1; j < ITEMS.length; j++) above += space[j] * (H[j] + GAP);
            const target = BASE + above + H[i] / 2;
            const e = prog(f, it.in, it.in + 14);
            let y = lerp(0.004, target, easeOut(e));
            let sc = lerp(0.18, 1, easeOutBack(e));
            const top = y + H[i] / 2;
            let a = clamp(e * 1.6) * (1 - smooth(TOP - 0.05, TOP, top));
            if (it.out) a *= 1 - prog(f, it.out - 2, it.out + 4);
            // birth flicker
            if (e < 1) a *= 0.55 + 0.45 * (Math.sin(f * 9.1 + i * 3) > -0.3 ? 1 : 0);
            y *= 1 - collapse;
            sc *= 1 - collapse * 0.9;
            a *= 1 - collapse * 0.5;
            if (a <= 0.003) return null;
            const w = m.b.w * S;
            const x = m.b.me ? -COL / 2 + w / 2 : COL / 2 - w / 2;
            const fw = (m.b.w + M * 2) * S, fh = (m.b.h + M * 2) * S;
            // gentle float per bubble
            const drift = Math.sin(f * 0.05 + i) * 0.0012;
            return (
              <group key={i} position={[x * (1 - collapse), y + drift, 0]} scale={sc}>
                <mesh renderOrder={10 + i}>
                  <planeGeometry args={[fw, fh]} />
                  <meshBasicMaterial map={m.glow} transparent opacity={a * 0.9} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} color={new THREE.Color(1.7, 1.7, 1.7)} />
                </mesh>
                <mesh renderOrder={11 + i} position={[0, 0, 0.0004]}>
                  <planeGeometry args={[fw, fh]} />
                  <meshBasicMaterial map={m.map} transparent opacity={a * 0.96} depthWrite={false} toneMapped={false} color={new THREE.Color(0.88, 0.95, 0.92)} />
                </mesh>
                <mesh renderOrder={12 + i} position={[0, 0, 0.0008]}>
                  <planeGeometry args={[m.b.w * S, m.b.h * S]} />
                  <meshBasicMaterial map={scan} transparent opacity={a * 0.07} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} color={HOLO} />
                </mesh>
              </group>
            );
          })}
        </group>
      </group>
    </group>
  );
}
