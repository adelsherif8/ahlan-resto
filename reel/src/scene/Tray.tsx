import { useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';
import { useCurrentFrame } from 'remotion';
import { prog, easeOut, lerp, rng } from '../lib/anim';
import { T } from '../lib/timeline';
import { checkerTexture } from '../lib/textures';

const BUN = '#C47F33';

function Burger() {
  const seeds = useMemo(() => {
    const R = rng(4);
    return Array.from({ length: 34 }, () => {
      const th = R() * Math.PI * 2, ph = 0.15 + R() * 0.9;
      return { th, ph, rot: R() * Math.PI };
    });
  }, []);
  const lettuce = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.053, 0.053, 0.004, 64, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const r = Math.hypot(x, z);
      if (r > 0.04) {
        const k = 1 + 0.08 * Math.sin(a * 11) + 0.05 * Math.sin(a * 23);
        p.setX(i, x * k);
        p.setZ(i, z * k);
        p.setY(i, p.getY(i) + 0.004 * Math.sin(a * 7));
      }
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const R = 0.048;
  return (
    <group>
      {/* bottom bun */}
      <mesh position={[0, 0.009, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[R * 0.96, R * 0.9, 0.018, 48]} />
        <meshPhysicalMaterial color={BUN} roughness={0.55} />
      </mesh>
      {/* patty */}
      <mesh position={[0, 0.026, 0]} castShadow>
        <cylinderGeometry args={[R * 1.03, R * 1.01, 0.017, 48]} />
        <meshStandardMaterial color="#3d2213" roughness={0.95} />
      </mesh>
      {/* cheese */}
      <mesh position={[0, 0.0355, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <boxGeometry args={[0.083, 0.003, 0.083]} />
        <meshPhysicalMaterial color="#F0A92A" roughness={0.35} clearcoat={0.4} />
      </mesh>
      {/* tomato */}
      <mesh position={[0, 0.04, 0]} castShadow>
        <cylinderGeometry args={[R * 0.9, R * 0.9, 0.006, 40]} />
        <meshPhysicalMaterial color="#B3261E" roughness={0.3} clearcoat={0.6} />
      </mesh>
      {/* lettuce */}
      <mesh geometry={lettuce} position={[0, 0.045, 0]} castShadow>
        <meshStandardMaterial color="#5E9B35" roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      {/* top bun */}
      <mesh position={[0, 0.047, 0]} scale={[1, 0.68, 1]} castShadow>
        <sphereGeometry args={[R * 1.02, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial color={BUN} roughness={0.38} clearcoat={0.55} clearcoatRoughness={0.3} />
      </mesh>
      {seeds.map((s, i) => {
        const r = R * 1.02;
        const x = r * Math.sin(s.ph) * Math.cos(s.th);
        const z = r * Math.sin(s.ph) * Math.sin(s.th);
        const y = 0.047 + r * Math.cos(s.ph) * 0.68;
        return (
          <mesh key={i} position={[x, y, z]} rotation={[0, s.rot, 0]} scale={[1, 0.45, 0.6]}>
            <sphereGeometry args={[0.0028, 8, 6]} />
            <meshStandardMaterial color="#F3E3BD" roughness={0.6} />
          </mesh>
        );
      })}
    </group>
  );
}

function Fries() {
  const liner = useMemo(() => {
    const t = new THREE.CanvasTexture(checkerTexture());
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 1);
    return t;
  }, []);
  const sticks = useMemo(() => {
    const R = rng(9);
    return Array.from({ length: 46 }, () => ({
      x: (R() - 0.5) * 0.055,
      z: (R() - 0.5) * 0.055,
      h: 0.06 + R() * 0.035,
      rx: (R() - 0.5) * 0.5,
      rz: (R() - 0.5) * 0.5,
      tone: R(),
    }));
  }, []);
  return (
    <group>
      <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.045, 0.034, 0.06, 40, 1, true]} />
        <meshStandardMaterial map={liner} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.001, 0]}>
        <cylinderGeometry args={[0.034, 0.034, 0.002, 32]} />
        <meshStandardMaterial color="#B3202A" />
      </mesh>
      {sticks.map((s, i) => (
        <mesh key={i} position={[s.x, s.h / 2 + 0.012, s.z]} rotation={[s.rx, 0, s.rz]} castShadow>
          <boxGeometry args={[0.0075, s.h, 0.0075]} />
          <meshStandardMaterial color={s.tone > 0.5 ? '#E6A93D' : '#D99A2E'} roughness={0.55} />
        </mesh>
      ))}
      {/* cheddar drizzle */}
      <mesh position={[0, 0.072, 0]} scale={[1, 0.25, 1]}>
        <sphereGeometry args={[0.03, 24, 12]} />
        <meshPhysicalMaterial color="#F2A51F" roughness={0.25} clearcoat={0.8} transparent opacity={0.92} />
      </mesh>
    </group>
  );
}

function Karkadeh() {
  return (
    <group>
      <mesh position={[0, 0.055, 0]} castShadow>
        <cylinderGeometry args={[0.031, 0.028, 0.11, 48, 1, true]} />
        <meshPhysicalMaterial color="#ffffff" roughness={0.04} transmission={1} thickness={0.003} ior={1.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.042, 0]}>
        <cylinderGeometry args={[0.0285, 0.026, 0.08, 48]} />
        <meshPhysicalMaterial color="#8C1D2F" roughness={0.08} transmission={0.55} thickness={0.05} attenuationColor="#5a0714" attenuationDistance={0.03} clearcoat={1} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[(i - 1) * 0.011, 0.078 + (i % 2) * 0.004, (i % 2 ? 1 : -1) * 0.006]} rotation={[i, i * 0.7, 0.3]}>
          <boxGeometry args={[0.014, 0.014, 0.014]} />
          <meshPhysicalMaterial color="#ffffff" roughness={0.1} transmission={0.9} thickness={0.01} />
        </mesh>
      ))}
      {/* straw */}
      <mesh position={[0.012, 0.09, 0]} rotation={[0, 0, -0.18]}>
        <cylinderGeometry args={[0.0028, 0.0028, 0.13, 12]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.4} />
      </mesh>
    </group>
  );
}

