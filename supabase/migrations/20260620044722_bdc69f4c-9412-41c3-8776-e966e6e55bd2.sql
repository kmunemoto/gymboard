-- Orphan削除: Salute側で削除済みなのにGymBoardに残存している2件を物理削除。
-- 6月予約ガードトリガーをセッション単位で無効化して該当2件のみ削除。
ALTER TABLE public.bookings DISABLE TRIGGER guard_salute_june_2026_bookings_del;

DELETE FROM public.bookings
WHERE tenant_id = 'ceda19b0-d5e0-4928-ab2e-996a0b823af4'
  AND source = 'salute_sync'
  AND id IN (
    'c50b8e7c-c869-4735-b883-a3678fee9649',
    '79638fff-9889-42ab-bfef-25a7ab70da81'
  );

ALTER TABLE public.bookings ENABLE TRIGGER guard_salute_june_2026_bookings_del;