# analyze-meal で使えるモデルについての回答（コード変更なし）

## 追記：試し呼び出しの結果（2026-11-09）

- 使った写真: https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Breakfast_at_Tamahan_Ryokan%2C_Kyoto.jpg/1920px-Breakfast_at_Tamahan_Ryokan%2C_Kyoto.jpg （元のページは https://commons.wikimedia.org/wiki/File:Breakfast_at_Tamahan_Ryokan,_Kyoto.jpg 。京都の旅館の和朝食です）
- 送り方: analyze-meal の1段目と同じ形にしました。system の指示に加えて、user に写真（image_url、detail: high）と文章を入れて /v1/chat/completions に送っています。プロジェクトのファイルは一切変えていません。

| モデル | 結果 | かかった時間 | 料理の数 |
|---|---|---|---|
| google/gemini-4-argon | 200（成功） | 7.5秒 | 8品。JSON だけで返ってきた |
| google/gemini-3.8-flash | 200（成功） | 8.9秒 | 10品。JSON の前後に ```json という囲みが付いていた |
| google/gemini-4-argon ＋ "reasoning_effort": "high" | 200（受け付けられた。400 にはならなかった） | 26.6秒 | 6品。お茶を料理に入れず、汁物も返ってこなかった |

返ってきた JSON（そのまま）:

gemini-4-argon:
```
{"dishes":[{"name":"サバの塩焼き","weight_g":65,"ingredients":["サバ","大根","塩"]},{"name":"だし巻き卵","weight_g":75,"ingredients":["卵","だし汁","大根","みりん","醤油"]},{"name":"白米","weight_g":130,"ingredients":["白米"]},{"name":"漬物盛り合わせ","weight_g":30,"ingredients":["きゅうり","大根","奈良漬"]},{"name":"ほうれん草のおひたし","weight_g":45,"ingredients":["ほうれん草","かつお節","醤油","だし汁"]},{"name":"湯豆腐","weight_g":250,"ingredients":["豆腐","生麩","昆布","かつお節","ねぎ","ポン酢"]},{"name":"味噌汁","weight_g":150,"ingredients":["だし汁","味噌","わかめ","豆腐"]},{"name":"ほうじ茶","weight_g":120,"ingredients":["ほうじ茶"]}]}
```

gemini-3.8-flash（実際の返事は ```json の囲み付きで、改行も入っていました。ここでは中身を1行に詰めています）:
```
{"dishes":[{"name":"ご飯","weight_g":130,"ingredients":["精白米"]},{"name":"味噌汁","weight_g":160,"ingredients":["だし汁","味噌","わかめ","ねぎ"]},{"name":"鯖の塩焼き","weight_g":70,"ingredients":["鯖","塩","大根"]},{"name":"だし巻き卵","weight_g":80,"ingredients":["鶏卵","だし汁","薄口醤油","みりん","大根"]},{"name":"湯豆腐","weight_g":200,"ingredients":["木綿豆腐","昆布だし","生麩","木の芽"]},{"name":"ほうれん草のお浸し","weight_g":45,"ingredients":["ほうれん草","かつお節","だし汁","醤油"]},{"name":"漬物盛り合わせ","weight_g":30,"ingredients":["きゅうり","大根","赤かぶ","塩"]},{"name":"湯豆腐の薬味","weight_g":10,"ingredients":["長ねぎ","かつお節"]},{"name":"湯豆腐のタレ","weight_g":40,"ingredients":["醤油","みりん","だし汁"]},{"name":"ほうじ茶","weight_g":100,"ingredients":["茶葉","水"]}]}
```

gemini-4-argon（reasoning_effort: high）:
```
{"dishes":[{"name":"湯豆腐","weight_g":200,"ingredients":["豆腐","生麩","かつお節","ねぎ","醤油","みりん","昆布だし"]},{"name":"だし巻き卵","weight_g":80,"ingredients":["卵","大根","だし","醤油","みりん"]},{"name":"鯖の塩焼き","weight_g":60,"ingredients":["鯖","大根","塩"]},{"name":"ご飯","weight_g":130,"ingredients":["白米"]},{"name":"ほうれん草のお浸し","weight_g":40,"ingredients":["ほうれん草","かつお節","醤油"]},{"name":"漬物盛り合わせ","weight_g":30,"ingredients":["きゅうり","大根","ごぼう"]}]}
```

分かったこと: gemini-4-argon は、いまの呼び方のまま model の文字列を変えるだけで動きます。"reasoning_effort": "high" も受け付けられました。ただし時間は約3.5倍かかり、この写真1枚では料理の拾い方が増えるどころか減りました。写真1枚・各1回だけの試しなので、精度の優劣までは言えません。

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
