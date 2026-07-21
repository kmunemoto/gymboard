# キャンセル待ち（満枠スロットへの登録）

## 概要
`WAITLIST_ENABLED`（`src/lib/featureFlags.ts`）でON/OFFする、満枠スロットへのキャンセル待ち
登録機能。ONにすると:
- お客様が満枠スロットをタップすると、登録/解除の確認ダイアログが開く。
- 登録するとその枠がキャンセルで空いた際にプッシュ通知が届く
  （`send-push-notification` の `purpose: "waitlist_slot_freed"`。受信者解決・文言生成は
  サーバー側、`booking_waitlist` テーブルから解決）。
- 予約が成立すると自分の該当待機は自動解除される。
- 当日（`tooSoon=true`）は対象外（`waitlistable` は `!tooSoon` 条件。当日は予約自体できない
  のでキャンセル待ちも無意味）。
- 消化扱いキャンセル（同日キャンセルペナルティ）時は「空きました」通知をスキップする
  （`cancelBooking` 内、`opts.forfeit` 時は送らない。来店しない予約なので枠は実質空かない）。

前提: DBマイグレーション `booking_waitlist`（20260624120000）と `send-push-notification` が
デプロイ済みであること（`booking_waitlist` テーブルは types.ts 未反映のため、コード側は
すべて `as any` キャストでアクセスする）。

## 表示方式の変遷（2026-07）
初期実装では、満枠かつキャンセル待ち登録可能なスロットのラベル自体を「キャンセル待ち」
「待機中」に変えて表示していた。しかし満枠が多い時間帯だとグリッドが「キャンセル待ち」
だらけになり見づらいという指摘があり、一時 `WAITLIST_ENABLED = false` にして通常の「満枠」
表示へ戻していた。

2026-07-21、表示方式を直して再度ON にした:
- グリッド上のラベルは常に「満枠」のまま（キャンセル待ち登録可否に関わらず統一）。
- 登録済みのスロットだけ、隅に小さいドット（`bg-warning`）を出す最小限の視覚差分にとどめる。
- タップすると `CustomerBooking.tsx` の `waitlistTarget` state で確認ダイアログ
  （`cancelTarget` 等と同じ、fixed overlay + カード の自前パターン）を開き、
  「登録する/解除する」を選んでから初めて `toggleWaitlist` が実行される
  （旧実装はタップ即トグルだった）。

## 落とし穴
- `booking.waitlistJoin` / `booking.waitlistJoined`（旧: グリッド上のインライン文言）は
  今回の変更で未使用になったが、既存キーはそのまま残している（他機能でも踏襲している
  「孤立キーは残す」方針）。
- `useWaitlist.ts` の `isOnWaitlist` はテナントに関わらず `dateKey + startTime` だけで判定
  するため、複数テナントを跨いでキャンセル待ちに登録することは想定していない（顧客は単一
  テナント専属という前提はこのアプリ全体の設計と同じ）。
