-- 消化(同日キャンセル済み)の「事後帳消し」経路を塞ぐ（#133/20260713143813 の続き）。
--
-- 残っていた回避経路（顧客が API 直叩きで消化・消化数を巻き戻す方法）:
--   1. 翌日以降に消化行の status を「予約済み」へ UPDATE で戻す
--      （既存の enforce_booking_update_guard は「キャンセル済み」への遷移しか
--        塞いでおらず、「予約済み」へ戻すのは通っていた）
--      → その行は過去日の「予約済み」になり、下記 2 で削除できてしまう。
--   2. 過去日(JST)になった自分の予約行を物理 DELETE する
--      （既存の削除ガードは「当日 + 消化ONテナント」と「消化ステータス行」のみ対象。
--        過去日の「予約済み」行は昔から誰でも消せた＝消化済みセッションを事後に
--        削除して回数カウント(courseProgress/planUsage)を回復できる。これは
--        消化機能以前からある穴で、回数制プランの全テナントに関わる）
--
-- 対策:
--   (a) 顧客は過去日(JST)の予約行を物理 DELETE できない（ステータス不問・全テナント）。
--       正規フローに過去予約を削除する導線は存在しない（お客様のキャンセル/変更UIは
--       未来の予約のみ表示 = CustomerBooking.tsx の activeBookings）。
--   (b) 顧客は「同日キャンセル済み」からの status 変更を、予約日当日(JST)しか行えない。
--       正規の巻き戻し（当日変更の消化リスケが新枠作成に失敗した際の復元
--       = useBookings.ts rescheduleBooking の forfeitOld ロールバック）は消化の数秒後
--       ＝必ず予約日当日に走るため壊れない。翌日以降の“こっそり復元”だけが塞がる。
--   トレーナー(スタッフ)とサービスロール(auth.uid() IS NULL)は従来どおり対象外。

-- ============================================================================
-- (a) 過去日(JST)の予約は顧客削除不可 + 既存ガード（消化行・当日消化ON）を維持
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_booking_same_day_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_penalty boolean;
BEGIN
  -- サービスロール/管理/マイグレーション(認証ユーザー無し)は対象外
  IF auth.uid() IS NULL THEN
    RETURN OLD;
  END IF;
  -- トレーナー(スタッフ)は対象外（運用上のクリーンアップを妨げない）
  IF public.has_role(auth.uid(), 'trainer'::public.app_role) THEN
    RETURN OLD;
  END IF;
  -- 消化(同日キャンセル済み)の履歴行は、日付を問わず顧客の物理削除を禁止（既存）
  IF OLD.status = '同日キャンセル済み' THEN
    RAISE EXCEPTION '消化扱いの予約は削除できません。'
      USING ERRCODE = 'check_violation';
  END IF;
  -- 過去日(JST)の予約は顧客削除不可（消化数の事後改ざん防止・全テナント）
  IF (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date
       < (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RAISE EXCEPTION '過去の予約は削除できません。'
      USING ERRCODE = 'check_violation';
  END IF;
  -- 未来日は通常どおり削除可（お客様の通常キャンセル）
  IF (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date
       <> (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RETURN OLD;
  END IF;
  -- 当日: このテナントが同日キャンセル消化ONなら物理削除を禁止（既存）
  SELECT t.same_day_cancel_penalty_enabled INTO v_penalty
  FROM public.tenants t WHERE t.id = OLD.tenant_id;
  IF COALESCE(v_penalty, false) THEN
    RAISE EXCEPTION '当日の予約は消化扱いとなるため、この方法では削除できません。アプリの操作をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

-- ============================================================================
-- (b) 消化行の status 変更は予約日当日(JST)のみ + 既存のキャンセル済み遷移禁止を維持
-- ============================================================================
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
  -- 顧客が 'キャンセル済み'(消化除外扱い) へ遷移させるのを禁止（既存）
  IF NEW.status = 'キャンセル済み' AND OLD.status IS DISTINCT FROM 'キャンセル済み' THEN
    RAISE EXCEPTION 'この操作は許可されていません。アプリのキャンセル/変更機能をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;
  -- 消化(同日キャンセル済み)からの遷移は予約日当日(JST)のみ許可。
  -- 正規のロールバック（リスケ失敗時の復元）は消化直後＝当日中に走る。
  -- 翌日以降に「予約済み」へ戻して過去日DELETEにつなげる帳消しを塞ぐ。
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
