/**
 * Kinetic reels — the statement / founder-POV reels that are not a chat.
 *
 * Same honesty rules as posts.ts: menu prices are the live Munadim menu, and no
 * figure appears as fact unless it is ours. The commission reel is framed as «لو»
 * (a worked example) with a footnote, because the market figures we found are not
 * Egyptian. There is no customer testimonial here — we have no clients to quote yet,
 * so the founder speaks for himself instead.
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
  /** A mini WhatsApp card for a time of day — the day-in-the-life montage. */
  | { k: 'chat'; stamp: string; msgs: [boolean, string][]; d: number };

export interface Kinetic {
  id: string;
  beats: Beat[];
  /** The end card's answer to the hook. */
  payoff: string;
}

export const KINETIC: Record<string, Kinetic> = {
  // R2 · the commission math, as a worked example
  R2: {
    id: 'R2',
    beats: [
      { k: 'line', big: true, text: 'أوردر بـ ١٠٠ جنيه…\nالمطعم بياخد *كام*؟', d: 66 },
      { k: 'math', base: 100, pct: 25, d: 120 },
      { k: 'line', text: 'وكمان الزبون…\n*مش بتاعك*.', d: 56 },
      { k: 'line', text: 'على واتساب:\n١٠٠ جنيه = *١٠٠ جنيه*.', d: 62 },
    ],
    payoff: 'من غير عمولة على الأوردر.\nوالزبون يفضل عندك.',
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
        items: ['رسالة واتساب وإنت مشغول في المطبخ', 'سؤال عن المنيو اترد عليه بعد ساعتين', 'أوردر الساعة ٢ بالليل… محدش رد'],
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
      { k: 'chat', stamp: 'الضهر · ١:٣٠', d: 62, msgs: [[true, 'ناشفيل كومبو'], [false, 'مُنادم ناشفيل تشيكن (كومبو) — 280 جنيه. أأكد؟']] },
      { k: 'chat', stamp: 'العصر · ٥:٤٥', d: 62, msgs: [[true, 'ترافل برجر كومبو'], [false, 'مُنادم ترافل برجر (كومبو) — 335 جنيه 🙂 أأكد؟']] },
      { k: 'chat', stamp: 'بالليل · ١١:٢٠', d: 66, msgs: [[true, '٢ كلاسيك وأم علي'], [false, '٢× مُنادم كلاسيك برجر + مُنادم أم علي — 470 جنيه. أأكد؟']] },
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
