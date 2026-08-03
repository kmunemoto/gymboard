# security/ — 兄弟アプリへ配るセキュリティ修正

**このディレクトリは「ジムボードで見つかった穴を、複製元を同じくするアプリへ届けるための置き場」です。**

対象: セッコツボード／ストレッチボード／ピラボード／ゴルフボード／鍼灸ボード
（今後増えたアプリも同じ）

---

## なぜこれがあるか

上流からの `git merge` 運用は **2026-08-03 に終了**しました（`mem/ops/vertical-fork.md`）。
各アプリは独立して進みます。**それ自体は妥当な判断です。**

ただし、その直後に**テナント境界の穴が3件**見つかりました。
複製元が同じなので**全アプリに同じ穴があります**。ところが届ける経路が無く、
指示書を書いて宗本さんが5セッションへ手で配る、という形になりました。

**問題は「配る手間」ではありません。**
配ったところで、各アプリが「うちにも空いている」と気づく保証がないことです。
読み飛ばされたら終わります。

だからここに置くのは**修正そのものより先に、検査**です。

> **考え方**
> 修正を配るのではなく、**穴があれば赤くなる検査**を配る。
> 各アプリが自分の DB と CI で「うちにもある」と自分で気づけば、
> 次に新しい穴が見つかったときも、検査を1本足して配るだけで済みます。

---

## 使い方（3ステップ）

### Step 1. 自分のDBを診断する（5分・読み取り専用）

`security/check.sql` の中身を、Supabase の SQL エディタか
Lovable の `query_database` にそのまま貼って実行してください。**何も変更しません。**

4つの検査が入っています。

| 検査 | 何を見るか |
|---|---|
| **0** | **自分のアプリの実物のポリシー名**（★最初にこれを見る） |
| 1 | 既知の3つの穴が塞がっているか（名指し） |
| 2 | **trainer ロールだけで書けるポリシーの洗い出し**（テーブルを列挙せず全走査） |
| 3 | RESTRICTIVE なテナント絞りが付いているテーブル一覧（検査2 の結果と突き合わせる） |

**検査2 が本命です。** 検査1 はジムボードで見つかったテーブルを名指しで見るだけですが、
検査2 は**そのアプリで独自に増えたテーブル**も見つけます。

> ### ⚠️ 検査0 を飛ばさないでください
> **ポリシー名はアプリごとに違います。** 2026-08-03、ピラボードで実際にこうでした。
>
> ```
> ジムボード : "Trainers/owners can manage members"
> ピラボード : "Owner can manage members"   ← 条件も tenants.owner_user_id ベースで別物
> ```
>
> 穴としては同じですが、**名前が違うと配布された修正SQLが効きません。**
> `DROP POLICY IF EXISTS "<違う名前>"` は**何も消さずに成功します。エラーも出ません。**
> **「適用したのに直っていない」が起きます。**

### Step 2. 塞ぐ

`security/check.sql` で「★要対応」が出たものを、下の対応表のとおり塞ぎます。

| 穴 | 直すもの | 置き場所 |
|---|---|---|
| 1 | `tenant_members` への書き込みを絞る | `supabase/migrations/20260803120000_tenant_members_write_scope.sql` |
| 2 | グローバル trainer で書けるテーブルを塞ぐ | `supabase/migrations/20260803140000_global_trainer_write_scope.sql` |
| 3 | プッシュ通知の宛先をテナントで絞る | `supabase/functions/send-push-notification/index.ts` |

SQL は2本とも `to_regclass` ガードが入っているので、テーブルが無い環境でも止まりません。

**ただし「そのままコピーすれば直る」とは限りません。**
`DROP POLICY` は名前で消すので、**検査0 で見た実物の名前に置き換えてください。**
穴2（マスタ）側は名前が一致することが多いですが、
**穴1（`tenant_members`）は違っていた実績があります。**

### Step 3. 検査を CI に載せる

**ここが一番大事です。** 一度載せれば、以後は自動で見張ってくれます。

```
src/test/helpers/rlsPolicies.ts               ← マイグレーションのポリシー解析（共有部品）
src/test/tenantMembershipWrites.test.ts       ← 穴1
src/test/globalTrainerRole.test.ts            ← 穴2
src/test/pushNotificationTenantScope.test.ts  ← 穴3
```

この4ファイルを自分のリポジトリの同じパスにコピーして、`npm test` を通してください。

> **`globalTrainerRole.test.ts` はテーブルを列挙しません。**
> 全ポリシーを走査するので、**そのアプリで今後増えるテーブルも自動で見張ります。**
> `pushNotificationTenantScope.test.ts` には
> **全 Edge Function を走査して `get_my_tenant_id` / `shares_tenant_with_me` の
> `rpc()` を禁止する**検査も入っています（後述の罠の再発防止）。

---

## 穴3 だけは SQL で見えません

Edge Function はコードなので、DBからは診断できません。**grep してください。**

```bash
# どちらも 0件 になること
grep -n "isTrainer" supabase/functions/send-push-notification/index.ts
grep -n "hasRole"   supabase/functions/send-push-notification/index.ts
```

