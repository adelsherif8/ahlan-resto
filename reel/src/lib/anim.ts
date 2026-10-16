export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t: number) => t * t * t;
export const easeOutBack = (t: number) => {
  const c1 = 1.5, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** progress 0..1 of frame f through [a,b] */
export const prog = (f: number, a: number, b: number) => clamp((f - a) / (b - a));
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

type V = number | number[];
/** Keyframed value with ease-in-out between keys. keys: [frame, value][] sorted. */
export function track<T extends V>(f: number, keys: [number, T][], ease = easeInOut): T {
  if (f <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (f >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [f0, v0] = keys[i];
    const [f1, v1] = keys[i + 1];
    if (f >= f0 && f <= f1) {
      const t = ease((f - f0) / (f1 - f0));
      if (typeof v0 === 'number') return lerp(v0, v1 as number, t) as T;
      return (v0 as number[]).map((x, k) => lerp(x, (v1 as number[])[k], t)) as T;
    }
  }
  return last[1];
}

/** Smooth pseudo-random handheld wobble, deterministic per frame. */
export function wobble(f: number, seed: number, amp: number) {
  const t = f / 30;
  return amp * (Math.sin(t * 1.3 + seed) * 0.5 + Math.sin(t * 2.7 + seed * 2.1) * 0.3 + Math.sin(t * 5.1 + seed * 3.7) * 0.2);
}

/** Seeded RNG */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
