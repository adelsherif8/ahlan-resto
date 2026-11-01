/**
 * Life — one restaurant owner's night, before and after. PRIVATE OUTREACH ONLY: DMed to
 * that owner, never posted. Illustrative, carries «مثال توضيحي» throughout; item names and
 * prices come from the restaurant's own published menu. Every figure must be theirs or
 * arithmetic on theirs: no invented losses or percentages. The on-screen unread counter only
 * illustrates pressure and is covered by the label; never quote it as a statistic.
 */
import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame } from 'remotion';
import { C } from './lib/brand';
import { PostEnd, useFontsReady } from './Post';

const AR = 'Amiri, NotoEmoji';
const UI = 'Plex, NotoEmoji';
const MONO = 'PlexMono';
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export type LifeData = {
  name: string; avatar: string; logo: string; food: string;
  page: string; ink: string; accent: string; glow?: string; flipLogo?: boolean;
  hook: string; pressure: string; lost: string; flip: string; answered: string; ticketLine: string; ownLine: string; payoff: string;
  messages: { from: string; text: string; reply: string }[];
  ticket: { head: string; lines: [string, string][]; total: string };
  customers: { name: string; phone: string; fav: string; tag: string }[];
};

export const LIFE: Record<string, LifeData> = {
  // menu: menuegypt.com, updated 2025-07-28. 2×170 + 45 + 22 = 407. Customers are fictional.
  square: {
    name: 'Square Burger', avatar: 'outreach-research/sq-avatar.jpg', logo: 'outreach-research/sq-logo-crop.jpg', food: 'outreach-research/sq-food.jpg',
    page: '#E9D4B5', ink: '#141110', accent: '#D8402B',
    hook: '9:12 بالليل.\nإيدك في الجريل.', pressure: 'والتليفون مبيبطلش.',
    lost: 'واحد منهم مستناش.\nطلب من حد تاني.', flip: 'نفس الليلة.\nمع مُنادم.',
    answered: 'كلهم اترد عليهم.\nوإنت لسه على الجريل.', ticketLine: 'الأوردر بيوصلك جاهز.',
    ownLine: 'وآخر الليلة؟\nأرقامهم عندك.', payoff: 'تقفل التراك…\nوزباينك معاك.',
    messages: [
      { from: 'أحمد', text: 'عايز 2 تشيزي بيف 150', reply: 'تمام 👌 تحب تشرب إيه؟' },
      { from: 'منة', text: 'البرجر بعيش بريوش؟', reply: 'أيوه، كله بعيش البريوش 🍔' },
      { from: 'كريم', text: 'فين مكانكم النهارده؟', reply: 'شارع التسعين الشمالي، قدام Platz' },
      { from: 'سارة', text: 'في حاجة للأطفال؟', reply: 'في Kids Meal بـ 120 جنيه' },
      { from: 'عمر', text: 'بتوصلوا التجمع؟', reply: 'أيوه، ابعتلي موقعك 📍' },
    ],
    ticket: { head: 'TAKEAWAY', lines: [['2× Cheesy Beef 150g', '340'], ['1× Cheese Fries', '45'], ['1× Coca-Cola', '22']], total: 'EGP 407' },
    customers: [
      { name: 'أحمد', phone: '010•••4437', fav: 'تشيزي بيف', tag: 'راجع' },
      { name: 'منة', phone: '011•••2210', fav: 'BBQ بيف', tag: 'جديد' },
      { name: 'كريم', phone: '012•••8842', fav: 'لاما تشيكن', tag: 'راجع' },
    ],
  },
  // menu: menuegypt.com, updated 2023-03-10, so prices are too old to show: this one has none.
  // Items and ingredients are from that menu; delivery to Nasr City per their Instagram. Customers are fictional.
  // Talabat best sellers (Chicken Biriyani Rice, Chicken Samosa Set, Semolina Cake, Parotta) plus
  // Butter Chicken and Chicken Curry; address from their Facebook page. No prices published: none shown.
  charminar: {
    name: 'Charminar', avatar: 'outreach-research/ch-logo.jpg', logo: 'outreach-research/ch-logo-big.jpg', food: 'outreach-research/ch-food.jpg',
    page: '#F4E7CF', ink: '#3F0F22', accent: '#7B1E3A', glow: 'radial-gradient(110% 55% at 50% 0%, rgba(201,155,62,0.28), transparent 70%), radial-gradient(110% 40% at 50% 100%, rgba(123,30,58,0.12), transparent 70%)', flipLogo: true,
    hook: '9:12 بالليل.\nوالمطبخ مولّع.', pressure: 'والتليفون مبيبطلش.',
    lost: 'واحد منهم مستناش.\nطلب من حد تاني.', flip: 'نفس الليلة.\nمع مُنادم.',
    answered: 'كلهم اترد عليهم.\nوإنت لسه في المطبخ.', ticketLine: 'الأوردر بيوصلك جاهز.',
    ownLine: 'وآخر الليلة؟\nأرقامهم عندك.', payoff: 'المطبخ شغال…\nوزباينك معاك.',
    messages: [
      { from: 'أحمد', text: 'عايز 2 برياني فراخ', reply: 'تمام 👌 تحب معاهم باروتا؟' },
      { from: 'منة', text: 'عندكم بتر تشيكن؟', reply: 'أيوه، وكمان تشيكن كاري 🍛' },
      { from: 'كريم', text: 'مكانكم فين؟', reply: 'شارع طه الديناري، الحي السابع' },
      { from: 'سارة', text: 'في حاجة حلوة؟', reply: 'في كيكة السميد 🍰' },
      { from: 'عمر', text: 'في سمبوسة؟', reply: 'أيوه، طقم سمبوسة فراخ' },
    ],
    ticket: { head: 'TAKEAWAY', lines: [['2× Chicken Biryani', ''], ['1× Butter Chicken', ''], ['1× Parotta', '']], total: '' },
    customers: [
      { name: 'أحمد', phone: '010•••4437', fav: 'برياني فراخ', tag: 'راجع' },
      { name: 'منة', phone: '011•••2210', fav: 'بتر تشيكن', tag: 'جديد' },
      { name: 'كريم', phone: '012•••8842', fav: 'تشيكن كاري', tag: 'راجع' },
    ],
  },
  // Burger names from their QR menu listing (El Gouna, may differ in New Cairo); location, hours and
  // vegetarian burgers from u-venues.com/place/le-garage. No logo or brand colours found: neutral dark
  // look and the name in text only. No prices: sources disagree.
  legarage: {
    name: 'Le Garage', avatar: '', logo: '', food: 'outreach-research/lg-food.jpg',
    page: '#141110', ink: '#F5EFE7', accent: '#C8892B', glow: 'radial-gradient(110% 50% at 50% 0%, rgba(200,137,43,0.22), transparent 70%)',
    hook: '9:12 بالليل.\nوالصالة مليانة.', pressure: 'والتليفون مبيبطلش.',
    lost: 'واحد منهم مستناش.\nراح لحد تاني.', flip: 'نفس الليلة.\nمع مُنادم.',
    answered: 'كلهم اترد عليهم.\nوإنت لسه في المطبخ.', ticketLine: 'الأوردر بيوصلك جاهز.',
    ownLine: 'وآخر الليلة؟\nأرقامهم عندك.', payoff: 'الجراج شغال…\nوزباينك معاك.',
    messages: [
      { from: 'أحمد', text: 'عايز 2 Classic Burger', reply: 'تمام 👌 تحب معاهم إيه؟' },
      { from: 'منة', text: 'عندكم برجر نباتي؟', reply: 'أيوه، عندنا برجر نباتي 🌱' },
      { from: 'كريم', text: 'مكانكم فين في التجمع؟', reply: 'U Venues، الدور الأول' },
      { from: 'سارة', text: 'فاتحين لحد امتى؟', reply: 'لحد 12، والخميس والجمعة لحد 1' },
      { from: 'عمر', text: 'Avocado Burger لو سمحت', reply: 'تمام، تيك أواي ولا صالة؟' },
    ],
    ticket: { head: 'TAKEAWAY', lines: [['2× Classic Burger', ''], ['1× Swiss Burger', ''], ['1× Avocado Burger', '']], total: '' },
    customers: [
      { name: 'أحمد', phone: '010•••4437', fav: 'Classic Burger', tag: 'راجع' },
      { name: 'منة', phone: '011•••2210', fav: 'Swiss Burger', tag: 'جديد' },
      { name: 'كريم', phone: '012•••8842', fav: 'Avocado Burger', tag: 'راجع' },
    ],
  },
  // menu: menuegypt.com/bam-smash-burger, updated 2026-10-05, prices include tax. 2×245 + 70 + 30 = 590.
  // Fyves Mall branch and Sheikh Zayed delivery from the same page. Customers are fictional.
  bam: {
    name: 'Bam', avatar: 'outreach-research/ba-logo.jpg', logo: 'outreach-research/ba-logo-big.jpg', food: 'outreach-research/ba-food.jpg',
    page: '#141110', ink: '#F5EFE7', accent: '#D9912A', glow: 'radial-gradient(110% 50% at 50% 0%, rgba(242,190,95,0.24), transparent 70%)', flipLogo: true,
    hook: '9:12 بالليل.\nوإيدك في السماش.', pressure: 'والتليفون مبيبطلش.',
    lost: 'واحد منهم مستناش.\nطلب من حد تاني.', flip: 'نفس الليلة.\nمع مُنادم.',
    answered: 'كلهم اترد عليهم.\nوإنت لسه على الجريل.', ticketLine: 'الأوردر بيوصلك جاهز.',
    ownLine: 'وآخر الليلة؟\nأرقامهم عندك.', payoff: 'السماش شغال…\nوزباينك معاك.',
    messages: [
      { from: 'أحمد', text: 'عايز 2 Signature دبل', reply: 'تمام 👌 تحب معاهم إيه؟' },
      { from: 'منة', text: 'الـ Nashville Tenders حار؟', reply: 'أيوه حار 🔥🔥 والميل بـ 300 جنيه' },
      { from: 'كريم', text: 'عندكم برجر بالبيكون؟', reply: 'أيوه، Chipotle Bacon بـ 260 جنيه' },
      { from: 'سارة', text: 'فين الفرع؟', reply: 'Fyves Mall، وصلة دهشور' },
      { from: 'عمر', text: 'بتوصلوا زايد؟', reply: 'أيوه، ابعتلي موقعك 📍' },
    ],
    ticket: { head: 'TAKEAWAY', lines: [['2× Signature Double', '490'], ['1× Classic Fries', '70'], ['1× Drink', '30']], total: 'EGP 590' },
    customers: [
      { name: 'أحمد', phone: '010•••4437', fav: 'Signature دبل', tag: 'راجع' },
      { name: 'منة', phone: '011•••2210', fav: 'Nashville Tenders', tag: 'جديد' },
      { name: 'كريم', phone: '012•••8842', fav: 'Truffle Burger', tag: 'راجع' },
    ],
  },
  // Talabat best sellers (Bruschetta, Calamari, Margherita, Con Frutti Di Mare), Instagram/Facebook for
  // restaurant & bakery in Degla, Maadi. No prices found: none shown. Customers are fictional.
  capricci: {
    name: 'Capricci', avatar: 'outreach-research/ca-logo.png', logo: 'outreach-research/ca-logo-big.jpg', food: 'outreach-research/ca-food.jpg',
    page: '#FBF5EA', ink: '#2A1216', accent: '#A8173A', glow: 'radial-gradient(110% 55% at 50% 0%, rgba(168,23,58,0.10), transparent 70%), radial-gradient(110% 40% at 50% 100%, rgba(168,23,58,0.08), transparent 70%)', flipLogo: true,
    hook: '9:12 بالليل.\nوالفرن شغال.', pressure: 'والتليفون مبيبطلش.',
    lost: 'واحد منهم مستناش.\nطلب من حد تاني.', flip: 'نفس الليلة.\nمع مُنادم.',
    answered: 'كلهم اترد عليهم.\nوإنت لسه قدام الفرن.', ticketLine: 'الأوردر بيوصلك جاهز.',
    ownLine: 'وآخر الليلة؟\nأرقامهم عندك.', payoff: 'الفرن شغال…\nوزباينك معاك.',
    messages: [
      { from: 'أحمد', text: 'عايز 2 بيتزا مارجريتا', reply: 'تمام 👌 تحب معاهم إيه؟' },
      { from: 'منة', text: 'عندكم بيتزا سي فود؟', reply: 'أيوه، Con Frutti Di Mare 🍕' },
      { from: 'كريم', text: 'مكانكم فين؟', reply: 'في دجلة، المعادي' },
      { from: 'سارة', text: 'عندكم مخبوزات؟', reply: 'أيوه، إحنا مطعم ومخبز 🥖' },
      { from: 'عمر', text: 'في مقبلات؟', reply: 'في بروشيتا وكاليماري' },
    ],
    ticket: { head: 'TAKEAWAY', lines: [['2× Margherita Pizza', ''], ['1× Bruschetta', ''], ['1× Calamari', '']], total: '' },
    customers: [
      { name: 'أحمد', phone: '010•••4437', fav: 'مارجريتا', tag: 'راجع' },
      { name: 'منة', phone: '011•••2210', fav: 'Con Frutti Di Mare', tag: 'جديد' },
      { name: 'كريم', phone: '012•••8842', fav: 'بروشيتا', tag: 'راجع' },
    ],
  },
  monster: {
    name: 'Monster Burger', avatar: 'outreach-research/mo-logo2.jpg', logo: 'outreach-research/mo-logo-big.jpg', food: 'outreach-research/mo-food.jpg',
    page: '#141110', ink: '#F5EFE7', accent: '#F39A1E', glow: 'radial-gradient(110% 50% at 50% 0%, rgba(243,154,30,0.30), transparent 70%), radial-gradient(110% 40% at 50% 100%, rgba(190,40,30,0.22), transparent 70%)', flipLogo: true,
    hook: '9:12 بالليل.\nوالزحمة وحش.', pressure: 'والتليفون مبيبطلش.',
    lost: 'واحد منهم مستناش.\nطلب من حد تاني.', flip: 'نفس الليلة.\nمع مُنادم.',
    answered: 'كلهم اترد عليهم.\nوإنت لسه في المطبخ.', ticketLine: 'الأوردر بيوصلك جاهز.',
    ownLine: 'وآخر الليلة؟\nأرقامهم عندك.', payoff: 'الوحش شغال…\nوزباينك معاك.',
    messages: [
      { from: 'أحمد', text: 'عايز 2 دراكولا بيف', reply: 'تمام 👌 تحب معاهم إيه؟' },
      { from: 'منة', text: 'الزومبي تشيكن فيه إيه؟', reply: 'فرايد تشيكن، مشروم، موتزاريلا سايحة' },
      { from: 'كريم', text: 'في حاجة حارة؟', reply: 'جرب دراجون مامي 🔥' },
      { from: 'سارة', text: 'بتوصلوا مدينة نصر؟', reply: 'أيوه، ابعتلي موقعك 📍' },
      { from: 'عمر', text: 'كلاسيك مونستر لو سمحت', reply: 'بيف ولا تشيكن؟' },
    ],
    ticket: { head: 'DELIVERY', lines: [['2× Dracula Beef', ''], ['1× Zombie Chicken', ''], ['1× Dragon Mummy', '']], total: '' },
    customers: [
      { name: 'أحمد', phone: '010•••4437', fav: 'دراكولا بيف', tag: 'راجع' },
      { name: 'منة', phone: '011•••2210', fav: 'زومبي تشيكن', tag: 'جديد' },
      { name: 'كريم', phone: '012•••8842', fav: 'دراجون مامي', tag: 'راجع' },
    ],
  },
};

