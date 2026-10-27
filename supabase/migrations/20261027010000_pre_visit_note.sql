-- ============================================================================
-- 「ご来店前のお願い」を、お客様の予約完了画面などに出せるようにする（2026-10-27）
--
-- 宗本さん:
--   「お客様にトレーニング前の１～２時間前にエネルギーになるものを摂取してお越しください
--    という意味の文章を伝えたい。そういうのを設定できる仕組みを考えて、作って」
-- 出す場所は「アプリ内だけ」と確認済み（通知・メールには入れない）。
--
-- `pre_visit_note` に文を入れたジムだけ、予約完了の画面・ホームの「次回の予約」・
-- 体験予約の完了画面に「ご来店前のお願い」として出す（src/lib/preVisitNote.ts）。
-- 文は店が自由に書く（食事に限らない。「タオルをお持ちください」なども入る）。
-- **NULL（既定）は今まで通り**＝設定していないジムの見え方は変わらない。
--
-- ⚠️ 特定のジムの値はここには書かない（リポジトリは public。値の設定は本番で直接行う）。
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS pre_visit_note text;

-- 長さは src/lib/preVisitNote.ts の PRE_VISIT_NOTE_MAX と同じ（テストが一致を見張る）
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_pre_visit_note_length;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_pre_visit_note_length
  CHECK (pre_visit_note IS NULL OR char_length(pre_visit_note) <= 300);

COMMENT ON COLUMN public.tenants.pre_visit_note IS
  'お客様に伝える「ご来店前のお願い」（例: トレーニングの1〜2時間前に軽く食べてからお越しください）。予約完了画面・ホームの次回の予約・体験予約の完了画面に出す。NULL は出さない';

-- ── 公開ページ（体験予約）へ届ける ─────────────────────────────────────────
-- 体験予約ページはログイン不要なので tenants を直接読めない。
-- 返り値の型を変えるので DROP → CREATE → GRANT の3点セット（20261010010000 と同じ）。
-- ⚠️ DROP すると GRANT も消える。必ず貼り直すこと（忘れると体験予約ページが全店で開けない）。
-- 列の並びは本番の定義（2026-10-27 の pg_get_functiondef）の末尾に pre_visit_note を足しただけ。
DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);

CREATE OR REPLACE FUNCTION public.get_tenant_public(p_id uuid)
 RETURNS TABLE(
   id uuid, gym_name text, gym_name_short text, address text, logo_url text,
   primary_color text, trial_info_title text, trial_info_body text,
   booking_buffer_minutes integer, slot_duration_minutes integer,
   booking_capacity integer, booking_cutoff_type text, booking_cutoff_hours integer,
   trial_price_yen integer, operating_hours jsonb, booking_window_days integer,
   trial_ignores_blocked_slots boolean, public_theme_color text,
   arrival_lead_minutes integer, pre_visit_note text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body, t.booking_buffer_minutes, t.slot_duration_minutes,
         t.booking_capacity, t.booking_cutoff_type, t.booking_cutoff_hours,
         t.trial_price_yen, t.operating_hours, t.booking_window_days,
         t.trial_ignores_blocked_slots, t.public_theme_color, t.arrival_lead_minutes,
         t.pre_visit_note
  FROM public.tenants t
  WHERE t.id = p_id AND t.status IN ('active', 'trial')
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated, service_role;
