#!/usr/bin/env python3
"""アプリアイコン一式を生成する（冬の雪山を背景にしたデザイン）。

    python3 scripts/generate-app-icon.py

必要: Python 3 + numpy + Pillow  (pip install numpy pillow)
プロジェクト直下で実行すること。

## なぜスクリプトなのか

背景を季節ごとに差し替えられるようにするため。配色や山の形はすべて定数なので、
このファイルを編集して流し直せば別デザインのアイコン一式が揃う。

## 盾とGBモノグラムについて

字形と配色は `assets/icon-emblem-src.png` から抽出して使う。**自前で描き起こさない。**
手持ちのフォントに元デザインと同じ字形が無く、描き直すとブランドの見た目が変わるため。
このソース画像は「ティール背景＋白い盾＋GB」の旧アイコンで、盾の輪郭・字形・配色の
基準として置いてある。**出力先の `assets/icon-only.png` を抽出元にしてはいけない**
（自分の出力を読み直すことになり、流すたびに絵柄が劣化する）。

## 出力

    assets/icon-only.png          iOS/レガシーAndroid のアイコン
    gymboard-app-icon-1024.PNG    同じものをルートにも（ドリフト防止・memoの通り）
    assets/icon-foreground.png    Androidアダプティブの前景（透過・0.80縮小）
    assets/icon-background.png    Androidアダプティブの背景（フルブリード）
    assets/splash.png             スプラッシュ（ライト）
    assets/splash-dark.png        スプラッシュ（ダーク）
    public/icon-192.png           PWA
    public/icon-512.png           PWA / Play Console 掲載用
    public/apple-touch-icon.png   iOS Safari
    public/favicon.png            favicon
    public/favicon.ico            favicon

反映には別途ネイティブビルドが必要（詳細は mem/features/app-icon-splash-assets.md）。
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = "assets/icon-emblem-src.png"     # 盾とGBの抽出元（出力先を指定しないこと）
BASE = 1024
S = 3                                   # スーパーサンプリング倍率
N = BASE * S
CX = 511.5                              # 盾の中心x（抽出元から実測した値）

YY, XX = np.mgrid[0:N, 0:N].astype(np.float32)
rng = np.random.default_rng(20260727)   # 固定シード（流し直しても同じ絵になる）


# --- 汎用ヘルパ -----------------------------------------------------------
def blur_mask(m, r):
    im = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8), "L")
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r * S)), np.float32) / 255.0


def shift(m, dx, dy):
    out = np.zeros_like(m)
    x0, x1 = max(0, dx), min(N, N + dx)
    y0, y1 = max(0, dy), min(N, N + dy)
    if x0 < x1 and y0 < y1:
        out[y0:y1, x0:x1] = m[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
    return out


def over(dst, rgb, a):
    aa = a[:, :, None]
    dst *= (1 - aa)
    dst += rgb * aa
    return dst


def solid(c):
    return np.zeros((N, N, 3), np.float32) + np.array(c, np.float32)


def radial(cx, cy, r, inner=1.0, outer=0.0):
    d = np.sqrt((XX / N - cx) ** 2 + (YY / N - cy) ** 2) / r
    return np.clip(inner + (outer - inner) * np.clip(d, 0, 1), 0, 1)


def vgrad(stops):
    ys = np.linspace(0, 1, N)
    out = np.empty((N, N, 3), np.float32)
    for i in range(3):
        out[:, :, i] = np.interp(ys, [p for p, _ in stops],
                                 [c[i] for _, c in stops])[:, None]
    return out


def ridge_line(peaks, rough, seed):
    """peaks=[(x1024, y1024), ...] を折れ線で結び、列ごとの稜線の高さ配列(長さN)を返す"""
    xs = np.array([p[0] for p in peaks], np.float32) * S
    ys = np.array([p[1] for p in peaks], np.float32) * S
    ry = np.interp(np.arange(N), xs, ys).astype(np.float32)
    g = np.random.default_rng(seed)
    for wave, amp in ((60, 1.0), (22, 0.5), (8, 0.25)):     # 複数スケールの凹凸
        n = g.normal(0, 1, N // wave + 2)
        ry += np.interp(np.linspace(0, len(n) - 1, N),
                        np.arange(len(n)), n) * rough * amp * S
    return ry


def draw_range(canvas, ry, rock, snow_line, fade, thick, shadow, haze, seed):
    """山脈を1つ描く。

    snow_line: これより高い（=yが小さい）列に雪が乗る（1024空間のy）
    fade:      雪が乗り始めてから最大量になるまでの標高差（1024空間）
    thick:     最大の積雪の厚み（稜線からの距離・1024空間）

    雪の量は「稜線から一定幅」ではなく「その列の標高」で決めている。
    一定幅にすると雪が輪郭に沿った帯に見えて山にならない。
    """
    body = (YY >= ry[None, :]).astype(np.float32)
    over(canvas, solid(rock), body)

    # ry は N 空間なので、1024 空間で与えた値は S 倍して比べる。
    alt = np.clip((snow_line * S - ry) / (fade * S), 0, 1) ** 1.3
    # 雪の下端は列ごとに揺らす。面全体に2次元ノイズを掛ける方法も試したが、
    # 深さの切り口が鋭いため氷柱のような細かい垂れになってしまった。
    # wave は制御点1つあたりのピクセル数で、小さいほど細かく垂れる。
    g = np.random.default_rng(seed)
    wobble = np.ones(N, np.float32)
    for wave, amp in ((300, 0.22), (110, 0.10)):
        n = g.normal(0, 1, N // wave + 2)
        wobble += np.interp(np.linspace(0, len(n) - 1, N),
                            np.arange(len(n)), n).astype(np.float32) * amp
    depth = (alt * thick * S * np.clip(wobble, 0.35, 1.8))[None, :]
    snow = np.clip((depth - (YY - ry[None, :])) / (22 * S), 0, 1) * body
    over(canvas, solid((0xFC, 0xFE, 0xFF)), blur_mask(snow, 1.0))

    # 影は寒色に転ぶよう、赤を強めに落とす（光源は右上）
    sh = (np.clip(1.0 - XX / N * 1.4, 0, 1) ** 1.3 * body * shadow)[:, :, None]
    canvas *= (1 - sh * np.array([1.25, 1.05, 0.72], np.float32))

    # 裾の冷たい霞（空気遠近）
    over(canvas, solid((0xDD, 0xEA, 0xF4)),
         blur_mask(np.clip(shift(body, 0, int(150 * S)), 0, 1), 45) * haze)
    return canvas


# =========================================================================
# 背景（冬の雪山）
# =========================================================================
canvas = vgrad([
    (0.00, (0x2A, 0x59, 0x8E)),      # 高いところの濃い冬空
    (0.22, (0x4C, 0x80, 0xB2)),
    (0.42, (0x92, 0xB7, 0xD4)),
    (0.58, (0xC6, 0xDB, 0xE9)),
    (0.70, (0xE9, 0xF1, 0xF6)),      # 地平近くは白く霞む
    (1.00, (0xF5, 0xF9, 0xFB)),
])
# 冬の陽は淡く拡散する（金色にしない）
canvas += (radial(0.74, 0.12, 0.70) ** 2.0)[:, :, None] * np.array([52, 56, 60], np.float32)
canvas = np.clip(canvas, 0, 255)

# 遠景 → 近景（遠いほど淡く、コントラストが低い）
canvas = draw_range(canvas, ridge_line(
    [(-30, 648), (110, 548), (250, 620), (400, 534), (560, 606),
     (720, 540), (880, 614), (1054, 558)], 3.0, 21),
    rock=(0xB4, 0xC8, 0xDA), snow_line=650, fade=60, thick=58,
    shadow=0.06, haze=0.42, seed=101)

canvas = draw_range(canvas, ridge_line(
    [(-30, 712), (95, 574), (230, 676), (360, 544), (500, 654),
     (650, 562), (810, 672), (935, 584), (1054, 676)], 4.5, 5),
    rock=(0x86, 0xA4, 0xC0), snow_line=710, fade=70, thick=86,
    shadow=0.12, haze=0.32, seed=202)

canvas = draw_range(canvas, ridge_line(
    [(-30, 880), (75, 540), (200, 760), (330, 652), (470, 808),
     (620, 720), (760, 656), (905, 514), (1054, 788)], 6.5, 31),
    rock=(0x56, 0x74, 0x94), snow_line=820, fade=95, thick=140,
    shadow=0.18, haze=0.16, seed=303)

canvas = np.clip(canvas, 0, 255)

# 粉雪。盾より奥に描くのでロゴには掛からない。
flakes = Image.new("L", (N, N), 0)
fd = ImageDraw.Draw(flakes)
for _ in range(210):
    fx = rng.uniform(0, BASE)
    fy = rng.uniform(0, BASE) ** 0.85 / BASE ** 0.85 * BASE   # 上のほうに多く
    r = rng.uniform(1.2, 5.2) ** 1.15
    fd.ellipse([(fx - r) * S, (fy - r) * S, (fx + r) * S, (fy + r) * S],
               fill=int(rng.uniform(45, 210)))
over(canvas, solid((255, 255, 255)),
     blur_mask(np.asarray(flakes, np.float32) / 255.0, 0.7) * 0.9)

# 粒状感（のっぺりしないように）
canvas = np.clip(canvas + rng.normal(0, 1.8, (N, N, 1)).astype(np.float32), 0, 255)
# 周辺減光（盾に視線を集める）。寒色を残すため青は落としすぎない。
vig = (radial(0.5, 0.44, 1.12, 0.0, 1.0) ** 1.8)[:, :, None]
canvas *= (1 - vig * np.array([0.26, 0.22, 0.15], np.float32))
canvas = np.clip(canvas, 0, 255)

BACKGROUND = canvas.copy()

# =========================================================================
# 盾＋GB（抽出元からそのまま載せる）
# =========================================================================
src = np.array(Image.open(SRC).convert("RGB")).astype(int)
white = (src[:, :, 0] > 230) & (src[:, :, 1] > 230) & (src[:, :, 2] > 230)

# 盾のシルエット: 各行の白の左右端を結ぶ。
# 文字は白い面の内側にしか無いので、行ごとの端は必ず盾の輪郭になる。
half = np.zeros(BASE)
for y in range(BASE):
    xs = np.where(white[y])[0]
    if len(xs) > 2:
        half[y] = (xs.max() - xs.min()) / 2.0
rows = np.where(half > 0)[0]
TOP_Y, TIP_Y = int(rows.min()), int(rows.max())
half = np.convolve(half, np.ones(5) / 5, mode="same")     # 軽く均してギザつきを取る
half[:TOP_Y] = 0
half[TIP_Y + 1:] = 0

img = Image.new("L", (N, N), 0)
left, right = [], []
for y in range(TOP_Y, TIP_Y + 1):
    if half[y] <= 0:
        continue
    left.append(((CX - half[y]) * S, y * S))
    right.append(((CX + half[y]) * S, y * S))
ImageDraw.Draw(img).polygon(left + right[::-1], fill=255)
SHIELD = np.asarray(img, np.float32) / 255.0

emblem = np.asarray(Image.open(SRC).convert("RGB").resize((N, N), Image.LANCZOS),
                    np.float32)

# 雪山は白いので、盾が埋もれないよう影で浮かせる（影も寒色）
over(canvas, solid((0x0E, 0x2A, 0x48)), blur_mask(shift(SHIELD, 2 * S, 13 * S), 17) * 0.46)
over(canvas, solid((0x0E, 0x2A, 0x48)), blur_mask(shift(SHIELD, 0, 4 * S), 5) * 0.26)
over(canvas, emblem, SHIELD)


# =========================================================================
# 書き出し
# =========================================================================
def to1024(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).resize(
        (BASE, BASE), Image.LANCZOS)


icon = to1024(canvas)
icon.save("assets/icon-only.png")
icon.save("gymboard-app-icon-1024.PNG")      # ルートのマスターも同時に更新（ドリフト防止）
to1024(BACKGROUND).save("assets/icon-background.png")

# Androidアダプティブの前景: 透過・盾のみ・安全ゾーン内に 0.80 で縮小
fg = Image.fromarray(
    np.clip(np.dstack([emblem, SHIELD * 255.0]), 0, 255).astype(np.uint8), "RGBA"
).resize((BASE, BASE), Image.LANCZOS)
scaled = fg.resize((int(BASE * 0.80), int(BASE * 0.80)), Image.LANCZOS)
sheet = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
sheet.paste(scaled, ((BASE - scaled.width) // 2, (BASE - scaled.height) // 2), scaled)
sheet.save("assets/icon-foreground.png")

# スプラッシュ（アイコンを中央に置く。背景色は capacitor.config.ts と揃える）
for name, bg in (("splash", (0xFF, 0xFF, 0xFF)), ("splash-dark", (0x0E, 0x1C, 0x2A))):
    sp = Image.new("RGB", (2732, 2732), bg)
    side = 1100
    sp.paste(icon.resize((side, side), Image.LANCZOS),
             ((2732 - side) // 2, (2732 - side) // 2))
    sp.save(f"assets/{name}.png")

# Web/PWA も同じ絵柄に揃える
rgba = icon.convert("RGBA")
rgba.resize((192, 192), Image.LANCZOS).save("public/icon-192.png")
rgba.resize((512, 512), Image.LANCZOS).save("public/icon-512.png")
rgba.resize((180, 180), Image.LANCZOS).save("public/apple-touch-icon.png")
icon.resize((32, 32), Image.LANCZOS).save("public/favicon.png")
rgba.resize((256, 256), Image.LANCZOS).save("public/favicon.ico", sizes=[(256, 256)])

print("アイコン一式を生成しました。")
print("反映にはネイティブビルドが必要です（mem/features/app-icon-splash-assets.md）。")
