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

主な検査は次のとおりです（全部はファイルのコメントを見てください）。

| 検査 | 何を見るか |
|---|---|
| **0** | **自分のアプリの実物のポリシー名**（★最初にこれを見る） |
| 1 | 既知の3つの穴が塞がっているか（名指し） |
| 2 | **trainer ロールだけで書けるポリシーの洗い出し**（テーブルを列挙せず全走査） |
| 3 | RESTRICTIVE なテナント絞りが付いているテーブル一覧（検査2 の結果と突き合わせる） |
| **10** | **お客様が trainer の印を付けると、同じジムの全員のデータが読めないか**（★穴11。検査2・3 では見つからない） |
| 11 | 招待コードを知らない人が、お客様として好きなジムに入れないか（★穴12） |
| 12 | 予約・チャット・お知らせの1人宛ての相手が、そのジムの人に限られているか（★穴13） |
| 13 | オーナーが自分のジムのプラン・上限を API で書き換えられないか（★穴14。列単位の REVOKE は効いていないことがある） |
| 14 | お客様が自分の契約の列（プラン・起算日）を書き換えられないか（★穴21。自分でジムを作るだけで「スタッフ」になれる） |
| 15 | お客様が予約の印（source）を偽ったり、自分の予約の日時を API で動かしたりできないか（★穴22。満枠の検査は INSERT のときだけ） |
| 16 | オーナーを引き継いだあと、元オーナーが「持ち主」のまま残らないか（★穴23。owner_user_id で判定している所が多い） |
| 17 | お客様の削除が、他のジムの記録・共通のプロフィールまで消さないか（★穴29。退会済みの所属を在籍に戻すと、今は1つのジムの人も狙える） |
| 18 | 所属の判定・ジムの人数を、関係の無い人に答えていないか（★穴30。RLS が使う述語なので EXECUTE は剥がせない。答えを絞る） |

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
| 4 | 送信メールの宛先をテナントで絞る（画面からの呼び出しは、載せるジム・リンク・差出人名もサーバーが決める） | `supabase/functions/send-transactional-email/index.ts`・`supabase/functions/_shared/emailClientGuard.ts` |
| 5 | LINE送信の宛先をテナントで絞る（自分以外は「スタッフ ⇔ その在籍者」だけ。お客様同士は不可） | `supabase/functions/send-line-message/index.ts`・`supabase/functions/_shared/lineRecipients.ts` |
| 6 | **メールキューRPCから anon を剥がす** | `supabase/migrations/20260805000000_email_queue_revoke_roles.sql` |
| 7 | **DB内の関数が他プロジェクトを叩くのを止める** | 実DBで直す（下記。リポジトリには無い） |
| 11 | **印の判定を「そのジムのスタッフか」に差し替える** | `supabase/migrations/20261031040000_staff_checks_tenant_scoped.sql` |
| 12 | 招待コードの確認で参加券を出し、券の無い参加を断る | `supabase/migrations/20261031050000_customer_join_requires_invite_code.sql` |
| 13 | 予約・チャットの相手をそのジムの人に限る | `supabase/migrations/20261031060000_booking_user_must_be_member.sql`・`supabase/migrations/20261031070000_message_receiver_must_be_member.sql` |
| 14 | ジムの課金・契約の列を画面から書き換えさせない（と、運営だけの課金の印） | `supabase/migrations/20261031090000_billing_flags_and_tenant_billing_guard.sql` |
| 21 | お客様の契約の列（プラン・起算日）を本人・他のジムから書き換えさせない | `supabase/migrations/20261101040000_profile_plan_guard_scope.sql` |
| 22 | 予約の source='salute_sync' を画面から付けさせない・お客様に予約の枠を決める列を変えさせない | `supabase/migrations/20261101050000_booking_customer_update_guard.sql` |
| 23 | オーナーの引き継ぎで、ジムの持ち主（owner_user_id）も新オーナーへ移す | `supabase/migrations/20261101060000_transfer_ownership_updates_owner.sql` |
| 29 | お客様の削除は、呼んだオーナーのジムの記録だけを消す（他のジムにも所属がある人は、共通の行を残して所属だけ外す） | `supabase/migrations/20261101100000_delete_customer_tenant_scope.sql` |
| 30 | 所属の判定は、本人・そのジムのスタッフ（と、スタッフについての問い）にだけ本当の答えを返す。人数・上限はそのジムの人にだけ | `supabase/migrations/20261101110000_membership_answers_scoped.sql` |

