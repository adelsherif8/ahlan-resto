/**
 * The link-preview card — what WhatsApp, iMessage, Slack and Google show for
 * munadim.com. Rendered, never screenshotted: the first og.png WAS a screenshot and
 * shipped a browser's broken-image glyph baked into the pixels, because the logo had
 * not loaded when the shot was taken. Here the fonts and the mark are real assets that
 * must resolve or the render fails loudly.
 *
 * It shows the PRODUCT, not just the mark: a preview that proves what Munadim does in
 * the half-second someone glances at a shared link beats one that only says its name.
 *
 *   npx remotion still src/index.ts OG ../site/public/brand/og.png --gl=angle
 */
import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Img, continueRender, delayRender, staticFile } from 'remotion';
import { C } from './lib/brand';

const FACES: [string, string, string][] = [
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-regular.woff2', '400'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-500.woff2', '500'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-600.woff2', '600'],
  ['Amiri', 'fonts/amiri-v30-arabic-700.woff2', '700'],
  ['Cinzel', 'fonts/cinzel-v26-latin-600.woff2', '600'],
];
function useFontsReady() {
  const [h] = useState(() => delayRender('og-fonts'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all(FACES.map(([f, file, w]) => new FontFace(f, `url(${staticFile(file)})`, { weight: w }).load()))
      .then((fs) => { fs.forEach((x) => document.fonts.add(x)); setReady(true); continueRender(h); });
  }, [h]);
  return ready;
}

const UI = 'Plex';

/** A real exchange, real menu prices — the same rule the posts follow. */
const THREAD: [boolean, string][] = [
  [true, 'عايز مُنادم كلاسيك برجر كومبو'],
  [false, 'مُنادم كلاسيك برجر (كومبو) — 265 جنيه\nأأكد الأوردر؟'],
  [true, 'تأكيد'],
  [false, 'طلبك O-4TBC اتسجل — حوالي ١٥ دقيقة ✅'],
];

const Bubble = ({ me, text }: { me: boolean; text: string }) => (
  <div style={{
    alignSelf: me ? 'flex-end' : 'flex-start',
    maxWidth: '88%',
    background: me ? C.waOut : C.waIn,
    borderRadius: 12,
    [me ? 'borderTopLeftRadius' : 'borderTopRightRadius']: 3,
    padding: '9px 13px',
    fontSize: 17, lineHeight: 1.5, color: '#111B21',
    whiteSpace: 'pre-wrap',
    boxShadow: '0 1px 1px rgba(11,20,26,0.10)',
  }}>{text}</div>
);

export const OG: React.FC = () => {
  const ready = useFontsReady();
  if (!ready) return <AbsoluteFill style={{ background: C.semna }} />;
  return (
    <AbsoluteFill style={{ background: C.semna, fontFamily: UI, display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
      {/* the product, tilted off the left edge so it reads as a real device */}
      <div style={{ width: 430, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{
          width: 300, height: 520, marginLeft: -46, marginTop: 54,
          borderRadius: 34, border: '9px solid #231E1C', background: '#231E1C',
          transform: 'rotate(-3.5deg)', boxShadow: '0 40px 70px -24px rgba(20,17,16,0.42)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ background: '#008069', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 9, direction: 'rtl' }}>
            <Img src={staticFile('01-mark-fine-brass-on-ink-nobg.svg')}
              style={{ width: 34, height: 34, borderRadius: 999, background: C.ink, padding: 5 }} />
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>مُنادم</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>متصل</div>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, background: C.waBg, padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8, direction: 'rtl' }}>
            {THREAD.map(([me, t], i) => <Bubble key={i} me={me} text={t} />)}
          </div>
        </div>
      </div>
      {/* the claim, on the right so the Arabic reads to its natural edge */}
      <div style={{ flex: 1, padding: '0 74px 0 36px', direction: 'rtl' }}>
        <Img src={staticFile('20-lockup-horizontal-dark-nobg.svg')} style={{ width: 290, display: 'block', marginInlineStart: 'auto' }} />
        <div style={{ width: 104, height: 4, background: C.karkadeh, borderRadius: 2, margin: '30px 0 26px', marginInlineStart: 'auto' }} />
        <div style={{ fontFamily: 'Amiri', fontWeight: 700, fontSize: 52, lineHeight: 1.35, color: C.ink }}>
          مطعمك بيرد على واتساب،<br />ويسجّل الأوردر لوحده
        </div>
        <div style={{ marginTop: 20, fontSize: 21, color: 'rgba(20,17,16,0.6)', direction: 'ltr', textAlign: 'right', lineHeight: 1.5 }}>
          Delivery, pickup and dine-in — every order<br />leaves you the customer's number.
        </div>
      </div>

    </AbsoluteFill>
  );
};
