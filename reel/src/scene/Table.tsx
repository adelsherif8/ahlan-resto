import { useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';
import { useCurrentFrame } from 'remotion';
import { woodTexture, bokehTexture, qrCard } from '../lib/textures';
import { wobble } from '../lib/anim';

const tex = (c: HTMLCanvasElement, srgb = true) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};

export function useWood() {
  return useMemo(() => tex(woodTexture()), []);
}

export function Table({ wood }: { wood: THREE.Texture }) {
  const back = useMemo(() => tex(bokehTexture()), []);
  return (
    <group>
      <mesh position={[0, -0.02, -0.1]} receiveShadow>
        <boxGeometry args={[1.6, 0.04, 1.0]} />
        <meshPhysicalMaterial map={wood} roughness={0.42} clearcoat={0.35} clearcoatRoughness={0.25} />
      </mesh>
      <mesh position={[0, 0.35, -1.3]}>
        <planeGeometry args={[3.6, 2.7]} />
        <meshBasicMaterial map={back} toneMapped={false} color={new THREE.Color(0.9, 0.9, 0.9)} />
      </mesh>
    </group>
  );
}

export function QRStand() {
  const card = useMemo(() => tex(qrCard()), []);
  return (
    <group position={[0, 0, -0.2]}>
      {/* acrylic base */}
      <RoundedBox args={[0.112, 0.012, 0.06]} radius={0.004} position={[0, 0.006, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial color="#e9eef0" roughness={0.08} transmission={0.9} thickness={0.012} ior={1.49} clearcoat={1} />
      </RoundedBox>
      <group position={[0, 0.012, 0]} rotation={[-0.14, 0, 0]}>
        <RoundedBox args={[0.104, 0.152, 0.007]} radius={0.003} position={[0, 0.076, 0]} castShadow>
          <meshPhysicalMaterial color="#f4f7f8" roughness={0.06} transmission={0.9} thickness={0.007} ior={1.49} clearcoat={1} />
        </RoundedBox>
        <mesh position={[0, 0.076, 0.0038]}>
          <planeGeometry args={[0.094, 0.1358]} />
          <meshStandardMaterial map={card} roughness={0.6} color="#d9d4cc" />
        </mesh>
        {/* glossy face sheen */}
        <mesh position={[0, 0.076, 0.0042]}>
          <planeGeometry args={[0.104, 0.152]} />
          <meshPhysicalMaterial transparent opacity={0.06} roughness={0.03} clearcoat={1} metalness={0.2} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

export function Candle() {
  const f = useCurrentFrame();
  const flick = 1 + wobble(f * 3, 9, 0.18);
  return (
    <group position={[0.21, 0, -0.27]}>
      <mesh position={[0, 0.03, 0]} castShadow>
        <cylinderGeometry args={[0.028, 0.026, 0.06, 40, 1, true]} />
        <meshPhysicalMaterial color="#d8a26a" roughness={0.1} transmission={0.85} thickness={0.004} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.016, 0]}>
        <cylinderGeometry args={[0.022, 0.022, 0.03, 32]} />
        <meshStandardMaterial color="#f3e7d3" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.043, 0]} scale={[1, flick, 1]}>
        <coneGeometry args={[0.0042, 0.018, 16]} />
        <meshBasicMaterial color={new THREE.Color(4, 2.2, 0.8)} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 0.06, 0]} color="#ff9a45" intensity={0.035 * flick} distance={0.8} decay={2} />
    </group>
  );
}

export function Napkin() {
  return (
    <group position={[-0.23, 0, -0.08]} rotation={[0, 0.25, 0]}>
      <RoundedBox args={[0.11, 0.006, 0.18]} radius={0.0025} position={[0, 0.003, 0]} receiveShadow castShadow>
        <meshStandardMaterial color="#e9e2d6" roughness={0.95} />
      </RoundedBox>
      {/* fork */}
      <mesh position={[0.012, 0.0075, 0]} castShadow>
        <boxGeometry args={[0.009, 0.002, 0.15]} />
        <meshStandardMaterial color="#c9c9c9" metalness={1} roughness={0.22} />
      </mesh>
      {/* knife */}
      <mesh position={[-0.02, 0.0075, 0.005]} castShadow>
        <boxGeometry args={[0.012, 0.002, 0.16]} />
        <meshStandardMaterial color="#cfcfcf" metalness={1} roughness={0.2} />
      </mesh>
    </group>
  );
}