SQL は `to_regclass` / `to_regprocedure` ガードが入っているので、
対象が無い環境でも止まりません。

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
src/test/lineMessageTenantScope.test.ts       ← 穴5（LINE を使っていなくても入れてよい）
src/test/emailQueueGrants.test.ts             ← 穴6
src/test/edgeFunctionOrigin.test.ts           ← 上流のドメインが残っていないか
```

この8ファイルを自分のリポジトリの同じパスにコピーして、`npm test` を通してください。

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

---

## 穴6: `REVOKE ... FROM PUBLIC` は効いていません（2026-08-05 追加）

**これまでで一番範囲が広い穴です。** 相談ボードが `pg_proc.proacl` を実際に見て見つけました。
**穴1〜5 と違って、ログインすら要りません。**

### マイグレーションは「塞いだつもり」でした

```sql
REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;
```

Supabase は初期設定で
`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`
を入れています。**`public` に関数を作った瞬間、`anon` と `authenticated` に「明示の」EXECUTE が付きます。**

そして **`REVOKE ... FROM PUBLIC` は、名前付きロールへの明示 GRANT を消しません。**
ACL 上 `=X/postgres`（PUBLIC）と `anon=X/postgres` は**別のエントリ**だからです。
REVOKE は PUBLIC の分だけ消して、`anon` / `authenticated` はそのまま残ります。

### なぜ致命的か

対象の4関数は**すべて `SECURITY DEFINER` で、関数の中に認可チェックが1つもありません。**
GRANT だけが唯一の防御でした。そして **anon キーは全クライアントに埋め込まれています。**

| 関数 | anon から叩けると |
|---|---|
| `enqueue_email` | 任意の宛先へ任意の本文を、**SPF/DKIM を通した自分の正規ドメインから**送れる |
| **`read_email_batch`** | **配送前のキューが読める。パスワード再設定リンクが含まれます** |
| `delete_email` | 配送前のメールを消せる |
| `move_to_dlq` | 同上 |

**`read_email_batch` が一番深刻です。** アカウント乗っ取りに直結します。

### 診断と修正

`security/check.sql` の**検査4**（★要対応 が出たら該当）。塞ぎ方は同ファイルのコメントに
書いてあります。**引数の型は自分のDBの実物に合わせてください。**
シグネチャが違うと落ちるか、別のオーバーロードだけ剥がして安心してしまいます。

マイグレーションにも入れてください（作り直したときに戻らないように）:
`supabase/migrations/20260805000000_email_queue_revoke_roles.sql`

> **同一シグネチャの `CREATE OR REPLACE FUNCTION` は既存の権限を保持します**
> （＝流し直しても anon が増えることはありません）。
> **戻るのは `DROP` → `CREATE` と、引数を変えて「別の関数」として作ったときです。**
> どちらも実際に起こるので、定義の直後に必ず REVOKE を書いてください。

### 同じ形が他に無いかも見てください

`security/check.sql` の**検査5**が全 `SECURITY DEFINER` 関数を洗います。
判断は2軸です。

```
anon から叩ける ＋ 関数の中で auth.uid() を見ていない  → 危険
anon から叩ける ＋ 関数の中で auth.uid() を見ている    → 問題なし
```

`join_tenant_as_staff_with_invite_code` などは後者なので、出てきても対応不要です。

### 流したあと

**「流した」ではなく「消えた」まで確認してください。**
検査4 をもう一度実行して `OK` になることを見る。ここを飛ばすと、
穴1 の `DROP POLICY IF EXISTS "<違う名前>"` と同じ
「適用したのに直っていない」が起きます。

---

## 穴7: DB内の関数が「他プロジェクト」を叩いています（2026-08-05 追加）

**リポジトリを見る検査では、構造的に見つけられません。** 相談ボードが実DBを見て発見し、
**8プロジェクトを実測**して確認しました。

### 何が起きているか

remix でできた兄弟アプリの**DB内の関数**に、**remix 元のプロジェクトの URL** が残っています。

```
アプリ（kyoto-salute）
   └─ remix → ジムボード
        ├─ remix → ピラボード / ストレッチボード / 相談ボード
        └─ remix → セッコツボード / ゴルフボード
