import type { SiteContent } from './types';
import { ar } from './ar';
import { WA_NUMBER_DISPLAY, DEMO_RESTAURANT_AR, DEMO_LABEL_EN } from '../lib/const';

/**
 * The translation — copy source: branding/website-copy.md EN blocks.
 * The demo conversation stays in Egyptian Arabic on this page too: it is a
 * truthful screenshot of the product serving Egyptian customers. Only the
 * chrome around it translates.
 */
export const en: SiteContent = {
  meta: {
    title: "Munadim — Your restaurant's direct ordering channel",
    description:
      "Your restaurant's direct ordering channel — delivery, pickup, and dine-in. Every WhatsApp order leaves you your customer's number and order history.",
  },

  nav: {
    pricing: 'Pricing',
    cta: 'Book a demo',
    toggle: { label: 'العربية', href: '/ar' },
    links: [
      { label: 'How it starts', href: '#how' },
      { label: 'What it understands', href: '#features' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },

  hero: {
    h1: 'The customers who order from you every week — do you have their numbers?',
    sub: 'The apps rent you customers. Your WhatsApp keeps them.',
    ctaPrimary: 'Show me a real order',
    ctaSecondary: 'See pricing',
    demoLabel: DEMO_LABEL_EN,
    restaurant: DEMO_RESTAURANT_AR,
    chatStatus: 'متصل',
    replay: 'Replay',
    chat: ar.hero.chat,
  },

  problem: {
    h2: "You're paying to reach people who already know you",
    p1: 'Every order through the apps costs you about a fifth of its value. That makes sense the first time — the app brought you someone new.',
    p2: "But the customer who has ordered eight times? You pay the same commission every time. And you still don't have his number.",
    bar: { order: 'A 150 EGP order', app: 'about 30 EGP to the app' },
  },

  whatIs: {
    h2: "Your restaurant's direct ordering channel",
    p1: 'Munadim takes your orders on WhatsApp — the same number your customers already message you on.',
    channels: ['Delivery', 'Pickup', 'Dine-in'],
    p2: 'Every order leaves you a phone number and an order history, in a dashboard that belongs to you.',
    panels: {
      p1: 'The receipt on WhatsApp',
      p2: 'The ticket prints in the kitchen',
      p3: 'And the customer is recorded for you',
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
        pdfMeta: 'Receipt · PDF',
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
        badge: 'returning',
        allergy: '⚠ Nut allergy',
        phone: '0100 000 4437',
        stats: [
          { value: '8', label: 'VISITS' },
          { value: '2,140', label: 'LIFETIME EGP' },
          { value: '267', label: 'AVG TICKET' },
        ],
        rows: [
          { label: 'Last order', text: '3 days ago' },
          { label: 'Branch', text: 'Maadi' },
          { label: 'Address', text: 'Street 9, Maadi — floor 3, apt 7' },
        ],
        favLabel: 'Favourites',
        favs: ['Classic Burger', 'Loaded Fries'],
        notesLabel: 'Notes',
        notes: ['Likes it without onions'],
      },
    },
    stream: {
      panelTitle: 'Dashboard — Customers',
      counter: 'customers',
      counterOne: 'customer',
      captured: "All of them in your restaurant's database — you can reach them again",
      replay: 'Replay',
      stop: 'Stop',
      filters: ['All', 'New', 'Returning', 'Regular'],
      rows: [
        { name: 'Ahmed M.', phone: '+2010•••4437', item: 'Classic Burger', channel: 0, visits: '3 visits', egp: 'EGP 680', ago: '2d', badge: 'returning' },
        { name: 'Menna A.', phone: '+2011•••2210', item: 'Chicken Ranch', channel: 1, visits: '1 visit', egp: 'EGP 270', ago: '1d', badge: 'new' },
        { name: 'Karim S.', phone: '+2012•••8842', item: 'Smash Double', channel: 2, visits: '2 visits', egp: 'EGP 500', ago: '3d', badge: 'returning' },
      ],
    },
    flow: {
      step1: 'An order on WhatsApp',
      step2: 'It reaches the kitchen',
      step3: 'The customer stays yours',
      captured: 'Recorded — you can reach him again',
      record: {
        name: 'Ahmed M.',
        phone: '010• ••• 4437',
        rows: [
          { label: 'Last order', value: 'Classic combo + fries' },
          { label: 'Always asks for', value: 'no onions' },
          { label: 'Orders', value: '8' },
        ],
      },
    },
  },

  dineIn: {
    h2: 'The people sitting in your restaurant right now are the customers you know least about',
    p1: 'Delivery at least leaves an address. Dine-in leaves nothing.',
    p2: "With a code on the table, the customer orders from where he's sitting, the order goes to the kitchen, and his number is recorded like any other order.",
    qr: { scan: 'امسح واطلب من على ترابيزتك' },
    scene: {
      step1: 'A code on the table',
      step2: 'He scans and orders from his seat',
      step3: 'His number is recorded for you',
      captured: 'Recorded — you can reach him again',
      replay: 'Replay',
      dashTitle: 'Dashboard — Customers',
      guestName: 'Ahmed M.',
      guestPhone: '010• ••• 4437',
      chips: ['Table 4', 'Dine-in', 'No onions'],
      stats: [
        { value: '1', label: 'VISITS' },
        { value: '210', label: 'LIFETIME EGP' },
        { value: '210', label: 'AVG TICKET' },
      ],
      noteLabel: 'Notes (the bot uses these)',
      noteValue: 'No onions',
      orderLabel: 'Orders (1)',
      orderCode: 'O-2TGC',
      orderItem: '1× Truffle Shroom Burger',
      orderMeta: 'dine-in · today',
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
    h2: 'Three steps',
    items: [
      { title: 'Send us photos of your menu', body: 'Phone photos are fine. We build the menu.' },
      { title: 'We set up the rest', body: 'Delivery zones, branches, delivery pricing, and the WhatsApp number.' },
      { title: 'Your customers order', body: 'From the same number. No app to download, no new device.' },
    ],
    journey: {
      replay: 'Replay',
      photosCaption: 'Phone photos are enough',
      menuTitle: 'Your menu',
      menuItems: [
        { name: 'Classic Burger', price: '260' },
        { name: 'Smash Double', price: '290' },
        { name: 'Cheddar Fries', price: '75' },
      ],
      setupChips: ['Delivery zones', 'Branches', 'WhatsApp number ✓'],
      orderTitle: 'New order — O-A101',
      orderItem: 'Classic combo ×1',
      orderFrom: 'From your own number',
    },
  },

  understands: {
    h2: 'It understands your customers the way they actually talk',
    fragments: [
      {
        head: 'Voice notes',
        body: 'The customer sends a voice message, the order is recorded.',
        demo: ar.understands.fragments[0]!.demo,
      },
      {
        head: 'Franco-Arabic',
        body: "He types 3ayez burger, it's understood — and answered in the same language.",
        demo: ar.understands.fragments[1]!.demo,
      },
      {
        head: 'Landmark addresses',
        body: '"Next to El Ezaby pharmacy" works as an address.',
        demo: ar.understands.fragments[2]!.demo,
      },
      {
        head: 'Cash and change',
        body: 'Paying with a 200? The change is calculated and passed to the driver.',
        demo: ar.understands.fragments[3]!.demo,
      },
      {
        head: 'Multiple branches',
        body: "Separate delivery zones, fees, and hours for each, and the order goes to the right branch's kitchen.",
        demo: ar.understands.fragments[4]!.demo,
      },
    ],

    table: {
      sends: 'What the customer sends',
      gets: 'What you end up with',
      replay: 'Replay',
      pairs: [
        { head: 'Voice notes', input: { kind: 'voice', duration: '0:11' }, fields: [ { label: 'Order', value: '2 Smash Burgers + cola' } ] },
        { head: 'Franco-Arabic', input: { kind: 'text', text: '3ayez burger w batates' }, fields: [ { label: 'Order', value: 'Burger + fries' }, { label: 'Reply', value: 'in Franco too' } ] },
        { head: 'Landmark addresses', input: { kind: 'text', text: 'التجمع، جنب صيدلية العزبي شارع التسعين' }, fields: [ { label: 'Area', value: 'New Cairo' }, { label: 'Landmark', value: 'El Ezaby pharmacy' }, { label: 'Delivery', value: '30 EGP' } ] },
        { head: 'Cash and change', input: { kind: 'text', text: 'كاش ومعايا 200' }, fields: [ { label: 'Payment', value: 'Cash' }, { label: 'Change', value: '38 EGP with the driver' } ] },
        { head: 'Multiple branches', input: { kind: 'location', text: 'my location' }, fields: [ { label: 'Branch', value: 'Nasr City' }, { label: 'Delivery', value: '20 EGP' } ] },
      ],
    },
  },

  pricing: {
    h2: 'Clear pricing, and no commission on the order',
    rows: { monthly: 'Monthly', included: 'Included orders', overage: 'After that', fits: 'Fits' },
    perMonth: 'EGP / month',
    plans: [
      { name: 'Start', monthly: '3,500', included: '300', overage: '9 EGP / order', fits: 'one branch' },
      { name: 'Grow', monthly: '8,500', included: '1,000', overage: '8 EGP / order', fits: 'one busy branch or 2–3 branches' },
      { name: 'Chain', monthly: '20,000', included: '2,500', overage: '7 EGP / order', fits: '4–10 branches' },
    ],
    includesAll: 'Every plan includes the dashboard, delivery, pickup, dine-in, and all branches.',
    setup: 'One-time setup fee of 2,500 EGP, and 1,500 per additional branch.',
    mathH3: 'The arithmetic',
    mathLines: [
      'If your average order is 150 EGP, the app takes about 30 from it.',
      'On Grow, an order costs you 8.5 EGP.',
    ],
    mathClose: "We're not the cheapest thing on the market. We're the arithmetic that works in your favour.",
    picker: {
      yourPlan: 'Your plan',
      aov: 'Your average order',
      orders: 'Orders per month',
      egp: 'EGP',
      perOrder: '/ order',
      appSide: 'What the app takes',
      ourSide: 'With Munadim on',
      diff: 'Difference in your pocket:',
      assumption: 'Assuming the apps take about a fifth of the order. Your real commission is on your monthly statement.',
      fits: ['one branch', 'one busy branch or 2–3', '4–10 branches'],
    },
    appTake: { label: 'To the app, from a 150 EGP order', value: 30, suffix: 'EGP' },
    ourCost: { label: 'With Munadim on Grow', value: 8.5, suffix: 'EGP' },
  },

  trust: {
    pre: 'Every release is tested against',
    num: '1,500+',
    turns: '5,500',
    post: 'real conversations before it reaches your restaurant.',
    run: {
      title: 'RELEASE SUITE',
      sentence: 'Every release is tested against 1,500+ real conversations — around 5,500 messages — before it reaches your restaurant.',
      ofLabel: 'of',
      passing: 'pass',
      cases: [
        'Customer changes his mind mid-order',
        'A voice note with two dishes and a drink',
        'A landmark address with no street name',
        'Sold-out item answered honestly, not refused',
        'Cash with a 100 — change computed correctly',
      ],
      replay: 'Replay',
    },
    facts: [
      { head: '1,500+ conversations', body: 'Every release is tested against them before it reaches you.' },
      { head: 'Official WhatsApp Business', body: "On your restaurant's number, in your restaurant's name." },
      { head: 'Your data is yours', body: "The customer database belongs to the restaurant." },
    ],
  },

  objections: {
    h2: 'Questions people ask',
    items: [
      {
        q: '"My staff won\'t be able to use it"',
        a: "There's nothing new for them to learn. The order arrives ready; the cashier sees it like any other order.",
      },
      { q: '"Is this an app?"', a: 'No. Nothing to download, for you or your customers. It all runs on WhatsApp.' },
      {
        q: '"How will it talk to my customers?"',
        a: "In your restaurant's name, in Egyptian Arabic. Our name never appears — that conversation belongs to your restaurant.",
      },
      {
        q: '"Do you take commission?"',
        a: "No. A monthly subscription, and a fixed per-order price past the included volume. It's written above.",
      },
      {
        q: '"I have a POS — will this conflict with it?"',
        a: "Munadim takes the orders; it doesn't replace your POS. We can talk about connecting them when you need it.",
      },
    ],
  },

  closing: {
    h2: 'Want to see it working?',
    p: "A 15-minute demo, on WhatsApp or at your restaurant. We'll send an order by voice note in front of you and show you where it lands.",
    cta: 'Book a demo',
    waLabel: `WhatsApp: ${WA_NUMBER_DISPLAY}`,
    micro: '15 minutes on WhatsApp. No commitment.',
    prefill: 'عايز أشوف عرض توضيحي',
    askMore: 'Still have a question? Ask us on WhatsApp.',
  },

  footer: {
    tagline: 'Every order becomes a customer you know.',
    email: 'welcome@munadim.com',
    privacy: 'Privacy',
    colSite: 'Site',
    colContact: 'Contact',
    rights: `© ${new Date().getFullYear()} Munadim`,
  },
};
