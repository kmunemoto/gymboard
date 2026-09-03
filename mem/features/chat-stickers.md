# チャットのスタンプ（LINE風）— 素材づくり

2026-09-03 着手。チャットに LINE のようなスタンプを足す。**まず絵を作る段階**で、
アプリ側の実装はまだ何もしていない。

## 決まっていること

| | 決め | 理由 |
|---|---|---|
| 誰のキャラか | **ジムボード全体の公式キャラ**（Salute御所南専用にしない） | 他のジムに売るときそのまま資産になる |
| 文字 | 🔴 **絵に焼き込む**（2026-09-03 宗本さん決定） | LINE のスタンプらしさ。下記の代償を承知のうえ |
| 体の色 | **クリーム色**。タオル等の小物だけティファニーブルー `#2EB8AA` | ジムごとにテーマ色を変えられる（`ThemeColorSwitcher`）ので、体をブランド色にすると
テーマを変えた店で浮く。濃い輪郭＋クリームの体なら**ダークモードでも沈まない** |
| キャラの既定 | **案A（まんまる）** | 小さくしたときの読みやすさが最優先の制約。円のシルエットがいちばん強い |
| 枚数 | 16枚（うち★8枚を先に） | LINE の最小セットが8。まず8枚出して反応を見る |

### 🔴 文字を焼き込む代償（承知のうえで選んでいる）

1. **スタンプは日本語専用になる。** アプリは5言語対応（ja/en/ko/zh-CN/zh-TW）だが、
   絵に文字が入るとその画像は日本語のまま出る。他のジム・他言語のお客様に売るときは
   **英語版を別途作る**ことになる
2. **画像生成AIは日本語をほぼ確実に崩す。** 濁点が抜ける・「ば」が「ぱ」になる・
   存在しない字が混ざる。**出てきた画像は1字ずつ目で確認すること。**
   1〜2字だけ違う場合は、その1枚だけ「文字なしで生成 → Canva 等で文字を乗せる」に
   切り替えるのが速い（フォントで入れれば絶対に崩れない）

## 🔴 作る順番（間違えると全部やり直し）

```
① キャラクターシートを1枚作る（文字なし）← ここで絵柄を確定させる
② ①を参照画像として渡しながら、1枚ずつスタンプを作る（文字あり）
```

**①に文字を入れないこと。** 参照画像に文字があると、全スタンプにその文字が引きずられる。

②で参照画像を渡せない道具を使う場合は、**①の画像そのものを「この絵柄でポーズだけ変えて」と
編集させる**のが確実。

---

## ① キャラクターシート（文字なし・1回だけ）

```
Character expression sheet for a cute original mascot, one full-body reference
on the left and a grid of six head-and-shoulders expressions on the right
(neutral, big smile, sparkling happy, worried, exhausted, determined).
Identical original character on every view.

The character: a small round plump mascot shaped like a soft rice cake,
cream-white body (#F7F1E6), simple bean-shaped black eyes, tiny pink blush ovals
on the cheeks, a small rounded mouth, very short stubby arms and legs,
no fingers, no nose. Wearing a small teal (#2EB8AA) gym towel draped around
its neck and a matching teal wristband on one arm.

Style: clean flat vector illustration, thick uniform dark charcoal outline
(#3A3A3A), cel-shaded flat colors with one soft shadow tone, no gradients,
no textures, chibi proportions with a head about half the total height,
extremely readable silhouette, kawaii Japanese mascot design, sticker art style.

Pure white seamless background, even flat lighting, high resolution, crisp lineart.

no text, no watermark, no logos, no frame borders, no drop shadow,
no realistic rendering, no 3D, no gradient background, single character only,
no other characters, no props beyond the towel and wristband.
```

### キャラを変えるとき

上の「The character:」の段落と、下の16枚の同じ段落を差し替える。

**案B（柴犬）**
```
a chubby round shiba inu puppy mascot standing on two legs, cream and light tan
fur (#F2E3C9 / #E0B87A), small triangular ears, a curled tail, simple round black
eyes, a tiny dark nose, small blush ovals on the cheeks, short stubby limbs with
no visible fingers, wearing a teal (#2EB8AA) headband and a matching teal gym
towel around its neck
```

**案C（ダンベル）**
```
a living dumbbell mascot — a horizontal dumbbell whose centre bar is its round
body, with two chunky weight plates as its shoulders, soft matte steel grey body
(#C9D1D3) with teal (#2EB8AA) weight plates, simple bean-shaped black eyes,
small blush ovals, a tiny rounded mouth, short stubby arms and legs
```

---

## ② スタンプ16枚（そのまま貼る）

★＝先に作る8枚。

### 1 ★ よろしくお願いします

