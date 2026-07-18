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
- 当日は枠グリッドの上に案内バナー（`booking.sameDayViewOnlyNotice`＝「本日分の空き状況です。
  当日のご予約はジムへ直接お問い合わせください。」）を表示。
- 連絡手段は**電話番号・メールを文字表示せず**、ボタンで案内する（オーナー要望）:
  - 「電話する」（`booking.callGym`）: `tenant.phone` がある時のみ表示。番号は画面に出さず
    `<a href="tel:...">` で発信のみ（`Button asChild`）。番号を見せずに発信できる。
    ※ iOS の `tel:` は発信直前にOS標準の確認画面で番号を表示する（アプリ側では隠せない仕様）。
    番号を一切見せたくないジムは電話番号を空にして、下記の LINE を使う。
  - 「LINEで連絡」（`common.lineContact`）: `tenant.line_url` がある時のみ表示。
    `nativeBridge.openExternalUrl`（Capacitor Browser）でジムのLINEを開く。LINEの無料通話・
    チャットに誘導でき、電話番号は一切出ない。設定は「ジム設定 > LINE連絡先」（`tenants.line_url`）。
  - 「チャットで相談」（`booking.chatWithGym`）: `CustomerBooking` の `onOpenChat` prop
    （`CustomerView` が `setTab("chat")` を渡す）でチャットタブへ切り替える。
- 同じ「電話」「LINE」ボタンはお客様ヘッダー（`CustomerView`）にも設置。いずれも設定が
  ある時だけ表示（`tenant.phone` / `tenant.line_url`）。
- `tenants.line_url` は新カラム（マイグレーション `20260718000000_add_tenant_line_url.sql`）。
  `useTenant` は COL_VARIANTS の先頭に足しつつ、未適用環境では次の変種へフォールバックして
  `line_url=null`（ボタン非表示）で正常動作する。
- 枠は押せない閲覧専用。`viewOnlyOpen = slot.tooSoon && !slot.blocked` で
  「空き」（`booking.slotOpen`・淡いアクセント色）と「満枠」（`booking.slotFull`）を区別。
- 当日は枠が全て `available:false` なので `selectedSlot` は立たず、予約確定ボタンは出ない。

## 埋まり枠の取得は必ずテナント限定（2026-07 修正）
`CustomerBooking.fetchBookedSlots` は**必ず `get_tenant_booked_slots(p_tenant_id, from, to)`** を使う。
旧 `get_booked_slots(check_date)` は **tenant_id フィルタが無く全テナント横断**で埋まり枠を返すため、
他ジムの予約まで占有として数え、混雑日（特に当日）が実際は空きなのに全部「満枠」に見える不具合の
原因になっていた（公開の体験予約ページ `TrialBooking.tsx` は元から `get_tenant_booked_slots` を使用）。
- `tenant?.id` が無い初期は空配列で早期 return（`useCallback` 依存も `[tenant?.id]`）。
- 衝突判定 `isSlotBlocked` は `bEnd = timeToMin(b.endTime)`（**+15しない**）。RPC の `end_booking_date` は
  予約/体験＝`開始+75分`（60分＋バッファ15分込み）、ブロック枠＝実カラム `end_blocked_date`。
  ここに更に+15すると二重計上で余分に満枠化する。`TrialBooking.isSlotBlocked` と同一ロジック。
- トレーナー予約表は RPC ではなく素の SELECT＋RLS でテナント分離されるため元から正しい。

## 落とし穴
- 当日は `tooSoon=true` のため**キャンセル待ち(waitlist)対象外**（`waitlistable` は `!tooSoon` 条件）。
  当日は予約できない以上キャンセル待ちも無意味なので意図どおり。
- i18n キーは `booking.*` 名前空間に `slotOpen` / `sameDayViewOnlyNotice` を5言語追加済み。
