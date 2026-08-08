# 会員のお金・契約・在籍状態（2026-08-08）

パーソナルジム向けとして中身が最適か、という問いから出た棚卸しの結果と、その穴埋め。
指導・予約・継続（ゲーム化・ミッション・体組成）はよく出来ている一方、
**経営の背骨（お金・契約・退会）が丸ごと無かった。**

| 領域 | 棚卸しで分かった実態 |
| --- | --- |
| 売上 | 定価 × サイクル開始日の**推計**。実際に受け取ったかは見ていない |
| 入金 | `profiles.paid_this_month`（boolean）だけ。**書き込む UI が1つも無い＝死んだ列** |
| 回数券 | 残数（`tenant_members.ticket_remaining`）はあるが購入履歴が無い |
| 在籍状態 | `tenant_members.status` は実質 `'active'` のみ。休会が表現できない |
| 退会 | `delete_customer_cascade` でカルテごと物理削除する一択 |
| 契約・同意 | 記録する場所が存在しない |
| 基本情報 | 電話番号・ふりがなの欄が無い |

1人ジム（自社の Salute御所南）は全部頭に入るので困らなかった。
本番には15テナントいて、他所のオーナーは会員の支払いを記憶できない。

## 入れたもの

| 記号 | 内容 |
| --- | --- |
| H-1 | `profiles.phone` / `profiles.name_kana`（30 / 100 文字の CHECK 付き） |
| H-2 | `tenant_members` に `suspended_from` / `suspended_until` / `withdrawn_on` / `withdrawal_reason` |
| D | `member_payments`（入金の記録・新規テーブル） |
| B | `member_agreements`（同意の記録・新規テーブル） |
| G | 売上を実績ベースへ。`is_tenant_over_limit` が退会者を数えないよう修正 |

マイグレーション: `supabase/migrations/20260808030000_member_lifecycle_and_payments.sql`
検査: `src/test/memberLifecycle.test.ts`（42件・変異11件とも赤を確認）

## 🔴 触るときに壊しやすいところ

### 1. `is_tenant_over_limit` に `status IS NULL OR` を足さない

元の実装は `status <> 'cancelled'`。SQL の三値論理で **status が NULL の行は偽になり、
元から人数に数えられていない**。`status NOT IN ('cancelled','withdrawn')` も同じ挙動で、
これは意図どおり。

親切のつもりで `(status IS NULL OR status NOT IN (...))` と書くと、NULL の行が新たに
数に入り、**人数が増える＝上限に近づく**。この関数は bookings / workouts / meals の
BEFORE INSERT トリガーから呼ばれるので、超えたジムは**予約もトレ記録も食事記録も
全部通らなくなる**。

2026-08-08 の初稿でまさにこれを書いてしまい、コミット前に気づいて直した。
検査（変異1）で固定してある。

**ロジックを変えるときは「緩める方向」だけ。**

### 2. 休会は席を食う

`suspended` を席数から外すと「全員を休会にすれば上限を回避できる」抜け道になる。
DB（`is_tenant_over_limit`）とクライアント（`occupiesSeat`）の両方で数える。

`occupiesSeat(null)` は **false**。`isActiveMember(null)` が true なのとわざと食い違わせている。
表示の既定（在籍とみなす）と、上限の数え方（NULL は数えない）は別の問題。
揃えたくなったら DB 側を先に決めること。

### 3. 顧客一覧の取得から休会を落とさない

`useAllCustomerProfiles` は元々 `.eq("status", "active")` だった。
そのままだと休会にした瞬間に顧客一覧から消える＝「休会」ではなく「消滅」。
`.in("status", ["active", "suspended"])` にしてある。

退会（`withdrawn` / `cancelled`）は取らない＝一覧から外れる、が正しい挙動。
status が NULL の行は従来どおり対象外（`.eq` のときも除外されていた）。

### 4. 休会者を催促しない

休会中の人は来なくて当然・払わなくて当然。3箇所でガードしている。

- 離脱アラート（`atRiskCustomers`）
- 更新が近い顧客（`renewalSoon`）
- 今月の入金が未記録（`outstandingMembers`）

外すと本物の離脱が休会者に埋もれる。
「アクティブ顧客」の統計カードも休会を数えない（顧客一覧の総数とは意図的に食い違う）。

### 5. `profiles` の行はトリガーが作ってくれない

本番の `auth.users` には**ユーザートリガーが1つも無い**（`mem/auth/social-login.md`）。
`handle_new_user` は関数として存在するが誰も呼んでいない。
なので `.update()` は 0行更新で黙って成功する。連絡先の保存は `upsert` にしてある。

## 売上の方式を変えた

**推計 → 実績。** `getRevenueCycleStartDates`（定価 × サイクル開始日の逆算）は削除した。
残すと「どっちが本物か」が分からなくなるため。

副作用として、**入金を記録し始めるまで売上グラフも今月売上も 0 になる。**
何も言わないと「壊れた」と読まれるので、記録が1件も無いジムには
`member.revenueEmptyTitle` / `member.revenueEmptyBody` の案内カードを出す。
売上系の表示を両方オフにしているジムには出さない。

