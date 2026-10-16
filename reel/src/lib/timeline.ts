import { track, wobble, easeInOut } from './anim';

export const FPS = 30;
export type Variant = 'holo' | 'map';
type V3 = [number, number, number];

/** shared head: the phone wakes on the table, lifts, and the chat plays as a hologram */
const HEAD = {
  wake: [24, 46] as const,
  unlock: [58, 74] as const,
  rise: [62, 112] as const,
  collapse: [442, 464] as const,
};

export const ITEMS: { msg: number; in: number; out?: number }[] = [
  { msg: 0, in: 120 },
  { msg: -1, in: 150, out: 180 },
  { msg: 1, in: 180 },
  { msg: 2, in: 234 },
  { msg: -1, in: 258, out: 286 },
  { msg: 3, in: 286 },
  { msg: 4, in: 340 },
  { msg: -1, in: 362, out: 390 },
  { msg: 5, in: 390 },
];

const HOLO_T = {
  ...HEAD,
  send: [444, 478] as const,
  map: [470, 510] as const,
  shop: [516, 590] as const,
  ride: [600, 690] as const,
  mapOut: [696, 720] as const,
  phoneLand: [698, 728] as const,
  tray: [704, 744] as const,
  end: [770, 798] as const,
  city: [0, 0] as const,
  dur: 812,
};

/** the real-map version leaves the table between these frames (the city scene covers them) */
const MAP_T = {
  ...HEAD,
  send: [444, 470] as const,
  map: [0, 0] as const,
  shop: [0, 0] as const,
  ride: [0, 0] as const,
  mapOut: [0, 0] as const,
  city: [470, 830] as const,
  phoneLand: [838, 868] as const,
  tray: [844, 884] as const,
  end: [910, 938] as const,
  dur: 950,
};

export const T: typeof HOLO_T = { ...HOLO_T };

const HOLO_CAPS = [
  { text: 'الأوردر بيروح للمطعم في ثانية', in: 452, out: 508 },
  { text: 'المطبخ شايف الأوردر والعنوان', in: 528, out: 588 },
  { text: 'والكابتن في السكة', in: 614, out: 686 },
  { text: 'وأوردرك على بابك', in: 720, out: 766 },
];
const MAP_CAPS = [
  { text: 'الأوردر بيروح للمطعم في ثانية', in: 452, out: 500 },
  { text: 'المطبخ شايف الأوردر والعنوان', in: 620, out: 678 },
  { text: 'والكابتن في السكة', in: 730, out: 800 },
  { text: 'وأوردرك على بابك', in: 862, out: 906 },
];
const BASE_CAPS = [
  { text: 'أوردرك بيبدأ برسالة واتساب', in: 26, out: 112 },
  { text: 'اطلب بفويس من مكانك', in: 124, out: 230 },
  { text: 'اللي بيرد ده منادم، مش موظف', in: 292, out: 382 },
];
export const CAPTIONS: { text: string; in: number; out: number }[] = [...BASE_CAPS, ...HOLO_CAPS];

const HOLO_POS: [number, V3][] = [
  [0, [0.1, 0.33, 0.26]],
  [52, [0.05, 0.25, 0.2]],
  [92, [0.05, 0.27, 0.26]],
  [114, [0.08, 0.34, 0.66]],
  [264, [-0.06, 0.35, 0.66]],
  [442, [0.05, 0.36, 0.64]],
  [510, [0.02, 0.47, 0.41]],
  [554, [-0.03, 0.42, 0.24]],
  [602, [0.02, 0.48, 0.42]],
  [648, [0.05, 0.47, 0.41]],
  [690, [0.09, 0.44, 0.35]],
  [732, [0.03, 0.27, 0.47]],
  [812, [0.0, 0.25, 0.42]],
];
const HOLO_TGT: [number, V3][] = [
  [0, [0.0, 0.01, 0.07]],
  [52, [0.0, 0.006, 0.072]],
  [92, [0.0, 0.08, 0.07]],
  [114, [0, 0.32, 0.04]],
  [442, [0, 0.32, 0.04]],
  [510, [0, 0.3, 0.0]],
  [554, [-0.048, 0.355, -0.035]],
  [602, [0, 0.3, 0.0]],
  [648, [0.02, 0.3, 0.01]],
  [690, [0.06, 0.3, 0.04]],
  [732, [0.03, 0.05, -0.02]],
  [812, [0.03, 0.05, -0.02]],
];
const HOLO_FOCUS: [number, V3][] = [
  [0, [0, 0.008, 0.07]],
  [92, [0, 0.08, 0.07]],
  [116, [0, 0.33, 0.05]],
  [442, [0, 0.33, 0.05]],
  [502, [0, 0.31, 0.0]],
  [554, [-0.048, 0.36, -0.035]],
  [602, [0, 0.31, 0.0]],
  [690, [0.06, 0.31, 0.04]],
  [732, [0.03, 0.06, -0.02]],
];
const HOLO_FOV: [number, number][] = [[0, 30], [52, 28], [114, 36], [442, 36], [510, 40], [690, 40], [732, 38]];

/** map version: same head, then the camera rockets up (the GTA whip), city scene takes over, then it drops back to the table */
const MAP_POS: [number, V3][] = [
  ...HOLO_POS.slice(0, 6),
  [470, [0.03, 1.4, 0.5]],
  [830, [0.03, 1.4, 0.5]],
  [868, [0.03, 0.27, 0.47]],
  [950, [0.0, 0.25, 0.42]],
];
const MAP_TGT: [number, V3][] = [
  ...HOLO_TGT.slice(0, 5),
  [470, [0, 0.1, 0.02]],
  [830, [0, 0.1, 0.02]],
  [868, [0.03, 0.05, -0.02]],
  [950, [0.03, 0.05, -0.02]],
];
const MAP_FOCUS: [number, V3][] = [
  ...HOLO_FOCUS.slice(0, 5),
  [470, [0, 0.2, 0.0]],
  [830, [0, 0.2, 0.0]],
  [868, [0.03, 0.06, -0.02]],
];
const MAP_FOV: [number, number][] = [[0, 32], [114, 36], [442, 36], [470, 44], [830, 44], [868, 38]];

let POS = HOLO_POS, TGT = HOLO_TGT, FOCUS = HOLO_FOCUS, FOVK = HOLO_FOV;

export function setVariant(v: Variant) {
  Object.assign(T, v === 'map' ? MAP_T : HOLO_T);
  CAPTIONS.length = 0;
  CAPTIONS.push(...BASE_CAPS, ...(v === 'map' ? MAP_CAPS : HOLO_CAPS));
  POS = v === 'map' ? MAP_POS : HOLO_POS;
  TGT = v === 'map' ? MAP_TGT : HOLO_TGT;
  FOCUS = v === 'map' ? MAP_FOCUS : HOLO_FOCUS;
  FOVK = v === 'map' ? MAP_FOV : HOLO_FOV;
}

export const DUR = 812; // holo default; use T.dur for the active variant

export function cam(f: number) {
  const p = track(f, POS, easeInOut);
  const t = track(f, TGT, easeInOut);
  const hand = [wobble(f, 1, 0.0035), wobble(f, 2, 0.003), wobble(f, 3, 0.002)];
  return {
    pos: [p[0] + hand[0], p[1] + hand[1], p[2] + hand[2]] as V3,
    tgt: t as V3,
    focus: track(f, FOCUS, easeInOut) as V3,
    fov: track(f, FOVK),
  };
}
