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

### C. 全件突き合わせ（推奨）

宣言と実DBを機械的に比較する。実DBのテーブルごとのカラム数を取り:

```sql
select table_name, count(*) as live_cols
from information_schema.columns where table_schema='public'
group by table_name order by table_name;
```

migrations 側の宣言（`CREATE TABLE` の列＋`ADD COLUMN`）と突き合わせ、
**実DBのカラム数が宣言より少ないテーブル**と**実DBに無いテーブル**を探す。
migrations は追加しかしないので、`live < declared` なら確実に未適用がある。

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

## いま残っているズレ: types.ts が古い

`booking_waitlist` と `profiles.milestone_goal` / `_set_at` は**本番DBには入ったが types.ts に無い**。
そのため `useWaitlist.ts` / `TrainerClientDetail.tsx` は `as any` のまま。
Lovable 側で types.ts が再生成されたら、`src/test/schemaDrift.test.ts` の `KNOWN_STALE` から
該当エントリを削除し、`as any` を外すこと（登録が残っているとテストが落ちるようにしてある）。

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
