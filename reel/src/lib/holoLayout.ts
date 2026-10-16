import { prog, easeOut, easeIn, easeOutBack, lerp, smooth, clamp } from './anim';
import { T, ITEMS, cam } from './timeline';

export const S = 0.00019; // metres per canvas px
export const COL = 0.172;
export const GAP = 0.0075;
export const BASE = 0.03;
export const TOP = 0.3;
export const MARGIN = 40; // must match textures.M

export type Size = { w: number; h: number; me: boolean };
type V3 = [number, number, number];

/** Pure hologram layout for frame f. phonePos = phone centre, PD = phone depth. Shared by the browser scene and the Blender export. */
export function holoLayout(f: number, sizes: Size[], phonePos: V3, PD: number) {
  const on = prog(f, T.rise[1] - 8, T.rise[1] + 12) * (1 - easeIn(prog(f, T.collapse[0], T.collapse[1])));
  const collapse = easeIn(prog(f, T.collapse[0], T.collapse[1] - 4));
  const visible = !(f < T.rise[1] - 10 || f > T.collapse[1] + 2);
  const c = cam(f);
  const origin: V3 = [phonePos[0], phonePos[1] + PD / 2 + 0.001, phonePos[2]];
  const yaw = Math.atan2(c.pos[0] - origin[0], c.pos[2] - origin[2]);
  const midY = origin[1] + 0.15;
  const pitch = -Math.atan2(c.pos[1] - midY, Math.hypot(c.pos[0] - origin[0], c.pos[2] - origin[2])) * 0.7;
  const space = ITEMS.map((it) => {
    const inP = easeOut(prog(f, it.in, it.in + 12));
    const outP = it.out ? easeOut(prog(f, it.out - 2, it.out + 6)) : 0;
    return inP * (1 - outP);
  });
  const H = sizes.map((s) => s.h * S);
  const items = ITEMS.map((it, i) => {
    const hidden = { i, show: false, x: 0, y: 0, sc: 0, a: 0, fw: 0, fh: 0, w: 0, h: 0 };
    if (!visible || f < it.in || (it.out && f > it.out + 6)) return hidden;
    let above = 0;
    for (let j = i + 1; j < ITEMS.length; j++) above += space[j] * (H[j] + GAP);
    const target = BASE + above + H[i] / 2;
    const e = prog(f, it.in, it.in + 14);
    let y = lerp(0.004, target, easeOut(e));
    let sc = lerp(0.18, 1, easeOutBack(e));
    const top = y + H[i] / 2;
    let a = clamp(e * 1.6) * (1 - smooth(TOP - 0.05, TOP, top));
    if (it.out) a *= 1 - prog(f, it.out - 2, it.out + 4);
    if (e < 1) a *= 0.55 + 0.45 * (Math.sin(f * 9.1 + i * 3) > -0.3 ? 1 : 0);
    y *= 1 - collapse;
    sc *= 1 - collapse * 0.9;
    a *= 1 - collapse * 0.5;
    if (a <= 0.003) return hidden;
    const s = sizes[i];
    const w = s.w * S;
    const x = s.me ? -COL / 2 + w / 2 : COL / 2 - w / 2;
    const drift = Math.sin(f * 0.05 + i) * 0.0012;
    return {
      i, show: true, x: x * (1 - collapse), y: y + drift, sc, a,
      fw: (s.w + MARGIN * 2) * S, fh: (s.h + MARGIN * 2) * S, w, h: s.h * S,
    };
  });
  return { visible, on, origin, yaw, pitch, items };
}
