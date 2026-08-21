-- 予約の通知（店宛メール・お客様の受付確認・プッシュ）をサーバー側へ移す（2026-08-21）
--
-- ## なぜ
--
-- 予約の通知は src/lib/bookingNotification.ts（＝**お客様の端末**）が送っていた。
-- 端末は送信前に「自分のジムはどこか」「スタッフは誰か」をネットワーク越しに
-- 引き直し（supabase.auth.getUser() は毎回 /auth/v1/user へ GET・リトライ無し）、
-- どれか1つでも失敗すると **console.warn だけ残して黙って諦める**。
-- 実測: 店宛だけ消えた予約が 8/8・8/15・8/20 の3件、逆にお客様宛だけ消えたのが4件。
-- email_send_log の時刻分析で「invoke がそもそも呼ばれていない」ことを確認済み。
--
-- メッセージ通知で同じ壊れ方を 2026-08-11 に直した前例（notify_new_message →
-- notify-new-message）にそのまま倣う。**bookings の INSERT を起点にすれば、
-- 端末の回線・アプリの版に関係なく必ず届く。**
--
-- ## 落ちても絶対に予約を失わない
--
-- トリガーは EXCEPTION で全部握りつぶして RETURN する。通知の失敗が予約の
-- INSERT / DELETE / UPDATE を巻き添えにすることは無い（notify_new_message と同じ）。
--
-- ## 🔴 通知の中身を pg_net の body に載せない
--
-- 渡すのは booking_id と log_id だけ。Edge Function（notify-new-booking）が
-- service_role で実物を読み直す。実在する行の内容しか通知に載らない。
--
-- ## 旧クライアントとの二重送信
--
-- 公開済みの旧アプリは今までどおり端末からも送る。メールは send-transactional-email
-- 側の冪等キー（booking-notify-<id> / booking-confirm-customer-<id>、この migration で
-- notification_dedupe による排除を追加）で1通に畳まれる。プッシュはタグを旧クライアント
-- と同じ `booking-<id>` にして Web では置き換えに畳む（ネイティブは畳めず、旧アプリの
-- 更新までは二重に鳴りうる。メッセージ通知の移行時と同じ割り切り）。
--
-- ## 前提（vault。メッセージ通知の移行で設定済み・追加作業なし）
--   project_functions_url … https://<自分のref>.supabase.co/functions/v1（末尾スラッシュ無し）
--   cron_secret           … Edge Function 側の CRON_SECRET と同じ文字列
--   🔴 service_role キーは使わない（verifyCaller は環境変数との完全一致で判定するため
--      vault の鍵では 403 になる。20260812040000 で実際に踏んだ）。

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ----------------------------------------------------------------------------
-- 1. 「この予約は通知を出すべきだった」の記録簿
-- ----------------------------------------------------------------------------
-- 予約1件＝1行（event='created'）。dispatched_at が NULL のままなら通知経路の
-- どこかで消えている＝これまで痕跡ゼロだった沈黙故障が SQL 1本で見えるようになる。
-- 削除（removed）・同日キャンセルの消化（forfeited）も採取する（予約変更の判別と
-- 将来キャンセル通知をサーバー側へ移すときの材料。既存データからは復元できない）。
CREATE TABLE public.booking_notify_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL,
  tenant_id UUID,
  -- 🔴 bookings の顧客列は user_id（customer_user_id という列は無い。
  --    間違えると 42703 が EXCEPTION に握りつぶされて1行も記録されない沈黙故障になる）
  user_id UUID NOT NULL,
  -- 誰の操作か。auth.uid()（お客様の自己予約なら user_id と一致、代理予約ならスタッフ、
  -- service_role 経由なら NULL）。自己/代理は bookings の列からは区別できないため、
  -- ここで採る以外に方法が無い。
  actor_user_id UUID,
  event TEXT NOT NULL CHECK (event IN ('created', 'removed', 'forfeited')),
  booking_date TIMESTAMPTZ NOT NULL,
  booking_type TEXT,
  dispatched_at TIMESTAMPTZ,
  skip_reason TEXT,
  http_request_id BIGINT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_notify_log_booking ON public.booking_notify_log(booking_id);
CREATE INDEX idx_booking_notify_log_tenant_created
  ON public.booking_notify_log(tenant_id, created_at DESC);

-- 誰がいつ予約したかの履歴そのもの。クライアントに見せる用途は無いので
-- service_role 以外からは一切触れない（notification_dedupe と同じ形）。
GRANT ALL ON public.booking_notify_log TO service_role;
REVOKE ALL ON public.booking_notify_log FROM PUBLIC, anon, authenticated;
ALTER TABLE public.booking_notify_log ENABLE ROW LEVEL SECURITY;
-- ポリシー無し → anon/authenticated は全拒否。service_role は RLS を通らない。

