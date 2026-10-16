/**
 * The storyline films — each one a short, not a chat recording.
 *
 * A story is a list of beats. The Scene component walks them in order and gives
 * each one its own frames, so a film can hold a title card, a notification, the
 * conversation as a card inside the room, a statement, the food, and the mark —
 * or skip any of them. The 3 a.m. film has no food beat, because nobody is eating
 * at 3 a.m.; that is the point of it.
 *
 * Same rule as everywhere else: every price, every line of bot copy and every
 * claim is the live Munadim menu or the product's real wording. Nothing invented,
 * and no number we cannot stand behind.
 */

export type Line = {
  me: boolean;
  text?: string;
  bill?: [string, string][];
  total?: [string, string];
};

export type Beat =
  /** An Arabic card over the room. */
  | { kind: 'title'; frames: number; line: string; sub?: string }
  /** One Android heads-up notification sliding in. */
  | { kind: 'notif'; frames: number; text: string; time: string }
  /** Several arriving at once — the rush, seen from the outside. */
  | { kind: 'burst'; frames: number; items: [string, string][] }
  /** The conversation, as a card in the room. */
  | { kind: 'chat'; frames: number; lines: Line[] }
  /** A statement, optionally over an order code. */
  | { kind: 'stat'; frames: number; code?: string; line: string; sub?: string }
  /** The food, on the brand's own paper. */
  | { kind: 'food'; frames: number; photo: string; line: string; sub?: string }
  /** The mark. */
  | { kind: 'end'; frames: number; line: string };

export interface Story {
  id: string;
  /** What the film is, for the file name and for us. */
  name: string;
  beats: Beat[];
}

