# 運営への要望（operator_feedback）

店側（trainer / owner）が設定画面から、アプリの運営（宗本さん）へ要望を直接送れる。
2026-08-14 に追加（PR #309）。

## 仕組み

```
設定画面の「運営への要望」欄
  → operator_feedback へ INSERT（これだけ。Edge Function は呼ばない）
  → AFTER INSERT トリガー notify_operator_feedback() が
     既存のメールキュー（transactional_emails）に積む
  → pgmq テーブルの起床トリガー email_queue_wake が数秒で配送を起動
  → brand.ts の SUPPORT_EMAIL へメール
```

- **行が正式な記録**（メールは通知にすぎない）。UPDATE/DELETE は GRANT ごと無い
- 読めるのは**自分が送った分だけ**。同じ店のスタッフ同士でも見えない
  （人間関係の話が書かれることがあるため）
- 同一ユーザー1時間5件超はメールだけ抑制（行は残る）
- 新しい Edge Function は**作っていない**。デプロイの罠（push でも Publish でも
  本番に出ない）を避けるため、DB マイグレーションだけで完結させた

## 🔴 本番検証で2回落ちた。両方とも「静かに届かない」型

3段構え検証の3（実際に送る）で見つけた。**キューに載る＝届く、ではない。**

1. **400 missing_unsubscribe** — 送信API（Lovable email）は transactional に
   `unsubscribe_token` を**必須**にしている。無いと配送だけが落ち続けて DLQ 行き。
   → send-transactional-email と同じく `email_unsubscribe_tokens` で宛先ごとに
   1つ発行して使い回す。
   **同じ idempotency_key で送り直すと 409 run_failed になる**（APIが失敗を記憶する）。
   リトライではなく新しいキーが要る。
2. **gen_random_bytes が存在しないエラー** — pgcrypto は `extensions` スキーマにあり、
   トリガー関数の `search_path = public` からは**見えない**。例外ガードが握るので、
   行は残るのにメールだけ静かに消える。
   → 組み込みの `gen_random_uuid()` を2つ繋いで64桁hexにした（拡張非依存。
   兄弟アプリへの移植でも安全）。

検証の証跡: email_send_log で `operator-feedback` が `sent`（2026-08-14 03:48Z）。
実物のメールも宗本さんの受信箱に届いている。

## フォーク（兄弟アプリ）が変えるところ

- migration の `v_to`（宛先）… **brand.ts の SUPPORT_EMAIL と一致させる**。
  `src/test/operatorFeedback.test.ts` が一致を見張っている
- migration の `v_domain`（差出ドメイン）… そのアプリの
  send-transactional-email の `SENDER_DOMAIN` と一致させる（これもテストが見張る）
- 前提: email_infra（pgmq キュー＋ email_queue_wake ＋ process-email-queue）が
  動いていること。無いアプリはメール通知部分を自分の通知経路に差し替える

## 関連ファイル

- `supabase/migrations/20260814010000_operator_feedback.sql`（delete_my_gym の更新込み）
- `src/components/trainer/OperatorFeedback.tsx` / `src/lib/operatorFeedback.ts`
- `src/test/operatorFeedback.test.ts`（変異23種で検証済み）
- テナント配下テーブルを増やしたら delete_my_gym にも足すこと
  （`src/test/gymOwnership.test.ts` が実際にこの追加を要求した）
