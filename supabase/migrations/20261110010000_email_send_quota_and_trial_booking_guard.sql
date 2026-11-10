-- ============================================================================
-- メールの回数の上限を「店が消せない記録」で数える・体験予約の宛先や日時を画面から書き換えさせない（2026-11-10）
-- ============================================================================
-- 宗本さん「全部直すで」（2026-11-10 の定期セキュリティ点検の19件）。
-- 点検の指摘: trial-book-2・trial-book-cap-1・send-trial-reminders-1・resend-email-1・invite-email-relay-1・trial-book-1
--
-- ■ 何が起きていたか
-- 1. 体験予約・ドロップインの確認メールの上限（同じ宛先は全部のジムで24時間5件・1つのジムで1時間20件・24時間60件）を、
--    trial_bookings の行で数えていた。ジムのオーナーは自分のジムの行を消せる・作成日時（created_at）や宛先を
--    書き換えられるので、数え直させて同じ人へ何通でも送れた。宛先も文字のまま比べていたので、大文字や +1 を
--    足すだけで別の宛先として数えられた（確認メールは配信停止しても止まらない MUST_DELIVER）。
-- 2. オーナーが自分のジムの体験予約の宛先・お名前・日時を API で書き換えられたので、毎晩の前日リマインド
--    （send-trial-reminders）を好きなアドレスへの中継に使えた（予約を作る時の上限を素通り）。
-- 3. 送信履歴の「再送」（resend-email）には回数の上限が無かった。
-- 4. 予約メニューの担当（booking_menus.staff_user_id）に、そのジムのスタッフでない人の id を書けた
--    （体験予約の店宛てメールが、その人のログイン用アドレスへ送られ、送信履歴で読めた。trial-book-1）。
--
-- ■ 直し方
-- 1. email_send_quota（このマイグレーション）: Edge Function（service_role）だけが書ける「送った記録」。
--    宛先はアドレスそのものではなく、そろえた形（小文字・+タグなし・Gmail は点なし）の SHA-256 で持つ。
--    ジムへの外部キーは付けない（ジムを消しても記録は残る。8日で自分から消える）。
--    reserve_email_send が「数える→積む」を、宛先・ジムごとの勧告ロックで1本ずつ行う（同時の呼び出しですり抜けない）。
-- 2. guard_trial_booking_update: 画面から（current_user が authenticated / anon）の体験予約の UPDATE で、
--    宛先・お名前・日時・ジム・種類・メニュー・担当・作成日時・取り消しの鍵・質問の回答・カレンダーの予定を変えさせない。
--    状態（status）は「キャンセル済み」にすることだけ。今のアプリ・古いアプリが書くのは follow_up_status・
--    followed_up_at・source・declined_reason・trial_fee_status・follow_up_note と status=キャンセル済み だけなので、
--    どちらも動きは変わらない。trial-book・trial-cancel・google-calendar-sync（service_role）は対象外。
-- 3. guard_booking_menu_staff: 画面からメニューの担当を変えるときは、そのジムの在籍中のオーナー・インストラクターだけ
--    （本番の3件はすべて満たす）。担当を変えない編集では見ない（担当がジムを抜けた古いメニューも名前は直せる）。
-- 🔴 門番の関数は SECURITY INVOKER（current_user で「画面から」を見分ける。DEFINER にすると素通り）。
--
-- 見張り: src/test/emailSendQuota.test.ts
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 送った記録（service_role だけ）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_send_quota (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('guest_confirm', 'resend', 'unclaimed_user')),
  recipient_key text NOT NULL CHECK (recipient_key ~ '^[0-9a-f]{64}$'),
  tenant_id uuid,
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_send_quota IS
  'メールの回数の上限を数えるための送った記録（2026-11-10）。service_role だけが読み書きする。宛先はそろえた形の SHA-256。店が消せないように、ジムへの外部キーは付けない。8日より前の行は reserve_email_send が消す。';

