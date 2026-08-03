# テナント境界の穴（2026-08-03 に発見した3件）

兄弟アプリ向けの「ワンタイムログインコード」仕様を検証する過程で見つかった。
**仕様書の問題ではなく、ジムボード本体にあった穴。** 3件とも
「trainer ロールを取れた人が、テナントの境界を越えられる」系。

共通の根っこは **`has_role` / `user_roles` にテナントの概念が無い**こと。
`trainer` は**テナント横断のグローバル権限**なので、
「トレーナーかどうか」を権限判定に使うと、そこはテナント分離の穴になる。

| # | 内容 | 状態 |
|---|---|---|
| 3 | `send-push-notification` が trainer に対して宛先検証を全部スキップ | **修正済み（PR #246）** |
| 1 | `tenant_members` に他人の `user_id` を INSERT できる | **修正済み（PR #247）** |
| 2 | `signup-trainer` が自己サービスで、誰でも trainer になれる | **対処済み（PR #248）。ただし登録の自由は維持** |

**1 が本丸。** ここが開いている限り、`shares_tenant_with_me()` に依存する
テナント境界（`profiles` / `skeletal_diagnoses` など）は全部意味を失う。
影響が小さく独立して直せる 3 から着手した。

## 結論: 「trainer である」ことを権限の根拠にしない

2 について、**トレーナー登録を自由なままにすることを 2026-08-03 に決めた**
（新規ジムが自分で登録できることが product の前提。兄弟アプリも同じ）。

つまり **「trainer ロールを持っている」は権限の根拠にならない。**
インターネットの誰でも取れる属性だから。守り方は2つだけ:

| 場所 | 書き方 |
|---|---|
| RLS の書き込みポリシー | 必ず `tenant_id = get_my_tenant_id()` か `auth.uid() = user_id` と **AND** する |
| Edge Function | `hasRole` を宛先・対象の検証に使わない。`tenant_members` を直接引く |

見張り: `src/test/globalTrainerRole.test.ts` / `src/test/pushNotificationTenantScope.test.ts`

---

## 3. `send-push-notification` の宛先検証（修正済み）

### 何が起きていたか

```ts
// 修正前 index.ts:465-466
const isTrainer = caller.userId ? await hasRole(caller.userId, "trainer") : false;
if (!isTrainer) {
  ...宛先の検証はすべてこの中...
}
```

**trainer なら中身が丸ごとスキップされる。**
`has_role` はテナント非依存なので、結果として

> どのジムのトレーナーでも、他ジムの顧客に、任意の `title` / `body` のプッシュを
> 件数制限なしで送れる

状態だった。「店舗からのお知らせ」を騙るフィッシング、本物の通知を押し流す洪水、
どちらにも使える。

同じファイルの waitlist 経路（`purpose === "waitlist_slot_freed"`）は
`prof.tenant_id !== tenant_id` を確認していたので、**同一ファイル内で不整合**だった
（そちらも trainer は素通しだったので、他ジムの待機者へ「空きが出ました」を撃てた）。

### どう直したか

service_role 以外は **「自分自身」か「同じテナントに所属している人」** にしか送れない。
**trainer に特例は無い。**

```ts
const memberships = await loadTenantMemberships(adminClient, [callerId, ...otherIds]);
const callerTenants = activeTenantIds(memberships, callerId);
if (callerTenants.size === 0) return 403;        // 所属が無ければ他人に送れない
```

### 判断の分かれ目

- **所属は `tenant_members` を直接引く。** `get_my_tenant_id()` /
  `shares_tenant_with_me()` は中身が `auth.uid()` 依存で、Edge Function の
  service_role クライアントから呼ぶと**常に NULL / false**（エラーも出ない）。
  テナント検証に使うと黙って素通り or 全拒否になる
- **`tenant_id` が NULL の行は捨てる。** 拾うと「所属未設定の人どうし」が
  同じテナント扱いになる（2026-08-01 にフォーク取り込みで踏んだ `null === null` と同型）
- **呼び出し元は `status = 'active'` を要求。宛先は status を問わない。**
  退会（`status = 'cancelled'`）した会員に残っていた予約をトレーナーがキャンセルする、
  という場面で通知が黙って消えるのを防ぐため。テナント境界の内側であることは変わらない
- **宛先の件数に上限（100件）。** クライアント経由の呼び出しは自テナントのスタッフ＋本人
  程度しか送らない（`fetchMyTenantStaffIds()`）ので、実運用では当たらない
- **`if (!caller)` ではなく `if (!caller.userId)`。** `verifyCaller` は service_role のとき
  `{ userId: null, isServiceRole: true }` を返すので、前者だとすり抜ける

### 影響が無いことを確認した呼び出し元

