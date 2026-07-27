# 定期予約（繰り返し予約）

毎週同じ曜日・時間でまとめて予約する機能。お客様側（`CustomerBooking.tsx`）と
トレーナーの代理予約（`TrainerSchedule.tsx`）の両方にある。

## 仕組み

`useBookings.ts` の `createRecurringBookings()` が開始日から +7日ずつ `createBooking()` を
繰り返す。満枠の週は作成に失敗するが**そこで止めず次の週へ進む**（`skipped` に入れて
トーストで通知）。戻り値は `{ booked, skipped }`。

最大回数は `src/lib/repeatBookingWindow.ts` の `MAX_REPEAT_COUNT = 4`。
ただし予約可能期間（1ヶ月先まで）を超えないよう `maxRepeatWeeksFor(startDate)` で
開始日ごとに上限を絞る。UI と送信直前の両方で呼ぶ二重防御。

## メール（2026-07 に修正）

**予約1件につき1通ずつ送る。** `sendBookingNotifications()`（`src/lib/bookingNotification.ts`）に
**作成できた全件を配列で渡す**。トレーナーへの新規予約通知とお客様への受付確認の2通が、
予約の回数ぶん送られる。

まとめて1通にしない理由は、テンプレート（`booking-confirmation.tsx` /
`new-booking-notification.tsx`）が日時を1つしか持たないため。1通にすると
「どの回の確認なのか」が分からなくなる。

送信はEdge Function側でキューに積まれる（`send-transactional-email` → `process-email-queue`）
ので、4件まとめて投げてもレート制限は dispatcher が吸収する。

### 過去の不具合

- **2回目以降の受付メールが届かなかった。** `sendBookingNotification`（単数）が予約を
  1件しか受け取らず、呼び出し側が `booked[0]` だけを渡していた。予約の作成自体は
  全件成功しているのでUI上は正常に見え、メールだけが落ちていた。
  引数を配列にして全件渡すよう変更。
- **メールの日付が1日ずれうる状態だった。** `date-fns` の `format` をそのまま使っており、
  端末のタイムゾーンで描画されていた。JSTより後ろの地域（海外にいるお客様、
  ドロップインの訪日客など）では前日の日付でメールが届く。`formatJST` に変更。

`src/test/bookingNotification.test.ts` が次を見張る: 件数ぶん送ること、各メールの
日付がその回の日付であること、冪等キーが予約ごとに違うこと（同じだと送信側の
重複排除で2通目以降が捨てられる）、呼び出し側が全件を渡していること。

## プッシュ通知は1回だけ

メールと違い、プッシュは「◯月◯日 ...を予約しました（毎週同時刻×N回の定期予約）」の
1通にまとめている（`CustomerBooking.tsx`）。端末の通知欄が4件で埋まるのを避けるため。

## 関連
- `src/lib/bookingNotification.ts` — メール送信
- `src/lib/repeatBookingWindow.ts` — 回数の上限
- `src/hooks/useBookings.ts` — `createRecurringBookings`
- `src/test/repeatBookingWindow.test.ts` — 上限計算のテスト
