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

🔴 **2026-10-31 追記（穴11）: 上の表では足りなかった。読み取りも含めて、PERMISSIVE で印を見ない。**
`tenant_id = get_my_tenant_id()` で守れるのは「別のジムから」だけで、**同じジムのお客様**が
印を付けると絞りごと通ってしまう。印の代わりに「そのジムのスタッフか」を見る:
`has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])`／`is_staff_of_user(user_id)`。
例外はジムを開く前の2つだけ（ロゴのアップロード・create_gym_with_owner）。下の「穴11」。

見張り: `src/test/globalTrainerRole.test.ts` / `src/test/pushNotificationTenantScope.test.ts`

## 兄弟アプリへの配布

**`security/` を見ること。** 3件の修正を兄弟アプリへ届けるための置き場で、

- `security/check.sql` … 自分のDBに同じ穴があるかを調べる**読み取り専用**の診断SQL
- `security/README.md` … 手順・踏んだ罠・本番での攻撃検証の手順

が入っている。**修正の実体はコピーしていない**（`supabase/migrations/` と `src/test/` が正）。
複製するとずれるため。README が指すパスが実在することは
`src/test/securityKit.test.ts` が CI で見張っている
（README が黙って嘘になると、受け取った側は気づけないため）。

**次に新しい穴を見つけたときは、`check.sql` に検査を1つ、`src/test/` に走査型テストを
1本足す。** 修正内容を全員に理解させる必要はなく、各アプリが自分の赤を見て直せる。

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

---

## 本番への適用（2026-08-03 実施済み）

Lovable 経由で GymBoard 本番（project `69ac2641-…` / Supabase `rrbfwitprzuevzytykrq`）に
#247 / #248 のマイグレーションを適用した。#246 は Edge Function。

> ⚠️ **訂正（2026-08-12）。** ここには元々
> 「`deploy-functions.yml` が main へのマージで自動デプロイした（成功を確認済み）」
> と書いてあったが、**それは事実ではなかった**。該当の実行（#14）を後から見たら
> Deploy ステップは **skipped**（conclusion は success）。あのワークフローは
> 初回から18回すべて skipped で、**一度もデプロイしていない**。
> 「成功を確認済み」の中身は **Actions が緑だったこと**でしかなかった。
> `send-push-notification` は既存の関数なので、実際には Lovable の Publish が
> 反映していたと思われる（新規の関数は Publish でも入らない）。
> デプロイ経路と確認方法は `mem/ops/edge-function-deploy.md`。

### 実際に攻撃してみて確認した（本番DB・ROLLBACK 付き）

`set_config('request.jwt.claims', ...)` ＋ `set_config('role','authenticated')` で
実在のオーナーになりすまし、1つの DO ブロックの中で試して最後に例外で巻き戻した。

| 試したこと | 結果 |
|---|---|
| 他テナントの顧客を自分の店に INSERT | **拒否**（`new row violates row-level security policy`） |
| 自分の所属行の `user_id` を差し替え | **拒否**（`所属の user_id は変更できません`） |
| 自分の `role` を変更 | **拒否**（`所属の role は変更できません`） |
| 自分の `tenant_id` を付け替え | **拒否**（`所属の tenant_id は変更できません`） |
| 他テナントの所属を DELETE | 0行 |
| `raid_bosses` を全削除 | 0行 |
| `season_events` を書き換え | 0行 |
| **正常系**: 自テナントの会員を UPDATE | **1行**（アプリは動く） |

> **一度 false alarm を出した。** `role = 'owner'` の人に `SET role = 'owner'` を
> 試すと `IS DISTINCT FROM` が偽になりトリガーが発火せず、`ROW_COUNT` だけ 1 になる。
> **値が実際に変わる方向で試すこと**（owner → trainer）。

### 踏んだ罠: `DROP POLICY IF EXISTS` はテーブルが無いと落ちる

`IF EXISTS` が掛かるのは**ポリシー**であって**テーブル**ではない。
`season_pass_config` / `season_pass_levels` は**リポジトリにマイグレーションはあるが
本番には存在しない**ため、`20260803140000` をそのまま流すと

```
ERROR: 42P01: relation "public.season_pass_config" does not exist
```

で止まる。`to_regclass(...) IS NOT NULL` で囲んである。
**兄弟アプリでも同じ状態がありえるので、この形のまま持っていくこと。**

---

## 兄弟5つの診断結果（2026-08-03 実施）

Lovable 経由で5アプリのDBとコードを直接調べた。**「複製元が同じだから全部空いている」は外れだった。**

| アプリ | 穴1-a | 穴1-b | 穴2-a | 穴2-b | 穴3（Edge Function） |
|---|---|---|---|---|---|
| セッコツボード | OK | OK | OK | OK | 未確認（本人は対応済みと報告） |
| ストレッチボード | OK | OK | OK | OK | 未確認（本人は対応済みと報告） |
| **ゴルフボード** | OK | OK | OK | OK | **★未修正（丸ごと。修正前と同一）** |
| 鍼灸ボード | OK | OK | OK | OK | **OK（ファイルで確認）** |
| **ピラボード** | **★残** | **★無** | **★17件** | OK | **★waitlist 経路のみ残** |

### 学んだこと1: ポリシー名はアプリごとに違う

ピラボードの `tenant_members` はこうだった。

```sql
-- ジムボード : "Trainers/owners can manage members"
-- ピラボード : "Owner can manage members"
--   USING (EXISTS (SELECT 1 FROM tenants t
--                   WHERE t.id = tenant_members.tenant_id
--                     AND t.owner_user_id = auth.uid()))
```

穴としては同じ（誰でも trainer になり Onboarding で自分のテナントを作れば
`owner_user_id` が自分になる）。**しかし名前が違うので、配布した修正SQLが効かない。**

**`DROP POLICY IF EXISTS "<違う名前>"` は何も消さずに成功する。エラーも出ない。**
**「適用したのに直っていない」が起きる。**

→ `security/check.sql` に**検査0（実物のポリシー名を出す）**を追加した。
配布キットの欠陥だったので、見つかった時点で直した。

### 学んだこと2: 一部だけ適用される

- **ピラボード**: 穴2-b（storage）だけ直っていて、穴1・穴2-a は未対応。
  穴3 は generic path だけ直っていて waitlist 経路は未対応
- **ゴルフボード**: DB（穴1・穴2）は全部適用済みなのに、Edge Function（穴3）は手つかず

**「前提条件が片付いた」という報告を額面どおり受け取ってはいけない。**
ゴルフボードはそう報告していたが、穴3 は修正前と1文字も変わっていなかった。
**DBは機械で確認できるが、コードは読むまで分からない。**

### 学んだこと3: 兄弟が上流に無い検査を持っていることがある

鍼灸ボードは `pushNotificationTenantScope.test.ts` に**上流に無い検査**を足していた。

> `rpc()` / `from()` が返すのは Promise ではなく `PostgrestFilterBuilder`。
> thenable だが **`.catch` を持たない**ので `admin.rpc(...).catch(() => {})` は
> 実行時に `TypeError` になり 500 で落ちる。しかも後始末の行だったため
> **「行だけ増えてスタッフには6桁のコードが返らない」**という壊れ方をした。

**ジムボードには該当箇所0件**（2026-08-03 に全 Edge Function を走査して確認）。
上流の穴ではないが、**この検査は取り込む価値がある**。フォークが先に踏んだ知見が
上流に返ってくる経路は、いまのところ人が中継するしかない。

### 学んだこと4: フォークが先に直していた穴が上流に残っていた

`send-push-notification` の `isAllowedUrl` が

```ts
if (u.startsWith("/")) return true;   // ← "//evil.example" も通る
```

だった。**"//" 始まりはプロトコル相対URLで、ブラウザは別オリジンに解決する。**
プッシュを開いた先が外部サイトになる（`sanitizeAuthNext` が認証コールバックに対して
塞いだのと同じ形の穴）。

**ピラボードが 2026-07-28 に先に直していた。** ゴルフボードの穴3を調べる過程で、
ピラボードのコードと読み比べて気づいた。上流は 2026-08-03 まで残っていた。

`src/test/pushNotificationTenantScope.test.ts` に検査を追加（変異テスト済み）。

**フォークの知見が上流に返る経路は、いまのところ人が中継するしかない。**
`security/` は上流→フォークの一方向で、逆方向は無い。
兄弟の報告を読むときは「上流にも同じ穴が無いか」を毎回見ること。

### 取り込み: 鍼灸ボードの検査（PostgrestFilterBuilder に .catch は無い）

フォークが先に作った検査を上流に入れた例。**逆方向が動いた最初のケース。**

```ts
await admin.rpc("purge_login_codes").catch(() => {});   // ← 実行時 TypeError で 500
```

`rpc()` / `from()` が返すのは Promise ではなく `PostgrestFilterBuilder`。
thenable だが **`.catch` を持たない**。しかも向こうでは**後始末の行**だったので、
本体の処理は終わっているのにレスポンスだけ 500 になった。
**Deno のコードは tsc にもユニットテストにも載らないので、本番に HTTP を投げるまで
誰も気づけない。**

ジムボードは取り込み時点で該当0件。検査だけ入れた
（`src/test/pushNotificationTenantScope.test.ts`）。

**正規表現は向こうより絞った。** 向こうは `\.(?:rpc|from)\(` だけだったが、
`Array.from(bytes)` を含む文に `.catch` が来ると誤検知する（実際に再現させて確認）。
`(?<!Array)` ＋「引数が文字列リテラル」で絞った。
supabase-js の `.from()` / `.rpc()` は必ず名前の文字列を取るので、これで漏れない。

**ファイル名は push 用だが、この describe はリポジトリ全体を見る。**
配布単位を増やさないため、既存の全走査 describe と同じ場所に置いた
（兄弟が既にこのファイルをコピーしているので、新ファイルを作ると向こうで重複する）。

### 取り込み2: ストレッチボードの edgeFunctionOrigin テスト

**フォークの知見を上流に入れた2件目。**

Edge Function（Deno）は `src/lib/brand.ts` を import できないので、本番ドメインは
各ファイルに手で直書きするしかない（現在10ファイル、`https://` リテラルで13箇所）。
**フォークが `brand.ts` だけ差し替えると、Edge Function 側に上流のドメインが残る。**

2026-08-03、**セッコツボードとゴルフボードが実際にこの状態だった。**
`send-push-notification` の `ALLOWED_URL_HOSTS` がジムボードのままで、

1. 自分の絶対URLを `url` に渡すと **400 で弾かれてプッシュが飛ばない**
2. **他社（ジムボード）のドメインを許可し続ける**

が同時に起きていた。**相対パス `"/"` は通るので表面化せず、エラーも出ない。**

ストレッチボードは `send-push-notification` の `ALLOWED_URL_HOSTS` だけを
`brand.ts` と突き合わせるテストを自作していた。上流に取り込むにあたって
**全 Edge Function の `https://` リテラル**まで広げた。

`brand.ts` に `OWN_WEB_HOSTS` を足して唯一の宣言にし、
`src/test/edgeFunctionOrigin.test.ts` が突き合わせる。
**フォークは `brand.ts` を直せば、CI が直すべきファイルを全部並べてくれる。**

`gymboard.app`（メールフッターの製品サイト、2026-07 に生存確認済み）は
`brand.ts` のどの定数にも無かったので、この機会に `OWN_WEB_HOSTS` へ入れた。

変異テスト2種で確認:
- **フォークを模して `brand.ts` だけ差し替える → 4件落ちる**（＝直すべき箇所が全部出る）
- `ALLOWED_URL_HOSTS` に他社ドメインを足す → 落ちる

#### 踏んだ罠: `//` のコメント除去で URL ごと消える

```js
const code = line.split("//")[0];   // ← https:// の // で切れて URL が全部消える
```

**検査が0件になって緑のまま**になる。プロトタイプで実際にやった。
`(?<!:)\/\/.*$` にして、「解析器が https:// リテラルを拾えている」
（5件以上あること）の空振り検知も入れた。

---

## 2026-08-03: 兄弟アプリの監査を一度まるごと間違えた

**Lovable の `read_file` は既定 ref（＝`main`）を読む。** ゴルフボードとセッコツボードは
成果物が作業ブランチにしかなく、`main` は remix 直後のまま止まっていた。

```
$ git rev-list --left-right --count origin/main...claude/new-session-ius5r0
0    1416     ← 1416コミット分すべてブランチ側
```

上流は `main` を読んで「穴3が丸ごと未修正」と報告した。**実際は直っていた。**
ゴルフボードから指摘されて判明した。

### 何を間違えたか

- **「どのブランチを見たか」を書かずに監査結果を出した。** これが原因の全部
- Lovable の `latest_commit_sha` / スクリーンショットの sha が古いことは
  見えていたのに、それを「作業が無い」ではなく「main が古い」と読めなかった

### 再発防止

`security/README.md` に **Step 0「先にどのブランチを見るか決める」** を追加した。

| 誰が | 何を |
|---|---|
| フォーク側 | 成果物を既定ブランチへ落とす。落とせないならブランチ名を上流に伝える |
| 監査する側 | **「どのブランチを見たか」を必ず書く。書いていない結果は信用しない** |

**`main` に何も入っていないと、そのアプリの CI は一度も何も守っていない**
（`ci.yml` は PR と `main` への push で回るため）。回帰テストを入れても発火しない。

### 判定の見直し

| アプリ | 既定 ref に作業が入っているか | 2026-08-03 の判定 |
|---|---|---|
| ストレッチボード | 入っている | 判定は正しい（穴3 修正済み） |
| 鍼灸ボード | 入っている | 判定は正しい（穴3 修正済み） |
| ピラボード | 入っている（途中まで） | **判定は正しい。穴が残っている** |
| ゴルフボード | **入っていない** | **誤り。実際は修正済み** |
| セッコツボード | **おそらく入っていない** | **誤りの可能性が高い。要確認** |

---

## 取り込み3: 通知を「開く側」の `//` ガード（ゴルフボード発）

**#252 で送る側（`isAllowedUrl`）を直した直後に、開く側の取り残しをゴルフボードが見つけた。**

```ts
// src/lib/pushNotifications.ts:110（修正前）
if (url && url.startsWith("/")) window.location.assign(url);
```

**送る側を直しても、ここは塞がらない。** 通知の payload は
`send-push-notification` を通らない経路でも届く（別の送信元、端末に残っていた古い通知）。
**送る側と開く側の両方が要る。**

同じ形の穴を `sanitizeAuthNext`（`nativeBridge.ts`）は認証コールバックに対して
既に塞いでいた。**同じリポジトリの中で、片方だけ直っていた。**

回帰テストは `pushNotificationTenantScope.test.ts` に2件追加（変異テストで確認済み）。

### ゴルフボードから受けた手順の指摘（README に反映済み）

1. **監査はブランチを明示する**（上記）
2. **`//` は2箇所ある**。指示書は送る側しか指していなかった
3. **`mem/` は追わなくてよい**。cherry-pick で必ず衝突する。フォークには
   `mem/ops/tenant-boundary.md` が存在せず、相当物の名前も違う
4. **変異テストの手順が書かれていなかった。**「変異テスト済み」とだけ書いていた。
   ソース正規表現テストは壊して確かめない限り、緑のまま何も見ていない状態になりえる。
   README に7パターンの表を入れた

---

## 穴4: 送信メールのトレーナーバイパス（2026-08-04 修正・PR は #257）

**穴3（プッシュ）とまったく同じ形が、`send-transactional-email` にも残っていた。**
穴3を直したときに気づいていたが、直すかどうかを保留にしていたもの。

```ts
// 修正前
const callerIsTrainer = caller.userId ? await hasRole(caller.userId, 'trainer') : false
if (!caller.isServiceRole && !callerIsTrainer) {
  ...テンプレート制限も宛先制限も、すべてこの中...
}
```

`trainer` はテナントの概念を持たない全社共通のロールで、しかも
**新規登録画面の「トレーナー」タブから誰でも自分で取れる**（`signup-trainer` は
意図的に開けてある）。つまり「トレーナーとして登録する」だけで:

- 宛先が自由（`recipientEmail` に任意のアドレス）
- テンプレート8種すべて（お客様は3種に制限されていた）
- `_resolve_trainer_` / `_resolve_user_` で他人のアドレスに解決させられる

### なぜプッシュより厄介か

差出人が **SPF/DKIM を通した正規ドメイン**（`noreply@notify.kyoto-salute.com`）。
受信側で弾かれない「本物に見える偽メール」を作れる。悪用されると
**ドメインの評判が落ちて、正規の予約確認メールまで迷惑メール送りになる。**
プッシュは端末に届いて終わりだが、これは復旧に時間がかかる。

### 直し方

「トレーナーかどうか」ではなく「**呼び出し元と宛先が同じジムに属しているか**」で判断する。

| 宛先の形 | 許す条件 |
|---|---|
| `_resolve_trainer_` | `trainerUserId` が、呼び出し元と同じジムの現役スタッフ |
| `_resolve_user_` | 自分自身、または「自分がスタッフをしているジムの在籍者」 |
| 生のメールアドレス | 自分のアドレスと一致するときだけ |

`_resolve_user_` を「自分宛だけ」に絞れない理由: **ジム側の代理予約**がこの経路で、
`resolveUserId` は呼び出し元ではなく**お客様**になる。絞ると代理予約の確認メールが止まる。

テンプレートはクライアントから3種のみ（`booking-confirmation` /
`booking-cancellation` / `new-booking-notification`）。残り5種は service_role 専用で、
実際に呼んでいるのも Edge Function だけであることを全走査で確認した。

### 副産物: 既存のバグも直った

修正前は宛先スタッフの検証が `hasRole(trainerUserId, 'trainer')` だった。
`fetchMyTenantTrainerId()` は **owner も返す**ので、
**オーナーしかいないジム（＝ほとんどの店）でオーナーがグローバル trainer ロールを
持っていない場合、お客様からのトレーナー宛メールが 403 で落ちていた。**
`tenant_members` ベースにしたことで owner も正しく宛先になる。

### 検証

- 変異テスト12パターンで全て赤くなることを確認（**修正前のコードに戻す変異**を含む）
- `src/test/transactionalEmailTenantScope.test.ts`。実際に飛んでいる4本の呼び出しを
  固定する節も入れてあり、**現在の送信が1通も止まらない**ことを形で担保している
- `security/` の配布キットに穴4として追加（兄弟5アプリも同じ穴）

### デプロイは Lovable の Publish

`deploy-functions.yml` の対象5本には**入っていない**（`config.toml` 未記載のため）。
足さないのは意図的で、ワークフローのコメントにこう書いてある:

> config.toml に無い関数を deploy すると verify_jwt がデフォルトの true に戻り、
> line-login-callback のような「JWT不要で叩かれる関数」が壊れるため。
> このため send-transactional-email 等 config.toml 未記載の関数はここに足さず、
> **Lovable の Publish に任せる。**

つまり `supabase functions deploy` を手で叩く必要は無い。**Publish で反映される。**
（一度「手動デプロイが必要」と案内したが誤り。2026-08-04 に訂正した。）

### 本番での動作確認（2026-08-04・完了）

Publish 後、**実機で予約確認メールが1通届くことを確認済み。**

これは省略できない手順。メール送信は fire-and-forget なので、
**塞ぎすぎても画面にエラーが出ず、「いつのまにか届かない」形で数日気づけない。**
今回の修正は宛先の条件を狭めているので、ここを踏まないと
「直したつもりで、実は正規のメールまで止めていた」に気づけなかった。

なお `_resolve_user_` を「自分宛だけ」に絞らなかったのが効いている。
絞っていたら**ジム側の代理予約の確認メールだけが静かに止まっていた**
（代理予約では resolveUserId が呼び出し元ではなくお客様になるため）。

