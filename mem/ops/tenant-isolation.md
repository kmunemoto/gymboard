# テナント分離（他ジムの顧客データに触れられないこと）

マルチテナントSaaSとして最も重要な不変条件。**ここが破れたら製品として売れない。**

## 最初に読むこと：ポリシーは検索しても出てこない

テナント分離ポリシーは3つのマイグレーションで、
`DO $$ ... FOREACH t IN ARRAY tables LOOP ... EXECUTE format('CREATE POLICY ...', t) ...` の形で
**動的生成**されている。そのため:

> `grep "CREATE POLICY ... ON bookings"` しても **1件も出てこない**。
> しかし実際には RESTRICTIVE ポリシーが張られている。

2026-07-25、この点を**2回**読み違えた。2回目は
「`weight_journey` / `user_avatars` / `weight_journey_milestones` が無防備で、
他ジムのトレーナーが健康情報を読める」と結論し、修正マイグレーションまで書いた。
**完全な誤りだった**（該当テーブルは `20260529082706` で既に保護済み）。
本番DBには何も適用していない。

気付けたのは、修正を一時的に外してもテストが緑のままだったから。
落ちるべき場面で落ちなかったので調べ直した。**変異テストをしていなければ、
誤った不安を残したまま不要なDDLを本番に流していた。**

調べるときは必ず `src/test/tenantIsolation.test.ts` の解析器を使うか、
実DBの `pg_policies` を見ること。マイグレーションの目視は当てにならない。

## 3つの適用方式

| 方式 | 条件 | 定義元 | 対象 |
|---|---|---|---|
| `tenant_isolation` | `tenant_id IS NOT NULL AND tenant_id = get_my_tenant_id()` | `20260517100152` | 11テーブル（bookings / workouts / exercises / user_measurements / meals / messages / progress_photos / blocked_slots / monthly_reports / announcements / notification_settings） |
| `tenant_user_isolation` | `auth.uid() = user_id OR shares_tenant_with_me(user_id)` | `20260529082706`（14件）<br>`20260530080359`（19件） | `tenant_id` を持たないテーブル。weight_journey / user_avatars / weight_journey_milestones / アバター・ゲーム系ほか |
| 個別 RESTRICTIVE | 各テーブル固有 | 個別マイグレーション | profiles / skeletal_diagnoses / trial_bookings / booking_waitlist |

上記に該当しないが安全なもの:
`counseling_responses` / `tenant_members` / `tenant_muscle_groups` / `tenant_plans` は
PERMISSIVE ポリシーの中で `tenant_id = get_my_tenant_id()` / `is_tenant_member(...)` /
`has_tenant_role(...)` を使って絞っているため、RESTRICTIVE が無くても越境しない。

## なぜ RESTRICTIVE が要るのか

PostgreSQL のRLSは **PERMISSIVE 同士は OR、RESTRICTIVE は AND** で結合される。
つまり「緩い PERMISSIVE が1つでもあれば漏れる」。

たとえば `bookings` には空き枠照会のための `USING (true)` が、
`weight_journey` には `OR has_role(auth.uid(), 'trainer')` がある。
`has_role` は**ロールしか見ておらず所属ジムを見ていない**ので、単体なら全ジム横断になる。
これらが安全なのは、RESTRICTIVE のテナント絞りが AND で潰しているから。

**新しいテーブルを足すときは、PERMISSIVE を丁寧に書くより、
RESTRICTIVE を1本張るほうが確実。**

- `tenant_id` がある → `USING (tenant_id = public.get_my_tenant_id())`
- `tenant_id` が無い → `USING (auth.uid() = user_id OR public.shares_tenant_with_me(user_id))`

## 自動チェック

`src/test/tenantIsolation.test.ts`（CIで毎PR実行）。

DOループの配列を展開したうえで、顧客データを持つ22テーブルが次のどちらかを満たすか見る:

- **(A)** RESTRICTIVE なテナント絞りがある
- **(B)** 無いなら、既存行に触れる PERMISSIVE が**すべて**テナント絞りか本人限定

(B) の判定は最上位の `OR` で分割し、**全ての枝**を調べる。
ここを「どこかに `auth.uid() = user_id` があればOK」と書くと、
`auth.uid() = user_id OR has_role(...)` を安全と誤判定して**何も検証しないテストになる**
（実際に最初そうなっていた）。

新しいテーブルを足したら `CUSTOMER_DATA_TABLES` にも追加すること。

## 残っている制約（セキュリティではなく機能面）

- **LINE**: 全テナント共有の単一 `LINE_CHANNEL_ACCESS_TOKEN`。
  `line-booking-reminder` は Salute テナントに限定しており、**他ジムにはLINEリマインドが届かない**
- **Googleカレンダー**: Salute の OAuth クライアントを流用。他ジムも使えるが同意画面に Salute の名前が出る
- **既定テナント**: `/trial`・`/drop-in` をテナントID無しで開くと Salute に予約が入る
  （既存リンク互換のため意図的に残置。`src/lib/legacyDefaultTenant.ts`）
