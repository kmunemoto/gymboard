# 営業時間・予約枠の間隔（tenants.operating_hours / slot_duration_minutes）

## 概要（2026-07〜）
`tenants.operating_hours`（`{start, end}` の jsonb）と `tenants.slot_duration_minutes` は、
これまで**オンボーディング（`Onboarding.tsx`）で最初に1回設定されるだけ**で、以降に変更する
画面が無かった（`TrainerGymSettings.tsx` に編集UIが無かった）。ジム設定「営業時間」セクション
（`handleSaveBusinessHours`）で以降いつでも変更できるようにした。開始/終了時刻・枠間隔の
選択肢はオンボーディングと同じ範囲（開始7:00〜12:00、終了17:00〜23:00、間隔30/45/60/90/120分）。
保存時に「終了 > 開始」だけ簡易バリデーション。

## `operating_hours`/`slot_duration_minutes` を実際に参照しているのは `CustomerBooking.tsx` だけ
このジム設定変更が効くのは**会員の予約画面（`CustomerBooking.tsx`）のみ**。それ以外の
「時間の範囲」を扱う箇所は、調査の結果すべて**独自に決め打ち**しており、この設定を見ていない:
- **`TrialBooking.tsx`（公開の体験予約ページ）**: `generateSlots` が `600〜1260分`
  （10:00〜21:00固定）で枠を作る。テナントの `operating_hours` を一切参照しない。
- **`TrainerSchedule.tsx`（トレーナーの予約表グリッド）**: `timeSlots` が `600〜1335分`
  （10:00〜22:15固定）でグリッドの時間軸を作る。同様に参照しない。

つまり、ジムが営業時間を変更しても、**体験予約ページとトレーナーの予約表グリッドの表示範囲は
変わらない**（体験予約は「営業時間外の時間帯まで予約枠として提示してしまう」可能性がある一方、
トレーナーグリッドは単に「実際の営業時間より広い範囲が空欄で表示される」程度で実害は小さい）。
これは今回の実装スコープ外として意図的に残した（体験予約ページは無認証の公開・売上に直結する
経路のため、決め打ちを変える場合は影響を見極めて別途対応する）。

## 落とし穴
- 営業時間を変更する新機能や表示を作るときは、`CustomerBooking.tsx` 以外は
  `tenant.operating_hours`/`tenant.slot_duration_minutes` を見ていないことを忘れないこと。
  特に `TrialBooking.tsx` を将来テナント設定に追従させる場合は、公開・無認証の予約作成経路
  である点に注意して慎重に進める。
