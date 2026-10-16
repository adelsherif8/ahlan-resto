"""Turn recorded live-bot conversations (flows/_reel.mjs JSON) into reel posts in src/lib/posts.ts.

Bot text is copied VERBATIM. Only presentation is derived:
  - a trailing "▸ a  ▸ b" line  -> that message's WhatsApp reply buttons (how WhatsApp shows them)
  - a trailing "📋 ▸ a ▸ b" line -> a list message; its row label is the code's "View options 🍽"
  - "📄 <url>" with media=document -> a PDF document bubble named after the file
  - clock times: the reel's scene time, +1 minute per guest message
Usage: python3 tools/real-chats.py <convos_dir>
"""
import json, re, sys, os

CONVOS = sys.argv[1]
POSTS = os.path.join(os.path.dirname(__file__), '..', 'src', 'lib', 'posts.ts')

REELS = [
    # id, file, start "H:MM" (24h), ui, headline, english, payoff, clock?, extra
    dict(id='R1', file='R1.json', start='23:47', ui='ar', clock=True,
         headline='١١:٤٧ بالليل… حد هيرد؟', english='11:47 p.m. Will anyone answer?',
         payoff='رد على طول.\nوالأوردر اتأكد.'),
    dict(id='R6', file='R6y.json', start='20:14', ui='ar',
         headline='«نفس طلب امبارح»… هيفهم؟', english='"Same as yesterday." Will it get it?',
         payoff='فهم.\nوفاكر طلبك.'),
    dict(id='R7', file='R7.json', start='20:40', ui='ar', revisit=True,
         headline='الزبون ده هيرجع تاني؟', english='Will this customer come back?',
         payoff='رجع — والمطعم فاكر اسمه وطلبه.\nرقمه عندك إنت، مش عند التطبيق.'),
    dict(id='2B', file='2B.json', start='20:14', ui='en',
         headline='كتبها فرانكو… هيفهم؟', english='Typed in Franco. Will it get it?',
         payoff='فهم.\nوردّ بالفرانكو.'),
    dict(id='R4', file='R4y.json', start='21:40', ui='ar',
         headline='٤ حاجات في رسالة واحدة… هيلخبط؟', english='Four things in one message. Will it slip?',
         payoff='ولا غلطة.\nفاتورة واحدة مظبوطة.'),
    dict(id='5A', file='5Aw.json', start='22:05', ui='ar',
         headline='الحساب جه… مين عليه كام؟', english='The bill is here. Who owes what?',
         payoff='كل واحد عرف نصيبه.\nمن غير خناقة.'),
    dict(id='1B', file='1B.json', start='18:21', ui='ar',
         headline='لازم تنزّل تطبيق عشان تطلب؟', english='Do you need an app to order?',
         payoff='لأ.\nواتساب وبس.'),
    dict(id='3A', file='3Ay.json', start='19:02', ui='en',
         headline='سأل على حاجة مش موجودة…', english='He asked for something we don\'t have.',
         payoff='قال الحقيقة.\nوعرض البديل.'),
]

def clock(h, m):
    return f"{(h % 12) or 12}:{m:02d}"

def split_buttons(text):
    lines = text.split('\n')
    last = lines[-1].strip() if lines else ''
    if last.startswith('📋') and '▸' in last:
        return '\n'.join(lines[:-1]).rstrip(), [], 'View options 🍽'
    if last.startswith('▸'):
        btns = [b.strip() for b in last.split('▸') if b.strip()]
        return '\n'.join(lines[:-1]).rstrip(), btns, None
    return text, [], None

def ts_str(s):
    return json.dumps(s, ensure_ascii=False)

def build(cfg):
    log = json.load(open(os.path.join(CONVOS, cfg['file']), encoding='utf-8'))
    if cfg.get('revisit'):
        # first visit: show only its last beat (the confirm + ticket), then a week passes
        first = [e for e in log if e['silent']]
        k = max(i for i, e in enumerate(first) if e['me'])
        shown = [dict(e, _first=True) for e in first[k:]] + [{'day': 'بعد أسبوع'}] + [e for e in log if not e['silent']]
    else:
        shown = [e for e in log if not e.get('silent')]
    h, m = map(int, cfg['start'].split(':'))
    out, first_guest = [], True
    for e in shown:
        if 'day' in e:
            out.append(f"{{ me: false, kind: 'day', label: {ts_str(e['day'])}, time: '' }}")
            h, m = 20, 52  # the return visit, a week later
            first_guest = True
            continue
        if e['me']:
            if not first_guest:
                m += 1
                if m >= 60: h, m = (h + 1) % 24, m - 60
            first_guest = False
            out.append(f"{{ me: true, kind: 'text', text: {ts_str(e['text'])}, time: '{clock(h, m)}' }}")
            continue
        if e.get('media') == 'document':
            lines = e['text'].split('\n')
            name = [l for l in lines if l.startswith('📄')][-1].split('/')[-1].strip()
            cap = '\n'.join(l for l in lines if not l.startswith('📄')).strip()  # WhatsApp shows it under the file
            capx = f", caption: {ts_str(cap)}" if cap else ''
            out.append(f"{{ me: false, kind: 'doc', name: {ts_str(name)}, time: '{clock(h, m)}'{capx} }}")
            continue
        body, btns, lst = split_buttons(e['text'])
        extra = ''
        if btns: extra += f", buttons: {json.dumps(btns, ensure_ascii=False)}"
        if lst: extra += f", list: {ts_str(lst)}"
        out.append(f"{{ me: false, kind: 'text', text: {ts_str(body)}, time: '{clock(h, m)}'{extra} }}")
    sh, sm = map(int, cfg['start'].split(':'))
    head = [f"    id: '{cfg['id']}',", f"    headline: {ts_str(cfg['headline'])},", f"    english: {ts_str(cfg['english'])},",
            f"    payoff: {ts_str(cfg['payoff'])},", "    real: true,", f"    ui: '{cfg['ui']}',"]
    if cfg.get('clock'): head.append(f"    clock: '{clock(sh, sm)}',")
    body = ',\n      '.join(out)
    return f"  // {cfg['id']} · REAL conversation recorded from the live bot ({cfg['file']}) — bot text verbatim\n  '{cfg['id']}': {{\n" + '\n'.join(head) + f"\n    script: [\n      {body},\n    ],\n  }},\n"

REELS = [c for c in REELS if os.path.exists(os.path.join(CONVOS, c['file']))]
src = open(POSTS, encoding='utf-8').read()
ids = [c['id'] for c in REELS]
for rid in ids:  # drop the hand-written versions
    m = re.search(r"\n(  // [^\n]*\n)?  '" + re.escape(rid) + r"': \{\n.*?\n  \},\n", src, re.S)
    if m: src = src[:m.start()] + '\n' + src[m.end():]
anchor = "};\n\nexport const POST_IDS"
assert anchor in src
src = src.replace(anchor, '\n'.join(build(c) for c in REELS) + anchor)
src = re.sub(r'\n{3,}', '\n\n', src)
open(POSTS, 'w', encoding='utf-8').write(src)
print('wrote', ids)
