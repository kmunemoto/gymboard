#!/usr/bin/env python3
"""生成したスタンプの絵（JPG/PNG）を、配布用の透過 PNG にする。

    python3 scripts/convert-sticker.py 元画像.jpg src/assets/stickers/<id>.png

条件は mem/features/chat-stickers.md の「書き出しの条件」のとおり:
透過・512×512・余白8%・影なし。

## 🔴 白を「色で」消さない

外周から**繋がっている**白だけを消す（塗りつぶし）。単純に「白なら透明」に
すると、絵の中の白まで消える:

  - 文字の白い縁取り  … これが消えると、濃い面の上で文字が読めなくなる
  - 目のハイライト    … 消えると死んだ目になる
  - 切り抜き風の白フチ … スタンプらしさそのもの

## 使ったあと

1. `src/lib/stickers.ts` の `STICKERS` に1行足す（`text` は絵の文字と同じに）
2. `npm test` の `chatStickers.test.ts` が、透過・寸法・重さ・一覧との対応を見る
"""
import sys
from PIL import Image, ImageDraw, ImageOps

# PIL の floodfill は3チャンネルの差の**合計**で見る（1chあたり約9）。
# JPEG の圧縮ノイズは拾い、白フチとの境目は越えない値。
TOL = 26
# 絵に出てこない色。ここを透過にする（グレー・ティール・ピンク・黒しか使っていない）
SENTINEL = (255, 0, 255)
SIZE = 512
PAD = 0.08


def convert(src: str, dst: str) -> None:
    img = Image.open(src).convert("RGB")
    # 1px の白い縁を足して、外周の白が必ず1つに繋がるようにする
    # （角から塗りつぶすだけで四辺すべてを消せる）
    img = ImageOps.expand(img, border=1, fill=(255, 255, 255))
    ImageDraw.floodfill(img, (0, 0), SENTINEL, thresh=TOL)
    img = img.crop((1, 1, img.width - 1, img.height - 1))

    rgba = img.convert("RGBA")
    px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            if px[x, y][:3] == SENTINEL:
                px[x, y] = (255, 255, 255, 0)

    box = rgba.getbbox()
    if box:
        rgba = rgba.crop(box)

    inner = int(SIZE * (1 - 2 * PAD))
    rgba.thumbnail((inner, inner), Image.LANCZOS)
    out = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 0))
    out.paste(rgba, ((SIZE - rgba.width) // 2, (SIZE - rgba.height) // 2))

    # 色数を落として軽くする。透過はパレット＋tRNS で残る
    out.quantize(colors=128, method=Image.FASTOCTREE).save(dst, optimize=True)
    print(f"{dst}  {out.size[0]}x{out.size[1]}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    convert(sys.argv[1], sys.argv[2])