- **Edge Function 側（`push-announcements` / `push-booking-reminder` /
  `push-booking-reminder-hourly` / `push-period-reminder` / `daily-trainer-summary` /
  `trial-book` / `drop-in-book` / `trial-cancel`）は全部 service_role** なので素通り
- **クライアント側**（`CustomerBooking.tsx` / `useMessages.ts` / `useBookings.ts`）は
  宛先が「自分」「`fetchMyTenantStaffIds()` の結果」「その予約の顧客」「メッセージの相手」
  のいずれかで、**全部 `tenant_members` に載っている同一テナントの人**

### 回帰テスト

`src/test/pushNotificationTenantScope.test.ts`。
`supabase/functions/` は vitest の include（`src/**`）の外で Deno のリモート import を
含むため実行できない。既存の流儀（`edgeFunctionProjectRef` 等）に合わせてソースの形を見張る。

- `hasRole` / `isTrainer` がこのファイルに復活していないこと
- `loadTenantMemberships` を両経路が通っていること
- fail-close の分岐が残っていること（変異テストで確認済み）
- **おまけで全 Edge Function を走査**し、`get_my_tenant_id` / `shares_tenant_with_me` を
  `rpc()` していないことを見張る（上の「常に NULL」の罠の再発防止）

### デプロイ

`send-push-notification` は `.github/workflows/deploy-functions.yml` の
デプロイ対象5関数に入っているので、**main へマージした時点で本番に反映される**。
2026-08-03 のマージで実際にデプロイ成功を確認済み。

---

## 1. `tenant_members` の書き込み（修正済み）

### 何が起きていたか

```sql
CREATE POLICY "Trainers/owners can manage members" ON public.tenant_members FOR ALL TO authenticated
  USING      (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));
```

`WITH CHECK` が見ているのは「**呼び出し元が**その `tenant_id` において owner/trainer か」
だけで、**挿入される `user_id` には一切の制約が無い。** `FOR ALL` なので DELETE も同条件。

```js
// トレーナーがブラウザのコンソールから1行
supabase.from('tenant_members').insert({ tenant_id: '<自分の店>', user_id: '<他店の顧客>', role: 'customer', status: 'active' })
```

これが通ると `shares_tenant_with_me()` が真になり、`profiles` /
`skeletal_diagnoses`（接骨院版なら施術記録）などの RESTRICTIVE なテナント境界が開く。
**テナント分離の土台そのものが、攻撃者が書き換えられる値になっていた。**
そのあと同じポリシーで DELETE すれば痕跡も消せた。

**攻撃には被害者の `user_id`（UUID）が必要。** `profiles` は
`profiles_tenant_scope_select` で守られていて、`raid_damage_logs` の `USING (true)` も
2026-05-29 に塞がれているので、誰でも名簿を作れる状態ではなかった。
ただし**一度でも自店の顧客だった人の UUID は分かる**ので、
「他店へ移ったお客様」は現実的な対象だった。

### どう直したか

`supabase/migrations/20260803120000_tenant_members_write_scope.sql`

| コマンド | 誰が |
|---|---|
| INSERT | **自分の行だけ**（既存の "Users can insert own membership" のみ。FOR ALL を落として実現） |
| UPDATE | 自テナントの owner/trainer。ただし `user_id` / `tenant_id` / `role` は変更禁止 |
| DELETE | **そのテナントの owner だけ**（trainer から外す） |
| SELECT | 変更なし |

### なぜ UPDATE はトリガーで塞ぐのか

**RLS の `WITH CHECK` は「更新後の行」しか見えない。** 旧値と比較できないので、
「自テナントの既存行の `user_id` を被害者のものに差し替える」はポリシーでは塞げない
（INSERT を塞いでも UPDATE で同じことができてしまう）。

列レベルの `GRANT` でも表現できるが、Supabase の
`GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated` が後から流れると
**黙って元に戻る**ので採らなかった。`BEFORE UPDATE` トリガー
（`guard_tenant_member_identity`）は上書きされない。

`auth.uid()` が NULL のとき（service_role / ダッシュボード / マイグレーション）は対象外。
運用上の付け替えまで止めないため。

### 影響が無いことを確認した書き込み元

`tenant_members` に書くコードを全走査した結果:

| 場所 | 内容 | 影響 |
|---|---|---|
| `JoinGym.tsx:111` | 自分の行を upsert（role='customer'） | 無し |
| `Onboarding.tsx:211` | 自分の行を insert（role='owner'、`owner_user_id = auth.uid()` のテナント） | 無し |
| `TrainerClientDetail.tsx:562` | 自テナントの顧客の `plan_id` を UPDATE | 新 UPDATE ポリシーで通る |
| `TrainerPlanManager.tsx:210` | SELECT（件数） | 無し |
| Edge Function 各種 | 全部 service_role | 無し |

