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

`.github/workflows/deploy-functions.yml` の `paths` フィルタは
google-calendar / line-login / send-push の5関数と `supabase/config.toml` だけで、
`gymboard-stripe-webhook` も `supabase/functions/_shared/**` も**入っていない**。
再デプロイしないと古いバンドルが動き続け、Standard の課金イベントのたびに
`max_customers` が 50 に**書き戻される**（画面は30名まで、DBは50名）。

Lovable の Publish、または:
```
supabase functions deploy gymboard-stripe-webhook --project-ref rrbfwitprzuevzytykrq
```
（リポジトリ直下で実行すること。`supabase/config.toml` の
`[functions.gymboard-stripe-webhook] verify_jwt = false` を拾えないと Stripe が 401 になる）

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
