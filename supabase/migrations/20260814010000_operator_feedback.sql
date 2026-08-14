-- ============================================================================
-- 運営への要望（operator_feedback）
-- ============================================================================
--
-- 店側（trainer / owner）が、アプリの運営（宗本さん）へ要望を送れるようにする。
-- 設定画面の「運営への要望」欄から INSERT され、
--   1. 行がこのテーブルに残る（正式な記録。消えない）
--   2. AFTER INSERT トリガーが **既存のメールキュー**（transactional_emails →
--      process-email-queue が cron で配送）に積み、運営のメールアドレスへ届く
--
-- ## なぜ新しい Edge Function を作らないか
--
-- Edge Function は push でも Publish でも本番に出ない（CLAUDE.md /
-- mem/ops/edge-function-deploy.md）。Lovable のエージェントに依頼して、
-- 叩いて確かめて…という工程が丸ごと要る。メール送信の基盤
-- （pgmq + process-email-queue）は既に本番で動いているので、そこに積むだけにする。
-- **DB マイグレーションだけで完結する＝デプロイの罠が無い。**
--
-- ## 宛先について
--
-- 運営の問い合わせ先は `src/lib/brand.ts` の SUPPORT_EMAIL（公開情報。
-- 利用規約・プライバシーポリシーにも載る）。DB からは brand.ts を読めないので
-- ここに直書きするが、**src/test/operatorFeedback.test.ts が両者の一致を見張る**。
-- 兄弟アプリはフォーク時にここと brand.ts を自アプリの値に揃えること。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.operator_feedback (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL,
  body       TEXT        NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operator_feedback_user
  ON public.operator_feedback (user_id, created_at DESC);

COMMENT ON TABLE public.operator_feedback IS
  '店側から運営（開発元）への要望。行が正式な記録。INSERT 時にトリガーが既存のメールキュー経由で運営へ通知する。';

ALTER TABLE public.operator_feedback ENABLE ROW LEVEL SECURITY;

-- テナント境界（RESTRICTIVE）。他のポリシーが緩んでも、他店の要望には触れない。
DROP POLICY IF EXISTS tenant_isolation ON public.operator_feedback;
CREATE POLICY tenant_isolation ON public.operator_feedback AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 店側だけが送れる。user_id の成りすましは WITH CHECK で止める。
DROP POLICY IF EXISTS operator_feedback_insert ON public.operator_feedback;
CREATE POLICY operator_feedback_insert ON public.operator_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.has_role(auth.uid(), 'trainer'::app_role)
  );

-- 読めるのは自分が送った分だけ（送信履歴の表示用）。
-- 同じ店の他のスタッフの要望も見せない（人間関係の話が書かれることがある）。
DROP POLICY IF EXISTS operator_feedback_select ON public.operator_feedback;
CREATE POLICY operator_feedback_select ON public.operator_feedback
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 送った要望は書き換えも取り消しもできない（運営に届いた内容と食い違わせない）。
-- UPDATE/DELETE のポリシーを作らないだけでなく、GRANT ごと剥がす
-- （messages で受信者が本文を書き換えられた事故の教訓。2026-08-12）。
REVOKE UPDATE, DELETE ON public.operator_feedback FROM authenticated, anon;
REVOKE ALL ON public.operator_feedback FROM anon;

-- ============================================================================
-- メール通知トリガー
-- ============================================================================
--
-- 🔴 enqueue_email は service_role にしか EXECUTE が無い（20260805000000 で
-- anon/authenticated から剥がした）。この関数は SECURITY DEFINER（owner = postgres）
-- なので呼べる。**この設計を崩して authenticated に enqueue_email を GRANT
-- し直さないこと**（任意の宛先へ任意の本文を正規ドメインから送れてしまう）。

CREATE OR REPLACE FUNCTION public.notify_operator_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- src/lib/brand.ts の SUPPORT_EMAIL と一致させること（テストが見張る）
  v_to     CONSTANT TEXT := 'k.munemoto@kyoto-salute.com';
  -- supabase/functions/send-transactional-email/index.ts の SENDER_DOMAIN と同じ
  v_domain CONSTANT TEXT := 'notify.kyoto-salute.com';
  v_gym       TEXT;
  v_sender    TEXT;
  v_recent    INT;
  v_body_html TEXT;
  v_unsub     TEXT;
  v_msg_id    TEXT := gen_random_uuid()::text;
