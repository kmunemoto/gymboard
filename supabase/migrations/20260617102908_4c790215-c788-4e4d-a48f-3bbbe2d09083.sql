
-- 6月/7月の棲み分け対応・移行完了後に削除
-- Salute御所南テナント（ceda19b0-d5e0-4928-ab2e-996a0b823af4）のみ、
-- booking_date が 2026年6月（JST）の bookings レコードの
-- INSERT / DELETE をサーバー側で拒否する。
-- 他テナント・7月以降の予約には影響しない。

CREATE OR REPLACE FUNCTION public.guard_salute_june_2026_bookings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_salute_tenant_id constant uuid := 'ceda19b0-d5e0-4928-ab2e-996a0b823af4';
  v_target_tenant uuid;
  v_target_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_target_tenant := OLD.tenant_id;
    v_target_date := (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date;
  ELSE
    v_target_tenant := NEW.tenant_id;
    v_target_date := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date;
  END IF;

  IF v_target_tenant = v_salute_tenant_id
     AND v_target_date BETWEEN DATE '2026-06-01' AND DATE '2026-06-30' THEN
    RAISE EXCEPTION USING
      MESSAGE = '6月のご予約・キャンセルは、これまで通りSaluteアプリで承ります。7月以降のご予約はこちらのアプリをご利用ください。',
      ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS guard_salute_june_2026_bookings_ins ON public.bookings;
CREATE TRIGGER guard_salute_june_2026_bookings_ins
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_salute_june_2026_bookings();

DROP TRIGGER IF EXISTS guard_salute_june_2026_bookings_del ON public.bookings;
CREATE TRIGGER guard_salute_june_2026_bookings_del
  BEFORE DELETE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_salute_june_2026_bookings();
