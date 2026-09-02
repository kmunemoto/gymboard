# Edge Function を本番へデプロイする（2026-08-12）

## 結論だけ先に

**GitHub に push しても、Lovable で Publish しても、新しい Edge Function は本番に出ない。**
**Lovable のエージェントに「デプロイして」と頼むのが唯一の経路。**

そして**デプロイできたかどうかは、叩いて 404 かどうかで確かめる**。
「Publish した」「緑だった」は根拠にならない。

---

## 何が起きたか

2026-08-11 に `notify-new-message` を追加した。PR は通り、main にマージされ、
Lovable にも同期され、宗本さんが Publish もした。**それでも本番には無かった。**

```
POST /functions/v1/notify-new-message   → 404 {"code":"NOT_FOUND"}
POST /functions/v1/send-push-notification → 401   ← 対照。デプロイ済みの関数
POST /functions/v1/line-login-callback    → 405   ← 対照。デプロイ済みの関数
```

`mcp__Lovable__read_file` で見ると **ファイルは Lovable のプロジェクト内に存在していた**。
つまり「コードは届いている／関数は動いていない」という状態。

同じタイミングでクライアント側の通知送信を外していたため、
**本番のチャット通知が数時間まるごと止まった**。エラーはどこにも出ない。

### なぜ気づきにくいか

- `git log` では直っているように見える（マージ済み）
- Lovable の画面でもファイルは見える
- DBトリガーは EXCEPTION を握りつぶすので、メッセージの INSERT は成功する
- 誰も「通知が来ない」と言わない（来ないことに気づけない）

---

## 正しい手順

### 1. デプロイを依頼する

```
mcp__Lovable__send_message(project_id = 69ac2641-45d8-44e0-b60d-4e002a4f9c1c,
  message = "supabase/functions/<関数名> を Supabase にデプロイしてください。
             コードは既にリポジトリにあります。編集は不要です。")
```

エージェント側は `supabase--deploy_edge_functions` を持っている。
**「コードは変更しないでください」と明記する**こと（頼まないと直しにかかる）。

> 🔴 依頼文に秘密情報を書かない。Lovable は依頼文をそのままコミットメッセージにして
> push する（2026-08-08 に Apple のクライアントシークレットを公開した）。CLAUDE.md 参照。

### 2. 本当に届いたか、自分で確かめる

コンテナから `*.supabase.co` へ直接 curl はできない（プロキシが CONNECT を 403）。
**DB から pg_net で叩く。**

```sql
SELECT net.http_post(
  url := 'https://rrbfwitprzuevzytykrq.supabase.co/functions/v1/<関数名>',
  headers := '{"Content-Type":"application/json"}'::jsonb,
  body := '{}'::jsonb
);
-- 返ってきた id で:
SELECT id, status_code, left(content, 200) FROM net._http_response WHERE id = <id>;
```

判定は **404 かどうかだけ**:

| 応答 | 意味 |
|---|---|
| `404 {"code":"NOT_FOUND"}` | **未デプロイ** |
| 401 / 403 / 405 / 400 など | デプロイ済み（関数自身が動いて拒否している） |

**必ず対照を1本同時に叩く。** デプロイ済みと分かっている関数
（`send-push-notification` など）が 404 以外を返すことを見て、
初めて「プローブが正しく動いている」と言える。

---

## deploy-functions.yml は削除した

`.github/workflows/deploy-functions.yml` は 2026-08-12 に削除した。

```
#1 〜 #18（2026-07-01 〜 2026-08-12）
  Deploy ステップ = すべて skipped
  conclusion      = すべて success
```

**6週間、一度もデプロイしていなかった。** `SUPABASE_ACCESS_TOKEN` が無いとき
「失敗にせずスキップ」する作りだったため、ずっと緑だった。

そして**そのトークンは用意できない**。ジムボードの Supabase プロジェクト
（`rrbfwitprzuevzytykrq`）は **Lovable Cloud の持ち物**で、宗本さんの Supabase
アカウントには存在しない（`list_projects` に出るのは `clsvdhovzqrkojvkvekw` と
`endcqzewujdvimdlazhj` の2つだけ）。アカウントに紐づくアクセストークンは発行しようがない。
**直しようがないワークフローだった。**

### 実害

`mem/ops/tenant-boundary.md` に

> #246 は Edge Function なので `deploy-functions.yml` が main へのマージで
> 自動デプロイした（成功を確認済み）

と書き残していたが、その実行（#14 / 2026-08-03）も **skipped** だった。
**緑を見て「デプロイされた」と記録に残してしまった。** 記録のほうが間違っていた。