```

その関数は vault から**自分の service_role キー**を取り出し、
**他プロジェクトの Edge Function へ Authorization ヘッダで送ります。**
`notify_trainer_new_signup` は加えて**登録者のメールアドレスと表示名**も送ります。

**service_role キーは RLS を無視して全データを読み書きできる鍵です。**

### 2種類のズレ方があります

`setup_email_infra`（Lovable が Management API で流すもの）の挙動が原因です。

| | setup を流した | 流していない |
|---|---|---|
| `email_queue_wake` / `email_queue_dispatch` | 自分の ref に直る | **remix 元のまま** |
| `notify_trainer_new_signup` | **直らない** | 直らない |

**`notify_*` は setup を流しても直りません。手で直すしかありません。**

### 🔴 Vault セットアップの前に、必ずこれを直してください

**順序が逆だと、キーを入れた瞬間に漏れ始めます。**

実測で、`email_queue_wake` の**トリガーは接続済みなのに vault キーが無いだけ**、という
アプリが2つありました。この状態で Vault を入れると、

- そのアプリの service_role キーが**他プロジェクトへ飛ぶ**
- そのアプリのメールは**永久に配送されない**（自分の Edge Function を叩かないため）

が同時に起きます。**メール実装ガイドの Vault の手順より前に、この検査を通してください。**

### なぜリポジトリの検査では届かないのか

`src/test/edgeFunctionProjectRef.test.ts` は `supabase/functions/` を見ます。
しかし**これらの関数はリポジトリのマイグレーションに存在しません**（Management API 製）。

**リポジトリをどれだけ綺麗にしても素通りします。実DBを見る以外に方法がありません。**

### 診断

`security/check.sql` の**検査6**（DB内の関数）と**検査7**（cron の POST 先）。

`scripts/check-schema-applied.mjs` が生成する SQL にも同じ検査が入っています
（`.env` の `VITE_SUPABASE_PROJECT_ID` と自動で突き合わせるので、そちらのほうが楽です）。

```bash
node scripts/check-schema-applied.mjs > /tmp/check.sql
# /tmp/check.sql を SQL Editor に貼る。WRONG PROJECT REF が出たら該当
```

### 直し方

その関数を `CREATE OR REPLACE` で流し直し、URL を自分の ref に書き換えます。
**使っていない関数なら `DROP FUNCTION` のほうが安全です**
（service_role キーがヘッダに載る設計自体を残さない）。

**発火していたかは、トリガーが接続されているかで判断できます。**

```sql
-- 0件なら一度も発火していない
select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal and p.proname = 'notify_trainer_new_signup';
```

> ⚠️ **「0件」を「見えていないだけ」と取り違えないこと。**
> 対照として、内部トリガーも数えてください。
> `select count(*) from pg_trigger where tgrelid='auth.users'::regclass;`
> ここが0なら、カタログが見えていない可能性を疑います（実測では30件見えました）。

### 1本直して終わりにしないこと

**相談ボードは検査を足した直後に2本目を見つけました。**
**直したら、検査6・7をもう一度流して0件になったことを確認してください。**

---

## 穴11: お客様が trainer の印を付けると、同じジムの全員のデータが読めます（2026-10-31 追加）

**検査2・3 が全部 OK でも開いています。** 検査2 は「別のジムから書けるか」を見て、
RESTRICTIVE のテナント絞りがあれば安全としていました。ところが、

```
お客様 A（ジム X のお客様） → signup-trainer を自分で呼ぶ → trainer の印が付く
  → PERMISSIVE の has_role(auth.uid(), 'trainer') が真
  → RESTRICTIVE の tenant_id = get_my_tenant_id() も真（A の get_my_tenant_id() は X）
  → ジム X の全員のプロフィール・予約・チャット・食事の写真が読める（読み取りを含む）
