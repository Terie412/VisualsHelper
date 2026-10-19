# -*- coding: utf-8 -*-
"""计算图版之间的视觉相似度，输出 data/similarity.json。

思路：把每张图缩到 56×56，转到 LAB 空间，做 8×8×8 的颜色直方图，
两两算直方图交集（0~1，1 表示配色分布完全一致）。

跑法：python tools/similarity.py
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLATES = os.path.join(ROOT, "assets", "plates")
OUT = os.path.join(ROOT, "data", "similarity.json")

SIZE = 56
BINS = 8
NB = BINS * BINS * BINS


def hist_of(path):
    im = Image.open(path).convert("LAB").resize((SIZE, SIZE), Image.LANCZOS)
    px = im.load()

    step = 256 // BINS
    hist = [0] * NB

    for y in range(SIZE):
        for x in range(SIZE):
            l, a, b = px[x, y]
            idx = ((l // step) * BINS + (a // step)) * BINS + (b // step)
            if idx >= NB:
                idx = NB - 1
            hist[idx] += 1

    total = float(SIZE * SIZE)
    return [v / total for v in hist]


def intersect(h1, h2):
    s = 0.0
    for i in range(NB):
        s += h1[i] if h1[i] < h2[i] else h2[i]
    return s


def main():
    files = sorted(f for f in os.listdir(PLATES) if f.lower().endswith(".jpg"))
    if not files:
        print("没有找到图版")
        return 1

    hists = []
    for f in files:
        hists.append(hist_of(os.path.join(PLATES, f)))
    print("图版数 %d，直方图维度 %d" % (len(files), NB))

    n = len(hists)
    matrix = [[0.0] * n for _ in range(n)]

    for i in range(n):
        matrix[i][i] = 1.0
        for j in range(i + 1, n):
            s = round(intersect(hists[i], hists[j]), 3)
            matrix[i][j] = s
            matrix[j][i] = s

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fp:
        json.dump({
            "version": 1,
            "metric": "lab-hist-8",
            "size": SIZE,
            "count": n,
            "matrix": matrix
        }, fp, ensure_ascii=False)

    print("写入", OUT)

    # 抽样检查：每张图最像的 3 张
    for i in [0, 13, 21, 35]:
        order = sorted(range(n), key=lambda j: -matrix[i][j] if j != i else 9)
        top = [(files[j], matrix[i][j]) for j in order[:3] if j != i]
        print("  %s -> %s" % (files[i], ", ".join("%s %.3f" % t for t in top)))

    return 0


if __name__ == "__main__":
    sys.exit(main())
