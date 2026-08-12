-- ジム側の定型文（2026-08-11）
--
-- 「本日もお疲れさまでした」「次回のご予約はいかがですか」を毎回手で打っている。
-- 離脱アラートの「声かけ」から飛んできたときも、結局その場で文章を考えることになる。
-- テナントごとに数件登録して、チャットの入力欄の上からワンタップで入れられるようにする。
--
-- ## 差し込み
-- 本文に `{{name}}` と書くと、送る相手の表示名に置き換わる。
-- 名前が取れないときは**丸ごと消える**（「様、こんにちは」ではなく「こんにちは」になる）。
-- 置換はクライアント側（`src/lib/messageTemplate.ts`）。DB は素の文字列だけを持つ。
--
-- ## 見えるのはジム側だけ
-- お客様に見せるものではないので SELECT も trainer に限る。
-- 「テナント内なら誰でも読める」にすると、お客様のアプリから
-- ジムの営業文言の一覧が読めることになる。

CREATE TABLE IF NOT EXISTS public.message_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  -- チップに出る短い名前。本文そのものではない（長いと入力欄の上が埋まる）
  title      text NOT NULL,
  body       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_templates_title_len') THEN
    ALTER TABLE public.message_templates ADD CONSTRAINT message_templates_title_len
      CHECK (btrim(title) <> '' AND char_length(title) <= 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_templates_body_len') THEN
    ALTER TABLE public.message_templates ADD CONSTRAINT message_templates_body_len
      CHECK (btrim(body) <> '' AND char_length(body) <= 1000);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS message_templates_tenant_order_idx
  ON public.message_templates (tenant_id, sort_order, created_at);

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.message_templates;
CREATE POLICY tenant_isolation ON public.message_templates AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 🔴 読み書きとも trainer だけ。お客様には見せない。
DROP POLICY IF EXISTS message_templates_select ON public.message_templates;
CREATE POLICY message_templates_select ON public.message_templates
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role));

DROP POLICY IF EXISTS message_templates_insert ON public.message_templates;
CREATE POLICY message_templates_insert ON public.message_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'trainer'::app_role));

DROP POLICY IF EXISTS message_templates_update ON public.message_templates;
CREATE POLICY message_templates_update ON public.message_templates
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'trainer'::app_role));

DROP POLICY IF EXISTS message_templates_delete ON public.message_templates;
CREATE POLICY message_templates_delete ON public.message_templates
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role));

COMMENT ON TABLE public.message_templates IS
  'ジム側がチャットで使う定型文。テナント単位。本文の {{name}} は送信先の表示名に置き換わる。';