---

## 穴5（2026-08-04 発見 / 2026-08-05 修正）: `send-line-message` の同じバイパス

穴4を直す過程で、**同じ形が3件目**として見つかった。

```ts
// supabase/functions/send-line-message/index.ts:44
const isTrainer = caller.userId ? await hasRole(caller.userId, "trainer") : false;
if (!isTrainer) {
  if (to === "trainer" || line_user_id) { 403 }
  if (user_id && user_id !== caller.userId) { ...targetIsTrainer チェック... }
}
```

trainer なら:
- **生の `line_user_id` 指定**（＝任意のLINEユーザー宛）が通る
- `to: "trainer"` の一斉送信が通る。しかもその宛先を作る `get_trainer_ids()` は
  **`user_roles` をテナント横断で引く**（`tenantHelper.ts` に既出の問題）ので、
  **他ジムのトレーナー全員に飛ぶ**

### 一度は「設計判断が要る」として保留した

`to: "trainer"` の一斉送信をマルチテナントでどう定義するか（自ジムだけにするのか、
廃止するのか）が決まらなかったため、2026-08-04 時点では保留にしていた。

### 2026-08-05: 呼び出し元を全部確認したら、判断は不要だった

**`to` を渡している箇所がゼロだった。**

- `trial-book` / `drop-in-book` / `trial-cancel` … `user_id: trainerId`（宛先は解決済み）
- `monthly-report-notification` … `line_user_id`（service_role）
- クライアント（`src/lib/lineNotify.ts`）… `to` を渡す型ですらない

クライアント側は既に `src/lib/tenantHelper.ts` の**自テナント限定ヘルパー**で
宛先を解決する形に移行済みで、`get_trainer_ids()` を避けるコメントが各所に入っていた。
**つまりこの分岐は死んでいた。** 意味論を決め直すのではなく**削除**した。

> 教訓: 「設計判断が要る」と思ったら、**まず呼び出し元を数える。**
> 使われていないなら、決めるべきことは何も無い。

### 直した内容

- `hasRole` を廃止。`tenant_members` を直接引いて**同一テナントか**で判定する
  （`status = 'active'` に限定。`tenant_id` が NULL の行は除外 —
  入れると「NULL 同士が一致」で所属の無い者同士が通る）
- `to` は **400 で明示的に拒否**。黙って「宛先なし＝skip」に落とすと気づけない
- 生の `line_user_id` は **service_role 専用**（LINE ID を直に指定できると
  テナントの概念を丸ごと迂回できる）
- テナント判定が例外になったら**送らない**（fail-close）

`src/test/lineMessageTenantScope.test.ts` が上記を見張る（変異7種で検証済み）。

### ついでに見つかった別の不具合

`CustomerHome` の連続来店通知が `userId`（LINE の ID）を渡していたが、
**Edge Function 側は `userId` というキーを読んでいなかった**。
宛先なしで skip され続けており、エラーも出ないので誰も気づいていなかった。
自分自身への通知なので `user_id: user.id` に直した（新しい規則でも自分宛は常に許可）。

型からも `userId` を消したので、同じ渡し方はできない。

---

## 穴6（2026-08-05 発見・修正）: `REVOKE ... FROM PUBLIC` が効いていなかった

**相談ボード（兄弟アプリ）が `pg_proc.proacl` を実際に見て発見。**
穴1〜5 と違い、**ログインすら要らない**（`anon` キーは全クライアントに埋め込まれている）。

### 「塞いだつもり」だったコード

```sql
-- 20260612061340_email_infra.sql:199-211
REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;
```

コメントには「service_role だけに限定する」と書いてあった。**限定できていない。**

Supabase は初期設定で
`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`
を入れている。`public` に関数を作った瞬間、**`anon` / `authenticated` に「明示の」EXECUTE が付く。**

そして **`REVOKE ... FROM PUBLIC` は名前付きロールへの明示 GRANT を消さない。**
ACL 上 `=X/postgres`（PUBLIC）と `anon=X/postgres` は別のエントリなので、
REVOKE は PUBLIC の分だけ消して、両ロールはそのまま残る。

### なぜ致命的だったか

対象の4関数（`enqueue_email` / `read_email_batch` / `delete_email` / `move_to_dlq`）は
**すべて `SECURITY DEFINER` で、関数の中に認可チェックが1つも無い。GRANT が唯一の防御だった。**

| 関数 | anon から叩けると |
|---|---|
| `enqueue_email` | 任意の宛先へ任意の本文を、**SPF/DKIM を通した正規ドメインから**送れる |
| **`read_email_batch`** | **配送前のキューが読める。パスワード再設定リンクが含まれる** |
| `delete_email` / `move_to_dlq` | 配送前のメールを消せる |

`read_email_batch` が最も深刻で、**アカウント乗っ取りに直結する。**

### 直した内容

`supabase/migrations/20260805000000_email_queue_revoke_roles.sql`
（`to_regprocedure` ガード付き。email_infra を流していない環境でも落ちない）

```sql
REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION %s TO service_role;
```

### 権限が「戻る」条件を正確に把握しておく

最初は「`CREATE OR REPLACE` を流すたびに既定権限が付き直す」と考えたが、**それは誤り。**
**同一シグネチャの `CREATE OR REPLACE FUNCTION` は既存の権限を保持する。**

戻るのは次の2つ:

- `DROP FUNCTION` → `CREATE FUNCTION`
- **引数の型や数を変える**（別の関数として新規作成されるため）

どちらも実際に起きるので、**定義の直後に必ず REVOKE を書く。**

### 検査

- `security/check.sql` の**検査4**（4関数を名指し）と**検査5**（`SECURITY DEFINER` 全件の棚卸し）
- CI: `src/test/emailQueueGrants.test.ts`
  - 関数名をベタ書きせず、**本体が `pgmq.` を触る関数**を対象にする（新設分も自動で拾う）
  - 「REVOKE を書いたか」ではなく**最後の定義より後ろで REVOKE されているか**を見る
  - 変異4種で検証済み（マイグレーション削除 / `FROM PUBLIC` へ弱体化 / 定義を後ろに追加 /
    REVOKE 無しのキューRPCを新設）

### 教訓

**「REVOKE と書いてあるから塞がっている」を、ACL の実物を見ずに信じていた。**
ポリシー名の思い込み（穴1）、`hasRole` を認可と見なす思い込み（穴3〜5）に続いて、
**同じ種類の失敗を権限の層でも踏んだ。**

診断は「コードにこう書いてある」ではなく、**DBに何が入っているか**を見ること。
`pg_policies` を見る検査は作っていたのに、`pg_proc.proacl` は見ていなかった。

---

## 穴7（2026-08-05 発見・修正）: DB内の関数が「他プロジェクト」を叩いていた

**相談ボード（兄弟アプリ）が実DBを見て発見。上流から全8プロジェクトを実測して確認した。**

### 何が起きていたか

remix でできた兄弟アプリの**DB内の関数**に、remix 元のプロジェクトの URL が残っていた。

```
アプリ（kyoto-salute / gvgrqaigffxtkvckjfur）
   └─ remix → ジムボード（rrbfwitprzuevzytykrq）
        ├─ remix → ピラボード / ストレッチボード / 相談ボード
        └─ remix → セッコツボード / ゴルフボード
```

その関数は vault から**自分の service_role キー**を取り出し、
**他プロジェクトの Edge Function へ Authorization ヘッダで送る。**
`notify_trainer_new_signup` は加えて**登録者のメールアドレスと表示名**も送る。

### 実測結果（2026-08-05）

| アプリ | `email_queue_*` | `notify_trainer_new_signup` | vault キー | トリガー |
|---|---|---|---|---|
| アプリ（kyoto-salute） | 自分 | 自分 | — | — |
| ジムボード | 自分 | **アプリ** ✗ | あり | 未接続 |
| ピラボード | 自分 | **アプリ** ✗ | あり | 未接続 |
| ストレッチボード | 自分 | **アプリ** ✗ | なし | 未接続 |
| 鍼灸ボード | （関数なし） | （なし） | — | — |
| **セッコツボード** | **ジムボード** ✗ | （なし） | なし | **接続済み** |
| **ゴルフボード** | **ジムボード** ✗ | （なし） | なし | **接続済み** |
| 相談ボード | 自分 | 自分（修正済み） | — | — |

**`notify_trainer_new_signup` は全アプリで `auth.users` に未接続＝一度も発火していない。**
（ジムボードは**内部トリガー30件が見えている状態でのユーザートリガー0件**なので、
「見えていない」ではないことを対照実験で確認した）

### 原因: `setup_email_infra` は一部しか書き換えない

| | setup を流した | 流していない |
|---|---|---|
| `email_queue_wake` / `email_queue_dispatch` | 自分の ref に直る | **remix 元のまま** |
| `notify_trainer_new_signup` | **直らない** | 直らない |

### 🔴 Vault セットアップが起爆装置になる

セッコツボード・ゴルフボードは**トリガーは接続済みで、vault キーが無いことだけで
止まっている**。Vault を入れた瞬間に、service_role キーが他プロジェクトへ飛び、
かつ自分のメールは永久に配送されなくなる。

**上流が配ったメール実装ガイドの Step 3-b がまさにその Vault セットアップだった。**
順序を「ref を直す → vault」に入れ替えて配り直すこと。

### 検査5-d を足した（2026-08-09）

穴9 を見つける検査が `security/check.sql` に**無かった**。
検査5-c は最後に `AND NOT (p.prosrc ~ 'auth\.uid\(\)|assert_can_act_for')` と書いていて、
**prosrc に auth.uid() があれば「照合している」とみなして除外する。**
穴9 はまさに「書いてあるのに照合になっていない」形なので、5-c を何度流しても出てこない。

その補集合を見る **検査5-d** を追加した。形1（`!=` / `<>` による NULL 素通り比較）と
形2（`COALESCE(引数, auth.uid())`）は ★★ で自動判定し、
判定できないものは **⚠️ 要目視** に落として人に回す。
`assert_can_act_for` で包んだものと `IS DISTINCT FROM`（NULL 安全な正しい形）は除外する。

**兄弟アプリは自分の実DBを見るしかなく、その道具が check.sql。**
これが無い間、兄弟に穴9を渡す手段が無かった。

`src/test/rpcCallerCheck.test.ts` に6件の番人を追加（変異7件とも赤を確認）。
特に「`!=|<>` の**出現**だけを見ない」ことが要点で、同じ式が ORDER BY 側にもあるため
CASE の判定を消しても素通りする（変異検証で発覚して直した）。

### なぜ既存の検査では届かなかったか

`src/test/edgeFunctionProjectRef.test.ts` は `supabase/functions/` を見る。
**これらの関数はリポジトリのマイグレーションに存在しない**（Management API 製）。
**リポジトリをどれだけ綺麗にしても素通りする。実DBを見る以外に方法がない。**

### 検査

- `scripts/check-schema-applied.mjs` が生成する SQL に **WRONG PROJECT REF** を追加。
  `.env` の `VITE_SUPABASE_PROJECT_ID` を読んで自動で突き合わせる。
  **`public` だけでなく全スキーマを走査**する（net / cron / vault に仕込まれると見落とす）。
  cron の POST 先も見るが、pg_cron が無い環境では落ちるので**ファイルの最後**に置いた。
- `security/check.sql` の検査6・7（兄弟アプリへの配布用）
- CI: `src/test/checkSchemaApplied.test.ts` に3件追加。変異4種で検証済み
  （セクション削除 / public 限定に戻す / 正規表現のエスケープを潰す / `.env` を読めない）

> **正規表現のエスケープに専用の検査を付けた理由**:
> JS のテンプレートリテラルでは `\.` が `.` に潰れる。潰れると `[a-z0-9]{20}` の後が
> 任意文字になり、**別ドメインまで拾って誤検出する**。`String.raw` で書いている。

### 教訓

**上流が「cron の POST 先を確認してください」と注意した結果、
相談ボードが「セットアップ前から仕込まれていた」ことを見つけた。**
注意の内容自体は正しかったが、**タイミングの想定が間違っていた**（後で入るものだと思っていた）。

そして上流は、`pg_proc.proacl` を見る検査（穴6）を追加した直後に同じ `pg_proc` を
棚卸ししていながら、**`prosrc` の中の URL は見ていなかった。**
穴6の直後に穴7が出たのは偶然ではなく、**同じテーブルを別の観点で見ていなかった**だけ。

### ジムボード本番の対応（2026-08-05 実施）

`notify_trainer_new_signup` を **`DROP FUNCTION`（CASCADE 無し）で削除**した。
`CASCADE` を付けなかったので、依存があれば失敗していた。

削除前に確認したこと:

```
auth.users の非内部トリガー : 0件（内部トリガー30件は見えている＝対照済み）
この関数を呼ぶ他の関数      : 0件
リポジトリからの参照        : 0件
vault の service_role キー  : **存在した**
```

**一度も発火していない。** ただしキーは実在したので、誰かがトリガーを付けた瞬間に
漏れ始める状態だった。**「未発火だから放置」ではなく削除を選んだ理由がこれ。**

削除後の確認:

```
WRONG PROJECT REF          : 0件（残るのは email_queue_* の自分の ref のみ）
auth.users / profiles      : 73 / 47（変化なし）
active な cron             : 4本（変化なし）
email_send_log             : pending 28 / sent 28（変化なし）
```

定義は削除前に丸ごと保存した。**復元するなら Edge Function として作り直すこと**
（service_role キーをヘッダに載せる設計そのものを残さない）。

**他の兄弟アプリ（ピラボード・ストレッチボード）にも同じ関数が残っている。**
ピラボードは vault キーが入っているのでジムボードと同じ条件。

### 兄弟アプリでの削除（2026-08-06 実施）

上と同じ手順で、**調査 → 敵対的検証（別エージェントが「安全」を否定しにいく）→ 実行 →
確認**の順で、ピラボード・ストレッチボードの本番からも削除した。

両アプリとも本体はジムボードと**バイト単位で同一**。POST 先はどちらも
`gvgrqaigffxtkvckjfur`（remix 元の「アプリ（kyoto-salute）」）だった。

```
                    ピラボード              ストレッチボード
Lovable project_id  c841c1c0-7dfa-4dde-…    26210a2c-1268-4ae3-…
Supabase ref        tlfyobddatpidykkmpci    enablfwvguohfmaampgw
vault キーの有無    あり（＝起爆装置あり）  無し（＝そもそも不発）
auth.users トリガー 0（配線されていない）   0（配線されていない）
DROP 後の越境ref    0件                     0件
```

**敵対的検証で拾えた、調査担当が見ていなかった点:**

- **proacl に `PUBLIC` の EXECUTE が入っていた**（ピラボード）。ただし `RETURNS trigger`
  なので PostgREST は RPC 公開せず、トリガー関数はトリガー以外から起動できないため実害は無し。
  DROP すれば消える。
- **マイグレーション履歴に手がかりが無い**（`supabase_migrations.schema_migrations` の
  `statements` が27/41件 NULL。実在する別トリガーの記録すら残っていない）。
  → **「過去に一度も送信されていない」は履歴からは証明できない。**
  もし過去に送信されていれば、そのときの service_role キーは**すでに相手側に渡っている**。
  DROP は「今後の経路」を断つだけで、**過去分の漏洩有無は別問題として残る。**
  ローテーションの要否は各アプリ側で判断すること。
- **ストレッチボードでは、ジムボードの穴9と同じ「NULL で素通りする比較」の関数が
  すでに3件見つかった**（`equip_item` / `get_quest_progress` / `complete_quest_stage`
  相当）。**現状は `anon` / `authenticated` / `public` すべて EXECUTE=false で到達不能**
  だが、将来 GRANT された瞬間に穴9と同じ形になる。**今回のスコープ外として実行はしていない
  が、ストレッチボード側で穴9の考え方（`mem/ops/tenant-boundary.md` の穴9セクション）を
  適用する価値がある。**

---

## 穴8（2026-08-06）: anon から呼べる SECURITY DEFINER 関数が37件あった

穴6（メールキューの4関数）と**同じ形が他にもあった。**
本番を実測したところ、**anon から EXECUTE でき、関数内に `auth.uid()` のチェックが無い
SECURITY DEFINER 関数**（トリガー関数を除く＝PostgREST から実際に呼べるもの）が **37件**。

### 共通の形

**「user_id を引数で受け取り、呼び出し元と突き合わせていない」。**

| 関数 | anon からできたこと |
|---|---|
| `buy_shop_item(p_user_id, ...)` | 他人のコインで買い物させ、**残高を0にできる** |
| `complete_dungeon_run(..., p_total_coins, p_total_exp)` | **数値を引数でそのまま渡せる**（検算なし） |
| `grant_equipment(p_user_id, ...)` | 他人に任意の装備を配れる |
| `get_ranking(p_type, p_gender)` | **全ジムの会員の user_id 一覧**（上の攻撃の材料になる） |
| `get_booked_slots(check_date)` | **全テナントの**予約表が日付指定で取れる |

### 実測（これが判断の土台）

```
呼び出し元（src/ + supabase/functions/、mcp/ を除く）
  26 / 37 件が **0件**

RLS ポリシーからの参照
  has_role              104件（うち roles={public} が 7件）
  shares_tenant_with_me  39件（{public} は0）
  get_my_tenant_id       22件（同上）
  is_tenant_member        3件 / has_tenant_role 2件
  is_tenant_over_limit    0件 / get_trainer_ids 0件

GAMIFICATION_ENABLED = false（画面からは消えている）
```

### 直し方（段階を分けた）

**段階1（`20260806120000`）: 権限だけ剥がす。壊さないことが確実な範囲。**

1. **先に**、`roles={public}` かつ `has_role` を使う SELECT ポリシー7件を
   `TO authenticated` に絞る
2. 呼び出し元0件の26件 → `anon` / `authenticated` の**両方**から剥がす
3. ログイン後に呼ぶ8件 → **`anon` だけ**剥がす

**段階2（未着手）**: 関数内に `auth.uid()` の照合を入れる／使わない関数を消す。

### 🔴 順序を間違えると壊れる

**ポリシーを絞る前に `has_role` の anon を剥がすと、**
未ログインでそのテーブルを読んだときに **0件ではなく
`permission denied for function has_role`** が返る。

### 🔴 塞いではいけないものが混ざる

```
get_tenant_public              未ログインの予約ページのジム名・ロゴ・営業設定
get_tenant_booked_slots        同じく空き枠
lookup_tenant_by_invite_code   招待リンクからの参加（ログイン前に照合）
```

**塞ぐと未ログインの予約ページが真っ白になる。**
「anon から呼べる＝危険」で一律に処理すると、ここで事故る。

### 🔴 `has_role` を authenticated から剥がさない

**104件のポリシーが使っている。剥がすとアプリ全体が即死する。**

### 検査

- `src/test/anonRpcExposure.test.ts` … マイグレーション側を見る
  （公開が仕様のものを塞いでいないか／危険なものを取りこぼしていないか／
  `has_role` を authenticated から剥がしていないか／ポリシーを絞る手順が先にあるか）。
  変異4種で検証済み
- `security/check.sql` の**検査5-b** … 実DBで、**user_id を引数に取るか**で並べ替えて出す

**実際の ACL は DB にしか無いので CI からは見えない**（穴6・穴7と同じ層）。
リポジトリ側で見張れるのは「マイグレーションが正しい形か」まで。

---

## 穴8の本番適用と、そこで**壊した**話（2026-08-06）

`20260806120000` の SQL を本番（Lovable `69ac2641-45d8-44e0-b60d-4e002a4f9c1c`）へ
①〜⑤の順に流した。**結果は 37件 → 3件**（残ったのは公開が仕様の3つだけ）。

ただし途中で **本番のログイン済み画面をほぼ全部落とした。** 経緯を残す。

