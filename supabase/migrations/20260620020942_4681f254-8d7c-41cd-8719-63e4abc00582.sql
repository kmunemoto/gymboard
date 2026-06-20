ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_source_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_source_check
  CHECK (source IS NULL OR source IN ('gymboard', 'salute_sync'));

CREATE INDEX IF NOT EXISTS bookings_tenant_source_idx
  ON public.bookings (tenant_id, source);

COMMENT ON COLUMN public.bookings.source IS
  '予約の作成元。gymboard=GymBoardアプリ内で作成 / salute_sync=Saluteから同期 / NULL=不明（移行前の既存データ）。逆方向同期では gymboard のみ Salute へ push する。';