const T = { hook: 0, press: 72, lost: 215, flip: 295, ans: 345, ticket: 520, own: 625, end: 735 };
export const lifeLength = () => T.end + 110;

/* sparks off the grill: seeded, so every render is identical */
const Embers: React.FC<{ f: number }> = ({ f }) => (
  <AbsoluteFill style={{ overflow: 'hidden' }}>
    {Array.from({ length: 34 }, (_, i) => {
      const seed = (i * 7919) % 1000 / 1000, seed2 = (i * 104729) % 1000 / 1000;
      const speed = 3.2 + seed * 5.5, life = 1000 + seed2 * 500;
      const y = 1960 - ((f * speed + seed2 * life) % life);
      const x = seed * 1080 + Math.sin((f + i * 13) / (14 + seed * 18)) * 42;
      const size = 4 + seed2 * 9;
      const fade = Math.max(0, (y - 700) / 1200);
      return <div key={i} style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: 99, background: seed > 0.5 ? '#FFB347' : '#FF6A2B', opacity: fade * (0.55 + 0.45 * Math.sin(f / 3 + i)), boxShadow: `0 0 ${size * 2.6}px ${size * 0.7}px rgba(255,120,40,${0.55 * fade})` }} />;
    })}
  </AbsoluteFill>
);

/* their own sandwich photo, rising under the two sparse beats */
const FoodBand: React.FC<{ src: string; f: number; o: number; page: string }> = ({ src, f, o, page }) => {
  const a = interpolate(f, [0, 16], [0, 1], clamp);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 500, overflow: 'hidden', opacity: o, transform: `translateY(${(1 - a) * 80}px)` }}>
      <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '30% 60%', transform: `scale(${1.06 + f * 0.0006})` }} />
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(to bottom, ${page} 0%, transparent 34%)` }} />
    </div>
  );
};

const Big: React.FC<{ text: string; f: number; color: string; size?: number; font?: string }> = ({ text, f, color, size = 112, font = AR }) => {
  const a = interpolate(f, [0, 10], [0, 1], clamp);
  return <div style={{ fontFamily: font, fontWeight: 700, fontSize: size, lineHeight: 1.3, color, direction: 'rtl', textAlign: 'center', whiteSpace: 'pre-line', transform: `translateY(${(1 - a) * 22}px) scale(${0.97 + 0.03 * a})` }}>{text}</div>;
};

const Row: React.FC<{ m: LifeData['messages'][0]; p: number; dark: boolean; reply: number; dim?: number }> = ({ m, p, dark, reply, dim = 0 }) => (
  <div style={{ background: dark ? '#231E1A' : '#fff', borderRadius: 30, padding: '30px 38px', direction: 'rtl', fontFamily: UI, boxShadow: '0 14px 34px -14px rgba(0,0,0,0.45)',
    opacity: Math.min(p, 1) * (1 - dim * 0.6), transform: `translateY(${(1 - Math.min(p, 1)) * -70}px) scale(${0.92 + 0.08 * Math.min(p, 1)})` }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 38, fontWeight: 700, color: dark ? '#F5EFE7' : '#111B21' }}>{m.from}</span>
      {dark ? <span style={{ width: 26, height: 26, borderRadius: 99, background: '#25D366' }} /> : <span style={{ fontSize: 28, fontWeight: 700, color: '#1FA855', opacity: reply }}>✓✓</span>}
    </div>
    <div style={{ fontSize: 46, marginTop: 6, color: dark ? 'rgba(245,239,231,0.85)' : '#3B4A54' }}>{m.text}</div>
    {!dark && reply > 0 && (
      <div style={{ marginTop: 14, background: C.waOut, borderRadius: 16, padding: '16px 24px', fontSize: 40, color: '#111B21', opacity: reply, transform: `translateY(${(1 - reply) * 12}px)` }}>{m.reply}</div>
    )}
  </div>
);

export const Life: React.FC<{ who?: string }> = ({ who = 'square' }) => {
  const d = LIFE[who] ?? LIFE['square']!;
  const f = useCurrentFrame();
  const ready = useFontsReady();
  if (!ready) return <AbsoluteFill style={{ background: C.ink }} />;
  const after = f >= T.flip;
  const wipe = interpolate(f, [T.flip - 8, T.flip + 12], [0, 100], clamp);
  const flick = 0.75 + 0.25 * Math.sin(f / 2.3) * Math.sin(f / 5.1);
  const shake = f >= T.press + 40 && f < T.lost ? Math.sin(f * 1.9) * 5 : 0;
  const stagger = 28;
  const unread = Math.min(99, 3 + Math.max(0, Math.floor((f - T.press) / 9)));
  const out = (end: number) => interpolate(f, [end - 8, end], [1, 0], clamp);
  const label = `مثال توضيحي — ليلة في ${d.name}`;
  const onDark = d.page === '#141110';
  return (
    <AbsoluteFill style={{ background: C.ink, fontFamily: UI }}>
      <Audio src={staticFile('sfx/bed.wav')} volume={2.6} />

      {/* ── tonight: dark, grill glow from below ── */}
      <AbsoluteFill style={{ background: `radial-gradient(120% 55% at 50% 108%, rgba(232,90,30,${0.62 * flick}), rgba(20,17,16,0) 70%)` }} />

      {f < T.flip && <Embers f={f} />}

      {f < T.press && <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: out(T.press) }}><Big text={d.hook} f={f + 10} color={C.semna} size={140} /></AbsoluteFill>}

      {f >= T.press && f < T.lost && (
        <AbsoluteFill style={{ padding: '170px 56px 0', transform: `translateX(${shake}px)`, opacity: out(T.lost) }}>
          <Big text={d.pressure} f={f - T.press} color={C.semna} size={104} />
          <div style={{ alignSelf: 'center', marginTop: 26, background: d.accent, color: '#fff', borderRadius: 99, padding: '8px 34px', fontFamily: MONO, fontSize: 46 }}>{unread} رسالة</div>
          <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 26 }}>
            {[...d.messages].reverse().map((m, i, arr) => {
              const start = T.press + (arr.length - 1 - i) * stagger;
              const p = spring({ frame: f - start, fps: 30, config: { damping: 13, stiffness: 150 }, durationInFrames: 16 });
              return p > 0 ? <Row key={m.from} m={m} p={p} dark reply={0} /> : null;
            })}
          </div>
        </AbsoluteFill>
      )}

      {f >= T.lost && f < T.flip && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '0 70px', opacity: out(T.flip) }}><Big text={d.lost} f={f - T.lost} color={C.semna} size={124} /></AbsoluteFill>
      )}

      {/* ── same night: their own colours wipe in ── */}
      {f >= T.flip - 8 && f < T.end + 2 && (
        <AbsoluteFill style={{ background: d.page, opacity: wipe / 100 }}>
          <AbsoluteFill style={{ background: d.glow ?? 'radial-gradient(120% 70% at 50% 0%, rgba(255,245,225,0.6), transparent 65%), radial-gradient(120% 60% at 50% 100%, rgba(120,84,44,0.18), transparent 70%)' }} />
          {f < T.ans && <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: out(T.ans) }}>{d.flipLogo && <Img src={staticFile(d.logo)} style={{ width: 420, marginBottom: 50, mixBlendMode: onDark ? 'lighten' : 'multiply' }} />}<Big text={d.flip} f={f - T.flip} color={d.ink} size={140} /></AbsoluteFill>}

          {f >= T.ans && f < T.ticket && (
            <AbsoluteFill style={{ padding: '160px 56px 0', opacity: out(T.ticket) }}>
              <Big text={d.answered} f={f - T.ans} color={d.ink} size={70} font={UI} />
              <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column', gap: 20 }}>
                {d.messages.slice(0, 4).map((m, i) => {
                  const s = T.ans + i * 34;
                  const p = spring({ frame: f - s, fps: 30, config: { damping: 200 }, durationInFrames: 14 });
                  const r = interpolate(f, [s + 12, s + 24], [0, 1], clamp);
                  return p > 0 ? <Row key={m.from} m={m} p={p} dark={false} reply={r} /> : null;
                })}
              </div>
            </AbsoluteFill>
          )}

          {f >= T.ticket && f < T.end && <FoodBand src={d.food} f={f - T.ticket} o={out(T.end)} page={d.page} />}
          {f >= T.ticket && f < T.own && (
            <AbsoluteFill style={{ padding: '200px 50px 0', alignItems: 'center', opacity: out(T.own) }}>
              <Big text={d.ticketLine} f={f - T.ticket} color={d.ink} size={92} font={UI} />
              <div style={{ marginTop: 56, width: 940, overflow: 'hidden', height: interpolate(f, [T.ticket, T.ticket + 26], [120, 700], clamp), borderRadius: '0 0 14px 14px', boxShadow: '0 30px 60px -24px rgba(0,0,0,0.5)' }}>
                <div style={{ background: '#FFFDF7', padding: '44px 60px', fontFamily: MONO, color: '#141110', fontSize: 38, lineHeight: 1.7, height: 700, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ textAlign: 'center', fontWeight: 500, fontSize: 64 }}>{d.name}</div>
                  <div style={{ textAlign: 'center', fontSize: 40, marginBottom: 24 }}>{d.ticket.head} · O-7K3M</div>
                  <div style={{ borderTop: '3px dashed #999', margin: '6px 0 20px' }} />
                  {d.ticket.lines.map(([a, b]) => <div key={a} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 44, marginBottom: 12 }}><span>{a}</span><span>{b}</span></div>)}
                  {d.ticket.total ? <>
                    <div style={{ borderTop: '3px dashed #999', margin: '24px 0 16px' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 66, color: d.accent }}><span>TOTAL</span><span>{d.ticket.total}</span></div>
                  </> : <div style={{ borderTop: '3px dashed #999', margin: '24px 0 16px', paddingTop: 22, fontSize: 40, textAlign: 'center', color: d.accent }}>TO THE KITCHEN ✓</div>}
                </div>
              </div>
            </AbsoluteFill>
          )}

          {f >= T.own && f < T.end && (
            <AbsoluteFill style={{ padding: '200px 50px 0', opacity: out(T.end) }}>
              <Big text={d.ownLine} f={f - T.own} color={d.ink} size={104} font={UI} />
              <div style={{ marginTop: 60, display: 'flex', flexDirection: 'column', gap: 30 }}>
                {d.customers.map((c, i) => {
                  const p = spring({ frame: f - (T.own + i * 14), fps: 30, config: { damping: 200 }, durationInFrames: 14 });
                  return p > 0 ? (
                    <div key={c.name} style={{ background: '#fff', borderRadius: 30, padding: '44px 42px', direction: 'rtl', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: Math.min(p, 1), transform: `translateX(${(1 - Math.min(p, 1)) * 60}px)`, boxShadow: '0 14px 34px -16px rgba(0,0,0,0.35)' }}>
                      <div>
                        <div style={{ fontSize: 56, fontWeight: 700, color: '#141110' }}>{c.name} <span style={{ fontFamily: MONO, fontSize: 40, fontWeight: 500, color: '#667781', direction: 'ltr', unicodeBidi: 'isolate' }}>{c.phone}</span></div>
                        <div style={{ fontSize: 42, color: '#54656F', marginTop: 8 }}>بيحب: {c.fav}</div>
                      </div>
                      <span style={{ background: d.accent, color: '#fff', borderRadius: 99, padding: '10px 30px', fontSize: 36, fontWeight: 600 }}>{c.tag}</span>
                    </div>
                  ) : null;
                })}
              </div>
            </AbsoluteFill>
          )}
          {d.logo && <Img src={staticFile(d.logo)} style={{ position: 'absolute', right: 56, bottom: 44, width: 132, borderRadius: 14, boxShadow: d.flipLogo ? 'none' : '0 8px 24px rgba(0,0,0,0.3)', mixBlendMode: onDark ? 'lighten' : d.flipLogo ? 'multiply' : 'normal', opacity: d.flipLogo && f >= T.ticket ? 0 : out(T.end) }} />}
        </AbsoluteFill>
      )}

      {/* label, always on screen until the end card */}
      <div style={{ position: 'absolute', top: 88, left: 0, right: 0, textAlign: 'center', direction: 'rtl', fontSize: 34, fontWeight: 600, opacity: out(T.end), color: after && !onDark ? 'rgba(20,17,16,0.68)' : 'rgba(245,239,231,0.62)' }}>{label}</div>

      {/* sound: messages piling up, then each one answered */}
      {d.messages.map((_, i) => <Sequence key={`a${i}`} from={T.press + i * stagger} durationInFrames={10}><Audio src={staticFile('sfx/pop-in.wav')} /></Sequence>)}
      {d.messages.slice(0, 4).map((_, i) => <Sequence key={`b${i}`} from={T.ans + 12 + i * 34} durationInFrames={10}><Audio src={staticFile('sfx/pop-out.wav')} /></Sequence>)}

      {f >= T.end && <PostEnd frame={f} endStart={T.end} payoff={d.payoff} />}
    </AbsoluteFill>
  );
};
