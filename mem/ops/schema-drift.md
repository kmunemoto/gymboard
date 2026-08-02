# マイグレーションの適用状況を確認する

## 前提（重要・2026-07-25 に訂正）

`supabase/migrations/*.sql` はリポジトリに置いてあるだけで、**適用は Lovable / Supabase 側の仕事**。
コミットされている＝本番DBに反映済み、ではない。

一度「`src/integrations/supabase/types.ts` は本番DBから自動生成されるので、そこに無ければ未適用」
という前提で検出テストを書いたが、**この前提は誤り**だった。実際には types.ts は
PRの中で先に更新されており、**本番DBより先行しうる**。

2026-07-25 に Lovable の MCP コネクタ（`query_database`）で本番DBを直接照会したところ、
未適用は **6件** あった。types.ts 方式では **2件しか検出できていなかった**。

> **適用の確認は、実DBを見る以外に方法がない。**

## 確認方法

### A. Lovable MCP から（このセッションからできる）

コネクタ設定で **Lovable を「このチャットで有効」にする**（既定は無効）。
プロジェクトは `gymboard`（`69ac2641-45d8-44e0-b60d-4e002a4f9c1c`）。

**先に、正しいDBか必ず確かめること。**似た名前のプロジェクトが複数ある
（`gymboard-app` / `kyoto-salute` / `active-app-studio`）。ロゴURLに Supabase の
プロジェクトrefが埋まっているので、これで判定できる:

```sql
select substring(logo_url from 'https://([a-z0-9]+)\.supabase\.co') as supabase_ref, count(*)
from public.tenants where logo_url is not null group by 1;
-- rrbfwitprzuevzytykrq が返れば正しいDB
```

### B. Supabase SQL Editor から

同じSQLをダッシュボードの SQL Editor に貼る。

### C. 全件突き合わせ（推奨）— `scripts/check-schema-applied.mjs`

**手で突き合わせる必要はない。** types.ts（＝コードが期待するスキーマ）から
検査用の SQL を1本生成するスクリプトがある。

```bash
node scripts/check-schema-applied.mjs > /tmp/check.sql
# /tmp/check.sql を Supabase ダッシュボード → SQL Editor に貼って実行
```

**結果が0行なら適用漏れ無し。** 行が返ったら、それが実DBに足りないもの。
不足しているテーブル・カラム・関数を、影響の大きい順（アプリが実際に `.rpc()` で
呼んでいる関数 → テーブルごと欠落 → カラム欠落 → その他の関数）に並べて返す。

- **読み取り専用**（`information_schema` と `pg_proc` を見るだけ）。DBは一切変更しない
- **エージェントに認証情報を渡さずに済む。** クラウドセッションからは `*.supabase.co` が
  ネットワークポリシーで遮断されているので、そもそもエージェントは実DBを見に行けない。
  「SQLを生成する側」と「実行する側」を分けてあるのはこのため
- **フォークでもそのまま使える。** フォークは自分の types.ts を持っているので、
  同じコマンドでよい。フォーク独自のテーブル・カラム・関数は誤検出しない
  （期待 ⊆ 実DB を見るだけで、余分なものは無視する）

検証: PostgreSQL 16 に「一部だけ適用済み」のDBを作って、欠落の検出・存在するものの
非検出・フォーク独自オブジェクトの非検出・一致時0行、を確認済み（2026-08-02）。
生成側の回帰は `src/test/checkSchemaApplied.test.ts`。

> 手でやる場合は実DBのカラム数を取って突き合わせる:
> ```sql
> select table_name, count(*) as live_cols
> from information_schema.columns where table_schema='public'
> group by table_name order by table_name;
> ```
> migrations は追加しかしないので、`live < declared` なら確実に未適用がある。

### クラウドセッションから直接HTTPで叩くのは不可

ネットワークポリシーで `*.supabase.co` が遮断されている（ゲートウェイが CONNECT に 403）。

## 2026-07-25 に適用した6件

いずれも追加のみ・冪等。適用後、宣言87テーブルすべてが実DBに存在し、
カラム不足のテーブルは0件になったことを確認済み。