export function Tray({ wood }: { wood: THREE.Texture }) {
  const f = useCurrentFrame();
  const e = easeOut(prog(f, T.tray[0], T.tray[1]));
  const x = lerp(0.62, 0.035, e);
  const lift = Math.sin(Math.PI * prog(f, T.tray[1] - 12, T.tray[1])) * 0.004 * (1 - e) + (1 - e) * 0.01;
  const ry = lerp(-0.35, -0.06, e);
  const boardMat = useMemo(() => {
    const t = wood.clone();
    t.needsUpdate = true;
    t.repeat.set(0.35, 0.3);
    return t;
  }, [wood]);
  if (f < T.tray[0]) return null;
  return (
    <group position={[x, lift, 0.0]} rotation={[0, ry, 0]}>
      <RoundedBox args={[0.3, 0.018, 0.2]} radius={0.006} position={[0, 0.009, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial map={boardMat} color="#c9a27a" roughness={0.6} clearcoat={0.2} />
      </RoundedBox>
      {/* paper liner */}
      <mesh position={[0.03, 0.0185, 0.005]} rotation={[-Math.PI / 2, 0, 0.12]} receiveShadow>
        <planeGeometry args={[0.15, 0.15]} />
        <meshStandardMaterial color="#efe4cf" roughness={0.95} />
      </mesh>
      <group position={[0.035, 0.019, 0.005]}>
        <Burger />
      </group>
      <group position={[-0.085, 0.018, -0.045]}>
        <Fries />
      </group>
      <group position={[-0.1, 0.018, 0.055]}>
        <Karkadeh />
      </group>
    </group>
  );
}
