# 通知の送信履歴を店に見せる（2026-08-26）

ジム設定 → メール・通知 の先頭。ロードマップのフェーズ1-⑤（前半）。

## 直した困りごと

お客様から「予約のメールが来ていない」と言われたとき、**店は何も確認できなかった**。

- `email_send_log` のポリシーは3本とも `auth.role() = 'service_role'`
- しかも**どのジムの通知かを持っていなかった**

結果、届いたのか・配信停止で止まったのか・そもそも送っていないのかが、
こちらに問い合わせないと分からない状態だった。実際 2026-08-09 の
「ソーシャルログインが戻ってこない」も、2026-08-21 の「店宛通知が消える」も、
店側からは沈黙にしか見えていない。

## やったこと

1. `email_send_log.tenant_id` を足す
2. そのジムのスタッフが**自分のぶんだけ読める** SELECT ポリシーを足す
3. 送る側 7 箇所すべてから `tenantId` を渡す
4. 過去ぶんは宛先メールから引き当ててバックフィル
5. 履歴の画面（`TrainerEmailLog`）

## 🔴 落とし穴 3 つ

### 1. `sent` を書くのは別の関数

送信結果（`sent` / `failed` / `dlq` / `rate_limited`）を書くのは
`send-transactional-email` ではなく **`process-email-queue`**。
あちらは pgmq の payload しか持たないので、`enqueue_email` の payload に
`tenant_id` を載せて渡さないと、**一番肝心な「送れた」行だけ tenant_id が空**になる。

見張り: キューの INSERT 4 箇所すべてに `tenant_id` があること＋
enqueue の payload に `tenant_id: tenantId` があること。

### 2. 公開済みのネイティブアプリは `tenantId` を送ってこない

端末に配られたクライアントは書き換えられない。予約キャンセルの通知は
クライアント発（`useBookings.ts`）なので、補わないとその通知だけ履歴に出ない。

`templateData.resolveUserId` / `trainerUserId` からその人の在籍ジムを引く
フォールバックをサーバー側に置いた。**2 つ以上のジムに在籍している人は
決められないので引き当てない**（NULL のまま）。

### 3. `tenant_id` が NULL の行を見せてはいけない

認証メール（新規登録・パスワード再設定）はジムに属さないので NULL になる。
ポリシーを `OR tenant_id IS NULL` のように緩めると、
**全ジムの認証メールの宛先アドレスが全スタッフに見える**。

`tenant_id IS NOT NULL AND has_tenant_role(...)` の AND を崩さないこと。
バックフィルも同じ理由で、複数ジムに在籍している人の行は埋めない
（`HAVING count(DISTINCT tm.tenant_id) = 1`）。

## 画面で決めたこと

- **1 通ぶんを 1 行に畳む。** 1 通は `pending → sent`（失敗すると `failed` ×N → `dlq`）
  と複数行を残すので、畳まないと「20 件送ったのに履歴が 60 行」になって読めない。
  宛先＋種別＋日付が同じ行のうち**一番新しいもの**だけを残し、畳んだ数を「◯回試行」で出す
- **🔴 読み込み失敗を「履歴なし」と混同しない。** 取り違えると
  「送っていない」と誤解して二重に送る。エラーは赤い帯で明示する
- **🔴 知らない状態を「届いた」と言わない。** DB 側が先に状態を増やすことがあるので、
  未知の値は warn（灰色）に倒す。`ok` は `sent` だけ
- 失敗の理由（`error_message`）は隠さない。店が動く材料になる
- 認証メールがここに出ないことは、画面の下に注記で書く

## 状態の見え方

| 状態 | 意味 | 色 |
|---|---|---|
| `sent` | 届いた | 緑 |
| `bounced` / `failed` / `dlq` / `rejected` | 届いていない。店が動く必要あり | 赤 |
| `pending` / `suppressed` / `duplicate` / `rate_limited` | 途中、または意図的に止めた | 灰 |

## 変異検証

| 変異 | 落ちた |
|---|---|
| `sent` の行から `tenant_id` を落とす | ok |
| ポリシーを `OR tenant_id IS NULL` に緩める | ok |
| 未知の状態を `ok` に倒す | ok |
| 取得の `tenant_id` 絞りを外す | ok |

## 本番適用の結果（2026-08-26）

| | 件数 |
|---|---|
| 履歴の総数 | 3392（2026-05-21 〜） |
| バックフィルで埋まった | **3369（99.3%）** |
| NULL のまま | 23 |