### 🔴 RLS のポリシー式は「クエリを投げたロール」の権限で評価される

`20260806120000` の第2章に、こう書いていた。

> RLS の内部で使う述語。**ポリシーの中からは所有者権限で評価されるので影響しない**

**これは誤り。** `shares_tenant_with_me` / `is_tenant_member` / `has_tenant_role` を
`authenticated` から剥がした直後、本番で実測すると:

```sql
BEGIN;
SELECT set_config('request.jwt.claims','{"sub":"<user>","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT count(*) FROM public.announcement_reads;
-- ERROR: 42501: permission denied for function shares_tenant_with_me
```

**`SECURITY DEFINER` が効くのは「関数の中身」であって「関数を呼べるかどうか」ではない。**
EXECUTE の判定は呼び出し元のロールに対して行われる。
だからこそ第1章（anon 向けポリシーを先に絞る）が必要だった —
**あの手順が正しくて、第2章のコメントが間違っていた。同じ理屈なのに逆に書いていた。**

影響したポリシー数:

```
shares_tenant_with_me   39件（announcement_reads ほか tenant_user_isolation 系）
is_tenant_member         3件（tenant_members）
has_tenant_role          2件（tenant_members の owner 限定の書き込み）
```

`20260806140000_restore_rls_predicate_grants.sql` で `authenticated` にだけ戻した。
**`anon` からは剥がしたまま**（44件とも `TO authenticated` なので anon は評価しない）。

`is_tenant_over_limit` は戻していない。ポリシーから使われておらず、呼び出し元は
`get_tenant_limit_status` / `enforce_tenant_plan_limit` の2つだけで、**どちらも
SECURITY DEFINER なので中の呼び出しは所有者権限で通る。**

### 検査を足した

`src/test/anonRpcExposure.test.ts` に
**「RLS ポリシーが使う関数を authenticated から剥がしていない」** を追加した。
名指しのリストではなく、マイグレーションを畳み込んで機械的に見る:

1. 全マイグレーションを名前順に走査し、DOブロック単位で
   `REVOKE ... FROM ... authenticated` / `GRANT ... TO authenticated` を畳み込む
2. `effectivePolicies()` の `USING` / `WITH CHECK` から呼ばれている関数名を集める
3. 交差が空でなければ落とす

変異3種（復旧マイグレーションを消す／GRANT 先を service_role に変える／
`has_role` を authenticated の REVOKE 側へ移す）で赤を確認済み。

### 本番で確認したこと（`SET LOCAL ROLE` で実際に演じた）

コンテナからは `*.supabase.co` へ直接出られない（プロキシが CONNECT を 403 で落とす）。
**代わりに Lovable の SQL から `SET LOCAL ROLE anon` でロールを演じて確認した。**
トランザクション内なので `ROLLBACK` で必ず戻る。

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT
  (SELECT gym_name FROM public.get_tenant_public('<tenant>'::uuid)) AS gym_name,
  (SELECT count(*) FROM public.get_tenant_booked_slots('<tenant>'::uuid,
                                CURRENT_DATE, CURRENT_DATE + 14)) AS slots;
ROLLBACK;
-- → パーソナルジムSalute御所南 / 34件（未ログインの予約ページは無事）
```

同じやり方で確認したこと:

```
anon で7つのゲーミフィケーション表を読む   → 0件（42501 ではない＝①の順序が正しかった）
anon で get_ranking を呼ぶ                 → 42501 permission denied（塞げている）
authenticated で announcement_reads を読む → 復旧後は通る
```

**さらに、ポリシーと権限の食い違いを総当たりで見る SQL を回して 0件を確認した。**
これは今後も適用後に必ず流す:

```sql
WITH fns AS (
  SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'),
pol AS (
  SELECT tablename, policyname,
         coalesce(qual,'')||' '||coalesce(with_check,'') AS expr,
         CASE WHEN roles='{public}' THEN ARRAY['anon','authenticated']
              ELSE roles::text[] END AS check_roles
  FROM pg_policies WHERE schemaname='public')
SELECT DISTINCT f.proname, r, pol.tablename, pol.policyname
FROM pol JOIN fns f ON pol.expr ~ ('\m'||f.proname||'\M')
CROSS JOIN LATERAL unnest(pol.check_roles) AS r
WHERE r IN ('anon','authenticated')
  AND NOT has_function_privilege(r, f.oid, 'EXECUTE');
-- 0件でなければ、その画面は落ちている
```

SECURITY INVOKER 関数・トリガー関数から呼ばれる先についても同じ形で 0件を確認した
（内部呼び出しは DEFINER なら所有者権限で通るが、**INVOKER なら通らない**）。

### 教訓

- **「呼び出し元が0件だから剥がしてよい」は、`src/` の grep だけでは判断できない。**
  RLS ポリシーとトリガーは grep に出ない呼び出し元。
- 権限を剥がしたら、**適用後に必ず「そのロールを演じて」読む。**
  `has_function_privilege` が期待どおりでも、ポリシー越しの評価は別の話。
- 剥がす作業は `anon` と `authenticated` を**必ず分けて**扱う。
  1つの配列にまとめた瞬間に事故る。

---

## 穴9: 未ログインで会員データを消せた（2026-08-06・段階2の途中で発見）

穴8の段階2（「`authenticated` に残した関数に `auth.uid()` の照合を入れる」）を
やっている最中に、**段階1の検査が見逃していた形**が出てきた。

段階1の検査は `prosrc` に `auth.uid()` が含まれる関数を「照合している」とみなして
**除外していた。** 書いてあるのに照合になっていない形が3種あった。

### 🔴 形1: NULL で素通りする比較（三値論理）

```sql
IF NOT public.has_role(auth.uid(), 'trainer') AND auth.uid() != _customer_id THEN
  RAISE EXCEPTION '権限がありません';
END IF;
```

未ログイン（anon）だと `auth.uid()` は **NULL**。

```
NULL != _customer_id  →  NULL   （false ではない）
true AND NULL         →  NULL
IF NULL THEN          →  通らない ＝ 例外が出ない
```

**RAISE を素通りして本体が走る。** `delete_customer_cascade` がこの形だった。

```sql
DELETE FROM workouts / bookings / meals / messages
     / notification_settings / profiles / user_roles   WHERE user_id = <任意>
```

**anon キーはアプリに埋め込まれているので、ログイン不要で誰の会員データでも消せた。**
実測で anon から実行できることを確認している（存在しない user_id で試したので実害なし）。

加えて `has_role(auth.uid(),'trainer')` は**グローバルなロール判定でテナントを見ない**。
つまり**A院のトレーナーが B院の会員を消せる**状態でもあった。

同じ形: `complete_quest_stage` / `equip_item` / `get_quest_progress`
（`IF v_user <> auth.uid() AND NOT has_role(...) THEN`）。

### 形2: 引数を優先して照合が無い

```sql
v_user := COALESCE(p_user_id, auth.uid());
IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;
```

**引数を渡した時点で `auth.uid()` は見ない。**「認証が必要です」は
「引数も無く未ログイン」のときしか出ない。
`execute_quest_battle` / `get_player_combat_stats` がこの形。

### 形3: そもそも照合が無い

`apply_raid_damage` / `check_*_milestones` / `process_session_rewards` /
`update_event_progress` / `spin_gacha`。

### 直し方: 本体に触らず「包む」

対象は12関数・合計40KB超の plpgsql。**1行足すために本体を書き写すと、
写し間違いがそのままロジックの破壊になる。**

```
1. 既存の関数を <name>_unchecked に RENAME（本体はバイト単位で不変）
2. _unchecked から EXECUTE を全部剥がす
3. 元の名前で「照合してから中身を呼ぶだけの関数」を作り直す
```

**ロジックの差分はゼロ**で、認可の判定が1か所（`assert_can_act_for`）に集まる。
`delete_customer_cascade` だけは本体が短く、かつ壊れた IF を消す必要があるので直接書き換えた。

`20260806160000_rpc_caller_check.sql`。

### 条件は「本人 **または** 同じテナントの owner / trainer」

**本人限定にすると壊れる。** トレーナーが会員の user_id を渡す経路が本物としてある。

```
TrainerWeightJourneyPanel.tsx:104   check_weight_milestones(clientId)
TrainerClientDetail.tsx:499-538     process_session_rewards / check_training_milestones
                                    / apply_raid_damage / update_event_progress
TrainerClientList.tsx:178           delete_customer_cascade(clientId)
useMeasurements.ts:71               本人 or トレーナー（useMeasurements(clientId)）
```

`get_my_tenant_id()` は `LIMIT 1` なので複数テナントに属する人を取りこぼす。
`tenant_members` 同士を突き合わせること。

`auth.uid()` が NULL のときは素通しする（service_role・cron・トリガーの内部呼び出し）。
anon は EXECUTE を剥がしてあるので、NULL に到達できるのは service_role だけ。

### 引数名は変えないこと

PostgREST の RPC は**名前付き引数**。`p_user_id` と `_user_id` が混在しているが、
**揃えると呼び出し側が 404 になる。** 検査で見張っている。

### 実測での確認（ロールを演じた）

```
会員 → 自分                    allowed
会員 → 同テナントの他人        42501     ★塞ぎたかった穴
会員 → 他テナントの他人        42501
owner → 自分                   allowed
owner → 同テナントの会員       allowed   ★トレーナーの経路（壊してはいけない）
owner → 他テナントの会員       42501     ★これも塞がった（旧: グローバル trainer 判定）
未ログイン → 誰かを削除        42501 permission denied
NULL を渡す                    22023
```

**トレーニング記録の保存（workouts への INSERT）が通ることも実測した。**
`workouts` の AFTER トリガーが `execute_quest_battle` を呼ぶため。
トリガー関数は SECURITY DEFINER かつ EXCEPTION を握りつぶすので、
照合で落ちても INSERT は失敗しない。

### 検査

- `src/test/rpcCallerCheck.test.ts`
  **クライアント側の `supabase.rpc(...)` を走査して逆に辿る**ので、
  新しい RPC を足したら自動で対象に入る（名指しのリストにしない）。変異5種で検証済み
- `security/check.sql` の**検査5-c** … 実DBで
  「`authenticated` が呼べる VOLATILE で user_id を取り、照合が無い」を出す。**0件が正常**

### ついでに分かったこと

`process_session_rewards` は**本番で動いていない**。本体が参照する
`public.training_sessions` が存在せず 42P01 になる。呼び出し側が
`GAMIFICATION_ENABLED = false` ＋ `try/catch`（non-fatal）なので誰も気づいていなかった。
**ゲーミフィケーションを復活させるなら、まずここが直っていない。**

### 教訓

- **`auth.uid()` を書いてあることは、照合していることを意味しない。**
  `prosrc ~ 'auth.uid()'` で除外する検査は、この3種を素通しする。
- **`<>` / `!=` で `auth.uid()` を比べない。** 未ログインで NULL になり、
  `AND` で繋いだ IF が丸ごと NULL になって通らない。
  比べるなら `IS DISTINCT FROM`、あるいは先に `IS NULL` を弾く。
- **`COALESCE(引数, auth.uid())` は照合ではない。**「引数優先」と読む。
- グローバルな `has_role(uid,'trainer')` は**テナントを見ない**。
  マルチテナントでは必ずテナント込みで判定する。

---

## 穴10: お客様が同じジムの他のお客様のメンバー情報を読めた（2026-10-31）

宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」で点検して見つけた。

### 見つけ方（本番でお客様を演じて、全テーブルを数えた）

お客様1人を演じ（`request.jwt.claims` ＋ `role = authenticated`）、public の全テーブルについて
「自分以外の user_id / customer_id / client_id の行」「別のジムの行」を `EXECUTE format(...)` で数えた。

```
tenant_members          他の人の行 = 51（他のお客様49人＋スタッフ2人）  ← 穴
staff_schedules         他の人の行 = 2（先生のシフト。予約画面に要る＝正しい）
booking_frequency_limits 他の人の行 = 1（ジム全体の設定で user_id は NULL＝個人の情報ではない）
別のジムの行              すべての表で 0
```

別のジムのオーナー（グローバルな trainer ロールあり）を演じても、宗本さんのジムの行は全テーブルで 0。
**テナントの境界は効いている。お客様どうしの話だった。**

### 何が読めたか

ポリシー `"Members can view same tenant members"`（`is_tenant_member(tenant_id, auth.uid())` だけ）が、
そのジムのメンバーなら誰にでも全行を見せていた。tenant_members には
名前・プラン・残り回数・更新日・休会の期間・退会日・**退会の理由**まで入っている。
画面には出していないが、ログインしたお客様なら公開キー＋自分のログインで API から読める。

### 直し方（`20261031020000_tenant_members_customer_privacy.sql`）

```
スタッフ（オーナー・トレーナー・インストラクター） … 同じジムの全員の行（今まで通り）
お客様                                         … 同じジムのスタッフの行だけ（担当の名前に要る）
                                                  ＋ 自分の行（別のポリシー "Users can view own membership"）
```

- お客様の画面が読んでいるのは「自分の行」と「スタッフの行（role IN owner/trainer）」だけだった
  （useAllCustomerProfiles 等の全員を読む処理はトレーナーの画面だけ）
- この表を読む SECURITY INVOKER の関数は無い。Edge Function は service_role で読むので影響しない

### 本番で確かめたこと（2026-10-31・3段構え）

```
1. 検査8（security/check.sql）で穴を確認 → 1件（"Members can view same tenant members"）
2. 適用（BEGIN/COMMIT）
3. 演じて読む: お客様 = 3行（自分1＋スタッフ2・他のお客様 0）／ オーナー = 52行 ／ インストラクター = 52行
              ／ 未ログイン = 0行 ／ 検査8 = 0件
```

見張り: `src/test/tenantMembersPrivacy.test.ts`・`security/check.sql` の検査8

## 2026-10-31 の点検の続き（穴10 のあと）

### 書き込み: お客様は他の人の行を書き換え・削除できない（確認のみ）

お客様を演じて、user_id / tenant_id を持つ全テーブルで「自分以外の行（設定の表は全行）」に
値を変えない UPDATE と DELETE を試した（最後に RAISE で全部戻す）。**どの表も0行**（RLS で弾かれる）。

### 外から呼べた関数: member_first_unpaid_cycle_start（閉じた）

`security/check.sql` 検査5-b の ★★。会員の「入金がまだのサイクルの始まり」を返す関数を、
**未ログインでも他人の user_id を渡して呼べた**（誰が未払いかを調べられる）。
呼んでいるのは SECURITY DEFINER の2本だけ（get_my_next_cycle_payment_gate・guard_booking_next_cycle_payment）で、
RLS でも使っていないので、外からの EXECUTE を外した（`20261031030000_close_member_payment_rpc_and_bucket_listing.sql`）。
お客様の予約画面の支払いの判定（get_my_next_cycle_payment_gate）は今まで通り動くことを演じて確かめた。

ほかの 5-b の行は公開が仕様のもの（体験予約ページ・アプリの更新の案内・招待コード）。
`get_my_staff_invite_code` / `regenerate_staff_invite_code` は本体（`_owner_staff_invite_code`）が
「スタッフ」の招待を終了済みとして NULL / 例外を返すので安全。

### 公開の置き場の一覧（閉じた・検査9）

avatars・gym-assets は公開の置き場で、`bucket_id = '...'` だけの SELECT ポリシーが付いていた。
公開の置き場のファイルは URL で読める（RLS を通らない）ので、このポリシーが効くのは**一覧**だけ。
未ログインで avatars 6件・gym-assets 4件の一覧が取れ、ファイル名にオーナーの user_id・ジムの id が入っていた。
本人（avatars）と、そのジムのスタッフの自分のジムのフォルダ（gym-assets）だけに絞った。
⚠️ `upload(..., { upsert: true })` は SELECT も要るので、本人には残すこと。
本番で演じて確認: 未ログインの一覧 0件 ／ オーナーは自分のロゴを一覧できる（ロゴの削除が動く）。

見張り: `src/test/memberPaymentRpcAndBucketListing.test.ts`・`security/check.sql` の検査9

### お知らせの画像の置き場（2026-11-01・機能追加。穴ではない）

宗本さん「お知らせで画像を送れる様にして」で、非公開の置き場 `announcement-images` を作った。
読めるのは「そのジムのスタッフ」と「その画像が付いたお知らせを読める人」（`announcements` の RLS をそのまま使う）。
上げる・消すはオーナーだけ（インストラクターは不可）。上書きのポリシーは無い。表示は署名つきの URL。
`_announcement_image_paths_ok` は未ログインでも呼べるが、表を読まない文字列の検査だけ（害は無い）。
本番で演じて確認済み。詳細は `mem/features/announcement-images.md`。

## 穴11: お客様が「trainer の印」を付けると、同じジムの全員のデータが読めた（2026-10-31）

同じ点検の続き。Edge Function の監査（ワークフロー）で「signup-trainer は誰でも呼べる」が改めて出て、
**お客様が自分に印を付けたらどうなるか**を本番で演じて分かった。**この点検で一番重い穴。**

### 何が起きていたか

92本のポリシー（public 82・storage 10）が `has_role(auth.uid(), 'trainer')` だけでスタッフと見なしていた。
「別のジムから」は RESTRICTIVE（`tenant_id = get_my_tenant_id()` / `shares_tenant_with_me`）が防いでいたが、
**同じジムのお客様**の get_my_tenant_id() は自分のジムなので、絞りごと通る。上の「結論」の表は
「書き込みに AND を足せば安全」としていて、**読み取りと、同じジムの中の話が抜けていた**。

本番で演じた結果（ROLLBACK 済み。印を持つお客様は本番に0人＝実害なし）:

```
お客様＋印          他人のプロフィール 43・予約 655・メッセージ 171・食事の写真 14・体組成 159
招待コード無しで入った部外者＋印   プロフィール 44・予約 671・メッセージ 171（同じ）
お客様＋印の書き込み  自分の過去の予約を消せた・未来の予約を直接キャンセルにできた（トリガーも印で素通り）
別のジムのオーナー    user_roles を全ジム分 85行読めた（この表だけ RESTRICTIVE が無かった）
```

### 直し方（`20261031040000_staff_checks_tenant_scoped.sql`）

**印の判定だけを差し替え、ほかの条件は1文字も変えない。** 名前・コマンド・対象は本番の実物と突き合わせた。

| 表 | 差し替え先 |
|---|---|
| tenant_id がある21表 | `has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])`（message_reactions は `m.tenant_id`） |
| 人ごとの5表（profiles・weight_journey・skeletal_diagnoses・announcement_reads・user_roles） | `is_staff_of_user(user_id)`（新設） |
| google_calendar_tokens（自分の行だけ） | `auth.uid() = user_id AND is_staff_somewhere()`（新設） |
| 写真の置き場（meal/progress/posture） | `has_tenant_role(get_my_tenant_id(), …) AND shares_tenant_with_me(フォルダ)`（後半は今まで通り） |
| gym-assets | `has_tenant_role(get_my_tenant_id(), …)` |
| トリガー2本（予約の削除・変更の制限） | `has_tenant_role(OLD.tenant_id, …)` |
| get_my_tenant_invite_code | `has_tenant_role(t.id, …)` |

残したのは2つだけ（まだジムが無いので印で見るしかない）:
avatars の tenant-logos へのアップロード（名前は `tenant-logos/<自分の user_id>-` に限られている）と create_gym_with_owner。
ついでに、2026-09-05 に表ごと消したゲーム機能（装備）の関数4本の残り（印で判定・1本は未ログインで呼べた）を消した。

#### 🔴 is_staff_of_user は「相手の在籍の状態」を見ない

最初は相手も `status = 'active'` に絞ったが、**顧客の詳細画面が壊れる**ので外した。
TrainerClientDetail は `user_roles` が読めるかでチャット欄を開く（isRegistered）。退会したお客様の
ロールが読めないと、チャット履歴があるのに「未登録」と出る。profiles など4表は RESTRICTIVE
（shares_tenant_with_me＝在籍中だけ）が別にかかるので、相手を絞らなくても見える範囲は今まで通り。
写真の置き場は RESTRICTIVE が無いので、今まで通り shares_tenant_with_me を残した。

### 本番への適用（2026-10-31・3段構え）

```
1. 試運転（DO ブロックの最後に RAISE で全部戻す）: 前後の件数を4人分（オーナー・インストラクター・お客様・
   別のジムのオーナー）＋攻撃役2人で数えた
