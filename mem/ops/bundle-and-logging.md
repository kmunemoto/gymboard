# バンドルサイズとログの扱い

## ログ: `console.log` は使わず `devLog` を使う

`src/lib/devLog.ts`。判定は `import.meta.env.DEV` なので、本番ビルドでは呼び出しごと畳まれる。

```ts
import { devLog } from "@/lib/devLog";
devLog("LINE通知送信開始", booking.id);
```

| 用途 | 使うもの | 本番 |
|---|---|---|
| 動作確認の一時ログ。お客様の名前・予約内容・記録を含みうるもの | `devLog` | 出ない |
| 障害調査に必要な失敗ログ（IDとエラーメッセージ） | `console.warn` / `console.error` | 残る |

### 経緯（最初の見立ての訂正）

当初「`console.log` が13件あり、お客様のトレーニング記録がコンソールに漏れている」と
指摘したが、**本番ビルドでは既に除去されていた**。`vite.config.ts` の
`esbuild.pure: ["console.log", "console.debug", "console.info"]` が効いており、
`dist` に残る `console.log` は supabase-js と TensorFlow.js のもの（＝ライブラリ側）だけだった。

ただし:

- `npm run build:dev` で作る検証ビルドには残る
- `pure` の設定が外れた瞬間に、13箇所すべてがそのまま漏れる

そのため「ビルド設定が唯一の防波堤」という状態をやめ、コード側で明示するようにした。
`src/test/devLog.test.ts` が `src` 配下に生の `console.log` が無いことを検証する。

削除したもの（デバッグの残りで、残す価値が無かったもの）:

- `MuscleBalanceRadar.tsx` × 2: お客様のトレーニング記録そのものと集計結果を出力していた
- `DiagnosisHistorySection.tsx` × 1: 骨格診断の削除結果

## バンドル: 役割ごとに分割する

### やったこと

`src/pages/Index.tsx` が `CustomerView` と `TrainerView` を**静的に** import していた。
つまり、お客様がジムの管理画面一式（予定表・顧客管理・設定）を、ジム側がお客様の画面一式を、
使わないのに丸ごとダウンロードしていた。`lazy()` に変えて、役割が決まってから片方だけ読む。

| | 分割前 | 分割後 |
|---|---|---|
| 全員が読む Index チャンク | 503.1 kB（gzip 138.4） | 2.6 kB（gzip 1.3） |
| ＋ 共通（PlanLimitBanner 等） | — | 167.6 kB（gzip 52.4） |
| ＋ ジム側 | （上に含む） | 183.2 kB（gzip 44.9） |
| ＋ お客様側 | （上に含む） | 122.0 kB（gzip 33.4） |

実質の削減は **ジム側 −40 kB / お客様 −51 kB（gzip）**。

### 既に分割済みで問題ないもの

- **TensorFlow.js / pose-detection（合計 約2.4 MB）**: `CustomerPosture.tsx` で
  `await import()` している。姿勢診断を開いたときだけ読まれるので初回表示には乗らない
- **recharts（約366 kB）**: 別チャンク
- **ロケール（ja以外、各 約80-92 kB）**: 言語を切り替えたときだけ読む（`src/lib/i18n.ts`）

### 残っている改善余地

- エントリチャンク 693 kB（react-dom / supabase-js / i18next）。ここは削りにくい
- `PlanLimitBanner` チャンク 167 kB の大半は lucide のアイコン。
  アイコンを個別 import に寄せれば減らせる可能性がある

## 大きいファイル（未対応）

| ファイル | 行数 |
|---|---|
| `src/components/trainer/TrainerClientDetail.tsx` | 1,768 |
| `src/pages/CustomerBooking.tsx` | 1,072 |
| `src/hooks/useBookings.ts` | 975 |
| `src/components/trainer/TrainerSchedule.tsx` | 884 |

**今回は手を付けていない。** `TrainerClientDetail.tsx` は1コンポーネントに `useState` が
約50個あり、状態が画面全体に絡み合っている。部分的に切り出すと大量の props を引き回すだけの
中途半端な形になりやすく、機能的な利得も無いまま回帰の危険だけが増える。

やるなら、`src/components/trainer/clientDetail/`（`TrainingGrowthChart.tsx` を切り出し済み）に
**セクション単位で状態ごと**移す。切り出し候補と、それぞれが必要とする状態:

- 体組成の記録・履歴（`bodyWeight` / `bodyFat` / `measurementDate` / `savingMeasurement` / `deleteMeasurementTarget`）
- 目標（`trainingGoal` / `milestoneGoal` とその編集状態、計8個）
- 予約履歴とセッションメモ（`clientBookings2` / `editingNoteBookingId` / `noteDraft` / `savingNote`）

いずれも他セクションと共有する状態がほぼ無いため、この3つは独立して移せる。
先にコンポーネント描画テストを書いてから着手すること（`mem/ops/component-tests.md`）。
