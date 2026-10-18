"""从手机截图里裁出图版：按白色间隙切行，去掉左下角的彩色标签。"""
import os
import glob
from PIL import Image

SRC_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(SRC_DIR), "assets", "plates")

X0, X1 = 30, 610          # 图版横向范围
TAG_H = 42                # 底部标签高度，直接切掉
MIN_ROW, MAX_ROW = 350, 470


def detect_rows(im):
    w, h = im.size
    k = 4
    sm = im.resize((w // k, h // k))
    W, H = sm.size
    px = sm.load()
    x0, x1 = X0 // k, X1 // k

    def is_white(p):
        return min(p) > 243

    prof = [sum(1 for x in range(x0, x1) if is_white(px[x, y])) for y in range(H)]
    thr = (x1 - x0) * 0.93

    gaps = []
    start = None
    for y in range(H):
        on = prof[y] > thr
        if on and start is None:
            start = y
        elif not on and start is not None:
            if (y - start) * k >= 8:
                gaps.append((start * k, y * k))
            start = None
    if start is not None:
        gaps.append((start * k, H * k))

    rows = []
    for i in range(len(gaps) - 1):
        y0 = gaps[i][1]
        y1 = gaps[i + 1][0]
        if MIN_ROW <= y1 - y0 <= MAX_ROW:
            rows.append((y0, y1))
    return rows


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    files = sorted(glob.glob(os.path.join(SRC_DIR, "*.jpg")))
    files = [f for f in files if not os.path.basename(f).startswith("_")]

    idx = 0
    report = []
    for f in files:
        im = Image.open(f).convert("RGB")
        rows = detect_rows(im)
        for (y0, y1) in rows:
            idx += 1
            crop = im.crop((X0, y0 + 2, X1, y1 - TAG_H))
            name = "%03d.jpg" % idx
            crop.save(os.path.join(OUT_DIR, name), "JPEG", quality=92, optimize=True)
            report.append((name, os.path.basename(f), y0, y1, crop.size))

    for r in report:
        print(r[0], "from", r[1][-12:], "y", r[2], r[3], "size", r[4])
    print("total", idx)


if __name__ == "__main__":
    main()