2. 適用: 1回の DO ブロックで「md5 がリポジトリのファイルと一致 → 前を数える → 流す → 後を数える」。
   オーナー・インストラクター・お客様のどれかで1件でも変われば RAISE で自動的に巻き戻す形にした
   （user_roles だけは減るのが正しいので比べない）。→ 通った
3. 演じて読む（RAISE で戻す）:
   オーナー  … プロフィール 44・予約 671・メッセージ 171・記録 2452（前と同じ）／ user_roles 85 → 48（他のジムの分が消えた）
   お客様＋印 … 自分の分だけ（プロフィール 1・予約 58）／ 過去の予約の削除 → 「過去の予約は削除できません。」
   部外者＋印 … 0（お客様向けの公開分だけ。お知らせ 3 等）
   退会したお客様のロール … 8人中、ロールがある2人はオーナーから読める（残り6人は元々ロールが無い）
   検査10 ＝ 例外の1行だけ ／ 検査10-b ＝ create_gym_with_owner だけ
```

### 残っていたこと → 穴12 で塞いだ

**招待コード無しで、お客様として任意のジムに入れる**（tenant_members の自己 INSERT が招待コードを見ていない）。
穴11 の修正で「入れても印でスタッフにはなれない」ので、届くのはお客様向けの公開分（お知らせ・種目名・スタッフの名前）まで
になっていた。下の「穴12」で塞いだ。

### 教訓

- **RESTRICTIVE のテナント絞りは「別のジム」しか守らない。** 同じジムの中の昇格（お客様→スタッフ）は防げない。
  検査2・3／globalTrainerRole.test.ts はこの前提で書かれていたので、検査10 と穴11 の describe を足した
- テストのポリシー解析（`src/test/helpers/rlsPolicies.ts`）が `DROP TABLE` を知らず、消した表の48本を
  「まだ有効」と見ていた。本番の92本とリポジトリの有効なポリシーを**名前で突き合わせて**気づいた（今は一致）
- `DROP POLICY IF EXISTS` は表が無いと落ちる（security/README.md の罠3）。消えた表のポリシーを消そうとしないこと

見張り: `src/test/globalTrainerRole.test.ts`（穴11 の describe）・`security/check.sql` の検査10・10-b

## 穴12: 招待コードを知らない人が、お客様として好きなジムに入れた（2026-10-31）

穴11 の検証の途中で、部外者を演じたときに「招待コード無しで自分を入れる → 通った」が出て分かった。

### 何が起きていたか

`tenant_members` の INSERT ポリシー `"Users can insert own membership"` は
`user_id = auth.uid() AND (role = 'customer' OR (role = 'owner' AND 自分のジム))`。**customer ならどのジムにでも入れた。**
ジムの id は体験予約ページの URL などに出ているので、ログインした人なら API で入れる。
入るとお客様向けの情報（お知らせ・スタッフの名前・種目）が読め、予約もできる。穴11 が開いていた間は、
ここから印を付けてジムの全員のデータまで届いた。

### 直し方（`20261031050000_customer_join_requires_invite_code.sql`）— 画面の手順は変えない

参加の画面（JoinGym）は、どの版も「`lookup_tenant_by_invite_code` でコードを確かめる → 自分を upsert」の順
（2026-05-17 に参加の仕組みを作ったときから同じ）。**ネイティブの古い版も同じなので、画面を変えずに塞げる。**

```
1. コードの確認（lookup）が当たったら、ログインしている本人に参加券を出す
   tenant_join_tickets（本人 × 招待コード × 時刻）… 24時間有効。ポリシー無し・権限無し（関数からだけ）
2. BEFORE INSERT トリガー（guard_customer_self_join）: current_user = 'authenticated' で role = 'customer' なら、
   そのジムの「今の」招待コードの券が無ければ「招待コードを確認してから参加してください」
```

- 券を**招待コード**で持つのがミソ。コードを作り直すと古い券は使えない／tenant_id を持たないので
  delete_my_gym の消し込み（gymOwnership.test.ts が types.ts から洗う）も要らない
- 🔴 門番は **SECURITY INVOKER**。`current_user` で「画面から」と「関数の中（開設・取り込み・スタッフの参加は所有者）・
  Edge Function（service_role）」を見分けている。DEFINER にすると常に所有者になって素通りになる
- lookup は STABLE（sql）→ VOLATILE（plpgsql）。PostgREST は STABLE の関数を読み取り専用で呼ぶことがあるので、
  スキーマの読み直しが済むまでに呼ばれても落ちないよう、券の書き込みの `read_only_sql_transaction` は握りつぶす
  （本番は `pgrst_ddl_watch` があり、DDL のあと自動で読み直される）

### 本番への適用（2026-10-31・3段構え）

```
1. 試運転（RAISE で全部戻す）:
   適用前 … コード無しで入る → 通った（穴）
   適用後 … コード無し → 断られる ／ 間違ったコードで確かめてから → 断られる
            正しいコードで確かめてから（ハイフン入り・大文字でも）→ 入れる
            未ログインの検索 → 今まで通り1件・券は出ない ／ 読み取り専用での検索 → 落ちずに1件
            券を取ったあとにコードを作り直す → 古い券では断られる ／ 管理側（所有者の権限）からの追加 → 対象外
2. 適用: md5 がファイルと一致することを確かめてから流し、同じ処理の中で「コード無しは断られる・コードありは入れる」
   を演じて、違えば自動で巻き戻す形にした → 通った（試しの行と券は残っていない）
3. 演じて読む: コード無し → 断られる ／ コードを確かめてから → 入れる → 見える所属はスタッフ2人と自分の3行
```

見張り: `src/test/customerJoinInviteCode.test.ts`・`security/check.sql` の検査11

## 穴13: 自分のジムの予約・チャットに、他のジムの人を入れられた（2026-10-31）

Edge Function の監査の指摘（notify-new-booking-1・notify-new-message-1）。穴11・12 を塞いだあとも残っていた。
**ジムは誰でも開ける**ので、「スタッフなら自分のジムの行を作れる」は誰にでもできる。問題は行の中の**相手**だった。

### 何が起きていたか

```
予約   … bookings.user_id に他のジムの人を入れる
         → notify-new-booking（service_role）がその人の氏名を読み、send-transactional-email がその人のアドレスへ「予約確認」
         → email_send_log に宛先アドレスと氏名が残り、攻撃者のジムのスタッフ（＝本人）が通知履歴で読める
         → user_id の一覧を「アドレス＋氏名」に変換できる。差出人名・案内文は攻撃者の設定＝正規ドメインのなりすまし
チャット … messages.receiver_id に他のジムの人を入れる → notify-new-message（service_role）がプッシュを中継
         同じジムのお客様どうしでも送れた（画面には無い使い方）
```

他のジムのオーナーの user_id は、ロゴのファイル名（`tenant-logos/<user_id>-…`。get_tenant_public が未ログインに返す）や
空き枠の担当（get_tenant_booked_slots の staff_user_id）から取れる。本番で演じて確認（ROLLBACK 済み）:
自分で開いたジムのオーナーが、Salute のお客様の予約・メッセージを自分のジムに作れた。

### 直し方

| 表 | 門番（BEFORE INSERT / UPDATE OF の相手の列） |
|---|---|
| bookings | `user_id` がそのジムに所属（在籍の状態は問わない）… `20261031060000_booking_user_must_be_member.sql` |
| messages | `receiver_id` がそのジムに所属。送り主がスタッフでなければ宛先はスタッフ … `20261031070000_message_receiver_must_be_member.sql` |

- どちらも `current_user = 'authenticated'`（画面から）のときだけ見る。予約・メッセージを作る DB 関数は無く、
  Edge Function（service_role）は対象外。🔴 門番は SECURITY INVOKER
- 「在籍の状態は問わない」にしたのは、退会したお客様へのスタッフからの連絡や、過去の予約の扱いを止めないため
- 本番のデータ: 予約 959件中、所属していない人の予約は古い4件（直近90日 0）。メッセージ 223件中、所属外の宛先・
  お客様からスタッフ以外への送信は古い8件（直近90日 0）。既存の行は触らない（UPDATE OF の列を変えたときだけ見る）

### 本番への適用（2026-10-31・3段構え）

```
1. 試運転（RAISE で戻す）… 適用前は攻撃が通る → 適用後は「このジムに所属していない方の予約は作れません」
   「このジムに所属していない方には送れません」「メッセージはジムのスタッフにだけ送れます」で断られる。
   代理予約・状態の更新・お客様本人の予約・お客様→オーナー・オーナー→お客様（退会した人も）・既読は今まで通り
