/**
 * Kinetic reels — the statement / founder-POV reels that are not a chat.
 *
 * Same honesty rules as posts.ts: menu prices are the live Munadim menu, and no
 * figure appears as fact unless it is ours. The commission reel is framed as «لو»
 * (a worked example) with a footnote, because the market figures we found are not
 * Egyptian. There is no customer testimonial here — we have no clients to quote yet,
 * so the founder speaks for himself instead. R12's chat lines are real ticket messages
 * recorded from the live bot (flows/_reel.mjs).
 *
 * Wrap a word in *stars* to set it in brass.
 */

export type Beat =
  /** A statement, revealed word by word. `big` for the opening hook. */
  | { k: 'line'; text: string; d: number; big?: boolean }
  /** Items stack one by one; each gets struck through with a karkadeh stamp. */
  | { k: 'list'; items: string[]; stamp: string; d: number }
  /** The worked commission example: a 100 EGP order, a slice off, what is left. */
  | { k: 'math'; base: number; pct: number; d: number }
  /** munadim.com's own calculator: what the app takes vs. Munadim, and the difference. */
  | { k: 'compare'; app: number; munadim: number; plan: string; d: number }
  /** A mini WhatsApp card for a time of day — the day-in-the-life montage. */
  | { k: 'chat'; stamp: string; msgs: [boolean, string][]; d: number };

export interface Kinetic {
  id: string;
  beats: Beat[];
  /** The end card's answer to the hook. */
  payoff: string;
}

export const KINETIC: Record<string, Kinetic> = {
  // R2 · the money, exactly as munadim.com's calculator shows it (600 orders × 150 EGP, apps ≈ a fifth).
  // Munadim is not free: Start is 3,500/mo with 300 orders, then 9 EGP an order → 6,200 at 600 orders.
  R2: {
    id: 'R2',
    beats: [
      { k: 'line', big: true, text: '600 أوردر في الشهر…\nالتطبيق بياخد *كام*؟', d: 64 },
      { k: 'compare', app: 18000, munadim: 6200, plan: 'Start', d: 150 },
      { k: 'line', text: 'الفرق ده…\n*في جيبك* كل شهر.', d: 54 },
      { k: 'chat', stamp: 'أوردر حقيقي · من غير عمولة', d: 70, msgs: [[true, 'تأكيد'], [false, '🎫 طلبك O-RSTJ اتسجل — حوالي 24 دقيقة!']] },
    ],
    payoff: 'مفيش عمولة.\nاشتراك شهري، وسعر ثابت للأوردر بعد الحد المشمول.',
  },

  // R3 · rent vs own — the thesis
  R3: {
    id: 'R3',
    beats: [
      { k: 'line', big: true, text: 'التطبيقات\nمش شركاءك.', d: 56 },
      { k: 'line', text: 'بتأجّرلك *زباينك*.', d: 48 },
      { k: 'line', text: 'الاسم. الرقم.\nبيحب ياكل إيه.', d: 56 },
      { k: 'line', text: 'كله *عندهم*.\nمش عندك.', d: 50 },
      { k: 'line', text: 'يوم ما يوقّفوا الإعلان…\nالزباين *تقف*.', d: 64 },
      { k: 'line', text: 'واتساب بيقلب المعادلة.', d: 46 },
      { k: 'chat', stamp: 'أوردر حقيقي · ١١:٤٧ بالليل', d: 74, msgs: [[true, 'مساء الخير، عايز كلاسيك برجر كومبو'], [false, '🎫 طلبك O-RSTJ اتسجل — حوالي 24 دقيقة!']] },
    ],
    payoff: 'الزبون بيطلب منك.\nرقمه عندك.\nوبيرجعلك إنت.',
  },

  // R5 · three orders lost today without you noticing
  R5: {
    id: 'R5',
    beats: [
      { k: 'line', big: true, text: '٣ أوردرات واتساب ضاعت النهاردة…\nوإنت *مش واخد بالك*.', d: 70 },
      {
        k: 'list', stamp: 'أوردر راح', d: 150,
        items: ['رسالة واتساب وإنت مشغول في المطبخ', 'سؤال عن المنيو اترد عليه بعد ساعتين', 'أوردر الساعة ١٢ بالليل… محدش رد'],
      },
    ],
    payoff: 'مُنادِم بيرد على التلاتة.\nعلى طول.',
  },

  // R8 · the founder's why (no testimonial — we have no clients to quote yet)
  R8: {
    id: 'R8',
    beats: [
      { k: 'line', big: true, text: 'ليه عملنا\n*مُنادِم*؟', d: 50 },
      { k: 'line', text: 'شفنا مطاعم بتخسر أوردرات\nكل ليلة.', d: 58 },
      { k: 'line', text: 'مش عشان الأكل وحش.', d: 44 },
      { k: 'line', text: 'عشان *محدش رد*.', d: 46 },
      { k: 'line', text: 'الرسالة بتستنى…\nوالجعان *مابيستناش*.', d: 64 },
    ],
    payoff: 'عملنا حاجة بترد.\nباسم مطعمك.',
  },

  // R11 · building a house on land that isn't yours
  R11: {
    id: 'R11',
    beats: [
      { k: 'line', big: true, text: 'بتبني بيت\nعلى أرض *مش بتاعتك*.', d: 64 },
      { k: 'line', text: 'لو مطعمك على التطبيقات بس…', d: 52 },
      { k: 'line', text: 'أي يوم يغيّروا\nالشروط أو العمولة —', d: 58 },
      { k: 'line', text: 'إنت اللي *بتدفع*.', d: 44 },
    ],
    payoff: 'واتساب أرضك إنت.\nوالزباين عليها بتفضل ليك.',
  },

  // R12 · a day in the life — a labelled demo day, live menu prices
  R12: {
    id: 'R12',
    beats: [
      { k: 'line', big: true, text: 'يوم واحد…\nكل الأوردرات على *واتساب*.', d: 60 },
      { k: 'chat', stamp: 'الضهر · ١:٣٠', d: 62, msgs: [[true, 'تأكيد'], [false, '🎫 طلبك O-593F اتسجل — حوالي 39 دقيقة!']] },
      { k: 'chat', stamp: 'العصر · ٥:٤٥', d: 62, msgs: [[true, 'تأكيد'], [false, '🎫 طلبك O-CC5T اتسجل — حوالي 27 دقيقة!']] },
      { k: 'chat', stamp: 'بالليل · ١١:٢٠', d: 66, msgs: [[true, 'تأكيد'], [false, '🎫 طلبك O-RSTJ اتسجل — حوالي 24 دقيقة!']] },
    ],
    payoff: 'يوم كامل.\nولا رسالة ضاعت.',
  },
};

const END = 90; // the shared end card, with its payoff beat

export const kineticTiming = (r: Kinetic) => {
  const starts: number[] = [];
  let t = 0;
  for (const b of r.beats) { starts.push(t); t += b.d; }
  return { starts, endStart: t, end: t + END };
};
