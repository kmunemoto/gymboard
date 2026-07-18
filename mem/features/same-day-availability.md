# 当日の空き状況の閲覧（予約は不可のまま）

## 概要（2026-07〜、全テナント）
お客様は**当日(JST)の予約は取れない**（前日までに予約する運用）。ただしオーナー要望で、
**当日の空き状況だけは閲覧できる**ようにした。`src/components/customer/CustomerBooking.tsx`。

## 仕組み（ここを崩さない）
予約可否の締切判定 `isBookingDayClosed(date)`（`Date.now() >= その日の0:00 JST`）は
「当日＋過去」を予約不可にする。以前はこれをカレンダーの選択可否にもそのまま使っていたため、
**当日はタップすらできなかった**。これを次のように分離した:

- `isPastDay(date)` = `date < getJSTToday()` … カレンダーで**選択不可にするのは過去日だけ**。
- `isViewOnlyDay(date)` = `date === getJSTToday()` … 当日は選択可能（閲覧のみ）。
- 予約可否そのものは**従来どおり** `generateSlots` の `tooSoon = isBookingDayClosed(dateKey)`
  が当日を `available:false` にしてブロックする（＝予約は取れない）。

つまり「カレンダーの `disabled` は `isPastDay` に緩める」「枠の予約可否は `isBookingDayClosed`
のまま」の二本立て。**この2つを再び1つに戻すと当日が見えなくなる**ので注意。

## 表示
- 当日は枠グリッドの上に案内バナー（`booking.sameDayViewOnlyNotice`）＋ジムの
  `tenant.phone` / `tenant.email`（あれば `tel:` / `mailto:` リンク）を表示。
  文言は「当日のご予約はジムへ直接お問い合わせください」。
- 枠は押せない閲覧専用。`viewOnlyOpen = slot.tooSoon && !slot.blocked` で
  「空き」（`booking.slotOpen`・淡いアクセント色）と「満枠」（`booking.slotFull`）を区別。
- 当日は枠が全て `available:false` なので `selectedSlot` は立たず、予約確定ボタンは出ない。

## 落とし穴
- 当日は `tooSoon=true` のため**キャンセル待ち(waitlist)対象外**（`waitlistable` は `!tooSoon` 条件）。
  当日は予約できない以上キャンセル待ちも無意味なので意図どおり。
- i18n キーは `booking.*` 名前空間に `slotOpen` / `sameDayViewOnlyNotice` を5言語追加済み。