2. 適用 … md5 がファイルと一致してから流し、同じ処理の中で「攻撃は断られる・正規は通る」を演じ、違えば自動で巻き戻す
3. 演じて読む … 同じ結果。試しの行は残っていない。検査12 = 2行とも OK
```

### 残り（Edge Function 側）→ 下の「Edge Function の直し」で対応

notify-new-booking / notify-new-message でも、送る前に相手の所属を確かめる（多層防御）。
send-transactional-email の service_role 経路（宛先の解決）は未対応。

見張り: `src/test/bookingUserMembership.test.ts`・`security/check.sql` の検査12

## Edge Function の直し（2026-10-31・点検ワークフローの指摘）

| 指摘 | 直したこと |
|---|---|
| google-calendar-sync-1（high） | 印（hasRole(trainer)）で認可を素通りしていた → **その予約のジムの有効なスタッフ**か**お客様本人の予約（体験は除く）**だけ。sync_all は呼んだ人がスタッフのジムだけ |
| google-calendar-sync-2（medium） | 予定の中身・消す予定の ID をリクエストから取っていた → **予約行から**作る・消す（ID はエンコード）。1予約につき予定は1件。service_role の呼び出し元（trial-book・drop-in-book）だけは表示用のラベルを渡せる |
| google-calendar-callback-1（high） | 本人がトークンを API で読めた → `20261031080000_calendar_tokens_column_grants.sql` で access_token・refresh_token の列を画面から読めない・書けないようにした（id など連携の有無を見る列と、解除の DELETE は残す）。本番適用済み |
| notify-new-booking / notify-new-message | 送る前に相手（予約の人／送り主と宛先）の所属を確かめる（穴13 の DB の門番に重ねる） |

🔴 google-calendar-sync の作成・削除は、クライアントから見て挙動が変わらないことを確かめてある:
予約の作成（予約の行ができてから呼ぶ）・キャンセル（行を消す前に呼ぶ）・オプションの変更（消してから作る）・
予約変更の巻き戻し（calendarResync）は、どれも予約行が在るうちに呼んでいて、渡している値も行の値と同じ。

### 2回目: 通知とログ（同じ日）

| 指摘 | 直したこと |
|---|---|
| send-push-notification-2（medium） | 通知の url の判定を `_shared/safeUrl.ts` にまとめ、空白・制御文字・バックスラッシュを拒否し、解決した先の origin を比べる。開く側（`src/lib/safePath.ts`・`public/sw.js`）も同じ判定にした。`"/\evil.example"`・`"/<タブ>/evil.example"` は「/ で始まり // で始まらない」を通るのに、開くと外部サイトに解決されていた |
| send-push-notification-3（medium） | 体験予約の通知（purpose = trial_booking）は service_role だけ（以前は未ログインで、同じ ID で何度でも・url も指定できた）。正規の呼び出し元は trial-book・drop-in-book で、どちらも service_role |
| send-push-notification-4（medium） | キャンセル待ちの認可で、本人が書き換えられる profiles.tenant_id を根拠にしない（本番で該当者0人を確認してから外した） |
| send-push-notification-5（medium） | 先生の担当の判定は、先生のジムの予約・記録だけで行う。外れたときも理由を応答に出さない |
| auth-email-hook-1/2・送信メールのログ | ログイン用のリンク（token_hash 入り）をログに出さない。メールアドレスは `_shared/logSafety.ts` の maskEmail で伏せ字（send-transactional-email に見落としが2か所あり、テストが見つけた） |

見張り: `src/test/pushUrlSafety.test.ts`（攻撃の形14通りを、送る側・アプリ・Service Worker の3か所で実際に動かして確かめる）・
`src/test/logSafety.test.ts`（console の呼び出しを全部拾って、伏せ字にしていない宛先・トークン入りの URL が無いか見る）

### 本番への反映（2026-10-31・済み）

| PR | 反映 | 新しいコードが動いていることの確かめ方（どれも何も送らない） |
|---|---|---|
| #472 | google-calendar-sync・notify-new-booking・notify-new-message を Lovable でデプロイ | notify-new-message: 所属外の宛先の古いメッセージに**先に送信済みの印（notification_dedupe）を付けてから** x-cron-secret で叩く。旧コードは `already_sent`、新コードは `party_not_member`（確認後に印は消した） |
| #473 | send-push-notification・send-transactional-email・auth-email-hook をデプロイ。Web を Publish（sw.js・safePath） | 未ログインで `purpose = trial_booking`（存在しない ID）→ 旧 404・新 403。url に `"/\evil.example"` → 新は 400 `Invalid url`（旧は認証まで進む） |

🔴 デプロイ済みの関数を差し替えたときは「404 でない」では足りない（旧コードでも 404 でない）。
**旧コードと新コードで返事が変わる呼び方**を、デプロイの前に1回叩いて基準を取ってから使う。
service_role / cron 用の関数は、送信済みの印を先に付けておけば、旧コードでも実際には何も送らない。

### 残り

- **OAuth の state をブラウザに結びつける**（google-calendar-callback-1 の残り）。今は「同意リンクを踏ませると、
  その人の Google のトークンが攻撃者の行に保存される」までは起きうる（読めないので、攻撃者のジムの予約が
  その人のカレンダーに書かれる程度）。連携の完了をログイン中の本人が確かめる形にするには画面の変更が要る
- send-transactional-email の service_role 経路で、宛先の解決（_resolve_user_）をそのジムの人に限る
- 点検ワークフローの medium / low の残り（体験予約のメール中継・ドロップインの枠埋め・LINE の state・
  通知の回数制限 など）。Stripe の sandbox と Pro のコンプ判定は下の穴14 で直した
- ~~オーナーの引き継ぎ（transfer_gym_ownership）が tenants.owner_user_id を変えない~~ → 下の穴23 で直した（2026-11-01）

---

## 点検の残り（2026-11-01 時点・定期点検はこれを報告しない）

定期点検（`mem/ops/security-audit.md`）の点検役は、ここに書いたものを「既知」として外す。
**直したら、ここから消して「穴N」の節を書く。** 判断が出たら、その結果をここに書く。

### 宗本さんの判断済み: 今のままにする（2026-11-01・宗本さん「これいいです」）

次の4つは**今のままにする**と決まった。定期点検はこの4つを報告しない（直す・作り直す提案もしない）。
状況が変わったら（購読の鍵を作り直す機能を作る・問診フォームをやめる・AI 連携を使い始める・テスト用のジムを作る など）、そのときに見直す。

| 指摘 | 何が起きうるか | 今のままにした理由（判断の前に書いていたもの） |
|---|---|---|
| calendar-feed-1（low） | スタッフは顧客一覧で `profiles.select("*")` をしていて、お客様の `calendar_token` を受け取っている。calendar-feed はそのトークンだけで、そのお客様の今後の予約を**全部のジムの分**返す（service_role・テナントで絞らない）。トークンは作り直せないので、辞めた後も他のジムでの予定を見続けられる | 列を REVOKE すると今の画面と古いアプリの `select("*")` が丸ごと落ちる。トークンを作り直すと、今のカレンダー購読と古いアプリの「カレンダーに追加」が切れる。互換と安全のどちらを取るか |
| counseling-responses-1（low） | 未ログインで、どのジムにもカウンセリングの回答（問診）を何件でも差し込める（本番の INSERT ポリシーが `WITH CHECK true`・anon 可）。読み取りはできない | アプリはこの表に書かない（外部の問診フォームだけが匿名で入れていた）。フォームを今も使っているなら御所南だけに絞る、使っていないなら anon の INSERT を外す |
| 穴27 の残り（medium） | AI 連携（OAuth）の動的なクライアント登録が開いている | 使っていないなら止める（下の穴27） |
| テスト決済を許すジム | `tenant_billing_flags.stripe_sandbox_allowed` が今は0件（全ジムでテスト決済が止まっている。安全側） | どのジムをテスト用にするか（穴14） |

### 宗本さんの判断待ち（勝手に直さない）

| 指摘 | 何が起きうるか | 判断が要る理由 |
|---|---|---|
| LINE・Google カレンダーの連携の state（medium。line-login-callback-1・google-calendar-callback-1 の残り） | 連携の state がブラウザ（ログイン中の本人）に結びついていない。攻撃者が自分のアカウントの連携リンクを開かせて「許可」を押させると、相手の LINE が攻撃者のアカウントにつながり、攻撃者は「自分宛て」で公式 LINE から相手に好きな文面を送れる（Google は相手のカレンダーに攻撃者のジムの予約が書かれる） | 根本は「連携の最後に、アプリでログイン中の本人が確かめる」形にすること。ネイティブのアプリは連携を外のブラウザで行うので、そこでもログインが要るようになる（使い勝手が変わる）。古いアプリでは次のビルドまで連携できなくなる |
| 体験予約・ドロップインの枠埋め（drop-in-book-1 の後半） | 未ログインの偽の予約で枠と「1日の合計の上限」を埋め、会員の予約を止められる（穴32 で回数の上限を足して量は減った） | 根本はメールアドレスの確認（確認のリンクを押すまで枠を取らない）で、予約の手順が変わる |

### 判断の要らない残り（直す順番待ち）

- 上の「Edge Function の直し」の「残り」のうち、_resolve_user_（service_role からしか呼べない）、お客様→スタッフの通知の
  回数制限（low）（体験予約のメール中継・お名前は下の穴32、お客様同士の通知は穴33 で直した。連携の state と枠埋めは上の判断待ち）
- 穴18 の残り（取り込みアカウントへの招待）・穴21 の残り（起算日より前の予約。仕様の判断を含むので、変えるときは宗本さんに確かめる）・
  穴22 の残り（created_via='reschedule'）・穴26 の残り（古いアプリ）
- 2026-11-01 の点検の low（判断の要らないもの）は全部直した: delete-customer-cascade-1 は下の穴29、
  membership-oracle-1・tenant-limit-status-1 は穴30、auth-callback-session-1 は穴31

### 2026-11-10 の定期点検の残り（直す途中・宗本さん「全部直すで」2026-11-10。定期点検はこれを報告しない）

critical・high は無し（反証で落ちたものも0件）。19件のうち、メールの悪用の7件と trial-book-1・send-trial-reminders-log-1 は
下の穴34、在籍・予約の漏れの3件とキャンセル待ちの通知の開く先は穴35、退会したお客様を在籍に戻せる2件は穴36、
予約・カレンダーの細工の3件は穴37、チャットの添付とジムのロゴの2件は穴38 で直した。**19件すべて直した**（2026-11-11）。
直したときに残した「判断の要る残り」は各節の「残り」に書いた（booking_type の照合は穴37）。

---

## 穴38（low ×2）: チャットの添付を自分宛ての1行で開けた・インストラクターがジムのロゴを差し替えられた（2026-11-11・定期点検）

宗本さん「全部直すで」。指摘 message-attachments-1・gym-assets-limited-staff-1（いずれも low）。これで 2026-11-10 の点検の19件は全部直した。

### 何が起きていたか

1. チャットの添付（非公開の置き場 message-attachments。パスは `<送り主の user_id>/<uuid>.<拡張子>`）の読み取りは「フォルダの持ち主」か
   「その添付を指すメッセージの受信者」。後半が見るメッセージの行は、読む本人が作れた（attachment_path の形・送り主を見る制約が無い）。
   スタッフ（インストラクターを含む）は共有受信箱でジムの全会話の添付のパスを読めるので、自分宛てのメッセージを1行作って
   attachment_path にお客様の添付のパスを入れれば、お客様がオーナーに送った食事写真・フォーム動画に署名付き URL を出せた。
   外されたあとでも、自分のジムを開けば同じ手が使えた。
2. ジムの画像（公開の置き場 gym-assets）の書き込み・差し替え・削除は「そのジムのオーナーかトレーナー」で、インストラクター
   （制限付きスタッフ）を外していなかった。ロゴは公開の体験予約ページとお客様のアプリに出るので、API で差し替え・削除できた。

### 直し方（`20261111040000_message_attachment_sender_and_gym_assets_owner.sql`）

1. "message attachments: participants can read" の受信者の枝に `m.sender_id::text = (storage.foldername(storage.objects.name))[1]`
   （そのメッセージの送り主＝添付を上げた人）を足した。自分で作れる行（送り主＝自分）では、自分のフォルダのものしか読めない。
2. messages に CHECK `messages_attachment_path_shape`（パスは「送り主のフォルダ/<uuid>.<jpg|png|webp|mp4|mov>」だけ）。
   アプリはどの版でも `${senderId}/${crypto.randomUUID()}.${ext}`。本番の添付5件は全部この形（NOT VALID で入れて VALIDATE）。
3. gym-assets の INSERT・UPDATE・DELETE の3本に `AND NOT public.is_limited_staff(public.get_my_tenant_id(), auth.uid())`。
   一覧（SELECT）は残した。ロゴを上げ下げする画面（TrainerGymSettings）はオーナーにしか出さないので、アプリの動きは変わらない。

### 本番で確かめたこと（適用の前・取り消し済み）

同じトランザクションで、直す前と後を比べた。直す前: インストラクターが自分宛てのメッセージにお客様の添付のパスを入れると、
その写真が見えるようになった（0 → 1。指摘どおり）。ロゴの書き込み・差し替えもできた。直した後: 植えた行が残っていても見えない（0）。
ロゴの書き込みは拒否（42501）、差し替え・削除は0行、一覧は今まで通り。オーナーは受け取った添付2件が見え、ロゴの上げ・差し替え・
削除ができる。添付を送ったお客様は自分の写真が見える。CHECK を入れたあとは、インストラクターの植え込みが拒否（23514）、
お客様の普通の添付の送信は通る。

本番反映（2026-11-11・PR #518）: マイグレーションを本番に適用（適用前に、読み取りのポリシーに送り主の条件が無いこと・gym-assets の
3本に is_limited_staff が無いこと・CHECK が無いこと・CHECK に合わない添付が0件であることを確かめた。CHECK は VALIDATE 済み）。
適用後に演じて: インストラクターがお客様の添付のパスを植える → 拒否（23514）、添付は1件も見えない、ロゴの書き込みは拒否（42501）・
差し替えは0行・一覧は見える。オーナーは受け取った添付2件が見え、ロゴの上げ・差し替え・削除ができる。添付を送ったお客様は
自分の写真が見え、別のお客様は動画の添付を送れる・他の人の添付は見えない。Edge Function・Web の変更は無い。

見張り: `src/test/messageAttachmentSenderAndGymAssets.test.ts`（既存の `messageAttachments.test.ts` も通る）

---

## 穴37（low ×3）: お客様が予約の占有時間と、店の Google カレンダーの予定を細工できた（2026-11-11・定期点検）

宗本さん「全部直すで」。指摘 check_booking_overlap-1・enforce_booking_update_guard-1・google-calendar-sync-3（いずれも low）。

### 何が起きていたか

1. 予約の占有時間は「プランの長さ＋オプションの時間（option_minutes）＋間」で、満枠・担当の重なり（check_booking_overlap）と
   メニュー専用の時間（apply_booking_menu の GB011）はこの値を使う。option_minutes とオプションの控え（booking_options）は
   画面が計算して送る値のままだったので、お客様が API で、60分のオプションを付けて option_minutes を 0 にする（検査をすり抜けて
   先生がオプションの時間に二重予約）、option_minutes を 480 にする（その日の後ろ約9時間が満枠扱いで、他のお客様・体験・
   店の代理予約が入らない）ことができた。控えの名前・値段も書き放題だった（店の予定表に出る）。
2. 予約の google_event_id（店の Google カレンダーの予定 ID）を、お客様が INSERT・UPDATE で書けた（インストラクターも）。
   google-calendar-sync はこの列で「もう予定がある」かを決め、取り消しではこの ID の予定を店のトークンで消すので、
   値を空・でたらめにして create を呼ぶと同じ予約の予定が店のカレンダーに何件でも増え、外で知った予定の ID を入れて
   delete を呼ぶとオーナーのカレンダーからその予定を消せた。さらに、create を同時に何度も呼ぶと、確かめてから書き戻すまでの
   間に呼んだ数だけ予定ができた（列を書けなくしても残る競合）。

### 直し方（`20261111030000_booking_insert_normalize_and_event_id_guard.sql`・google-calendar-sync）

1. BEFORE INSERT の `normalize_customer_booking_insert`（トリガー `aa_normalize_customer_booking`）:
   - ログインした人の INSERT では google_event_id を必ず NULL にする（店の代理予約も。画面はこの列を書かない）。
   - お客様ご自身の予約（auth.uid() = user_id）では、booking_options の id から、そのジムのオプションの表で控え（名前・時間・値段）と
     option_minutes を作り直す。受付を止めたオプションも数える（止める前に付けた予約を動かせるように）。そのジムに無い id・
     形の崩れた要素・同じ id の2回目は捨てる。**断らない**: 日時の変更とその失敗の戻しは元の予約の控えをそのまま送るので
     （アプリの rescheduleBooking は「消す → 作る」）、店がオプションを消したあとに断ると、元の予約が消えたまま戻せなくなる。
     そのかわり、店が消したオプションが付いた予約を日時の変更で動かすと、そのオプションは外れる（時間にも数えない）。
   - 🔴 トリガーは名前の順に動く。option_minutes を読む apply_booking_menu・prevent_booking_overlap より先に動かすため、
     名前の先頭を `aa_` にした。名前を変えないこと。
   - 店の代理予約・あとからの付け足し（GB008）は今まで通り（店が決める）。
2. enforce_booking_update_guard（本番の定義を写して1つ足した）: ログインした人は google_event_id を変えられない
   （スタッフの早い return より前＝インストラクターも）。サーバー（auth.uid() が無い）は今まで通り。
3. google-calendar-sync（BUILD `2026-11-11-one-event-per-booking`。決まりは `_shared/calendarEventSlot.ts`）:
   - 予定を作る前に、条件付きの UPDATE（読んだ値のままなら）で列に「作っている印」`creating:<時刻>:<乱数>` を入れて、作る権利を
     取る。取れなければ作らない（`in_progress`）。作れたら印を本物の ID に置き換え、置き換えられなかった（その間に取り消された）
     ら作った予定を消す。印が2分より古ければ（途中で落ちた）、その印を条件に取り直す。sync_all も同じ。
   - Google の予定 ID の形（`^[a-v0-9]{5,1024}$`）でない値は Google に送らない（delete は列を空に戻すだけ）。
   - 予定があるかの確認が 404・410 以外で失敗したら作らない（以前は作り直して2件になりえた）。
   - 取り消し・当日の取り消し（消化）の予約には予定を作らない（sync_all が消化した予約の予定を作り直していたのも止まる）。

今の画面は option_minutes・控えを表の値のまま送っているので、正規の予約では結果は変わらない（本番で、控えと表が食い違う
予約は0件・2026-11-11）。google_event_id は画面から一度も書いていない。

### 本番で確かめたこと（適用の前・取り消し済み）

お客様を演じて INSERT（直後に止めて、決め直した値を読んだ）: 30分のオプションを 0分・偽の名前と値段で送る → 30分・本来の名前と
値段・予定 ID は NULL。オプション無しで 480分 → 0分。存在しない id（240分）＋同じオプション2回＋壊れた要素 → 30分だけ。
日時の変更の印付きで消えたオプション → 外れて 0分（断らない）。google_event_id の変更（値・NULL とも）→ お客様・オーナー・
インストラクターとも拒否（23514）。オーナーの普通の更新（メモ）→ 成功。オーナーの代理予約 → 45分のまま・予定 ID は NULL。
サーバーとして、今後の予約80件・体験2件に「作っている印」を入れる → 置き換える、が既存の見張りに止められずに通る。
空を条件に取る更新は、ID の入っている行を書き換えない。

本番反映（2026-11-11・PR #517）: マイグレーションを本番に適用（適用前にトリガーが無いこと・門番が前の定義のままであることを
確かめた）。適用後、お客様を演じて、偽の 480分と予定 ID を付けた予約を全部の見張りの後ろまで通す → 0分・予定 ID は NULL で
最後まで通った（正規の予約の道が壊れていない）。google_event_id の変更はお客様・オーナー・インストラクターとも拒否、
オーナーの普通の更新は成功。トリガーの関数を画面のロール（authenticated）から直接呼べないことも確かめた。
google-calendar-sync は Lovable に頼んでデプロイし、DB から叩いて `x-gymboard-build: 2026-11-11-one-event-per-booking`
（401）を確かめた（対照の push-booking-reminder は既知の版）。Web の画面のコードは変えていないので Publish は不要。

残り（このPRでは直さない）: お客様の予約の booking_type（プラン名）は今も本人が送る値のまま（プランの長さで占有が決まるので、
短いプラン名を書けば占有を短くできる）。契約のプラン（profiles.plan）と一致させるかは、プラン変更の途中の予約などの扱いを
決める必要があるので、宗本さんに確かめてから直す。

見張り: `src/test/bookingInsertNormalize.test.ts`・`src/test/googleCalendarSyncAuthz.test.ts`

---

## 穴36（medium・low）: 退会したお客様を、元のジムのオーナーが API で「在籍」に戻せた（2026-11-11・定期点検）

宗本さん「全部直すで」。指摘 guard_tenant_member_identity-1（medium。反証役2体は low）・tenant-members-reactivate-1（low）。

### 何が起きていたか

tenant_members の UPDATE は「そのジムのスタッフなら可」で、門番 guard_tenant_member_identity は user_id・tenant_id・role の変更しか
見ていなかった。元のジムのオーナーが、退会したお客様の行を `PATCH {"status":"active"}` で在籍に戻せた（画面に退会から戻すボタンは無い）。
戻すと、在籍中だけを通す RESTRICTIVE（shares_tenant_with_me）が開き、その人の共通のプロフィール（電話・LINE ID など）・体の記録・
写真（置き場は人ごと）をまた読める・消せた。退会後に別のジムのインストラクターになった人を戻すと、在籍中の所属が2つになり、
その人の「自分のジム」（get_my_tenant_id は ORDER BY なしの LIMIT 1）が切り替わりうるうえ、本人は自分で戻せなかった。

### 直し方（`20261111020000_tenant_member_status_guard.sql`）

1. guard_tenant_member_identity（本番の定義を写して2つ足した）:
   (a) 退会・解約からほかの状態へは、本人とサーバー（運営）だけ。お客様が戻るときは招待コードで参加し直す（インストラクターの参加の
   RPC は本人の操作なので通る）／間違えて退会にしたときは運営が戻す。休会からの再開は今まで通り。
   (b) 在籍中にするとき、同じ人が他のジムで在籍中なら断る（理由は出さない）。
2. 1人が在籍中にできるジムは1つ（部分一意索引 `tenant_members_one_active_per_user`）。画面はもともと1人1ジム（参加・ジムの開設は
   既存の所属があれば止める・インストラクターの参加は他のジムで在籍中なら断る）で、本番で2つ以上のジムに所属の行がある人は0人。
   API でジムを開く経路でも二重の在籍を作れなくなり、「自分のジム」は必ず1つに決まる（get_my_tenant_id の選び方を変える必要が無くなった）。

### 本番で確かめたこと（適用の前・取り消し済み）

オーナーを演じて: 退会したお客様を在籍に戻す → 拒否。休会 → 再開 → 退会 → 成功、そのあと在籍に戻す → 拒否。退会した人の名前の
編集 → 成功。サーバー（運営）は退会から戻せる。御所南で在籍中のお客様を、別のジムで休会の行にして再開しようとする → 拒否
（サーバーでも一意索引で拒否）。一意索引は今の本番の行でそのまま作れた。

本番反映（2026-11-11・PR #516）: マイグレーションを本番に適用（適用前に本番の定義が写した元と同じこと・二重の在籍が0人で
あることを確かめた）。適用後にオーナーを演じて、退会したお客様を在籍に戻す → 拒否（23514）、休会 → 再開 → 退会 → 成功、
退会にした人をまた在籍に → 拒否。お客様・インストラクターが読む所属・予約の件数は変わらない。Edge Function・Web の変更は無い。

見張り: `src/test/tenantMemberStatusGuard.test.ts`

---

## 穴35（low ×4）: 同じジムの他のお客様の在籍・予約の有無・別のジムでの予定を確かめられた・空き通知の開く先を決められた（2026-11-11・定期点検）

宗本さん「全部直すで」。2026-11-10 の定期点検の「メールアドレス・在籍が漏れる」の残り3件（trial-book-1 は穴34 で直した）と、
同じ send-push-notification の send-push-notification-waitlist-url-1。

### 何が起きていたか

- **shares_tenant_with_me-1**: shares_tenant_with_me・announcement_audience_has・booking_option_allowed は、ログインした誰でも
  RPC で呼べ、聞かれた人と呼んだ人の関係を見ずに答えた。お客様が、同じジムの他のお客様の在籍・お知らせの宛先（「未払いの人だけ」
  などに送ったお知らせなら、その人が対象か）・限定オプションの対象かを確かめられた（穴30 の対象から漏れていた）。
- **send-push-notification-routing-oracle-1**: お客様が先生宛てのプッシュのタグに他のお客様の user_id を入れると、先生が宛先から
  外れたか（＝その人のその日の予約の担当が先生以外か）が応答の形で分かり、他のお客様が来る日を調べられた。
- **booking-reminder-tenant-1**: 前日リマインドがお客様ごとに全部のジムの予約を1通にまとめ、最初の予約のジムの送信履歴に残した。
  2つのジムに所属の行がある人だと、片方のジムのスタッフが、もう片方のジムでの予約の時刻を読めた（いまは該当する人は0人）。
- **send-push-notification-waitlist-url-1**: キャンセルしたお客様が「空きが出ました」の通知に url を付けると、その枠のキャンセル待ちの
  他のお客様に届く通知の開く先（アプリ内のパス。よそのジムの体験予約ページなど）を決められた。

### 直し方

1. `20261111010000_membership_answers_scoped_more.sql`: 3つとも、本番の定義に「本人・サーバー・そのジムの在籍中のスタッフ
   （shares_tenant_with_me は聞かれた人がスタッフのときも）にだけ本当の答えを返す」を足した（穴30 の _may_see_membership と同じ考え）。
   本番で呼んでいるのはポリシーだけで、どれも本人（auth.uid()）を渡すか、お客様は PERMISSIVE 側で元から本人の行しか読めない。
2. send-push-notification: 先生のジムのスタッフでない呼び出しは、タグが本人の予約のときだけ先生の振り分けをする。画面からの
   呼び出しには件数を返さない（`{ ok: true }` だけ。外れた・届いた・端末の数で見分けさせない）。今のアプリ・古いアプリは
   応答の件数を読んでいない。
3. push-booking-reminder: お客様 × ジム で1通ずつ。送信履歴の載り先・ジム名・ご案内・プラン名はそのジムのもの。冪等キーと
   プッシュのタグにジムを入れた。1つのジムだけに通う人（今は全員）は今まで通り1通。
4. send-push-notification のキャンセル待ちの経路は url を受け取らない（体験予約の通知と同じくホームを開く。アプリはこの経路で
   url を送っていない）。

### 本番で確かめたこと（適用の前）

同じトランザクションの中で、適用の前と後に、オーナー・インストラクター・お客様を演じて読める件数と RPC の答えを並べた（取り消し済み）:
読める件数（プロフィール 46/46/1・お知らせの既読 32/32/1・お知らせ 2/2/2・オプション 1/1/0・写真 65/65/0 など）は前後で同じ。
RPC の答えは、お客様が「他のお客様の在籍」「他の人が限定オプションの対象か」を聞いたときだけ true → false。お客様が
「スタッフの在籍」を聞くとき・スタッフが聞くときは true のまま。

本番反映（#515・2026-11-11）: DB は適用の前後比較（上）→ 適用 → 役を演じて確認（お客様は自分が宛先かは true・他のお客様は false・
スタッフの在籍は true、オーナー・インストラクター・サーバーは true、読める件数は同じ。お知らせの宛先は本番に行が無いので、
取り消し前提で1行作って試した）。Edge Function 3本を Lovable でデプロイし、未ログインで呼ぶと send-push-notification が
`x-gymboard-build: 2026-11-11-push-quiet`、push-booking-reminder が `2026-11-10-reminder-per-gym`、handle-email-unsubscribe が
`2026-11-11-masked-logs`（穴34 の出し直し）。画面の変更は無し。
⚠️ このデプロイのとき、Lovable が package.json に自分のプレビュー用の部品を足して main に push し、package-lock.json と合わなくなった
（CI の `npm ci` が落ちる）。穴36 の PR で package-lock.json を合わせた（mem/ops/edge-function-deploy.md）。

見張り: `src/test/membershipAnswersScoped.test.ts`・`src/test/pushUrlSafety.test.ts`・`src/test/bookingReminderPerGym.test.ts`

---

## 穴34（medium ×5・low ×3）: 正規のドメインのメールを、上限なし・配信停止を無視して好きな宛先へ送らせられた（2026-11-10・定期点検）

宗本さん「全部直すで」。2026-11-10 の定期点検の指摘のうち、メールの悪用の7件と、同じ所を直す trial-book-1・send-trial-reminders-log-1。

### 何が起きていたか

- **trial-book-cap-1 / trial-book-2（medium）**: 体験予約・ドロップインの確認メールの上限（同じ宛先は全部のジムで24時間5件・
  1つのジムで1時間20件・24時間60件。穴32）を trial_bookings の行で数えていた。オーナーは自分のジムの行を消せる・作成日時や
  宛先を書き換えられるので、数え直させて同じ人へ何通でも送れた。宛先も文字のまま比べたので、大文字・+1 で別の宛先になった。
  確認メールは配信停止しても止まらない（MUST_DELIVER）。
- **send-trial-reminders-1（medium）**: オーナーが API で体験予約の宛先・お名前・日時を書き換えられたので、毎晩の前日リマインドを
  好きなアドレスへの中継に使えた（作る時の上限を素通り）。リマインドも配信停止を見なかった。
- **resend-email-1（medium）**: 送信履歴の「再送」に状態も回数も見る所が無く、自分のジム宛ての体験予約（宛先は他人）の行を
  何度でも再送できた。
- **invite-email-relay-1（low）**: 取り込んだお客様に招待で他人のアドレスを付けると、その後の予約の確認・取り消しのメール
  （必ず届けるメール）を上限なしで送れた。配信停止のアドレスでも、招待が断られる前にアカウントへ付いたまま残った。
- **guest-name-1（low）**: お名前の「URL 禁止」がよくある TLD 25個しか見ておらず、.tokyo・.ai・lin.ee・forms.gle・IP は通った。
- **trial-book-1（medium）**: メニューの体験予約の店宛てメールを、予約の前に読んだメニューの担当へ送っていた。担当を素早く
  書き換えると、よそのジムの人のログイン用アドレスへ送らせ、送信履歴で読めた（穴13 と同じ害の別経路）。
- **send-trial-reminders-log-1（low）**: 体験リマインドのログに、お客様のアドレスを平文で出していた（走査を全部の関数に広げたら
  handle-email-unsubscribe でも見つかった）。

### 直し方（`20261110010000_email_send_quota_and_trial_booking_guard.sql` と Edge Function 8本）

1. **email_send_quota**: service_role だけが読み書きする「送った記録」。宛先はそろえた形（小文字・+タグなし・Gmail は点なし・
   NFKC）の SHA-256 で持ち、ジムへの外部キーは付けない（店が消せない。8日で自分から消える）。`reserve_email_send` が
   「数える→積む」を宛先・ジムごとの勧告ロックで1本ずつ行う（`supabase/functions/_shared/emailQuota.ts`）。
   - 体験予約・ドロップインの確認: 宛先24時間5件・ジム1時間20件・24時間60件（予約を作る前に積み、作れなかったら戻す）。
     宛先は小文字にそろえて保存する
   - 再送: 1通2回・ジム24時間30通・宛先24時間5通。届かなかった行（failed・dlq・bounced）だけ、同じ送信がもう届いていれば断る、
     営業中のジムだけ、配信停止を必ず見る（`honorSuppression`）
   - 本人が来ていない取り込みのアカウント宛て（招待で付けたアドレス）: 配信停止を必ず見る・宛先24時間10通。まだ招待していない
     仮のアドレス（@gymboard.invalid）には送らない
2. **guard_trial_booking_update**（SECURITY INVOKER）: 画面からは体験予約の宛先・お名前・日時・ジム・種類・メニュー・担当・
   作成日時・取り消しの鍵・質問の回答・カレンダーの予定を変えさせない。状態は「キャンセル済み」にすることだけ。
3. **guard_booking_menu_staff**（SECURITY INVOKER）: 画面からメニューの担当を変えるときは、そのジムの在籍中のスタッフだけ。
4. trial-book は担当へのメールを INSERT の返り値（DB が確かめた担当）に送る。send-transactional-email は、サーバーからの
   `_resolve_trainer_`（在籍中のスタッフ）・`_resolve_user_`（そのジムに行がある人）もジムの所属を確かめてから宛先を引く。
5. send-trial-reminders は送る時にも数える（1回＝1日に1つのジム60通・同じ宛先3通）・明日の予約を区切って全部読む・
   trial-booking-reminder を必ず届けるメールから外した（配信停止を見る）・ログは maskEmail と予約の id だけ。
6. お名前は TLD 全体（Public Suffix List のトップレベル 1446件。`_shared/tlds.ts`）と形で見る。IPv4・「。」の点も断る。
   "T.Yamada"・"J.Kim"・"Mr.Kim"・"Ana.Maria" は通す（点の後ろが TLD でない／頭文字・敬称＋TLD はパスが続くときだけ断る）。
7. invite-customer は配信停止のアドレスを、アカウントに付ける前に断る。

### 🔴 あわせて見つけた不具合: Edge Function から別の Edge Function を呼ぶと 401 で失敗していた

本番の SUPABASE_SERVICE_ROLE_KEY は新しい形式（`sb_secret_…`）。新しい supabase-js（`npm:@supabase/supabase-js@2` → 2.119）の
`functions.invoke` は、この形式の鍵を Authorization に載せない（apikey だけ）。呼ばれた send-transactional-email は Bearer で
「サーバー同士」を見分けるので 401 で断り、**送信履歴にも何も残らなかった**。2026-11-10 に本番で確かめた
（vault の古い JWT の鍵で呼ぶと 401＝環境の鍵は別物。supabase-js 2.49.1 は鍵の形式に関係なく Bearer を付ける）。

- **体験の前日リマインドは一度も送れていなかった**（送信履歴に trial-booking-reminder が1行も無い。cron は毎晩動いていた。
  2026-08-26 に cron を足した時点から）
- 送信履歴の「再送」・取り込んだお客様への招待（invite-customer）・古いアプリの店宛てメールの先生への写しも同じ経路で失敗していた
  （招待はアドレスを付けてから送信に失敗していた。本番に取り込みのアカウントは無い）

直し: `_shared/invokeAsService.ts`（fetch で Authorization と apikey を自分で付ける）に置き換えた。見張り
（`src/test/emailSendQuota.test.ts`）: `npm:@supabase/supabase-js@2` を使う関数は `functions.invoke` を使わない・
`functions.invoke` を使う関数は esm.sh の 2.4x に固定している。esm.sh の 2.49.x を使う関数（notify-new-booking・
push-booking-reminder など）は動いているので今回は触っていない。⚠️ supabase-js を上げると同じ壊れ方をする。

### 残り

- 1文字のドメインそのもの（パス無し。例 "x.gd"）はお名前に通る（頭文字の書き方と区別できない）。1文字のドメインは取るのが難しく、
  パスが無いとトップページにしか飛ばない
- 招待の根本の直し（本人がリンクを開くまでアカウントのアドレスを確定させない）はしていない。GoTrue の動きの確かめが要る
- お客様からスタッフへの予約・キャンセルのメール（画面発）には回数の上限が無い（相手はそのジムのスタッフだけ。穴20 の残りと同じ）

本番反映（#514・2026-11-11）:
- DB: 適用の前に、本番でロールバック前提で流して役を演じて確かめた → 適用 → もう一度演じて確かめた。上限は回数どおりに止まる
  （同じ宛先・同じ元のメール）。オーナー・お客様・未ログインは記録を読めず、上限の関数も呼べない。体験予約はオーナー・
  インストラクターとも今まで通り117件読め、宛先・日時・作成日時・お名前の書き換えは拒否、メモの保存・取り消しはでき、
  取り消しを戻すのは拒否。お客様の見え方（体験予約0件・メニュー3件）は変わらない。メニューの担当にお客様は入れられない
- Edge Function 7本を Lovable でデプロイ。未ログインで呼ぶ（何も送らない）と、trial-book・drop-in-book・
  send-transactional-email が `x-gymboard-build: 2026-11-10-email-quota`、send-trial-reminders が `2026-11-10-reminder-fix`、
  resend-email が `2026-11-10-resend-limits`、invite-customer が `2026-11-10-invite-suppressed`（対照の analyze-meal は前日の印のまま）。
  handle-email-unsubscribe は印が無かったので、穴35 の PR で印を足して出し直した
- Lovable がデプロイのときに types.ts を本番から作り直して push した（並べ替えだけ＝本番の形と一致）
- Web を Publish（再送の文言）
- 体験の前日リマインドが本当に届くかは、次の対象（11/14 の体験予約。前の晩 11/13 21:10 に送る）で送信履歴を見て確かめる
  → **2026-11-13 に確かめた: 届いている。** 21:10 の cron で、11/14 の体験予約（予約済み1件）への trial-booking-reminder が
  送信履歴に 21:10:15 pending → 21:10:17 sent（1通）。cron から send-trial-reminders への呼び出しは pg_net の5秒で時間切れの記録に
  なるが（いつものこと）、関数は最後まで動いて送っている（同じ時刻にメールの送り出しが processed:1）。直してから初めての実送信

見張り: `src/test/emailSendQuota.test.ts`・`src/test/guestBookingGuard.test.ts`・`src/test/logSafety.test.ts`（全部の関数）

---

## 穴33（medium）: お客様が、同じジムの他のお客様へ、公式アプリの通知を好きな文面で送れた（2026-11-01・最初の点検の残りを見直して発見）

send-push-notification の画面からの経路（service_role 以外）は「自分宛て」か「同じジムに所属している人」なら誰にでも送れた。
お客様が同じジムの他のお客様全員（1回100人まで）へ、題名・本文を好きに書いた公式アプリの通知を送れた
（「お支払いが確認できません。○○へ連絡を」など）。LINE は穴25 で「どちらかがスタッフ」に絞ったが、プッシュは残っていた。
点検の指摘（send-push-notification-6）は「お客様がスタッフへ無制限に送れる」だったが、読み直すとお客様同士も通っていた。

直し方（`supabase/functions/send-push-notification/index.ts`）: 自分以外へは、同じジムに一緒に所属していて、どちらかがそのジムの
スタッフ（owner / trainer）のときだけ（LINE の mayLineMessage と同じ規則）。呼んだ人は在籍中、宛先は状態を問わない（今まで通り。
退会したお客様の予約を店が取り消したときの通知を落とさない）。正規の呼び出し（予約・キャンセル・日時の変更・オプションの変更の
連絡）は、お客様→スタッフ、スタッフ→お客様、自分宛てだけなので変わらない。

⚠️ 残り: お客様からそのジムのスタッフへの通知に回数の上限は無い（点検の指摘 send-push-notification-6 の本体。low）。
数えるための表が要るので、必要になったら足す。

本番反映（#495・2026-11-01）: Lovable でデプロイ。未ログインで呼ぶ（何も送らない）と、旧コードは 401・版の印なし、
新コードは 401 に `x-gymboard-build: 2026-11-01-push-recipients`。

見張り: `src/test/pushNotificationTenantScope.test.ts`（兄弟アプリにも配っているテスト）

---

## 穴32（medium・low ×2）: 体験予約・ドロップインで、正規のドメインのメールを好きな宛先へ送らせられた・お名前で通知を偽れた（2026-11-01・最初の点検の残り）

未ログインで使える体験予約（trial-book）とドロップイン（drop-in-book）は、入力されたアドレスへ正規のドメインから確認メールを送る。
お名前（guest_name）は確認メール・店宛てのメール・公式 LINE・Google カレンダー・当日のサマリーにそのまま入る。

- trial-book-1 / drop-in-book-1（medium）: 回数の上限が「同じジム・同じアドレスで24時間3件」「1つのジムで1時間20件」だけだった。
  ジムを替えれば同じ人に何通でも送れ、1つのジムから1日480通まで送れた。お名前に URL・メールアドレスを入れて「こちらから手続きを」と
  書けば、正規のドメインからの偽の案内になった（ジムを自分で作れば、ジム名・サイトの URL・案内文も自由に書ける）。
- trial-book-2（low）: お名前の改行・URL が店宛ての公式 LINE・カレンダーにそのまま入り、通知の行を偽れた。
- daily-trainer-summary-1（low）: 当日のサマリーは send-push-notification（本文500字まで）で送るので、長いお名前の体験予約が数件あると、
  そのジムの「本日の予定」が丸ごと届かなかった。

直し方（`supabase/functions/_shared/guestBooking.ts`。Edge Function 3本）:

- お名前は100字まで・改行などの制御文字（行区切り・ゼロ幅・向きの制御を含む）・URL・メールアドレス・ドメインらしいもの（全角も）を断る。
  断るときは「お名前に URL・メールアドレス・改行は使えません」（ドロップインは英語）。ふつうの名前（漢字・かな・ローマ字・ハングル・
  絵文字）は通る。
- 同じアドレスは全部のジムを合わせて24時間5件まで・1つのジムは24時間60件まで（今までの2つの上限はそのまま）。
- 当日のサマリーは、1行の名前を20字・本文を500字（send-push-notification と同じ数え方）までに切る。

本番反映（#494・2026-11-01）: Lovable で3本をデプロイ。存在しないジムの id で呼ぶ（予約もメールも作られない）と、
旧コードは体験予約「ジムが見つかりません」・ドロップイン「日付のエラー」・サマリー 403（どれも版の印なし）、
新コードは体験予約・ドロップインとも「お名前に URL…は使えません」・サマリー 403、3本とも `x-gymboard-build: 2026-11-01-guest-name`。
ふつうのお名前（「テスト 太郎」「Jean-Luc O'Neil」）は今まで通り先の確かめ（ジムが見つかりません・日付）まで進むことも確かめた。

⚠️ 残り（ジムの設定で決まるもの）: ジムを自分で作った人は、自分のジムの体験予約で、ジム名・サイトの URL・案内文の入った確認メールを
1日60通まで正規のドメインから送れる（宛先1人あたり1日5通まで）。止めるには「体験予約の確認メールは、確かめたジムだけ」などの運用の
判断が要る。ドロップインの枠を偽の予約で埋めること（drop-in-book-1 の後半）も、回数の上限で量は減ったが、根本はメールの確認など
画面の変更が要る。

---

## 穴31（low）: ログイン用のリンクを開かせるだけで、別の人のアカウントに黙って切り替えられた（2026-11-01・点検の拡大で発見）

`/auth/callback`（とアプリの `app.gymboard.mobile://auth/callback`）は、URL の `#access_token` / `#refresh_token` を確かめずに
`setSession` していた。攻撃者はそっくりのジム（名前・ロゴは自由。ジム名は重複できる）に自分のお客様アカウントを作り、そのトークン入りの
リンクを開かせるだけで、相手の端末を自分のアカウントに切り替えられた。本人は自分のジムだと思って体重・写真・食事・相談を入力し、
それが攻撃者のジムに入る。メールのリンク（`token_hash`。`/auth/callback` と `/reset-password`）も、ログイン中かどうかを見ずに切り替えていた。
（反証役が挙げた「切り替わった端末の通知の登録が攻撃者のアカウントに残る」件は、穴26 の DB の門番〔1つの端末＝最後にログインした1人〕で
すでに塞がっている。）

