/**
 * FULL conversations, for the screen-recording cut (`Chat` composition).
 *
 * The feature reels in posts.ts are two or three bubbles — a single claim, proved.
 * These are the opposite: a whole order the way it really happens, with the guest
 * hesitating, changing their mind, asking a question mid-order and answering in a
 * different language than they started in. They run 25–45 seconds and are meant to
 * look like someone screen-recorded their own phone.
 *
 * Same iron rule as posts.ts: every price is the live Munadim menu (Classic 195 /
 * combo 265 · Signature 245 / 315 · Nashville 210 / 280 · Koshary 75 regular, 100
 * large · Fries 55 · Loaded Fries 105 · Karkadeh 45 · Om Ali 80 · Tenders 3pc 140 ·
 * Soft Drink 35 · delivery 50 for the first 5 km then 6/km). Nothing is invented.
 */

export type Turn =
  | { me: true; kind: 'text'; text: string }
  | { me: false; kind: 'text'; text: string }
  | { me: false; kind: 'bill'; lines: [string, string][]; extras?: [string, string][]; total: [string, string]; after?: string }
  | { me: false; kind: 'ticket'; code: string; eta: string; note?: string };

export interface Thread {
  id: string;
  /** Shown once under the status bar, like a real chat you just opened. */
  title: string;
  /** Wall-clock the conversation starts at; each turn advances it a little. */
  clock: string;
  /** rtl drives bubble text direction for the whole thread. */
  lang: 'ar' | 'en' | 'fr';
  turns: Turn[];
}