```
Cute original mascot sticker illustration. A small round plump mascot shaped like
a soft rice cake, cream-white body (#F7F1E6), simple bean-shaped black eyes, tiny
pink blush ovals on the cheeks, a small rounded mouth, very short stubby arms and
legs, no fingers, no nose, wearing a teal (#2EB8AA) gym towel around its neck and
a teal wristband on one arm.

POSE: bowing politely with both tiny arms at its sides, eyes closed, gentle smile.

Japanese text "よろしくお願いします" at the bottom, bold rounded Japanese gothic
font (maru gothic), dark charcoal (#3A3A3A) letters with a thick white outline,
text height about 18% of the canvas, centered, slightly tilted, overlapping the
character slightly.

Style: clean flat vector illustration, thick uniform dark charcoal outline
(#3A3A3A), cel-shaded flat colors, no gradients, chibi proportions with a head
about half the total height, extremely readable silhouette, kawaii Japanese
sticker art. Transparent background, square canvas, character and text together
fill about 85% of the frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 2 ★ ありがとうございます

上と同じ。`POSE` と `Japanese text` だけ差し替える。

```
POSE: pressing both tiny hands together in front of its chest, eyes closed, warm
happy smile, small floating hearts around it.

Japanese text "ありがとうございます"
```

### 3 ★ 了解です

```
POSE: making a big OK circle with both arms above its head, confident cheerful face.

Japanese text "了解です！"
```

### 4 ★ がんばります

```
POSE: flexing one arm showing a tiny muscle, determined fired-up expression,
a small flame above its head.

Japanese text "がんばります！"
```

### 5 ★ おつかれさま

```
POSE: holding out a folded teal towel toward the viewer with both hands, kind
gentle smile.

Japanese text "おつかれさま！"
```

### 6 ★ ナイス

```
POSE: giving a big thumbs up with one arm, winking with one eye, bright smile.

Japanese text "ナイス！"
```

### 7 ★ ちょっと遅れます

```
POSE: running fast to the right, arms swinging, panicked wide eyes, sweat drops
and motion lines behind it.

Japanese text "ちょっと遅れます"
```

### 8 ★ ごめんなさい

```
POSE: pressing both hands together apologetically, bowing its head, one large
sweat drop, sorry troubled eyebrows.

Japanese text "ごめんなさい"
```

### 9 筋肉痛です

```
POSE: legs trembling with wobble lines, arms stiff and straight out, strained
wide-eyed face, small lightning marks on its thighs.

Japanese text "筋肉痛です…"
```

### 10 もう限界

```
POSE: lying face down on the floor completely flat, arms and legs sprawled out,
swirl eyes, a small puff of steam above it.

Japanese text "もう限界…"
```

### 11 うれしい

```
POSE: jumping in the air with both arms raised, sparkling star eyes, huge open
smile, sparkles around it.

Japanese text "うれしい！"
```

### 12 すごい

```
POSE: clapping both tiny hands together, impressed sparkling eyes, small sparkles
around it.

Japanese text "すごい！"
```

### 13 お待ちしてます

```
POSE: waving one arm at the viewer while sitting next to a small round wall clock,
calm happy smile.

Japanese text "お待ちしてます"
```

### 14 無理しないで

```
POSE: holding both hands out gently in a stop gesture, worried caring eyebrows,
soft concerned smile.

Japanese text "無理しないで"
```

### 15 質問です

```
POSE: raising one arm straight up, curious tilted head, a large question mark
floating above its head.

Japanese text "質問です！"
```

### 16 またね

```
POSE: waving goodbye with one arm, the other arm holding the towel, cheerful
smile, slight head tilt.

Japanese text "またね！"
```

---

## 書き出しの条件

アプリのチャット添付は **PNG が通る**（`src/lib/messageAttachment.ts` の
`ALLOWED_IMAGE_TYPES`）ので、透過スタンプはそのまま載る。

- **透過 PNG**。生成は 1024×1024、配布は **512×512** に縮小
- **上下左右に8%の余白**。目一杯だと吹き出しの中で窮屈に見える
- **影を落とさない**（背景が透過なので浮く）
- **輪郭線と文字の縁取りは太め**。チャットでは 120〜150px まで縮む
- 🔴 **1枚をダークモードのチャットに置いて確認する。** クリームの体＋濃い輪郭＋
  白の縁取りなら明暗どちらでも読めるはずだが、ここは実物を見ないと分からない

## まだ決めていないこと（実装に入る前に）

- **全ジム共通のスタンプにするか、ジムごとに持たせるか。**
  共通なら1セットを配るだけ。ジムごとなら `gym_videos` と同じくテナント別のテーブルが要る
- **既存の添付（`message_attachments`）に乗せるか、専用の種別を作るか。**
  乗せれば実装は軽いが、「スタンプだけ大きく表示する」「吹き出しの枠を出さない」といった
  見た目の出し分けができない。LINE らしくするなら専用の種別のほうがよい
- **送信UI**（入力欄の横のボタン → グリッドで選ぶ）の置き場所。
  チャットの下端は `--kb` / `--nav-h` で組んであるので、**そこに要素を足すと
  キーボードまわりの計算に影響する**（`mem/features/messaging.md` の3回直した経緯を読むこと）
