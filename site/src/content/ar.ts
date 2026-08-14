import type { SiteContent } from './types';
import { WA_NUMBER_DISPLAY, DEMO_RESTAURANT_AR, DEMO_LABEL_AR } from '../lib/const';

/**
 * Arabic is the original. Copy source: branding/website-copy.md — finished
 * copy, section order is the argument. Do not rearrange, do not add sections.
 * The chat is a demo of the product's own register (brand-voice §Two Voices):
 * the agent speaks AS the restaurant, Egyptian Arabic, ≤1 emoji, numbers by code.
 */
export const ar: SiteContent = {
  meta: {
    title: 'منادم — قناة الطلبات المباشرة لمطعمك',
    description:
      'قناة الطلبات المباشرة لمطعمك — دليفري، تيك أواي، وصالة. كل أوردر على الواتساب بيسيبلك رقم زبونك وتاريخ طلباته.',
  },

  nav: {
    pricing: 'السعر',
    cta: 'احجز عرض',
    toggle: { label: 'English', href: '/en' },
    links: [
      { label: 'إزاي بيبدأ', href: '#how' },
      { label: 'بيفهم إزاي', href: '#features' },
      { label: 'السعر', href: '#pricing' },
    ],
  },

  hero: {
    h1: 'زباينك اللي بيطلبوا منك كل أسبوع — عندك أرقامهم؟',
    sub: 'التطبيقات بتأجّرلك زباينك. الواتساب بتاعك بيخليهم ليك.',
    ctaPrimary: 'وريني أوردر بيدخل',
    ctaSecondary: 'اعرف السعر',
    demoLabel: DEMO_LABEL_AR,
    restaurant: DEMO_RESTAURANT_AR,
    chatStatus: 'متصل',
    replay: 'شغّل تاني',
    chat: [
      { from: 'in', voice: { duration: '0:07' }, time: '9:41' },
      {
        from: 'out',
        text: 'أهلاً 👋 من برجر تحت البيت. وصلني: واحد كلاسيك برجر كومبو + فرايز تشيدر. توصيل ولا استلام؟',
        time: '9:41',
      },
      { from: 'in', text: 'دليفري. شارع 9 جنب صيدلية العزبي', time: '9:42' },
      {
        from: 'out',
        bill: {
          lines: [
            { label: 'كلاسيك برجر كومبو', price: 295 },
            { label: 'فرايز تشيدر', price: 75 },
            { label: 'التوصيل', price: 25 },
          ],
          total: { label: 'الإجمالي', price: 395 },
          after: 'كاش ولا فيزا؟',
        },
        time: '9:42',
      },
      { from: 'in', text: 'كاش، معايا 500', time: '9:43' },
      {
        from: 'out',
        text: 'تمام ✅ الباقي 105 مع الكابتن. الأوردر في المطبخ، وهيوصلك في حدود 40 دقيقة.',
        time: '9:43',
      },
    ],
  },

  problem: {
    h2: 'بتدفع عشان توصل لناس أصلاً بتعرفك',
    p1: 'كل أوردر بيجيلك من التطبيقات بياخد منك حوالي خُمس قيمته. ده منطقي أول مرة — التطبيق جابلك زبون جديد.',
    p2: 'بس الزبون اللي طلب منك تمن مرات؟ بتدفع عليه نفس العمولة كل مرة. ورقمه لسه مش عندك.',
    bar: { order: 'أوردر 150 جنيه', app: 'حوالي 30 جنيه للتطبيق' },
  },

  whatIs: {
    h2: 'قناة الطلبات المباشرة لمطعمك',
    p1: 'منادم بياخد أوردرات مطعمك على الواتساب — نفس الرقم اللي زباينك بيكلموك عليه أصلاً.',
    channels: ['دليفري', 'تيك أواي', 'صالة'],
    p2: 'كل أوردر بيسيبلك رقم تليفون وتاريخ طلبات في لوحة تحكم بتاعتك إنت.',
    // The three real outputs of one order. Content mirrors the live product;
    // restaurant + customer are fictional (decision 4).
    panels: {
      p1: 'إيصال الزبون على الواتساب',
      p2: 'التذكرة بتطلع للمطبخ',
      p3: 'والزبون بيتسجل عندك',
      receipt: {
        headline: '🎫 طلبك O-7K3M اتسجل — حوالي 20 دقيقة!',
        title: '🧾 إيصال O-7K3M',
        place: 'برجر تحت البيت — فرع المعادي',
        meta: '14/08/2026, 9:41 م · تيك أواي · المعادي',
        item: '• 1× كلاسيك برجر (كومبو (بطاطس + مشروب) · كوكاكولا) — 260 EGP',
        breakdown: 'الصافي 228.07 · الضريبة 31.93',
        total: 'الإجمالي المطلوب: 260 EGP',
        taxNote: 'الأسعار شاملة الضريبة.',
        payEta: '💳 كاش · ⏱ حوالي 20 دقيقة',
        link: '📄 flows.munadim.com/receipt/O-7K3M',
        pdfName: 'O-7K3M.pdf',
        pdfMeta: 'إيصال · PDF',
      },
      ticket: {
        head: 'TAKEAWAY · T12',
        code: 'O-7K3M',
        customer: 'Ahmed · Maadi',
        item: '1x Classic Burger',
        price: '260.00',
        mods: ['Combo (fries + drink)', 'Coca - Cola', '* no onion'],
        totalLabel: 'TOTAL',
        total: 'EGP 260.00',
        payment: 'PAYMENT: CASH — COLLECT EGP 260.00',
        track: 'TRACK YOUR ORDER ON WHATSAPP',
      },
      profile: {
        name: 'أحمد محمود',
        badge: 'راجع',
        allergy: '⚠ حساسية مكسرات',
        phone: '0100 000 4437',
        stats: [
          { value: '8', label: 'زيارات' },
          { value: '2,140', label: 'إجمالي الإنفاق EGP' },
          { value: '267', label: 'متوسط الأوردر EGP' },
        ],
        rows: [
          { label: 'آخر أوردر', text: 'من 3 أيام' },
          { label: 'الفرع', text: 'المعادي' },
          { label: 'العنوان', text: 'شارع 9، المعادي — الدور 3، شقة 7' },
        ],
        favLabel: 'أكلاته المفضلة',
        favs: ['Classic Burger', 'Loaded Fries'],
        notesLabel: 'ملاحظات',
        notes: ['بيحب من غير بصل'],
      },
    },
    // NEW UI strings — need Adel's review
    stream: {
      panelTitle: 'لوحة التحكم — الزباين',
      counter: 'زباين',
      counterOne: 'زبون',
      captured: 'كلهم في قاعدة بيانات مطعمك — تقدر توصلهم تاني',
      replay: 'شغّل تاني',
      stop: 'وقف',
      filters: ['الكل', 'جديد', 'راجع', 'دايم'],
      rows: [
        { name: 'أحمد م.', phone: '+2010•••4437', item: 'Classic Burger', channel: 0, visits: '3 زيارات', egp: 'EGP 680', ago: '2د', badge: 'راجع' },
        { name: 'منة ع.', phone: '+2011•••2210', item: 'Chicken Ranch', channel: 1, visits: 'زيارة', egp: 'EGP 270', ago: '1د', badge: 'جديد' },
        { name: 'كريم س.', phone: '+2012•••8842', item: 'Smash Double', channel: 2, visits: 'زيارتين', egp: 'EGP 500', ago: '3د', badge: 'راجع' },
      ],
    },
    flow: {
      step1: 'أوردر على الواتساب',
      step2: 'بيروح للمطبخ',
      step3: 'الزبون بيفضل عندك',
      captured: 'زبون متسجل — تقدر توصله تاني',
      record: {
        name: 'أحمد م.',
        phone: '010• ••• 4437',
        rows: [
          { label: 'آخر أوردر', value: 'كلاسيك كومبو + فرايز' },
          { label: 'بيطلبه', value: 'من غير بصل' },
          { label: 'عدد الأوردرات', value: '8' },
        ],
      },
    },
  },

  dineIn: {
    h2: 'الناس القاعدة في الصالة دلوقتي — دول أقل زباينك إنت عارفهم',
    p1: 'الدليفري على الأقل بيسيب عنوان. الصالة مبتسيبش حاجة.',
    p2: 'مع كود على الترابيزة، الزبون بيطلب من مكانه، والأوردر بيروح للمطبخ، ورقمه بيتسجل زي أي أوردر تاني.',
    qr: { scan: 'امسح واطلب من على ترابيزتك' },
    // NEW UI strings — need Adel's review
    scene: {
      step1: 'كود على الترابيزة',
      step2: 'بيمسح ويطلب من مكانه',
      step3: 'رقمه بيتسجل عندك',
      captured: 'زبون متسجل — تقدر توصله تاني',
      replay: 'شغّل تاني',
      dashTitle: 'لوحة التحكم — الزباين',
      guestName: 'أحمد م.',
      guestPhone: '010• ••• 4437',
      chips: ['ترابيزة 4', 'صالة', 'من غير بصل'],
      stats: [
        { value: '1', label: 'زيارة' },
        { value: '210', label: 'إجمالي EGP' },
        { value: '210', label: 'متوسط الأوردر' },
      ],
      noteLabel: 'ملاحظات (البوت بيقراها)',
      noteValue: 'من غير بصل',
      orderLabel: 'الأوردرات (1)',
      orderCode: 'O-2TGC',
      orderItem: '1× Truffle Shroom Burger',
      orderMeta: 'صالة · النهاردة',
      orderTotal: 'EGP 210',
      chat: [
        { from: 'in', text: 'عايز أطلب من الترابيزة' },
        { from: 'out', text: 'أهلاً 👋 إنت على ترابيزة كام؟' },
        { from: 'in', text: '4' },
        { from: 'out', text: 'تمام ✅ الأوردر راح للمطبخ.' },
      ],
    },
  },

  steps: {
    h2: '3 خطوات',
    items: [
      { title: 'ابعتلنا صور المنيو', body: 'صور بالموبايل تكفي. إحنا اللي بنبني المنيو.' },
      { title: 'إحنا بنظبط الباقي', body: 'مناطق التوصيل، الفروع، أسعار التوصيل، ورقم الواتساب.' },
      { title: 'زباينك بيطلبوا', body: 'من نفس الرقم. مفيش تطبيق يتحمّل، ومفيش جهاز جديد.' },
    ],
    // NEW UI strings — need Adel's review
    journey: {
      replay: 'شغّل تاني',
      photosCaption: 'صور بالموبايل تكفي',
      menuTitle: 'المنيو بتاعك',
      menuItems: [
        { name: 'كلاسيك برجر', price: '260' },
        { name: 'سماش دوبل', price: '290' },
        { name: 'فرايز تشيدر', price: '75' },
      ],
      setupChips: ['مناطق التوصيل', 'الفروع', 'رقم الواتساب ✓'],
      orderTitle: 'أوردر جديد — O-A101',
      orderItem: 'كلاسيك كومبو ×1',
      orderFrom: 'من نفس رقم مطعمك',
    },
  },

  understands: {
    h2: 'بيفهم زباينك زي ما بيتكلموا',
    fragments: [
      {
        head: 'فويس نوت',
        body: 'الزبون بيبعت رسالة صوت، والأوردر بيتسجل.',
        demo: { inVoice: '0:11', out: 'وصلني: 2 سماش برجر وواحد كولا. أأكد الأوردر؟' },
      },
      {
        head: 'فرانكو',
        body: 'بيكتب 3ayez burger، بيتفهم — وبيترد عليه بنفس اللغة.',
        demo: { in: '3ayez burger w batates', out: '3andena Classic w Smoky w Nashville — anhi wa7ed?' },
      },
      {
        head: 'العنوان بعلامة مميزة',
        body: '«جنب صيدلية العزبي» تنفع عنوان.',
        demo: { in: 'التجمع، جنب صيدلية العزبي شارع التسعين', out: 'اتسجل. التوصيل 30 جنيه، والوقت حوالي 45 دقيقة.' },
      },
      {
        head: 'كاش وفكة',
        body: 'معاه 200 جنيه؟ الباقي محسوب ومكتوب للكابتن.',
        demo: { in: 'كاش ومعايا 200', out: 'تمام، الباقي 38 جنيه مع الكابتن.' },
      },
      {
        head: 'أكتر من فرع',
        body: 'مناطق توصيل وأسعار توصيل ومواعيد لكل فرع لوحده، والأوردر بيروح لمطبخ الفرع الصح.',
        demo: { in: '📍 موقعي', out: 'أقرب فرع بيوصلك: فرع مدينة نصر. أبعتلك المنيو؟' },
      },
    ],

    // NEW UI strings — need Adel's review
    table: {
      sends: 'اللي الزبون بيبعته',
      gets: 'اللي بيتسجل عندك',
      replay: 'شغّل تاني',
      pairs: [
        {
          head: 'فويس نوت',
          input: { kind: 'voice', duration: '0:11' },
          fields: [
            { label: 'الطلب', value: '2 سماش برجر + كولا' },
          ],
        },
        {
          head: 'فرانكو',
          input: { kind: 'text', text: '3ayez burger w batates' },
          fields: [
            { label: 'الطلب', value: 'برجر + بطاطس' },
            { label: 'الرد', value: 'بالفرانكو برضه' },
          ],
        },
        {
          head: 'العنوان بعلامة مميزة',
          input: { kind: 'text', text: 'التجمع، جنب صيدلية العزبي شارع التسعين' },
          fields: [
            { label: 'المنطقة', value: 'التجمع' },
            { label: 'العلامة', value: 'صيدلية العزبي' },
            { label: 'التوصيل', value: '30 جنيه' },
          ],
        },
        {
          head: 'كاش وفكة',
          input: { kind: 'text', text: 'كاش ومعايا 200' },
          fields: [
            { label: 'الدفع', value: 'كاش' },
            { label: 'الباقي', value: '38 جنيه مع الكابتن' },
          ],
        },
        {
          head: 'أكتر من فرع',
          input: { kind: 'location', text: 'موقعي' },
          fields: [
            { label: 'الفرع', value: 'مدينة نصر' },
            { label: 'التوصيل', value: '20 جنيه' },
          ],
        },
      ],
    },
  },

  pricing: {
    h2: 'السعر واضح، ومفيش عمولة على الأوردر',
    rows: { monthly: 'الشهر', included: 'أوردرات مشمولة', overage: 'بعد كده', fits: 'مناسب لـ' },
    perMonth: 'جنيه / شهر',
    plans: [
      { name: 'Start', monthly: '3,500', included: '300', overage: '9 جنيه للأوردر', fits: 'فرع واحد' },
      { name: 'Grow', monthly: '8,500', included: '1,000', overage: '8 جنيه للأوردر', fits: 'فرع مزحوم أو 2–3 فروع' },
      { name: 'Chain', monthly: '20,000', included: '2,500', overage: '7 جنيه للأوردر', fits: '4–10 فروع' },
    ],
    includesAll: 'كل الباقات فيها لوحة التحكم، الدليفري والتيك أواي والصالة، وكل الفروع.',
    setup: 'رسوم تجهيز 2,500 جنيه مرة واحدة، و1,500 لكل فرع إضافي.',
    mathH3: 'الحسبة',
    mathLines: [
      'لو متوسط الأوردر عندك 150 جنيه، التطبيق بياخد منه حوالي 30 جنيه.',
      'على باقة Grow، الأوردر بيكلفك 8.5 جنيه.',
    ],
    mathClose: 'إحنا مش أرخص حاجة في السوق. إحنا الحسبة اللي بتطلع في صالحك.',
    picker: {
      yourPlan: 'الباقة المناسبة',
      aov: 'متوسط الأوردر عندك',
      orders: 'أوردرات في الشهر',
      egp: 'جنيه',
      perOrder: 'للأوردر',
      appSide: 'اللي بياخده التطبيق',
      ourSide: 'مع منادم على',
      diff: 'الفرق في جيبك:',
      assumption: 'على افتراض إن التطبيق بياخد حوالي خُمس قيمة الأوردر. عمولتك الفعلية في فاتورتك الشهرية.',
      fits: ['فرع واحد', 'فرع مزحوم أو 2–3 فروع', '4–10 فروع'],
    },
    appTake: { label: 'للتطبيق، من أوردر 150 جنيه', value: 30, suffix: 'جنيه' },
    ourCost: { label: 'مع منادم على باقة Grow', value: 8.5, suffix: 'جنيه' },
  },

  // NEW LINE — not from website-copy.md; drafted from decision 6. Needs Adel's review.
  trust: {
    pre: 'كل إصدار بيتجرب على',
    num: '110',
    post: 'محادثة حقيقية قبل ما يشتغل في مطعمك.',
    // NEW UI strings — need Adel's review
    run: {
      title: 'اختبار الإصدار',
      sentence: 'كل إصدار بيتجرب على 110 محادثة حقيقية قبل ما يشتغل في مطعمك.',
      ofLabel: 'من',
      passing: 'تمام',
      cases: [
        'الزبون بيغيّر رأيه في نص الأوردر',
        'فويس نوت فيها طلبين ومشروب',
        'عنوان بعلامة مميزة من غير شارع',
        'صنف خلص — يترد بالحقيقة مش بالرفض',
        'كاش بمية — الباقي محسوب صح',
      ],
      replay: 'شغّل تاني',
    },
  },

  objections: {
    h2: 'أسئلة بتتسأل',
    items: [
      {
        q: '«موظفيني مش هيعرفوا يستخدموه»',
        a: 'مش هيتعلموا حاجة جديدة. الأوردر بيوصل جاهز — الكاشير بيشوفه زي ما بيشوف أي أوردر.',
      },
      { q: '«ده تطبيق؟»', a: 'لا. مفيش حاجة تتحمّل، لا لك ولا لزباينك. كله على الواتساب.' },
      {
        q: '«هيتكلم مع زباينـي إزاي؟»',
        a: 'باسم مطعمك، بالمصري. اسمنا مبيظهرش في الكلام ده — دي محادثة مطعمك مع زبونه.',
      },
      {
        q: '«بتاخدوا عمولة؟»',
        a: 'لا. اشتراك شهري، وسعر ثابت للأوردر بعد الحد المشمول. مكتوب فوق.',
      },
      {
        q: '«عندي نظام كاشير، هيتعارض معاه؟»',
        a: 'منادم بياخد الأوردرات، مش بديل للكاشير. الربط بينهم ممكن نتكلم فيه لما تحتاجه.',
      },
    ],
  },

  closing: {
    h2: 'تحب تشوفه شغال؟',
    p: 'عرض توضيحي، 15 دقيقة، على الواتساب أو في المطعم. هنبعت أوردر بفويس نوت قدامك ونوريك بيوصل إزاي.',
    cta: 'احجز عرض',
    waLabel: `واتساب: ${WA_NUMBER_DISPLAY}`,
  },

  footer: {
    tagline: 'كل طلب يبقى زبون تعرفه',
    email: 'welcome@munadim.com',
    privacy: 'الخصوصية',
    colSite: 'الموقع',
    colContact: 'تواصل',
    rights: `© ${new Date().getFullYear()} منادم`,
  },
};
