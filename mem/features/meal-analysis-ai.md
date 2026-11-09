# 食事の写真の AI 分析（analyze-meal）のモデル（2026-11-09）

宗本さん「アプリの食事管理の AI の精度、一番賢いまで上げて」。

## いまの形

- `supabase/functions/analyze-meal/index.ts` が Lovable AI Gateway（`https://ai.gateway.lovable.dev/v1/chat/completions`・`LOVABLE_API_KEY`）を2回呼ぶ
  1. 写真 → 料理の特定（料理名・グラム・食材の JSON）
  2. 料理の一覧 → 栄養の計算とアドバイス（JSON）
- モデルは `supabase/functions/_shared/mealAiModel.ts`
  - 主: **`google/gemini-4-argon`**（Gateway の一覧で Google の最上位 "Frontier Gemini model"・正式版・廃止予定なし）
  - 予備: `google/gemini-3.8-flash`（主が失敗・時間切れ・読めない答えのときだけ1回聞き直す）
  - 429（混雑）・402（クレジット不足）は予備でも同じなので聞き直さない（画面は今まで通りの案内）
  - 時間切れ: 1段目 主50秒＋予備25秒、2段目 主40秒＋予備25秒（Edge Function の約150秒に収まる。最悪140秒）
- 以前は `google/gemini-2.5-flash`（速さ重視）。**廃止予定で、廃止日 2026-10-20 を過ぎていた**（2026-11-09 時点ではまだ動いていた）

## 選んだ理由と、選ばなかったもの

Gateway で使えるモデルは、2026-11-09 に Lovable のエージェントに `listModels()`（`@lovable.dev/ai-gateway`）で読んでもらった
（docs.lovable.dev はこのコンテナのネットワークから開けない）。最上位クラスは3つ:

| モデル | 呼び方 | メモ |
|---|---|---|
| `google/gemini-4-argon` | chat/completions（今のまま） | **採用** |
| `openai/gpt-6-astra` | chat/completions | OpenAI の最上位。ワークスペースのチャットの既定 |
| `anthropic/claude-fable-5-1`（Claude の最上位）・`claude-opus-5-5` | **messages 専用** | 呼び方を変える必要がある |

食事の写真でどれが一番かを比べた公表データは無い。今の呼び方のまま差し替えられる Google の最上位を選んだ。
比べたくなったら、同じ写真（お客様の写真は使わない）で3つを並べて試すこと。

## 試しの結果（2026-11-09・Lovable のエージェントのサンドボックス）

公開されている和朝食の写真（Wikimedia Commons「Breakfast at Tamahan Ryokan, Kyoto」）を、1段目と同じ形で送った:

| モデル | 結果 | 時間 | 料理 |
|---|---|---|---|
| gemini-4-argon | 200 | 7.5秒 | 8品（JSON だけ） |
| gemini-3.8-flash | 200 | 8.9秒 | 10品（薬味・タレも別の品に。JSON は ```json の囲み付き） |
| gemini-4-argon ＋ `reasoning_effort: "high"` | 200（受け付けた） | 26.6秒 | 6品（味噌汁を落とした） |

→ `reasoning_effort` は付けない。写真1枚・各1回なので、精度の優劣までは言えない。

## 確かめ方

- デプロイ: 応答の `x-gymboard-build` が `2026-11-09-gemini-4-argon` か（Edge Function は push でも Publish でも出ない。
  `mem/ops/edge-function-deploy.md`）
- どちらのモデルが答えたか: 成功時の応答に `models: { dishes, nutrition }`、Edge Function のログに
  `[analyze-meal] models stage1=… stage2=…`。予備に落ちたときは `[analyze-meal] stageN: …で聞き直します`
- 見張り: `src/test/mealAiModel.test.ts`