```

ジムボードの本番でお客様を演じたところ、他人のプロフィール 43・予約 655・メッセージ 171・
食事の写真 14 が読めました（ROLLBACK 済み。印を持つお客様は本番に0人でした）。
招待コード無しで入った部外者でも同じでした。お客様の予約の削除・変更の制限（トリガー）も
`has_role(trainer)` で素通りにしていたので、自分の過去の予約を消して消化数を減らせました。

### 診断と修正

`security/check.sql` の**検査10**（ポリシー）と**検査10-b**（関数）。★★ が出たら、
印の判定を次に差し替えます（ほかの条件は変えない）。

| 表 | 差し替え先 |
|---|---|
| `tenant_id` がある | `public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])` |
| 人ごと（profiles・weight_journey など） | `public.is_staff_of_user(user_id)`（同じマイグレーションで作る関数） |
| 写真の置き場 | `has_tenant_role(get_my_tenant_id(), …) AND shares_tenant_with_me(フォルダ)` |

実物は `supabase/migrations/20261031040000_staff_checks_tenant_scoped.sql`。
**残してよいのは2つだけ**です: ジムを開く前のロゴのアップロード（avatars の tenant-logos）と、
ジムを開く関数（create_gym_with_owner）。どちらもまだジムが無いので印で見るしかありません。

### 流す前に必ず

- 自分のアプリの実物のポリシー名で書くこと（検査0）。ジムボードは本番の92本と名前を突き合わせてから書きました
- 流したら、オーナー・インストラクター・お客様を演じて、各表の件数が**変わらない**こと、
  お客様＋印が**自分の分だけ**になることを数えてください（ジムボードは1回の処理で前後を数え、
  1件でも変われば自動で巻き戻すようにして流しました）

---

## 穴12: 招待コードを知らない人が、お客様として好きなジムに入れます（2026-10-31 追加）

`tenant_members` の INSERT ポリシーが「自分の行で `role = 'customer'`」を通すだけで、招待コードを見ていません。
ジムの id は体験予約ページの URL などに出ているので、ログインした人なら API で好きなジムに入れます。
**穴11 と組み合わせると、部外者がジムの全員のデータまで届きます**（ジムボードの本番で演じて確認）。

診断は `security/check.sql` の**検査11**。直し方は
`supabase/migrations/20261031050000_customer_join_requires_invite_code.sql` で、**画面の手順は変えません**:

```
参加の画面は「lookup_tenant_by_invite_code でコードを確かめる → 自分を tenant_members に入れる」の順
  → コードの確認が当たったら、ログインしている本人に「参加券」（本人 × 招待コード、24時間）を出す
  → 画面からの直接の参加（authenticated が自分を customer で入れる）は、券が無ければ BEFORE INSERT で断る
