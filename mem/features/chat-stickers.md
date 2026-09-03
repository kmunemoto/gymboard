# チャットのスタンプ（LINE風）— 素材づくり

2026-09-03 着手。チャットに LINE のようなスタンプを足す。**まず絵を作る段階**で、
アプリ側の実装はまだ何もしていない。

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

★＝先に作る8枚。**`POSE:` と `Japanese text` の2行だけが各枚の違い。**

### 共通のひな形

```
[キャラの説明文（上のブロックをそのまま）]

POSE: <ポーズ>

Japanese text "<文字>" at the bottom, bold rounded Japanese gothic font
(maru gothic), dark charcoal (#3A3A3A) letters with a thick white outline,
text height about 18% of the canvas, centered, slightly tilted, overlapping the
character slightly.

Style: clean flat vector illustration, thick uniform dark slate outline
(#4A5560), cel-shaded flat colors, no gradients, extremely readable silhouette,
kawaii Japanese sticker art. Transparent background, square canvas, character
and text together fill about 85% of the frame with even margin on all sides.

no watermark, no logo, no frame, no drop shadow, no background, no English text,
no gibberish or malformed characters, single character only.
```

🔴 **`no drop shadow` を消さないこと。** 確定したキャラクターシートの左の1体には
足元に影が付いている。透過スタンプで影が付くと、吹き出しの上に浮いて見える。

### ポーズと文字

| # | | POSE（英語のまま） | Japanese text |
|---|---|---|---|
| 1 | ★ | `bowing politely with both tiny arms at its sides, eyes closed, gentle smile` | `よろしくお願いします` |
| 2 | ★ | `pressing both tiny hands together in front of its chest, eyes closed, warm happy smile, small floating hearts around it` | `ありがとうございます` |
| 3 | ★ | `making a big OK circle with both arms above its head, confident cheerful face` | `了解です！` |
| 4 | ★ | `flexing one arm showing a tiny muscle, determined fired-up expression, a small flame above its head` | `がんばります！` |
| 5 | ★ | `holding out a folded teal towel toward the viewer with both hands, kind gentle smile` | `おつかれさま！` |
| 6 | ★ | `giving a big thumbs up with one arm, winking with one eye, bright smile` | `ナイス！` |
| 7 | ★ | `running fast to the right, arms swinging, panicked wide eyes, sweat drops and motion lines behind it` | `ちょっと遅れます` |
| 8 | ★ | `pressing both hands together apologetically, bowing its head, one large sweat drop, sorry troubled eyebrows` | `ごめんなさい` |
| 9 | | `legs trembling with wobble lines, arms stiff and straight out, strained squeezed-shut eyes, small lightning marks on its legs` | `筋肉痛です…` |
| 10 | | `lying face down on the floor completely flat, arms and legs sprawled out, swirl eyes, a small puff of steam above it` | `もう限界…` |
| 11 | | `jumping in the air with both arms raised, sparkling star eyes, huge open smile, sparkles around it` | `うれしい！` |
| 12 | | `clapping both tiny hands together, impressed sparkling eyes, small sparkles around it` | `すごい！` |
| 13 | | `waving one arm at the viewer while standing next to a small round wall clock, calm happy smile` | `お待ちしてます` |
| 14 | | `holding both hands out gently in a stop gesture, worried caring eyebrows, soft concerned smile` | `無理しないで` |
| 15 | | `raising one arm straight up, curious tilted head, a large question mark floating above its head` | `質問です！` |
| 16 | | `waving goodbye with one arm, cheerful smile, slight head tilt` | `またね！` |

⚠️ 5番のタオルは**手に持つ小道具**。キャラ自身はタオルを着けていない
（着けさせると他の15枚と食い違う）。

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

## まだ決めていないこと（実装に入る前に）

- **全ジム共通のスタンプにするか、ジムごとに持たせるか。**
  共通なら1セットを配るだけ。ジムごとなら `gym_videos` と同じくテナント別のテーブルが要る
- **既存の添付（`message_attachments`）に乗せるか、専用の種別を作るか。**
  乗せれば実装は軽いが、「スタンプだけ大きく表示する」「吹き出しの枠を出さない」といった
  見た目の出し分けができない。LINE らしくするなら専用の種別のほうがよい
- **送信UI**（入力欄の横のボタン → グリッドで選ぶ）の置き場所。
  チャットの下端は `--kb` / `--nav-h` で組んであるので、**そこに要素を足すと
  キーボードまわりの計算に影響する**（`mem/features/messaging.md` の3回直した経緯を読むこと）
