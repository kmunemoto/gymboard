# GymBoard SaaS の料金プラン（tenants.gymboard_plan / max_customers）

ジムが GymBoard 自体に払うサブスクの話。**ジムが自分のお客様に売る `tenant_plans`
（「月4回」など）とは別物**なので混同しないこと（そちらは `mem/features/plan-slot-duration.md`）。

## プラン定義は2箇所にある（必ず両方直す）

| ファイル | 使う場所 |
|---|---|
| `src/lib/gymboardPlans.ts` の `PLAN_CARDS` | 画面（設定→プラン、`TrainerBilling.tsx`）の表示 |
| `supabase/functions/_shared/gymboard-plans.ts` の `PLAN_MAP` | Stripe Webhook が `tenants.max_customers` に焼き込む値 |

前者のコメントが "Mirrors ..." と書いているとおり同じ内容の写しで、**片方だけ直すと
「画面は30名まで、実際に使えるのは50名」という食い違い**が起きる。コードレビューでも
気付きにくいので `src/test/gymboardPlans.test.ts` の
「エッジ関数側のプラン定義と上限が一致する」テストで突き合わせている（消さないこと）。

現在の上限:

| plan | 表示名 | 月額 | 顧客上限 | スタッフ上限 |
|---|---|---|---|---|
| `free` | Free | ¥0 | 5 | 1 |
| `light` | Starter | ¥4,980 | 20 | 3 |
| `standard` | Standard | ¥6,980 | **30**（2026-07-31に50から変更） | 5 |
| `premium` | Pro | ¥9,800 | 無制限 | 無制限 |

## `tenants.max_customers` は「保存された値」であって導出値ではない

`gymboard_plan` から都度引き直しているわけではなく、列に焼き込まれている
（`20260517093130_*.sql:28` で `DEFAULT 5`）。書き込むのは
`gymboard-stripe-webhook` だけ（`PLAN_MAP` を見て `applySubscriptionToTenant()` で UPDATE）。

そして上限の判定はすべて**保存された値**を読む:
- `enforce_tenant_member_limits`（`20260523143956_*.sql:24-31`）… `>=` で顧客追加を拒否
- `is_tenant_over_limit`（`20260525025614_*.sql:25-31`）… `>` で超過判定

つまり **PLAN_MAP を変えただけでは既存テナントに反映されない**。次の課金イベント
（`checkout.session.completed` / `customer.subscription.created|updated`）が飛ぶまで古い値のまま。

## 上限を下げるときの手順（2026-07-31 の 50→30 で確立）

1. `PLAN_CARDS` と `PLAN_MAP` の両方を直す（テストが片方忘れを検出する）
2. `src/dev/fixtures.ts` のフィクスチャテナントも合わせる
   （`src/dev/fixtureClient.ts` の `get_tenant_limit_status` はテナント行から引くので追随する）
3. **既存テナント用のマイグレーションを書く**（`20260731000000_standard_plan_max_customers_30.sql`）
4. **マージ後に Stripe Webhook を再デプロイする**（下記）
5. **LP（別プロジェクト）の料金表も直す**（下記）

### ⚠️ 上限を下げるマイグレーションには顧客数ガードを必ず付ける

`is_tenant_over_limit` は `enforce_tenant_plan_limit` から呼ばれ、これは
**bookings / workouts / meals の BEFORE INSERT トリガー**（`20260525025614_*.sql:69-80`）。
なので 31〜50名を抱える Standard テナントの上限をいきなり 30 にすると、新規入会が
止まるどころか**予約もトレーニング記録も食事記録も作れなくなる＝そのジムが全面業務停止**する。
落ち度のない課金中のお客様にそれを起こさないため、
`(顧客数) <= 新上限` の条件を付けて、超過テナントは据え置く（グランドファザリング）。

### ⚠️ マージだけでは Stripe Webhook は再デプロイされない

再デプロイしないと古いバンドルが動き続け、Standard の課金イベントのたびに
`max_customers` が 50 に**書き戻される**（画面は30名まで、DBは50名）。

🔴 2026-10-31 時点: Edge Function は **push でも Publish でも本番に出ない**。Lovable のエージェントに
「デプロイして（編集は不要）」と頼むのが唯一の経路（`.github/workflows/deploy-functions.yml` は削除済み）。
手順と、デプロイされたかの確かめ方は `mem/ops/edge-function-deploy.md`。
`gymboard-stripe-webhook` と `gymboard-create-checkout` は応答に `x-gymboard-build` ヘッダを付けているので、
署名の無い呼び出しでも「どの版が動いているか」が分かる（2026-10-31 から）。

## 運営の印: コンプとテスト用のジム（`tenant_billing_flags`・2026-10-31）

