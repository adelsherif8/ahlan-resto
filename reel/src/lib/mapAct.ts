import { prog, easeOut, easeInOut, easeIn, clamp, lerp } from './anim';
import { T, cam } from './timeline';

export type V3 = [number, number, number];

/** map plate sits flat above the phone */
export const MAP_ORIGIN: V3 = [0, 0.3, 0.0];
export const MAP_W = 0.17, MAP_D = 0.13;
export const SHOP: [number, number] = [-0.055, -0.035]; // local x,z on the plate
export const HOME: [number, number] = [0.06, 0.04];
export const ROUTE: [number, number][] = [
  [-0.055, -0.035], [-0.055, -0.01], [-0.01, -0.01], [-0.01, 0.025], [0.03, 0.025], [0.06, 0.025], [0.06, 0.04],
];

const segLens = ROUTE.slice(1).map((p, i) => Math.hypot(p[0] - ROUTE[i][0], p[1] - ROUTE[i][1]));
const total = segLens.reduce((a, b) => a + b, 0);

/** point + heading (radians, around Y) at arc-length fraction t */
export function onRoute(t: number): { p: [number, number]; yaw: number } {
  let d = clamp(t) * total;
  for (let i = 0; i < segLens.length; i++) {
    if (d <= segLens[i] || i === segLens.length - 1) {
      const k = segLens[i] ? clamp(d / segLens[i]) : 0;
      const a = ROUTE[i], b = ROUTE[i + 1];
      return {
        p: [lerp(a[0], b[0], k), lerp(a[1], b[1], k)],
        yaw: Math.atan2(b[0] - a[0], b[1] - a[1]),
      };
    }
    d -= segLens[i];
  }
  return { p: ROUTE[ROUTE.length - 1], yaw: 0 };
}

const world = (local: [number, number], y = 0): V3 => [MAP_ORIGIN[0] + local[0], MAP_ORIGIN[1] + y, MAP_ORIGIN[2] + local[1]];

/** yaw/pitch that turns a panel toward the camera at frame f */
export function billboard(f: number, at: V3, pitchScale = 0.7) {
  const c = cam(f);
  const yaw = Math.atan2(c.pos[0] - at[0], c.pos[2] - at[2]);
  const flat = Math.hypot(c.pos[0] - at[0], c.pos[2] - at[2]);
  const pitch = -Math.atan2(c.pos[1] - at[1], flat) * pitchScale;
  return { yaw, pitch };
}

export function mapLayout(f: number) {
  if (T.map[1] <= T.map[0]) {
    const zero: V3 = [0, 0, 0];
    return {
      visible: false, a: 0, scale: 1, origin: MAP_ORIGIN,
      packet: { pos: zero, a: 0 }, shop: { pos: zero, a: 0 }, home: { pos: zero, a: 0 },
      ticket: { pos: zero, a: 0 }, eta: { pos: zero, a: 0 }, scooter: { pos: zero, yaw: 0, a: 0 },
      routeFrac: 0, routeA: 0,
    };
  }
  const inA = easeOut(prog(f, T.map[0], T.map[1]));
  const outA = easeIn(prog(f, T.mapOut[0], T.mapOut[1]));
  const a = inA * (1 - outA);
  const scale = lerp(0.35, 1, easeOut(prog(f, T.map[0], T.map[1] + 6))) * lerp(1, 0.6, outA);

  // the order packet: phone screen -> restaurant pin
  const pk = prog(f, T.send[0], T.send[1]);
  const packetA = Math.sin(Math.PI * clamp(pk)) * (pk > 0 && pk < 1 ? 1 : 0);
  const from: V3 = [0, 0.18, 0.05];
  const to = world(SHOP, 0.03);
  const arc = Math.sin(Math.PI * pk) * 0.09;
  const _unused = 0;
  const packet: V3 = [lerp(from[0], to[0], easeInOut(pk)), lerp(from[1], to[1], easeInOut(pk)) + arc, lerp(from[2], to[2], easeInOut(pk))];

  const shopPos = world(SHOP, 0.022);
  const homePos = world(HOME, 0.022);
  const shopA = a * easeOut(prog(f, T.map[0] + 6, T.map[1]));
  const homeA = a * easeOut(prog(f, T.ride[0] - 16, T.ride[0] + 4));

  // kitchen ticket floats beside the restaurant pin
  const ticketA = easeOut(prog(f, T.shop[0], T.shop[0] + 14)) * (1 - easeIn(prog(f, T.shop[1] - 10, T.shop[1])));
  const ticketPos: V3 = [shopPos[0] + 0.012, shopPos[1] + 0.056, shopPos[2] - 0.008];

  // the ride
  const rideT = easeInOut(prog(f, T.ride[0], T.ride[1]));
  const r = onRoute(rideT);
  const scooterPos = world(r.p, 0.009);
  const scooterA = a * clamp(prog(f, T.ride[0] - 6, T.ride[0] + 6)) * (1 - easeIn(prog(f, T.ride[1] - 4, T.ride[1] + 6)));
  const etaA = easeOut(prog(f, T.ride[0] + 8, T.ride[0] + 26)) * (1 - easeIn(prog(f, T.mapOut[0] - 6, T.mapOut[0] + 8)));
  const etaPos: V3 = [MAP_ORIGIN[0] + 0.012, MAP_ORIGIN[1] + 0.042, MAP_ORIGIN[2] - 0.012];

  return {
    visible: a > 0.002 || packetA > 0.002,
    a, scale, origin: MAP_ORIGIN,
    packet: { pos: packet, a: packetA },
    shop: { pos: shopPos, a: shopA },
    home: { pos: homePos, a: homeA },
    ticket: { pos: ticketPos, a: ticketA },
    eta: { pos: etaPos, a: etaA },
    scooter: { pos: scooterPos, yaw: r.yaw, a: scooterA },
    routeFrac: clamp(prog(f, T.ride[0] - 10, T.ride[1] - 10)),
    routeA: a,
  };
}
