import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useCurrentFrame } from 'remotion';
import { cam } from '../lib/timeline';

export function Env() {
  const { gl, scene } = useThree();
  useLayoutEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.22;
    scene.background = new THREE.Color('#060403');
    return () => {
      env.dispose();
      pm.dispose();
    };
  }, [gl, scene]);
  return null;
}

export function Rig() {
  const f = useCurrentFrame();
  const { camera } = useThree();
  const c = cam(f);
  useLayoutEffect(() => {
    const pc = camera as THREE.PerspectiveCamera;
    pc.position.set(...c.pos);
    pc.fov = c.fov;
    pc.near = 0.01;
    pc.far = 20;
    pc.lookAt(...c.tgt);
    pc.updateProjectionMatrix();
  });
  return null;
}