宗本さんの判断（2026-10-31）で、ジムごとの次の2つは**運営だけが触れる別の表**に置いた
（`20261031090000_billing_flags_and_tenant_billing_guard.sql`。anon・authenticated は読めない・書けない）。

| 列 | 意味 | 付いているジム（2026-10-31） |
|---|---|---|
| `is_comp` | コンプ（運営が無償で無制限）。Stripe のイベントで**一切書き換えない**。checkout も断る | 御所南だけ |
| `stripe_sandbox_allowed` | テスト決済（Stripe のテストモード）を受け付ける。**印の無いジムはテスト決済を使えず、テストのイベントも反映しない** | まだ無し（どのジムをテスト用にするか宗本さんに確認中） |

🔴 以前はコンプを `max_customers IS NULL` で見分けていた。**Pro も上限なし（NULL）なので、Pro になったジムが
解約しても Pro のまま残った。** 上限なし＝コンプではない。コンプは印だけで見分ける。
（`src/lib/subscriptionStatus.ts` の延滞バナーはまだ `max_customers == null` を「対象外」にしている。表示だけで、
サーバー側に延滞で止める仕組みは今は無い。）

印を付ける・外す（本番の SQL。ジムの ID は**リポジトリに書かない**）:
```sql
-- テスト用のジムにする
INSERT INTO public.tenant_billing_flags (tenant_id, stripe_sandbox_allowed, note)
VALUES ('<テスト用のジムの tenant_id>', true, 'テスト決済用（<日付> 宗本さん）')
ON CONFLICT (tenant_id) DO UPDATE SET stripe_sandbox_allowed = true, note = EXCLUDED.note, updated_at = now();

-- コンプを外して課金へ移す（先に外してから checkout。順序は意図どおり）
UPDATE public.tenant_billing_flags SET is_comp = false, updated_at = now() WHERE tenant_id = '<tenant_id>';
```

### オーナーは自分のジムの課金・契約の列を書き換えられない（同じマイグレーション）

`tenants` の UPDATE のポリシーは「自分がオーナーの行」しか見ていない。以前の
`REVOKE UPDATE (stripe_customer_id, stripe_subscription_id)` は**効いていなかった**（テーブル単位の権限が残っていると
列単位の REVOKE は何もしない）。2026-10-31 まで、オーナーは API を直接叩いて `gymboard_plan`・`max_customers`
（NULL で上限なし）・`trial_ends_at` を書き換えられた。

今は BEFORE INSERT OR UPDATE のトリガー（`guard_tenant_billing_columns`）が、画面から（authenticated / anon）の
**プラン・上限・お試し期間・契約の状態・Stripe の ID・オーナー**の変更を拒む（同じ値なら通す）。画面からの直接の INSERT は、
`create_gym_with_owner` と同じ値（trial・60日・free・5名）に上書きする。webhook（service_role）・SECURITY DEFINER の関数・
運営の SQL は対象外。**画面の保存でこれらの列を書くと「プラン・契約の状態は、この画面からは変えられません」で落ちる**
（`src/test/stripeBillingFlags.test.ts` が走査で見張っている）。

## LP（料金表）は別の Lovable プロジェクトにある

このリポジトリに料金ページは無い（`src/App.tsx` に `/pricing` ルート無し。
`src/lib/marketing.ts:7` が外部LPのURLを持っているだけ）。
料金表の実体は **Lovable プロジェクト `42f878c2-dd15-4c6d-9e0d-f4c916644574`**
（`gymboard-app.lovable.app`）の `src/components/landing/Pricing.tsx` の `PLANS` 配列で、
`customers: "50名まで"` のように**文字列で直書き**されている。
トップページの `SoftwareApplication` 構造化データ（offers）とも共有しているのでSEOにも出る。
アプリ側の上限を変えたらここも必ず直す（放置すると表示と実際の提供内容が食い違う）。

## 配布済みアプリには即座に反映されない

`capacitor.config.ts` は `webDir: 'dist'` で `server.url` を持たない＝JSバンドルは
ビルド時にネイティブバイナリへ焼き込まれる。すでにインストール済みの iOS/Android アプリは、
**新しいビルドを配信してユーザーが更新するまで古い「50名まで」を表示し続ける**。
Web版（app.kyoto-salute.com）は再デプロイで即反映される。

## 姉妹プロダクトは別管理

`ピラボード`（active-app-studio）や `セッコツボード`（fit-client-coach）は GymBoard から
派生した別プロジェクトで、それぞれ自前のプラン定義に standard=50 を持っている。
GymBoard の料金を変えても**自動では連動しない**し、連動させるべきかは商品ごとの判断。
