# LINE（Messaging API）連携の停止

`src/lib/featureFlags.ts` の `LINE_INTEGRATION_ENABLED = false`（2026-07）。

## なぜ止めたか

LINE Messaging API のトークン `LINE_CHANNEL_ACCESS_TOKEN` は **全テナント共有の1本**しか無く、
ジムごとに公式アカウントを持たせる仕組みが無い。そのため:

- 他ジムのお客様に、こちらのLINEアカウントから通知が飛ぶ形になる
- `line-booking-reminder`（前日リマインド）は事故防止のため特定テナントに限定されており、
  **他ジムには一切届かない**。「あるのに動かない機能」になっていた

マルチテナントSaaSとして配る以上、中途半端に残すより一旦外す判断。

## 何が止まるか

| 通知 | 状態 |
|---|---|
| 予約確定（お客様・トレーナー） | 送らない |
| キャンセル・キャンセル確認 | 送らない |
| 予約変更 | 送らない |
| メッセージ受信 | 送らない |
| 連続来店の記録 | 送らない |
| 前日リマインド（pg_cron） | ジョブごと停止（下記） |
| 設定画面の「LINE連携」セクション | 非表示 |

**メール通知とプッシュ通知は今までどおり動く。** 止めたのはLINEだけ。

## 「LINEで連絡」ボタンは別物・残している

`tenants.line_url` は、各ジムが自分のLINE URLを設定して、お客様に開いてもらうだけのリンク。
Messaging API もトークンも使わないので、マルチテナントでも問題なく動く。
ジム設定から今までどおり設定できる。

## 仕組み

**送信は `src/lib/lineNotify.ts` の `sendLineMessage()` 1箇所に集約した。**

これが重要な点で、以前は `supabase.functions.invoke("send-line-message", ...)` が
**10箇所に散っており、フラグは設定画面の表示しか止めていなかった**。
つまりフラグをOFFにしても、予約やキャンセルのたびに送信は走り続ける作りだった。
窓口を1つにしたことで、フラグ1つで確実に止まる。

`src/test/lineNotify.test.ts` が次を見張る:

- フラグがOFFであること
- OFFのとき実際に `invoke` が呼ばれないこと
- `"send-line-message"` を書いてよいのは `lineNotify.ts` だけであること
- cron を止めるマイグレーションが存在すること
- 「LINEで連絡」ボタンが巻き添えで消えていないこと

## サーバー側（pg_cron）

クライアントのフラグは pg_cron からの送信を止められない。
`supabase/migrations/20260725160000_disable_line_booking_reminder_cron.sql` が、
コマンド本文に `line-booking-reminder` を含む cron ジョブを名前に依存せず停止する。
冪等なので、既に停止済みでも pg_cron が無い環境でも安全に流せる。

**このマイグレーションは本番DBに適用が必要。** 未適用のままだと前日リマインドが送信され続ける。

## 復活させるには

1. ジムごとに `LINE_CHANNEL_ACCESS_TOKEN` を持てるようにする（`tenants` に列を足す等）。
   **ここを先にやらないと、また同じ理由で止めることになる**
2. `LINE_INTEGRATION_ENABLED` を `true` に戻す
3. `cron.schedule(...)` で前日リマインドのジョブを作り直す

コードも `profiles.line_user_id` 等のデータも一切消していないので、連携済みのお客様は
そのまま復活する。
