import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion';
import { qrCard, bubble, SCRIPT, glowFor, typingBubble, drawTypingDots, drawPhoneScreen, mk, SW, SH, mapPlate, orderTicket, etaChip, pinBadge, scooterIcon, menuCard, cityMap, mapLabel, riderMarker, shopSign } from './lib/textures';

const FACES: [string, string, string][] = [
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-regular.woff2', '400'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-500.woff2', '500'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-600.woff2', '600'],
  ['Plex', 'fonts/ibm-plex-sans-arabic-v15-arabic_latin-700.woff2', '700'],
  ['PlexMono', 'fonts/ibm-plex-mono-v20-latin-500.woff2', '500'],
];
function useFontsReady() {
  const [h] = useState(() => delayRender('fonts'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all(FACES.map(([fam, file, w]) => new FontFace(fam, `url(${staticFile(file)})`, { weight: w }).load())).then((fs) => {
      fs.forEach((x) => document.fonts.add(x));
      setReady(true);
      continueRender(h);
    });
  }, [h]);
  return ready;
}

/** Paint a canvas at top-left with faint corner markers so the exact size can be recovered by alpha bbox. */
function Paint({ draw, w, h }: { draw: (ctx: CanvasRenderingContext2D) => void; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    draw(ctx);
  });
  return <canvas ref={ref} width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }} />;
}

function withMarkers(src: HTMLCanvasElement) {
  return (ctx: CanvasRenderingContext2D) => {
    ctx.drawImage(src, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.02)';
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillRect(src.width - 1, src.height - 1, 1, 1);
  };
}

/** frame 0 = QR card, 1-6 = bubbles, 7-12 = glows, 13 = typing glow */
export function Tex() {
  const ready = useFontsReady();
  const f = useCurrentFrame();
  if (!ready) return null;
  return <TexInner f={f} />;
}
function TexInner({ f }: { f: number }) {
  const list = useMemo(() => {
    const bs = SCRIPT.map(bubble);
    return [
      qrCard(), ...bs.map((b) => b.c), ...bs.map(glowFor), glowFor(typingBubble()),
      mapPlate(), orderTicket(), etaChip(), pinBadge('shop', 'برجر تحت البيت'), pinBadge('home', 'بيتك'), scooterIcon(), menuCard(),
    ];
  }, []);
  return (
    <AbsoluteFill>
      <Paint draw={withMarkers(list[f])} w={1700} h={1500} />
    </AbsoluteFill>
  );
}

/** frame 0 = city map, 1-2 = map labels, 3 = rider, 4 = shop sign */
export function CityTex() {
  const ready = useFontsReady();
  const f = useCurrentFrame();
  if (!ready) return null;
  return <CityTexInner f={f} />;
}
function CityTexInner({ f }: { f: number }) {
  const list = useMemo(() => [
    cityMap(3072),
    mapLabel('shop', 'برجر تحت البيت', 'المطعم'),
    mapLabel('home', 'بيتك', 'شارع 9 — نفس العنوان'),
    riderMarker(),
    shopSign(),
  ], []);
  return (
    <AbsoluteFill>
      <Paint draw={withMarkers(list[f])} w={3072} h={3072} />
    </AbsoluteFill>
  );
}

export function Typing() {
  const ready = useFontsReady();
  const f = useCurrentFrame();
  const b = useMemo(() => typingBubble(), []);
  if (!ready) return null;
  return (
    <AbsoluteFill>
      <Paint draw={(ctx) => { drawTypingDots(b, f); ctx.drawImage(b.c, 0, 0); }} w={b.c.width} h={b.c.height} />
    </AbsoluteFill>
  );
}

export function Screen() {
  const ready = useFontsReady();
  const f = useCurrentFrame();
  if (!ready) return null;
  return <ScreenInner f={f} />;
}
function ScreenInner({ f }: { f: number }) {
  const card = useMemo(() => qrCard(), []);
  const bubbles = useMemo(() => SCRIPT.map(bubble), []);
  const chat = useMemo(() => mk(SW, SH).ctx, []);
  return (
    <AbsoluteFill>
      <Paint draw={(ctx) => drawPhoneScreen(ctx, chat, f, card, bubbles)} w={SW} h={SH} />
    </AbsoluteFill>
  );
}
