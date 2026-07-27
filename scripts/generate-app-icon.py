#!/usr/bin/env python3
"""アプリアイコン一式を生成する（冬の雪山を背景にしたデザイン）。

    python3 scripts/generate-app-icon.py

必要: Python 3 + numpy + Pillow  (pip install numpy pillow)
プロジェクト直下で実行すること。

## なぜスクリプトなのか

背景を季節ごとに差し替えられるようにするため。配色や山の形はすべて定数なので、
このファイルを編集して流し直せば一式が揃う。固定シードなので出力は毎回同じ。

## 素材について

盾・GBモノグラム・「ジムボード」の書体は既存画像から抽出して使う。**描き起こさない。**
コンテナのフォントに元デザインと同じ字形が無く、描き直すとブランドの見た目が変わるため。

    assets/icon-emblem-src.png    盾とGB（旧ティール版アイコン）
    assets/feature-text-src.png   「ジムボード」の白文字（透過）

**出力先のファイルを抽出元にしてはいけない**（自分の出力を読み直すことになり、
流すたびに絵柄が劣化する）。

## 出力

    assets/icon-only.png                   iOS/レガシーAndroid のアイコン
    gymboard-app-icon-1024.PNG             同じものをルートにも（ドリフト防止）
    assets/icon-foreground.png             Androidアダプティブの前景（透過・0.80縮小）
    assets/icon-background.png             Androidアダプティブの背景（フルブリード）
    assets/splash.png / splash-dark.png    スプラッシュ
    public/icon-192.png / icon-512.png     PWA / Play Console 掲載アイコン
    public/apple-touch-icon.png            iOS Safari
    public/favicon.png / favicon.ico       favicon
    src/assets/gymboard-loader.png         アプリ内ローディング表示（角丸・透過）
    gymboard-feature-graphic-1024x500.png  Play Console のフィーチャーグラフィック

反映には別途ネイティブビルドが必要（詳細は mem/features/app-icon-splash-assets.md）。
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

EMBLEM_SRC = "assets/icon-emblem-src.png"      # 盾とGBの抽出元（出力先を指定しないこと）
TEXT_SRC = "assets/feature-text-src.png"       # 「ジムボード」の抽出元
BASE = 1024
S = 3                                          # スーパーサンプリング倍率
SEED = 20260727
CX = 511.5                                     # 盾の中心x（抽出元から実測した値）


class Canvas:
    """論理サイズ (w, h) の描画面。座標はすべて論理pxで指定し、内部で S 倍して描く。"""

    def __init__(self, w, h, s=S, seed=SEED):
        self.w, self.h, self.s = w, h, s
        self.nw, self.nh = w * s, h * s
        self.YY, self.XX = np.mgrid[0:self.nh, 0:self.nw].astype(np.float32)
        self.rng = np.random.default_rng(seed)

    def blur(self, m, r):
        im = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8), "L")
        return np.asarray(im.filter(ImageFilter.GaussianBlur(r * self.s)), np.float32) / 255.0

    def shift(self, m, dx, dy):
        dx, dy = int(dx * self.s), int(dy * self.s)
        out = np.zeros_like(m)
        x0, x1 = max(0, dx), min(self.nw, self.nw + dx)
        y0, y1 = max(0, dy), min(self.nh, self.nh + dy)
        if x0 < x1 and y0 < y1:
            out[y0:y1, x0:x1] = m[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
        return out

    def solid(self, c):
        return np.zeros((self.nh, self.nw, 3), np.float32) + np.array(c, np.float32)

    def radial(self, cx, cy, r, inner=1.0, outer=0.0):
        d = np.sqrt((self.XX / self.nw - cx) ** 2 + (self.YY / self.nh - cy) ** 2) / r
        return np.clip(inner + (outer - inner) * np.clip(d, 0, 1), 0, 1)

    def vgrad(self, stops):
        ys = np.linspace(0, 1, self.nh)
        out = np.empty((self.nh, self.nw, 3), np.float32)
        for i in range(3):
            out[:, :, i] = np.interp(ys, [p for p, _ in stops],
                                     [c[i] for _, c in stops])[:, None]
        return out

    def ridge_line(self, peaks, rough, seed):
        """peaks=[(x, y), ...] を折れ線で結び、列ごとの稜線の高さ配列を返す（論理px指定）"""
        xs = np.array([p[0] for p in peaks], np.float32) * self.s
        ys = np.array([p[1] for p in peaks], np.float32) * self.s
        ry = np.interp(np.arange(self.nw), xs, ys).astype(np.float32)
        g = np.random.default_rng(seed)
        for wave, amp in ((60, 1.0), (22, 0.5), (8, 0.25)):     # 複数スケールの凹凸
            n = g.normal(0, 1, self.nw // wave + 2)
            ry += np.interp(np.linspace(0, len(n) - 1, self.nw),
                            np.arange(len(n)), n) * rough * amp * self.s
        return ry


def over(dst, rgb, a):
    aa = a[:, :, None]
    dst *= (1 - aa)
    dst += rgb * aa
    return dst


def draw_range(c, canvas, ry, rock, snow_line, fade, thick, shadow, haze, seed,
               haze_drop=150):
    """山脈を1つ描く。

    snow_line: これより高い（=yが小さい）列に雪が乗る（論理px）
    fade:      雪が乗り始めてから最大量になるまでの標高差（論理px）
    thick:     最大の積雪の厚み（稜線からの距離・論理px）

    雪の量は「稜線から一定幅」ではなく「その列の標高」で決めている。
    一定幅にすると雪が輪郭に沿った帯に見えて山にならない。
    """
    body = (c.YY >= ry[None, :]).astype(np.float32)
    over(canvas, c.solid(rock), body)

    # ry は拡大後の座標なので、論理pxで与えた値は S 倍して比べる。
    alt = np.clip((snow_line * c.s - ry) / (fade * c.s), 0, 1) ** 1.3
    # 雪の下端は列ごとに揺らす。面全体に2次元ノイズを掛ける方法も試したが、
    # 深さの切り口が鋭いため氷柱のような細かい垂れになってしまった。
    # wave は制御点1つあたりのピクセル数で、小さいほど細かく垂れる。
    g = np.random.default_rng(seed)
    wobble = np.ones(c.nw, np.float32)
    for wave, amp in ((300, 0.22), (110, 0.10)):
        n = g.normal(0, 1, c.nw // wave + 2)
        wobble += np.interp(np.linspace(0, len(n) - 1, c.nw),
                            np.arange(len(n)), n).astype(np.float32) * amp
    depth = (alt * thick * c.s * np.clip(wobble, 0.35, 1.8))[None, :]
    snow = np.clip((depth - (c.YY - ry[None, :])) / (22 * c.s), 0, 1) * body
    over(canvas, c.solid((0xFC, 0xFE, 0xFF)), c.blur(snow, 1.0))

    # 影は寒色に転ぶよう、赤を強めに落とす（光源は右上）
    sh = (np.clip(1.0 - c.XX / c.nw * 1.4, 0, 1) ** 1.3 * body * shadow)[:, :, None]
    canvas *= (1 - sh * np.array([1.25, 1.05, 0.72], np.float32))

    # 裾の冷たい霞（空気遠近）
    over(canvas, c.solid((0xDD, 0xEA, 0xF4)),
         c.blur(np.clip(c.shift(body, 0, haze_drop), 0, 1), 45) * haze)
    return canvas


def winter_background(c, sky, sun, ranges, flakes, vig, grain=1.8, haze_drop=150):
    """冬の雪山の背景を描いて返す"""
    canvas = c.vgrad(sky)
    # 冬の陽は淡く拡散する（金色にしない）
    canvas += (c.radial(*sun[0]) ** 2.0)[:, :, None] * np.array(sun[1], np.float32)
    canvas = np.clip(canvas, 0, 255)

    for r in ranges:                       # 遠景 → 近景（遠いほど淡くコントラストが低い）
        canvas = draw_range(c, canvas, c.ridge_line(*r["ridge"]), haze_drop=haze_drop,
                            **{k: v for k, v in r.items() if k != "ridge"})
    canvas = np.clip(canvas, 0, 255)

    # 粉雪。盾より奥に描くのでロゴには掛からない。
    layer = Image.new("L", (c.nw, c.nh), 0)
    fd = ImageDraw.Draw(layer)
    for _ in range(flakes):
        fx = c.rng.uniform(0, c.w)
        fy = c.rng.uniform(0, c.h) ** 0.85 / c.h ** 0.85 * c.h      # 上のほうに多く
        r = c.rng.uniform(1.2, 5.2) ** 1.15
        fd.ellipse([(fx - r) * c.s, (fy - r) * c.s, (fx + r) * c.s, (fy + r) * c.s],
                   fill=int(c.rng.uniform(45, 210)))
    over(canvas, c.solid((255, 255, 255)),
         c.blur(np.asarray(layer, np.float32) / 255.0, 0.7) * 0.9)

    # 粒状感（のっぺりしないように）
    canvas = np.clip(canvas + c.rng.normal(0, grain, (c.nh, c.nw, 1)).astype(np.float32),
                     0, 255)
    # 周辺減光（盾に視線を集める）。寒色を残すため青は落としすぎない。
    canvas *= (1 - (c.radial(*vig[0]) ** 1.8)[:, :, None] * np.array(vig[1], np.float32))
    return np.clip(canvas, 0, 255)


def load_emblem(c):
    """盾とGBを抽出元から取り出し、(RGB, 盾マスク) を c の解像度で返す"""
    src = np.array(Image.open(EMBLEM_SRC).convert("RGB")).astype(int)
    white = (src[:, :, 0] > 230) & (src[:, :, 1] > 230) & (src[:, :, 2] > 230)

    # 盾のシルエット: 各行の白の左右端を結ぶ。
    # 文字は白い面の内側にしか無いので、行ごとの端は必ず盾の輪郭になる。
    half = np.zeros(BASE)
    for y in range(BASE):
        xs = np.where(white[y])[0]
        if len(xs) > 2:
            half[y] = (xs.max() - xs.min()) / 2.0
    rows = np.where(half > 0)[0]
    top, tip = int(rows.min()), int(rows.max())
    half = np.convolve(half, np.ones(5) / 5, mode="same")      # 軽く均してギザつきを取る
    half[:top] = 0
    half[tip + 1:] = 0

    img = Image.new("L", (c.nw, c.nh), 0)
    left, right = [], []
    for y in range(top, tip + 1):
        if half[y] <= 0:
            continue
        left.append(((CX - half[y]) * c.s, y * c.s))
        right.append(((CX + half[y]) * c.s, y * c.s))
    ImageDraw.Draw(img).polygon(left + right[::-1], fill=255)
    mask = np.asarray(img, np.float32) / 255.0
    emblem = np.asarray(
        Image.open(EMBLEM_SRC).convert("RGB").resize((c.nw, c.nh), Image.LANCZOS),
        np.float32)
    return emblem, mask


def place_shield(c, canvas, emblem, mask):
    """雪山は白いので、盾が埋もれないよう寒色の影で浮かせてから載せる"""
    over(canvas, c.solid((0x0E, 0x2A, 0x48)), c.blur(c.shift(mask, 2, 13), 17) * 0.46)
    over(canvas, c.solid((0x0E, 0x2A, 0x48)), c.blur(c.shift(mask, 0, 4), 5) * 0.26)
    over(canvas, emblem, mask)
    return canvas


def to_image(arr, w, h):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).resize(
        (w, h), Image.LANCZOS)


# =========================================================================
# 1) 正方形のアイコン
# =========================================================================
ICON_SKY = [
    (0.00, (0x2A, 0x59, 0x8E)),      # 高いところの濃い冬空
    (0.22, (0x4C, 0x80, 0xB2)),
    (0.42, (0x92, 0xB7, 0xD4)),
    (0.58, (0xC6, 0xDB, 0xE9)),
    (0.70, (0xE9, 0xF1, 0xF6)),      # 地平近くは白く霞む
    (1.00, (0xF5, 0xF9, 0xFB)),
]
ICON_RANGES = [
    dict(ridge=([(-30, 648), (110, 548), (250, 620), (400, 534), (560, 606),
                 (720, 540), (880, 614), (1054, 558)], 3.0, 21),
         rock=(0xB4, 0xC8, 0xDA), snow_line=650, fade=60, thick=58,
         shadow=0.06, haze=0.42, seed=101),
    dict(ridge=([(-30, 712), (95, 574), (230, 676), (360, 544), (500, 654),
                 (650, 562), (810, 672), (935, 584), (1054, 676)], 4.5, 5),
         rock=(0x86, 0xA4, 0xC0), snow_line=710, fade=70, thick=86,
         shadow=0.12, haze=0.32, seed=202),
    dict(ridge=([(-30, 880), (75, 540), (200, 760), (330, 652), (470, 808),
                 (620, 720), (760, 656), (905, 514), (1054, 788)], 6.5, 31),
         rock=(0x56, 0x74, 0x94), snow_line=820, fade=95, thick=140,
         shadow=0.18, haze=0.16, seed=303),
]

c = Canvas(BASE, BASE)
background = winter_background(
    c, ICON_SKY, ((0.74, 0.12, 0.70), (52, 56, 60)), ICON_RANGES,
    flakes=210, vig=((0.5, 0.44, 1.12, 0.0, 1.0), (0.26, 0.22, 0.15)))
emblem, shield = load_emblem(c)
icon = to_image(place_shield(c, background.copy(), emblem, shield), BASE, BASE)

icon.save("assets/icon-only.png")
icon.save("gymboard-app-icon-1024.PNG")      # ルートのマスターも同時に更新（ドリフト防止）
to_image(background, BASE, BASE).save("assets/icon-background.png")

# Androidアダプティブの前景: 透過・盾のみ・安全ゾーン内に 0.80 で縮小
shield_rgba = Image.fromarray(
    np.clip(np.dstack([emblem, shield * 255.0]), 0, 255).astype(np.uint8), "RGBA"
).resize((BASE, BASE), Image.LANCZOS)
scaled = shield_rgba.resize((int(BASE * 0.80), int(BASE * 0.80)), Image.LANCZOS)
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

# =========================================================================
# 2) アプリ内ローディング表示（角丸・透過）
# =========================================================================
# 正方形のまま貼ると「青い四角」に見えるので、アイコンらしく角を丸める。
# 64px 表示の 3倍解像度に耐えるよう 512 で書き出す。
LOADER = 512
corner = Image.new("L", (LOADER, LOADER), 0)
ImageDraw.Draw(corner).rounded_rectangle(
    [0, 0, LOADER - 1, LOADER - 1], radius=int(LOADER * 0.225), fill=255)
loader = icon.convert("RGBA").resize((LOADER, LOADER), Image.LANCZOS)
loader.putalpha(corner)
loader.save("src/assets/gymboard-loader.png")

# =========================================================================
# 3) Play Console のフィーチャーグラフィック（1024×500）
# =========================================================================
# 横長なので山と空を別に組み直す。白文字を載せるため、空は中ほどまで濃いまま保つ。
FW, FH = 1024, 500
FEATURE_SKY = [
    (0.00, (0x14, 0x3A, 0x68)),
    (0.34, (0x22, 0x54, 0x8C)),
    (0.60, (0x35, 0x6E, 0xA6)),      # ここに白文字が乗る
    (0.80, (0x7C, 0xA8, 0xCE)),
    (1.00, (0xD8, 0xE8, 0xF2)),
]
FEATURE_RANGES = [
    dict(ridge=([(-30, 396), (150, 334), (320, 384), (500, 326), (680, 378),
                 (860, 330), (1054, 382)], 2.2, 21),
         rock=(0x8E, 0xAC, 0xC8), snow_line=396, fade=40, thick=34,
         shadow=0.06, haze=0.30, seed=401),
    dict(ridge=([(-30, 470), (120, 340), (300, 436), (480, 378), (660, 446),
                 (845, 332), (1054, 458)], 3.4, 31),
         rock=(0x4A, 0x68, 0x8A), snow_line=470, fade=55, thick=70,
         shadow=0.16, haze=0.14, seed=402),
]

fc = Canvas(FW, FH)
feature = to_image(winter_background(
    fc, FEATURE_SKY, ((0.80, 0.14, 0.62), (44, 48, 54)), FEATURE_RANGES,
    flakes=130, vig=((0.5, 0.5, 1.30, 0.0, 1.0), (0.16, 0.13, 0.09)),
    haze_drop=70), FW, FH).convert("RGBA")

# 盾は元のレイアウトと同じ位置・大きさに置く（旧グラフィックからの実測値）
SX0, SY0, SX1, SY1 = 82, 57, 382, 439
crop = shield_rgba.crop(shield_rgba.getbbox()).resize((SX1 - SX0, SY1 - SY0), Image.LANCZOS)
drop = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
drop.paste(crop, (SX0 + 3, SY0 + 10), crop)
drop = drop.filter(ImageFilter.GaussianBlur(9))
tint = Image.new("RGBA", (FW, FH), (0x0E, 0x2A, 0x48, 0))
tint.putalpha(drop.getchannel("A").point(lambda v: int(v * 0.5)))
feature = Image.alpha_composite(feature, tint)
feature.paste(crop, (SX0, SY0), crop)

# 「ジムボード」は書体を保つため既存画像から抽出したものを重ねる
feature = Image.alpha_composite(feature, Image.open(TEXT_SRC).convert("RGBA"))
feature.convert("RGB").save("gymboard-feature-graphic-1024x500.png")

print("アイコン一式を生成しました。")
print("反映にはネイティブビルドが必要です（mem/features/app-icon-splash-assets.md）。")
