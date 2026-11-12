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

## 4つのモデルを比べた結果と判断（2026-11-12）

宗本さん「gemini 以外の AI ある？」→「試してみる」→ 結果を見て **「Gemini のまま」と決めた**（変える決め手が無い）。

試し方: Lovable のエージェントのサンドボックスで、analyze-meal と同じ2段の聞き方（1段目・2段目の文面とパラメータはそのまま、
変えたのはモデル名だけ。Claude は messages の形）。Wikimedia Commons の公開写真5枚 × 4モデル × 2回。お客様の写真は使っていない。
アプリの待ち時間（50秒・40秒）と予備への聞き直しは通していない。

写真: A 旅館の和朝食（Breakfast at Tamahan Ryokan, Kyoto）／B 吉野家の牛丼（Gyudon @ Yoshinoya @ Shimbashi）／
C ビッグマック（Big Mac hamburger）／D 醤油ラーメン（Shoyu Ramen）／E 骨付き鶏・長粒米・ブロッコリー・さつまいもの皿
（鶏むね肉の写真が無く代用。ファイル名は "Healthy low-fat chicken, rice, broccoli, and sweet potato plate"）

| | gemini-4-argon（採用中） | gpt-6-astra | claude-fable-5-1 | claude-opus-5-5 |
|---|---|---|---|---|
| 成功 | 10/10 | 10/10 | 10/10 | 10/10 |
| B 牛丼（目安 633kcal・第三者DB） | 730・674 | 1020・1089 | 780・740 | 736・722 |
| C ビッグマック（目安 525kcal・日本） | 546・530 | 660・617 | 546・560 | 626・607 |
| 2回の差の平均（5枚） | 50kcal | 60kcal | 37kcal | 28kcal |
| 平均秒数（1段目＋2段目） | 20.7 | 50.3（2段目が最大 65.8） | 29.3（2段目が最大 37.1） | 28.6（2段目が最大 35.4） |
| E のオレンジ色の輪切り | にんじん | にんじん | にんじん | **さつまいも**（正しい） |

- gpt-6-astra は向かない: アプリの2段目の待ち時間（40秒）を超える回がある・牛丼を 1,000kcal 超と見積もる・
  アドバイス欄の書き出しが「〜と仮定した推計です」と計算の前提の説明になる。
- gemini-4-argon: 一番速く、チェーン店の公表値に一番近い（ビッグマックは PFC もほぼ公表値どおり）。料理の分け方は粗め
  （ラーメンを1品で見る）で、手作りの皿は量を少なめに読む（E が 341〜408kcal、ほかは 450〜704kcal）。
- claude-opus-5-5: 2回の差が一番小さく、料理の見分けも一番細かい（ラーメンの具まで分ける・さつまいもを当てた）。
  数字は多めに出る（2段目の指示「自信がない場合は少し多めに」どおり）。品数の多い和定食では2段目が 35秒前後で、
  アプリの待ち時間（40秒）に近い。使うなら呼び出しを messages の形に作り替え、待ち時間の配分も見直す必要がある。
- 写真1種類につき2回だけなので、正確さの順位までは決められない。決めるなら、店で用意して量を量った食事の写真で比べる
  （お客様の写真は使わない）。

## 確かめ方

- デプロイ: 応答の `x-gymboard-build` が `2026-11-09-gemini-4-argon` か（Edge Function は push でも Publish でも出ない。
  `mem/ops/edge-function-deploy.md`）
- どちらのモデルが答えたか: 成功時の応答に `models: { dishes, nutrition }`、Edge Function のログに
  `[analyze-meal] models stage1=… stage2=…`。予備に落ちたときは `[analyze-meal] stageN: …で聞き直します`
- 見張り: `src/test/mealAiModel.test.ts`