export const THREADS: Record<string, Thread> = {
  // ── A real delivery order, Arabic, with a mind change halfway through ──────────
  T1: {
    id: 'T1',
    title: 'طلب دليفري كامل',
    clock: '21:14',
    lang: 'ar',
    turns: [
      { me: true, kind: 'text', text: 'مساء الخير، لسه فاتحين؟' },
      { me: false, kind: 'text', text: 'مساء النور 🙏 فاتحين لحد ٢ بالليل — تحب تطلب إيه؟' },
      { me: true, kind: 'text', text: 'عايز كلاسيك برجر' },
      { me: false, kind: 'text', text: 'تمام — ساندوتش ولا كومبو (بطاطس + مشروب)؟\nساندوتش 195 · كومبو 265' },
      { me: true, kind: 'text', text: 'كومبو' },
      { me: false, kind: 'text', text: 'المشروب مع الكومبو؟\n• كوكا كولا\n• كوكا كولا دايت\n• سبرايت\n• فانتا\n• مُنادم كركديه' },
      { me: true, kind: 'text', text: 'كركديه' },
      { me: true, kind: 'text', text: 'لا استنى، خليه اتنين كومبو' },
      { me: false, kind: 'text', text: 'اتعدّل ✅ — ٢× مُنادم كلاسيك برجر (كومبو · كركديه)' },
      { me: true, kind: 'text', text: 'وكمان بطاطس لودد' },
      { me: true, kind: 'text', text: 'دليفري ماكسيم' },
      {
        me: false, kind: 'bill',
        lines: [['2× مُنادم كلاسيك برجر (كومبو · كركديه)', '530'], ['1× مُنادم لودد فرايز', '105']],
        extras: [['التوصيل (~1.4 كم)', '50']],
        total: ['الإجمالي المطلوب', '685'],
        after: 'كاش ولا فيزا؟',
      },
      { me: true, kind: 'text', text: 'كاش' },
      { me: true, kind: 'text', text: 'ممكن من غير مخلل في واحد بس؟' },
      { me: false, kind: 'text', text: 'اتسجلت ✅ — واحد من غير مخلل، والتاني زي ما هو.\nأأكد الأوردر؟' },
      { me: true, kind: 'text', text: 'أكد' },
      { me: false, kind: 'ticket', code: 'O-4TBC', eta: 'حوالي ٣٥ دقيقة', note: 'هنبعتلك لما يخرج من المطبخ 🙏' },
    ],
  },

  // ── Franco, messy typing, switches to English halfway — and it follows ────────
  T2: {
    id: 'T2',
    title: 'فرانكو ← إنجليزي',
    clock: '13:02',
    lang: 'fr',
    turns: [
      { me: true, kind: 'text', text: 'salam, 3ayez atlob' },
      { me: false, kind: 'text', text: 'Ahlan 🙏 Ta7t amrak — te7eb teshoof el menu wala 3aref 3ayez eh?' },
      { me: true, kind: 'text', text: '3ayez 2 nashfeel sandwitsh, wa7ed har w wa7ed 3ady' },
      { me: false, kind: 'text', text: 'Fahemtak — Munadim Nashville Chicken, sandwich.\nEl spice: Mild · Medium · Hot 🔥 — el "3ady" ya3ni Mild sa7?' },
      { me: true, kind: 'text', text: 'aywa mild' },
      { me: true, kind: 'text', text: 'actually can you switch to english' },
      { me: false, kind: 'text', text: "Of course — switching to English 🙂\n2× Munadim Nashville Chicken (Sandwich) — 1 Hot, 1 Mild." },
      { me: true, kind: 'text', text: 'is the hot one more expensive?' },
      { me: false, kind: 'text', text: 'No — spice is free, both are 210 EGP.' },
      { me: true, kind: 'text', text: 'perfect. pickup, cash' },
      {
        me: false, kind: 'bill',
        lines: [['1× Munadim Nashville Chicken · Hot 🔥', '210'], ['1× Munadim Nashville Chicken · Mild', '210']],
        total: ['Total Due', '420'],
        after: 'Pickup from Point 90 · Cash. Confirm?',
      },
      { me: true, kind: 'text', text: 'confirm' },
      { me: false, kind: 'ticket', code: 'O-9KPR', eta: 'about 20 min', note: "I'll message you when it's ready 🙏" },
    ],
  },

  // ── The awkward one: asks for things we don't have, and gets told the truth ───
  T3: {
    id: 'T3',
    title: 'بيقول الحقيقة',
    clock: '19:38',
    lang: 'ar',
    turns: [
      { me: true, kind: 'text', text: 'عندكم بيتزا؟' },
      { me: false, kind: 'text', text: 'معندناش بيتزا 🙏 — إحنا برجر وفراخ وكشري.\nتحب أبعتلك المنيو؟' },
      { me: true, kind: 'text', text: 'ماشي، وعندكم بيبسي؟' },
      { me: false, kind: 'text', text: 'المشروبات عندنا: كوكا كولا · دايت · سبرايت · فانتا · مُنادم كركديه · عصير مانجا 🙂' },
      { me: true, kind: 'text', text: 'طب هات كشري كبير وكركديه' },
      {
        me: false, kind: 'bill',
        lines: [['1× مُنادم كشري (كبير)', '100'], ['1× مُنادم كركديه', '45']],
        total: ['الإجمالي', '145'],
        after: 'تيك أواي ولا دليفري؟',
      },
      { me: true, kind: 'text', text: 'دليفري المعادي' },
      { me: false, kind: 'text', text: 'بنوصل التجمع والقاهرة الجديدة بس 🙏 — التيك أواي جاهز دايمًا من بوينت ٩٠.' },
      { me: true, kind: 'text', text: 'طب تيك أواي يبقى' },
      { me: false, kind: 'text', text: 'تمام ✅ — تيك أواي من بوينت ٩٠، الإجمالي 145 جنيه.\nأأكد؟' },
      { me: true, kind: 'text', text: 'أكد' },
      { me: false, kind: 'ticket', code: 'O-2XMD', eta: 'حوالي ١٥ دقيقة' },
    ],
  },

  // ── A table of four, dine-in from the QR, split at the end ───────────────────
  T4: {
    id: 'T4',
    title: 'ترابيزة ٧ · قسمة الحساب',
    clock: '20:05',
    lang: 'ar',
    turns: [
      { me: true, kind: 'text', text: 'طلب من ترابيزة ٧' },
      { me: false, kind: 'text', text: 'أهلاً 🙏 ترابيزة ٧ — اطلبوا وأنا أسجّل، وفي الآخر أقدر أقسّم الحساب.' },
      { me: true, kind: 'text', text: 'اتنين كلاسيك ساندوتش، وناشفيل ساندوتش حار، وتشيكن تندرز ٣ قطع ميديم' },
      { me: false, kind: 'text', text: 'اتسجل ✅ — في مشروبات؟' },
      { me: true, kind: 'text', text: 'كركديه وبطاطس' },
      {
        me: false, kind: 'bill',
        lines: [
          ['2× مُنادم كلاسيك برجر (ساندوتش)', '390'],
          ['1× مُنادم ناشفيل تشيكن · حار 🔥', '210'],
          ['1× مُنادم تشيكن تندرز ٣ قطع · ميديم', '140'],
          ['1× مُنادم كركديه', '45'],
          ['1× مُنادم بطاطس', '55'],
        ],
        total: ['الإجمالي', '840'],
        after: 'أأكد الأوردر؟',
      },
      { me: true, kind: 'text', text: 'أكد' },
      { me: false, kind: 'ticket', code: 'O-7JBN', eta: 'حوالي ٢٥ دقيقة' },
      { me: true, kind: 'text', text: 'قسّم الحساب — عمر الناشفيل والكركديه، أحمد التندرز والبطاطس، والكلاسيك على اتنين' },
      {
        me: false, kind: 'bill',
        lines: [['عمر', '255'], ['أحمد', '195'], ['كريم', '195'], ['سارة', '195']],
        total: ['إجمالي الفاتورة', '840'],
      },
    ],
  },
};

export const THREAD_IDS = Object.keys(THREADS);
