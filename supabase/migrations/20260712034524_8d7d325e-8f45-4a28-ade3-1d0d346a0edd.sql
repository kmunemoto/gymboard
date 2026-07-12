ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS same_day_cancel_penalty_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.same_day_cancel_penalty_enabled IS
  '同日キャンセルを自動で1回消化扱いにするか。既定false=現状維持（ペナルティなし）。ONの場合、cancelBooking の forfeit 経路で bookings.status が「同日キャンセル済み」に更新される（物理削除ではなく残す）。';