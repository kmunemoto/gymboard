# ジム開設を1トランザクションにした（2026-08-24）

`Onboarding.tsx` の8ステップ逐次書き込みを、RPC `create_gym_with_owner` 1本に畳んだ。
ロードマップのフェーズ1-③。

## 直した実害（3つとも本番で実際に起きていた）

### 1. 孤児テナント（本番に1件あった）

`tenants` の INSERT が通ったあと、`tenant_plans` や `tenant_members` で失敗すると
**巻き戻しが1行も無い**ので tenants だけが残る。しかも:

- 再試行は毎回 `tenants` の INSERT から始まるので、**押すたびに1件ずつ増える**
- 既存判定は `tenant_members` で行っている（`Onboarding.tsx` の入場チェック・`Index.tsx`）ため、
  孤児テナントは検出されず、同じ人が何度でも新規開設に入れる
- `delete_my_gym` は「自分が owner として在籍していること」で本人確認するので、
  **その孤児テナントは本人にもアプリからも消せない**

本番に `98453697-…`（tenant_members が0件）が1件残っていた。

### 2. 🔴 部位マスターのシードが必ず失敗していた（本番で6ジムが0件）

`tenant_muscle_groups` の INSERT ポリシーは `tenant_id = get_my_tenant_id()` を要求し、
`get_my_tenant_id()` は **`tenant_members` の在籍行を読む**。
ところが `Onboarding.tsx` はシードを `tenant_members` の INSERT より**前**に置いていたため、
この INSERT は**常に** WITH CHECK 違反で弾かれていた。
エラーは `console.error` で握りつぶすので誰も気づけない。

皮肉なことに、そのコードのコメントには
「新規テナントはここで作らないと部位が0件になってしまう」と書いてあった。
**まさにその状態が7/29以降ずっと続いていた**（それ以前のジムは 20260723080000 の
バックフィルで入っていたので気づけなかった）。

本番で0件だったのは6ジム: Accompany temari / デモ / エニタイム / vision24 /
Personal Trainingstudio U新百合ヶ丘 / ドレスフィットパーソナル。
この migration のバックフィルで全19ジムが8件になった。

### 3. プラン状態をクライアントが申告していた

`gymboard_plan` / `max_customers` / `status` / `trial_ends_at` を INSERT のボディで
送っていた。`tenants` の INSERT ポリシーは `owner_user_id = auth.uid()` しか見ておらず、
BEFORE INSERT トリガーも無いので、**API を直接叩けば premium・上限999 で開設できた**。

RPC 側で `'trial'` / `'free'` / `5` / `now() + 60日` にリテラル固定した。

## RPC の形

```
create_gym_with_owner(_tenant JSONB, _plans JSONB, _owner_name TEXT, _muscle_groups TEXT[])
  RETURNS TABLE (tenant_id UUID, invite_code TEXT)
```

SECURITY DEFINER なので RLS を通らず、**順序の問題自体が消える**。
中でやること: tenants → tenant_members(owner) → tenant_plans → tenant_muscle_groups → profiles。
どこかで失敗すれば関数ごとロールバック＝**孤児が原理的に発生しない**
（再試行で増える問題も自然に消える）。

未ログインと非トレーナーは弾く（`not_authenticated` / `not_trainer`）。
`anon` からは REVOKE 済み。

**表示プリセットだけは RPC の外**に残した。失敗しても開設自体は成立しており、
後から設定画面で変えられるため（止める理由が無い）。

## ⚠️ 検証で踏んだこと: 「入っているのに0件に見える」

本番検証で部位が0件に見えて、RPC が壊れていると誤診しかけた。
実際は **INSERT は成功していて、数える側が読めていなかった**。

検証は `SET LOCAL ROLE authenticated` でオーナーを演じたまま `count(*)` していたが、
`tenant_muscle_groups` の SELECT ポリシーは `get_my_tenant_id()`＝**そのオーナーの
既存テナント**に絞る。新しく作った検証用テナントの部位は当然読めない。

🔴 **RPC が書いた結果を数えるときは `RESET ROLE` してから数えること。**
演じたロールのまま数えると RLS で0件に見え、実装のバグと区別が付かない。

## 本番検証（すべて BEGIN…ROLLBACK・残留0件）

| # | ケース | 結果 |
|---|---|---|
| 1 | 作成成功・招待コード8桁が返る | ok |
| 2 | オーナーが在籍している | ok |
| 3 | プラン2件が入る | ok |
| 4 | 🔴 部位8件がシードされる（従来は必ず0件） | ok |
| 5 | プラン状態が free/5/trial に固定される | ok |
| 6 | オーナーの profiles が作られる | ok |
| 7 | 🔴 premium/999 の申告を無視する | ok |
| 8 | 業種の未指定は other に倒す | ok |
| 9 | 空のプラン名は作らない | ok |

⚠️ 検証中に RPC の穴を1つ見つけて直した: `business_type` は NOT NULL なのに
coalesce していなかった（画面は必ず選ばせるので実害は無かったが、渡らないと落ちる）。

## 既存テストへの波及

実装が RPC に移ったので、クライアントのソースを見ていた見張り3本を SQL を見る形に更新した
（**意図は変えていない**）:

- `socialLogin.test.ts` … 「開設時に profiles を作る」→ RPC の `INSERT INTO public.profiles`
- `bookingCutoffWiring.test.ts` … 「確認済みとして記録」→ RPC の `booking_capacity_confirmed_at`

`onboardingTransaction.test.ts`（新規）が逆流を防ぐ:
クライアントが直接 INSERT に戻る／プラン状態を送る／在籍より前に部位を入れる／
トレーナー確認を外す、の4変異すべてで赤になることを確認済み。
