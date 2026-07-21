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

## `slot_duration_minutes`（1セッションの長さ設定）は実は占有時間に反映されていない（既知の制約）
`slot_duration_minutes` はジム設定で変更できるが、**実際の重複判定（上記すべて）は
セッション長を常に固定60分として計算する**（`60 + booking_buffer_minutes`）。つまり
「1セッションの長さ」設定は `CustomerBooking.tsx` の `generateSlots` が最終枠の締切位置
（`lastStart = closeHour*60 - slotMinutes`）を計算するのにしか使われておらず、**予約同士が
実際にどれだけ間隔を空けるかには影響しない**。60分以外の値を設定しても、占有時間は変わらない。
今回はユーザーの依頼が「予約バッファの設定」のみだったため、この制約はスコープ外として据え置いた
（セッション長を真に可変にするには、上記の全箇所を `slot_duration_minutes` 基準に変える必要が
あり、影響範囲が広いため別途要検討）。

## 落とし穴
- 新しく「予約の占有時間・重複」に関わる機能を書くときは、`booking_buffer_minutes` を
  必ず参照すること（ハードコードで `75`/`+15` を書かないこと）。DBトリガーが最終防衛なので、
  フロント側の事前チェックが多少ズレても実害（二重予約）にはならないが、UXとしては不正確になる。
- `slot_duration_minutes`（セッション長設定）を将来「本当に占有時間へ反映させる」場合は、
  上記の全箇所（トリガー・2 RPC・3フロントファイル・calendar-feed）を同時に直す必要がある。
