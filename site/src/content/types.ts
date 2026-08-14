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
  nav: {
    pricing: string;
    cta: string;
    toggle: { label: string; href: string };
    /** Site nav — anchors today, page routes once /features etc. ship (sitemap P1). */
    links: { label: string; href: string }[];
  };
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
  whatIs: {
    h2: string; p1: string; channels: string[]; p2: string;
    /** The three real outputs of one order — content mirrors the live product. */
    panels: {
      p1: string; p2: string; p3: string;
      receipt: {
        headline: string; title: string; place: string; meta: string; item: string;
        subtotal: string; net: string; tax: string; total: string; taxNote: string;
        pay: string; eta: string; link: string; pdfName: string; pdfMeta: string;
      };
      ticket: {
        head: string; code: string; customer: string; item: string; price: string;
        mods: string[]; totalLabel: string; total: string; payment: string; track: string;
      };
      profile: {
        name: string; badge: string; allergy: string; phone: string;
        stats: { value: string; label: string }[];
        rows: { icon: string; text: string }[];
        favLabel: string; favs: string[];
        notesLabel: string; notes: string[];
      };
    };
    /** Channel-stream labels — new UI strings, need Adel's Arabic review. */
    stream: {
      panelTitle: string; counter: string; counterOne: string; captured: string; replay: string;
      rows: { name: string; phone: string; item: string; channel: number; visits: string; egp: string; ago: string; badge: string }[];
      filters: string[];
    };
    /** Flow diagram labels — new UI strings, need Adel's Arabic review. */
    flow: {
      step1: string; step2: string; step3: string; captured: string;
      record: { name: string; phone: string; rows: { label: string; value: string }[] };
    };
  };
  dineIn: {
    h2: string; p1: string; p2: string; qr: { scan: string };
    /** Animated scene labels — new UI strings, need Adel's Arabic review. */
    scene: {
      step1: string; step2: string; step3: string; captured: string; replay: string;
      dashTitle: string; guestName: string; guestPhone: string; chips: string[];
      stats: { value: string; label: string }[];
      noteLabel: string; noteValue: string;
      orderLabel: string; orderCode: string; orderItem: string; orderMeta: string; orderTotal: string;
      chat: { from: 'in' | 'out'; text: string }[];
    };
  };
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
  /** Decision 6 (feature-truth §9): the 110 scenarios, phrased as process, never a guarantee. */
  trust: { pre: string; num: string; post: string };
  objections: { h2: string; items: { q: string; a: string }[] };
  closing: { h2: string; p: string; cta: string; waLabel: string };
  footer: { tagline: string; email: string; privacy: string; rights: string; colSite: string; colContact: string };
}