「今月の入金が未記録」の一覧も、**記録を1件も付けていないジムには出さない**
（全員が並ぶだけで意味が無い）。1件でも記録すると出るようになる。

## 🔴 これは「記録」であって「決済」ではない

アプリはお金を動かさない。現金・振込・カードでジムが受け取った事実を残すだけ。
既存の Stripe は**ジムがジムボードに払う SaaS 利用料専用**で、これとは別物。
アプリ内決済をやるなら Stripe Connect の加盟店審査が絡む別プロジェクトになる。

同様に `member_agreements` は**同意書そのものではなく、同意を得た事実の控え**。
電子署名でも契約書の保管でもない。
「同意済みだから責任は本人」と主張できる類のものではないので、UI にもそう読める文言を書かない。
画面には `member.agreementsNote` でその旨を出している。

## 書き込み権限

`member_payments` / `member_agreements` は両方とも同じ形。

- RESTRICTIVE な `tenant_isolation`（`public.get_my_tenant_id()`）でテナント越えを塞ぐ
- SELECT: 本人（`auth.uid() = user_id`）または `has_role(auth.uid(), 'trainer')`
- **INSERT / UPDATE / DELETE: `trainer` のみ**

🔴 お客様が自分で「払った」ことにできてはいけない。
この非対称が記録の意味そのものなので、`auth.uid() = user_id` を書き込み側に足さないこと。

## UI の置き場所

事務まわり（連絡先・在籍状態・入金・同意）は**カルテの「概要」タブの先頭**に置いた。
専用タブにしなかったのは、タブが最大7本まで埋まっていて（機能フラグ次第で本数が変わる）、
8本目を足すとモバイルでラベルが潰れるため。

顧客一覧では「休会」バッジを他のバッジより先に出す。
検索はふりがな・電話番号でも引ける（漢字が読めないときに効く）。
名前順の並びは `name_kana` があればそれを使う＝五十音順になる。
未入力の人は表示名（漢字はコードポイント順）のまま。混在しても2ブロックに割らない。

## 残していること

- `profiles.paid_this_month` は列も読み取りも残してある（`@deprecated` 注記付き）。
  消すのは、本番でどこからも書かれていないことを確かめてから。
- `delete_customer_cascade`（物理削除）も残してある。個人情報の削除請求に応える手段が要る。
  **退会は「記録を残して在籍を終える」別の操作**で、置き換えではない。
- 回数券の購入履歴は `member_payments.kind = '回数券'` で記録できるが、
  `ticket_remaining` との自動連動はしていない（残数はこれまでどおり手で調整）。

## 本番への適用（2026-08-08 実施・PR #284）

Lovable の `query_database`（project_id = `69ac2641-45d8-44e0-b60d-4e002a4f9c1c`）で適用。
H-1/H-2 → D → B → G の4回に分けた（1本で流すと、途中で落ちたときにどこまで進んだか分からなくなる）。

### 適用前に確かめたこと

- `tenant_members` は 63 行、**status は全部 `'active'`。NULL も想定外の値も 0 件**。
  → `tenant_members_status_known` の CHECK は無事に付いた。
- `is_tenant_over_limit` は本番でも元の `status <> 'cancelled'` だった（想定どおり）。
- 全15テナントで `over_limit` は false。

### 適用後（3段構えの3段目・ロールを演じて実読）

`has_function_privilege` が true でも足りない。実際に読んで・書いて確かめた。

| 演じた相手 | 確かめたこと | 結果 |
| --- | --- | --- |
| Salute のオーナー | bookings 386 / profiles 34 / tenant_members 34 が今も読める | OK（穴8の再発なし） |
| Salute のオーナー | `member_payments` に**実際に INSERT できる** | OK（12,000円の行が返った） |
| お客様 | 自分の入金を自分で INSERT | **弾かれた（期待どおり）** |
| お客様 | 自分の同意記録を自分で INSERT | **弾かれた（期待どおり）** |
| お客様 | bookings 33 / profiles 1 が今も読める | OK |
| anon | 新テーブルは 0 件 | OK |
| anon | `get_tenant_public` が 1 行返る（体験予約の公開経路） | OK |
| anon | `is_tenant_over_limit` が呼べる | OK |
| 全テナント | 適用後に `over_limit` が true になったジムは 0 | OK |

**テナント越えは対照実験で確かめた。** 空のテーブルを覗いて「0件でした」では、
RLS が効いているのか単に行が無いのか区別が付かない。
トランザクション内で Salute の入金を1件実在させたうえで、

- 別ジム（ジムボードパーソナルジム）のオーナー → **0 件**
- Salute のオーナー → **1 件**
- 本人（そのお客様） → **1 件**

を確認して ROLLBACK した。検証で作った行は残っていない（適用後も payments / agreements とも 0 行）。

### 踏みかけた読み違い

anon で `SELECT (public.get_tenant_public(...) IS NOT NULL)` が **false** を返した。
壊したかと思ったが、これは **composite 型の `IS NOT NULL` は全列が非 NULL のときだけ true** という罠。
`SELECT count(*) FROM public.get_tenant_public(...)` で引き直したら 1 行返った。
**戻り値が複合型の関数の生存確認に `IS NOT NULL` を使わないこと。**
