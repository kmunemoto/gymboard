# 姿勢分析を i18n から引く（2026-08-06 / ピラボード指摘 C・D・E）

## 3件は独立していない。**D と E はセットで直す**

```
E  postureAnalysis.ts が文言（category / message / exercises）を直書き
D  TrainingRecommendationCard が **日本語のカテゴリ名を照合キー**にして推奨種目を引く
C  DiagnosisHistorySection が推奨種目の**日本語の直書きコピー**を持つ
```

**E だけ先に i18n 化すると、その瞬間に D が壊れる。**
業種オーバーレイで文言を差し替えた途端に照合が外れ、
**エラーも出ないまま推奨だけが消える。**

だから **D（`categoryKey` の導入）を先に入れてから E を i18n 化**した。

## なぜ直すのか（ジムボード本体では問題にならない）

**業種フォークで、器具が要る種目がそのままお客様に出る。**
「ルーマニアンデッドリフト」「フェイスプル」「シュラッグ」はバーベル・ケーブルが要る。
ピラティススタジオや整骨院には無い。

**語彙オーバーレイはロケールに載っている文言しか差し替えられない**ので、
エンジンに直書きされていると届かない。

## 直した形

`PostureFeedback` は**文言を持たず、キーだけを返す。**

```ts
export type PostureCategoryKey =
  | "forwardHead" | "shoulderTilt" | "roundedBack"
  | "pelvicTilt" | "legAlignment" | "weightShift" | "overall";

export type PostureFeedback = {
  type: "good" | "warning";
  severity: PostureFeedbackSeverity;
  categoryKey: PostureCategoryKey;   // 翻訳しない。照合はこれで行う
  messageKey: string;                 // posture.analysis.messages.*
  sideKey?: PostureSideKey;           // {{side}} に入れる語
  exerciseKeys?: string[];            // posture.analysis.exercises.*
};
```

翻訳は表示側（`PostureFeedbackCard` / `TrainingRecommendationCard`）で行う。
**エンジンが純粋な計算に戻るので、文言の差し替えがコードに影響しない。**

ロケールに追加したもの（5言語）:
`posture.analysis.categories`(7) / `messages`(18) / `exercises`(17) / `sides`(4)

### 保存データへの影響は無い

`analyzePosture` の結果は**描画時計算で DB に保存していない**
（保存は `skeletal_type` / `scores` / `metrics`）。型を変えても既存データに影響しない。

## 🟢 制約が1つ消えた

`src/test/verticalPresets.test.ts` に
**「姿勢分析の area は上流と同じ文字列のまま」**という検査があった。
照合キーが表示文字列だったので、**業種オーバーレイで `area` を変えると壊れた**。
その事故を防ぐための制約だった。

**照合を `categoryKey` に移したので、この制約は不要になった。**
プリセットは `area` を自由に業種の言葉にしてよい。

**検査を消すだけでなく、制約が消えた経緯をその場に残した。**
次に「area を変えたら壊れるのでは」と思った人が辿れるように。

## 途中で見つけたもの

`src/test/regulatedFeatureGates.test.tsx` の fixture が
`{ ... } as PostureFeedback` と**キャスト**していた。
欠けたフィールドを黙らせるので、**型を変えても気づけない。**
キャストを外した。**テストの fixture にキャストを付けない。**

## 検査（`src/test/postureI18n.test.ts`）

変異5種で確認済み（すべて赤）:

| 変異 | 結果 |
|---|---|
| エンジンに日本語の message を戻す | 赤 2件 |
| 照合キーを日本語に戻す | 赤 1件 |
| ロケールの messages を1つ消す | 赤 1件 |
| ロケールの exercises を1つ消す | 赤 1件 |
| 直書きの種目を戻す | 赤 1件 |

`{{side}}` を使うメッセージにエンジンが `sideKey` を渡しているか、も見ている
（渡し忘れると**空欄で表示される**）。

## 兄弟アプリへの注意（ピラボードより）

**業種語の機械置換は言語ごとに別のリストが要る。**

- 韓国語の「짐」は1文字で**「荷物」**の意味にもなる。素朴に置換すると
  「片側だけで**スタジオ**を持つ癖」という非文になる
- 韓国語の**助詞は直前の語の終わりで形が変わる**（`을/를`・`은/는`・`이/가`）。
  「짐을」→「스튜디오를」にしないと不自然
- 中国語の「教练／教練」は**残す**判断でよい。中国語圏のピラティススタジオでも
  指導者は「教练」が標準語で、「健身房」のようにジムを指す語ではない

**どちらも「業種語が残っていないか」の検査では捕まらない**（置換後には残っていない）。
専用の検査が要る。
