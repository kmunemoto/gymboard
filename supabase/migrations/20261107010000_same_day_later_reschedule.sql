-- ============================================================================
-- 当日の予約を、同じ日の後ろの時間へ、お客様がアプリから変更できるようにする（ジムごと ON/OFF・2026-11-07）
-- ============================================================================
-- 宗本さん（2026-11-07）:
--   「当日予約してるお客様が、当日の後ろ限定で、当日に予約取ってる予約よりも、後ろの時間で
--     日時変更ができる設定を作ってほしい。」
--
-- 同じ日の決まり（同日 宗本さんの決定。src/lib/sameDayReschedule.ts）:
--   当日キャンセル・当日の明日以降への変更 … 1回消化
--   同じ日の中での時間の変更 ………………… 消化しない
--
-- ■ 何が問題だったか
-- アプリの「日時の変更」は「元の予約を消す → 新しい時間で作る」（作るときに満枠・シフト・回数上限などの
-- 見張りを通すため）。ところが当日キャンセルの消化が ON のジムでは、DB（enforce_booking_same_day_delete）が
-- お客様の当日の予約の削除を止めている（消化なしの当日キャンセルの抜け道になるため）。だから同じ日の中の変更は
-- アプリからはできず、お客様に店へ頼んでもらっていた（2026-11-07 #504）。
--
-- ■ 直し方
-- 1. tenants.same_day_later_reschedule_enabled（既定 false＝今まで通り）。特定のジムの値はここに書かない（公開リポジトリ）。
-- 2. move_booking_later_today(予約, 新しい日時): 当日の予約を、同じ日の後ろの時間へ動かす。
--    「消す → 作る」を**1回のトランザクションの中で**行う。作るほうが満枠などで断られたら、消したほうも元に戻る。
--    動かせるのは、ジムの設定が ON・自分の予約・予約済み・当日（JST）・まだ始まっていない・
--    同じ日のもっと後ろの時刻、のときだけ（どれかが違えば GB013）。
--    🔴 SECURITY INVOKER（お客様の権限のまま動く）。RLS と予約の見張り（満枠・シフト・回数上限・1日の上限・
--       所属の確認…）は、アプリの日時の変更とまったく同じにかかる。広げたのは下の 3. の1か所だけ。
-- 3. enforce_booking_same_day_delete（当日削除の見張り）に、2. が消す**その予約のその削除だけ**を通す印を足す。
--    印はトランザクションの中だけ有効な設定（app.same_day_later_move = 予約の ID）。2. が消す直前に立てて直後に下ろす。
--    お客様はこの印を立てられない: PostgREST から呼べるのは public の関数だけで、pg_catalog.set_config は呼べない
--    （オーナーの引き継ぎの app.owner_transfer と同じ形。20260813010000_owner_transfer_and_tenant_delete.sql）。
--    消化扱い・過去の予約を消せないのは、印があっても今まで通り（印を見るのはその2つを見たあと）。
--
-- 消化にならない理由: 予約は同じ日の後ろに残る。動かしたあとで当日キャンセルすれば、今まで通り1回消化。
--
-- 見張り: src/test/sameDayLaterMove.test.ts
-- ============================================================================

-- 1. ジムの設定
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS same_day_later_reschedule_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.same_day_later_reschedule_enabled IS
  '当日の予約を、同じ日の後ろの時間へ、お客様がアプリから変更できるか（消化しない）。既定 false';

-- 3. 当日削除の見張り。
--    🔴 定義は本番の pg_get_functiondef（2026-11-07 時点・md5 ea965bee670bb0d338cbd44c993870dd）から機械的に写し、
--       「当日の後ろへの変更が消すときだけ通す」の IF を1つ、消化の設定を読む直前に足しただけ。
--       古い migration から書き直すと、その間に入った変更が黙って消える。
CREATE OR REPLACE FUNCTION public.enforce_booking_same_day_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_penalty boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN OLD;
  END IF;

  IF public.has_tenant_role(OLD.tenant_id, auth.uid(), ARRAY['owner', 'trainer']) THEN
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

  -- 当日の予約を同じ日の後ろへ動かす関数（move_booking_later_today）が消すときだけ通す（2026-11-07）。
  -- 印はその関数の中でだけ、その予約の ID で立つ（トランザクションの中だけ有効）。
  IF COALESCE(current_setting('app.same_day_later_move', true), '') = OLD.id::text THEN
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
$function$;