直し方（画面。Web は Publish、ネイティブは次のビルドから）:

- `#access_token` の受け口を消した。正規の経路は使っていない（OAuth は PKCE の `?code=`、メールは auth-email-hook の `?token_hash=`）。
  アプリのディープリンクも hash を渡さない（`src/main.tsx`）。
- `token_hash` は、すでに誰かがログインしていたら、切り替える前に「今のアカウント」（メールアドレス）を見せて選んでもらう
  （`src/hooks/useAccountSwitchConfirm.tsx`。「今のアカウントのまま」・Esc ならリンクを使わずにホームへ）。
  `/auth/callback` と `/reset-password`（パスワード再設定・取り込んだお客様への招待）の両方。ログインしていなければ今まで通り何も出さない。
  リンクの持ち主は確かめる（verifyOtp）までは分からないので、「同じアカウントなら、そのまま続きます」と書いてある（5言語）。

⚠️ 残り: 次のビルドが入るまで、古いネイティブ版は今まで通り切り替わる（サーバーからは区別できない）。auth-email-hook が
token_hash を取れなかったときの予備（`payload.data.url` をそのまま使う）が implicit の戻り（`#access_token`）になる場合、
そのリンクではログインできずにログイン画面へ戻る（今までも使われた形跡は無い。起きたら PKCE か token_hash に寄せる）。

本番反映（#493）: Web の Publish で `index-C7fVvKY4.js` → `index-CqwZdIJM.js`。公開中の AuthCallback のチャンクに `setSession`・
`refresh_token` が無く、`useAccountSwitchConfirm` のチャンクを読み込んでいることを確かめた。ネイティブは次のビルドから。

見張り: `src/test/authCallbackAccountSwitch.test.tsx`（`authCallbackRedirect.test.ts` の戻り先の数も合わせて直した）

---

## 穴30（low ×2）: 他人がどのジムに通っている（いた）かと、他のジムの人数・上限を、ログインした誰でも確かめられた（2026-11-01・点検の拡大で発見）

1. 所属の判定の関数（`is_tenant_member`・`is_tenant_member_any_status`・`has_tenant_role`・`has_role`）は、RLS と門番のトリガーが
   使うので authenticated から EXECUTE を剥がせない（`security/check.sql` 検査5-c）。引数の user_id・tenant_id を呼んだ人と
   突き合わせずに答えるので、他人の user_id と公開されているジムの id を組にして直接呼ぶと、在籍・退会・お客様かスタッフかが分かった。
   チャットを送ろうとしたときの門番のエラーの違い（「所属していない」と「スタッフにだけ」）からも分かった。
   同じジムのお客様も、他のお客様の在籍・退会を確かめられた。
2. `get_tenant_limit_status` は、どのジムの id でもお客様数・スタッフ数・上限（＝契約プラン）を返した。
   `is_tenant_over_limit` は未ログインでも呼べた。

直し方（`20261101110000_membership_answers_scoped.sql`）:

- `_may_see_membership(tenant, user)` を足した。呼んだ人が本人かそのジムの在籍中のスタッフ、または聞かれた人がそのジムの
  在籍中のスタッフのときだけ true（サーバー＝auth.uid() が無いときも true）。画面からは呼べない。
- `is_tenant_member`・`is_tenant_member_any_status` はこれが false なら false を返す。
- `has_tenant_role` は、聞く役割がスタッフ（owner・trainer）だけのときは今まで通り（答えが変わらないうえ、ポリシーで1行ごとに
  111か所から呼ばれるので重くしない）。お客様の役割を聞くときだけ確かめる。`is_limited_staff` は同じ理由で変えない。
- `has_role` は本人とサーバーにだけ答える。
- `get_tenant_limit_status` はそのジムに在籍している人にだけ返す（それ以外は NULL。画面は何も出さない）。
- `is_tenant_over_limit` は anon から外した（呼び出し元の2つは SECURITY DEFINER。authenticated は 20260808 の取り決めどおり残す）。

正規の呼び方が変わらないことは、本番の全部のポリシー・関数の呼び出し（has_tenant_role 132か所・is_limited_staff 52・
is_tenant_member 13・is_tenant_member_any_status 3・has_role 2。ビューと他のスキーマには無い）を数えて確かめた:
auth.uid() を渡すか、スタッフだけが通るポリシー（お知らせの宛先・限定オプションの対象）か、門番のトリガー（予約は本人か
スタッフの代理、チャットはスタッフ宛てかスタッフから）だけだった。

本番（2026-11-01・3段構え）: 同じトランザクションの中で、適用の前と後に、お客様・オーナー・インストラクター・他のジムのオーナーが
画面で読む件数（所属・ジム・プラン・メニュー・シフト・予約・プロフィール・チャット・記録・お知らせ）と、正規のチャットの送信
（お客様→オーナー、オーナー→お客様、インストラクター→お客様）を比べ、1件でも違えば全部戻す形で適用した（同じだった）。

| 聞いた人 | 聞いたこと | 適用前 | 適用後 |
|---|---|---|---|
| 他のジムのオーナー | こちらのお客様の在籍・退会したお客様・お客様の役割・印 | どれも true | どれも false |
| 〃 | こちらのオーナーがオーナーか | true | true（スタッフは今まで通り） |
| 〃 | こちらの人数・上限 | 返る | NULL |
| 〃 | こちらのお客様へチャットを送る | 「スタッフにだけ」（＝所属している） | 「所属していない」（所属していない人と同じ） |
| お客様 | 自分・オーナーの在籍、自分のジムの人数 | true・返る | 同じ |
| お客様 | 同じジムの他のお客様・退会したお客様の在籍 | true | false |
| オーナー・インストラクター | お客様の在籍・退会・役割、自分のジムの人数 | true・返る | 同じ |
| オーナー | 他のジムの人数・上限 | 返る | NULL |
| service_role | 在籍・印・人数 | true・返る | 同じ |

適用後に別の接続でもう一度演じて、同じ結果・試しのチャットが残っていないことを確かめた。`security/check.sql` の検査18 は4本とも OK。

