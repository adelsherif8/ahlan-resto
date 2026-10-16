"""Contact sheet of a video: python3 sheet.py in.mp4 out.jpg f1 f2 ... (frame numbers at 30fps)"""
import sys, cv2, numpy as np
src, dst, frames = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3:]]
cap = cv2.VideoCapture(src)
tiles = []
for fr in frames:
    cap.set(cv2.CAP_PROP_POS_FRAMES, fr)
    ok, im = cap.read()
    if not ok: continue
    im = cv2.resize(im, (360, 640))
    cv2.putText(im, str(fr), (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
    tiles.append(im)
cols = 5
while len(tiles) % cols: tiles.append(np.zeros_like(tiles[0]))
rows = [np.hstack(tiles[i:i + cols]) for i in range(0, len(tiles), cols)]
cv2.imwrite(dst, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])
print(dst, len(frames))
