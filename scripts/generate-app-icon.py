#!/usr/bin/env python3
"""アプリアイコン一式を生成する（ブランドのティール1色を背景にしたデザイン）。

    python3 scripts/generate-app-icon.py

必要: Python 3 + numpy + Pillow  (pip install numpy pillow)
プロジェクト直下で実行すること。

## デザイン（2026-08 更新）

**背景は「アプリ内と同じティールのグラデーション」だけ。** 絵は描かない。

以前は冬の雪山（空・稜線・積雪・粉雪）を描いていたが、**16〜24px のホーム画面で
何が描いてあるか判別できなくなっていた**（山の稜線と盾の輪郭が同じ明度で混ざる）。
アイコンが実際に見られるのはほぼその大きさなので、背景の絵は情報を運んでいなかった。

配色は製品の `--primary` / `--accent`（`src/index.css` の `hsl(174 60% 45%)` 系）と
同じティールで、角度も `.gradient-primary` と同じ 135°。**アイコンと製品画面が
同じ色の系統に見える**ようにしている。深さは「白い盾が 16px で沈まない」ことを
基準に決めた（明るすぎると盾の輪郭が背景に溶ける）。

盾と GB モノグラムは**従来のまま**。ブランドマークなので触らない。

## なぜスクリプトなのか

配色を変えられるようにするため。色は下の定数だけなので、編集して流し直せば一式が揃う。
固定シードなので出力は毎回同じ。

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
    src/assets/gymboard-loader.png         アプリ内ローディング表示（透過・盾のみ）
    gymboard-feature-graphic-1024x500.png  Play Console のフィーチャーグラフィック

反映には別途ネイティブビルドが必要（詳細は mem/features/app-icon-splash-assets.md）。
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

EMBLEM_SRC = "assets/icon-emblem-src.png"      # 盾とGBの抽出元（出力先を指定しないこと）
TEXT_SRC = "assets/feature-text-src.png"       # 「ジムボード」の抽出元
BASE = 1024
S = 3                                          # スーパーサンプリング倍率
SEED = 20260821
CX = 511.5                                     # 盾の中心x（抽出元から実測した値）

# --- 配色 -----------------------------------------------------------------
# 135° のティール。明るい側は製品の --primary（hsl(174 60% 45%) ≒ #2EB8AA）より
# 少し落として、白い盾が 16px でも背景から分離するようにしている。
GRAD_FROM = (0x18, 0xA0, 0x8E)                 # 左上（明るい側）
GRAD_TO = (0x06, 0x59, 0x50)                   # 右下（暗い側）
# 左上のごく弱い光。真っ平らなグラデーションは 1024px 以上で「塗り忘れ」に見えるため。
LIGHT_AT = (0.24, 0.18)                        # 光源の位置（0-1）
LIGHT_RADIUS = 0.85
LIGHT_AMOUNT = 16                              # 加算する明るさ（0-255）
# 盾を座らせる影。背景が静かになったぶん、雪山版より大幅に弱くしている
# （強くすると 16px で盾の下に黒い輪が出る）。色は無彩色ではなく深いティール。
SHADOW_INK = (0x04, 0x33, 0x2E)
SHADOW_ALPHA = 0.16
SHADOW_BLUR = 18
SHADOW_DROP = 8
GRAIN = 1.2                                    # バンディング防止（2732pxのスプラッシュで出る）


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

    def falloff(self, cx, cy, r, power=1.6):
        """(cx, cy) で 1、半径 r で 0 になる減衰（0-1 の正規化座標）"""
        d = np.sqrt((self.XX / self.nw - cx) ** 2 + (self.YY / self.nh - cy) ** 2) / r
        return np.clip(1.0 - d, 0, 1) ** power


def over(dst, rgb, a):
    aa = a[:, :, None]
    dst *= (1 - aa)
    dst += rgb * aa
    return dst


def brand_background(c, grad_from=GRAD_FROM, grad_to=GRAD_TO):
    """ティールの 135° グラデーション。アスペクト比に依らず対角に流れる。

    x と y をそれぞれ 0-1 に正規化してから足すので、正方形のアイコンでも
    横長のフィーチャーグラフィックでも同じ「左上→右下」の流れになる。
    """
    t = np.clip((c.XX / c.nw + c.YY / c.nh) / 2.0, 0, 1)[:, :, None]
    canvas = np.array(grad_from, np.float32) * (1 - t) + np.array(grad_to, np.float32) * t
    canvas += c.falloff(*LIGHT_AT, LIGHT_RADIUS)[:, :, None] * LIGHT_AMOUNT
    # 純粋なグラデーションは 8bit では帯が見える。わずかな粒でディザリングする。
    canvas += c.rng.normal(0, GRAIN, (c.nh, c.nw, 1)).astype(np.float32)
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
    """盾を載せる。影は「浮かせる」ためではなく座らせるためなので、ごく弱く。"""
    over(canvas, c.solid(SHADOW_INK),
         c.blur(c.shift(mask, 0, SHADOW_DROP), SHADOW_BLUR) * SHADOW_ALPHA)
    over(canvas, emblem, mask)
    return canvas


def to_image(arr, w, h):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).resize(
        (w, h), Image.LANCZOS)


# =========================================================================
# 1) 正方形のアイコン
# =========================================================================
c = Canvas(BASE, BASE)
background = brand_background(c)
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
#
# 角を丸めてから貼る。背景が単色のティールになったので、直角のまま貼ると
# 白い画面に「切り抜き忘れた四角」が浮いて見える（雪山版は裾が白く霞んでいたため
# 目立たなかった）。半径は iOS のホーム画面のマスクに近い 22%。
SPLASH_ICON_SIDE = 1100
SPLASH_CORNER = 0.22
_mask = Image.new("L", (SPLASH_ICON_SIDE, SPLASH_ICON_SIDE), 0)
ImageDraw.Draw(_mask).rounded_rectangle(
    [0, 0, SPLASH_ICON_SIDE - 1, SPLASH_ICON_SIDE - 1],
    radius=int(SPLASH_ICON_SIDE * SPLASH_CORNER), fill=255)
_splash_icon = icon.resize((SPLASH_ICON_SIDE, SPLASH_ICON_SIDE), Image.LANCZOS)
for name, bg in (("splash", (0xFF, 0xFF, 0xFF)), ("splash-dark", (0x0E, 0x1C, 0x2A))):
    sp = Image.new("RGB", (2732, 2732), bg)
    off = (2732 - SPLASH_ICON_SIDE) // 2
    sp.paste(_splash_icon, (off, off), _mask)
    sp.save(f"assets/{name}.png")

# Web/PWA も同じ絵柄に揃える
rgba = icon.convert("RGBA")
rgba.resize((192, 192), Image.LANCZOS).save("public/icon-192.png")
rgba.resize((512, 512), Image.LANCZOS).save("public/icon-512.png")
rgba.resize((180, 180), Image.LANCZOS).save("public/apple-touch-icon.png")
icon.resize((32, 32), Image.LANCZOS).save("public/favicon.png")
rgba.resize((256, 256), Image.LANCZOS).save("public/favicon.ico", sizes=[(256, 256)])

# =========================================================================
# 2) アプリ内ローディング表示（盾とGBだけ・透過）
# =========================================================================
# 背景は入れず、ブランドロゴ src/assets/gymboard-logo.png の
# 「ティールの輪郭の盾＋GB」をそのまま使う（オーナーの指定）。
#
# 白背景に沈まないのは、盾が白ベタではなくティールの輪郭で描かれているため。
# アプリの背景は --background: 30 20% 99% のほぼ白1色でダークテーマは無い。
#
# ロゴ原本は周囲に余白があり、上下の中心も少しずれている（上165px/下64px）。
# そのまま object-contain で正方形に収めると小さく・下寄りに出るので、
# 中身のbboxで切り出して正方形の中央に置き直す。16〜24pxのボタン内表示でも
# 図形を最大限使えるようにするため。
#
# ロゴ原本は**盾の内側が白で塗りつぶされている**（外側だけ透過）。ほぼ白の通常画面では
# 気づかないが、写真背景（theme-glass）では白い板として浮く。ここで白を抜いて、
# ティールの輪郭とGBだけを残す。
LOADER = 512
LOADER_MARGIN = 0.04                      # 端に触れないぶんだけの余白
logo = Image.open("src/assets/gymboard-logo.png").convert("RGBA")

# 白いほど透明にする。純白(255)で0、minc<=215 で完全不透明。
# 40段のランプにしているのは、輪郭と白の境目のアンチエイリアスを残すため
# （閾値で切ると縁に白い輪が残り、逆に強く抜くとインクの色が薄くなる）。
px = np.array(logo).astype(np.float32)
minc = px[:, :, :3].min(axis=2)
px[:, :, 3] *= np.clip((255.0 - minc) / 40.0, 0.0, 1.0)
logo = Image.fromarray(np.clip(px, 0, 255).astype(np.uint8), "RGBA")

logo = logo.crop(logo.getbbox())          # 透明な余白を落とす
inner = int(LOADER * (1 - LOADER_MARGIN * 2))
scale = min(inner / logo.width, inner / logo.height)
logo = logo.resize((max(1, round(logo.width * scale)),
                    max(1, round(logo.height * scale))), Image.LANCZOS)
loader = Image.new("RGBA", (LOADER, LOADER), (0, 0, 0, 0))
loader.paste(logo, ((LOADER - logo.width) // 2, (LOADER - logo.height) // 2), logo)
loader.save("src/assets/gymboard-loader.png")

# =========================================================================
# 3) Play Console のフィーチャーグラフィック（1024×500）
# =========================================================================
# 同じ 135° のグラデーション。左上（盾を置く側）が明るく、右下（白文字を置く側）が
# 暗くなるので、白文字のコントラストは対角の流れがそのまま担保する。
FW, FH = 1024, 500
fc = Canvas(FW, FH)
feature = to_image(brand_background(fc), FW, FH).convert("RGBA")

# 盾は元のレイアウトと同じ位置・大きさに置く（旧グラフィックからの実測値）
SX0, SY0, SX1, SY1 = 82, 57, 382, 439
crop = shield_rgba.crop(shield_rgba.getbbox()).resize((SX1 - SX0, SY1 - SY0), Image.LANCZOS)
drop = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
drop.paste(crop, (SX0, SY0 + SHADOW_DROP), crop)
drop = drop.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
tint = Image.new("RGBA", (FW, FH), (*SHADOW_INK, 0))
tint.putalpha(drop.getchannel("A").point(lambda v: int(v * SHADOW_ALPHA)))
feature = Image.alpha_composite(feature, tint)
feature.paste(crop, (SX0, SY0), crop)

# 「ジムボード」は書体を保つため既存画像から抽出したものを重ねる
feature = Image.alpha_composite(feature, Image.open(TEXT_SRC).convert("RGBA"))
feature.convert("RGB").save("gymboard-feature-graphic-1024x500.png")

print("アイコン一式を生成しました。")
print("反映にはネイティブビルドが必要です（mem/features/app-icon-splash-assets.md）。")
