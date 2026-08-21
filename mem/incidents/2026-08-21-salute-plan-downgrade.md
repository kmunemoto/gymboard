# 運営自身のジムが free プランに落とされ、全機能ロックされた（2026-08-21）

## 何が起きたか

Salute御所南（運営のジム・**コンプ状態 = max_customers IS NULL**）の tenants 行が
いつの間にか `gymboard_plan='free'・max_customers=5・max_trainers=1・
subscription_status='canceled'` になっていた。顧客37名 > 上限5名で
「プランの上限を超えています」バナーが出て、**新規予約・記録の作成が全部止まった**
（enforce_tenant_plan_limit がサーバー側で拒否する）。

## 原因

**gymboard-stripe-webhook の `customer.subscription.deleted` ハンドラ。**
この組（free/5/1/'canceled'/sub_id NULL）をセットするのはコードでここだけ。

課金フローのテストで Salute に Stripe のサブスクが紐づき（stripe_customer_id が
残っていたのが痕跡）、そのサブスクが Stripe 側で削除された時点でイベントが飛び、
ハンドラが**コンプ状態を無条件に free へ上書き**した。webhook にはコンプの概念が
無かった。

⚠️ この障害は**通知が一切出ない**。店がある日突然ロックされ、画面のバナーで
初めて気づく形になる。

## 復旧（本番適用済み）

```sql
UPDATE tenants SET
  gymboard_plan='premium',          -- 「Pro」の内部値は premium（gymboard_pro_* が map する値）
  gymboard_plan_period=null, max_customers=null, max_trainers=null,
  subscription_status=null, stripe_subscription_id=null, current_period_end=null,
  status='active', trial_ends_at=null
WHERE id='ceda19b0-d5e0-4928-ab2e-996a0b823af4';
```

復旧後、オーナーを演じて顧客37名のまま新規予約の INSERT が通ることを確認
（ROLLBACK）。表示は Pro・無制限になる。

## 再発防止

webhook に **コンプガード**を追加（`isCompTenant`: max_customers IS NULL なら
プラン適用も deleted の格下げもスキップ）。`src/test/stripeWebhookCompGuard.test.ts`
が見張る（変異3種で赤を確認）。

- コンプの定義は「max_customers IS NULL」**そのもの**
  （is_tenant_subscription_blocked / subscriptionStatus.ts と同じ判定）。
  テナントIDの直書きはしない（他のコンプにも効く・public リポジトリに ID を増やさない）
- **コンプのテナントを本当に課金へ移すときは、先に max_customers に値を入れて
  コンプを解除してから checkout する**（ガードで無視されるのは意図どおり）
- `invoice.payment_failed` は stripe_subscription_id の一致で引くので、
  sub_id を NULL にした時点で届かない（ガード不要）

## 学び

- **「プラン状態を書くのは webhook だけ」という前提のテーブルに、webhook が知らない
  状態（コンプ）を混ぜるなら、webhook 側にその状態の概念を教えること**
- 状態を壊す系の障害は通知が出ない。tenants のプラン列の変更に監査ログか
  通知を足すのは将来の課題（今回はガードで十分と判断）
