# 店舗側アプリの読み込みを速くする

2026-09-19 宗本さん:「店舗側のジムボードアプリの読み込みが遅すぎる」

## 測りかた（推測で潰さない）

`npm run build` の成果物から、チャンクの静的 import を辿って
「店舗ホームが出るまでに落ちる JS」を数える。

```bash
npm run build
cd dist/assets
# 各チャンクの from"./x.js" を辿って、エントリ + TrainerView/TrainerDashboard/Index の
# 到達集合とそのバイト数を出す（このメモを書いたときは python で集計した）
```

データ側は本番で:

```sql
SELECT count(*), pg_size_pretty(sum(octet_length(to_jsonb(b)::text))::bigint)
  FROM public.bookings b;
```

## 2026-09-19 時点の実測

| | |
|---|---|
| 店舗ホームまでの JS | **1,774 KB / 38 ファイル** |
| うちエントリ（最初の描画をせき止める） | 735 KB |
| うち recharts | **366 KB** |
| 予約データ（JSON） | **395 KB**（816件。最古の予約は 2026-03-17） |

合計 **約 2.2MB を起動のたびに**落としていた。

⚠️ 姿勢分析（TensorFlow）の約 2.4MB は `CustomerPosture` からしか参照されておらず、
**店舗側の経路には入っていない**。ここは疑ったが問題なかった。

## 第1弾（PR #402・実施済み）

`TrainerDashboard` が recharts を**静的 import** していた。そのため
「売上グラフ」を設定でOFFにしていても 366KB 落ち、さらに
起動 → TrainerView → TrainerDashboard → recharts と**直列3ホップ**になっていた。

`src/components/trainer/RevenueBarChart.tsx` に切り出して `lazy()` + `Suspense` に。

**1,774 KB → 1,408 KB（-366KB / -21%）。** 見た目と機能は変えていない。

番人は `src/test/trainerBundle.test.ts`。recharts / TensorFlow が店舗側の起動経路に
静的 import で戻っていないか、日本語以外のロケール（各約120KB）が同梱に戻っていないかを見る。
🔴 ここが緩んでも画面は壊れず「なんとなく遅い」としか見えないので、番人にしてある。

## 🔴 第2弾（未着手・2026-09-20 に宗本さんの判断で**保留**）

`src/hooks/useBookings.ts` の `useAllBookings` が

1. **全期間**の `bookings` を `select("*")` で毎回取得（日付の絞りも件数の上限も無い）
2. そのあと `profiles` を**直列でもう1回**叩く（名前の解決）

いま 816件 / 395KB。**半年でこの量なので、このまま増え続ける**
（直近3か月に絞れば 500件 / 243KB）。

日付で絞るのが筋だが、`TrainerSchedule`・ダッシュボードの月次集計・カルテなど
利用箇所が広く、**過去分が要る画面もある**。
「店舗側で過去どこまで遡れれば足りるか」を確認したところ、
**保留**との回答（2026-09-20）。

再開するときは:

- 使い方を1つ決める（例「予定表は3か月・売上は12か月」）か、決められないなら**まず1年で切る**
- 過去を見る画面だけ、必要になった時点で追加で取りに行く形にする
- 直列の `profiles` 取得は、`bookings` 側に表示名を持たせるか RPC で1回にまとめる

⚠️ 絞りすぎると過去を見る画面が静かに空になる。**画面ごとにどこまで要るかを決めてから**。

## 見ていない伸びしろ（必要になったら）

- エントリ 735KB の中身（React / router / query / supabase / i18n(ja 102KB) / sonner / radix）
- チャンク数 96。小さすぎるチャンクが多く、モバイルでは往復回数が効く
  （`vite.config.ts` に `manualChunks` は未設定）
