# Placeholder plates for the Loop compositions, so they render before the AI plates exist.
# A warm near-black night, a ramp curve matching lib/loop.ts PATH, a sign panel box, a few
# "cars" as warm red/amber light pairs. Replace with bg-video.jpg / bg-still.jpg from the
# image model (branding/LOOP-PROMPTS.md); keep these as the geometry reference.
import math, os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "loop")
os.makedirs(OUT, exist_ok=True)
INK = (20, 17, 16); BRASS = (185, 132, 50); KARK = (140, 29, 47); AMBER = (255, 170, 60); RED = (220, 50, 40)

def bez(p, t):
    segs = (len(p) - 1) // 3; u = min(max(t, 0), 0.9999) * segs; i = int(u); s = u - i
    p0, c1, c2, p1 = p[i*3], p[i*3+1], p[i*3+2], p[i*3+3]; k = 1 - s
    return (k**3*p0[0] + 3*k*k*s*c1[0] + 3*k*s*s*c2[0] + s**3*p1[0], k**3*p0[1] + 3*k*k*s*c1[1] + 3*k*s*s*c2[1] + s**3*p1[1])

def plate(w, h, path, sign, queue_offset=60, name="bg-video.jpg"):
    im = Image.new("RGB", (w, h), INK); d = ImageDraw.Draw(im)
    # haze
    for y in range(h):
        v = int(14 + 22 * math.sin(y / h * math.pi)); d.line([(0, y), (w, y)], fill=(v + 6, v + 3, v))
    # ramp: a wide concrete band along the path, queue lane to the right of the climb lane
    pts = [bez(path, t / 200) for t in range(201)]
    for i in range(1, len(pts)):
        d.line([pts[i-1], pts[i]], fill=(58, 54, 52), width=250)
    for i in range(1, len(pts)):  # brass edge of the empty lane
        d.line([pts[i-1], pts[i]], fill=BRASS, width=4)
    # cars: pairs of lights on the queue lane (offset from the path to the right)
    for t in [x / 100 for x in range(8, 96, 8)]:
        x, y = bez(path, t); d.ellipse([x + queue_offset - 30, y - 10, x + queue_offset - 10, y + 10], fill=RED)
        d.ellipse([x + queue_offset + 10, y - 10, x + queue_offset + 30, y + 10], fill=RED)
        d.ellipse([x + queue_offset - 32, y - 26, x + queue_offset - 16, y - 12], fill=AMBER)
    # restaurant block at the top and the empty sign panel
    rx, ry = pts[-1]; d.rectangle([rx - 220, ry - 140, rx + 260, ry + 60], fill=(70, 62, 56), outline=KARK, width=6)
    d.rectangle([rx - 200, ry - 120, rx + 240, ry - 60], fill=(255, 196, 120))
    d.rectangle([sign["x"], sign["y"], sign["x"] + sign["w"], sign["y"] + sign["h"]], fill=(16, 14, 13))
    # ground spotlights
    for sx in range(80, w, 240):
        for k in range(0, 900, 4):
            a = max(0, 90 - k // 10); d.line([(sx, h - 60 - k), (sx + k // 6, h - 60 - k)], fill=(a // 2 + 20, a // 2 + 18, a // 2 + 24))
    im = im.filter(ImageFilter.GaussianBlur(1.2)); im.save(os.path.join(OUT, name), quality=90)
    print("wrote", name)

VIDEO_PATH = [(120, 1660), (420, 1640), (760, 1560), (900, 1340), (1000, 1180), (1010, 980), (980, 760), (960, 700), (900, 600), (740, 585)]
plate(1080, 1920, VIDEO_PATH, {"x": 560, "y": 470, "w": 200, "h": 200})
STILL_PATH = [(100, 1180), (420, 1170), (820, 1080), (930, 880), (1010, 760), (1000, 640), (900, 520), (820, 430), (700, 380), (560, 360)]
plate(1080, 1350, STILL_PATH, {"x": 850, "y": 600, "w": 180, "h": 180}, name="bg-still.jpg")
