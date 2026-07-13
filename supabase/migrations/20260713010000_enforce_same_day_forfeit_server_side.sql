-- 同日キャンセル消化(#116/#132)の「サーバー側強制」。
-- これまで消化の判定・警告はすべてクライアント(JS)側だったため、API直叩き・端末の
-- 時計偽装・古いPWAキャッシュで以下の回避が可能だった。DB側で一括して塞ぐ。
--
--   回避経路（顧客が当日予約の消化を免れる方法）:
--     1. 当日予約を物理 DELETE する（消化されない）
--     2. booking_date を直接 UPDATE して別日へ移す（消化されず・重複防止トリガーは
--        INSERT 限定のため二重予約も可能）
--     3. status を 'キャンセル済み' に直接 UPDATE してソフトキャンセルする（消化除外）
--
-- 正規フローは全て「status を消化(同日キャンセル済み)に UPDATE」または「物理 DELETE」
-- または「新規 INSERT」で構成され、booking_date を UPDATE する経路も
-- status を 'キャンセル済み' にする経路も存在しない（確認済み）。よって下記で正規フローは壊れない。
-- トレーナー(スタッフ)とサービスロール(エッジ関数/管理)は対象外。

-- ============================================================================
-- 対策(2): 顧客・匿名から booking_date の UPDATE 権限を剥奪する。
--   これで「日時の直接書き換え」も「UPDATE 経由の二重予約」も列レベルで不可能になる。
--   status 更新(消化/復元)は列が別なので引き続き可能。サービスロールは対象外。
-- ============================================================================
REVOKE UPDATE (booking_date) ON public.bookings FROM authenticated, anon;

-- ============================================================================
-- 対策(1): 当日(JST)予約の物理削除を、消化ONテナントでは顧客に禁止する。
--   → 当日キャンセルは「消化(status更新)」経路しか使えなくなる。
--   当日判定はサーバー時刻(now())で行うため端末の時計偽装は無効。
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
  -- トレーナー(スタッフ)は対象外（トレーナー起因のキャンセルは消化選択制のため）
  IF public.has_role(auth.uid(), 'trainer'::public.app_role) THEN
    RETURN OLD;
  END IF;
  -- 当日(JST)以外は通常どおり削除可
  IF (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date
       <> (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RETURN OLD;
  END IF;
  -- このテナントが同日キャンセル消化ONなら、当日予約の物理削除を禁止
  SELECT t.same_day_cancel_penalty_enabled INTO v_penalty
  FROM public.tenants t WHERE t.id = OLD.tenant_id;
  IF COALESCE(v_penalty, false) THEN
    RAISE EXCEPTION '当日の予約は消化扱いとなるため、この方法では削除できません。アプリの操作をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS enforce_booking_same_day_delete ON public.bookings;
CREATE TRIGGER enforce_booking_same_day_delete
  BEFORE DELETE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_same_day_delete();

-- ============================================================================
-- 対策(3): 顧客が status を 'キャンセル済み'(消化除外) に直接変える経路を禁止する。
--   正規のキャンセルは物理DELETEか消化(同日キャンセル済み)のみで、顧客が
--   'キャンセル済み' を書き込む正規経路は存在しない。ソフトキャンセルでの消化回避を塞ぐ。
--   トレーナー/サービスロールは対象外（既存・将来の運用を壊さない）。
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
  -- 顧客が 'キャンセル済み'(消化除外扱い) へ遷移させるのを禁止
  IF NEW.status = 'キャンセル済み' AND OLD.status IS DISTINCT FROM 'キャンセル済み' THEN
    RAISE EXCEPTION 'この操作は許可されていません。アプリのキャンセル/変更機能をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_booking_update_guard ON public.bookings;
CREATE TRIGGER enforce_booking_update_guard
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_update_guard();
