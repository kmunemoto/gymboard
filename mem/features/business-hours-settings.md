# 営業時間・予約枠の間隔・予約バッファ（tenants.operating_hours / slot_duration_minutes / booking_buffer_minutes）

## 概要（2026-07〜）
`tenants.operating_hours`（`{start, end}` の jsonb）・`tenants.slot_duration_minutes`・
`tenants.booking_buffer_minutes` は、これまで**オンボーディング（`Onboarding.tsx`）で最初に
1回設定されるだけ**で、以降に変更する画面が無かった。ジム設定「営業時間」セクション
（`TrainerGymSettings.tsx` の `handleSaveBusinessHours`）で以降いつでも変更できるようにした。
- 開始/終了時刻: **30分刻み**（開始7:00〜12:00、終了17:00〜23:00）。`Onboarding.tsx` の
  初期設定ピッカーも同じ範囲・刻みに揃えてある（`hourOption` ヘルパーで生成、2ファイルに重複定義
  だが小さい配列なので許容）。
- 予約枠の間隔（＝1セッションの長さ・`slot_duration_minutes`）: 30/45/60/90/120分。
- **予約バッファ（`booking_buffer_minutes`、2026-07-21追加）**: 予約と予約の間に必ず空ける時間。
  0/15/30/45/60分。既定15分＝旧来ずっとハードコードされていた値と完全互換。
- 保存時に「終了 > 開始」だけ簡易バリデーション。

## `booking_buffer_minutes` を実際に使う場所（重複防止の全経路を洗い出し済み）
旧来「60分セッション+15分バッファ=75分」がハードコードされていた箇所は多数あり、
2026-07-21 のマイグレーション（`20260721000000_add_booking_buffer_minutes.sql`）で
**全箇所をテナントごとに設定可能な `booking_buffer_minutes` に統一**した:

- **`check_booking_overlap` トリガー（DB・最終防衛）**: `NEW.tenant_id` の
  `booking_buffer_minutes` を引き、`footprint := make_interval(mins => 60 + buffer)` で
  占有時間を計算。`bookings`/`trial_bookings`/`blocked_slots` 全てここで重複判定される。
  **実際の二重予約を防ぐのはこのトリガーのみ**（フロント側の `isSlotBlocked`/`checkSlotBlocked`
  は全て事前チェックのUXに過ぎず、最終的にはこのトリガーが是非を決める）。
- **`get_tenant_booked_slots` RPC**: `end_booking_date` を `p_tenant_id` のバッファで計算。
  `CustomerBooking.tsx`・`TrialBooking.tsx` の両方がこのRPCを使う（埋まり枠の返り値をそのまま
  占有終了時刻として使うため、ここが不正確だと両画面とも連動して不正確になる）。
- **`get_tenant_public` RPC**: `booking_buffer_minutes` を追加で返す。`TrialBooking.tsx`
  （公開・無認証）が候補枠自身の占有時間（60分+バッファ）を計算するのに必要。
- **`CustomerBooking.tsx` の `isSlotBlocked`**: `tenant?.booking_buffer_minutes ?? 15`。
- **`TrialBooking.tsx` の `isSlotBlocked`**: `tenant?.booking_buffer_minutes ?? 15`。
- **`useBookings.ts` の `checkSlotBlocked`**: 第5引数 `bufferMinutes`（既定15、後方互換）。
  呼び出し元（`TrainerSchedule.tsx` の代理予約・ブロック作成、計4箇所）が
  `tenant?.booking_buffer_minutes ?? 15` を渡す。
- **`calendar-feed` Edge Function**（個人のiCal購読リンク）: 予約ごとに `bookings.tenant_id`
  （`profiles.tenant_id` はマルチテナント以前の名残で信頼できないため使わない）からそのジムの
  バッファを引き、DTENDを `60+buffer` 分で計算。

## `slot_duration_minutes`（1セッションの長さ設定）も占有時間に反映済み（2026-07-21）
以前は `slot_duration_minutes` をジム設定で変更しても、**実際の重複判定は常にセッション長を
固定60分として計算していた**（「1セッションの長さ」は `CustomerBooking.tsx` の `generateSlots`
が最終枠の締切位置を計算するのにしか使われず、予約同士の間隔には無関係だった）。
`20260721010000_use_slot_duration_in_occupancy.sql` で、`booking_buffer_minutes` と同じ
全箇所を `session_min := slot_duration_minutes`（既定60）にも対応させ、
`footprint = session_min + buffer_min` で統一した:

- **`check_booking_overlap` トリガー**: `NEW.tenant_id` の `slot_duration_minutes` /
  `booking_buffer_minutes` 両方を引いて `footprint` を計算（最終防衛）。
- **`get_tenant_booked_slots` RPC**: 同様に `footprint` で `end_booking_date` を計算。
- **`get_tenant_public` RPC**: `slot_duration_minutes` も追加で返す（`booking_buffer_minutes`
  に加えて）。`TrialBooking.tsx`（公開・無認証）が候補枠自身の占有時間を計算するのに必要。
- **フロント**: `CustomerBooking.tsx`／`TrialBooking.tsx`／`TrainerSchedule.tsx`（4箇所の
  `checkSlotBlocked` 呼び出し＋代理予約の終了時刻計算）／`TrainerClientDetail.tsx`（予約履歴の
  終了時刻）／`useBookings.ts`（`parseBooking`・`checkSlotBlocked`・
  `sendCancelEmailNotification`）の全てが `tenant?.slot_duration_minutes ?? 60` を参照。
- **Edge Functions**: `calendar-feed`（iCal DTEND）／`trial-book`（確認メールの時刻表記）／
  `trial-cancel`（キャンセルページ・メールの時刻表記）／`google-calendar-sync`
  （Googleカレンダーイベントの終了時刻、`create` と `sync_all` 両方）が
  `tenants.slot_duration_minutes` を都度取得して使用。
- `bookings`/`trial_bookings` には終了時刻を保存する列が無く、常に表示・計算時点で
  `開始 + slot_duration_minutes` として再計算される。そのため過去の予約も、設定変更後は
  新しいセッション長で表示・計算される（バッファの挙動と同じで、履歴データの不整合は生じない）。

## 落とし穴
- 新しく「予約の占有時間・重複」に関わる機能を書くときは、`slot_duration_minutes` と
  `booking_buffer_minutes` の両方を必ず参照すること（ハードコードで `60`/`75`/`+60` を
  書かないこと）。DBトリガーが最終防衛なので、フロント側の事前チェックが多少ズレても実害
  （二重予約）にはならないが、UXとしては不正確になる。
- 既存テナントは全て `slot_duration_minutes = 60`（既定値）のため、このマイグレーション単体で
  挙動が変わることはない。60以外に設定して初めて占有時間が変わる。
