# 朝のサマリー通知（トレーナー向け「今日の予定」）

## 概要（2026-07〜）
毎朝、その日の予約一覧（時間・お客様名）をオーナー/トレーナーへプッシュ通知する。
`tenants.daily_summary_enabled`（既定true、opt-out）でジムごとにON/OFFできる。

- Edge Function: `daily-trainer-summary`。pg_cron から毎朝7:00 JST頃に1回呼ばれる想定。
- 対象: `daily_summary_enabled !== false` の全テナント。
- 本日（JST）の `bookings`（`status = '予約済み'`。同日キャンセル消化・キャンセル済みは
  自然と除外される）と `trial_bookings`（`status != 'キャンセル済み'`）を時刻順にまとめる。
- 予約が0件のテナントには送らない（ノイズを避ける）。
- 送信先は `tenant_members` の active な owner/trainer 全員。
- 冪等化: `notification_dedupe`（`idempotency_key = daily-summary-{tenant_id}-{JST日付}`）で
  同日の多重送信を防止。cronの多重起動・手動再実行があっても1日1回だけ届く。
- 送信は既存の `send-push-notification` Edge Function を service_role で内部呼び出しして
  再利用（VAPID/FCM実装を重複させない）。

## 設定画面
`TrainerGymSettings.tsx`「朝のサマリー通知」セクション（Switch、既定ON）。

## デプロイに関する注意（重要）
- マイグレーション（`20260721030000_add_daily_summary_enabled.sql`）はLovable経由での適用が
  必要。
- `daily-trainer-summary` は **新規Edge Function** のため、Lovable Publish での初回デプロイが
  必須（`.github/workflows/deploy-functions.yml` の自動デプロイ対象には含めていない。
  `trial-book`/`trial-cancel` と同じ理由＝ブラウザ直叩きの着地点ではなく cron 専用のため、
  即時デプロイの緊急性が無いと判断）。
- **pg_cron のスケジュール登録は、このリポジトリのマイグレーションには含まれていない。**
  既存の `push-booking-reminder-hourly` 等、他の cron 起動系 Edge Function も同様に
  git管理外（Supabase側で個別に設定されている）。この関数についても、Lovable/Supabase
  ダッシュボード側で `cron.schedule` を使い、毎朝7:00 JST（=22:00 UTC）に
  `daily-trainer-summary` を `net.http_post` で叩くジョブを新規に登録する必要がある。
  認証は他のcron関数と同じ `x-cron-secret` ヘッダ（`CRON_SECRET` シークレットと照合）または
  service_role の Authorization ヘッダのいずれか。
- `supabase/config.toml` に `verify_jwt = false` を明記済み（cronからJWTなしで呼ばれるため）。
