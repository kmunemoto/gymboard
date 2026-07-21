# プラン消化状況カード（PlanUsageCard）と「利用期間の表示」設定

## 概要
`src/components/customer/PlanUsageCard.tsx` が、予約画面・ホーム・トレーナーの顧客詳細で
共通利用される「現在のプラン／残り回数／利用期間」カード。集計ロジックは
`src/lib/planUsage.ts`（`computePlanUsage`）に集約。

## `profiles.show_usage_period`（お客様ごとにトレーナーがON/OFF）
トレーナーが `TrainerClientDetail.tsx` の「利用期間の表示」スイッチで、**特定のお客様にだけ**
利用期間（期限・残り日数）を見せない設定にできる（既定 true=表示）。**「回数」情報
（残り予約可能回数・進捗バー）はこの設定と無関係で常に表示される**——隠すのは「期間」
（日付・期限切れ警告）だけ。

### 2026-07: 設定はあるのに実際には効いていなかった不具合の修正
`show_usage_period` はDBに保存でき、トレーナー側のスイッチも動いていたが、**お客様向けの
表示コンポーネント（`PlanUsageCard`）がこのフラグを一切参照していなかった**ため、OFFにしても
お客様のホーム・予約画面には利用期間がそのまま表示され続けていた。加えて、**プッシュ通知
`push-period-reminder`（期限7日前/3日前のリマインド）も同じ設定を無視**しており、UIを直しても
通知経由で期限情報が漏れる状態だった。

**対処**:
- `PlanUsageCard` に `showUsagePeriod?: boolean | null` prop を追加。`periodVisible =
  showUsagePeriod !== false`（未指定/nullは表示側にフォールバック）。
  - `false` のときは、期間表示ブロック（期限未確定/回数消化済み/日付レンジの3分岐）を
    まるごと非表示にするだけでなく、`isExpired`/`isExpiringSoon` の判定にも
    `periodVisible &&` を掛けて、**カードの警告色（赤枠・オレンジ枠）やアイコン色も
    出さない**（文言だけ隠して赤枠だけ残ると、かえって不安を煽るため）。
  - 残り回数の進捗バー・通い放題テキストは `!isExpired` 条件のまま。`periodVisible=false`
    のときは `isExpired` も常に `false` になるので、**回数情報は今までどおり普通に表示**される。
- `CustomerHome.tsx` / `CustomerBooking.tsx` の `<PlanUsageCard>` 呼び出しに
  `showUsagePeriod={profile?.show_usage_period}` を追加（**この2箇所が漏れていた**）。
- `TrainerClientDetail.tsx`（トレーナー自身の顧客詳細）は**意図的にプロップを渡さない**
  ——トレーナーは管理のため常にフル表示で見る必要がある。
- `push-period-reminder`（Edge Function）: `profiles` の select に `show_usage_period` を追加し、
  ループ内で `p.show_usage_period === false` なら通知をスキップ。

## 落とし穴
- 新しく「お客様に利用期間・期限を見せる」表示や通知を追加するときは、必ず
  `profiles.show_usage_period` を確認し、`false` のお客様には出さないこと。
  （`profiles.grace_enabled` と同じ「顧客ごとのトレーナー制御フラグ」パターン。
  猶予は `courseProgress.ts`/`planUsage.ts` の計算に効くのに対し、こちらは**表示だけ**を
  制御する点が異なる——計算結果自体は変えない）。
- トレーナー自身の管理画面（`TrainerClientDetail.tsx`・`TrainerDashboard.tsx`の
  「更新が近い顧客」等）はこの設定と無関係に常時フル表示でよい。
