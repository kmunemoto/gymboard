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

---

## ⚠️ デプロイを頼むと、Lovable が main に直接 push することがある（2026-09-24）

`push-period-reminder` の再デプロイを頼んだら、デプロイ自体は済んだが、Lovable が
**`src/integrations/supabase/types.ts` を本番のスキーマから作り直して main に2コミット push した**
（`Work in progress` / `Lovable update`。CI を通らずに main へ入る）。
中身は正しかった（9/5 に落としたゲーム要素の49テーブルが型から消えた）が、
`schemaDrift.test.ts` のパーサが `DROP TABLE a, b, …;`（1文で複数）の先頭しか読んでおらず、
**main の `npm test` が赤になった**。パーサを直して解消。

- 頼んだあとは **`git fetch origin main` で Lovable のコミットが無いか見る**。あればゲート4つを回す
- ついでに頼んでいない調査（プレビューの白画面など）をして 4.3 クレジット使っていた。
  依頼文には「デプロイだけ」と書いてあっても、こうなることがある

**2026-10-27 にもう一度起きた**（`push-announcements` の再デプロイ）。Lovable の返事は
「コードの編集やほかファイルの変更はしていません」だったが、main に2コミット入っていた:

- `types.ts`: 本番のスキーマから作り直し（関数の型が足されただけ。正しい）
- `previewAuthStorage.ts`: 先頭に「自動生成」とある Lovable の雛形の更新（Lovable のプレビュー画面で
  ログインを共有する仕組み）。プレビュー（`id-preview--<uuid>` 等）の中で枠に入っているときだけ使われ、
  本番の Web・ネイティブは今まで通り localStorage。手で戻さない（戻しても次の同期で上書きされる）

**返事の「変更していません」は根拠にならない。** 必ず `git fetch origin main` で見る。

---

## 既にある関数を更新したときの確かめ方（2026-10-27）

**404 かどうかでは確かめられない。** 関数は前からあるので、古いコードのままでも 404 にはならない
（Lovable の確認も「403 でした」だった。これは関数があることしか示さない）。

**新しいコードと古いコードで返事が変わる呼び方を1回だけする。** 誰にも害が無い形にすること。

`push-announcements`（配信対象に `except` / `only` を足したとき）の例:

1. 実在しない2人（`gen_random_uuid()`）だけを宛先にした `only` のお知らせを1件、
   宛先2行と一緒に入れ、同じトランザクションで `net.http_post`（`x-cron-secret` は vault の
   `cron_secret`。cron と同じ呼び方）。pg_net はコミット後に送るので、行が見えてから呼ばれる
2. `net._http_response` の中身を読む:
   - 新しいコード → `{"recipients":2}`（選んだ人の数）
   - 古いコード → `{"recipients":1}`（`target` の文字列 `only` を1人の user_id として扱う）
3. 試しのお知らせを消す（宛先は外部キーで一緒に消える）

実在しない人なので通知はどこにも届かない。定期実行（10分おき）に先に拾われると返事が読めないので、
cron の直後に行う。

### 返事が変わらないときは、DB の実行記録（pg_stat_statements）で見る（2026-10-28）

新旧で返事が同じになる変更（例: 宛先の絞り込みに `.neq("staff_access", "limited")` を足しただけ）は、
**新しいコードだけが投げる形のクエリ**が `extensions.pg_stat_statements` に現れるかで確かめる。
PostgREST が組み立てた SQL がそのまま（値は `$1` に置き換わって）記録される。読み取りだけで、誰にも何も届かない。

```sql
-- 例: notify-new-booking が予約を読む select に staff_user_id を足したとき
SELECT
  coalesce(sum(calls) FILTER (WHERE query LIKE '%"public"."bookings"."option_minutes", "public"."bookings"."staff_user_id" FROM "public"."bookings"%'), 0) AS new_shape,
  coalesce(sum(calls) FILTER (WHERE query LIKE '%"public"."bookings"."option_minutes" FROM "public"."bookings"%'), 0) AS old_shape
FROM extensions.pg_stat_statements;
```

1. デプロイ前に数を控える（新しい形は 0 のはず）
2. 害の無い呼び方で1回叩く。notify-new-booking なら実在しない `booking_id`（`gen_random_uuid()`）を
   `net.http_post` で渡す → 予約を読む select だけ走って `{"skipped":"booking_not_found"}` で終わる
3. 新しい形が 0 → 1 になり、古い形が増えていなければ新しいコード

2026-10-28 のインストラクター対応ではこれで notify-new-booking を確かめた（新しい形 0→1、古い形 172 のまま）。
害の無い呼び方が無い関数（体験予約・毎日のまとめ）は、本番で自然に動いたあとに同じ数え方で見られる
（宛先の絞り込みなら `"tenant_members"."staff_access" <> ` を含む形）。
