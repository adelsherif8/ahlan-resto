/** Content model — one shape, two languages, identical layout. */

export interface ChatMsg {
  /** 'in' = customer (the diner), 'out' = the restaurant (the agent). */
  from: 'in' | 'out';
  /** Plain text bubble. */
  text?: string;
  /** Voice note bubble — seconds shown as 0:SS. */
  voice?: { duration: string };
  /** Itemised bill bubble — lines computed "by code", never prose. */
  bill?: { lines: { label: string; price: number }[]; total: { label: string; price: number }; after?: string };
  time: string;
}

export interface Fragment {
  /** The bullet head + one-line explanation (copy §6). */
  head: string;
  body: string;
  /** Tiny two-bubble proof: what the customer sends, what comes back. */
  demo: { in?: string; inVoice?: string; out: string };
}

export interface Plan {
  name: string;
  monthly: string;
  included: string;
  overage: string;
  fits: string;
}

export interface SiteContent {
  meta: { title: string; description: string };
  nav: { pricing: string; cta: string; toggle: { label: string; href: string } };
  hero: {
    h1: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
    demoLabel: string;
    restaurant: string;
    chat: ChatMsg[];
    chatStatus: string;
    replay: string;
  };
  problem: { h2: string; p1: string; p2: string; bar: { order: string; app: string } };
  whatIs: { h2: string; p1: string; channels: string[]; p2: string };
  dineIn: { h2: string; p1: string; p2: string; qr: { scan: string } };
  steps: { h2: string; items: { title: string; body: string }[] };
  understands: { h2: string; fragments: Fragment[] };
  pricing: {
    h2: string;
    rows: { monthly: string; included: string; overage: string; fits: string };
    perMonth: string;
    plans: Plan[];
    includesAll: string;
    setup: string;
    mathH3: string;
    mathLines: [string, string];
    mathClose: string;
    appTake: { label: string; value: number; suffix: string };
    ourCost: { label: string; value: number; suffix: string };
  };
  objections: { h2: string; items: { q: string; a: string }[] };
  closing: { h2: string; p: string; cta: string; waLabel: string };
  footer: { tagline: string; email: string; privacy: string; rights: string };
}
