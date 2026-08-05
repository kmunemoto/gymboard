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
#247 / #248 のマイグレーションを適用した。#246 は Edge Function なので
`deploy-functions.yml` が main へのマージで自動デプロイした（成功を確認済み）。

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