-- ----------------------------------------------------------------------------
-- 2. 予約変更のマーカー列
-- ----------------------------------------------------------------------------
-- 予約変更（reschedule）は「旧行を削除 → 新行を INSERT」で実装されている。
-- 新行の INSERT に店宛の「新規予約」通知を出すと紛らわしい（店には旧クライアント
-- どおり『予約日時の変更』プッシュが別途届く）ので、新クライアントは変更の内部
-- INSERT に created_via='reschedule' を付け、トリガーは通知を出さず記録だけ残す。
-- 旧クライアントの変更は付けられないため、旧アプリの更新までは変更でも
-- 新規予約メールが届きうる（実害は小さい・過渡期のみ、と割り切った）。
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS created_via TEXT
  CHECK (created_via IS NULL OR created_via IN ('reschedule'));

-- ----------------------------------------------------------------------------
-- 3. INSERT: 記録して notify-new-booking を叩く
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_booking_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_log_id UUID;
  v_skip   TEXT;
  v_base   TEXT;
  v_key    TEXT;
  v_req    BIGINT;
BEGIN
  -- 予約済み以外の INSERT（通常は無い）と、予約変更の内部 INSERT は通知しない
  IF NEW.status IS DISTINCT FROM '予約済み' THEN
    v_skip := 'not_active';
  ELSIF NEW.created_via = 'reschedule' THEN
    v_skip := 'reschedule';
  ELSIF NEW.tenant_id IS NULL THEN
    v_skip := 'no_tenant';
  END IF;

  INSERT INTO public.booking_notify_log
    (booking_id, tenant_id, user_id, actor_user_id, event, booking_date, booking_type, skip_reason)
  VALUES
    (NEW.id, NEW.tenant_id, NEW.user_id, auth.uid(), 'created', NEW.booking_date, NEW.booking_type, v_skip)
  RETURNING id INTO v_log_id;

  IF v_skip IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_base
    FROM vault.decrypted_secrets WHERE name = 'project_functions_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;

  IF v_base IS NULL OR v_key IS NULL THEN
    UPDATE public.booking_notify_log
       SET skip_reason = 'vault_secret_missing' WHERE id = v_log_id;
    RAISE LOG 'notify_booking_created: vault secret missing (project_functions_url / cron_secret). skipped booking %', NEW.id;
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url     := v_base || '/notify-new-booking',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', v_key
               ),
    body    := jsonb_build_object('booking_id', NEW.id, 'log_id', v_log_id)
  ) INTO v_req;

  UPDATE public.booking_notify_log SET http_request_id = v_req WHERE id = v_log_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notify_booking_created failed for booking %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_booking_insert_notify ON public.bookings;
CREATE TRIGGER on_booking_insert_notify
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_booking_created();

COMMENT ON FUNCTION public.notify_booking_created() IS
  '予約の通知（店宛メール・受付確認・プッシュ）を notify-new-booking Edge Function に投げる。'
  '通知の失敗は握りつぶす（予約の INSERT を絶対に妨げない）。'
  'URL と鍵は vault（project_functions_url / cron_secret）から読む。'
  'service_role キーは使わない（verifyCaller は環境変数との完全一致で判定するため）。';

-- ----------------------------------------------------------------------------
-- 4. DELETE / 消化: 記録だけ残す（通知はしない。キャンセル通知は今もクライアント発）
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_booking_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.booking_notify_log
    (booking_id, tenant_id, user_id, actor_user_id, event, booking_date, booking_type)
  VALUES
    (OLD.id, OLD.tenant_id, OLD.user_id, auth.uid(), 'removed', OLD.booking_date, OLD.booking_type);
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'log_booking_removed failed for booking %: %', OLD.id, SQLERRM;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_booking_delete_log ON public.bookings;
CREATE TRIGGER on_booking_delete_log
  AFTER DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.log_booking_removed();

CREATE OR REPLACE FUNCTION public.log_booking_forfeited()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.booking_notify_log
    (booking_id, tenant_id, user_id, actor_user_id, event, booking_date, booking_type)
  VALUES
    (NEW.id, NEW.tenant_id, NEW.user_id, auth.uid(), 'forfeited', NEW.booking_date, NEW.booking_type);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'log_booking_forfeited failed for booking %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_booking_forfeit_log ON public.bookings;
-- '同日キャンセル済み' は src/hooks/useBookings.ts の SAME_DAY_FORFEIT_STATUS と同じ値
-- （sameDayCancelWording.test.ts が両者の一致を見張っている）
CREATE TRIGGER on_booking_forfeit_log
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  WHEN (OLD.status = '予約済み' AND NEW.status = '同日キャンセル済み')
  EXECUTE FUNCTION public.log_booking_forfeited();