**「他人の `tenant_members` 行を作る」導線はアプリに元々無い。**
スタッフの追加は service_role（ダッシュボード）で行う。

### 回帰テスト

`src/test/tenantMembershipWrites.test.ts`。

**`tenantIsolation.test.ts` ではこの穴は捕まらなかった。** あちらは
「既存行に触れるポリシー」を見る設計で、`touchesExistingRows` が INSERT を除外している。
**「読めるか」ではなく「境界を作れるか」を見るのが新しいテストの役目。**

マイグレーションのパーサ（CREATE/DROP の畳み込み、DOループ展開、最上位ORの分割）は
`src/test/helpers/rlsPolicies.ts` に出して両方から使う。**複製しないこと** —
畳み込みを間違えると「緑のまま何も見ていない」状態になり、気づく手段が無い。

`FOR ALL` は INSERT/UPDATE/DELETE をまとめて開けるので、
どのコマンドの検査にも含めている（`policiesFor`）。
マイグレーションを外すとテスト9件中7件が落ちることを確認済み。

---

## 2. グローバルな trainer ロールで書けるテーブル（対処済み）

### 方針

**トレーナー登録は自由なまま。** `signup-trainer` は閉じない
（`TRAINER_SIGNUP_CODE` の復活は見送った）。代わりに
**「trainer になっただけで他テナントに手が届く先」を無くす**。

### 何が開いていたか

`has_role` が見る `public.user_roles` に `tenant_id` は無いので、

```sql
USING (has_role(auth.uid(), 'trainer'::app_role))
```

とだけ書かれた書き込みポリシーは「**誰でも書ける**」と同義だった。
`tenant_id` を持たない全テナント共通のマスタ8つがこの状態:

`raid_bosses` / `raid_reward_items` / `season_events` / `season_event_tasks` /
`season_pass_config` / `season_pass_levels` / `avatar_customization_items` /
`gym_settings`（旧・単一ジム時代の設定。アプリからは未使用）

捨てアドレスで登録した誰かが「レイドを全部消す」「イベントを書き換える」ことができた。

storage も1件。`avatars` バケットの `tenant-logos/` が
`foldername[1] = 'tenant-logos' AND has_role(trainer)` だけで、任意のファイル名を置けた。

### どう直したか

`supabase/migrations/20260803140000_global_trainer_write_scope.sql`

- 8テーブルの**書き込みポリシーを外して service_role 専用**にした。SELECT は据え置き。
  **アプリからは1箇所も書いていない**（全走査で確認。読みは `CustomerBooking.tsx:97` の
  `raid_bosses` と `useSeasonEvents.ts:54/66` だけで、どちらも `.select()`）
- `apply_raid_damage()` は SECURITY DEFINER なので `raid_bosses` の
  `current_damage` / `defeated` 更新は影響を受けない
- storage は `name LIKE 'tenant-logos/' || auth.uid()::text || '-%'` を足した。
  実際に書くのは `Onboarding.tsx:115` の `tenant-logos/{user.id}-{timestamp}.{ext}` 1箇所。
  **オンボーディング時点ではテナントが未作成**なので `get_my_tenant_id()` は使えず、
  user_id 前置で絞るのが正解

### 対象外だったもの（既に AND で絞られていた）

| テーブル | 絞り |
|---|---|
| `counseling_responses` | `AND tenant_id = get_my_tenant_id()` |
| `tenant_muscle_groups` | `AND tenant_id = get_my_tenant_id()` |
| `google_calendar_tokens` | `AND auth.uid() = user_id` |
| `gym-assets` バケット | `AND foldername[1] = get_my_tenant_id()::text`（2026-05-30 に対処済み） |

### 回帰テスト

`src/test/globalTrainerRole.test.ts`。**テーブルを列挙しない**のが要点で、
全ポリシーを走査して「`has_role(trainer)` を含む書き込みポリシーに、
テナント絞りか本人限定が AND されているか」を見る。列挙式だと
テーブルが増えたときに漏れる。

`storage.objects` だけは対象外にしている（絞りの書き方が
`bucket_id` / `storage.foldername(name)` / `auth.uid()::text` と public スキーマと
まったく違い、共有パーサでは正しく評価できない）。代わりに名指しの断言を1つ置いた。

マイグレーションを外すとテスト4件中3件が落ちることを確認済み。

### 兄弟アプリへ

**同じ穴が全兄弟アプリにある**（複製元が同じなので）。
しかも Confirm email を OFF にすると `email_confirmed_at` の関門も消えるため、
**ジムボードより条件が緩い**。このマイグレーションをそのまま持っていけばよい。
