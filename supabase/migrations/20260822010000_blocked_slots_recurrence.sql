-- くり返しブロック（2026-08-22）
--
-- 「毎週月曜の 13:00〜15:00 を毎回ブロックしたい」を1回の操作で入れられるようにする。
-- 実店舗の要望:「決まった曜日の決まった時間帯を毎週ブロックしたい。1回ずつ入れるのは面倒」。
--
-- 方式は**定期予約（createRecurringBookings）と同じ「毎週×N週ぶんの実体行」**。
-- 🔴 恒久ルールの表（booking_blocked_windows のような weekday×時刻の定義）には
--    **しない**。ブロックの判定はクライアント側（checkSlotBlocked が blocked_slots の
--    実体行を読む）と get_tenant_booked_slots 等の RPC に散っており、ルール表を
--    足すと**公開済みの旧クライアントがその帯を「空き」と誤表示して予約を通してしまう**
--    （DB 側にブロックの重なりを拒否するトリガーは無い）。実体行なら旧クライアントも
--    今までどおり読むので、互換性の問題がゼロ。
--
-- recurrence_group は「同じ操作でまとめて作った行」の印。解除ダイアログの
-- 「この日以降まとめて解除」がこの列で行を特定する。単発ブロックでは NULL のまま
-- （クライアントは繰り返しのときだけこの列を積む。未適用のDBに常に積むと
--  PGRST204 で単発ブロックまで作れなくなるため。mem/ops/schema-drift.md）。

ALTER TABLE public.blocked_slots
  ADD COLUMN IF NOT EXISTS recurrence_group UUID;

CREATE INDEX IF NOT EXISTS idx_blocked_slots_recurrence
  ON public.blocked_slots(recurrence_group)
  WHERE recurrence_group IS NOT NULL;
