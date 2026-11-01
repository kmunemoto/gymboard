-- ============================================================================
-- お客様が予約の source を偽って満枠などの検査を飛ばせた・自分の予約の日時を API で満枠の時間へ動かせた穴を塞ぐ（2026-11-01）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。点検の拡大
-- bookings-source-1（反証役が「通る」と判断）。
--
-- ■ 何が起きていたか
-- 1. 予約の source に 'salute_sync'（昔の Salute 同期の印）を付けて INSERT すると、check_booking_overlap・
--    guard_booking_day_closed・apply_booking_menu・guard_booking_menu_teacher・guard_booking_restricted_options が
--    冒頭で素通りし、満枠・ブロック枠・休みの日・外したメニュー・限定オプションを無視して予約できた。
--    塞ぐはずのポリシー（20260625100000 の no_client_salute_source_insert）は本番に入っていなかった。
--    🔴 そのファイルは流さないこと（問診の部分も未適用のままで、流すと問診のポリシーが古い形に戻る）。
-- 2. お客様は自分の予約を UPDATE できる（当日の消化のため）が、満枠の検査（check_booking_overlap）は INSERT の
--    ときだけ動く。PATCH で booking_date を満枠の時間へ動かせた（パーソナルの1枠に2人）。担当・メニュー・プラン・
--    オプションも同じ。店が取り消した予約（キャンセル済み）を予約済みに戻すこともできた。
--
-- ■ 直し方
-- 1. bookings の INSERT に RESTRICTIVE のポリシー（anon・authenticated は source='salute_sync' を付けられない）。
--    アプリは source='gymboard' しか送らない。Salute 同期の関数はもう無い（本番の salute_sync の行 454 件は過去の同期分）。
-- 2. enforce_booking_update_guard（本番の pg_get_functiondef から写し、2つの IF を足しただけ）に、お客様（その予約の
--    ジムのスタッフでない人）の UPDATE の制限を足す: 日時・ジム・本人・プラン・source・担当・メニュー・オプションは
--    変えられない。キャンセル済みは戻せない。
--    アプリのお客様の UPDATE は「当日の消化（status）」「その取り消し（status）」「日時の変更で作った新しい行への
--    メモの引き継ぎ（trainer_note）」だけ。日時の変更は「消して作る」（INSERT なので検査を通る）。
--    店（その予約のジムのオーナー・インストラクター）とサービスロールは今までどおり素通し。
--
-- 見張り: src/test/bookingCustomerUpdateGuard.test.ts
-- ============================================================================

DROP POLICY IF EXISTS no_client_salute_source_insert ON public.bookings;
CREATE POLICY no_client_salute_source_insert ON public.bookings AS RESTRICTIVE
  FOR INSERT TO anon, authenticated
  WITH CHECK (source IS DISTINCT FROM 'salute_sync');

CREATE OR REPLACE FUNCTION public.enforce_booking_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.has_tenant_role(OLD.tenant_id, auth.uid(), ARRAY['owner', 'trainer']) THEN
    RETURN NEW;
  END IF;

  -- お客様（その予約のジムのスタッフでない人）は、予約の枠を決める列を変えられない（2026-11-01）。
  -- 🔴 満枠・ブロック枠・休みの日・メニュー・限定オプションの検査は INSERT のときだけ動くものが多い。
  --    アプリの日時の変更は「消して作る」ので、これらを UPDATE で変える正規の操作は無い。
  IF NEW.booking_date IS DISTINCT FROM OLD.booking_date
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.booking_type IS DISTINCT FROM OLD.booking_type
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.staff_user_id IS DISTINCT FROM OLD.staff_user_id
     OR NEW.menu_id IS DISTINCT FROM OLD.menu_id
     OR NEW.option_minutes IS DISTINCT FROM OLD.option_minutes
     OR NEW.booking_options IS DISTINCT FROM OLD.booking_options THEN
    RAISE EXCEPTION 'この操作は許可されていません。アプリのキャンセル/変更機能をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 店が取り消した予約は、お客様からは戻せない（戻すと満枠の検査を通らずに枠を取り直せる）（2026-11-01）
  IF OLD.status = 'キャンセル済み' AND NEW.status IS DISTINCT FROM 'キャンセル済み' THEN
    RAISE EXCEPTION 'この操作は許可されていません。アプリのキャンセル/変更機能をご利用ください。'
      USING ERRCODE = 'check_violation';
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
$function$;
