CREATE OR REPLACE FUNCTION public.enforce_booking_same_day_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_penalty boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN OLD;
  END IF;

  IF public.has_role(auth.uid(), 'trainer'::public.app_role) THEN
    RETURN OLD;
  END IF;

  IF OLD.status = '同日キャンセル済み' THEN
    RAISE EXCEPTION '消化扱いの予約は削除できません。'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 過去日(JST)の予約は顧客削除不可（消化数の事後改ざん防止）
  IF (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date
       < (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RAISE EXCEPTION '過去の予約は削除できません。'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date
       <> (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RETURN OLD;
  END IF;

  SELECT t.same_day_cancel_penalty_enabled INTO v_penalty
  FROM public.tenants t WHERE t.id = OLD.tenant_id;

  IF COALESCE(v_penalty, false) THEN
    RAISE EXCEPTION '当日の予約は消化扱いとなるため、この方法では削除できません。アプリの操作をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_booking_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'trainer'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'キャンセル済み' AND OLD.status IS DISTINCT FROM 'キャンセル済み' THEN
    RAISE EXCEPTION 'この操作は許可されていません。アプリのキャンセル/変更機能をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 消化(同日キャンセル済み)からの遷移は予約日当日(JST)のみ許可
  IF OLD.status = '同日キャンセル済み'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date
           <> (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RAISE EXCEPTION '消化扱いの予約は変更できません。'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;