⚠️ 残り: `is_tenant_over_limit` は authenticated から直接呼べるので、ログインした誰でも「そのジムが上限を超えているか」の1ビットは
分かる（get_tenant_limit_status の over_limit と同じ情報。20260808 の取り決めで authenticated は剥がさない）。

見張り: `src/test/membershipAnswersScoped.test.ts`（`memberLifecycle.test.ts` の is_tenant_over_limit の権限の項も合わせて直した）

---

## 穴29（low）: お客様を削除すると、他のジムの記録と共通のプロフィールまで消えた（2026-11-01・点検の拡大で発見）

顧客一覧の「削除」（`delete_customer_cascade`）は、トレーニング・予約・食事・チャットを `user_id` だけで探して消し、
ジムをまたいで1つしかないプロフィール・通知の設定・印（`user_roles`）も消していた。ジムで絞っていなかった。

- 他のジムから移ってきたインストラクターを API で削除すると、前のジムに残っていたチャットが消えた。
- 昔のお客様の所属の行（退会済み）をオーナーが「在籍」に戻してから削除すると、いま他のジムで働いている人のチャット・
  プロフィール・印が消え、その人は働いているジムのスタッフ画面に入れなくなった（参加し直しても戻らない）。
- 2つのジムに通うお客様を片方のオーナーが削除すると、もう片方のジムの記録とプロフィールまで消えた
  （もう片方のジムに過去の予約があると、トリガーで全体が失敗して、削除そのものができなかった）。

直し方（`20261101100000_delete_customer_tenant_scope.sql`。引数・呼び方は同じなので古いアプリもそのまま）:

- オーナーが呼んだとき: 自分がオーナーとして在籍していて、そのお客様の所属の行があるジムの記録だけを `tenant_id` で絞って消す。
- 他のジムに所属の行（状態を問わない。退会済みも在籍に戻せるので数える）が無い人は、今まで通りプロフィール・通知の設定・印も消す。
  2026-11-01 の本番では2つ以上のジムに所属の行がある人は0人なので、**今の削除はすべてこちら＝結果は今までと同じ**。
- 他のジムにも所属の行がある人は、共通の行を残し、自分のジムのお客様としての所属の行を外す（顧客一覧から消える）。
- お客様本人・service_role から呼んだときは今まで通り全部消す。インストラクターは今まで通り断る。

本番（2026-11-01・3段構え）: 試しのお客様を、もう1つのジムにも所属させ、記録・予約・チャットを1件ずつそのジムの分にしてから試した
（どれも巻き戻した）。適用は、適用後の結果が素振りと1文字でも違えば全部戻す形で流した（通った）。

| 演じた人 | 適用前 | 適用後 |
|---|---|---|
| 御所南のオーナーが削除 | もう1つのジムの記録・予約・チャットも、プロフィール・印も消えた | 御所南の分だけ消えた。もう1つのジムの3件・プロフィール・印は残り、御所南の所属だけ外れた |
| もう1つのジムのオーナーが削除 | 失敗（御所南の過去の予約でトリガーが止める） | もう1つのジムの分だけ消えた。御所南の記録（トレーニング200件・予約57件）はそのまま |
| 御所南のオーナー（1つのジムだけのお客様） | 記録・プロフィール・印が全部消える（所属の行は残る） | 同じ |
| 関係の無いジムのオーナー・インストラクター | 42501 | 同じ |
| お客様本人 | 23514（過去の予約は本人には消せない） | 同じ |
| service_role | 全部消える | 同じ |

適用後、試しのお客様のデータが元のままであること、試しのチャットと通知の送信待ちが残っていないこと、
anon は呼べず authenticated・service_role は呼べることを確かめた。`security/check.sql` の検査17 は OK
（直す前の本文なら ★ になることも確かめた）。

変えていないこと: 消すのは今まで通り7つの表だけ。1つのジムだけのお客様を削除しても、所属の行は残る（今までと同じ）。

見張り: `src/test/deleteCustomerTenantScope.test.ts`

---

## 穴28（low ×2）: ジムの連絡先リンクに javascript: を入れられた・自分の LINE ID を書き換えて公式 LINE から誰にでも送れた（2026-11-01・点検の拡大で発見）

- **連絡先リンク**（tenant-contact-url-1）: 「LINEで連絡」「Google口コミ」の URL（tenants.line_url・google_review_url）は画面でしか http(s) を
  確かめていなかった。オーナーが API で `javascript:…` を入れると、ボタンを押したお客様の画面でスクリプトが動き、セッションを盗めた
  （そのお客様が通う他のジムの情報にも届く）。→ tenants の line_url・google_review_url・website_url に CHECK（NULL・空・http(s)）、
  画面は openExternalUrl の入口で http(s) 以外を開かない（Web は Publish・ネイティブは次のビルド）。本番の既存の行は全部収まっていた。
- **LINE ID**（line-link-1）: 自分の profiles.line_user_id を任意の LINE ID に書き換えてから send-line-message を「自分宛て」で呼ぶと、
  公式アカウントから好きな LINE ユーザーに任意の文面を送れた（穴25 の直しの抜け道）。スタッフはお客様の LINE ID も書き換えられた。
  → 画面から（authenticated / anon）は NULL にする（解除）ことしかできない門番（SECURITY INVOKER）。値を入れるのは line-login-callback だけ。

`20261101090000_contact_urls_and_line_id_guard.sql`。本番（2026-11-01・3段構え）: 適用前は「オーナーが javascript: を入れられる・お客様も
オーナーも LINE ID を書き換えられる」（穴が実在）、適用後は 23514／42501 で拒否、https の URL・連携の解除・サーバー側（service_role）の
連携は通る（7通りを期待値と突き合わせて適用）。制約は3つとも VALIDATE 済み、試した値は残っていない。
本番反映（#488）: Web の Publish（openExternalUrl の確認）は `index-C25xZ5rc.js` → `index-C7fVvKY4.js` で確かめた。ネイティブは次のビルドから。

---

## 穴27（medium）: AI 連携（OAuth）の同意画面で、偽の「ジムボード」アプリにオーナーのトークンを渡させられた（2026-11-01・点検の拡大で発見）

Lovable の AI 連携（MCP。supabase/functions/mcp は @lovable.dev/mcp-js が src/lib/mcp から生成）のため、Supabase Auth の OAuth サーバーが
有効で、**動的なクライアント登録も開いている**（本番の /auth/v1/.well-known/oauth-authorization-server に registration_endpoint がある。
2026-11-01 に確かめた）。誰でも client_name「ジムボード」・戻り先が自分のサーバーのアプリを登録し、オーナーに
「AI 連携の設定をお願いします」と認可のリンクを踏ませられる。本物のドメインの同意画面（/.lovable/oauth/consent）は
「このアプリが…を**読み取れる**ようになります」とだけ出し、戻り先のドメインを出していなかった。許可されると、そのアプリに
**オーナーとして読み書きできる**アクセストークン＋リフレッシュトークンが渡る（MCP の3つの道具だけでなく、PostgREST を何でも叩ける）。
本番の oauth_clients・oauth_consents・oauth_authorizations は全部0件（まだ誰も使っていない・悪用の跡も無い）。

直し方（画面。Web だけの経路なので Publish で届く）: `src/lib/oauthConsent.ts`。
- 連携先として**戻り先のドメイン**を出す（名前は誰でも名乗れる）。分からなければ「許可する」を押せない
- 「読み書きできるようになります」と正しく書き、オーナー・インストラクターには「ジムのお客様全員の情報に届く」警告を出す
- 戻り先が https（または手元の PC の http://localhost）でなければ進まない（javascript: などを止める）

→ 2026-11-01 宗本さん「これいいです」: **今のまま（動的なクライアント登録は止めない）**。上の「点検の残り」の判断済みの表。

⚠️ 残り（判断の前に書いていたもの）: 根本は、使っていないなら動的なクライアント登録（または OAuth サーバーごと）を止めること。止めると、
Claude などからジムのデータを見る AI 連携は（必要なクライアントを手で登録するまで）使えなくなる。
もう1段の守りとして、OAuth で出したトークン（client_id の入った JWT）には、MCP が使う3表の自分の行の SELECT だけを許す
RESTRICTIVE ポリシーを全表に足す案もある（通常のアプリのトークンに client_id が無いことを本番の JWT で確かめてから）。

---

## 穴26（medium）: ログアウトしても端末の通知の登録が消えず、共用の端末に前の人宛ての通知が出続けた（2026-11-01・点検の拡大で発見）

通知の宛先は push_devices（ネイティブの FCM トークン）・push_subscriptions（Web の購読）に「人 × 端末」で入る。ログアウト（signOut）は
supabase.auth.signOut だけで行を消さず、同じ端末で別の人がログインすると同じトークンでもう1行増えた。受付のタブレット・家族の端末・
受付の PC で、前の人宛ての通知（「新しい予約: 山田花子さんが…」「本日の予定（5件）」「佐藤さんからメッセージ: …」）が出続けた。
本番（2026-11-01）: オーナーの端末2台（iOS・Android）に、オーナーとお客様のアカウントが同じトークンで登録されていた（宗本さんの確認用の
アカウントと思われる）。

直し方は2段:
1. **DB（古いアプリにも効く・本番に適用済み）**: `20261101080000_push_one_user_per_device.sql`。同じトークン・同じ購読先を別の人が
   登録したら、前の人の行を消す（SECURITY DEFINER のトリガー。画面からは呼べない）。アプリは起動のたびにこの端末のトークンを登録し直す
   （PushBootstrap）ので、上の2台も次に開いた時点で整う（今ある行は消していない）。
   本番（3段構え）: 2人が同じトークン・購読先を登録すると、適用前は2行残り（穴が実在）、適用後は最後の人の1行だけ。同じ人の登録し直しは1行のまま。
2. **画面（Web は Publish・ネイティブは次のビルド）**: ログアウトの前に `forgetThisDeviceForPush`（src/lib/pushNotifications.ts）で
   この端末の行だけを消す（ネイティブはこの端末のトークンの行、Web は購読を解除してその行）。ログアウト後は RLS で消せないので、必ず前。
   待つのは最大2秒（ログアウトを止めない）。⚠️ Web でログアウトしてから入り直した人は、設定で通知を入れ直す（購読を解除するため）。

本番反映: #486（ログアウトの前に消す）と #487（同意画面）の Web の Publish は、まとめて `index-Ca_YmhyC.js` → `index-C25xZ5rc.js` で確かめた。

⚠️ 残り: 古いネイティブアプリで「ログアウトだけして誰も入らない」端末は、次のビルドが入るまで前の人の通知が出る（1 で防げるのは
別の人が入ったときだけ）。完全に塞ぐなら、登録のときのセッション ID を行に残し、ログアウト済みのセッションの行には送らない
（send-push-notification の変更。点検の提案 (b)）。

---

## 穴25（medium）: お客様が、同じジムの他のお客様へ公式 LINE から任意の文面を送れた（2026-11-01・点検の拡大で発見）

send-line-message は、画面からの他人宛てを「同じジムに active で在籍しているか」だけで許していた。トークン（LINE_CHANNEL_ACCESS_TOKEN）は
全ジム共通の1本（Salute の公式アカウント）なので、お客様が他のお客様へ「【Salute御所南】お支払い情報の確認が必要です https://…」のような
文面を公式アカウントから送れた（返事で相手が LINE 連携しているかも分かる）。今のアプリは LINE 連携を止めている（LINE_INTEGRATION_ENABLED=false）が、
止めているのは画面の呼び出しだけで、関数は直接呼べる。

直し方: 自分以外へは「同じジムに一緒に在籍していて、どちらかがそのジムのスタッフ（owner / trainer）」のときだけ
（`_shared/lineRecipients.ts` の mayLineMessage。スタッフ → お客様、お客様 → スタッフ。お客様同士は不可）。フラグが ON だった頃の
古いアプリの送り先（予約・キャンセルの店への連絡、代理予約のお客様への連絡、自分宛て）はすべてこの中に入る。
`x-gymboard-build` を付けた（デプロイの確認用）。
本番反映（#485）: Lovable にデプロイを頼み、send-line-message の 401 に `x-gymboard-build: 2026-11-01-line-recipients` が付くことを
確かめた（対照の send-transactional-email は `2026-11-01-email-tenant` のまま）。

---

## 穴24（medium）: 運営への要望メールで、運営者（宗本さん）宛てに偽のリンク付きメールを自社ドメインから送れた（2026-11-01・点検の拡大で発見）

operator_feedback の AFTER INSERT トリガー（notify_operator_feedback）は本文（NEW.body）だけエスケープし、「店舗:」「送信者:」に入る
ジム名（tenants.gym_name）と表示名（profiles.display_name）を生のまま HTML に入れ、差出人の表示名にもジム名を使っていた。
ジムは誰でも開けるので、ジム名を `<a href="https://evil.example/">【Stripe】…</a>` にして要望を1件送るだけで、運営者の受信箱へ
自社ドメインから「Stripe」名義の偽のボタン付きメールが届いた（運営者のアカウントは全ジムの全データに届く鍵）。件名には改行も入れられた。

直し方（`20261101070000_operator_feedback_escape.sql`。本番の定義から写した）: HTML に入れる値は全部 & < > " ' をエスケープ、
差出人の表示名は固定の「運営への要望」、件名のジム名・表示名は改行を空白に。テキスト版・1時間の上限・REVOKE はそのまま。
⚠️ 見た目の変化: 運営宛ての要望メールの差出人が、ジム名から「運営への要望」になる（ジム名は件名と本文にある）。

本番（2026-11-01・3段構え）: Salute のジム名と表示名を一時的に HTML にして要望を1件入れ、キューに積まれたメール（pgmq）を読んで
全部取り消した。今の関数は「生のタグ・img・差出人がジム名・件名に改行」（穴が実在）、直した関数は「全部エスケープ・差出人は固定・
改行なし」。期待値と一致する形で適用し、テストの要望・メールが残っていないこと、ジム名・表示名が元のままなのを確かめた。

---

## 穴23（medium）: オーナーを引き継いでも、元オーナーが「持ち主」のまま残った（2026-11-01・点検の拡大で発見）

transfer_gym_ownership は tenant_members の役割（新オーナー=owner、元オーナー=インストラクター）と user_roles しか変えず、
tenants.owner_user_id は元オーナーのままだった。owner_user_id で「オーナーか」を見ている所（tenants の UPDATE ポリシー・
_owner_staff_invite_code〔インストラクターの招待コード〕・remove_staff_member・tenant_members の INSERT ポリシーの owner の枝）が多く、
元オーナーが設定を変え続けられ、招待コードも取れた。新オーナーが API で元オーナーの所属を消しても、元オーナーは owner として
入れ直せた（全お客様の情報が見える）。元オーナーのアカウント削除も外部キーで失敗した（引き継ぎの目的が果たせない）。
本番の引き継ぎは0件（潜在）。

直し方（`20261101060000_transfer_ownership_updates_owner.sql`。本番の定義から写して1行足しただけ）: 役割を入れ替えたあと
`UPDATE public.tenants SET owner_user_id = _to_user_id`。SECURITY DEFINER の中なので tenants の門番（INVOKER）は通る。

本番（2026-11-01・3段構え）: Salute で「オーナー → インストラクターへ引き継ぐ → 新オーナーが元オーナーの所属を消す →
元オーナーが owner として入れ直す」を、今の関数と直した関数の両方で流して全部取り消した。今の関数は「持ち主は元オーナーのまま・
元オーナーが招待コードを取れる・入れ直せる」（穴が実在）、直した関数は「持ち主は新オーナー・元オーナーはコードを取れない・
入れ直しは 42501」。期待値と一致する形で適用し、Salute の持ち主とスタッフが元のままなのを確かめた。security/check.sql に検査16（本番で OK・
食い違いのジムは0件。owner_user_id が NULL でメンバー0人の空のジムが1件あるが、数えない）。

---

## 穴22（medium）: お客様が予約の印を偽って満枠などの検査を飛ばせた・自分の予約の日時を API で動かせた（2026-11-01・点検の拡大で発見）

- **source='salute_sync'**: 満枠（check_booking_overlap）・休みの日（guard_booking_day_closed）・メニュー（apply_booking_menu・
  guard_booking_menu_teacher）・限定オプション（guard_booking_restricted_options）が「source が salute_sync なら素通し」。塞ぐはずの
  ポリシー（20260625100000 の no_client_salute_source_insert）は本番に入っていなかった（ファイルごと未適用。問診の部分も）。
  → 新しいマイグレーションでポリシーだけを入れた。🔴 **20260625100000 は流さないこと**（問診のポリシーが古い形に戻る）。
- **日時の UPDATE**: お客様は自分の予約を UPDATE できる（当日の消化のため）が、満枠の検査は INSERT のときだけ → PATCH で日時を満枠の時間へ
  動かせた。担当・メニュー・オプションも同じ。店が取り消した予約を戻すこともできた。
  → enforce_booking_update_guard（本番の定義から写して2つの IF を足しただけ）で、お客様は枠を決める列（日時・ジム・本人・プラン・source・
  担当・メニュー・オプション）を変えられない・キャンセル済みは戻せない。店（その予約のジムのスタッフ）とサービスロールは今までどおり。
  アプリのお客様の UPDATE は status（当日の消化とその取り消し）と trainer_note（日時の変更でのメモの引き継ぎ）だけ。日時の変更は「消して作る」。

本番（2026-11-01・3段構え）: 適用前に、お客様が自分の予約の日時を動かせる・source を変えられることを確かめた（穴が実在）。適用後は
日時・担当・source・オプションの変更が 23514、salute_sync での作成が 42501（新しいポリシー。他のポリシーはこのお客様を通す）、
メモの引き継ぎ・当日の消化・店のメモと日時の変更は今までどおり通る（9通りを期待値と突き合わせて適用）。試した予約は元のまま。
security/check.sql に検査15（本番で OK）。

⚠️ 残り: お客様は created_via='reschedule' を自分で付けて予約を作れる。日時の変更の引き継ぎのための意図的な抜け道で、限定オプション・
メニューの担当・外したメニュー・開始日の検査を飛ばす（mem/features/booking-options.md）。直すには「直前に消した自分の予約と同じ中身か」を
DB で確かめる仕組みが要る。

---

## 穴21（medium）: お客様が自分の契約の列を書き換えて、回数の上限や入金の確認をすり抜けられた（2026-11-01・点検の拡大で発見）

契約の列（plan・cycle_start_date・cycle_start_pinned・grace_enabled）は profiles にあり、人ごとに1行で**全部のジムで共通**。
予約の回数の上限（GB004）と次回分の入金の確認（GB009）はこの列を読む。門番は guard_profile_plan_fields。

- **A 本人の素通し**: 本人の行は「どこかのジムのスタッフなら素通し」だった。tenants の INSERT は誰でもできるので、お客様が自分でジムを作って
  オーナーになれば、元のジムのお客様のままプランを消す・存在しない名前にする・起算日を消す、ができた（profiles-plan-guard-1）。
- **B 2つ目のアカウント**（点検では出ていなかった。直す途中で見つけた）: 2つ目でジムを作り、1つ目をそのお客様にすると、2つ目は
  「1つ目の店のスタッフ」として、1つ目の（共通の）契約の列を書き換えられた。
- **C 起算日**: 固定されたお客様と上限を強制するプラン以外は、本人が起算日を消せ（member_first_unpaid_cycle_start が NULL を返す）、
  戻せ、予約の無い日・過去の日にもできた。

直し方（`20261101040000_profile_plan_guard_scope.sql`。本番の定義から写して3か所足しただけ）:
本人の素通しは「スタッフで、お客様としての所属がどこにも無い人」だけ。本人の起算日の変更は、アプリの自動設定
（rebaseCycleStartIfNeeded: 予約を入れた直後に、その予約の日付へ前に進める）と同じ形だけ（消さない・戻さない・今日より前にしない・
自分の予約がある日）。店の側も、そのお客様が自分がスタッフでないジムにも在籍していれば変えられない。