export const STORIES: Record<string, Story> = {
  // ── the one that started it: a full delivery order on a Tuesday night ────────
  night: {
    id: 'night',
    name: 'A night at Munadim',
    beats: [
      { kind: 'title', frames: 110, line: 'الساعة ٩:٤٠', sub: 'A Tuesday night in New Cairo.' },
      { kind: 'notif', frames: 130, text: 'مساء الخير، لسه فاتحين؟', time: '21:40' },
      {
        kind: 'chat', frames: 420,
        lines: [
          { me: true, text: 'مساء الخير، لسه فاتحين؟' },
          { me: false, text: 'مساء النور 🙏 فاتحين لحد ٢ بالليل — تحب تطلب إيه؟' },
          { me: true, text: 'اتنين كلاسيك برجر كومبو، وبطاطس لودد' },
          { me: false, text: 'تمام ✅ المشروب مع الكومبو؟' },
          { me: true, text: 'كركديه' },
          { me: true, text: 'دليفري ماكسيم' },
          {
            me: false,
            bill: [['2× مُنادم كلاسيك برجر (كومبو · كركديه)', '530'], ['1× مُنادم لودد فرايز', '105'], ['التوصيل (~1.4 كم)', '50']],
            total: ['الإجمالي المطلوب', '685'],
          },
          { me: true, text: 'كاش — أكد' },
        ],
      },
      { kind: 'stat', frames: 110, code: 'O-4TBC', line: 'راح للمطبخ على طول', sub: 'Straight to the kitchen. No one re-typed it.' },
      { kind: 'food', frames: 120, photo: 'munadim-classic-burger.jpg', line: '٣٥ دقيقة، وعلى الباب', sub: '35 minutes, door to door.' },
      { kind: 'end', frames: 90, line: 'مطعمك بيرد على واتساب، لوحده' },
    ],
  },

  // ── 3 a.m.: nobody is awake, and it still tells the truth ───────────────────
  threeam: {
    id: 'threeam',
    name: '3 a.m.',
    beats: [
      { kind: 'title', frames: 120, line: 'الساعة ٣:١٢ الفجر', sub: 'The kitchen is dark. The phone is not.' },
      { kind: 'notif', frames: 120, text: 'لسه فاتحين؟ عايز كلاسيك برجر', time: '03:12' },
      {
        kind: 'chat', frames: 330,
        lines: [
          { me: true, text: 'لسه فاتحين؟ عايز كلاسيك برجر' },
          { me: false, text: 'إحنا فاتحين لحد ٢ بالليل 🙏 — بس سجّلت طلبك لأول ما نفتح ١٠ الصبح، أأكد؟' },
          { me: true, text: 'أيوه أكد' },
          { me: false, text: 'اتسجل ✅ هنبعتلك ١٠ الصبح أول ما نفتح.' },
        ],
      },
      { kind: 'stat', frames: 120, line: 'ما حدش بيستنى للصبح عشان يترد عليه', sub: 'Nobody waits until morning for an answer.' },
      { kind: 'end', frames: 95, line: 'بيرد الساعة ٣ الفجر' },
    ],
  },

  // ── the rush, seen from the outside: everyone answered at once ──────────────
  rush: {
    id: 'rush',
    name: 'At the rush',
    beats: [
      { kind: 'title', frames: 110, line: 'الساعة ٨:٤٠ … والمطبخ مولّع', sub: 'The hour when the phone stops being answered.' },
      {
        kind: 'burst', frames: 190,
        items: [
          ['عايز اتنين ناشفيل ساندوتش', '20:41'],
          ['المنيو لو سمحت', '20:41'],
          ['الأوردر وصل فين؟', '20:42'],
          ['دليفري الرحاب؟', '20:42'],
        ],
      },
      {
        kind: 'chat', frames: 300,
        lines: [
          { me: true, text: 'عايز اتنين ناشفيل ساندوتش' },
          { me: false, text: 'تمام — المستوى: ميلد · ميديم · حار 🔥' },
          { me: true, text: 'حار' },
          {
            me: false,
            bill: [['2× مُنادم ناشفيل تشيكن · حار 🔥', '420']],
            total: ['الإجمالي', '420'],
          },
        ],
      },
      { kind: 'stat', frames: 120, line: 'وقت الزحمة، محدش بيستنى', sub: 'At the rush, nobody waits.' },
      { kind: 'food', frames: 120, photo: 'munadim-nashville-chicken.jpg', line: 'كل واحد اترد عليه في نفس اللحظة', sub: 'Every one of them answered at once.' },
      { kind: 'end', frames: 90, line: 'مطعمك بيرد على واتساب، لوحده' },
    ],
  },

  // ── end of the night, four friends, one bill ────────────────────────────────
  split: {
    id: 'split',
    name: 'The split',
    beats: [
      { kind: 'title', frames: 110, line: 'آخر الليلة، الحساب', sub: 'The part of dinner nobody enjoys.' },
      { kind: 'notif', frames: 120, text: 'قسّم الحساب لو سمحت', time: '22:58' },
      {
        kind: 'chat', frames: 380,
        lines: [
          { me: true, text: 'قسّم الحساب — عمر الناشفيل والكركديه، أحمد التندرز والبطاطس، والكلاسيك على اتنين' },
          {
            me: false,
            bill: [['عمر', '255'], ['أحمد', '195'], ['كريم', '195'], ['سارة', '195']],
            total: ['إجمالي الفاتورة', '840'],
          },
          { me: true, text: 'تمام، كده مظبوط' },
        ],
      },
      { kind: 'stat', frames: 120, line: 'كل واحد يعرف عليه كام', sub: 'Everyone knows their share. No paper, no arguing.' },
      { kind: 'food', frames: 110, photo: 'munadim-loaded-fries.jpg', line: 'والباقي على الترابيزة', sub: 'The rest stays on the table.' },
      { kind: 'end', frames: 90, line: 'مطعمك بيرد على واتساب، لوحده' },
    ],
  },
};

export const STORY_IDS = Object.keys(STORIES);
/** Total length of a film, in frames. */
export const storyLength = (s: Story) => s.beats.reduce((n, b) => n + b.frames, 0);
/** Where each beat starts. */
export const beatStarts = (s: Story) => {
  const out: number[] = [];
  let f = 0;
  for (const b of s.beats) { out.push(f); f += b.frames; }
  return out;
};
