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
  },

  dineIn: {
    h2: 'The people sitting in your restaurant right now are the customers you know least about',
    p1: 'Delivery at least leaves an address. Dine-in leaves nothing.',
    p2: "With a code on the table, the customer orders from where he's sitting, the order goes to the kitchen, and his number is recorded like any other order.",
    qr: { scan: 'امسح واطلب من على ترابيزتك' },
  },

  steps: {
    h2: 'Three steps',
    items: [
      { title: 'Send us photos of your menu', body: 'Phone photos are fine. We build the menu.' },
      { title: 'We set up the rest', body: 'Delivery zones, branches, delivery pricing, and the WhatsApp number.' },
      { title: 'Your customers order', body: 'From the same number. No app to download, no new device.' },
    ],
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
    appTake: { label: 'To the app, from a 150 EGP order', value: 30, suffix: 'EGP' },
    ourCost: { label: 'With Munadim on Grow', value: 8.5, suffix: 'EGP' },
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
  },

  footer: {
    tagline: 'Every order becomes a customer you know.',
    email: 'welcome@munadim.com',
    privacy: 'Privacy',
    rights: `© ${new Date().getFullYear()} Munadim`,
  },
};
