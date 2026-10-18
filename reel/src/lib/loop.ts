/**
 * THE LOOP — the "cars up the wall" trend, Munadim edition.
 *
 * The scene is a real 3D render (igvideos/blender/build_loop.py): a drive-thru queue crawling up a
 * vertical ramp to the restaurant, and the Munadim car running the empty lane up and back with one
 * WhatsApp order. This file holds only the words and the beats; the screen anchors come from the
 * 3D camera via loopGeo.ts, and the copy is the live bot's (the ticket line is a real recording).
 */
import { FPS } from './timeline';
import { LOOP_GEO } from './loopGeo';

export const LOOP = {
  /** Hook, top of frame, Amiri. */
  headline: 'الطابور طويل… وإنت مش فيه',
  english: "Long queue. You're not in it.",
  /** The guest's message, sent from the last car in the queue (recorded wording). */
  order: 'مساء الخير، عايز كلاسيك برجر كومبو',
  orderTime: '11:47 PM',
  /** The bot's real ticket line, verbatim — lands when the car reaches the restaurant. */
  reply: '🎫 طلبك O-RSTJ اتسجل — حوالي 24 دقيقة!',
  replyTime: '11:48 PM',
  /** End card's answer to the hook. */
  payoff: 'الطابور للعربيات.\nطلبك على واتساب.',
  seconds: LOOP_GEO.beats.frames / FPS,
};

export function loopTiming() {
  const b = LOOP_GEO.beats;
  return {
    headIn: 0,
    orderAt: Math.round(b.up0 * 0.7),      // the order pops before the car moves
    climbStart: b.up0,
    climbEnd: b.up1,
    replyAt: b.up1 + 6,                    // the ticket lands as the car arrives
    backAt: b.down1,
    endStart: b.down1,                     // end card rises as the car pulls up to the customer
    end: b.frames,
  };
}

export const LOOP_STILL = {
  headline: 'المطعم بقى في التليفون',
  english: 'The restaurant lives in the phone now.',
  /** The thread painted onto the giant phone's screen (screen rect on the 1080×1350 plate). */
  screen: { x: 300, y: 330, w: 480, h: 600 },
  sign: { x: 850, y: 600, w: 180, h: 180 },
  thread: [
    { me: true, text: 'مساء الخير، عايز كلاسيك برجر كومبو', time: '11:47 PM' },
    { me: false, text: '🎫 طلبك O-RSTJ اتسجل — حوالي 24 دقيقة!', time: '11:48 PM' },
  ],
};
