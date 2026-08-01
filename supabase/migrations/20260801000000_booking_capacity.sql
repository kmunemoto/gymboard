-- 予約の「同時に受けられる数」（キャパシティ）を店ごとに設定できるようにする。
--
-- 背景: これまで重複防止は「テナント内で時間が重なる予約が1件でもあれば拒否」だった。
-- つまり **1テナント＝同時に1予約** が暗黙の前提で、ベッド2台・施術者2名・打席3つ
-- といった「同時に複数受けられる」店は表現できなかった。
-- パーソナルジム（1対1）では正しい前提だったが、ストレッチ・鍼灸・エステなど
-- 複数ベッドが普通の業種に展開できない原因になっていた。
--
-- 設計:
--   tenants.booking_capacity（既定1）＝ 同じ時間帯に受けられる予約の数。
--   重なっている予約の **件数** を数え、capacity 以上なら拒否する。
--   既定1なら「1件でも重なれば拒否」＝**従来と完全に同一の挙動**（既存店に影響なし）。
--
--   ブロック枠（blocked_slots）は capacity に関係なく**店全体を塞ぐ**。
--   休憩・私用・臨時休業に使うものなので、「ベッド1台分だけ休憩」という概念は持たない。
--   （将来ベッド単位で埋めたくなったら blocked_slots 側に対象を持たせる別の工事になる）
--
--   体験予約（trial_bookings）も1件として数える。実際にベッドと人を専有するため。

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS booking_capacity integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.tenants.booking_capacity IS
  '同じ時間帯に受けられる予約の数（ベッド数・施術者数など）。既定1＝従来どおり同時1件のみ。ブロック枠はこの数に関係なく店全体を塞ぐ。';

-- 念のため 1 未満を禁止する（0 にすると全予約が入らなくなり、原因が分かりにくい）
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_booking_capacity_positive;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_booking_capacity_positive CHECK (booking_capacity >= 1);

-- 重複防止トリガー: 「1件でもあれば拒否」→「重なり件数 >= capacity なら拒否」。
-- ブロック枠だけは件数に関係なく即拒否する。
-- プランごとの占有時間（tenant_plans.slot_duration_minutes）の解決は
-- 20260730120000_tenant_plans_slot_duration.sql から変更なし。
CREATE OR REPLACE FUNCTION public.check_booking_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_start timestamptz;
  new_end timestamptz;
  overlap_count integer;
  blocked_count integer;
  buffer_min integer;
  tenant_session_min integer;
  capacity_limit integer;
  new_session_min integer;
  new_footprint interval;
BEGIN
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes, t.booking_capacity
    INTO buffer_min, tenant_session_min, capacity_limit
  FROM public.tenants t WHERE t.id = NEW.tenant_id;
  -- テナントが取れない場合も従来どおり「同時1件」に倒す
  capacity_limit := GREATEST(COALESCE(capacity_limit, 1), 1);

  SELECT tp.slot_duration_minutes INTO new_session_min
  FROM public.tenant_plans tp
  WHERE tp.tenant_id = NEW.tenant_id AND tp.plan_name = NEW.booking_type
  LIMIT 1;
  new_session_min := COALESCE(new_session_min, tenant_session_min, 60);

  new_footprint := make_interval(mins => new_session_min + COALESCE(buffer_min, 15));
  new_start := NEW.booking_date;
  new_end := NEW.booking_date + new_footprint;

  SELECT
    COUNT(*) FILTER (WHERE existing.kind = 'block'),
    COUNT(*) FILTER (WHERE existing.kind = 'booking')
  INTO blocked_count, overlap_count
  FROM (
    SELECT 'booking' AS kind,
           b.booking_date AS start_at,
           b.booking_date + make_interval(mins =>
             COALESCE(tp.slot_duration_minutes, tenant_session_min, 60) + COALESCE(buffer_min, 15)
           ) AS end_at
    FROM public.bookings b
    LEFT JOIN public.tenant_plans tp
      ON tp.tenant_id = b.tenant_id AND tp.plan_name = b.booking_type
    WHERE b.status != 'キャンセル済み'
      AND b.id IS DISTINCT FROM NEW.id
      AND b.tenant_id = NEW.tenant_id
      AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT 'booking' AS kind,
           tb.booking_date AS start_at,
           tb.booking_date + make_interval(mins => COALESCE(tenant_session_min, 60) + COALESCE(buffer_min, 15)) AS end_at
    FROM public.trial_bookings tb
    WHERE tb.status != 'キャンセル済み'
      AND tb.id IS DISTINCT FROM NEW.id
      AND tb.tenant_id = NEW.tenant_id
      AND (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT 'block' AS kind,
           blocked_date AS start_at,
           end_blocked_date AS end_at
    FROM public.blocked_slots
    WHERE tenant_id = NEW.tenant_id
      AND (blocked_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
  ) AS existing
  WHERE new_start < existing.end_at
    AND existing.start_at < new_end;

  -- 文言は据え置き（capacity=1 のとき従来と完全に同じ挙動・同じメッセージになるように）
  IF blocked_count > 0 OR overlap_count >= capacity_limit THEN
    RAISE EXCEPTION 'この時間帯はすでに予約が入っています';
  END IF;

  RETURN NEW;
END;
$function$;

-- 公開ページ（体験予約・ドロップイン）が候補枠の埋まり具合を判定するのに capacity が要る。
-- 未ログインから読めるのは既存どおりこの RPC が返す列だけ。
DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);
CREATE OR REPLACE FUNCTION public.get_tenant_public(p_id uuid)
RETURNS TABLE (
  id uuid, gym_name text, gym_name_short text, address text,
  logo_url text, primary_color text, trial_info_title text, trial_info_body text,
  booking_buffer_minutes integer, slot_duration_minutes integer, booking_capacity integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body, t.booking_buffer_minutes, t.slot_duration_minutes,
         t.booking_capacity
  FROM public.tenants t
  WHERE t.id = p_id AND t.status IN ('active', 'trial')
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated;
