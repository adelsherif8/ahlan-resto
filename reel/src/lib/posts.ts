/**
 * One data file → every feature reel.
 *
 * Source of truth is branding/MARKETING-IMAGE-BRIEFS.md: the wording in `script`
 * is the product's actual wording, and every price here is the live Munadim menu
 * (Classic 195 · Nashville 210 sandwich / 280 combo · Fries 55 · Karkadeh 45 ·
 * delivery 50 for the first 5 km then 6/km). Nothing is invented — a number that
 * is not in the menu or the rate card does not belong in a post.
 */

export type Bubble =
  | { me: true; kind: 'text'; text: string; time: string }
  | { me: false; kind: 'text'; text: string; time: string }
  | { me: true; kind: 'voice'; dur: string; time: string }
  | { me: true; kind: 'location'; time: string }
  | { me: false; kind: 'bill'; lines: [string, string][]; total: [string, string]; after?: string; time: string }
  | { me: false; kind: 'status'; code: string; ago: string; steps: [string, boolean][]; time: string }
  /** A centred WhatsApp date chip ("بعد أسبوع") — marks time passing in the thread. */
  | { me: false; kind: 'day'; label: string; time: string };

export interface Post {
  id: string;
  /** Arabic headline, set in Amiri over the cream page. */
  headline: string;
  /** The small English line beneath the karkadeh rule. */
  english: string;
  /** The conversation that types itself into the phone. */
  script: Bubble[];
  /** Seconds the finished reel runs. */
  seconds?: number;
  /** The phone's status-bar clock — set it when the scene's time IS the story (default 9:41). */
  clock?: string;
  /** The end card's answer to the headline's question — the hook asks, this pays off. */
  payoff?: string;
}