BEGIN
  -- メールは通知にすぎない。**ここで何が起きても要望の保存は成功させる。**
  -- （キューが無い環境・ポリシー変更などで INSERT ごと落とすと、
  --   お客様側から見て「要望が送れない」になり本末転倒）
  BEGIN
    -- 同じ人から1時間に5件を超えたらメールだけ抑制する（行は残る）。
    -- 運営の受信箱を守るための上限で、店側の正常な使い方では届かない数。
    SELECT count(*) INTO v_recent
      FROM public.operator_feedback
     WHERE user_id = NEW.user_id
       AND created_at > now() - interval '1 hour';
    IF v_recent > 5 THEN
      RETURN NEW;
    END IF;

    SELECT gym_name INTO v_gym FROM public.tenants WHERE id = NEW.tenant_id;
    SELECT display_name INTO v_sender FROM public.profiles WHERE user_id = NEW.user_id;

    -- 本文は利用者の自由入力。HTML に流すので必ずエスケープする。
    v_body_html := replace(replace(replace(NEW.body,
                     '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    v_body_html := replace(v_body_html, E'\n', '<br>');

    -- 🔴 unsubscribe_token は transactional に**必須**。無いと送信APIが
    --    400 missing_unsubscribe を返す（本番検証で実際に踏んだ。
    --    キューには載るのに配送だけ落ち続け、最後は DLQ 行き＝静かに届かない）。
    --    send-transactional-email と同じく宛先ごとに1つを使い回す。
    --
    -- ⚠️ gen_random_bytes は使わない。pgcrypto は extensions スキーマにあり、
    --    この関数の search_path = public からは**見えない**（これも本番検証で踏んだ。
    --    例外ガードが握るので、行は残るのにメールだけ静かに消える）。
    --    gen_random_uuid() は組み込みなのでスキーマに依存しない。2つ繋いで
    --    64桁hex（send-transactional-email のトークンと同じ形式）にする。
    SELECT token INTO v_unsub
      FROM public.email_unsubscribe_tokens WHERE email = lower(v_to);
    IF v_unsub IS NULL THEN
      INSERT INTO public.email_unsubscribe_tokens (token, email)
      VALUES (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
              lower(v_to))
      ON CONFLICT (email) DO NOTHING;
      -- 並行して先に作られていたら既存が残るので、確定値を読み直す
      SELECT token INTO v_unsub
        FROM public.email_unsubscribe_tokens WHERE email = lower(v_to);
    END IF;

    PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
      'message_id',      v_msg_id,
      'idempotency_key', v_msg_id,
      'to',              v_to,
      'from',            coalesce(v_gym, '運営への要望') || ' <noreply@' || v_domain || '>',
      'sender_domain',   v_domain,
      'subject',         '【要望】' || coalesce(v_gym, '(店舗名なし)')
                           || ' / ' || coalesce(v_sender, '(名前未設定)'),
      'html',            '<p><b>店舗:</b> ' || coalesce(v_gym, '-')
                           || '<br><b>送信者:</b> ' || coalesce(v_sender, '-')
                           || '</p><hr><p>' || v_body_html || '</p>',
      'text',            '店舗: ' || coalesce(v_gym, '-')
                           || E'\n送信者: ' || coalesce(v_sender, '-')
                           || E'\n\n' || NEW.body,
      'purpose',         'transactional',
      'label',           'operator-feedback',
      'unsubscribe_token', v_unsub,
      'queued_at',       now()
    ));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'operator_feedback: メール通知に失敗（行は保存済み）: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- SECURITY DEFINER なのでクライアントから直接呼べないようにしておく
-- （RETURNS TRIGGER は直接呼べないが、権限も剥がす。二重の守り）。
REVOKE ALL ON FUNCTION public.notify_operator_feedback() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_operator_feedback ON public.operator_feedback;
CREATE TRIGGER trg_notify_operator_feedback
  AFTER INSERT ON public.operator_feedback
  FOR EACH ROW EXECUTE FUNCTION public.notify_operator_feedback();

-- ============================================================================
-- delete_my_gym にこのテーブルを組み込む
-- ============================================================================
--
-- テナント配下のテーブルを増やしたら delete_my_gym にも足す
-- （src/test/gymOwnership.test.ts の「取りこぼしていない」が実際にこの追加を要求した）。
-- FK は ON DELETE CASCADE だが、この関数は**明示 DELETE で完結させる**方針。
-- CASCADE 頼みの行を混ぜると「どこまでが明示か」を毎回考えることになる。
--
-- 中身は 20260813010000 の定義 ＋ operator_feedback の1行。

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
  DELETE FROM public.blocked_slots       WHERE tenant_id = v_tenant_id;
  DELETE FROM public.trial_bookings      WHERE tenant_id = v_tenant_id;

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

-- CREATE OR REPLACE は既存の GRANT を保持する（20260813010000 で
-- authenticated に EXECUTE 済み）。ここで付け直しはしない。
