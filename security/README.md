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

## 使い方（4ステップ）

### Step 0. ⚠️ 先に「どのブランチを見るか」を決める

**2026-08-03、上流の監査がこれで丸ごと間違いました。**

上流が Lovable の `read_file` で兄弟アプリのコードを読んだところ、ゴルフボードと
セッコツボードは「穴3が丸ごと未修正」に見えました。**実際は直っていました。**
成果物が作業ブランチにしかなく、`origin/main` は remix 直後のまま止まっていたためです。

```
$ git rev-list --left-right --count origin/main...claude/new-session-ius5r0
0    1416
```

**1416コミット分すべてがブランチ側**で、`main` には上流の取り込みも語彙も
メール全廃もログインコードも1つも入っていませんでした。

#### だから、こう決めます

| 誰が | 何を |
|---|---|
| **フォーク側** | **成果物を既定ブランチ（`main`）へ落とす。** 落とせない事情があるなら、上流に**ブランチ名を伝える** |
| **監査する側** | **「どのブランチを見たか」を必ず書く。** 書いていない監査結果は信用しない |

**`main` に何も入っていないと、そのアプリの CI は一度も何も守っていません。**
`ci.yml` は PR と `main` への push で回るので、ブランチに置いたままだと
回帰テストを4本入れても発火しません。**そこが一番危ないです。**

> Lovable の `read_file` / 公開プレビューは**既定 ref を読みます。**
> 上流から見えているのは常に既定 ref です。

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
| 4 | 送信メールの宛先をテナントで絞る | `supabase/functions/send-transactional-email/index.ts` |

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
src/test/transactionalEmailTenantScope.test.ts ← 穴4
src/test/edgeFunctionOrigin.test.ts           ← 上流のドメインが残っていないか
```

この6ファイルを自分のリポジトリの同じパスにコピーして、`npm test` を通してください。

> ### `edgeFunctionOrigin.test.ts` だけ `brand.ts` に1行必要です
> このテストは `src/lib/brand.ts` の **`OWN_WEB_HOSTS`** を唯一の宣言として使います。
> フォーク側の `brand.ts` に無ければ足してください（値は**自分のドメイン**）。
>
> ```ts
> export const OWN_WEB_HOSTS: readonly string[] = [
>   "<自分の本番ドメイン>",
>   "<自分の lovable.app>",
> ];
> ```
>
> **Edge Function（Deno）は `brand.ts` を import できません。** だからドメインは
> 各ファイルに手で書くしかなく、**フォークが `brand.ts` だけ直すと Edge Function に
> 上流のドメインが残ります。** 2026-08-03 にセッコツボードとゴルフボードが実際に
> この状態で、`send-push-notification` の `ALLOWED_URL_HOSTS` がジムボードのままでした
> （自分の絶対URLでプッシュが 400 になり、かつ他社ドメインを許可し続ける）。
> **相対パス `"/"` は通るのでエラーにならず、実機で試すまで気づけません。**

> **`globalTrainerRole.test.ts` はテーブルを列挙しません。**
> 全ポリシーを走査するので、**そのアプリで今後増えるテーブルも自動で見張ります。**
> `pushNotificationTenantScope.test.ts` には
> **全 Edge Function を走査して `get_my_tenant_id` / `shares_tenant_with_me` の
> `rpc()` を禁止する**検査も入っています（後述の罠の再発防止）。

---

## 穴3・穴4 は SQL で見えません

Edge Function はコードなので、DBからは診断できません。**grep してください。**
**Step 0 のとおり、どのブランチで実行したかを必ず添えてください。**

```bash
git rev-parse --abbrev-ref HEAD     # ← どのブランチか

