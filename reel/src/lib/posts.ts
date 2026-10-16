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
  /** A bot message exactly as the live bot sent it — *bold*, _italic_, ―― rules, • bullets.
   *  `buttons` are its WhatsApp reply buttons; `list` is the label of its list-message row. */
  | { me: false; kind: 'text'; text: string; time: string; buttons?: string[]; list?: string }
  /** A document the bot sent (the PDF receipt, the menu). */
  | { me: false; kind: 'doc'; name: string; time: string; caption?: string }
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
  /** The diner's phone language. 'en' puts the guest's own messages on the right (LTR UI) —
   *  right for Franco / English guests. Default 'ar' (RTL UI, own messages on the left). */
  ui?: 'ar' | 'en';
  /** A real conversation recorded from the live bot (flows/_reel.mjs) — chat name/avatar are the restaurant's. */
  real?: boolean;
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

  // R1 · REAL conversation recorded from the live bot (R1.json) — bot text verbatim
  'R1': {
    id: 'R1',
    headline: "١١:٤٧ بالليل… حد هيرد؟",
    english: "11:47 p.m. Will anyone answer?",
    payoff: "رد على طول.\nوالأوردر اتأكد.",
    real: true,
    ui: 'ar',
    clock: '11:47',
    script: [
      { me: true, kind: 'text', text: "مساء الخير، عايز كلاسيك برجر كومبو", time: '11:47' },
      { me: false, kind: 'text', text: "اختيارات سريعة لـ *مُنادم كلاسيك برجر* — ممكن تجاوب كلها مرة واحدة 👇\n\nمشروب الكومبو:\n• كوكاكولا\n• كوكاكولا دايت\n• سبرايت\n• فانتا\n• مُنادم كركديه\n\n――――――――――――――――――――――――\n• 1× *مُنادم كلاسيك برجر* (كومبو (بطاطس + مشروب)) — 265 EGP\nالإجمالي الجزئي: 265 EGP\n――――――――――――――――――――――――", time: '11:47', list: "View options 🍽" },
      { me: true, kind: 'text', text: "كوكاكولا", time: '11:48' },
      { me: false, kind: 'text', text: "قربنا نخلص — آخر تفاصيل بس 👇\n\nتحب طلبك يكون إزاي؟\n• في المطعم (Dine-in)\n• تيك أواي (Pickup)\n• دليفري (Delivery)\n\n――――――――――――――――――――――――\n• 1× *مُنادم كلاسيك برجر* (كومبو (بطاطس + مشروب) · كوكاكولا) — 265 EGP\nالإجمالي الجزئي: 265 EGP\n――――――――――――――――――――――――", time: '11:48' },
      { me: true, kind: 'text', text: "تيك أواي، كاش", time: '11:49' },
      { me: false, kind: 'text', text: "هتعدي علينا امتى؟ 🕐 طلبك بياخد حوالي 15 دقيقة — قول \"دلوقتي\" أو \"بعد نص ساعة\" أو معاد\n\n――――――――――――――――――――――――\n• 1× *مُنادم كلاسيك برجر* (كومبو (بطاطس + مشروب) · كوكاكولا) — 265 EGP\nالإجمالي الجزئي: 265 EGP\n――――――――――――――――――――――――", time: '11:49' },
      { me: true, kind: 'text', text: "دلوقتي", time: '11:50' },
      { me: false, kind: 'text', text: "🧾 *طلبك*\n――――――――――――――――――――――――\n• 1× *مُنادم كلاسيك برجر* (كومبو (بطاطس + مشروب) · كوكاكولا) — 265 EGP\n――――――――――――――――――――――――\nالإجمالي الجزئي: 265 EGP\n*الإجمالي المطلوب: 265 EGP*\n_الأسعار شاملة الضريبة._\n――――――――――――――――――――――――\nتيك أواي\n💳 كاش\n\n🍟 تحب تضيف حاجة؟ *مُنادم لودد فرايز* (105 EGP) · *مُنادم أم علي* (80 EGP) — قول الاسم، أو أكد الطلب زي ما هو ✅\n\nكله تمام — أكد وهيروح للمطبخ على طول ✅", time: '11:50', buttons: ["تأكيد ✅", "عدّل حاجة"] },
      { me: true, kind: 'text', text: "تأكيد", time: '11:51' },
      { me: false, kind: 'doc', name: "O-RSTJ.pdf", time: '11:51', caption: "🎫 طلبك O-RSTJ اتسجل — حوالي 24 دقيقة!" },
    ],
  },

  // R6 · REAL conversation recorded from the live bot (R6y.json) — bot text verbatim
  'R6': {
    id: 'R6',
    headline: "«نفس طلب امبارح»… هيفهم؟",
    english: "\"Same as yesterday.\" Will it get it?",
    payoff: "فهم.\nوفاكر طلبك.",
    real: true,
    ui: 'ar',
    script: [
      { me: true, kind: 'text', text: "نفس طلب امبارح", time: '8:14' },
      { me: false, kind: 'text', text: "قربنا نخلص — آخر تفاصيل بس 👇\n\nهتعدي علينا امتى؟ 🕐 طلبك بياخد حوالي 15 دقيقة — قول \"دلوقتي\" أو \"بعد نص ساعة\" أو معاد\n\nوهتدفع إزاي؟ 💳\n• كاش في الكاونتر\n• كارت\n• انستاباي\n(ممكن تجاوب على كله في رسالة واحدة 😄)\n\n――――――――――――――――――――――――\n• 1× *مُنادم ناشفيل تشيكن* (كومبو (بطاطس + مشروب) · مُنادم كركديه · حار 🔥) — 280 EGP\nالإجمالي الجزئي: 280 EGP\n――――――――――――――――――――――――", time: '8:14' },
      { me: true, kind: 'text', text: "دلوقتي، كاش", time: '8:15' },
      { me: false, kind: 'text', text: "🧾 *طلبك*\n――――――――――――――――――――――――\n• 1× *مُنادم ناشفيل تشيكن* (كومبو (بطاطس + مشروب) · مُنادم كركديه · حار 🔥) — 280 EGP\n――――――――――――――――――――――――\nالإجمالي الجزئي: 280 EGP\n*الإجمالي المطلوب: 280 EGP*\n_الأسعار شاملة الضريبة._\n――――――――――――――――――――――――\nتيك أواي\n💳 كاش\n\n🍟 تحب تضيف *مُنادم أم علي* (80 EGP)؟ — أو أكد الطلب زي ما هو ✅\n\nكله تمام — أكد وهيروح للمطبخ على طول ✅", time: '8:15', buttons: ["تأكيد ✅", "عدّل حاجة"] },
      { me: true, kind: 'text', text: "تأكيد", time: '8:16' },
      { me: false, kind: 'doc', name: "O-HKR8.pdf", time: '8:16', caption: "🎫 طلبك O-HKR8 اتسجل — حوالي 33 دقيقة!" },
    ],
  },

  // R7 · REAL conversation recorded from the live bot (R7.json) — bot text verbatim
  'R7': {
    id: 'R7',
    headline: "الزبون ده هيرجع تاني؟",
    english: "Will this customer come back?",
    payoff: "رجع — والمطعم فاكر اسمه وطلبه.\nرقمه عندك إنت، مش عند التطبيق.",
    real: true,
    ui: 'ar',
    script: [
      { me: true, kind: 'text', text: "تأكيد", time: '8:40' },
      { me: false, kind: 'doc', name: "O-T9Y7.pdf", time: '8:40', caption: "🎫 طلبك O-T9Y7 اتسجل — حوالي 21 دقيقة!" },
      { me: false, kind: 'day', label: "بعد أسبوع", time: '' },
      { me: true, kind: 'text', text: "مساء الخير", time: '8:52' },
      { me: false, kind: 'text', text: "أهلاً يا أحمد! 👋 زي المرة اللي فاتت — *مُنادم كلاسيك برجر*؟ أو شوف المنيو.", time: '8:52', buttons: ["زي المرة اللي فاتت 🔁", "اطلب دلوقتي", "المنيو"] },
      { me: true, kind: 'text', text: "زي المرة اللي فاتت 🔁", time: '8:53' },
      { me: false, kind: 'text', text: "قربنا نخلص — آخر تفاصيل بس 👇\n\nهتعدي علينا امتى؟ 🕐 طلبك بياخد حوالي 15 دقيقة — قول \"دلوقتي\" أو \"بعد نص ساعة\" أو معاد\n\nوهتدفع إزاي؟ 💳\n• كاش في الكاونتر\n• كارت\n• انستاباي\n(ممكن تجاوب على كله في رسالة واحدة 😄)\n\n――――――――――――――――――――――――\n• 1× *مُنادم كلاسيك برجر* (كومبو (بطاطس + مشروب) · كوكاكولا) — 265 EGP\nالإجمالي الجزئي: 265 EGP\n――――――――――――――――――――――――", time: '8:53' },
      { me: true, kind: 'text', text: "دلوقتي، كاش", time: '8:54' },
      { me: false, kind: 'text', text: "🧾 *طلبك*\n――――――――――――――――――――――――\n• 1× *مُنادم كلاسيك برجر* (كومبو (بطاطس + مشروب) · كوكاكولا) — 265 EGP\n――――――――――――――――――――――――\nالإجمالي الجزئي: 265 EGP\n*الإجمالي المطلوب: 265 EGP*\n_الأسعار شاملة الضريبة._\n――――――――――――――――――――――――\nتيك أواي\n💳 كاش\n\n🍟 تحب تضيف حاجة؟ *مُنادم لودد فرايز* (105 EGP) · *مُنادم أم علي* (80 EGP) — قول الاسم، أو أكد الطلب زي ما هو ✅\n\nكله تمام — أكد وهيروح للمطبخ على طول ✅", time: '8:54', buttons: ["تأكيد ✅", "عدّل حاجة"] },
      { me: true, kind: 'text', text: "تأكيد", time: '8:55' },
      { me: false, kind: 'doc', name: "O-PGR3.pdf", time: '8:55', caption: "🎫 طلبك O-PGR3 اتسجل — حوالي 24 دقيقة!" },
    ],
  },

  // 2B · REAL conversation recorded from the live bot (2B.json) — bot text verbatim
  '2B': {
    id: '2B',
    headline: "كتبها فرانكو… هيفهم؟",
    english: "Typed in Franco. Will it get it?",
    payoff: "فهم.\nوردّ بالفرانكو.",
    real: true,
    ui: 'en',
    script: [
      { me: true, kind: 'text', text: "momken 2 classic burger sandwich men gher me5alel", time: '8:14' },
      { me: false, kind: 'text', text: "2arabna nekhlas — akher tafaseel bas 👇\n\nTe7eb el order ezay?\n• Dine-in\n• Pickup\n• Delivery\n\n――――――――――――――――――――――――\n• 2× *Munadim Classic Burger* (Sandwich · no pickles) — 390 EGP\nSubtotal: 390 EGP\n――――――――――――――――――――――――", time: '8:14', buttons: ["Dine-in", "Pickup", "Delivery"] },
      { me: true, kind: 'text', text: "takeaway, cash", time: '8:15' },
      { me: false, kind: 'text', text: "Hat3ady emta? 🕐 El order byakhod ~15 d2ay2 — 2ol \"delwa2ty\" aw \"ba3d nos sa3a\"\n\n――――――――――――――――――――――――\n• 2× *Munadim Classic Burger* (Sandwich · no pickles) — 390 EGP\nSubtotal: 390 EGP\n――――――――――――――――――――――――", time: '8:15' },
      { me: true, kind: 'text', text: "delwa2ty", time: '8:16' },
      { me: false, kind: 'text', text: "🧾 *YOUR ORDER*\n――――――――――――――――――――――――\n• 2× *Munadim Classic Burger* (Sandwich · no pickles) — 390 EGP\n――――――――――――――――――――――――\nSubtotal: 390 EGP\n*Total Due: 390 EGP*\n_Prices are VAT inclusive._\n――――――――――――――――――――――――\nPickup\n💳 Cash\n\n🍟 Tedif 7aga? *Munadim Loaded Fries* (105 EGP) · *Munadim Om Ali* (80 EGP) · *Munadim Karkadeh* (45 EGP) — 2ol el esm, aw akked el order zay ma howa ✅\n\nKolo tamam — akked w hayro7 lel kitchen ✅", time: '8:16', buttons: ["Confirm ✅", "Change something"] },
      { me: true, kind: 'text', text: "akked", time: '8:17' },
      { me: false, kind: 'doc', name: "O-G7CZ.pdf", time: '8:17', caption: "🎫 Orderak O-G7CZ etsagel — 7awaly 18 d2ee2a!\nReady in ~18 min ⏱" },
    ],
  },

  // R4 · REAL conversation recorded from the live bot (R4y.json) — bot text verbatim
  'R4': {
    id: 'R4',
    headline: "٤ حاجات في رسالة واحدة… هيلخبط؟",
    english: "Four things in one message. Will it slip?",
    payoff: "ولا غلطة.\nفاتورة واحدة مظبوطة.",
    real: true,
    ui: 'ar',
    script: [
      { me: true, kind: 'text', text: "عايز ٢ ناشفيل حار ساندوتش، وواحد كلاسيك كومبو بكوكاكولا، وبطاطس", time: '9:40' },
      { me: false, kind: 'text', text: "قربنا نخلص — آخر تفاصيل بس 👇\n\nتحب طلبك يكون إزاي؟\n• في المطعم (Dine-in)\n• تيك أواي (Pickup)\n• دليفري (Delivery)\n\n――――――――――――――――――――――――\n• 2× *مُنادم ناشفيل تشيكن* (ساندوتش · حار 🔥) — 420 EGP\n• 1× *مُنادم كلاسيك برجر* (كومبو (بطاطس + مشروب) · كوكاكولا) — 265 EGP\n• 1× *مُنادم بطاطس* — 55 EGP\nالإجمالي الجزئي: 740 EGP\n――――――――――――――――――――――――", time: '9:40', buttons: ["في المطعم", "تيك أواي", "دليفري"] },
      { me: true, kind: 'text', text: "تيك أواي، كاش", time: '9:41' },
      { me: false, kind: 'text', text: "هتعدي علينا امتى؟ 🕐 طلبك بياخد حوالي 15 دقيقة — قول \"دلوقتي\" أو \"بعد نص ساعة\" أو معاد\n\n――――――――――――――――――――――――\n• 2× *مُنادم ناشفيل تشيكن* (ساندوتش · حار 🔥) — 420 EGP\n• 1× *مُنادم كلاسيك برجر* (كومبو (بطاطس + مشروب) · كوكاكولا) — 265 EGP\n• 1× *مُنادم بطاطس* — 55 EGP\nالإجمالي الجزئي: 740 EGP\n――――――――――――――――――――――――", time: '9:41' },
      { me: true, kind: 'text', text: "دلوقتي", time: '9:42' },
      { me: false, kind: 'text', text: "🧾 *طلبك*\n――――――――――――――――――――――――\n• 2× *مُنادم ناشفيل تشيكن* (ساندوتش · حار 🔥) — 420 EGP\n• 1× *مُنادم كلاسيك برجر* (كومبو (بطاطس + مشروب) · كوكاكولا) — 265 EGP\n• 1× *مُنادم بطاطس* — 55 EGP\n――――――――――――――――――――――――\nالإجمالي الجزئي: 740 EGP\n*الإجمالي المطلوب: 740 EGP*\n_الأسعار شاملة الضريبة._\n――――――――――――――――――――――――\nتيك أواي\n💳 كاش\n\n🍟 تحب تضيف حاجة؟ *مُنادم لودد فرايز* (105 EGP) · *مُنادم أم علي* (80 EGP) — قول الاسم، أو أكد الطلب زي ما هو ✅\n\nكله تمام — أكد وهيروح للمطبخ على طول ✅", time: '9:42', buttons: ["تأكيد ✅", "عدّل حاجة"] },
      { me: true, kind: 'text', text: "تأكيد", time: '9:43' },
      { me: false, kind: 'doc', name: "O-593F.pdf", time: '9:43', caption: "🎫 طلبك O-593F اتسجل — حوالي 39 دقيقة!" },
    ],
  },

  // 5A · REAL conversation recorded from the live bot (5Aw.json) — bot text verbatim
  '5A': {
    id: '5A',
    headline: "الحساب جه… مين عليه كام؟",
    english: "The bill is here. Who owes what?",
    payoff: "كل واحد عرف نصيبه.\nمن غير خناقة.",
    real: true,
    ui: 'ar',
    script: [
      { me: true, kind: 'text', text: "عايز ناشفيل ساندوتش وكلاسيك ساندوتش وبطاطس، إحنا في المطعم ترابيزة T3", time: '10:05' },
      { me: false, kind: 'text', text: "تمام — في المطعم ✅\n\nاختيارات سريعة لـ *مُنادم ناشفيل تشيكن* — ممكن تجاوب كلها مرة واحدة 👇\n\nمستوى الحرارة:\n• خفيف\n• وسط\n• حار 🔥\n\n――――――――――――――――――――――――\n• 1× *مُنادم ناشفيل تشيكن* (ساندوتش) — 210 EGP\n• 1× *مُنادم كلاسيك برجر* (ساندوتش) — 195 EGP\n• 1× *مُنادم بطاطس* — 55 EGP\nالإجمالي الجزئي: 460 EGP\n――――――――――――――――――――――――", time: '10:05', buttons: ["خفيف", "وسط", "حار 🔥"] },
      { me: true, kind: 'text', text: "حار", time: '10:06' },
      { me: false, kind: 'text', text: "تحب تدفع إزاي؟\n• كاش عند الكاشير\n• كارت عند الكاشير\n• لينك أونلاين\n\n🧾 *طلبك*\n――――――――――――――――――――――――\n• 1× *مُنادم ناشفيل تشيكن* (ساندوتش · حار 🔥) — 210 EGP\n• 1× *مُنادم كلاسيك برجر* (ساندوتش) — 195 EGP\n• 1× *مُنادم بطاطس* — 55 EGP\n――――――――――――――――――――――――\nالإجمالي الجزئي: 460 EGP\n*الإجمالي المطلوب: 460 EGP*\n_الأسعار شاملة الضريبة._\n――――――――――――――――――――――――\nفي المطعم · ترابيزة T3", time: '10:06', buttons: ["Cash", "Card", "Online"] },
      { me: true, kind: 'text', text: "كاش", time: '10:07' },
      { me: false, kind: 'text', text: "🧾 *طلبك*\n――――――――――――――――――――――――\n• 1× *مُنادم ناشفيل تشيكن* (ساندوتش · حار 🔥) — 210 EGP\n• 1× *مُنادم كلاسيك برجر* (ساندوتش) — 195 EGP\n• 1× *مُنادم بطاطس* — 55 EGP\n――――――――――――――――――――――――\nالإجمالي الجزئي: 460 EGP\n*الإجمالي المطلوب: 460 EGP*\n_الأسعار شاملة الضريبة._\n――――――――――――――――――――――――\nفي المطعم · ترابيزة T3\n💳 كاش\n\n🍟 تحب تضيف حاجة؟ *مُنادم لودد فرايز* (105 EGP) · *مُنادم أم علي* (80 EGP) · *مُنادم كركديه* (45 EGP) — قول الاسم، أو أكد الطلب زي ما هو ✅\n\nكله تمام — أكد وهيروح للمطبخ على طول ✅", time: '10:07', buttons: ["تأكيد ✅", "عدّل حاجة"] },
      { me: true, kind: 'text', text: "تأكيد", time: '10:08' },
      { me: false, kind: 'doc', name: "O-HWNM.pdf", time: '10:08', caption: "🎫 طلبك O-HWNM اتسجل — حوالي 45 دقيقة!" },
      { me: true, kind: 'text', text: "ممكن تقسّم الحساب؟", time: '10:09' },
      { me: false, kind: 'text', text: "ثانية واحدة — اتفضل المنيو 📄 عشان تختار من الحقيقي.\n\nقولّي تحب تطلب إيه وأنا أكمّل معاك.\n\n🧮 *تقسيم الحساب* · O-HWNM\n\nقوللي مين خد إيه وأنا أحسب نصيب كل واحد — مثلاً: «عمر خد البرجر والكولا، أحمد خد الباستا».\n\n*لسه متقسمش*\n  • 1× مُنادم ناشفيل تشيكن — 210 EGP\n  • 1× مُنادم كلاسيك برجر — 195 EGP\n  • 1× مُنادم بطاطس — 55 EGP\n  الإجمالي: 460 EGP\n\nإجمالي الفاتورة: 460 EGP", time: '10:09', buttons: ["خلاص"] },
      { me: true, kind: 'text', text: "عمر خد الناشفيل، وأحمد خد الكلاسيك والبطاطس", time: '10:10' },
      { me: false, kind: 'text', text: "🧮 *تقسيم الحساب* · O-HWNM\n\n*عمر*\n  • 1× مُنادم ناشفيل تشيكن — 210 EGP\n  الأصناف: 210 EGP\n  *الإجمالي: 210 EGP* _(شامل الضريبة 25.79 EGP)_\n\n*أحمد*\n  • 1× مُنادم كلاسيك برجر — 195 EGP\n  • 1× مُنادم بطاطس — 55 EGP\n  الأصناف: 250 EGP\n  *الإجمالي: 250 EGP* _(شامل الضريبة 30.70 EGP)_\n\nكل حاجة اتقسمت ✅\n\nإجمالي الفاتورة: 460 EGP", time: '10:10' },
    ],
  },

  // 1B · REAL conversation recorded from the live bot (1B.json) — bot text verbatim
  '1B': {
    id: '1B',
    headline: "لازم تنزّل تطبيق عشان تطلب؟",
    english: "Do you need an app to order?",
    payoff: "لأ.\nواتساب وبس.",
    real: true,
    ui: 'ar',
    script: [
      { me: true, kind: 'text', text: "عندكم أبليكيشن أنزله؟", time: '6:21' },
      { me: false, kind: 'text', text: "حالياً مفيش أبليكيشن خاص بينا للتحميل. كل حاجة هنا على الواتساب أو في المطعم نفسه. لو حابب تطلب أو تشوف المنيو، قولي بس!", time: '6:21' },
      { me: true, kind: 'text', text: "طيب عايز مُنادم كشري كبير", time: '6:22' },
      { me: false, kind: 'text', text: "قربنا نخلص — آخر تفاصيل بس 👇\n\nتحب طلبك يكون إزاي؟\n• في المطعم (Dine-in)\n• تيك أواي (Pickup)\n• دليفري (Delivery)\n\n――――――――――――――――――――――――\n• 1× *مُنادم كشري* (كبير) — 100 EGP\nالإجمالي الجزئي: 100 EGP\n――――――――――――――――――――――――", time: '6:22', buttons: ["في المطعم", "تيك أواي", "دليفري"] },
      { me: true, kind: 'text', text: "تيك أواي، كاش", time: '6:23' },
      { me: false, kind: 'text', text: "هتعدي علينا امتى؟ 🕐 طلبك بياخد حوالي 15 دقيقة — قول \"دلوقتي\" أو \"بعد نص ساعة\" أو معاد\n\n――――――――――――――――――――――――\n• 1× *مُنادم كشري* (كبير) — 100 EGP\nالإجمالي الجزئي: 100 EGP\n――――――――――――――――――――――――", time: '6:23' },
      { me: true, kind: 'text', text: "دلوقتي", time: '6:24' },
      { me: false, kind: 'text', text: "🧾 *طلبك*\n――――――――――――――――――――――――\n• 1× *مُنادم كشري* (كبير) — 100 EGP\n――――――――――――――――――――――――\nالإجمالي الجزئي: 100 EGP\n*الإجمالي المطلوب: 100 EGP*\n_الأسعار شاملة الضريبة._\n――――――――――――――――――――――――\nتيك أواي\n💳 كاش\n\n🍟 تحب تضيف حاجة؟ *مُنادم لودد فرايز* (105 EGP) · *مُنادم أم علي* (80 EGP) · *مُنادم كركديه* (45 EGP) — قول الاسم، أو أكد الطلب زي ما هو ✅\n\nكله تمام — أكد وهيروح للمطبخ على طول ✅", time: '6:24', buttons: ["تأكيد ✅", "عدّل حاجة"] },
      { me: true, kind: 'text', text: "تأكيد", time: '6:25' },
      { me: false, kind: 'doc', name: "O-CC5T.pdf", time: '6:25', caption: "🎫 طلبك O-CC5T اتسجل — حوالي 27 دقيقة!" },
    ],
  },

  // 3A · REAL conversation recorded from the live bot (3Ay.json) — bot text verbatim
  '3A': {
    id: '3A',
    headline: "سأل على حاجة مش موجودة…",
    english: "He asked for something we don't have.",
    payoff: "قال الحقيقة.\nوعرض البديل.",
    real: true,
    ui: 'en',
    script: [
      { me: true, kind: 'text', text: "do you have Pepsi?", time: '7:02' },
      { me: false, kind: 'text', text: "We don't carry Pepsi 🙏 — what we do have: Munadim Karkadeh · Soft Drink. Want the full menu?", time: '7:02' },
      { me: true, kind: 'text', text: "ok then one classic burger combo with coca-cola", time: '7:03' },
      { me: false, kind: 'text', text: "Almost done — just the last details 👇\n\nHow would you like it?\n• Dine-in\n• Pickup\n• Delivery\n\n――――――――――――――――――――――――\n• 1× *Munadim Classic Burger* (Combo (fries + drink) · Coca - Cola) — 265 EGP\nSubtotal: 265 EGP\n――――――――――――――――――――――――", time: '7:03', buttons: ["Dine-in", "Pickup", "Delivery"] },
      { me: true, kind: 'text', text: "pickup, cash", time: '7:04' },
      { me: false, kind: 'text', text: "When are you passing by? 🕐 Your order takes ~15 min — say \"now\", \"in 30 min\", or a time\n\n――――――――――――――――――――――――\n• 1× *Munadim Classic Burger* (Combo (fries + drink) · Coca - Cola) — 265 EGP\nSubtotal: 265 EGP\n――――――――――――――――――――――――", time: '7:04' },
      { me: true, kind: 'text', text: "now", time: '7:05' },
      { me: false, kind: 'text', text: "🧾 *YOUR ORDER*\n――――――――――――――――――――――――\n• 1× *Munadim Classic Burger* (Combo (fries + drink) · Coca - Cola) — 265 EGP\n――――――――――――――――――――――――\nSubtotal: 265 EGP\n*Total Due: 265 EGP*\n_Prices are VAT inclusive._\n――――――――――――――――――――――――\nPickup\n💳 Cash\n\n🍟 Add-ons? *Munadim Loaded Fries* (105 EGP) · *Munadim Om Ali* (80 EGP) — say the name, or confirm as is ✅\n\nAll set — confirm and I'll send it to the kitchen ✅", time: '7:05', buttons: ["Confirm ✅", "Change something"] },
      { me: true, kind: 'text', text: "confirm", time: '7:06' },
      { me: false, kind: 'doc', name: "O-N9RG.pdf", time: '7:06', caption: "🎫 Order O-N9RG is in — about 36 min!" },
    ],
  },
};

export const POST_IDS = Object.keys(POSTS);