```

- 券は**招待コード**で持つ。コードを作り直すと古い券は使えなくなり、ジムを閉じる処理に消し込みも要らない
- 門番のトリガー関数は **SECURITY INVOKER** にすること（`current_user = 'authenticated'` で画面からを見分ける。
  DEFINER にすると常に所有者になって素通り）。関数の中（開設・取り込み・スタッフの参加）と service_role は対象外になる
- 自分のアプリの参加の画面が、本当に「確かめてから入れる」順になっているかを先に確かめること

---

## 穴13: 自分のジムの予約・チャットに、他のジムの人を入れられます（2026-10-31 追加）

ジムは誰でも開けます。自分のジムの予約（`bookings.user_id`）やチャット（`messages.receiver_id`）に
**他のジムの人の user_id** を入れると、service_role で動く通知がその人に届きます。

- 予約 → 予約確認のメールがその人のアドレスへ。送信記録（`email_send_log`）に**アドレスと氏名**が残り、
  ジムのスタッフ（＝攻撃者）が読めます。差出人名・案内文は攻撃者のジムの設定なので、なりすましメールにもなります
- チャット → その人の端末に「〇〇さんからメッセージ」のプッシュ。同じジムのお客様どうしでも送れていました

他のジムのオーナーの user_id は、ロゴのファイル名（`tenant-logos/<user_id>-…`）や空き枠の担当から取れます。

診断は `security/check.sql` の**検査12**。直し方は、行を作る時点で「そのジムに所属しているか（在籍の状態は問わない）」を
BEFORE INSERT / UPDATE OF のトリガーで確かめます（チャットはさらに「お客様からはスタッフにだけ」）。
門番の関数は **SECURITY INVOKER**（`current_user = 'authenticated'` で画面からを見分ける）。
**流す前に、自分の本番で「所属していない人の行」が最近作られていないかを数えてください**（ジムボードは直近90日で0件でした）。

---

## 穴14: オーナーが自分のジムのプラン・上限を API で書き換えられます（2026-10-31 追加）

`tenants` の UPDATE のポリシーが「自分がオーナーの行」しか見ていないと、オーナーは API を直接叩いて
プラン（`gymboard_plan = 'premium'`）・上限（`max_customers = NULL` で上限なし）・お試し期間（`trial_ends_at`）を書き換えられます。
直接の INSERT（`owner_user_id = auth.uid()` だけを見るポリシー）でも、同じ値でジムを開けます。

🔴 **`REVOKE UPDATE (列) ON tenants FROM authenticated` では守れていません。** テーブル単位の UPDATE 権限が残っていると、
列単位の REVOKE は何もしません（穴6 と同じ形）。ジムボードもこの REVOKE を書いていて、本番では全列を UPDATE できました。

診断は `security/check.sql` の**検査13**。直し方は `supabase/migrations/20261031090000_billing_flags_and_tenant_billing_guard.sql`:
BEFORE INSERT OR UPDATE のトリガー（**SECURITY INVOKER**。`current_user` が authenticated / anon のときだけ）で、

- UPDATE: 守る列が**変わる**なら拒む（同じ値なら通す。画面の保存が丸ごと送ってきても落ちない）
- INSERT: 拒まずに、ジムを開く RPC と同じ値へ上書き（古いアプリは開設のときにこれらの列を送っていたため）

列 GRANT の許可リストにしなかったのは、設定の列を足すたびに画面の保存が黙って落ちるからです。
**流す前に、自分の画面がこれらの列を tenants に書いていないか確かめてください**（ジムボードは `src/test/stripeBillingFlags.test.ts` が走査で見張っています）。

同じマイグレーションで、コンプ（無償で無制限）とテスト決済を許すジムの**印**を、運営だけが触れる別の表（`tenant_billing_flags`）に置いています。
コンプを `max_customers IS NULL` で見分けていると、上限なしの有料プラン（Pro）も当てはまり、解約しても Pro のまま残ります。

---

## 穴21: お客様が自分の契約の列（プラン・起算日）を書き換えて、回数の上限や入金の確認をすり抜けられます（2026-11-01 追加）

契約の列（`plan`・`cycle_start_date` など）が `profiles` にあって**全部のジムで共通**なアプリ向けです。
本人の行を「どこかのジムのスタッフなら素通し」にしていると、`tenants` の INSERT は誰でもできるので、お客様が自分でジムを
1つ作ってオーナーになるだけで、元のジムのお客様のままプランや起算日を書き換えられます。2つ目のアカウントでジムを作り、
1つ目をそのお客様にすれば、店の側（2つ目のオーナー）からも書き換えられます。起算日を本人が消せる（NULL）と、
「次回分の入金まで次回分の予約を受け付けない」のような確認もすり抜けます。

診断は `security/check.sql` の**検査14**。直し方は `supabase/migrations/20261101040000_profile_plan_guard_scope.sql`:

- 本人の行の素通しは「スタッフで、しかもお客様としての所属がどこにも無い人」だけ
- 本人による起算日の変更は、アプリの自動設定と同じ形だけ（消さない・戻さない・今日より前にしない・自分の予約がある日）
- 店の側の変更も、そのお客様が自分がスタッフでないジムにも通っているなら拒む（共通の列なので、他のジムの契約まで変わる）

**流す前に、自分のアプリが本人の起算日をどう書いているか確かめてください**（ジムボードは予約を入れた直後に、その予約の日付を入れる。
`src/test/profilePlanGuard.test.ts` が見張っています）。根本は、契約の列を所属（`tenant_members`）ごとに持つことです。

---

## 穴22: お客様が予約の印を偽って満枠などの検査を飛ばせます・自分の予約の日時を API で動かせます（2026-11-01 追加）

満枠・ブロック枠・休みの日・メニュー・限定オプションの検査（トリガー）に「`source = 'salute_sync'`（昔の Salute 同期の印）なら素通し」が
入っています。塞ぐはずのポリシー（`20260625100000` の `no_client_salute_source_insert`）がジムボードの本番には入っておらず、
お客様が `source: "salute_sync"` を付けて予約を作ると全部すり抜けました。また、満枠の検査（`check_booking_overlap`）は INSERT のときだけ
動くので、お客様が自分の予約を UPDATE できると（当日の消化のために開けてある）、日時を満枠の時間へ動かせました（1枠に2人）。

診断は `security/check.sql` の**検査15**。直し方は `supabase/migrations/20261101050000_booking_customer_update_guard.sql`:

- INSERT に RESTRICTIVE のポリシー（anon・authenticated は `source = 'salute_sync'` を付けられない）
- 予約の UPDATE の門番（`enforce_booking_update_guard`）で、お客様（その予約のジムのスタッフでない人）は日時・ジム・本人・プラン・source・
  担当・メニュー・オプションを変えられない。店が取り消した予約も戻せない

🔴 **`20260625100000` をそのまま流さないでください。** 同じファイルの問診の部分も未適用のままで、流すと問診のポリシーが古い形に戻ります。
**流す前に、自分のアプリのお客様が予約の行をどう UPDATE しているか確かめてください**（ジムボードは status と trainer_note だけ。
日時の変更は「消して作る」。`src/test/bookingCustomerUpdateGuard.test.ts` が見張っています）。

---

## 穴23: オーナーを引き継いでも、元オーナーが「持ち主」のまま残ります（2026-11-01 追加）

引き継ぎの関数（`transfer_gym_ownership`）が `tenant_members` の役割だけを入れ替え、`tenants.owner_user_id` を元オーナーのまま残していました。
`owner_user_id` で「オーナーか」を見ている所が多いので、元オーナー（インストラクターになったはずの人）がジムの設定を変え続けられ、
インストラクターの招待コードも取れました。新オーナーに外されても、`tenant_members` の INSERT ポリシーの owner の枝
（「`owner_user_id` が自分のジムなら owner として入れる」）で、フル権限のオーナーとして戻れました（全お客様の情報が見える）。

診断は `security/check.sql` の**検査16**。直し方は `supabase/migrations/20261101060000_transfer_ownership_updates_owner.sql`
（役割を入れ替えたあと `UPDATE tenants SET owner_user_id = 新オーナー`。SECURITY DEFINER の中なので、tenants の門番は通ります）。
すでに引き継ぎをしたジムがあれば、検査16 の2行目以降に出ます。そのジムは `owner_user_id` を有効なオーナーに直してください。

---

## 穴29: お客様を削除すると、他のジムの記録と共通のプロフィールまで消えます（2026-11-01 追加）

顧客一覧の「削除」（`delete_customer_cascade`）が、トレーニング・予約・食事・チャットを `user_id` だけで探して消していました。
2つのジムに所属の行がある人を片方のオーナーが削除すると、もう片方のジムの記録と、ジムをまたいで1つしかない
プロフィール・通知の設定・印（`user_roles`）まで消えます。印が消えた人は、働いているジムのスタッフ画面に入れなくなり、
参加し直しても戻りません。退会済みの所属の行はオーナーが「在籍」に戻せるので、昔のお客様がいま他のジムで働いていれば、
悪意のあるオーナーがわざと起こせます。

診断は `security/check.sql` の**検査17**。直し方は `supabase/migrations/20261101100000_delete_customer_tenant_scope.sql`:
オーナーが呼んだときは、自分がオーナーとして在籍していて、そのお客様の所属の行があるジムの記録だけを `tenant_id` で絞って消します。
他のジムに所属の行が無い人（ふつうのお客様）は今まで通り全部消えます。他のジムにも所属がある人は、共通の行を残して
自分のジムの所属だけを外します。お客様本人・service_role から呼んだときの動き（全部消す）は変えていません。

---

## 穴30: 他人がどのジムに通っている（いた）かを、ログインした誰でも確かめられます（2026-11-01 追加）

所属の判定の関数（`is_tenant_member`・`is_tenant_member_any_status`・`has_tenant_role`・`has_role`）は RLS と門番のトリガーが
使うので、authenticated から EXECUTE を剥がせません（検査5-c）。引数の `user_id`・`tenant_id` を呼んだ人と突き合わせずに答えるので、
他人の user_id と公開されているジムの id（体験予約のページの URL など）を組にして直接呼ぶと、その人がどのジムに在籍しているか・
していたか（退会も含む）・お客様かスタッフかが分かります。チャットを送ろうとしたときのエラーの違いからも同じことが分かります。
`get_tenant_limit_status` も、どのジムの id でもお客様数・上限（＝契約プラン）を返していました。

診断は `security/check.sql` の**検査18**。直し方は `supabase/migrations/20261101110000_membership_answers_scoped.sql`:
呼んだ人が本人かそのジムの在籍中のスタッフのとき、または聞かれた人がそのジムの在籍中のスタッフのときだけ本当の答えを返し、
それ以外は false にします（サーバーは今まで通り）。`has_tenant_role` は、スタッフの役割だけを聞くときは今まで通りにします
（答えが変わらず、RLS で1行ごとに呼ばれるので重くしない）。`get_tenant_limit_status` はそのジムの人にだけ返します。

⚠️ 適用の前に、**自分のアプリの全部のポリシーと関数**で、これらの関数に `auth.uid()` 以外の user_id を渡している所を洗い出してください
（ジムボードでは、スタッフだけが通るポリシー2本と、門番のトリガー3本だけでした）。お客様どうしで相手の所属を確かめる仕組みが
あるアプリでは、そこが false になって止まります。適用の前後で、お客様・オーナー・インストラクターが画面で読む件数が変わらないことを
確かめてください（ジムボードは同じトランザクションの中で比べ、違えば全部戻す形で適用しました）。

---

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
