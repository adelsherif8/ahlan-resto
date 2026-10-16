import QRCode from 'qrcode';
import { C, FONT, MONO, RESTAURANT, DEMO_LABEL } from './brand';
import { rng, prog, easeOut, easeInOut } from './anim';
import { T, ITEMS } from './timeline';

export const mk = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return { c, ctx };
};

export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------------------------------------------------------------- wood */
export function woodTexture() {
  const W = 2048, H = 1024;
  const { c, ctx } = mk(W, H);
  const R = rng(7);
  const planks = 5;
  const ph = H / planks;
  for (let p = 0; p < planks; p++) {
    const y0 = p * ph;
    const tone = 0.85 + R() * 0.3;
    const base = [88 * tone, 56 * tone, 34 * tone];
    ctx.fillStyle = `rgb(${base.join(',')})`;
    ctx.fillRect(0, y0, W, ph);
    // broad colour bands
    for (let i = 0; i < 18; i++) {
      const yy = y0 + R() * ph;
      const g = ctx.createLinearGradient(0, yy - 30, 0, yy + 30);
      const dark = R() > 0.5;
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, dark ? 'rgba(30,15,6,0.25)' : 'rgba(170,120,75,0.16)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, yy - 30, W, 60);
    }
    // grain lines
    for (let i = 0; i < 170; i++) {
      const yy = y0 + R() * ph;
      const a1 = 2 + R() * 7, f1 = 0.002 + R() * 0.004, s1 = R() * 6;
      const a2 = R() * 2, f2 = 0.01 + R() * 0.02, s2 = R() * 6;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = yy + a1 * Math.sin(x * f1 + s1) + a2 * Math.sin(x * f2 + s2);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      const dark = R() > 0.35;
      ctx.strokeStyle = dark ? `rgba(28,14,5,${0.1 + R() * 0.25})` : `rgba(190,140,90,${0.05 + R() * 0.12})`;
      ctx.lineWidth = 0.6 + R() * 2.4;
      ctx.stroke();
    }
    // a knot
    if (R() > 0.4) {
      const kx = R() * W, ky = y0 + ph * (0.3 + R() * 0.4);
      for (let k = 0; k < 9; k++) {
        ctx.beginPath();
        ctx.ellipse(kx, ky, 8 + k * 9, 3 + k * 3.2, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(30,14,5,${0.35 - k * 0.03})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // seam
    ctx.fillStyle = 'rgba(12,6,2,0.85)';
    ctx.fillRect(0, y0, W, 3);
    // plank end joints
    const jx = R() * W;
    ctx.fillRect(jx, y0, 3, ph);
  }
  // fine speckle
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (R() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ------------------------------------------------------------- backdrop */
export function bokehTexture() {
  const W = 2048, H = 1536;
  const { c, ctx } = mk(W, H);
  const R = rng(21);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1c130d');
  g.addColorStop(0.55, '#120c08');
  g.addColorStop(1, '#070504');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.filter = 'blur(40px)';
  // warm wall wash
  for (let i = 0; i < 6; i++) {
    const x = R() * W, y = H * (0.2 + R() * 0.4), r = 250 + R() * 300;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(150,90,40,0.35)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // silhouettes of other tables / people
  ctx.fillStyle = 'rgba(5,3,2,0.8)';
  for (let i = 0; i < 7; i++) {
    const x = R() * W, w = 160 + R() * 260, h = 300 + R() * 400;
    rr(ctx, x, H - h * 0.9, w, h, 80);
    ctx.fill();
  }
  ctx.filter = 'blur(6px)';
  // bokeh discs
  for (let i = 0; i < 150; i++) {
    const x = R() * W, y = H * (0.05 + R() * 0.62), r = 8 + Math.pow(R(), 2) * 38;
    const warm = R() > 0.12;
    const col = warm ? [255, 165 + R() * 60, 85 + R() * 60] : [140, 210, 200];
    const a = 0.08 + R() * 0.28;
    const rg = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    rg.addColorStop(0, `rgba(${col.join(',')},${a * 0.8})`);
    rg.addColorStop(0.85, `rgba(${col.join(',')},${a})`);
    rg.addColorStop(1, `rgba(${col.join(',')},0)`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // pendant lamps
  ctx.filter = 'blur(12px)';
  for (let i = 0; i < 4; i++) {
    const x = W * (0.12 + i * 0.26 + R() * 0.05), y = H * (0.08 + R() * 0.1);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, 120);
    rg.addColorStop(0, 'rgba(255,215,150,0.95)');
    rg.addColorStop(0.3, 'rgba(255,170,80,0.45)');
    rg.addColorStop(1, 'rgba(255,140,50,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - 120, y - 120, 240, 240);
  }
  ctx.filter = 'none';
  return c;
}

/* ---------------------------------------------------------------- QR */
export function drawQR(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = C.ink) {
  const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = q.modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  ctx.fillStyle = color;
  for (let r = 0; r < n; r++)
    for (let col = 0; col < n; col++)
      if (q.modules.data[r * n + col]) {
        ctx.fillRect(x + (col + quiet) * cell, y + (r + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
      }
}

export function avatar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#6B3F22';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFF';
  ctx.font = `700 ${r * 1.05}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ب', x, y + r * 0.08);
}

export const QR_URL = 'https://munadim.com';

export function qrCard() {
  const W = 900, H = 1300;
  const { c, ctx } = mk(W, H);
  ctx.fillStyle = C.semna;
  ctx.fillRect(0, 0, W, H);
  ctx.direction = 'rtl';
  avatar(ctx, W / 2, 130, 62);
  ctx.fillStyle = C.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 84px ${FONT}`;
  ctx.fillText(RESTAURANT, W / 2, 300);
  ctx.fillStyle = '#8A601E';
  ctx.font = `600 50px ${FONT}`;
  ctx.fillText('امسح واطلب على الواتساب', W / 2, 380);
  // qr panel
  ctx.fillStyle = '#FFFFFF';
  rr(ctx, 130, 430, 640, 640, 36);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,17,16,0.12)';
  ctx.lineWidth = 3;
  ctx.stroke();
  drawQR(ctx, QR_URL, 150, 450, 600);
  ctx.fillStyle = C.karkadeh;
  rr(ctx, W / 2 - 215, 1095, 430, 84, 42);
  ctx.fill();
  ctx.fillStyle = C.semna;
  ctx.font = `700 44px ${FONT}`;
  ctx.fillText('دليفري · تيك أواي', W / 2, 1152);
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, H - 90, W, 90);
  ctx.fillStyle = C.semna;
  ctx.font = `600 36px ${FONT}`;
  ctx.fillText(DEMO_LABEL, W / 2, H - 32);
  return c;
}

/* ------------------------------------------------------------- chat */
export type Msg =
  | { kind: 'voice'; me: true; time: string; dur: string }
  | { kind: 'text'; me: boolean; time: string; text: string }
  | { kind: 'bill'; me: false; time: string; lines: [string, number][]; total: [string, number]; after: string };

export const SCRIPT: Msg[] = [
  { kind: 'voice', me: true, time: '9:41', dur: '0:07' },
  { kind: 'text', me: false, time: '9:41', text: 'أهلاً 👋 من برجر تحت البيت. وصلني: واحد كلاسيك برجر كومبو من غير بصل + فرايز تشيدر. توصيل ولا استلام؟' },
  { kind: 'text', me: true, time: '9:42', text: 'دليفري. نفس العنوان' },
  {
    kind: 'bill', me: false, time: '9:42',
    lines: [['كلاسيك برجر كومبو', 295], ['فرايز تشيدر', 75], ['التوصيل', 25]],
    total: ['الإجمالي', 395], after: 'كاش ولا فيزا؟',
  },
  { kind: 'text', me: true, time: '9:43', text: 'كاش، معايا 500' },
  { kind: 'text', me: false, time: '9:43', text: 'تمام ✅ الباقي 105 مع الكابتن. الأوردر في المطبخ، وهيوصلك في حدود 40 دقيقة.' },
];

const FS = 46; // body font px
const LH = 70;
const PADX = 36;
const PADT = 28;
const META = 46;
const MAXW = 800;
export const M = 40; // glow margin baked around each bubble canvas

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function ticks(ctx: CanvasRenderingContext2D, x: number, y: number, read: boolean) {
  ctx.strokeStyle = read ? '#53BDEB' : '#8696A0';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  for (const dx of [0, 11]) {
    ctx.beginPath();
    ctx.moveTo(x + dx, y);
    ctx.lineTo(x + dx + 7, y + 8);
    ctx.lineTo(x + dx + 21, y - 8);
    ctx.stroke();
  }
}

function meta(ctx: CanvasRenderingContext2D, m: Msg, bx: number, by: number, bh: number) {
  ctx.font = `500 28px ${MONO}`;
  ctx.fillStyle = '#667781';
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  const y = by + bh - 20;
  let x = bx + PADX - 8;
  if (m.me) {
    ticks(ctx, x, y - 10, true);
    x += 42;
  }
  ctx.fillText(m.time, x, y);
  ctx.direction = 'rtl';
}

function shell(w: number, h: number, me: boolean) {
  const { c, ctx } = mk(w + M * 2, h + M * 2);
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = me ? C.waOut : C.waIn;
  rr(ctx, M, M, w, h, 30);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.direction = 'rtl';
  ctx.textBaseline = 'alphabetic';
  return { c, ctx };
}

export type Bubble = { c: HTMLCanvasElement; w: number; h: number; me: boolean };

export function bubble(m: Msg): Bubble {
  const probe = mk(10, 10).ctx;
  probe.font = `500 ${FS}px ${FONT}`;
  if (m.kind === 'voice') {
    const w = 620, h = 150;
    const { c, ctx } = shell(w, h, true);
    const x0 = M, y0 = M;
    // play triangle (RTL mirrors: points left, sits right)
    ctx.fillStyle = '#54656F';
    ctx.beginPath();
    const px = x0 + w - 60, py = y0 + 62;
    ctx.moveTo(px + 14, py - 22);
    ctx.lineTo(px + 14, py + 22);
    ctx.lineTo(px - 20, py);
    ctx.closePath();
    ctx.fill();
    // waveform
    const R = rng(3);
    for (let i = 0; i < 34; i++) {
      const bx = x0 + w - 115 - i * 12.5;
      const hh = 8 + Math.abs(Math.sin(i * 0.7)) * 26 + R() * 18;
      ctx.fillStyle = i < 6 ? '#1FA855' : '#8FA3AD';
      rr(ctx, bx, py - hh / 2, 6, hh, 3);
      ctx.fill();
    }
    // playhead dot
    ctx.fillStyle = '#1FA855';
    ctx.beginPath();
    ctx.arc(x0 + w - 115 - 6 * 12.5 + 3, py, 11, 0, Math.PI * 2);
    ctx.fill();
    // mic
    ctx.strokeStyle = '#1FA855';
    ctx.fillStyle = '#1FA855';
    ctx.lineWidth = 4;
    rr(ctx, x0 + 44, py - 26, 20, 34, 10);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x0 + 54, py - 4, 20, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0 + 54, py + 16);
    ctx.lineTo(x0 + 54, py + 28);
    ctx.stroke();
    ctx.font = `500 28px ${MONO}`;
    ctx.fillStyle = '#667781';
    ctx.textAlign = 'right';
    ctx.direction = 'ltr';
    ctx.fillText(m.dur, x0 + w - 110, y0 + h - 20);
    meta(ctx, m, x0, y0, h);
    return { c, w, h, me: true };
  }
  if (m.kind === 'text') {
    const lines = wrap(probe, m.text, MAXW - PADX * 2);
    const tw = Math.max(...lines.map((l) => probe.measureText(l).width));
    const w = Math.max(tw + PADX * 2, 300);
    const h = PADT + lines.length * LH + META;
    const { c, ctx } = shell(w, h, m.me);
    ctx.font = `500 ${FS}px ${FONT}`;
    ctx.fillStyle = '#0B1419';
    ctx.textAlign = 'right';
    lines.forEach((l, i) => ctx.fillText(l, M + w - PADX, M + PADT + (i + 0.78) * LH));
    meta(ctx, m, M, M, h);
    return { c, w, h, me: m.me };
  }
  // bill
  const w = 660;
  const rows = m.lines.length;
  const h = PADT + rows * 66 + 30 + 76 + 80 + META;
  const { c, ctx } = shell(w, h, false);
  let y = M + PADT + 48;
  const L = M + PADX, Rx = M + w - PADX;
  for (const [label, price] of m.lines) {
    ctx.font = `500 ${FS - 2}px ${FONT}`;
    ctx.fillStyle = '#111B21';
    ctx.textAlign = 'right';
    ctx.fillText(label, Rx, y);
    ctx.font = `500 ${FS - 4}px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.fillText(String(price), L, y);
    ctx.direction = 'rtl';
    y += 66;
  }
  ctx.fillStyle = 'rgba(17,27,33,0.18)';
  ctx.fillRect(L, y - 30, w - PADX * 2, 3);
  y += 30;
  ctx.fillStyle = '#111B21';
  ctx.font = `700 ${FS}px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(m.total[0], Rx, y);
  ctx.font = `600 ${FS}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.fillText(String(m.total[1]), L, y);
  ctx.direction = 'rtl';
  y += 84;
  ctx.font = `500 ${FS}px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(m.after, Rx, y);
  meta(ctx, m, M, M, h);
  return { c, w, h, me: false };
}

export function typingBubble(): Bubble {
  const w = 190, h = 100;
  const { c } = shell(w, h, false);
  return { c, w, h, me: false };
}
/** redraws the three dots on a typing bubble canvas for frame f */
export function drawTypingDots(b: Bubble, f: number) {
  const ctx = b.c.getContext('2d')!;
  ctx.clearRect(0, 0, b.c.width, b.c.height);
  ctx.fillStyle = C.waIn;
  rr(ctx, M, M, b.w, b.h, 30);
  ctx.fill();
  for (let i = 0; i < 3; i++) {
    const ph = Math.sin(f * 0.35 - i * 0.9);
    ctx.fillStyle = `rgba(134,150,160,${0.45 + 0.55 * Math.max(0, ph)})`;
    ctx.beginPath();
    ctx.arc(M + b.w / 2 + (i - 1) * 34, M + b.h / 2 - Math.max(0, ph) * 6, 11, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** soft neon outline used behind each hologram bubble */
export function glowFor(b: Bubble) {
  const { c, ctx } = mk(b.w + M * 2, b.h + M * 2);
  ctx.filter = 'blur(14px)';
  ctx.strokeStyle = C.holo;
  ctx.lineWidth = 10;
  rr(ctx, M, M, b.w, b.h, 30);
  ctx.stroke();
  ctx.filter = 'none';
  ctx.strokeStyle = 'rgba(200,255,235,0.9)';
  ctx.lineWidth = 2.5;
  rr(ctx, M - 3, M - 3, b.w + 6, b.h + 6, 32);
  ctx.stroke();
  return c;
}

export function scanlines() {
  const { c, ctx } = mk(8, 64);
  for (let y = 0; y < 64; y += 4) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(0, y, 8, 1.4);
  }
  return c;
}

/* --------------------------------------------------------- phone screen */
export const SW = 600, SH = 1290;

function statusBar(ctx: CanvasRenderingContext2D, dark: boolean) {
  ctx.fillStyle = dark ? '#fff' : '#111';
  ctx.font = `600 30px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.fillText('9:41', 52, 62);
  // battery
  ctx.strokeStyle = ctx.fillStyle as string;
  ctx.lineWidth = 2.5;
  rr(ctx, SW - 100, 40, 48, 24, 7);
  ctx.stroke();
  rr(ctx, SW - 96, 44, 34, 16, 4);
  ctx.fill();
  // dynamic island
  ctx.fillStyle = '#000';
  rr(ctx, SW / 2 - 90, 22, 180, 52, 26);
  ctx.fill();
}

export function drawViewfinder(ctx: CanvasRenderingContext2D, card: HTMLCanvasElement, f: number, lock: number, banner: number) {
  // camera feed: warm blurred table + card
  const g = ctx.createLinearGradient(0, 0, 0, SH);
  g.addColorStop(0, '#2a1b12');
  g.addColorStop(1, '#4a2e1b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SW, SH);
  const z = 1 + (f % 1000) * 0.0012;
  const cw = 380 * z, ch = cw * (card.height / card.width);
  const cx = SW / 2 + Math.sin(f * 0.21) * 3, cy = SH / 2 - 10 + Math.cos(f * 0.17) * 3;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 30;
  ctx.drawImage(card, cx - cw / 2, cy - ch / 2, cw, ch);
  ctx.restore();
  // warm light falloff on feed
  const v = ctx.createRadialGradient(SW / 2, SH / 2, 200, SW / 2, SH / 2, 800);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, SW, SH);
  // QR bounds on screen
  const qx = cx - cw / 2 + cw * (150 / 900), qy = cy - ch / 2 + ch * (450 / 1300), qs = cw * (600 / 900);
  // brackets travel from wide to QR
  const bx0 = 70, by0 = 300, bs0 = SW - 140;
  const bx = bx0 + (qx - bx0) * lock, by = by0 + (qy - by0) * lock, bs = bs0 + (qs - bs0) * lock;
  ctx.strokeStyle = lock >= 1 ? '#FFD60A' : 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  const L = 46;
  const corners: [number, number, number, number][] = [
    [bx, by, 1, 1], [bx + bs, by, -1, 1], [bx, by + bs, 1, -1], [bx + bs, by + bs, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * L);
    ctx.lineTo(x, y);
    ctx.lineTo(x + sx * L, y);
    ctx.stroke();
  }
  statusBar(ctx, true);
  // shutter + mode row
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, SH - 250, SW, 250);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(SW / 2, SH - 120, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(SW / 2, SH - 120, 50, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#FFD60A';
  ctx.font = `600 26px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('PHOTO', SW / 2, SH - 205);
  // detected banner
  if (banner > 0) {
    ctx.globalAlpha = banner;
    const by2 = qy + qs + 40 - (1 - banner) * 20;
    ctx.fillStyle = '#FFD60A';
    rr(ctx, SW / 2 - 200, by2, 400, 78, 39);
    ctx.fill();
    ctx.fillStyle = '#25D366';
    ctx.beginPath();
    ctx.arc(SW / 2 + 150, by2 + 39, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.font = `600 32px ${FONT}`;
    ctx.fillText('افتح في واتساب', SW / 2 - 16, by2 + 50);
    ctx.globalAlpha = 1;
  }
}

export function drawChatScreen(ctx: CanvasRenderingContext2D, bubbles: { b: Bubble; a: number }[], glow: number) {
  ctx.fillStyle = C.waBg;
  ctx.fillRect(0, 0, SW, SH);
  // faint doodle wallpaper
  ctx.strokeStyle = 'rgba(120,100,80,0.10)';
  ctx.lineWidth = 2;
  for (let y = 160; y < SH; y += 80)
    for (let x = (y / 80) % 2 ? 20 : 60; x < SW; x += 80) {
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  // header
  ctx.fillStyle = '#F0F2F5';
  ctx.fillRect(0, 0, SW, 190);
  statusBar(ctx, false);
  avatar(ctx, SW - 70, 138, 34);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#111B21';
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText(RESTAURANT, SW - 120, 132);
  ctx.fillStyle = '#667781';
  ctx.font = `400 24px ${FONT}`;
  ctx.fillText('متصل', SW - 120, 166);
  ctx.fillStyle = '#54656F';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(40, 118 + i * 14, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // demo pill
  ctx.fillStyle = 'rgba(84,101,111,0.85)';
  rr(ctx, SW / 2 - 90, 212, 180, 44, 22);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText(DEMO_LABEL, SW / 2, 242);
  // a faded trace of the last order, so the chat reads as a regular customer's
  const live = bubbles.filter((b) => b.a > 0.05).length;
  const hist = Math.max(0, 1 - live / 2.2);
  if (hist > 0.01) {
    ctx.globalAlpha = 0.5 * hist;
    ctx.fillStyle = 'rgba(84,101,111,0.7)';
    rr(ctx, SW / 2 - 70, 292, 140, 40, 20);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText('الأسبوع اللي فات', SW / 2, 319);
    const old: [boolean, string, string][] = [
      [false, 'الأوردر خرج مع الكابتن 🛵', '8:12'],
      [true, 'تمام، تسلم', '8:13'],
    ];
    let oy = 356;
    for (const [me, text, time] of old) {
      ctx.font = `400 26px ${FONT}`;
      const w = Math.min(ctx.measureText(text).width + 52, SW - 120);
      const x = me ? 16 : SW - 16 - w;
      ctx.fillStyle = me ? C.waOut : C.waIn;
      rr(ctx, x, oy, w, 78, 16);
      ctx.fill();
      ctx.fillStyle = '#111B21';
      ctx.textAlign = 'right';
      ctx.direction = 'rtl';
      ctx.fillText(text, x + w - 18, oy + 38);
      ctx.fillStyle = '#667781';
      ctx.font = `500 18px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.direction = 'ltr';
      ctx.fillText(time, x + 16, oy + 66);
      ctx.direction = 'rtl';
      oy += 92;
    }
    ctx.globalAlpha = 1;
  }
  // messages, newest at the bottom
  const s = 0.5;
  let y = SH - 130;
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const { b, a } = bubbles[i];
    if (a <= 0) continue;
    const w = (b.w + M * 2) * s, h = (b.h + M * 2) * s;
    y -= (h - M * s) * Math.min(1, a * 1.5);
    if (y < 250) break;
    const x = b.me ? 16 - M * s : SW - 16 - w + M * s;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(b.c, x, y, w, h);
    ctx.globalAlpha = 1;
  }
  // input bar
  ctx.fillStyle = '#F0F2F5';
  ctx.fillRect(0, SH - 110, SW, 110);
  ctx.fillStyle = '#fff';
  rr(ctx, 110, SH - 92, SW - 130, 64, 32);
  ctx.fill();
  ctx.fillStyle = '#25D366';
  ctx.beginPath();
  ctx.arc(60, SH - 60, 34, 0, Math.PI * 2);
  ctx.fill();
  // projector glow over the screen during hologram
  if (glow > 0) {
    const rg = ctx.createRadialGradient(SW / 2, SH * 0.55, 0, SW / 2, SH * 0.55, SH * 0.6);
    rg.addColorStop(0, `rgba(124,245,194,${0.35 * glow})`);
    rg.addColorStop(1, 'rgba(124,245,194,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, SW, SH);
  }
}

/* ---------------------------------------------------------------- food */
export function checkerTexture() {
  const { c, ctx } = mk(512, 512);
  const n = 8, cs = 512 / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#F4EFE6' : '#B3202A';
      ctx.fillRect(x * cs, y * cs, cs, cs);
    }
  return c;
}

/** Lock screen: the phone is face-up on the table and lights up. */
export function drawLockScreen(ctx: CanvasRenderingContext2D, f: number) {
  const g = ctx.createLinearGradient(0, 0, 0, SH);
  g.addColorStop(0, '#15100c');
  g.addColorStop(1, '#2a1d14');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SW, SH);
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = `300 190px ${FONT}`;
  ctx.fillText('9:41', SW / 2, 400);
  ctx.direction = 'rtl';
  ctx.font = `500 34px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('الجمعة 9 أكتوبر', SW / 2, 460);
  // a WhatsApp card, the way a delivery regular starts the order
  const y = 560;
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  rr(ctx, 40, y, SW - 80, 150, 34);
  ctx.fill();
  ctx.fillStyle = '#25D366';
  ctx.beginPath();
  ctx.arc(86, y + 56, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'right';
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText('واتساب', SW - 46, y + 62);
  ctx.font = `400 30px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(RESTAURANT, SW - 46, y + 112);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText('اسحب لفوق للفتح', SW / 2, SH - 120);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  rr(ctx, SW / 2 - 90, SH - 70, 180, 8, 4);
  ctx.fill();
}

/** Full phone screen for frame f (viewfinder -> tap -> WhatsApp chat). */
export function drawPhoneScreen(ctx: CanvasRenderingContext2D, chat: CanvasRenderingContext2D, f: number, _card: HTMLCanvasElement, bubbles: Bubble[]) {
  // the phone is simply open on the WhatsApp chat the whole time
  const glow = prog(f, T.rise[1] - 10, T.rise[1] + 10) * (1 - prog(f, T.collapse[0], T.collapse[1]));
  const vis = bubbles.map((b, i) => {
    const it = ITEMS.find((x) => x.msg === i)!;
    return { b, a: prog(f, it.in, it.in + 10) };
  });
  drawChatScreen(chat, vis, glow);
  ctx.drawImage(chat.canvas, 0, 0);
}

/* ------------------------------------------------- delivery act artwork */

/** Holographic street map plate: transparent, mint lines. */
export function mapPlate() {
  const W = 1600, H = 1200;
  const { c, ctx } = mk(W, H);
  const R = rng(31);
  const mint = (a: number) => `rgba(124,245,194,${a})`;
  // faint ground fill inside a rounded border
  rr(ctx, 12, 12, W - 24, H - 24, 60);
  ctx.fillStyle = 'rgba(10,40,32,0.30)';
  ctx.fill();
  ctx.strokeStyle = mint(0.75);
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.save();
  rr(ctx, 12, 12, W - 24, H - 24, 60);
  ctx.clip();
  // blocks
  const cols = [0, 210, 430, 700, 900, 1150, 1380, 1600];
  const rows = [0, 190, 380, 620, 820, 1010, 1200];
  for (let i = 0; i < cols.length - 1; i++)
    for (let j = 0; j < rows.length - 1; j++) {
      const x = cols[i] + 26, y = rows[j] + 26;
      const w = cols[i + 1] - cols[i] - 52, h = rows[j + 1] - rows[j] - 52;
      if (w <= 0 || h <= 0) continue;
      ctx.fillStyle = mint(0.06 + R() * 0.07);
      rr(ctx, x, y, w, h, 10);
      ctx.fill();
      ctx.strokeStyle = mint(0.22);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  // streets
  ctx.strokeStyle = mint(0.5);
  ctx.lineWidth = 3;
  for (const x of cols.slice(1, -1)) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (const y of rows.slice(1, -1)) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // a diagonal avenue and a river
  ctx.strokeStyle = mint(0.7);
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(-40, 980); ctx.lineTo(W + 40, 250); ctx.stroke();
  ctx.strokeStyle = 'rgba(90,190,255,0.35)';
  ctx.lineWidth = 60;
  ctx.beginPath();
  ctx.moveTo(-40, 120); ctx.bezierCurveTo(420, 240, 900, 40, W + 40, 200);
  ctx.stroke();
  // grid dust
  ctx.fillStyle = mint(0.3);
  for (let i = 0; i < 260; i++) ctx.fillRect(R() * W, R() * H, 2, 2);
  ctx.restore();
  return c;
}

/** The restaurant's own order ticket — what the kitchen sees. */
export function orderTicket() {
  const W = 880, H = 1020;
  const { c, ctx } = mk(W, H);
  ctx.fillStyle = '#FFFDF8';
  rr(ctx, 0, 0, W, H, 26);
  ctx.fill();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  // header
  ctx.fillStyle = C.ink;
  rr(ctx, 0, 0, W, 150, 26);
  ctx.fill();
  ctx.fillRect(0, 110, W, 40);
  ctx.fillStyle = C.semna;
  ctx.font = `700 52px ${FONT}`;
  ctx.fillText('أوردر جديد', W - 40, 70);
  ctx.font = `500 34px ${FONT}`;
  ctx.fillStyle = C.brassLight;
  ctx.fillText('واتساب · دليفري', W - 40, 120);
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.font = `500 44px ${MONO}`;
  ctx.fillStyle = C.semna;
  ctx.fillText('#1042', 40, 88);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  let y = 232;
  const row = (label: string, val: string, bold = false) => {
    ctx.fillStyle = '#141110';
    ctx.font = `${bold ? 700 : 400} 40px ${FONT}`;
    ctx.fillText(label, W - 40, y);
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.font = `500 40px ${MONO}`;
    ctx.fillText(val, 40, y);
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    y += 64;
  };
  row('كلاسيك برجر كومبو', '295');
  ctx.fillStyle = '#8C8477';
  ctx.font = `400 30px ${FONT}`;
  ctx.fillText('من غير بصل', W - 40, y - 26);
  y += 12;
  row('فرايز تشيدر', '75');
  row('التوصيل', '25');
  ctx.strokeStyle = 'rgba(20,17,16,0.25)';
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(40, y - 24); ctx.lineTo(W - 40, y - 24); ctx.stroke();
  ctx.setLineDash([]);
  y += 24;
  row('الإجمالي', '395', true);
  y += 8;
  ctx.fillStyle = '#2F6B45';
  ctx.font = `600 36px ${FONT}`;
  ctx.fillText('كاش 500 — الباقي 105', W - 40, y);
  y += 70;
  ctx.fillStyle = '#141110';
  ctx.font = `600 38px ${FONT}`;
  ctx.fillText('شارع 9 — نفس العنوان', W - 40, y);
  y += 52;
  ctx.fillStyle = '#8C8477';
  ctx.font = `400 32px ${FONT}`;
  ctx.fillText('زبون بيطلب من 4 شهور · 12 أوردر', W - 40, y);
  // footer state
  ctx.fillStyle = '#EFE7DE';
  rr(ctx, 40, H - 150, W - 80, 96, 22);
  ctx.fill();
  ctx.fillStyle = '#2F6B45';
  ctx.beginPath(); ctx.arc(W - 96, H - 102, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#141110';
  ctx.font = `700 38px ${FONT}`;
  ctx.fillText('دخل المطبخ 9:43', W - 132, H - 88);
  return c;
}

/** Dark chip: order on the road + arrival time. */
export function etaChip() {
  const W = 760, H = 230;
  const { c, ctx } = mk(W, H);
  ctx.fillStyle = 'rgba(12,26,22,0.92)';
  rr(ctx, 6, 6, W - 12, H - 12, 46);
  ctx.fill();
  ctx.strokeStyle = C.holo;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillStyle = C.holo;
  ctx.font = `600 38px ${FONT}`;
  ctx.fillText('الأوردر في الطريق', W - 46, 86);
  ctx.fillStyle = '#F5EFE7';
  ctx.font = `700 74px ${FONT}`;
  ctx.fillText('30 دقيقة', W - 46, 172);
  // little scooter glyph on the left
  ctx.strokeStyle = C.holo;
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(104, 150, 30, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(196, 150, 30, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(104, 150); ctx.lineTo(140, 104); ctx.lineTo(196, 104); ctx.lineTo(196, 150);
  ctx.stroke();
  ctx.strokeRect(96, 60, 54, 44);
  return c;
}

/** Map pin badge: icon + label. */
export function pinBadge(kind: 'shop' | 'home', label: string) {
  const W = 460, H = 300;
  const { c, ctx } = mk(W, H);
  const cx = W / 2;
  ctx.fillStyle = 'rgba(12,26,22,0.9)';
  ctx.strokeStyle = C.holo;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, 92, 74, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = C.holo;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  if (kind === 'shop') {
    // fork + knife
    ctx.beginPath(); ctx.moveTo(cx - 26, 56); ctx.lineTo(cx - 26, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 40, 56); ctx.lineTo(cx - 40, 86); ctx.lineTo(cx - 12, 86); ctx.lineTo(cx - 12, 56); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 28, 128); ctx.lineTo(cx + 28, 56); ctx.lineTo(cx + 42, 76); ctx.lineTo(cx + 28, 96); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(cx - 46, 96); ctx.lineTo(cx, 52); ctx.lineTo(cx + 46, 96); ctx.stroke();
    ctx.strokeRect(cx - 34, 96, 68, 40);
  }
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#F5EFE7';
  ctx.font = `700 46px ${FONT}`;
  ctx.fillText(label, cx, 238);
  return c;
}

/** Glowing scooter marker seen from above-ish. */
export function scooterIcon() {
  const W = 320, H = 320;
  const { c, ctx } = mk(W, H);
  ctx.fillStyle = 'rgba(124,245,194,0.18)';
  ctx.beginPath(); ctx.arc(160, 160, 150, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.holo;
  ctx.beginPath(); ctx.arc(160, 160, 92, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#08241B';
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // scooter silhouette
  ctx.beginPath(); ctx.arc(126, 190, 22, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(198, 190, 22, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(126, 190); ctx.lineTo(152, 152); ctx.lineTo(198, 152); ctx.lineTo(198, 190);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(196, 152); ctx.lineTo(210, 118);
  ctx.stroke();
  ctx.strokeRect(112, 112, 46, 40);
  return c;
}

/** A plain takeaway menu card lying on the table (no QR — that belongs to the dine-in film). */
export function menuCard() {
  const W = 900, H = 1300;
  const { c, ctx } = mk(W, H);
  ctx.fillStyle = C.semna;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(20,17,16,0.14)';
  ctx.lineWidth = 6;
  ctx.strokeRect(34, 34, W - 68, H - 68);
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  avatar(ctx, W / 2, 210, 70);
  ctx.fillStyle = C.ink;
  ctx.font = `700 86px ${FONT}`;
  ctx.fillText(RESTAURANT, W / 2, 400);
  ctx.fillStyle = '#8A601E';
  ctx.font = `600 46px ${FONT}`;
  ctx.fillText('دليفري · تيك أواي', W / 2, 474);
  ctx.strokeStyle = 'rgba(20,17,16,0.18)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(150, 534); ctx.lineTo(W - 150, 534); ctx.stroke();
  const items: [string, number][] = [['كلاسيك برجر كومبو', 295], ['دبل تشيز برجر', 340], ['فرايز تشيدر', 75], ['كريسبي تشيكن', 265], ['كركديه ساقع', 45]];
  let y = 620;
  for (const [label, price] of items) {
    ctx.textAlign = 'right';
    ctx.fillStyle = C.ink;
    ctx.font = `500 46px ${FONT}`;
    ctx.fillText(label, W - 110, y);
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.font = `500 44px ${MONO}`;
    ctx.fillText(String(price), 110, y);
    ctx.direction = 'rtl';
    y += 82;
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, H - 96, W, 96);
  ctx.fillStyle = C.semna;
  ctx.font = `600 38px ${FONT}`;
  ctx.fillText(DEMO_LABEL, W / 2, H - 36);
  return c;
}

/* ------------------------------------------------------- real map artwork */

/** Top-down city map, Google-Maps-ish: land, blocks, parks, river, road network, Arabic labels. */
export function cityMap(size = 3072) {
  const { c, ctx } = mk(size, size);
  const R = rng(77);
  const S = size / 2000; // 2000 m across
  ctx.fillStyle = '#EDE6DC';
  ctx.fillRect(0, 0, size, size);
  const m = (x: number) => (x + 1000) * S; // metres (-1000..1000) -> px

  // street grid geometry
  const xs: number[] = [], ys: number[] = [];
  for (let v = -1000; v <= 1000; v += 95 + Math.round(R() * 45)) xs.push(v);
  for (let v = -1000; v <= 1000; v += 95 + Math.round(R() * 45)) ys.push(v);
  // blocks
  ctx.fillStyle = '#F6F2EC';
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < ys.length - 1; j++) {
      ctx.fillRect(m(xs[i]) + 9 * S, m(ys[j]) + 9 * S, (xs[i + 1] - xs[i]) * S - 18 * S, (ys[j + 1] - ys[j]) * S - 18 * S);
    }
  // parks over the blocks
  ctx.fillStyle = '#CADFBC';
  for (const [x, y, w, h] of [[-420, 150, 170, 140], [230, -40, 210, 150], [-120, 380, 260, 120], [330, 300, 150, 180]] as number[][]) {
    rr(ctx, m(x), m(y), w * S, h * S, 14 * S);
    ctx.fill();
  }
  const road = (x1: number, y1: number, x2: number, y2: number, w: number) => {
    ctx.strokeStyle = '#D8D0C6';
    ctx.lineWidth = (w + 5) * S;
    ctx.beginPath(); ctx.moveTo(m(x1), m(y1)); ctx.lineTo(m(x2), m(y2)); ctx.stroke();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = w * S;
    ctx.beginPath(); ctx.moveTo(m(x1), m(y1)); ctx.lineTo(m(x2), m(y2)); ctx.stroke();
  };
  for (const x of xs) road(x, -1020, x, 1020, 13);
  for (const y of ys) road(-1020, y, 1020, y, 13);
  // arterials
  road(-1020, 60, 1020, 60, 26);
  road(40, -1020, 40, 1020, 26);
  ctx.strokeStyle = '#F6C86A';
  ctx.lineWidth = 30 * S;
  ctx.beginPath(); ctx.moveTo(m(-1020), m(430)); ctx.lineTo(m(1020), m(250)); ctx.stroke();
  ctx.strokeStyle = '#E8B84B';
  ctx.lineWidth = 2 * S;
  ctx.beginPath(); ctx.moveTo(m(-1020), m(430)); ctx.lineTo(m(1020), m(250)); ctx.stroke();

  // river cuts across
  for (const [col, w] of [['#A9CBE8', 130], ['#93BCDE', 3]] as [string, number][]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w * S;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(m(-1040), m(-380));
    ctx.bezierCurveTo(m(-300), m(-290), m(200), m(-470), m(1040), m(-330));
    ctx.stroke();
  }
  // bridges where the arterials cross the water
  for (const [x1, y1, x2, y2] of [[-330, -430, -330, -260], [250, -470, 250, -300]] as number[][]) {
    ctx.strokeStyle = '#E4DCD2';
    ctx.lineWidth = 34 * S;
    ctx.beginPath(); ctx.moveTo(m(x1), m(y1)); ctx.lineTo(m(x2), m(y2)); ctx.stroke();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 26 * S;
    ctx.beginPath(); ctx.moveTo(m(x1), m(y1)); ctx.lineTo(m(x2), m(y2)); ctx.stroke();
  }
  // labels
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7A7268';
  const names = ['شارع 9', 'شارع 7', 'شارع 12', 'شارع المعز', 'شارع الجمهورية', 'شارع النيل', 'شارع الجامعة'];
  for (let i = 0; i < 16; i++) {
    const vertical = R() > 0.5;
    const a = vertical ? xs[Math.floor(R() * xs.length)] : ys[Math.floor(R() * ys.length)];
    const b = (R() - 0.5) * 1500;
    ctx.save();
    ctx.translate(vertical ? m(a) : m(b), vertical ? m(b) : m(a));
    if (vertical) ctx.rotate(-Math.PI / 2);
    ctx.font = `600 ${17 * S}px ${FONT}`;
    ctx.fillText(names[i % names.length], 0, -6 * S);
    ctx.restore();
  }
  ctx.fillStyle = '#6E665C';
  ctx.font = `700 ${34 * S}px ${FONT}`;
  ctx.fillText('المعادي', m(-330), m(-200));
  ctx.fillText('الدقي', m(300), m(330));
  ctx.fillStyle = '#5C86A8';
  ctx.font = `600 ${26 * S}px ${FONT}`;
  ctx.save();
  ctx.translate(m(-100), m(-420));
  ctx.rotate(-0.12);
  ctx.fillText('النيل', 0, 0);
  ctx.restore();
  return c;
}

/** Maps-style label card that floats over a pin. */
export function mapLabel(kind: 'shop' | 'home', title: string, sub: string) {
  const W = 760, H = 230;
  const { c, ctx } = mk(W, H);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#FFFFFF';
  rr(ctx, 16, 16, W - 32, H - 32, 34);
  ctx.fill();
  ctx.restore();
  const cx = W - 96;
  ctx.fillStyle = kind === 'shop' ? C.karkadeh : '#1A73E8';
  ctx.beginPath();
  ctx.arc(cx, H / 2, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'shop') {
    ctx.beginPath(); ctx.moveTo(cx - 16, H / 2 - 24); ctx.lineTo(cx - 16, H / 2 + 24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 28, H / 2 - 24); ctx.lineTo(cx - 28, H / 2 - 2); ctx.lineTo(cx - 4, H / 2 - 2); ctx.lineTo(cx - 4, H / 2 - 24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 18, H / 2 + 24); ctx.lineTo(cx + 18, H / 2 - 24); ctx.lineTo(cx + 30, H / 2 - 8); ctx.lineTo(cx + 18, H / 2 + 6); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(cx - 28, H / 2 + 2); ctx.lineTo(cx, H / 2 - 26); ctx.lineTo(cx + 28, H / 2 + 2); ctx.stroke();
    ctx.strokeRect(cx - 20, H / 2 + 2, 40, 26);
  }
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillStyle = C.ink;
  ctx.font = `700 52px ${FONT}`;
  ctx.fillText(title, cx - 74, H / 2 - 4);
  ctx.fillStyle = '#7A7268';
  ctx.font = `500 34px ${FONT}`;
  ctx.fillText(sub, cx - 74, H / 2 + 46);
  return c;
}

/** The rider dot that runs along the route. */
export function riderMarker() {
  const W = 320, H = 320;
  const { c, ctx } = mk(W, H);
  ctx.fillStyle = 'rgba(26,115,232,0.22)';
  ctx.beginPath(); ctx.arc(160, 160, 150, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#1A73E8';
  ctx.beginPath(); ctx.arc(160, 160, 96, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.arc(128, 190, 22, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(198, 190, 22, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(128, 190); ctx.lineTo(154, 152); ctx.lineTo(198, 152); ctx.lineTo(198, 190);
  ctx.stroke();
  ctx.strokeRect(114, 112, 46, 40);
  return c;
}

/** Shop sign board on the restaurant roof. */
export function shopSign() {
  const W = 1000, H = 300;
  const { c, ctx } = mk(W, H);
  ctx.fillStyle = C.ink;
  rr(ctx, 0, 0, W, H, 22);
  ctx.fill();
  ctx.strokeStyle = C.brass;
  ctx.lineWidth = 8;
  rr(ctx, 18, 18, W - 36, H - 36, 14);
  ctx.stroke();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = C.semna;
  ctx.font = `700 96px ${FONT}`;
  ctx.fillText(RESTAURANT, W / 2, 150);
  ctx.fillStyle = C.brassLight;
  ctx.font = `600 46px ${FONT}`;
  ctx.fillText('برجر · دليفري', W / 2, 226);
  return c;
}
