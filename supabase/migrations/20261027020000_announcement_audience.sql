-- ============================================================================
-- お知らせの配信対象を「全員から除く」「個別（複数）」にできるようにする（2026-10-27）
--
-- 宗本さん「この文章の対象を1人だけ除いて送れる様にとかもできるようにして、
-- その辺考えて実装して」（「空きが出ました」のお知らせを、空けた本人には送らない、など）。
--
-- 決めたこと（既定の判断）:
--   - announcements.target は今まで通り text。値を2つ足す
--       'all'       … 全員（今まで通り）
--       'except'    … 全員から、announcement_audience の人を除く
--       'only'      … announcement_audience の人だけ（複数可）
--       '<user_id>' … 1人だけ（今までの「個別」。古いアプリが書く。読むのも今まで通り）
--   - 選んだ人は announcement_audience に1行ずつ持つ。**店のスタッフだけ**が読み書きする
--     （お客様に「誰が除かれたか」「ほかに誰に送ったか」を見せない）
--
-- ## 🔴 出し分けは表の読み取り権限（RLS）でやる
--
-- お客様のお知らせ一覧・未読の数は announcements を直接読んでいる（画面側で絞っていない）。
-- 権限で絞れば、**古いアプリのお客様にも**除いた人には出ない。
--
-- ## 🔴 保存は save_announcement（1つのトランザクション）で
--
-- お知らせの行と「選んだ人」を別々に書くと、その間に
--   - 配信の定期実行（push-announcements）が「除く人がまだ居ない」状態を拾って全員に送る
--   - お客様の画面が「除く人がまだ居ない」状態を読む
-- が起きうる。行と選んだ人を同じトランザクションで書く関数を用意し、画面はそれだけを使う。
-- SECURITY INVOKER（呼んだ人の権限のまま）なので、書けるかどうかは今までの RLS が決める。
--
-- ⚠️ 特定のジムの値はここには書かない（リポジトリは public）。
-- ============================================================================

-- ── (1) 選んだ人 ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcement_audience (
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

COMMENT ON TABLE public.announcement_audience IS
  'お知らせの配信対象で選んだお客様。announcements.target が except なら除く人、only なら送る人。店のスタッフだけが読み書きする';

CREATE INDEX IF NOT EXISTS announcement_audience_user
  ON public.announcement_audience(user_id);

ALTER TABLE public.announcement_audience ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.announcement_audience FROM anon;
GRANT SELECT, INSERT, DELETE ON public.announcement_audience TO authenticated;

DROP POLICY IF EXISTS tenant_isolation ON public.announcement_audience;
CREATE POLICY tenant_isolation ON public.announcement_audience AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS announcement_audience_select ON public.announcement_audience;
CREATE POLICY announcement_audience_select ON public.announcement_audience
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 入れるとき: そのジムのスタッフで、お知らせも同じジムのもの、相手もそのジムの在籍者
DROP POLICY IF EXISTS announcement_audience_insert ON public.announcement_audience;
CREATE POLICY announcement_audience_insert ON public.announcement_audience
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])
    AND EXISTS (
      SELECT 1 FROM public.announcements a
       WHERE a.id = announcement_audience.announcement_id
         AND a.tenant_id = announcement_audience.tenant_id
    )
    AND public.is_tenant_member(tenant_id, user_id)
  );

DROP POLICY IF EXISTS announcement_audience_delete ON public.announcement_audience;
CREATE POLICY announcement_audience_delete ON public.announcement_audience
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- ── (2) その人が選ばれているか ───────────────────────────────────────────
-- 読み取り権限の中から使う。お客様は announcement_audience を読めないので SECURITY DEFINER。
CREATE OR REPLACE FUNCTION public.announcement_audience_has(p_announcement_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.announcement_audience x
     WHERE x.announcement_id = p_announcement_id AND x.user_id = p_user_id
  );
$fn$;
REVOKE ALL ON FUNCTION public.announcement_audience_has(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_audience_has(uuid, uuid) TO authenticated;

-- ── (3) 読み取り権限: 除いた人には出さない／個別は選んだ人にだけ ───────────────────
-- 今までの3つ（トレーナーは全部・全員向け・1人向け）はそのまま残す。
DROP POLICY IF EXISTS "Users view own/all announcements" ON public.announcements;
CREATE POLICY "Users view own/all announcements" ON public.announcements
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'trainer'::app_role)
    OR (
      published_at <= now()
      AND (
        target = 'all'
        OR target = (auth.uid())::text
        OR (target = 'except' AND NOT public.announcement_audience_has(id, auth.uid()))
        OR (target = 'only' AND public.announcement_audience_has(id, auth.uid()))
      )
    )
  );

-- ── (4) 保存: お知らせの行と選んだ人を1つのトランザクションで書く ─────────────────
-- p_id が NULL なら新規、あれば更新。返り値はお知らせの id。
-- 選んだ人は「前と後の差」だけ書く（更新で全消し→全入れはしない）。
CREATE OR REPLACE FUNCTION public.save_announcement(
  p_title        text,
  p_body         text,
  p_icon         text,
  p_target       text,
  p_published_at timestamptz,
  p_user_ids     uuid[] DEFAULT '{}',
  p_id           uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id     uuid;
  v_tenant uuid;
  v_ids    uuid[];
BEGIN
  IF p_target IS NULL OR p_target NOT IN ('all', 'except', 'only') THEN
    RAISE EXCEPTION 'invalid_target:%', p_target USING ERRCODE = '22023';
  END IF;

  v_ids := CASE WHEN p_target = 'all' THEN '{}'::uuid[]
                ELSE ARRAY(SELECT DISTINCT u FROM unnest(coalesce(p_user_ids, '{}'::uuid[])) u WHERE u IS NOT NULL)
           END;
  IF p_target <> 'all' AND cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'audience_required:%', p_target USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.announcements (title, body, icon, target, published_at, created_by, tenant_id)
    VALUES (p_title, p_body, coalesce(p_icon, 'Bell'), p_target, coalesce(p_published_at, now()),
            auth.uid(), public.get_my_tenant_id())
    RETURNING id, tenant_id INTO v_id, v_tenant;
  ELSE
    UPDATE public.announcements
       SET title = p_title, body = p_body, icon = coalesce(p_icon, 'Bell'),
           target = p_target, published_at = coalesce(p_published_at, published_at)
     WHERE id = p_id
    RETURNING id, tenant_id INTO v_id, v_tenant;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'announcement_not_found' USING ERRCODE = 'P0002';
    END IF;
    DELETE FROM public.announcement_audience
     WHERE announcement_id = v_id AND NOT (user_id = ANY (v_ids));
  END IF;

  INSERT INTO public.announcement_audience (announcement_id, user_id, tenant_id)
  SELECT v_id, u, v_tenant FROM unnest(v_ids) u
  ON CONFLICT (announcement_id, user_id) DO NOTHING;

  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.save_announcement(text, text, text, text, timestamptz, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_announcement(text, text, text, text, timestamptz, uuid[], uuid) TO authenticated;
