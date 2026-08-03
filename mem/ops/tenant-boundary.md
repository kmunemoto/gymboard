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
| 1 | `tenant_members` に他人の `user_id` を INSERT できる | 未対応 |
| 2 | `signup-trainer` が自己サービスで、誰でも trainer になれる | 未対応 |

**1 が本丸。** ここが開いている限り、`shares_tenant_with_me()` に依存する
テナント境界（`profiles` / `skeletal_diagnoses` など）は全部意味を失う。
影響が小さく独立して直せる 3 から着手した。

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