1件でも出たら、trainer が宛先検証を素通りできる状態です。

---

## 直すときに必ず踏む罠

**この3つは実際に踏みました。先に読んでください。**

### 罠1: `get_my_tenant_id()` / `shares_tenant_with_me()` は Edge Function から使えない

中身が `auth.uid()` 依存です。**service_role クライアントから呼ぶと常に NULL / false**。
しかも**エラーも警告も出ません。**

発行者と対象の両方をこれで取って比較すると `null === null` が **true** になり、
「テナント検証を書いたのに素通り」になります。

**Edge Function では `tenant_members` を直接引いてください。**
テナント内のロール確認は `has_tenant_role(_tenant_id, _user_id, _roles)` を使います
（こちらは `user_id` を明示できるので安全）。

### 罠2: `hasRole(id, 'owner')` は落ちる

`app_role` enum は `('customer','trainer')` の2つだけです。`'owner'` はありません。

### 罠3: `DROP POLICY IF EXISTS` はテーブルが無いと落ちる

`IF EXISTS` が掛かるのは**ポリシー**であって**テーブル**ではありません。

ジムボード本番には `season_pass_config` / `season_pass_levels` が**存在しませんでした**
（リポジトリにマイグレーションはあるのに本番に当たっていなかった）。

**「マイグレーションがあるから本番にもあるはず」と考えないでください。**

---

## 直したあとの確認（本番DBで実際に攻撃してみる）

ROLLBACK 付きなので安全です。実在のスタッフになりすまして試します。

```sql
DO $$
DECLARE
  v_staff  uuid := '<スタッフの user_id>';
  v_tenant uuid := '<そのテナント>';
  v_victim uuid := '<別テナントの顧客の user_id>';
  log text := ''; n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    INSERT INTO public.tenant_members (tenant_id, user_id, role, status)
    VALUES (v_tenant, v_victim, 'customer', 'active');
    log := log || E'\n攻撃1(他テナント顧客をINSERT) => NG 通ってしまった';
  EXCEPTION WHEN others THEN
    log := log || E'\n攻撃1(他テナント顧客をINSERT) => OK 拒否: ' || SQLERRM;
  END;

  BEGIN
    UPDATE public.tenant_members SET user_id = v_victim
     WHERE tenant_id = v_tenant AND user_id = v_staff;
    GET DIAGNOSTICS n = ROW_COUNT;
    log := log || E'\n攻撃2(user_id差し替え) => ' || CASE WHEN n=0 THEN 'OK 0行' ELSE 'NG '||n||'行' END;
  EXCEPTION WHEN others THEN
    log := log || E'\n攻撃2(user_id差し替え) => OK 拒否: ' || SQLERRM;
  END;

  BEGIN
    DELETE FROM public.raid_bosses;
    GET DIAGNOSTICS n = ROW_COUNT;
    log := log || E'\n攻撃3(レイド全削除) => ' || CASE WHEN n=0 THEN 'OK 0行' ELSE 'NG '||n||'行' END;
  EXCEPTION WHEN others THEN
    log := log || E'\n攻撃3(レイド全削除) => OK 拒否: ' || SQLERRM;
  END;

  BEGIN
    UPDATE public.tenant_members SET display_name = display_name
     WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS n = ROW_COUNT;
    log := log || E'\n正常系(自テナントの会員を更新) => ' || CASE WHEN n>0 THEN 'OK '||n||'行' ELSE 'NG 0行' END;
  EXCEPTION WHEN others THEN
    log := log || E'\n正常系 => NG 失敗: ' || SQLERRM;
  END;

  RAISE EXCEPTION 'RESULT %', log;   -- ← これで全部巻き戻る
END $$;
```

> ### ⚠️ 一度 false alarm を出しました
> `role = 'owner'` の人に `SET role = 'owner'` を試すと、
> `IS DISTINCT FROM` が偽になってトリガーが発火せず、`ROW_COUNT` だけ 1 になります。
> **値が実際に変わる方向で試してください**（owner → trainer）。

---

## このディレクトリの方針

- **コピーを置きません。** 修正の実体は `supabase/migrations/` と `src/test/` にあります。
  ここに複製すると必ずずれます（複製が原因のバグは実際に踏んでいます）。
  ここに置くのは **検査（`check.sql`）と手順（この README）だけ**です
- **`check.sql` は読み取り専用を保ちます。** 「診断だから安全」と言えることに価値があります
- 新しい穴が見つかったら、**`check.sql` に検査を1つ、`src/test/` に走査型テストを1本**足します。
  修正内容を全員に理解させる必要はありません。各アプリが自分の赤を見て直します

## 解決しないこと（正直に）

- **本番DBへの適用は手作業です。** ここが自動化できるのは、各アプリが自分でやる場合だけ
- Lovable が各アプリで生成したコードの差異は吸収できません。**配れる単位は SQL とテストだけ**です
- 走査型テストが見つけるのは**既知の型の穴**だけです。新種は人が見つけるしかありません

## 経緯

`mem/ops/tenant-boundary.md` に、3つの穴それぞれの詳細
（何が起きていたか・どう直したか・判断の分かれ目・本番での検証結果）があります。