# 4つとも 0件 になること
grep -n "isTrainer" supabase/functions/send-push-notification/index.ts
grep -n "hasRole"   supabase/functions/send-push-notification/index.ts
grep -n "callerIsTrainer" supabase/functions/send-transactional-email/index.ts
grep -n "hasRole"        supabase/functions/send-transactional-email/index.ts
```

1件でも出たら、trainer が宛先検証を素通りできる状態です。

### 穴4（メール）が穴3（プッシュ）より厄介な理由

形はまったく同じですが、**被害の残り方が違います。**

プッシュは端末に届いて終わりですが、メールは
**SPF/DKIM を通した自分の正規ドメイン**（`noreply@notify.<自分のドメイン>`）から出ます。
受信側で弾かれない「本物に見える偽メール」を作れるので、悪用されると
**ドメインの評判が落ちて、正規の予約確認メールまで迷惑メール送りになります。**
復旧に時間がかかる種類の損害です。

しかも `trainer` ロールは**新規登録画面の「トレーナー」タブから誰でも自分で取れます**
（`signup-trainer` は意図的に開けてあります）。
「トレーナーだから信用する」は、**このアプリでは認可の根拠になりません。**

**直したあと、必ず実機で予約確認メールが1通届くことを確認してください。**
メール送信は fire-and-forget なので、**塞ぎすぎても画面にエラーが出ません。**

## ⚠️ プロトコル相対URL（`//`）は **2箇所** あります

**送る側だけ直しても塞がりません。** 上流は 2026-08-03 に送る側だけ直し、
**ゴルフボード（フォーク）が開く側の取り残しを見つけました。**

| どちら | 場所 | 直し方 |
|---|---|---|
| **送る側** | `supabase/functions/send-push-notification/index.ts` の `isAllowedUrl` | `u.startsWith("/") && !u.startsWith("//")` |
| **開く側** | `src/lib/pushNotifications.ts` の `navigateFromData` | `url.startsWith("/") && !url.startsWith("//")` |

**開く側が要る理由**: 通知の payload は `send-push-notification` を通らない経路でも
届きます（別の送信元、端末に残っていた古い通知）。送る側の検証は素通りします。

```bash
# 3箇所出ます。正しいのは nativeBridge.ts（sanitizeAuthNext）だけ、が初期状態
grep -rn 'startsWith("/")' src supabase/functions
```

回帰テストは `src/test/pushNotificationTenantScope.test.ts` が両方を見張ります。

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

## 変異テストのやり方（★必ずやってください）

配布しているテストは**ソースを正規表現で見る形**です。
**書いた本人が壊して確かめない限り、緑のまま何も見ていない状態になりえます。**
上流でもフォークでも、実際に空振りを作ってしまった例が複数あります。

**最低限この4パターンを試して、落ちることを確認してから「入れました」と報告してください。**

| 壊すもの | 落ちるはずのテスト |
|---|---|
| 送る側の `//` ガードを外す（`isAllowedUrl`） | 1件 |
| **開く側の `//` ガードを外す**（`navigateFromData`） | 2件 |
| `hasRole` / `isTrainer` を戻す | 2件 |
| `if (!row.tenant_id) continue;` を消す | 1件 |
| `tenant_members` のマイグレーションを外す | 7件 |
| `check.sql` に `UPDATE` を1行足す | 1件 |
| **`brand.ts` の `OWN_WEB_HOSTS` だけ自分のドメインに変える**（＝フォークの状態を再現） | **4件**（直すべき箇所が全部出る） |

やり方は単純です。**壊す → `npm test` → 落ちるのを確認 → 戻す → 緑に戻るのを確認。**

> **「変異テスト済み」とだけ書かないでください。** 何をどう壊したかを書いてください。
> この表自体、ゴルフボードから「手順が書かれていない」と指摘されて足したものです。

## `mem/` は追わなくて構いません

上流の commit を `cherry-pick` すると `mem/` で衝突します。
上流には `mem/ops/tenant-boundary.md` がありますが、**remix 時点では存在しない**ので
フォークには無く、相当物の名前も違います（例: ゴルフボードは `mem/ops/tenant-isolation.md`）。

**方針: フォークは上流の `mem/` を追わなくてよい。** 衝突したら `mem/` の hunk は捨ててください。
`mem/` は上流の作業記録であって、動作には関係しません。
**フォーク自身の記録は、フォーク自身の名前のファイルに書いてください。**

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