| マイグレーション | 内容 | 未適用だった間の影響 |
|---|---|---|
| `20260624120000_booking_waitlist` | `booking_waitlist` + RLS4本 | キャンセル待ちの登録が失敗していた（`WAITLIST_ENABLED=true` なのに機能せず） |
| `20260708150000_add_milestone_goal` | `profiles.milestone_goal` / `_set_at` | 3ヶ月目標の保存・表示ができなかった |
| `20260723060000_add_trial_bookings_booking_kind` | `trial_bookings.booking_kind` | **ドロップイン予約（¥8,000）が作成不能**。通常の体験予約は `trial-book` がこの列を書かないため無事だった |
| `20260723080000_add_tenant_muscle_groups` | `tenant_muscle_groups` + RLS + バックフィル | 部位の追加・改名・削除が保存できなかった。レーダーチャートは既定8部位で表示だけはされていた |
| `20260723100000_add_gym_display_visibility` | `tenants` に12列 | 表示ON/OFFの保存が失敗。`useTenant` のフォールバックにより全項目表示のままだった |
| `20260725090000_drop_salute_june_2026_guard` | Salute専用6月ガードの撤去 | 関数1・トリガー2が残存。7月なので通常予約には無影響だが、6月の予約行の編集/削除が弾かれていた |

適用結果: `tenant_muscle_groups` 104行（13テナント×8部位）、既存の体験予約52件は
`booking_kind='trial'` を既定値で取得、`tenants` 13件すべて表示12列が `true`（＝見た目は不変）、
ガード関数・トリガーとも0件。

## いま残っているズレ: 無し（2026-08-01 時点）

`KNOWN_STALE` は空。migrations で宣言したテーブル/カラムはすべて types.ts に載っている。

### types.ts の追従は「Lovable の再生成待ち」ではなく、こちらで手で書いてよい

過去に `booking_waitlist` / `profiles.milestone_goal` を「Lovable が再生成するまで `as any`」
にしていたが、再生成はPRのタイミングでは走らない。`39e38d0` で types.ts を実スキーマに
合わせて手で書き、`as any` を43件外した。**これを標準の手順とする。**

2026-08-01 の `tenant_plans.slot_duration_minutes` / `tenants.booking_capacity` も同じ手順:

1. 本番DBに適用する（このドキュメントの「確認方法」）
2. 実DBから列の型・null許容・既定値を引く:
   ```sql
   select table_name, column_name, data_type, is_nullable, column_default
   from information_schema.columns
   where table_schema='public' and column_name in ('slot_duration_minutes','booking_capacity');
   ```
3. `types.ts` の該当テーブルの `Row` / `Insert` / `Update` **3箇所すべて**に、
   アルファベット順の位置へ追記する（`Row` は必須/`Insert`・`Update` は `?` 付き。
   NOT NULL + DEFAULT ありの列は `Insert` でも省略可なので `?`）。
   RPC が返す列なら `Functions` の `Returns` にも足す。
4. `KNOWN_STALE` から該当エントリを消し、その列のために入れた `as any` /
   `as unknown as` と、型を迂回するための `select("*")` を元に戻す
5. `npx tsc --noEmit -p tsconfig.app.json` で確認する
   （**CI はこの形で走る。素の `npx tsc --noEmit` では同じエラーが出ない**）

## `src/test/schemaDrift.test.ts` が守っているもの

**適用状況ではなく、types.ts の鮮度**。migrations で作ったものが types.ts に載っていなければ
補完も型検査も効かず、`as any` で握り潰す実装になり、列名の変更やタイプミスが実行時まで
表面化しない。それを検出する。

パーサが扱う DDL は `CREATE TABLE` / `ALTER TABLE ... ADD COLUMN` / `DROP TABLE` の3種類のみ。
`DROP COLUMN` や `RENAME` を使うときはパーサにも追加すること。

## 教訓

- **types.ts を「DBの実態」として信用しない。** PRで先行して更新されうる
- マイグレーションを含むPRをマージしたら、**その場で実DBに適用されたか確認する**。
  Lovable のPRマージがマイグレーション適用を保証しない
- 新しいテーブル/カラムを `as any` で参照する実装は、**未適用でも型エラーが出ない**。
  この2つが重なると、機能が丸ごと死んでいても誰も気付かない（実際に4機能がそうなっていた）

## tenants のカラム追加手順

`src/lib/tenantColumns.ts` に集約してある。カラムを足すときは:

1. `TENANT_OPTIONAL_COL_GROUPS` の **末尾** に1行足す（追加した順に並べる）
2. 既定値を次のいずれかに登録する
   - `TENANT_DEFAULT_TRUE_COLS`: 列が無いとき **表示・有効** に倒す（判定は `!== false`）。
     表示トグルは原則こちら。未適用環境でも従来どおり全部出るため、機能が消える事故が起きない
   - `TENANT_DEFAULT_FALSE_COLS`: 列が無いとき **無効** に倒す（判定は `=== true`）。
     同日キャンセルの自動消化のように、お客様に不利益が及ぶ設定はこちら
   - `TENANT_VALUE_DEFAULTS`: boolean 以外

フォールバック段（旧 `COL_VARIANTS`）は上記から機械生成される。手で書き換える必要はない。
登録漏れは `src/test/tenantColumns.test.ts` が検出する。
