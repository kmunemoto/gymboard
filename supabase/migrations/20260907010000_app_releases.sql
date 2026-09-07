-- ============================================================================
-- アプリの最新版を1箇所で持ち、古い版のお客様に更新をお願いする
-- （2026-09-07 宗本さんの要望）
--
-- > 新しいバージョンをアップロードして、まだアップデートしていないお客様に
-- > アップデートしてもらえるように、こういう画面をアプリに出すようにしてほしい。
-- > それぞれボタンを押したら iOS / Android のアプリに各飛ぶように。
--
-- ## 🔴 「必須更新（閉じられない）」は作っていない
--
-- 設計を3つの観点（ブリック／版数比較／マルチテナント）で反証したところ、
-- **閉じられないダイアログはアプリ全体を人質に取る**うえ、
-- 復旧が「本番DBの書き換え＋各端末の再起動待ち」しか無いことが分かった。
-- 具体的に潰せなかった経路:
--
--   * Play の段階公開・機種非対応・国別公開で「更新したくてもできない」層が必ず残る
--   * OS の最低要件を満たさない端末は**二度と更新できない**
--   * 版数の入力ミス1つで全端末が同時に止まる（下記のとおり間違えやすい）
--
-- したがってこのテーブルには `min_version` を**置かない**。
-- 画面のダイアログは常に「あとで」で閉じられる。
--
-- ## 🔴 latest_version に入れるのは「ストアに出ている版」。リポジトリの値ではない
--
-- `.github/workflows/ios-build.yml` の `MARKETING_VERSION` は
-- **「次に出す版」**であって、ストアに出ている版ではない
-- （リリース済みを記録した時点で次の版へ進める運用。`mem/ops/release-signal.md`）。
-- 2026-09-07 時点で MARKETING_VERSION は 1.7.0 だが、**1.7.0 は一度も
-- App Store に上がっていない**（Actions #150 は `Install dependencies` で落ち、
-- `Upload to App Store Connect` は skipped）。出ているのは 1.6.9。
-- ここに 1.7.0 を入れると、全 iOS 利用者に「存在しない版への更新」を促すことになる。
--
-- **Android の版数はリポジトリにもセッションにも無い**（Android Studio で直接編集し、
-- Play Console が唯一の正。CLAUDE.md）。分からないうちは NULL にしておくこと。
-- NULL なら何も出ない（フェイルセーフ）。**推測で入れない。**
--
-- ## 読み取りは RPC 経由（テーブルは直接開けない）
--
-- ログイン前でも読めなければならないが、このリポジトリに
-- **anon へ SELECT を開いたテーブルは1つも無い**（公開データは
-- `get_tenant_public` など SECURITY DEFINER の関数だけが返す）。その作法に合わせる。
--
-- ## ストアのURLはここに持たない
--
-- ボタンの飛び先は `src/lib/brand.ts` の `STORE_URLS`。製品ごとに違う値であり、
-- 兄弟アプリ（別 Supabase プロジェクト）がこの migration をそのまま流すと
-- **上流のストアへ誘導してしまう**。リポジトリ側に置けば
-- `src/test/appUpdatePrompt.test.ts` と vertical-fork のチェックリストに載る。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_releases (
  -- 'ios' / 'android'。1プラットフォーム1行
  platform text PRIMARY KEY,

  -- 🔴 **ストアに出ている版**（例 '1.6.9'）。分からないときは NULL（＝何も出さない）
  latest_version text,

  -- 🔴 その版が実際に配信され始めた日時。**NULL または未来なら何も出さない。**
  --    リリース前に値だけ先に入れてしまう事故を、ここで止める
  released_at timestamptz,

  -- 出す/出さない。事故ったときにこれを false にすれば即止まる
  enabled boolean NOT NULL DEFAULT true,

  -- 何を出した版か（運用の覚え書き。画面には出さない）
  note text,

  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_releases_platform_check
    CHECK (platform IN ('ios', 'android')),

  -- 版数の形を縛る。ビルド番号付き（'1.7.0 (149)'）・前後の空白・
  -- 'v1.7.0' のような表記はここで弾く（画面側の parseVersion と同じ条件）
  CONSTRAINT app_releases_version_format
    CHECK (latest_version IS NULL OR latest_version ~ '^[0-9]{1,3}(\.[0-9]{1,4}){1,3}$')
);

COMMENT ON TABLE public.app_releases IS
  'ストアに出ているアプリの最新版。古い版の利用者に更新をお願いするためだけに使う。'
  '必須更新（閉じられないダイアログ）は意図的に持たない。';
COMMENT ON COLUMN public.app_releases.latest_version IS
  '🔴 ストアに出ている版。ios-build.yml の MARKETING_VERSION（＝次に出す版）ではない。'
  '分からないときは NULL にする（推測で入れない）。';
COMMENT ON COLUMN public.app_releases.released_at IS
  '配信開始日時。NULL または未来なら RPC は何も返さない。';

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

-- ポリシーを1つも作らない＝ anon / authenticated からは直接読めない・書けない。
-- 読むのは下の SECURITY DEFINER 関数だけ。書くのは service_role（RLS を素通りする）。
REVOKE ALL ON TABLE public.app_releases FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 画面が読む唯一の入口
--
-- 返すのは「出してよいと確定している版」だけ。次のどれかなら 0 行:
--   enabled が false / latest_version が NULL / released_at が NULL または未来
-- 0 行 ＝ 画面は何も出さない（フェイルセーフ）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_app_release(p_platform text)
RETURNS TABLE (latest_version text, released_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.latest_version, r.released_at
  FROM public.app_releases r
  WHERE r.platform = p_platform
    AND r.enabled
    AND r.latest_version IS NOT NULL
    AND r.released_at IS NOT NULL
    AND r.released_at <= now();
$$;

COMMENT ON FUNCTION public.get_app_release(text) IS
  'ストアに出ているアプリの最新版を1行返す。出す条件が揃っていなければ0行。'
  'ログイン前の画面からも呼ぶため anon にも実行を許可している。';

GRANT EXECUTE ON FUNCTION public.get_app_release(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 初期値
--
-- ios     … 2026-09-03 に App Store へ上がって公開済みの 1.6.9
--            （Actions #149 = cacae7d。ログの UPLOAD SUCCEEDED / Delivery UUID
--             da37a81b-4fb1-46ca-9444-8bcef5442727 で確認済み）。
--            いま出回っている版なので、この値では**誰にもダイアログは出ない**。
--            1.7.0 が公開されたらここを 1.7.0 に上げる＝そこで初めて出る。
-- android … 🔴 版数がセッションからもリポジトリからも読めないので NULL。
--            宗本さんに Play Console の versionName を教えてもらってから入れる。
--            NULL の間は Android には何も出ない。
-- ---------------------------------------------------------------------------
INSERT INTO public.app_releases (platform, latest_version, released_at, note)
VALUES
  ('ios', '1.6.9', TIMESTAMPTZ '2026-09-03 12:54:24+00',
   'Actions #149 = cacae7d。チャットのスタンプ（PR #380）まで'),
  ('android', NULL, NULL,
   'Play Console の versionName を確認してから入れる。NULL の間は何も出ない')
ON CONFLICT (platform) DO NOTHING;
