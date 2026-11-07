-- ============================================================================
-- 当日の後ろへの変更（move_booking_later_today）: 確かめてから消すまでの間に、店の操作を上書きしない（2026-11-07）
-- ============================================================================
-- 20261107010000_same_day_later_reschedule.sql の独立レビュー（反証役）の指摘 L1（低）。
--
-- ■ 何が起きうるか
-- 関数は「予約を読む（SELECT）→ 条件を確かめる → 消す（DELETE）→ 作る（INSERT）」。読むときに行を固めていなかったので、
-- 読んだあと消すまでの間に店がその予約を取り消す（キャンセル済み）・担当やメモを変える、が確定すると、
-- DELETE は新しい版の行をそのまま消し（当日・過去でない・消化扱いでないので見張りの例外も通る）、
-- 古い写しから「予約済み」の行を作り直す ＝ **店の取り消しや変更が黙って元に戻る**。
-- お客様が1人でこれを起こすことはできない（店の操作とミリ秒単位で重なったときだけ）が、直しておく。
--
-- ■ 直し方（どれか1つで足りるが、3つとも入れる）
-- 1. 読むときに行を固める（SELECT … FOR UPDATE）。店の UPDATE はこの関数が終わるまで待つ。2回押しも並ぶ
--    （2回目は消えた行を読むので GB013）。お客様は自分の予約の UPDATE のポリシーを持つので INVOKER のままで固められる
-- 2. 消すときも「予約済み・同じ日時」を条件にする。合わなければ 0 行 → GB013（作り直さない）
-- 3. 当日削除の見張りの例外も「予約済み」の行に限る（印があっても、店が取り消した行は消せない）
--
-- 🔴 どちらの関数も、本番の pg_get_functiondef（2026-11-07 時点）から機械的に写して、上の箇所だけ変えた:
--    enforce_booking_same_day_delete … md5 57fcf24f6e314630886faafd2986846f（20261107010000 の版）
--    move_booking_later_today        … md5 594ab543d6718774e287e708a572ba60（20261107010000 の版）
--
-- 見張り: src/test/sameDayLaterMove.test.tsx
-- ============================================================================

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
  -- 印はその関数の中でだけ、その予約の ID で立つ（トランザクションの中だけ有効）。予約済みの行に限る（店が取り消した行は通さない）
  IF OLD.status = '予約済み'
     AND COALESCE(current_setting('app.same_day_later_move', true), '') = OLD.id::text THEN
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

  -- 自分の予約だけ（RLS でも他の人の予約は見えないが、本人であることをここでも確かめる）。
  -- 🔴 行を固める（FOR UPDATE）: 確かめてから消すまでの間に、店の取り消し・変更が割り込んで上書きされないように（2026-11-07）
  SELECT * INTO v_old FROM public.bookings b WHERE b.id = p_booking_id FOR UPDATE;
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

  -- 元の予約を消す。当日削除の見張りは、この予約のこの削除だけ通す。
  -- 消すときも「予約済み・確かめたときと同じ日時」に限る（合わなければ 0 行 → 作り直さずに止める）
  PERFORM set_config('app.same_day_later_move', v_old.id::text, true);
  DELETE FROM public.bookings
   WHERE id = v_old.id AND status = '予約済み' AND booking_date = v_old.booking_date;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM set_config('app.same_day_later_move', '', true);
  IF v_deleted <> 1 THEN
    -- 同時に2回押された・店が取り消した等で、もう同じ予約ではない
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

-- 権限は CREATE OR REPLACE で変わらないが、ここでも同じ形に揃えておく
REVOKE ALL ON FUNCTION public.move_booking_later_today(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_booking_later_today(uuid, timestamptz) TO authenticated;