REVOKE ALL ON FUNCTION public.notify_booking_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_booking_removed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_booking_forfeited() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. email_send_log の status に 'duplicate' / 'rejected' を足す
-- ----------------------------------------------------------------------------
-- send-transactional-email 側の変更とセット:
--   duplicate … 冪等キーが使用済みで送信をスキップした（旧クライアントとの二重送信の畳み込み）
--   rejected  … 認可・宛先解決などの早期 return（今まで**1行も残さず**消えていた経路。
--               「クライアントが呼ばなかった」と「呼んだが弾かれた」をログで区別できるようにする）
DO $$ BEGIN
  ALTER TABLE public.email_send_log DROP CONSTRAINT IF EXISTS email_send_log_status_check;
  ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_status_check
    CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq', 'duplicate', 'rejected'));
END $$;

-- ----------------------------------------------------------------------------
-- 6. delete_my_gym に booking_notify_log を足す
-- ----------------------------------------------------------------------------
-- ⚠️ この関数は**1回の定義に全テーブルを入れる**こと（20260820030000 の注意書き）。
--    以下は 20260821080000 の定義に booking_notify_log の1行を足したもの
--    （**必ず直前の定義から写す**。20260821080000 で古い版から写して1テーブル
--      落とす事故を実際に踏んだ）。
--    🔴 並び順に意味がある: bookings の DELETE は AFTER DELETE トリガーで
--      booking_notify_log に 'removed' 行を**足す**ので、booking_notify_log の
--      DELETE は bookings より**後**に置かないと行が残る。

CREATE OR REPLACE FUNCTION public.delete_my_gym()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_tenant_id UUID;
  v_others    INT;
  v_owned     INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 🔴 引き継ぎと同じ理由で、複数所有なら選ばずに落とす（消す対象を取り違えない）。
  -- ⚠️ min(uuid) は存在しない（本番検証で踏んだ）。array_agg で1件目を取る。
  SELECT count(*), (array_agg(tenant_id))[1] INTO v_owned, v_tenant_id
    FROM public.tenant_members
   WHERE user_id = v_uid AND role = 'owner' AND status = 'active';

  IF v_owned = 0 THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_owned > 1 THEN
    RAISE EXCEPTION 'ambiguous_tenant:%', v_owned USING ERRCODE = 'check_violation';
  END IF;

  -- 🔴 自分以外の在籍者がいたら閉じさせない。
  --    退会・休会（status が active 以外）は数えない＝「もう誰も使っていない」なら閉じられる。
  SELECT count(*) INTO v_others
    FROM public.tenant_members
   WHERE tenant_id = v_tenant_id
     AND user_id <> v_uid
     AND status = 'active';

  IF v_others > 0 THEN
    RAISE EXCEPTION 'members_remain:%', v_others USING ERRCODE = 'check_violation';
  END IF;

  -- 外側 → 内側の順に落とす
  DELETE FROM public.announcement_reads
   WHERE announcement_id IN (SELECT id FROM public.announcements WHERE tenant_id = v_tenant_id);

  DELETE FROM public.member_agreements   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.message_reactions   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.messages            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.message_templates   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.operator_feedback   WHERE tenant_id = v_tenant_id;

  DELETE FROM public.workouts            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.exercise_id_map     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.exercises           WHERE tenant_id = v_tenant_id;
  DELETE FROM public.tenant_muscle_groups WHERE tenant_id = v_tenant_id;

  DELETE FROM public.booking_waitlist    WHERE tenant_id = v_tenant_id;
  DELETE FROM public.bookings            WHERE tenant_id = v_tenant_id;
  -- 🔴 bookings の後（AFTER DELETE トリガーが 'removed' 行をここに足すため）
  DELETE FROM public.booking_notify_log  WHERE tenant_id = v_tenant_id;
  DELETE FROM public.blocked_slots       WHERE tenant_id = v_tenant_id;
  DELETE FROM public.trial_bookings      WHERE tenant_id = v_tenant_id;
  -- 予約の付随設定。予約行を消した後に消す（参照はしていないが読み順を揃える）。
  DELETE FROM public.booking_questions   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.staff_schedules     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_frequency_limits WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_capacity_windows WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_blocked_windows WHERE tenant_id = v_tenant_id;

  DELETE FROM public.member_payments     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.counseling_responses WHERE tenant_id = v_tenant_id;
  DELETE FROM public.monthly_reports     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.progress_photos     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.user_measurements   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.meals               WHERE tenant_id = v_tenant_id;
  DELETE FROM public.notification_settings WHERE tenant_id = v_tenant_id;
  DELETE FROM public.announcements       WHERE tenant_id = v_tenant_id;
  DELETE FROM public.migration_user_map  WHERE tenant_id = v_tenant_id;
  DELETE FROM public.tenant_plans        WHERE tenant_id = v_tenant_id;

  DELETE FROM public.tenant_members      WHERE tenant_id = v_tenant_id;

  -- 🔴 profiles は**消さない**。ジムを閉じてもアカウントは本人のもの。
  --    所属だけ外す（残すと、消えたジムを指したままになる）。
  UPDATE public.profiles SET tenant_id = NULL WHERE tenant_id = v_tenant_id;

  DELETE FROM public.tenants WHERE id = v_tenant_id;
END;
$$;
