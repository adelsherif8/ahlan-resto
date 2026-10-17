/**
 * THE LOOP — the "cars up the wall" trend, Munadim edition.
 *
 * Two compositions share this file:
 *   Loop       9:16 video — the queue is stuck on the ramp, one WhatsApp order climbs the
 *              empty lane past everyone and lands at the restaurant. (Concept 1.)
 *   LoopStill  4:5 still  — the restaurant is a phone; the queue drives into it. (Concept 2.)
 *
 * The backgrounds are AI-painted night plates (branding/LOOP-PROMPTS.md). Everything brand —
 * the mark on its solid ink panel, the Amiri headline, the WhatsApp bubble, the end card —
 * is drawn here, never by the image model. The PATH below is the climbing bubble's route in
 * 1080×1920 coordinates; retune its points once the real plate is in `public/loop/`.
 */
import { FPS } from './timeline';

export const LOOP = {
  /** Arabic hook, top of frame, Amiri. A question or a flat statement — never a claim with a number. */
  headline: 'الطلب عندك قبل العربيات',
  english: 'The order arrives before the cars do.',
  /** The guest's message that climbs the wall — the real wording a guest types. */
  order: '٢ كلاسيك كومبو وكركديه، دليفري',
  orderTime: '11:47 PM',
  /** The restaurant's reply when the bubble lands. */
  reply: 'وصل الطلب ✅ حوالي 25 دقيقة',
  replyTime: '11:48 PM',
  /** End card's answer to the headline. */
  payoff: 'العربيات في الزحمة.\nطلبك وصل.',
  /** The route up the wall, 1080×1920 space, bottom-left road → up the empty lane → the restaurant.
   *  Cubic Bézier chain: p0, c1, c2, p1 per segment. */
  path: [
    { x: 120, y: 1660 }, { x: 420, y: 1640 }, { x: 760, y: 1560 }, { x: 900, y: 1340 },
    { x: 1000, y: 1180 }, { x: 1010, y: 980 }, { x: 980, y: 760 },
    { x: 960, y: 700 }, { x: 900, y: 600 }, { x: 740, y: 585 },
  ],
  /** Where the sign panel is on the plate (the brass mark goes here). */
  sign: { x: 560, y: 470, w: 200, h: 200 },
  seconds: 11,
};

export function loopTiming() {
  const headIn = 0;
  const climbStart = Math.round(1.4 * FPS);
  const climbEnd = Math.round(7.2 * FPS);
  const land = climbEnd;
  const replyAt = land + Math.round(0.5 * FPS);
  const endStart = Math.round((LOOP.seconds - 2.6) * FPS);
  const end = LOOP.seconds * FPS;
  return { headIn, climbStart, climbEnd, land, replyAt, endStart, end };
}

/** Point and tangent angle along the Bézier chain at t ∈ [0,1]. */
export function alongPath(t: number): { x: number; y: number; angle: number } {
  const P = LOOP.path;
  const segs = Math.floor((P.length - 1) / 3);
  const u = Math.min(Math.max(t, 0), 0.9999) * segs;
  const i = Math.floor(u);
  const s = u - i;
  const [p0, c1, c2, p1] = [P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!, P[i * 3 + 3]!];
  const k = 1 - s;
  const x = k * k * k * p0.x + 3 * k * k * s * c1.x + 3 * k * s * s * c2.x + s * s * s * p1.x;
  const y = k * k * k * p0.y + 3 * k * k * s * c1.y + 3 * k * s * s * c2.y + s * s * s * p1.y;
  const dx = 3 * k * k * (c1.x - p0.x) + 6 * k * s * (c2.x - c1.x) + 3 * s * s * (p1.x - c2.x);
  const dy = 3 * k * k * (c1.y - p0.y) + 6 * k * s * (c2.y - c1.y) + 3 * s * s * (p1.y - c2.y);
  return { x, y, angle: Math.atan2(dy, dx) };
}

export const LOOP_STILL = {
  headline: 'المطعم بقى في التليفون',
  english: 'The restaurant lives in the phone now.',
  /** The thread painted onto the giant phone's screen (screen rect on the 1080×1350 plate). */
  screen: { x: 300, y: 330, w: 480, h: 600 },
  sign: { x: 850, y: 600, w: 180, h: 180 },
  thread: [
    { me: true, text: '٢ كلاسيك كومبو وكركديه، دليفري', time: '11:47 PM' },
    { me: false, text: 'وصل ✅ الإجمالي 625 جنيه — حوالي 25 دقيقة', time: '11:48 PM' },
  ],
};
