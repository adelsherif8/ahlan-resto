/**
 * Carousels — the save format. Three decks, 1080×1350, rendered slide by slide with `remotion still`.
 *
 * A · features   — the eight single feature posts, folded into one swipe. Cover opens a gap, last slide asks to send it.
 * B · the maths  — munadim.com's own calculator, one number per slide. Nothing here is invented: 600 × 150, a fifth
 *                  to the app, Start 3,500 + 300 included then 9/order. The footnote is the site's.
 * C · objections — the site's FAQ, verbatim: the owner's fear in his words, the answer in ours.
 */
export type Slide =
  | { k: 'cover'; title: string; sub?: string }
  | { k: 'image'; src: string; label: string }                      // src under reel/public/posts/
  | { k: 'number'; eyebrow: string; big: string; unit?: string; line: string }
  | { k: 'qa'; q: string; a: string }
  | { k: 'text'; title: string; body?: string }
  | { k: 'cta'; title: string; sub: string; foot?: string };

export interface Deck { id: string; slides: Slide[] }

const FEATURES: [string, string][] = [
  ['honest-availability.png', 'بيقول «مش موجود» بدل ما يخترع'],
  ['honest-reply.png', 'بيقول الحقيقة، ما بيوعدش بحاجة ما يقدرش عليها'],
  ['kitchen-ticket.png', 'الملاحظات بتوصل للمطبخ صح'],
  ['order-ready-15.png', 'الطلب خلص في دقيقتين'],
  ['kitchen-tablet.png', 'المطبخ شايف كل طلب لحظة ما يدخل'],
  ['no-app.png', 'من غير تطبيق، من غير حساب جديد'],
  ['no-perfect-spelling.png', 'مش لازم تكتب صح'],
  ['three-phones.png', 'بيرد بنفس اللي بتكتب بيه'],
];

export const DECKS: Record<string, Deck> = {
  A: {
    id: 'A',
    slides: [
      { k: 'cover', title: '٨ حاجات مُنادم بيعملها…\nوواتساب العادي مش بيعملها', sub: 'اسحب ←' },
      ...FEATURES.map(([src, label]) => ({ k: 'image' as const, src, label })),
      { k: 'cta', title: 'ابعتها لصاحب مطعم تعرفه', sub: 'كل طلب يبقى زبون · اطلب على واتساب' },
    ],
  },
  B: {
    id: 'B',
    slides: [
      { k: 'cover', title: '600 أوردر في الشهر…\nالتطبيق بياخد كام؟', sub: 'الحسبة من munadim.com' },
      { k: 'number', eyebrow: 'متوسط الأوردر 150 جنيه × 600 أوردر', big: '90,000', unit: 'جنيه', line: 'مبيعاتك في الشهر' },
      { k: 'number', eyebrow: 'التطبيق بياخد حوالي خُمس قيمة الأوردر*', big: '18,000', unit: 'جنيه', line: 'بتروح للتطبيق كل شهر' },
      { k: 'number', eyebrow: 'مُنادِم · باقة Start', big: '3,500', unit: 'جنيه / الشهر', line: 'وفيها 300 أوردر مشمولة' },
      { k: 'number', eyebrow: 'الـ 300 أوردر الزيادة × 9 جنيه', big: '6,200', unit: 'جنيه', line: 'إجمالي اللي هتدفعه عند 600 أوردر' },
      { k: 'number', eyebrow: 'الفرق في جيبك', big: '11,800', unit: 'جنيه', line: 'كل شهر. من غير عمولة على الأوردر.' },
      { k: 'text', title: 'وكمان الزبون بيفضل عندك.', body: 'رقمه وتاريخ طلباته في لوحة إنت صاحبها — مش عند التطبيق.' },
      { k: 'cta', title: 'احسبها على مطعمك', sub: 'munadim.com · اطلب على واتساب', foot: '*على افتراض إن التطبيق بياخد حوالي خُمس قيمة الأوردر — زي حاسبة munadim.com. عمولتك الفعلية في فاتورتك الشهرية.' },
    ],
  },
  C: {
    id: 'C',
    slides: [
      { k: 'cover', title: '«موظفيني مش هيعرفوا يستخدموه»\nو٧ مخاوف تانية لأصحاب المطاعم', sub: 'وردّنا عليها' },
      { k: 'qa', q: '«موظفيني مش هيعرفوا يستخدموه»', a: 'مش هيتعلموا حاجة جديدة. الأوردر بيوصل جاهز — الكاشير بيشوفه زي ما بيشوف أي أوردر.' },
      { k: 'qa', q: '«ده تطبيق؟»', a: 'لا. مفيش حاجة تتحمّل، لا لك ولا لزباينك. كله على الواتساب.' },
      { k: 'qa', q: '«هيتكلم مع زبايني إزاي؟»', a: 'باسم مطعمك، بالمصري. اسمنا مبيظهرش في الكلام ده — دي محادثة مطعمك مع زبونه.' },
      { k: 'qa', q: '«بتاخدوا عمولة؟»', a: 'لا. اشتراك شهري، وسعر ثابت للأوردر بعد الحد المشمول.' },
      { k: 'qa', q: '«عندي نظام كاشير، هيتعارض معاه؟»', a: 'منادم بياخد الأوردرات، مش بديل للكاشير. الربط بينهم ممكن نتكلم فيه لما تحتاجه.' },
      { k: 'qa', q: '«لو الزبون غيّر رأيه في نص الأوردر؟»', a: 'بيعدّل زي ما بيعدّل مع بني آدم: يزوّد، يشيل، يبدّل. والإجمالي بيتحسب تاني.' },
      { k: 'qa', q: '«ولو سأل سؤال مش عارف إجابته؟»', a: 'مش بيخمّن. بيقول إن الفريق هيرد، والسؤال بيوصلك في لوحة التحكم.' },
      { k: 'qa', q: '«ولو غلط مع زبون؟»', a: 'حد من فريقك بيدخل نفس الشات ويكمّل. مفيش زبون بيتساب من غير رد.' },
      { k: 'cta', title: 'لسه عندك سؤال؟', sub: 'اسألنا على الواتساب' },
    ],
  },
};