CREATE INDEX IF NOT EXISTS email_send_quota_recipient_idx ON public.email_send_quota (kind, recipient_key, created_at);
CREATE INDEX IF NOT EXISTS email_send_quota_tenant_idx ON public.email_send_quota (kind, tenant_id, created_at);
CREATE INDEX IF NOT EXISTS email_send_quota_source_idx ON public.email_send_quota (kind, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_send_quota_created_idx ON public.email_send_quota (created_at);

ALTER TABLE public.email_send_quota ENABLE ROW LEVEL SECURITY;
-- ポリシーは作らない（anon・authenticated からは1行も見えない・書けない）
REVOKE ALL ON public.email_send_quota FROM PUBLIC;
REVOKE ALL ON public.email_send_quota FROM anon;
REVOKE ALL ON public.email_send_quota FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.email_send_quota TO service_role;

-- 数えて、上限の内なら1行積む。返り値: {"ok": true, "id": …} か {"ok": false, "reason": "recipient" | "tenant_hour" | "tenant_day" | "source"}
-- 上限の引数が NULL のものは数えない。
CREATE OR REPLACE FUNCTION public.reserve_email_send(
  p_kind text,
  p_recipient_key text,
  p_tenant_id uuid,
  p_source_ref text,
  p_max_recipient_24h integer,
  p_max_tenant_1h integer,
  p_max_tenant_24h integer,
  p_max_source integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_n integer;
BEGIN
  IF p_kind IS NULL OR p_recipient_key IS NULL THEN
    RAISE EXCEPTION 'kind and recipient are required' USING ERRCODE = '22023';
  END IF;

  -- 同じ宛先・同じジムへの同時の呼び出しを1本ずつにする（「数える→積む」の間に割り込ませない）。
  -- 取る順番はいつも「宛先 → ジム」なので、互いに待ち合って止まることはない
  PERFORM pg_advisory_xact_lock(hashtextextended('email_send_quota:r:' || p_kind || ':' || p_recipient_key, 0));
  IF p_tenant_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('email_send_quota:t:' || p_kind || ':' || p_tenant_id::text, 0));
  END IF;

  -- 8日より前の記録はもう数えないので消す（宛先の印を長く持たない）
  DELETE FROM public.email_send_quota WHERE created_at < now() - interval '8 days';

  IF p_max_recipient_24h IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.email_send_quota
     WHERE kind = p_kind AND recipient_key = p_recipient_key AND created_at > now() - interval '24 hours';
    IF v_n >= p_max_recipient_24h THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'recipient');
    END IF;
  END IF;

  IF p_tenant_id IS NOT NULL AND p_max_tenant_1h IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.email_send_quota
     WHERE kind = p_kind AND tenant_id = p_tenant_id AND created_at > now() - interval '1 hour';
    IF v_n >= p_max_tenant_1h THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'tenant_hour');
    END IF;
  END IF;

  IF p_tenant_id IS NOT NULL AND p_max_tenant_24h IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.email_send_quota
     WHERE kind = p_kind AND tenant_id = p_tenant_id AND created_at > now() - interval '24 hours';
    IF v_n >= p_max_tenant_24h THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'tenant_day');
    END IF;
  END IF;

  IF p_source_ref IS NOT NULL AND p_max_source IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.email_send_quota
     WHERE kind = p_kind AND source_ref = p_source_ref;
    IF v_n >= p_max_source THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'source');
    END IF;
  END IF;

  INSERT INTO public.email_send_quota (kind, recipient_key, tenant_id, source_ref)
  VALUES (p_kind, p_recipient_key, p_tenant_id, p_source_ref)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_email_send(text, text, uuid, text, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_email_send(text, text, uuid, text, integer, integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_email_send(text, text, uuid, text, integer, integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_email_send(text, text, uuid, text, integer, integer, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. 体験予約の宛先・日時などを画面から書き換えさせない
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_trial_booking_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.guest_name IS DISTINCT FROM OLD.guest_name
     OR NEW.guest_contact IS DISTINCT FROM OLD.guest_contact
     OR NEW.booking_date IS DISTINCT FROM OLD.booking_date
     OR NEW.booking_kind IS DISTINCT FROM OLD.booking_kind
     OR NEW.booking_type IS DISTINCT FROM OLD.booking_type
     OR NEW.menu_id IS DISTINCT FROM OLD.menu_id
     OR NEW.staff_user_id IS DISTINCT FROM OLD.staff_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.cancel_token IS DISTINCT FROM OLD.cancel_token
     OR NEW.custom_answers IS DISTINCT FROM OLD.custom_answers
     OR NEW.google_event_id IS DISTINCT FROM OLD.google_event_id THEN
    RAISE EXCEPTION '体験予約のお名前・連絡先・日時などは、この画面からは変えられません' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM 'キャンセル済み' THEN
    RAISE EXCEPTION '体験予約は取り消し（キャンセル済み）にだけ変えられます' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_trial_booking_update ON public.trial_bookings;
CREATE TRIGGER trg_guard_trial_booking_update
  BEFORE UPDATE ON public.trial_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_trial_booking_update();

-- ---------------------------------------------------------------------------
-- 3. メニューの担当は、そのジムの在籍中のオーナー・インストラクターだけ
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_booking_menu_staff()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.staff_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.staff_user_id IS NOT DISTINCT FROM OLD.staff_user_id
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;
  IF NOT public.has_tenant_role(NEW.tenant_id, NEW.staff_user_id, ARRAY['owner', 'trainer']) THEN
    RAISE EXCEPTION 'メニューの担当は、このジムのスタッフから選んでください' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_booking_menu_staff ON public.booking_menus;
CREATE TRIGGER trg_guard_booking_menu_staff
  BEFORE INSERT OR UPDATE ON public.booking_menus
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_menu_staff();
