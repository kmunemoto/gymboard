# マイグレーションの適用状況を検証する（スキーマ乖離チェック）

## 問題

`supabase/migrations/*.sql` はリポジトリに置いてあるだけで、**適用は Lovable / Supabase 側の仕事**。
コミットされている＝本番DBに反映済み、ではない。未適用に気付かないまま進むと:

- クエリが `column does not exist` でまるごと失敗する
  → `useTenant` の段階フォールバックのような回避策が積み上がる
- `as any` で型を握り潰した箇所は型エラーにならず、**実行時に静かに失敗する**

これまでこの状態を検出する手段が無かった。

## 検出のしくみ

`src/integrations/supabase/types.ts` は **本番DBの実スキーマから自動生成** される
（Lovable がマイグレーション適用時に再生成し、リポジトリにコミットされる）。

したがって:

> migrations で作ったはずのテーブル/カラムが `types.ts` に無い ＝ そのマイグレーションは未適用

`src/test/schemaDrift.test.ts` がこの突き合わせを行う。CI（`.github/workflows/ci.yml`）で
PRごとに自動実行されるので、新しい乖離が入ると PR が赤くなる。

パーサが扱う DDL は `CREATE TABLE` / `ALTER TABLE ... ADD COLUMN` / `DROP TABLE` の3種類のみ
（2026-07 時点の migrations に現れるのはこれだけ）。`DROP COLUMN` や `RENAME` を使うときは
テストのパーサにも追加すること。追加を忘れても「あるはずの列が無い」側に倒れるだけで、
乖離を見逃す方向には倒れない。

## 既知の乖離（2026-07-25 時点）

テスト内の `KNOWN_DRIFT` に理由付きで登録してある。

| 対象 | マイグレーション | 状況 |
|---|---|---|
| `booking_waitlist`（テーブル） | `20260624120000_booking_waitlist.sql` | `types.ts` に一度も現れたことがない。以降に何度も types 再生成が走っているので、**未適用の可能性が高い**。`WAITLIST_ENABLED = true` なのでキャンセル待ちが実際には動いていない疑いがある |
| `profiles.milestone_goal` / `milestone_goal_set_at` | `20260708150000_add_milestone_goal.sql` | 同上。`TrainerClientDetail.tsx` が `as any` で読み書きしている |

どちらも `as any` でテーブル/列を参照しているため型エラーが出ず、これまで気付けなかった。

### 確認方法

Supabase SQL Editor（ダッシュボード → SQL Editor）で、これ1本を実行する:

```sql
select
  case when to_regclass('public.booking_waitlist') is null
       then '未適用' else '適用済み' end                     as booking_waitlist,
  case when not exists (
         select 1 from information_schema.columns
          where table_schema='public' and table_name='profiles'
            and column_name='milestone_goal')
       then '未適用' else '適用済み' end                     as milestone_goal;
```

「未適用」が出たものは、対応するマイグレーションを同じ SQL Editor に貼って実行する:

| 結果 | 実行するファイル |
|---|---|
| `booking_waitlist` = 未適用 | `supabase/migrations/20260624120000_booking_waitlist.sql` |
| `milestone_goal` = 未適用 | `supabase/migrations/20260708150000_add_milestone_goal.sql` |

**どちらも冪等**（全ての文が `IF NOT EXISTS` / `DROP ... IF EXISTS` 付き）なので、
既に適用済みの状態で流しても何も壊れない。判定に迷ったら両方流してよい。

適用後は Lovable 側で types.ts を再生成し、`KNOWN_DRIFT` から該当エントリを削除する。

### クラウドセッションからは確認できない

Claude のクラウドセッションはネットワークポリシーで `*.supabase.co` への通信が
遮断されている（ゲートウェイが 403 を返す）ため、この確認は人が実行する必要がある。
Lovable の MCP コネクタが「このチャットで有効」になっていれば代行できる可能性はあるが、
既定では無効になっている。

### 解消したら

1. 該当マイグレーションを適用する
2. `types.ts` を再生成する
3. `KNOWN_DRIFT` から該当エントリを **削除する**
   （残したままだと「適用済みなのに未適用扱い」でテストが落ちる。これも意図的な仕掛けで、
   登録を消し忘れて番人が効かなくなるのを防ぐため）
4. 対応する `as any` を外して型を効かせる

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
登録漏れは `src/test/tenantColumns.test.ts` が検出する（select に足したのに既定値が無い／
既定値だけあって select に無い／表示トグルの定義とのズレ、をそれぞれ落とす）。
