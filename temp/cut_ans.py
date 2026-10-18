"""裁出每行右侧的答案/图形提示区，用于核对答案。"""
import os
import glob
from PIL import Image
from cut import detect_rows

SRC_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SRC_DIR, "_ans")
os.makedirs(OUT, exist_ok=True)

files = sorted(glob.glob(os.path.join(SRC_DIR, "*.jpg")))
files = [f for f in files if not os.path.basename(f).startswith("_")]

idx = 0
for f in files:
    im = Image.open(f).convert("RGB")
    for (y0, y1) in detect_rows(im):
        idx += 1
        im.crop((620, y0 + 2, 1180, y1 - 42)).save(
            os.path.join(OUT, "%03d.jpg" % idx), "JPEG", quality=90
        )

print("done", idx)
