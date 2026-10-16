import { track, prog, easeOut, easeInOut, clamp } from '../lib/anim';
import { T } from '../lib/timeline';

export const PW = 0.0715, PH = 0.147, PD = 0.0082;
type V3 = [number, number, number];
const HALF = Math.PI / 2;

/** phone pose for frame f: resting on the table -> lifts and floats flat -> lands beside the food */
export function phoneAt(f: number): { pos: V3; rot: V3 } {
  const restPos: V3 = [0.0, PD / 2, 0.07];
  const restRot: V3 = [-HALF, 0, 0.34];
  const floatPos: V3 = [0, 0.17, 0.05];
  const floatRot: V3 = [-HALF, 0, 0];
  const landPos: V3 = [-0.16, PD / 2, 0.13];
  const landRot: V3 = [-HALF, 0, 0.5];
  let pos: V3, rot: V3;
  if (f < T.phoneLand[0]) {
    const mid: V3 = [0.0, 0.11, 0.07];
    pos = track(f, [[T.rise[0], restPos], [T.rise[0] + 24, mid], [T.rise[1], floatPos]], easeInOut);
    rot = track(f, [[T.rise[0], restRot], [T.rise[1], floatRot]], easeInOut);
    const k = clamp((f - T.rise[1]) / 20);
    pos = [pos[0], pos[1] + Math.sin(f * 0.06) * 0.004 * k, pos[2]];
    rot = [rot[0] + Math.sin(f * 0.045) * 0.04 * k, rot[1] + Math.cos(f * 0.05) * 0.03 * k, rot[2]];
  } else {
    pos = track(f, [[T.phoneLand[0], floatPos], [T.phoneLand[1], landPos]], easeInOut);
    rot = track(f, [[T.phoneLand[0], floatRot], [T.phoneLand[1], landRot]], easeInOut);
  }
  return { pos, rot };
}