兄弟アプリも全部 Lovable なので、同じファイルを持っているなら同じく効いていない。

---

## 同じ型の壊れ方（この3つは同じ日に踏んだ）

| | 成功に見えるもの | 実際 |
|---|---|---|
| `xcrun altool` | 終了コード 0 | 標準出力に `UPLOAD FAILED`。届いていない |
| `npm test` | `Tests 1115 passed` | `Errors 6 errors` で **exit 1** |
| `deploy-functions.yml` | conclusion: success | Deploy ステップは skipped |

**共通するのは「成功マーカーが、確かめたいこととずれている」こと。**
確かめたいのは「届いたか」なのに、見ているのは「コマンドが終わったか」。

対策は1つだけ: **成功マーカーではなく、結果そのものを見にいく。**
IPA なら App Store Connect のビルド一覧、テストなら `echo "exit=$?"`、
Edge Function なら叩いて 404 かどうか。


---

## メールテンプレートを足したときの確認（2026-09-03）

**テンプレートは Edge Function のバンドルに入る。** つまり
`_shared/transactional-email-templates/` にファイルを足して `registry.ts` に登録しても、
**`send-transactional-email` と `preview-transactional-email` を再デプロイするまで
本番には出ない。** マージだけでは出ない（上と同じ理由）。

出ていないときの見え方が厄介で、**404 にはならない**。関数はあるので 200 系の経路に入り、
テンプレート探索で `Template '<名前>' not found. Available: ...` を返す。
呼び出し側は fire-and-forget なので**画面には何も出ない**。プッシュは出る、メールだけ来ない。

### 🔴 この関数は pg_net から叩けない（確認方法が他と違う）

`push-announcements` などは `x-cron-secret` を受けるので DB から叩けるが、
**`send-transactional-email` は `verifyCaller` しか見ない**。つまり
service_role キー**そのもの**（Edge Function ランタイムの環境変数と文字列一致）か、
本物のユーザー JWT が要る。

vault の `email_queue_service_role_key` では**通らない**。正規のキーではあるが
ランタイムの環境変数と同じ文字列とは限らないため（20260812040000 に既出。
2026-09-03 に再確認し、`{"error":"Unauthorized"}` の 401 になった）。

### 確認のしかた

**存在しないテンプレート名で1回叩き、`Available:` の一覧を読む。**
宛先を書かなければメールは送られない（テンプレート探索は宛先解決より前）。

```
{"templateName":"zzz-probe-not-a-real-template"}
→ 404 Template '...' not found. Available: <ここに一覧>
```

service_role で叩ける環境が要るので、セッションからは
**Lovable のエージェントに「この本文で1回叩いて、返ってきた一覧を貼って」と頼む**のが早い。
「デプロイしました」「401 でした（404 ではない）」は**根拠にならない**——
401 は関数の存在を示すだけで、**新しいテンプレートが入ったかは何も示さない。**

### 実際にやってみた記録（2026-09-03、booking-option-changed）

上の手順どおり `send-transactional-email` を service_role で叩くよう Lovable に頼んだが、
**Lovable のサンドボックス環境が持つ `SUPABASE_SERVICE_ROLE_KEY` と、デプロイ済み
Edge Function のランタイムが持つ値が一致せず、401 になった**（署名鍵の移行後、
サンドボックス側が古い値を持っていた模様）。つまり「service_role で叩ける環境」の
**内側**にいたはずの Lovable でもこれが起きた——service_role が使える環境は
思ったより狭い、ということ。

Lovable が自分で見つけた代替経路: **`preview-transactional-email`** も同じ
`registry.ts` を import しており、`LOVABLE_API_KEY`（Lovable のサンドボックスが
持っている）で認証できる。これを呼んでテンプレート名の一覧を取得し、
`booking-option-changed` が含まれることを確認した。

```
new-booking-notification, booking-confirmation, trial-booking-confirmation,
drop-in-booking-confirmation, booking-cancellation, booking-option-changed,
new-account-notification, trial-booking-reminder, booking-reminder, customer-invite
```

これで確認になるのは、**2つの関数を1回の `deploy_edge_functions` 呼び出しで
同時にデプロイした**（同じソースツリーから同時にビルドされた）から。
別々にデプロイした場合は、片方が更新されもう片方が古いままという状態が
理屈のうえではありうるので、この代替は「2つを同時にデプロイした」という前提とセット。

**次にやるときの近道:** 最初から `send-transactional-email` を直接叩こうとせず、
`preview-transactional-email` を `LOVABLE_API_KEY` で叩いて一覧を見てもらうほうが早い
（`send-transactional-email` 側の service_role 認証は、Lovable のサンドボックスからも
通らないことがある）。
