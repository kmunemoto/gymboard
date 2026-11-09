# analyze-meal で使えるモデルについての回答（コード変更なし）

このプロジェクトの AI 利用一覧を 2026-11-09 に読み取りで取得した結果です（workspace_models: included）。何も変更していません。

## 1・2. チャットで使えるモデル ID（いまの呼び出し先 /v1/chat/completions で使えるかどうか）

画像入力は、下の表のモデルすべてが対応しています。

| プロバイダ | モデル ID | chat-completions で使えるか |
|---|---|---|
| Google | google/gemini-2.5-flash（廃止予定） | 使える |
| Google | google/gemini-2.5-flash-lite | 使える |
| Google | google/gemini-2.5-pro | 使える |
| Google | google/gemini-3-flash-preview | 使える（プレビュー版） |
| Google | google/gemini-3.1-pro-preview | 使える（プレビュー版） |
| Google | google/gemini-3.1-flash-lite | 使える |
| Google | google/gemini-3.5-flash / 3.6-flash / 3.7-flash / 3.8-flash | 使える |
| Google | google/gemini-4-argon | 使える |
| OpenAI | openai/gpt-5, gpt-5-mini, gpt-5-nano, gpt-5.2, gpt-5.4, gpt-5.4-mini, gpt-5.4-nano, gpt-5.5, gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-6-astra, gpt-6-luna, gpt-6-sol, gpt-6.1-sol, gpt-6.1-terra, chat-latest | 使える（responses でも使える） |
| OpenAI | openai/gpt-5.4-pro, openai/gpt-5.5-pro | 使えない（responses 専用） |
| Anthropic | anthropic/claude-opus-5-5, claude-opus-5, claude-sonnet-5, claude-fable-5-1, claude-haiku-4-5 | 使えない（messages 専用） |

画像生成・音声・埋め込み・動画用のモデル（gemini-*-image、gpt-image-*、tts、transcribe、veo など）は、料理の判定には使えないので表から外しました。

## 3. 画像の理解と推論の精度が一番高いもの

一覧にはベンチマークが載っていないので、どれが一番かは確定できません。一覧の説明文から読み取れる、最上位クラスの候補は次のとおりです。

- **google/gemini-4-argon**：正式版（廃止予定なし）。説明文は「Frontier Gemini model」。いまのコードの URL と書き方のまま、model の文字列を変えるだけで使えます。いちばん手軽な最上位の候補です。
- **openai/gpt-6-astra**：正式版。このワークスペースのチャットの既定モデルで、OpenAI の最上位にあたります（gpt-6.1-sol の説明文が「Near-Astra」なので、それより上）。chat-completions でも使えます。
- **anthropic/claude-opus-5-5**：正式版。ただし、呼び出し先を messages に変える必要があります。

本当に精度を確かめるなら、同じ食事写真を何枚か使って、上の3つを比べるのが確実です。

## 4. Claude は使えますか

使えます。この5つが一覧に出ていて、このワークスペースのデータ保持の設定でも messages での利用が許可されています: claude-opus-5-5, claude-opus-5, claude-sonnet-5, claude-fable-5-1, claude-haiku-4-5。
条件があります。Claude は messages（Anthropic 形式）専用なので、いまの /v1/chat/completions の呼び出しのままでは使えません。呼び出し先とリクエストの形を変える必要があります。

## 5. 推論の深さの指定

今回は確かめられていません。一覧からは、パラメータの正確な書き方が読み取れませんでした。SDK の型定義も手元で開けなかったので、書き方を推測でお伝えするのは控えます。実装するときに、SDK が生成するモデルごとの型を見て、正確な項目名を確定させます。

## 6. google/gemini-2.5-flash は今も使えますか

いまは使えますが、**廃止予定（deprecated: true）**です。廃止日は 1792454400 で、これは **2026-10-20** にあたり、**もう過ぎています**。一覧にはまだ残っていますが、いつ使えなくなってもおかしくない状態です。早めに切り替えることをおすすめします。
同じ系統の後継で、正式版のものは google/gemini-3.8-flash です。精度を最優先するなら、上の gemini-4-argon です。
