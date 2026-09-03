# チャットのスタンプ（LINE風）

2026-09-03 着手。チャットに LINE のようなスタンプを足す。
絵の作り方（プロンプト16枚ぶん）と、アプリ側の実装のどちらもこのファイルにある。

**いまの状態**: 5枚（よろしく／ありがとう／了解／がんばります／おつかれさま）で
実装まで完了。★8枚の残り3枚（ナイス／ちょっと遅れます／ごめんなさい）と、
そのあとの8枚は絵ができ次第 `src/lib/stickers.ts` に足すだけ（マイグレーション不要）。

## 決まっていること

| | 決め | 理由 |
|---|---|---|
| 誰のキャラか | **ジムボード全体の公式キャラ**（Salute御所南専用にしない） | 他のジムに売るときそのまま資産になる |
| 文字 | 🔴 **絵に焼き込む**（2026-09-03 宗本さん決定） | LINE のスタンプらしさ。下記の代償を承知のうえ |
| 体の色 | **明るいグレー**の体＋**ティファニー系のティール**のプレート | ジムごとにテーマ色を変えられる（`ThemeColorSwitcher`）ので、体をブランド色一色にすると
テーマを変えた店で浮く。グレーの体＋濃い輪郭なら**明暗どちらの背景でも沈まない** |
| キャラ | 🔴 **ダンベル型に決定**（2026-09-03・生成した絵で確定） | シルエットが強く、120pxまで縮んでも形が分かる |
| 枚数 | 16枚（うち★8枚を先に） | LINE の最小セットが8。まず8枚出して反応を見る |

### 🔴 文字を焼き込む代償（承知のうえで選んでいる）

1. **スタンプは日本語専用になる。** アプリは5言語対応（ja/en/ko/zh-CN/zh-TW）だが、
   絵に文字が入るとその画像は日本語のまま出る。他のジム・他言語のお客様に売るときは
   **英語版を別途作る**ことになる
2. **画像生成AIは日本語をほぼ確実に崩す。** 濁点が抜ける・「ば」が「ぱ」になる・
   存在しない字が混ざる。**出てきた画像は1字ずつ目で確認すること。**
   1〜2字だけ違う場合は、その1枚だけ「文字なしで生成 → Canva 等で文字を乗せる」に
   切り替えるのが速い（フォントで入れれば絶対に崩れない）

## 🔴 キャラは確定済み。参照画像を必ず渡す

2026-09-03 に宗本さんが生成した**キャラクターシートで確定**。
以後のスタンプは、**必ずその画像を参照画像として渡しながら**作る。
渡せない道具なら、その画像そのものを「この絵柄でポーズだけ変えて」と編集させる。

### ⚠️ 最初に書いた案Cの説明と、実物は2箇所ちがう

書き直してあるが、次に触る人が古い記述に引きずられないよう残しておく。

| 当初の指示 | 実物 |
|---|---|
| プレートは**肩** | プレートは**頭の横**（耳の位置） |
| 中心バーが胴体 | **中心バーが頭**で、胴体は下に別にある |
| タオルと手首バンドを装着 | **どちらも無い**（タオルは「おつかれさま」で手に持つ小道具として使う） |

