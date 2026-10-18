/**
 * THE FILM — «الطابور», six Higgsfield (Seedance 2.0) shots cut in sequence.
 *
 * 1 queue (crane down)  2 the order (hero types)  3 pickup (bag onto the car)
 * 4 the run (car down the empty lane)  5 handoff (bag through the window)  6 payoff (he eats, queue unmoved)
 * Overlays are the only text: headline on 1, the guest's real order bubble on 2, the bot's real ticket line
 * on 3, end card after 6. Each shot is 6 s @ 24 fps; we play them at 30 fps timeline with playbackRate 0.8
 * so motion stays natural (6 s stays 6 s).
 */
import { FPS } from './timeline';

export const SHOT_SECONDS = 6;
export const SHOT_FRAMES = SHOT_SECONDS * FPS;          // 180
export const SHOTS = [1, 2, 3, 4, 5, 6] as const;        // public/loop/shot-N.mp4
export const END_CARD_FRAMES = 90;

export const FILM = {
  headline: 'الطابور طويل… وإنت مش فيه',
  english: "Long queue. You're not in it.",
  order: 'مساء الخير، عايز كلاسيك برجر كومبو',
  orderTime: '11:47 PM',
  reply: '🎫 طلبك O-RSTJ اتسجل — حوالي 24 دقيقة!',
  replyTime: '11:48 PM',
  payoff: 'الطابور للعربيات.\nطلبك على واتساب.',
};

export const filmTiming = () => {
  const start = (n: number) => (n - 1) * SHOT_FRAMES;
  return {
    shotStart: start,
    headIn: 10,
    headOut: start(2),                     // headline leaves when we cut inside the car
    orderAt: start(2) + Math.round(3.6 * FPS),  // after he taps send
    orderOut: start(3),
    replyAt: start(3) + Math.round(2.2 * FPS),  // as the bag lands on the rack
    replyOut: start(4),
    endStart: start(7) - 12,
    end: start(7) + END_CARD_FRAMES,
  };
};
