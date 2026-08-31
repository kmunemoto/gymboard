-- 自宅でできるセルフストレッチ動画のライブラリ（2026-08-31）
--
-- ジムが「家で1人でできるストレッチ」の動画を並べ、お客様がアプリから見る。
--
-- ## 🔴 なぜ動画ファイルを持たないのか
-- YouTube / Vimeo の**限定公開URLを1列持つだけ**にしてある。ファイルは受け取らない。
--
-- 3分の解説動画は数百MB級で、チャット添付の上限25MB（20260811020000）とは桁が2つ違う。
-- 直接受け取ると、変換・サムネ生成・再開可能アップロード・**署名URLの再発行**
-- （いまの withSignedUrls は取得時に1回署名するだけでTTL 1時間。動画のように長く
-- 留まる画面では確実に切れる）が全部ついてくる。さらに料金は
-- gymboardPlans.ts が Free ¥0/5人 〜 Pro ¥9,800/無制限 と**席数だけ**で値付けしていて、
-- 容量と転送量（視聴回数に比例して増える）を吸収する場所が無い。
--
-- URL方式なら保存も配信も外に出るので、テナントが増えてもジムボードの原価は増えない。
-- 変換・複数画質・CDN も向こう持ち。将来ファイルも受けたくなったら、
-- storage_path 列を足して「video_url が NULL なら自前」と分ければよい。
--
-- ## 🔴 URLをそのまま iframe に入れない
-- ここは自由入力なので `javascript:` を入れられると困る。DB側は https 限定にし、
-- クライアント側（src/lib/videoEmbed.ts）は**動画IDだけを抜き出して埋め込みURLを組み立て直す**。
-- 生のURLが src に入る経路は無い。見張り: src/test/gymVideos.test.ts
--
-- ## 公開範囲
-- 「そのジムのお客様全員に共通」（宗本さん決定）。お客様ごとの割り当ては持たない。
-- お知らせ（announcements）と同じで published_at 1本だけ。未来の日時なら
-- お客様には見えない＝予約公開になる。下書き・公開トグルは持たない。

CREATE TABLE IF NOT EXISTS public.gym_videos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  title            text NOT NULL,
  -- 「いつ・何回やるか」などの補足。無くてよい
  description      text,
  -- YouTube / Vimeo の視聴URL。埋め込みURLではなく、貼られたそのままを持つ
  video_url        text NOT NULL,
  -- 部位・目的での仕分け。exercises.category と同じで自由入力＋既定 'その他'
  category         text NOT NULL DEFAULT 'その他',
  -- 尺（秒）。任意。家でやる人が「何分かかるか」を先に知りたいので置いている
  duration_seconds integer,
  sort_order       integer NOT NULL DEFAULT 0,
  -- 未来の日時なら、その時刻までお客様には出ない（announcements と同じ規則）
  published_at     timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_videos_title_len') THEN
    ALTER TABLE public.gym_videos ADD CONSTRAINT gym_videos_title_len
      CHECK (btrim(title) <> '' AND char_length(title) <= 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_videos_description_len') THEN
    ALTER TABLE public.gym_videos ADD CONSTRAINT gym_videos_description_len
      CHECK (description IS NULL OR char_length(description) <= 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_videos_category_len') THEN
    ALTER TABLE public.gym_videos ADD CONSTRAINT gym_videos_category_len
      CHECK (btrim(category) <> '' AND char_length(category) <= 30);
  END IF;
  -- 🔴 https 以外を受け付けない。`javascript:` や `data:` を弾く最後の砦
  --    （画面側でも videoEmbed.ts が ID を抜き出して組み立て直すので二重に守る）
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_videos_url_https') THEN
    ALTER TABLE public.gym_videos ADD CONSTRAINT gym_videos_url_https
      CHECK (video_url LIKE 'https://%' AND char_length(video_url) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_videos_duration_range') THEN
    ALTER TABLE public.gym_videos ADD CONSTRAINT gym_videos_duration_range
      CHECK (duration_seconds IS NULL OR (duration_seconds > 0 AND duration_seconds <= 86400));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS gym_videos_tenant_order_idx
  ON public.gym_videos (tenant_id, sort_order, published_at DESC);

DROP TRIGGER IF EXISTS gym_videos_set_updated_at ON public.gym_videos;
CREATE TRIGGER gym_videos_set_updated_at
  BEFORE UPDATE ON public.gym_videos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.gym_videos ENABLE ROW LEVEL SECURITY;

-- テナント境界の本体。他のジムの行は読めも書けもしない
DROP POLICY IF EXISTS tenant_isolation ON public.gym_videos;
CREATE POLICY tenant_isolation ON public.gym_videos AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 🔴 お客様は「公開済み」だけ。トレーナーは予約公開中のものも見える（下書き確認のため）
DROP POLICY IF EXISTS gym_videos_select ON public.gym_videos;
CREATE POLICY gym_videos_select ON public.gym_videos
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role) OR published_at <= now());

DROP POLICY IF EXISTS gym_videos_insert ON public.gym_videos;
CREATE POLICY gym_videos_insert ON public.gym_videos
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'trainer'::app_role));

DROP POLICY IF EXISTS gym_videos_update ON public.gym_videos;
CREATE POLICY gym_videos_update ON public.gym_videos
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'trainer'::app_role));

DROP POLICY IF EXISTS gym_videos_delete ON public.gym_videos;
CREATE POLICY gym_videos_delete ON public.gym_videos
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role));

COMMENT ON TABLE public.gym_videos IS
  'ジムがお客様に配る動画（自宅ストレッチ等）。テナント単位。動画ファイルは持たず、YouTube/Vimeo の限定公開URLを video_url に持つ。published_at が未来なら未公開。';

-- メニューに「動画」を出すかのジムごとのスイッチ。
-- 他の show_nav_* と同じで既定 true（＝いま在るジムの見え方は変えない。
-- 20260723100000_add_gym_display_visibility.sql の方針をそのまま踏襲）。
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS show_nav_videos BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenants.show_nav_videos IS 'メニューに「動画」を表示するか。既定true（非表示でも機能自体は残る）';
