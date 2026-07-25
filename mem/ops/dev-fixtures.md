# 開発用ダミーデータ（ログインなしで全画面を確認する）

## 使い方

```bash
npm run dev:fixtures
```

ログイン画面を通らず、いきなりトレーナー（オーナー）としてアプリが開く。
お客様側の画面を見たいときは、ブラウザのコンソールで役割を切り替える:

```js
localStorage.setItem("devFixtureRole", "customer"); location.reload()
// ジム側に戻す: localStorage.setItem("devFixtureRole", "trainer"); location.reload()
```

Supabase には一切接続しない。データは架空のジム「デモ・フィットネススタジオ」。

通常の `npm run dev` は今までどおり本番プロジェクトに繋がる（挙動は変えていない）。

## なぜ必要だったか

トレーナー側の画面はすべてログイン必須で、リポジトリの `.env` は本番プロジェクトを
指している。つまり:

- 開発中に画面を見て確認する手段が無い（本番データを開発に使うのは論外）
- 結果として、トレーナー側の変更は**目視確認なしで出荷**されていた

実際にこのモードを入れた直後、10画面を通しで見ただけで以下が見つかった:

- 体験フォロー画面のバッジに `trialFollowUp.status.undefined` という生の翻訳キーが表示される
  （DBの `follow_up_status` は CHECK 制約の無い自由文字列で、想定外の値だと対応表を引けない）
  → `statusI18nKey()` を足して未知の値は「未対応」扱いにした

## 仕組み

| ファイル | 役割 |
|---|---|
| `.env.fixtures` | `VITE_DEV_FIXTURES=true`。`vite --mode fixtures` で読まれる（Windows でも動くようにシェルの環境変数ではなくこの形にした） |
| `src/dev/fixtures.ts` | 架空のジムのデータ。テーブル名 → 行の配列 |
| `src/dev/fixtureClient.ts` | Supabase クライアントの差し替え。メモリ上の配列に対して PostgREST 風のクエリを実行する |
| `src/dev/fixtureClient.stub.ts` | 本番ビルド用の空実装 |
| `src/integrations/supabase/client.ts` | `import.meta.env.DEV && VITE_DEV_FIXTURES === 'true'` のときだけ差し替える |

### 本番バンドルに入らないこと

**tree-shaking には頼っていない。** ダミーデータの組み立てがモジュール読み込み時の
副作用になるため Rollup は落とせず、最初の実装では本番の JS に
「デモ・フィットネススタジオ」「DEMO1234」等の文字列が実際に入っていた。

そのため `vite.config.ts` の alias で、production ビルドのときだけ
`@/dev/fixtureClient` → `fixtureClient.stub.ts` に**物理的に差し替えている**。
`src/test/devFixtures.test.ts` がこの設定の存在を検証している。

## 何ではないか

PostgREST の完全な再現ではない。**画面が現実的な見た目で描画されること**が目的で、
RLS・トランザクション・制約・トリガー・Realtime は再現しない。
未対応のクエリ（`or()` など）は黙って絞り込まずに通す＝画面が空にならない側に倒している。

ロジックの正しさは vitest（純粋関数＋コンポーネント描画）で担保する。
このモードは「見た目と導線の確認」専用。

## データを足すとき

`src/dev/fixtures.ts` に行を足すだけ。**アプリのコードは触らない。**
注意点は `src/test/devFixtures.test.ts` が機械的に見張っている:

- **日付は「今日」基準で作る。** 固定日付だと時間が経つほど「予約が全部過去」になり、
  予定表・稼働率・売上の確認ができなくなる
- **時刻はJST基準で作る。** ローカル時刻で作ると、コンテナのタイムゾーン（UTC）次第で
  全予約が9時間ずれ、営業時間外に並ぶあり得ない画面になる（実際に一度そうなった）
- **プラン名は `profiles.plan` と `tenant_plans.plan_name` を一致させる。**
  売上集計はこの文字列一致で価格を引くため、ずれると売上が常に ¥0 になる
- **本番テナントの ID・実在の連絡先は入れない**

## Playwright で通しの見た目を撮る

```js
// executablePath: '/opt/pw-browsers/chromium'（クラウドセッションの場合）
// Vite の依存事前バンドルで初回が白くなるので、goto の後に reload を挟むこと
```