-- 2. 当日の予約を、同じ日の後ろの時間へ動かす
CREATE OR REPLACE FUNCTION public.move_booking_later_today(p_booking_id uuid, p_new_booking_date timestamptz)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_today   date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_old     public.bookings%ROWTYPE;
  v_enabled boolean;
  v_deleted integer;
  v_new_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = '42501';
  END IF;

  -- 自分の予約だけ（RLS でも他の人の予約は見えないが、本人であることをここでも確かめる）
  SELECT * INTO v_old FROM public.bookings b WHERE b.id = p_booking_id;
  IF NOT FOUND OR v_old.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION '予約が見つかりません' USING ERRCODE = 'GB013';
  END IF;

  SELECT t.same_day_later_reschedule_enabled INTO v_enabled
    FROM public.tenants t WHERE t.id = v_old.tenant_id;
  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'このジムでは、当日の後ろの時間への変更を受け付けていません' USING ERRCODE = 'GB013';
  END IF;

  -- 予約済みのものだけ。店が営業時間外に入れた予約は店に頼んでもらう（アプリの日時の変更と同じ）
  IF v_old.status IS DISTINCT FROM '予約済み' OR COALESCE(v_old.outside_hours, false) THEN
    RAISE EXCEPTION 'この予約は変更できません' USING ERRCODE = 'GB013';
  END IF;

  IF (v_old.booking_date AT TIME ZONE 'Asia/Tokyo')::date <> v_today THEN
    RAISE EXCEPTION '当日の予約ではありません' USING ERRCODE = 'GB013';
  END IF;

  IF now() >= v_old.booking_date THEN
    RAISE EXCEPTION '開始時刻を過ぎた予約は変更できません' USING ERRCODE = 'GB013';
  END IF;

  IF p_new_booking_date IS NULL
     OR (p_new_booking_date AT TIME ZONE 'Asia/Tokyo')::date <> v_today
     OR p_new_booking_date <= v_old.booking_date THEN
    RAISE EXCEPTION '同じ日の、今の予約より後ろの時間にだけ変更できます' USING ERRCODE = 'GB013';
  END IF;

  -- 元の予約を消す。当日削除の見張りは、この予約のこの削除だけ通す（上の 3.）
  PERFORM set_config('app.same_day_later_move', v_old.id::text, true);
  DELETE FROM public.bookings WHERE id = v_old.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM set_config('app.same_day_later_move', '', true);
  IF v_deleted <> 1 THEN
    -- 同時に2回押された等で、もう消えていた
    RAISE EXCEPTION '予約が見つかりません' USING ERRCODE = 'GB013';
  END IF;

  -- 新しい時間で作る。中身はアプリの日時の変更と同じ（担当・メニュー・オプション・回答・メモを引き継ぐ）。
  -- created_via = 'reschedule' で「新しい予約」の通知は出ない（店には「予約日時の変更」をアプリが送る）。
  -- 満枠・シフト・回数上限・1日の上限などは、この INSERT にかかる見張りがそのまま見る。
  INSERT INTO public.bookings
    (user_id, tenant_id, booking_date, booking_type, source, status, staff_user_id,
     custom_answers, option_minutes, booking_options, menu_id, trainer_note, created_via)
  VALUES
    (v_old.user_id, v_old.tenant_id, p_new_booking_date, v_old.booking_type, 'gymboard', '予約済み', v_old.staff_user_id,
     v_old.custom_answers, COALESCE(v_old.option_minutes, 0), v_old.booking_options, v_old.menu_id, v_old.trainer_note,
     'reschedule')
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

COMMENT ON FUNCTION public.move_booking_later_today(uuid, timestamptz) IS
  '当日の予約を、同じ日の後ろの時間へ動かす（ジムの設定 same_day_later_reschedule_enabled が ON のときだけ・消化しない）。'
  '消す→作るを1回のトランザクションで行う。SECURITY INVOKER（RLS と予約の見張りはアプリの日時の変更と同じ）。';

REVOKE ALL ON FUNCTION public.move_booking_later_today(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_booking_later_today(uuid, timestamptz) TO authenticated;