export const POSTS: Record<string, Post> = {
  // 1 · Ordering inside WhatsApp — the whole order in one thread
  '1A': {
    id: '1A',
    headline: 'الطلب خلص في دقيقتين',
    english: 'A full order, start to finish, in one chat.',
    script: [
      { me: true, kind: 'text', text: 'عايز مُنادم كلاسيك برجر ساندوتش تيك أواي', time: '10:30' },
      { me: false, kind: 'text', text: 'مُنادم كلاسيك برجر ساندوتش — 195 EGP\nأأكد الأوردر؟', time: '10:31' },
      { me: true, kind: 'text', text: 'تأكيد', time: '10:31' },
      { me: false, kind: 'text', text: 'طلبك O-4TBC اتسجل — حوالي ١٥ دقيقة', time: '10:32' },
    ],
  },

  // 2 · It speaks the way Egyptians type — the messy-typing hero shot
  '2B': {
    id: '2B',
    headline: 'كتبها فرانكو ومليانة أخطاء… هيفهم؟',
    english: 'Franco, full of typos. Will it get it?',
    payoff: 'فهم.\nزي ما كتبتها بالظبط.',
    script: [
      { me: true, kind: 'text', text: 'momken tshil el me5alel w 5aleehom etnen', time: '8:14' },
      { me: false, kind: 'text', text: 'Tamam — 2× Munadim Classic Burger (Sandwich · من غير مخلل)\nالإجمالي: 390 جنيه', time: '8:14' },
    ],
  },

  // 3 · It never invents anything — the honest answer
  '3A': {
    id: '3A',
    headline: 'بيقول «مش موجود» بدل ما يخترع',
    english: "It says 'we don't have that' instead of inventing it.",
    script: [
      { me: true, kind: 'text', text: 'do you have Pepsi?', time: '7:02' },
      { me: false, kind: 'text', text: 'معندناش بيبسي 🙏 — اللي عندنا: مُنادم كركديه · مشروب غازي', time: '7:02' },
    ],
  },

  // 4 · Delivery priced by real distance — pin to price
  '4A': {
    id: '4A',
    headline: 'السعر على المسافة، مش تخمين',
    english: 'Priced by the real distance, not a guess.',
    script: [
      { me: true, kind: 'location', time: '9:20' },
      {
        me: false, kind: 'bill', time: '9:20',
        lines: [['مُنادم كلاسيك برجر', '195'], ['التوصيل (~٦.٢ كم)', '57']],
        total: ['الإجمالي', '252'], after: 'كاش ولا فيزا؟',
      },
    ],
  },

  // 5 · Check Split — the split, on screen
  '5A': {
    id: '5A',
    headline: 'الحساب جه… مين عليه كام؟',
    english: 'The bill is here. Who owes what?',
    payoff: 'كل واحد عرف نصيبه.\nمن غير خناقة.',
    script: [
      { me: true, kind: 'text', text: 'قسّم الحساب — عمر أخد الناشفيل والكركديه، وأحمد الفرايز', time: '10:05' },
      {
        me: false, kind: 'bill', time: '10:05',
        lines: [['تقسيم الحساب', ''], ['عمر', '222.50'], ['أحمد', '107.50']],
        total: ['إجمالي الفاتورة', '330'],
      },
    ],
  },

  // 6 · Every option, exactly as asked — the hard order, handled
  '6A': {
    id: '6A',
    headline: 'بيفهم الطلبات المعقدة',
    english: 'It gets complicated orders right.',
    script: [
      { me: true, kind: 'text', text: '3 munadim nashville chicken, 2 hot w wa7ed mild', time: '9:12' },
      {
        me: false, kind: 'bill', time: '9:12',
        lines: [['2× ناشفيل تشيكن · حار 🔥', '420'], ['1× ناشفيل تشيكن · ميلد', '210']],
        total: ['الإجمالي', '630'], after: 'أأكد الأوردر؟',
      },
    ],
  },

  // 7 · Receipt, ticket and live tracking — the status card
  '7A': {
    id: '7A',
    headline: 'بيعرف طلبه فين من غير ما يتصل',
    english: 'They can see where it is without calling.',
    script: [
      { me: true, kind: 'text', text: 'الأوردر وصل فين؟', time: '9:46' },
      {
        me: false, kind: 'status', code: 'O-CGTW', ago: 'من ٣ دقايق', time: '9:46',
        steps: [['استلمنا الطلب', true], ['المطبخ بيحضّر', true], ['جاهز للاستلام', false]],
      },
    ],
  },

  // 11 · The usual, in one tap — two messages, done
  '11A': {
    id: '11A',
    headline: 'الزبون الدايم بيطلب بكلمة',
    english: 'Regulars order in one word.',
    script: [
      { me: true, kind: 'text', text: 'نفس الطلب', time: '8:40' },
      {
        me: false, kind: 'bill', time: '8:40',
        lines: [['مُنادم كلاسيك برجر (كومبو)', '265'], ['مُنادم كركديه', '45']],
        total: ['الإجمالي', '310'], after: 'أأكد؟',
      },
    ],
  },

  // 12 · A human takes over when needed — the handoff
  '12A': {
    id: '12A',
    headline: 'لما يحتاج إنسان، بيوصلك',
    english: 'When it needs a human, it calls one.',
    script: [
      { me: true, kind: 'text', text: 'ممكن أغيّر العنوان بعد ما أكدت؟', time: '9:58' },
      { me: false, kind: 'text', text: 'هجيبلك حد من الفريق يساعدك — لحظة 🙏', time: '9:58' },
    ],
  },

  // 12B · the honest limit
  '12B': {
    id: '12B',
    headline: 'بيقول الحقيقة، ما بيوعدش بحاجة ما يقدرش عليها',
    english: "It tells the truth instead of promising what it can't do.",
    script: [
      { me: true, kind: 'text', text: 'ألغي الأوردر لو سمحت', time: '10:11' },
      { me: false, kind: 'text', text: 'الطلب خلاص مع المطبخ — بلغنا الفريق وهيساعدوك', time: '10:11' },
    ],
  },

  // 9B · the 3 a.m. order
  '9B': {
    id: '9B',
    headline: 'رسالة الساعة ٣ الفجر…',
    english: 'A message at 3 a.m.',
    clock: '3:12',
    payoff: 'المطعم قافل.\nوالأوردر متسجّل للصبح.',
    script: [
      { me: true, kind: 'text', text: 'لسه فاتحين؟ عايز كلاسيك برجر', time: '٣:١٢ ص' },
      { me: false, kind: 'text', text: 'إحنا فاتحين لحد ٢ بالليل 🙏 — بس سجّلت طلبك لأول ما نفتح ١٠ الصبح، أأكد؟', time: '٣:١٢ ص' },
    ],
  },

  // 1B · No app, no signup — the objection, answered
  '1B': {
    id: '1B',
    headline: 'لازم تنزّل تطبيق عشان تطلب؟',
    english: 'Do you need an app to order?',
    payoff: 'لأ.\nواتساب وبس.',
    script: [
      { me: true, kind: 'text', text: 'عندكم أبليكيشن أنزله؟', time: '6:21' },
      { me: false, kind: 'text', text: 'لا خالص 🙏 — الطلب كله من هنا، من غير تطبيق ولا تسجيل.\nقولّي تحب تطلب إيه.', time: '6:21' },
    ],
  },

  // 2A · It answers in the language you write in
  '2A': {
    id: '2A',
    headline: 'بيرد بنفس اللي بتكتب بيه',
    english: 'It answers in the language you write in.',
    script: [
      { me: true, kind: 'text', text: '3ayez 2 burger w fries', time: '7:40' },
      { me: false, kind: 'text', text: 'Tamam — 2× Munadim Classic Burger (Sandwich) + Munadim Fries.\nEl total: 445 EGP', time: '7:40' },
      { me: true, kind: 'text', text: 'عايز ٢ برجر وبطاطس', time: '7:41' },
      { me: false, kind: 'text', text: 'تمام — ٢× مُنادم كلاسيك برجر (ساندوتش) + مُنادم بطاطس.\nالإجمالي: 445 جنيه', time: '7:41' },
      { me: true, kind: 'text', text: 'I want 2 burgers and fries', time: '7:42' },
      { me: false, kind: 'text', text: 'Got it — 2× Munadim Classic Burger (Sandwich) + Munadim Fries.\nTotal: 445 EGP', time: '7:42' },
    ],
  },

  // 3B · Every number comes from your menu
  '3B': {
    id: '3B',
    headline: 'كل رقم بيقوله من المنيو بتاعك',
    english: 'Every number comes from your menu.',
    script: [
      { me: true, kind: 'text', text: 'بكام الترافل برجر كومبو؟', time: '8:05' },
      { me: false, kind: 'text', text: 'مُنادم ترافل برجر (كومبو: بطاطس + مشروب) — 335 جنيه 🙂', time: '8:05' },
    ],
  },

  // 4B · It refuses an order it cannot deliver
  '4B': {
    id: '4B',
    headline: 'بيرفض الطلب اللي مش هيوصل',
    english: "It refuses an order it can't deliver.",
    script: [
      { me: true, kind: 'text', text: 'عايز دليفري المعادي', time: '9:02' },
      { me: false, kind: 'text', text: 'بنوصل التجمع والقاهرة الجديدة بس 🙏 — التيك أواي جاهز دايمًا من بوينت ٩٠.', time: '9:02' },
    ],
  },

  // 5B · the split, three ways, no paper
  '5B': {
    id: '5B',
    headline: 'من غير حسابات ولا ورقة وقلم',
    english: 'No maths, no napkin.',
    script: [
      { me: true, kind: 'text', text: 'قسّم على ٣ — عمر الكلاسيك والكركديه، أحمد الكلاسيك والبطاطس، سارة الناشفيل', time: '10:18' },
      {
        me: false, kind: 'bill', time: '10:18',
        lines: [['عمر', '240'], ['أحمد', '250'], ['سارة', '210']],
        total: ['إجمالي الفاتورة', '700'],
      },
    ],
  },

  // 6B · the notes reach the kitchen right
  '6B': {
    id: '6B',
    headline: 'الملاحظات بتوصل للمطبخ صح',
    english: 'The notes reach the kitchen exactly as asked.',
    script: [
      { me: true, kind: 'text', text: 'كلاسيك برجر ساندوتش من غير مخلل ومن غير بصل', time: '8:33' },
      {
        me: false, kind: 'bill', time: '8:33',
        lines: [['1× مُنادم كلاسيك برجر · من غير مخلل · من غير بصل', '195']],
        total: ['الإجمالي', '195'], after: 'أأكد الأوردر؟',
      },
    ],
  },

  // 7B · a real receipt on every order
  '7B': {
    id: '7B',
    headline: 'إيصال رسمي لكل طلب',
    english: 'A real receipt on every order.',
    script: [
      { me: true, kind: 'text', text: 'ممكن الفاتورة؟', time: '9:58' },
      { me: false, kind: 'text', text: 'اتفضل 📄 — إيصال طلب O-7D9V\nمُنادم · بوينت ٩٠ · الإجمالي 195 جنيه\n_الأسعار شاملة الضريبة._', time: '9:58' },
    ],
  },

  // 9A · at the rush, nobody waits
  '9A': {
    id: '9A',
    headline: 'وقت الزحمة، محدش بيستنى',
    english: 'At the rush, nobody waits.',
    script: [
      { me: true, kind: 'text', text: 'ناشفيل ساندوتش تيك أواي', time: '9:47 م' },
      {
        me: false, kind: 'bill', time: '9:47 م',
        lines: [['1× مُنادم ناشفيل تشيكن (ساندوتش)', '210']],
        total: ['الإجمالي', '210'], after: 'إحنا في الزحمة دلوقتي — الوقت المتوقع ٤٥ دقيقة. أأكد؟',
      },
    ],
  },

  // 11B · it remembers your favourite
  '11B': {
    id: '11B',
    headline: 'بيفتكر طلبك المفضل',
    english: 'It remembers your favourite.',
    script: [
      { me: true, kind: 'text', text: 'المعتاد', time: '7:12' },
      {
        me: false, kind: 'bill', time: '7:12',
        lines: [['مُنادم ناشفيل تشيكن (كومبو)', '280'], ['مُنادم أم علي', '80']],
        total: ['الإجمالي', '360'], after: 'زي كل مرة — أأكد؟',
      },
    ],
  },

  // 13A · scan and order
  '13A': {
    id: '13A',
    headline: 'امسح واطلب',
    english: 'Scan and order.',
    script: [
      { me: true, kind: 'text', text: 'طلب من ترابيزة ٧', time: '8:50' },
      { me: false, kind: 'text', text: 'أهلاً 🙏 ترابيزة ٧ — تحب تطلب إيه؟', time: '8:50' },
      { me: true, kind: 'text', text: 'كلاسيك برجر كومبو', time: '8:51' },
      {
        me: false, kind: 'bill', time: '8:51',
        lines: [['1× مُنادم كلاسيك برجر (كومبو)', '265']],
        total: ['الإجمالي', '265'], after: 'في المطعم · ترابيزة ٧ — أأكد؟',
      },
    ],
  },

  // R1 · 11:47 p.m. — will anyone answer? (open late, answered at once)
  'R1': {
    id: 'R1',
    headline: '١١:٤٧ بالليل… حد هيرد؟',
    english: '11:47 p.m. Will anyone answer?',
    clock: '11:47',
    payoff: 'رد على طول.\nوالأوردر اتأكد.',
    script: [
      { me: true, kind: 'text', text: 'لسه فاتحين؟ عايز كلاسيك برجر', time: '١١:٤٧' },
      { me: false, kind: 'text', text: 'أهلاً 🙏 — مُنادم كلاسيك برجر ساندوتش 195 جنيه. أأكد؟', time: '١١:٤٧' },
      { me: true, kind: 'text', text: 'تأكيد', time: '١١:٤٨' },
      { me: false, kind: 'text', text: 'طلبك O-9F2K اتسجل — حوالي ١٥ دقيقة 🤍', time: '١١:٤٨' },
    ],
  },

  // R4 · the messy order that builds itself into a clean bill
  'R4': {
    id: 'R4',
    headline: 'أوردر ملخبط… شوف حصل إيه',
    english: 'A messy order. Watch.',
    payoff: '٤ أصناف.\nفاتورة واحدة مظبوطة.',
    script: [
      { me: true, kind: 'text', text: 'عايز ٢ ناشفيل حار وواحد كلاسيك وبطاطس وكركديه', time: '9:40' },
      {
        me: false, kind: 'bill', time: '9:40',
        lines: [['2× مُنادم ناشفيل تشيكن · حار 🔥', '420'], ['1× مُنادم كلاسيك برجر', '195'], ['مُنادم بطاطس', '55'], ['مُنادم كركديه', '45']],
        total: ['الإجمالي', '715'], after: 'أأكد الأوردر؟',
      },
    ],
  },

  // R6 · it gets your slang — "same as yesterday, add something cold"
  'R6': {
    id: 'R6',
    headline: '«نفس طلب امبارح»… هيفهم؟',
    english: '"Same as yesterday." Will it get it?',
    payoff: 'فهم.\nبالمصري.',
    script: [
      { me: true, kind: 'text', text: 'نفس طلب امبارح وزوّدلي حاجة ساقعة', time: '8:14' },
      { me: false, kind: 'text', text: 'تمام 🙏 — مُنادم ناشفيل تشيكن (كومبو) + مُنادم كركديه ساقع\nالإجمالي: 325 جنيه', time: '8:14' },
    ],
  },

  // R7 · will this customer come back? — the returning guest is recognised (real guest memory)
  'R7': {
    id: 'R7',
    headline: 'الزبون ده هيرجع تاني؟',
    english: 'Will this customer come back?',
    payoff: 'رجع.\nلأن رقمه عندك إنت،\nمش عند التطبيق.',
    script: [
      { me: true, kind: 'text', text: 'كلاسيك برجر كومبو تيك أواي', time: '8:40' },
      { me: false, kind: 'text', text: 'تمام — مُنادم كلاسيك برجر (كومبو) 265 جنيه. أأكد؟', time: '8:40' },
      { me: false, kind: 'day', label: 'بعد أسبوع', time: '' },
      { me: true, kind: 'text', text: 'مساء الخير', time: '8:52' },
      { me: false, kind: 'text', text: 'أهلاً بيك تاني 🤍 كلاسيك برجر كومبو زي المرة اللي فاتت؟', time: '8:52' },
      { me: true, kind: 'text', text: 'أيوه 🙏', time: '8:53' },
    ],
  },
};

export const POST_IDS = Object.keys(POSTS);