NULL のまま残るのは、認証メール（signup 6）・運営宛フィードバック（4）・
system（1）・退会済みの人の古い行（12）で、**いずれも NULL が正しい**。

### 🔴 `min(uuid)` は存在しない

引き当ての SELECT で `min(tm.tenant_id)` を使っていたら 42883 で落ちた。
1件だけなのは `HAVING` が保証しているので `(array_agg(DISTINCT ...))[1]` にした。
`delete_my_gym` も同じ書き方をしている（そちらは元からこの形だった）。

### 体験のお客様は別経路で引く

体験客はアカウントを持たないので `auth.users` からは引き当たらない。
本番では未紐づけ69行のうち**46行がこれ**だった。店が一番追いかけたい相手なので、
`trial_bookings.guest_contact` から引く UPDATE を足した。

### 権限の実測（BEGIN…ROLLBACK）

| 演じた相手 | 見えた件数 |
|---|---|
| Salute のオーナー | **2719**（自ジムのみ。うち sent 1307 / 問題 39） |
| 他ジムの行 | **0** |
| `tenant_id` が NULL の行（認証メール） | **0** |
| そのジムのお客様 | **0** |
| 未ログイン（anon） | **0** |

⚠️ 実データで**問題39件**（failed / bounced / dlq / rejected）が出た。
これまで店からは1件も見えていなかったもの。

## デプロイと実トラフィックでの確認（2026-08-26）

Edge Function **8本**を Lovable のエージェントに依頼してデプロイ。
`net.http_post` で9本（対照1本を含む）を叩き、**404 が1本も無い**ことを確認:

| 関数 | 応答 |
|---|---|
| send-transactional-email / process-email-queue / invite-customer | 401 |
| notify-new-booking / push-booking-reminder / send-trial-reminders | 403 |
| trial-book / drop-in-book | 200（バリデーションエラー＝生きている） |
| signup-trainer（対照） | 401 |

そのあと**実際の予約が1件入り**、その通知の全行に `tenant_id` が載ったことを確認した:

```
booking-confirmation      pending → sent   tagged=true
new-booking-notification  pending → sent   tagged=true
booking-confirmation      duplicate        tagged=true
```

🔴 `sent` を書くのは `process-email-queue`（別関数）なので、
**そこに載っていること＝payload 経由の受け渡しが本当に効いている**、が確認できた。
ここが一番壊れやすい箇所だったので、実トラフィックで見えたのは大きい。

## 閉店時の消し込み

`email_send_log` に `tenant_id` を足したので、`delete_my_gym`（閉店処理）の
消し込み対象に加えた（`20260826020000_delete_gym_email_log.sql`）。

FK は `ON DELETE SET NULL` なので消さなくてもテナント削除時に NULL にはなるが、
その行は**誰からも見えず・誰にも消せない**まま残り、中身には宛先の
メールアドレス（個人情報）が入っている。だから明示的に消す。

🔴 定義は**最新の版から機械的に写して1行だけ足した**。古い版から書き直すと、
その間に増えたテーブルの消し込みが黙って消える（2026-08-21 に
`booking_capacity_windows` で実際に踏んだ）。

この漏れは既存の見張り（`gymOwnership.test.ts`「テナント配下のテーブルを
取りこぼしていない」）が自動で捕まえた。**列を足した時点で赤くなる**作りになっていて、
今回それがそのまま効いた。

適用後、**本番の定義・repo の migration・見張りテストが固定している一覧**の3つを
機械的に突き合わせて、33テーブルで完全一致することを確認した。
（写し間違いは目視では絶対に見つからない。必ず突き合わせること）

## ⚠️ まだやっていないこと: 再送

ロードマップは「履歴＋**再送**」だったが、再送は入れていない。

理由: **再送に必要な材料が残っていない。** `email_send_log` が持っているのは
種別・宛先・状態だけで、`templateData`（お客様の名前・日時・プラン）は残していない。
キューの payload（描画済みの HTML）は pgmq が送信成功時に消す。

やるなら次のどちらか:

- `email_send_log` に `template_data jsonb` を足し、再送時に再描画する（小さい・素直）
- 種別ごとに元の予約行から組み立て直す（種別 → 元データの対応表が要る）

前者を勧める。ただし `send-transactional-email` は沈黙故障の前科が多い繊細な関数なので、
履歴（読むだけ）とは PR を分けた。

⚠️ 再送のときは**冪等キーを新しくすること**。同じキーだと `notification_dedupe` に
弾かれて `duplicate` を記録して終わる（店から見ると「押したのに何も起きない」）。
