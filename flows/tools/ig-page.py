#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rebuild munadim-post-schedule.html from flows/tools/ig-schedule.json.
Keeps the page's head (styles, header, hero) and tail (Reel playbook, Story prompts,
Reel bench, Still in the drawer, footer, script) from the current file and regenerates
only the day cards between them. Run:  python3 flows/tools/ig-page.py  — writes branding/schedule-page/munadim-post-schedule.html, then publish it to artifact RM8tXkC45FxkzvhL8AnsTW."""
import json, datetime as dt, html, io, re, os, sys
HERE=os.path.dirname(os.path.abspath(__file__))
PAGE=os.path.join(HERE,"../../branding/schedule-page/munadim-post-schedule.html")
SCHED=os.path.join(HERE,"ig-schedule.json")
cur=open(PAGE,encoding="utf-8").read(); d=json.load(open(SCHED,encoding="utf-8"))
hi=cur.index('\n  <!-- ===================== WEEK 1'); ti=cur.index('  <section class="promptsec" id="playbook">')
head,tail=cur[:hi],cur[ti:]
CHAT={"munadim-R1.mp4","munadim-2B.mp4","munadim-R6.mp4","munadim-R7.mp4","munadim-R4.mp4","munadim-1B.mp4","munadim-5A.mp4"}
HOOK={"munadim-film.mp4":"الطابور طويل… وإنت مش فيه","munadim-film-short.mp4":"الطابور طويل… وإنت مش فيه","munadim-R3.mp4":"التطبيقات مش شركاءك","munadim-R3C.mp4":"التطبيقات مش شركاءك","munadim-R2.mp4":"600 أوردر في الشهر… التطبيق بياخد كام؟","munadim-R2C.mp4":"600 أوردر في الشهر… التطبيق بياخد كام؟","munadim-2B.mp4":"كتبها فرانكو… هيفهم؟","munadim-R1.mp4":"١١:٤٧ بالليل… حد هيرد؟","munadim-R6.mp4":"«نفس طلب امبارح»… هيفهم؟","munadim-R7.mp4":"الزبون ده هيرجع تاني؟","munadim-R4.mp4":"٤ حاجات في رسالة واحدة… هيلخبط؟","munadim-1B.mp4":"لازم تنزّل تطبيق عشان تطلب؟","munadim-5A.mp4":"الحساب جه… مين عليه كام؟"}
THUMB={f"munadim-{k}.mp4":f"reels/{k}.jpg" for k in ["R1","2B","R6","R7","R4","1B","5A","R3","R2"]}
MEAS={"munadim-film.mp4":"117 reach · 7.7 s hold · 906 s total","munadim-R3.mp4":"102 reach · 2.3 s hold","munadim-2B.mp4":"43 reach · 4.8 s hold","munadim-R1.mp4":"6 reach on repeat (55 first time)"}
WD=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]; PILL={"Poll":"st-poll","Quiz":"st-quiz","This / That":"st-this","Slider":"st-slider"}
slots={s["date"]:s for s in d["slots"]}; stories={s["date"]:s for s in d["stories"]}
D=lambda s: dt.date.fromisoformat(s)
first=min(D(k) for k in slots); last=max(max(D(k) for k in slots),max(D(k) for k in stories))
TODAY=dt.date(2026,10,24)
o=io.StringIO(); cid=100; wk=0; day=first; i=0
while day<=last:
    if i%7==0: wk+=1; o.write(f'\n  <!-- ===================== WEEK {wk} ===================== -->\n  <div class="wkhead"><span>Week {wk}</span><em>{day:%-d %b} – {day+dt.timedelta(days=6):%-d %b}</em></div>\n')
    ds=day.isoformat(); s=slots.get(ds); st=stories.get(ds); past=day<TODAY
    o.write(f'\n  <section class="day{"" if s else " empty"}">\n    <div class="dhead"><span class="n">{day:%-d %B}</span><h2>{WD[day.weekday()]}</h2>'
            + (f'<span class="wd">{"posted" if past else s["type"]} · 9:30 PM</span>' if s else '<span class="wd">no feed post — waiting for new footage</span>') + '</div>\n')
    if s:
        cid+=1; k=s["asset"]; isreel=s["type"]=="reel"; cold=k.endswith("C.mp4")
        if isreel and k in THUMB: shot=f'<span class="fmt reel">Reel</span><img src="{THUMB[k]}" alt=""><span class="fstamp">first frame</span>'
        elif isreel: shot=f'<span class="fmt reel">Reel</span><div class="reelbox"><span class="rec ready">{"cold open" if cold else "Automated"}</span>{k}<div class="playmark">▶ in the preview</div></div>'
        else: shot=f'<span class="fmt car">Carousel</span><img src="car/{k[-1]}.jpg" alt=""><span class="fstamp">cover</span>'
        meta=(f'igvideos/{k}' if isreel else f'branding/ig-ready/{k}/')+(' · <b>real chat</b>' if k in CHAT else '')+(' · <b>live-footage cold open</b>' if cold else '')+(f' · <b>{MEAS[k]}</b>' if k in MEAS and "repost" in s.get("note","") else '')
        o.write(f'    <div class="slot">\n      <div class="shot">{shot}</div>\n      <div class="body">\n        <span class="time"><span class="dot"></span>9:30 PM</span>\n'
                f'        <div class="hookl ar">{html.escape(HOOK.get(k,""))}</div>\n'
                f'        <div class="cap"><div class="ar" id="c{cid}">{html.escape(s["caption"]).replace(chr(10),"<br>")}</div></div>\n'
                f'        <div class="tags">{html.escape(s["tags"])} <span class="note">→ {"caption (posted before 24 Oct)" if past else "first comment"}</span></div>\n'
                f'        <div class="row2"><button class="copy" data-c="c{cid}">Copy caption</button><span class="note">{html.escape(s.get("note",""))}</span></div>\n'
                f'        <div class="row2"><span class="fmeta mono">{meta}</span></div>\n      </div>\n    </div>\n')
    if st:
        n=st["asset"][6:8]; pill=PILL[st["sticker"]]
        o.write('      <div class="stories">\n        <div class="sh">Stories · by hand · 9:45 PM</div>\n'
                f'        <div class="story"><span class="st {pill}">{html.escape(st["sticker"])}</span><div class="sb"><div class="ar">{html.escape(st["question"])} · '+" / ".join(f"<b>{html.escape(x)}</b>" for x in st["options"])+f'</div><div class="vis"><b>Visual:</b> story-{n}.mp4 · sticker on the dashed brass box, y≈1290–1480</div></div></div>\n'
                '        <div class="story"><span class="st st-reshare">Reshare</span><div class="sb"><div class="ar">'+("شارك ريل النهارده على الستوري" if s else "شارك بوست مثبّت على الستوري (الفيلم أو كاروسيل A)")+'</div></div></div>\n'
                '        <div class="story"><span class="st st-box">Ask box</span><div class="sb"><div class="ar">صندوق أسئلة — «اسألنا»</div><div class="en">Reply to every answer by DM.</div></div></div>\n      </div>\n')
    o.write('  </section>\n'); day+=dt.timedelta(days=1); i+=1
out=head+o.getvalue()+"\n"+tail
open(PAGE,"w",encoding="utf-8").write(out)
bad=[t for t in ("div","section","span","button") if len(re.findall(rf"<{t}[\s>]",out))!=len(re.findall(rf"</{t}>",out))]
print("balanced" if not bad else f"UNBALANCED: {bad}", "·", out.count('<section class="day'), "nights ·", out.count('class="slot"'), "posts")
sys.exit(1 if bad else 0)