### キャラの説明文（16枚すべてで使い回す）

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded
light grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick
teal (#6FC4C4) circular weight plate attached to each side of the head like ears,
each plate drawn as a slightly 3D disc with a visible darker teal rim. Below the
head, a small rounded light grey body with very short stubby arms and legs,
no fingers, no nose. Large round black eyes with a small white highlight, small
pink oval blush on each cheek, a simple curved mouth. Thick uniform dark slate
outline (#4A5560), flat vector cel-shaded colours, no gradients, chibi
proportions with the head about half the total height.
```

🔴 **色は文字で指定するより参照画像のほうが正確に揃う。** 上の hex は参照画像を
渡せない場合の保険。

---

## スタンプ16枚（そのまま貼る）

★＝先に作る8枚。**どれも単体で完結しているので、そのままコピーして使える。**
🔴 **毎回、確定したキャラクターシートの画像を参照画像として一緒に渡すこと。**
色と造形は文字で書くより参照画像のほうが正確に揃う（hex は保険）。

⚠️ 5番のタオルは**手に持つ小道具**。キャラ自身はタオルを着けていない
（着けさせると他の15枚と食い違う）。

🔴 **`no drop shadow` を消さないこと。** 確定したキャラクターシートの左の1体には
足元に影が付いている。透過スタンプで影が付くと、吹き出しの上に浮いて見える。

### 1 ★　よろしくお願いします

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: bowing politely forward with both tiny arms at its sides, eyes closed, gentle smile.

Japanese text "よろしくお願いします" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 2 ★　ありがとうございます

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: pressing both tiny hands together in front of its chest, eyes closed, warm happy smile, small floating hearts around it.

Japanese text "ありがとうございます" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 3 ★　了解です！

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: making a big OK circle with both arms raised above its head, confident cheerful face.

Japanese text "了解です！" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 4 ★　がんばります！

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: flexing one arm to show a tiny muscle, determined fired-up expression, a small flame above its head.

Japanese text "がんばります！" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 5 ★　おつかれさま！

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: holding out a folded teal towel toward the viewer with both hands, kind gentle smile.

Japanese text "おつかれさま！" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 6 ★　ナイス！

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: giving a big thumbs up with one arm, winking with one eye, bright smile.

Japanese text "ナイス！" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 7 ★　ちょっと遅れます

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: running fast to the right, arms swinging, panicked wide eyes, sweat drops and motion lines behind it.

Japanese text "ちょっと遅れます" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 8 ★　ごめんなさい

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: pressing both hands together apologetically, head bowed low, one large sweat drop, sorry troubled eyebrows.

Japanese text "ごめんなさい" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 9　筋肉痛です…

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: legs trembling with wobble lines, arms stiff and straight out to the sides, strained squeezed-shut eyes, small lightning marks near its legs.

Japanese text "筋肉痛です…" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 10　もう限界…

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: lying face down on the floor completely flat, arms and legs sprawled out, swirl eyes, a small puff of steam above it.

Japanese text "もう限界…" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 11　うれしい！

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: jumping in the air with both arms raised, sparkling star eyes, huge open smile, sparkles around it.

Japanese text "うれしい！" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 12　すごい！

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: clapping both tiny hands together, impressed sparkling eyes, small sparkles around it.

Japanese text "すごい！" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 13　お待ちしてます

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: waving one arm at the viewer while standing beside a small round wall clock, calm happy smile.

Japanese text "お待ちしてます" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 14　無理しないで

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: holding both hands out gently in a stop gesture, worried caring eyebrows, soft concerned smile.

Japanese text "無理しないで" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 15　質問です！

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: raising one arm straight up, head tilted with a curious look, a large question mark floating above its head.

Japanese text "質問です！" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

### 16　またね！

```
Cute original dumbbell mascot, exactly as in the reference image: a rounded light
grey head (#C2C8CD) shaped like the centre bar of a dumbbell, with a thick teal
(#6FC4C4) circular weight plate attached to each side of the head like ears, each
plate a slightly 3D disc with a visible darker teal rim. Below the head, a small
rounded light grey body with very short stubby arms and legs, no fingers, no nose.
Large round black eyes with a small white highlight, small pink oval blush on each
cheek, a simple curved mouth. Thick uniform dark slate outline (#4A5560), flat
vector cel-shaded colours, no gradients, chibi proportions, head about half the
total height.

POSE: waving goodbye with one arm raised, cheerful smile, slight head tilt.

Japanese text "またね！" at the bottom, bold rounded Japanese gothic font (maru
gothic), dark charcoal (#3A3A3A) letters with a thick white outline, text height
about 18% of the canvas, centered, one line, slightly tilted, overlapping the
character slightly.

Kawaii Japanese sticker art, extremely readable silhouette. Transparent
background, square canvas, character and text together fill about 85% of the
frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

---

## 書き出しの条件

アプリのチャット添付は **PNG が通る**（`src/lib/messageAttachment.ts` の
`ALLOWED_IMAGE_TYPES`）ので、透過スタンプはそのまま載る。

- **透過 PNG**。生成は 1024×1024、配布は **512×512** に縮小
- **上下左右に8%の余白**。目一杯だと吹き出しの中で窮屈に見える
- **影を落とさない**（背景が透過なので浮く）
- **輪郭線と文字の縁取りは太め**。チャットでは 120〜150px まで縮む
- 🔴 **1枚をダークモードのチャットに置いて確認する。** 明るいグレーの体＋濃い輪郭＋
  白の縁取りなら明暗どちらでも読めるはずだが、ここは実物を見ないと分からない

## 実装（2026-09-03）

素材づくりの段階で「まだ決めていない」と書いていた3点は、下のように決めた。

| 論点 | 決め | 理由 |
|---|---|---|
| 全ジム共通か、ジムごとか | 🔴 **全ジム共通。絵はアプリに同梱**（`src/assets/stickers/*.png`） | ジムボード公式のキャラなので分ける理由がない。DB もストレージも要らず、電波が悪くてもすぐ出る。代償は「**増やすにはアプリの更新が要る**」こと |
| 添付に乗せるか、専用の種別か | 🔴 **専用の列** `messages.sticker_id` | 添付に乗せると「吹き出しを出さない」「絵だけ大きく」ができず、ただの小さい添付写真になる |
| 送信UIの置き場所 | 入力欄の横の顔ボタン → **外枠の中**で高さ固定の欄が開く | 外枠は `bottom-[max(var(--kb,0px),var(--nav-h,6rem))]`。ここに高さを足すとキーボードまわりが4回目の作り直しになる |

### 🔴 `content` にはスタンプの文字を入れる（空にしない）

「ありがとうございます」のスタンプなら `messages.content` も `ありがとうございます`。

1. **古いアプリでも意味が通る。** `sticker_id` を知らない版は本文をそのまま表示する
   （絵は出ないが文章としては読める）。2026-09-03 に「古いアプリが新しい規則を
   知らずに詰む」を実際に踏んだばかりなので、最初から素直に落ちる形にしておく
2. 新規メッセージの通知（`notify-new-message`）が**そのまま動く**。
   空文字にすると、プッシュもメールも本文が空で届く
3. 会話一覧のプレビューにも出るし、会話内検索にも掛かる

⚠️ したがって `STICKERS[].text` は**絵に描いてある文字と同じ**にすること。ずれると、
古いアプリと新しいアプリで違うことを言っているように見える。

### DB は id の「形」しか見ない

`CHECK (sticker_id IS NULL OR sticker_id ~ '^[a-z0-9_]{1,40}$')` だけ。
どの id が存在するかはアプリ側の一覧が持つ。DB に一覧を持たせると、
スタンプを1枚足すたびにマイグレーションが要る。

`unsend_message` にも `sticker_id = NULL` を足した（無いと、取り消しても絵だけ残る）。

### ファイル

| 置き場所 | 何 |
|---|---|
| `src/lib/stickers.ts` | 一覧（id / 絵 / 文字）と `findSticker` |
| `src/components/messages/StickerPicker.tsx` | 選ぶ欄と、開くボタン |
| `src/components/messages/MessageSticker.tsx` | 送られてきた1枚（**吹き出しに入れない**） |
| `src/assets/stickers/*.png` | 透過PNG・512×512 |
| `supabase/migrations/20260904010000_message_stickers.sql` | 列・CHECK・`unsend_message` |
| `src/test/chatStickers.test.ts` | 番人（45件） |

### スタンプを1枚増やす手順

1. `src/assets/stickers/<id>.png` を置く（透過PNG・512×512・余白8%・影なし）
2. `src/lib/stickers.ts` の `STICKERS` に1行足す（`text` は絵の文字と同じに）
3. 終わり。**マイグレーションは要らない**

### 本番への適用（2026-09-03 実施済み）

Lovable の `query_database` で適用し、`authenticated` を演じて確認した。

- 列・CHECK・`unsend_message` の書き換えが入っていること
- 変な `sticker_id`（大文字・記号入り）は 23514 で弾かれること
- スタンプ付きで送って `unsend_message` すると、本文もスタンプも落ちること
- 対照: 自分の会話は26件読め、他人同士の会話は0件（RLS を壊していない）

### 残っていること

- ★8枚の残り3枚（ナイス／ちょっと遅れます／ごめんなさい）と、そのあとの8枚
- **英語版**。文字を焼き込んでいるので、日本語以外のお客様には出せない
  （いまは日本語のジムしかいないので後回し）
- ジムごとに違うスタンプを持たせたくなったら、`gym_videos` と同じくテナント別の
  テーブル＋ストレージを足す。**そのときまでは同梱でよい**

## 素材づくりのときに未決だった論点（記録・上の「実装」で決着済み）

- **全ジム共通のスタンプにするか、ジムごとに持たせるか。**
  共通なら1セットを配るだけ。ジムごとなら `gym_videos` と同じくテナント別のテーブルが要る
- **既存の添付（`message_attachments`）に乗せるか、専用の種別を作るか。**
  乗せれば実装は軽いが、「スタンプだけ大きく表示する」「吹き出しの枠を出さない」といった
  見た目の出し分けができない。LINE らしくするなら専用の種別のほうがよい
- **送信UI**（入力欄の横のボタン → グリッドで選ぶ）の置き場所。
  チャットの下端は `--kb` / `--nav-h` で組んであるので、**そこに要素を足すと
  キーボードまわりの計算に影響する**（`mem/features/messaging.md` の3回直した経緯を読むこと）