本番（2026-11-01・3段構え）: 適用前に同じ試験を今の関数で流し、お客様本人の「消す・戻す・過去・予約の無い日」が全部通ること、
2つのジムに在籍させた（取り消し前提で一時的に入れた）お客様を店が変えられること、お客様を兼ねるスタッフが自分のプランを
変えられることを確かめた（穴が実在）。適用後は全部 GB005、アプリの自動設定（予約の日付へ前に進める）・表示名などの更新・店の変更は
今までどおり通る（13通りを期待値と突き合わせ、一致しなければ全部戻す形で適用）。一時的に入れた所属は残っておらず、試したお客様・
オーナーのプロフィールも元のまま。security/check.sql に検査14 を足した（本番で OK）。

影響: 2つ以上のジムに通うお客様0人・スタッフとお客様を兼ねる人0人・入金の確認を ON にしているジム0件（今の利用者で動きが変わる人はいない）。
⚠️ 将来2つのジムに通うお客様が出たら、どちらの店からも契約の列は変えられない（「運営にお問い合わせください」が出る）。運営が SQL で直す。
根本は契約の列を所属（tenant_members）ごとに持つこと。
⚠️ 残り（low）: 起算日より前の日付の予約は、上限の窓（plan_cycle_window の「起算日より前は最初の窓」）で数えられない。1回目の予約を遠い先に
入れると、それより手前は何回でも取れる（アプリの自動設定でも同じ。仕様の決め方が要る）。

---

## 穴20（medium）: お客様が、店宛ての正規の通知メールを偽れた・送信履歴の載り先を選べた（2026-11-01・点検の拡大で発見）

send-transactional-email（画面からも呼べるメール送信）の2つ。

1. **偽の「新しい予約が入りました」**（send-transactional-email-link-1）: 画面から送れるテンプレートに new-booking-notification が入っていて、
   ボタンの飛び先（dashboardUrl）と差出人名（gymName）を画面の値のまま使っていた → お客様が自分のジムのオーナー宛てに、
   「ジムボード運営 <noreply@notify.kyoto-salute.com>」から、偽のログイン画面へのボタン付きの通知を送れた（SPF/DKIM も通る。
   配信停止も効かない必須のメール）。オーナーのパスワードを取られると、そのジムの全お客様の情報に届く。
   → 新規予約と受付確認（booking-confirmation）は画面から呼べなくした。どちらも予約の INSERT のトリガー → notify-new-booking
   （service_role）が DB の内容から送っている。本番の過去30日で、確認メール192通・店宛216通がすべてサーバー発、画面発（duplicate の行）は0通。
   残りの2種（キャンセル・オプションの変更）は、差出人名と本文のジム名・お店からのご案内を DB の値に、`…Url` を本番のオリジンにする
   （`_shared/emailClientGuard.ts` の serverDecidedTemplateData。🔴 先生への写しの送り直しより**前**に置く）。
2. **履歴の載り先**（send-transactional-email-tenant-1）: 画面が渡した tenantId をそのまま使っていた → お客様が自分で作ったジムの ID を入れ、
   使用済みの冪等キー（booking-confirm-customer-…）で自分のジムのオーナー宛てに送ると、送らずに宛先（オーナーのログイン用アドレス）だけが
   残る duplicate の行が自分のジムの履歴に書かれ、オーナーとして読めた。→ この送信を正当化するジム（呼び出し元と宛先が一緒に在籍している
   ジム）の中からしか選ばない（pickVerifiedTenant。無ければ候補が1つのときだけ、それ以外は NULL）。templateData の user_id から
   引き当てるのは service_role だけ。冪等キーの予約（先勝ち）も service_role だけ。

古いアプリ: キャンセルの通知は booking.tenant_id（共通のジム）を送ってくるので、載り先も見た目も変わらない。店が体験予約を取り消したときの
メールは、差出人が「ジムボード」からジム名になる（もともと gymName を送っていなかった）。
見張り: `src/test/emailClientGuard.test.ts`（6通りに壊して全部落ちることを確かめた）。

⚠️ 残り（low）: お名前・プラン名などの本文の文字は今も画面の値（URL らしい文字をメールソフトがリンクにすることはありうる）。
ボタン・差出人・ジム名はもう偽れない。根本はキャンセルの通知もサーバーへ移すこと（予約の削除のトリガーから送る）。

本番反映（#481）: Lovable にデプロイを頼み、send-transactional-email の 401 に `x-gymboard-build: 2026-11-01-email-tenant` が付くことを
確かめた（対照の invite-customer は `2026-11-01-invite-claimed` のまま）。⚠️ 確認に使う anon キーは `.env` の
VITE_SUPABASE_PUBLISHABLE_KEY を毎回そこから読むこと（覚えている値で叩いたら別の JWT だった。ゲートウェイは通ったが、確かめとしては弱い）。

---

## 穴19（medium）: 未ログインで他人のメッセージを取り消せた・外したインストラクターが同じリンクで戻れた（2026-11-01・点検の拡大で発見）

- **unsend_message**: 送り主を `sender_id <> auth.uid()` で見ていた。anon キーだけで呼ぶと auth.uid() が NULL → 比較も NULL で
  IF が通らず、他人のメッセージ（24時間以内）の本文・添付が消えた（anon が実行できた）。
  → `auth.uid() IS NULL OR sender_id IS DISTINCT FROM auth.uid()` にし、anon から外した。🔴 **auth.uid() を `<>`／`!=` で比べない**
  （`src/test/unsendAndStaffRemoval.test.ts` が、本番にある〔後で DROP されていない〕全部の関数を走査して禁止している）。
- **remove_staff_member**: 在籍の行を消すだけで、インストラクターの招待コードは変わらなかった → 外された人（別のアカウントでも）が
  同じ /join-staff/<コード> でまた入り、お客様全員の情報が見えた。→ 外すときにコードを作り直す。画面の確認文に
  「インストラクターの招待リンクも新しくなります」を足した（5言語）。
- 定義はどちらも本番の pg_get_functiondef から写して1か所だけ変えた（`20261101030000_unsend_and_staff_removal_fixes.sql`）。
  本番（3段構え）: anon は実行できない／オーナーでも未ログインでも他人のメッセージは not_sender／インストラクターを外すと
  コードが変わる、を確かめた（外したのは戻した。適用後に在籍とコードが元のままなのも確かめた）。

#479（招待）の本番反映: invite-customer・send-transactional-email・resend-email の 401 に `x-gymboard-build`
（invite-claimed／log-redact／no-invite-resend）が付くこと、Web の Publish は `index-BdTCKwU9.js` → `index-BjVBA-qd.js` で確かめた。
#480（この穴）の本番反映: マイグレーションはマージ前に適用済み。Web の Publish（確認文）は `index-BjVBA-qd.js` → `index-Ca_YmhyC.js` で確かめた。

---

## 穴18（high）: 招待で、本人が使っているお客様のアカウントを乗っ取れた・招待リンクが送信履歴に残っていた（2026-11-01・点検の拡大で発見）

CSV で取り込んだお客様への招待（invite-customer）まわりの3つ。

1. **乗っ取り**: invite-customer は「imported_at があり claimed_at が無い」お客様のメールを差し替えて、パスワード設定リンクを送る。
   claimed_at は profiles の列で、オーナーが API で消せた → 消して招待し直すと、本人が使っているアカウントのメールが攻撃者の
   アドレスになり、リンクからパスワードを設定して乗っ取れた（本人は締め出される）。
   → `20261101020000_profile_claim_fields_guard.sql` の門番（SECURITY INVOKER）で、画面から imported_at・claimed_at・invited_at を
   変えられない（書くのは import_customers・claim_my_profile〔どちらも DEFINER〕と invite-customer〔service_role〕だけ）。
   invite-customer は auth 側の事実（一度でもログインした・Google/Apple がつながった）で「本人が来た」を見て 409。
2. **招待リンクが送信履歴に残る**: send-transactional-email が template_data をそのまま email_send_log に書いていて、招待の inviteUrl
   （token_hash 入り）をインストラクターも読めた（お客様が開く前に開けば、そのお客様としてログインできる）。
   → `_shared/logSafety.ts` の `redactTemplateDataForLog` で、ログインの鍵（token_hash・access_token・refresh_token）入りの値を
   伏せてから履歴に書く（8か所）。体験の取り消しリンク（token=）は鍵ではないので伏せない。resend-email は招待を断る（新しいリンクで招待し直す）。
   本番の履歴に鍵入りの行は0件だった（招待はまだ使われていない）。
3. **招待メールの送りすぎ**: 取り込みのアカウントを宛先だけ替えて、正規の送信元から何通でも送れた → 1つのジムで24時間に100通まで。

画面: 招待カードは 409／429 の理由を返事の本文から読み、「このお客様はもうログインしています」「送信が多すぎます」を出す（5言語）。
本番（2026-11-01・3段構え）: オーナー・お客様本人・service_role を演じて、表示名などの編集・同じ値での保存は通り、3つの印の変更は
オーナーも本人も拒否、claim_my_profile と service_role の invited_at は通る、を確かめた（全部戻した）。

⚠️ 残り: 自分で開いたジムの取り込みアカウントを、他人のアドレスで招待すること自体はできる（リンクは本人に届くので攻撃者は入れない。
本人が後で Google ログインすると、そのアカウント＝攻撃者のジムのお客様につながりうる）。email_confirm をやめる案は GoTrue の挙動の
確かめが要るので保留。

---

## 穴17（high）: お知らせの「1人宛て」で、他のジムの人に公式アプリの通知を送れた（2026-11-01・点検の拡大で発見）

`announcements.target` には 'all'／'except'／'only' のほか、古いアプリが書く「1人宛て」（user_id）が入る。表への直接の
INSERT／UPDATE は自分のジムの行しか見ず、target は何でも入った。push-announcements はそれを service_role で
send-push-notification に渡す（service_role は宛先の所属を見ない）→ 誰でも開けるジムのオーナーが、他のジムの人の端末に
「お知らせ: <好きな題名>」を送れた（push_sent_at を NULL に戻せば何度でも）。本番の4件はどれも全員・除く・個別で、1人宛ては0件。

直し方（穴13 と同じ形）: `20261101010000_announcement_target_must_be_member.sql` の門番（SECURITY INVOKER・画面からだけ）が、
INSERT と宛先・ジムを変える UPDATE で「uuid の形で、そのジムに所属している人（在籍の状態は問わない）」を求める。題名・本文だけの
編集では見ない。送る側（push-announcements）でも、1人宛て・個別の宛先を tenant_members で絞る（確かめられなければ送らずにやり直す）。
本番（2026-11-01・3段構え）: オーナーを演じて「他のジムの人宛て」「uuid でない宛先」「既存の行の宛先を他のジムの人へ」は拒否、
「そのジムのお客様宛て」「全員」「題名・本文だけの編集」は通る、service_role は対象外、を確かめた（試しの行は全部戻した）。検査12 は3表とも OK。

ついでに `monthly-report-notification` に認可（service_role / cron だけ）を足した。本体は全部のジムの LINE 連携者へ一斉に送り、
返事に user_id を並べる作りで、今は早期 return で無効化してあるが、本番がその版かを外から確かめる手段が無かった（呼ぶと送られうる）。
認可を足した版をデプロイして、本番をそろえる。

#477（ログイン画面の redirect）の Web の Publish は、公開サイトの index.html が読み込むスクリプトが
`index-Ba41HYLJ.js` → `index-BdTCKwU9.js` に変わったことで確かめた（DB の pg_net で取得。コンテナからは公開サイトを開けないため）。

---

## 穴16（high）: ログイン画面の ?redirect= で、ログイン直後に本番のドメインでスクリプトが動いた（2026-10-31・点検の拡大で発見）

`/auth?redirect=…` の値を確かめずに使っていた（Auth.tsx → SocialAuthButtons が sessionStorage に保存 → AuthCallback が
`window.location.replace(dest)`）。AuthCallback のコメントは「dest はアプリ自身が書いた値」としていたが、実際は URL の値の写しだった。

- `?redirect=javascript:…` → ログアウト中の人が本物の画面で「Google／Apple でログイン」を押すと、戻った直後に
  **app.kyoto-salute.com のまま攻撃者のスクリプトが動く**（localStorage のログインの鍵を抜ける。オーナーならジムの全お客様の情報）
- `?redirect=//evil` や `/\evil` → パスワードでログインした直後に外のサイトへ飛ばせた（偽の「再ログイン」画面でパスワードを盗む）
- `/auth/callback?next=/\evil.example` も同じ（sanitizeAuthNext が「/ で始まり // で始まらない」しか見ていなかった）

直し方: 3か所とも `src/lib/safePath.ts` の `isSafeInAppPath`（通知を開く側と同じ判定）を通す。Auth.tsx の redirect・
SocialAuthButtons の保存・AuthCallback の dest（2か所）・sanitizeAuthNext の「/ 始まり」。アプリが自分で付ける redirect は
`/join/<code>`・`/join-staff/<code>`・`/oauth/consent?…` だけで、どれも通る。ネイティブのアプリには外から `/auth?redirect=` を
開かせる経路が無いので、次のビルドで揃えばよい（Web は Publish で直る）。
見張り: `src/test/authCallbackRedirect.test.ts`・`src/test/authNextSanitize.test.ts`

---

## 穴15（critical）: analyze-meal の写真のパスで、全部のジムの写真を消せた（2026-10-31・点検の拡大で発見）

食事の写真を AI に読ませる `analyze-meal` は、リクエストの `imageUrl` をそのまま **service_role** の
`storage.from("meal-photos").createSignedUrl(imageUrl)` に渡していた。storage-js（Edge Function が使う 2.7.1）は
`${url}/object/sign/meal-photos/${path}` と文字列をつなぐだけで、fetch が URL を読むときに「..」が畳まれる。

- `../../../bucket/<バケット>/empty` → **「バケットを空にする」API に service_role で届く**。ログインした誰でも
  （ジムは誰でも開けるので、実質だれでも）6回の呼び出しで、全部のジムの体の写真・姿勢の写真・チャットの添付・
  アイコン・ロゴを消せた。**Storage のファイルは DB のバックアップに無く、戻せない**
- `../../../../../functions/v1/<名前>` → service_role 専用の関数を起動できた（本文は固定なので、迷惑な通知どまり）
- `%2e%2e`・バックスラッシュ・タブ入りも URL の解析で同じところへ化ける（`src/test/analyzeMealStoragePath.test.ts` で実際に確かめている）

本番（2026-11-01）: #476 を Lovable でデプロイし、未ログインの呼び出しの 401 に `x-gymboard-build: 2026-10-31-storage-path` が
付くこと（デプロイ前は無し）で新しいコードを確かめた。**悪用の跡は無し**: DB の行が指すファイルは全部残っている
（食事の写真 14/14・チャットの添付 5/5。体の写真・姿勢の写真は行も0件＝使われていない機能で、消されたのではない）。

直し方: 写真の場所は**食事の行（meals.image_url）から読み**、リクエストの値は使わない。行の値も本人が書けるので、
`_shared/storagePath.ts` の `isSafeOwnStoragePath`（`<user_id>/` で始まる・空の段/`.`/`..` が無い・`%` `\` `?` `#` 制御文字が無い）
を通してから署名する。アプリは前から行と同じ値を送っていたので、動きは変わらない（本番の行: パス14件はすべて本人のフォルダ、
古い35件は http の URL で、署名を通らない）。Storage を service_role で触る関数は analyze-meal だけ（テストが一覧を固定）。

---

## 穴14: オーナーが自分のジムのプラン・上限を API で書き換えられた（2026-10-31）

Stripe の2件（テスト決済・Pro のコンプ判定。宗本さんが「テスト用のジムだけ」「コンプは御所南だけ」と判断）を
直す途中で見つけた。**個人情報ではなく課金の穴**だが、同じマイグレーションで塞いだ。

### 何が起きていたか

本番で `has_column_privilege('authenticated', 'public.tenants', <列>, 'UPDATE')` が**全列 true** だった。
`20260530080359` の `REVOKE UPDATE (stripe_customer_id, stripe_subscription_id) ... FROM authenticated` も、
`20260804010000` の `REVOKE SELECT (staff_invite_code)` も**効いていない**（テーブル単位の権限が残っていると、
列単位の REVOKE は何もしない。穴6 と同じ形）。UPDATE のポリシーは `owner_user_id = auth.uid()` だけなので:

- オーナーは API で `gymboard_plan = 'premium'`・`max_customers = NULL`（上限なし）・`trial_ends_at` の延長ができた
- 直接の INSERT（ポリシー "Authenticated users can create tenant"）でも、同じ値でジムを開けた
  （`create_gym_with_owner` は値を固定しているが、INSERT の道が残っていた）

ついでに確かめたこと:
- `staff_invite_code` は列ごと使っていない（2026-10-28 に `tenant_staff_invites` へ移り、常に NULL）。
  インストラクターの招待コード（`tenant_staff_invites`）は anon・authenticated とも読めない → 問題なし
- お客様は自分のジムの tenants 行を全列読める（`invite_code`・`stripe_customer_id` を含む）。値を知っても
  悪用できないので現状のまま（列の許可リストにすると、列を足すたびに画面が黙って落ちる）

### 直し方（`20261031090000_billing_flags_and_tenant_billing_guard.sql`）

- BEFORE INSERT OR UPDATE のトリガー `guard_tenant_billing_columns`（**SECURITY INVOKER**。`current_user` が
  authenticated / anon のときだけ）。UPDATE は守る列（プラン・期間・上限2つ・お試し期間・状態・契約の状態・
  期間の終わり・Stripe の ID 2つ・オーナー）が**変わる**なら拒む。INSERT は拒まずに `create_gym_with_owner` と
  同じ値へ上書き（古いアプリは開設のときにこれらの列を送っていた）
- 印は運営だけの表 `tenant_billing_flags`（`is_comp`・`stripe_sandbox_allowed`）。webhook と checkout は印を
  service_role で読み、読めなければ進めない。詳しくは `mem/features/gymboard-saas-plans.md` の「運営の印」
- `delete_my_gym` は本番の定義を写して、印の表の消し込みを1行足した

### 本番への適用（2026-10-31・3段構え）

1. 素振り（DO ブロックの最後で RAISE して全部戻す）: md5 照合 → 適用 → 御所南に is_comp → 下の確かめ、が全部期待どおり
2. 適用: 同じブロックで、確かめの結果が素振りと1文字でも違えば全部戻す形にして流した（通った）
3. 確かめ（オーナー・お客様・未ログイン・service_role を演じた。書いたものは全部戻した）:

| 演じた人 | やったこと | 結果 |
|---|---|---|
| 御所南のオーナー | 設定の保存（gym_name・booking_window_days を同じ値で） | 1行（今まで通り） |
| 〃 | プラン・上限・状態を同じ値で丸ごと保存 | 1行（落ちない） |
| 〃 | max_customers・trial_ends_at・gymboard_plan・owner_user_id を変える | 4つとも拒否 |
| 〃 | 印の表を読む・書く | どちらも permission denied |
| 〃 | premium・上限なし・active・10年後まで、で直接 INSERT | free・5名・trial・60日・契約なし に上書きされた |
| お客様 | 印の表を読む／ジムの上限を NULL に | permission denied／0行 |
| 未ログイン | 印の表を読む | permission denied |
| service_role | 別のジムの max_trainers を変える・御所南の印を読む | 1行・is_comp = true |

`security/check.sql` の検査13 は7列とも「OK: 門番のトリガーが変更を拒む」。印は1行（御所南・is_comp）。

見張り: `src/test/googleCalendarSyncAuthz.test.ts`
