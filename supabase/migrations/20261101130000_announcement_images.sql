-- ============================================================================
-- お知らせに画像を付けられるようにする（2026-11-01）
-- ============================================================================
-- 宗本さん「お知らせで画像を送れる様にして」。
--
-- ■ 置き場（非公開。チャットの添付 message-attachments と同じ考え方）
-- バケット announcement-images: 非公開・1枚5MBまで・JPEG / PNG / WebP。パスは <tenant_id>/<uuid>.<ext>。
-- - 読める: そのジムのスタッフ（オーナー・インストラクター）と、**その画像が付いたお知らせを見られる人**だけ。
--   「見られる」は announcements の読み取り権限（RLS）をそのまま使う＝「個別」「全員から除く」で外れた人・他のジムの人・
--   予約公開の前のお客様には見えない。
-- - 上げる・消す: お知らせを作れる人（オーナー。インストラクターはお知らせを作れないので上げられない）だけ。
-- 公開のバケットにしない理由: URL を知っていれば誰でも見られる（お客様の写真を載せることもありうる）。
-- 画面は署名つきの URL（1時間）で表示する。
--
-- ■ お知らせの行
-- - image_paths text[]（4枚まで・そのジムのフォルダの、決まった形のパスだけ。_announcement_image_paths_ok）。
-- - save_announcement に p_image_paths を足す。**NULL なら画像は変えない**（古いアプリから保存しても画像が消えない）。
--   空の配列なら画像を外す。関数は今まで通り SECURITY INVOKER（書けるかどうかは announcements の権限で決まる）。
-- - 以前からある image_url / image_url2 は使わない: 画面が URL をそのまま <img> に入れるので、外のサイトの画像を入れると
--   見た人の IP アドレスがそのサイトに渡る。本番で値の入った行は0件（2026-11-01）なので、NULL だけにする。
--
-- 古いアプリ: 画像は出ない（題名・本文は今まで通り）。次のビルドから出る。Web は Publish で出る。
-- 見張り: src/test/announcementImages.test.ts
-- ============================================================================

-- ---- お知らせの行 ----
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS image_paths text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.announcements.image_paths IS
  'announcement-images バケット内のパス（<tenant_id>/<uuid>.<ext>・4枚まで）。表示は署名つきの URL。2026-11-01';

CREATE OR REPLACE FUNCTION public._announcement_image_paths_ok(p_paths text[], p_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_paths IS NULL OR cardinality(p_paths) = 0 THEN true
    WHEN p_tenant IS NULL OR cardinality(p_paths) > 4 THEN false
    ELSE (
      SELECT bool_and(
        p IS NOT NULL
        AND p ~ ('^' || p_tenant::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
      )
      FROM unnest(p_paths) AS p
    )
  END
$function$;

ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_image_paths_shape;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_image_paths_shape
  CHECK (public._announcement_image_paths_ok(image_paths, tenant_id)) NOT VALID;
ALTER TABLE public.announcements VALIDATE CONSTRAINT announcements_image_paths_shape;

ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_legacy_image_urls_unused;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_legacy_image_urls_unused
  CHECK (image_url IS NULL AND image_url2 IS NULL) NOT VALID;
ALTER TABLE public.announcements VALIDATE CONSTRAINT announcements_legacy_image_urls_unused;

-- ---- 保存（行と選んだ人と画像を1つのトランザクションで書く） ----
-- 引数を足すので作り直す（同じ名前の関数が2つあると、古いアプリの呼び出しがどちらか決められずに落ちる）
DROP FUNCTION IF EXISTS public.save_announcement(text, text, text, text, timestamp with time zone, uuid[], uuid);

CREATE FUNCTION public.save_announcement(
  p_title text,
  p_body text,
  p_icon text,
  p_target text,
  p_published_at timestamp with time zone,
  p_user_ids uuid[] DEFAULT '{}'::uuid[],
  p_id uuid DEFAULT NULL::uuid,
  p_image_paths text[] DEFAULT NULL::text[]
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
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
    INSERT INTO public.announcements (title, body, icon, target, published_at, created_by, tenant_id, image_paths)
    VALUES (p_title, p_body, coalesce(p_icon, 'Bell'), p_target, coalesce(p_published_at, now()),
            auth.uid(), public.get_my_tenant_id(), coalesce(p_image_paths, '{}'::text[]))
    RETURNING id, tenant_id INTO v_id, v_tenant;
  ELSE
    -- p_image_paths が NULL（古いアプリ）なら画像は変えない
    UPDATE public.announcements
       SET title = p_title, body = p_body, icon = coalesce(p_icon, 'Bell'),
           target = p_target, published_at = coalesce(p_published_at, published_at),
           image_paths = coalesce(p_image_paths, image_paths)
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
$function$;

REVOKE ALL ON FUNCTION public.save_announcement(text, text, text, text, timestamp with time zone, uuid[], uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_announcement(text, text, text, text, timestamp with time zone, uuid[], uuid, text[]) TO authenticated, service_role;

-- ---- 置き場 ----
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'announcement-images',
  'announcement-images',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 🔴 CASE で順番を決める（他のバケットの行で、重い確かめや uuid への変換を走らせない）
DROP POLICY IF EXISTS "announcement images: staff and recipients can read" ON storage.objects;
CREATE POLICY "announcement images: staff and recipients can read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  CASE
    WHEN bucket_id <> 'announcement-images' THEN false
    WHEN (storage.foldername(name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
    ELSE
      -- そのジムのスタッフ（作る・直す人と、インストラクター）
      public.has_tenant_role(((storage.foldername(name))[1])::uuid, auth.uid(), ARRAY['owner', 'trainer'])
      -- その画像が付いたお知らせを見られる人（announcements の読み取り権限がそのまま効く）
      OR EXISTS (
        SELECT 1 FROM public.announcements a
         WHERE a.tenant_id = ((storage.foldername(name))[1])::uuid
           AND storage.objects.name = ANY (a.image_paths)
      )
  END
);

DROP POLICY IF EXISTS "announcement images: owners can upload" ON storage.objects;
CREATE POLICY "announcement images: owners can upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  CASE
    WHEN bucket_id <> 'announcement-images' THEN false
    WHEN name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$' THEN false
    ELSE
      public.has_tenant_role(split_part(name, '/', 1)::uuid, auth.uid(), ARRAY['owner', 'trainer'])
      AND NOT public.is_limited_staff(split_part(name, '/', 1)::uuid, auth.uid())
  END
);

DROP POLICY IF EXISTS "announcement images: owners can delete" ON storage.objects;
CREATE POLICY "announcement images: owners can delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  CASE
    WHEN bucket_id <> 'announcement-images' THEN false
    WHEN (storage.foldername(name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
    ELSE
      public.has_tenant_role(((storage.foldername(name))[1])::uuid, auth.uid(), ARRAY['owner', 'trainer'])
      AND NOT public.is_limited_staff(((storage.foldername(name))[1])::uuid, auth.uid())
  END
);

NOTIFY pgrst, 'reload schema';
