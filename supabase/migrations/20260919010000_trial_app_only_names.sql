-- ============================================================================
-- 体験予約ページ（/trial）で「会員の方はアプリからご予約ください」と案内する
--
-- 2026-09-19 宗本さんの要望（要旨）:
--
--   > すでにうちの会員でアプリのアカウントもある方が、体験予約サイトから
--   > 予約してしまう。直接は言いにくいので、体験予約サイトからは予約できない
--   > ようにして、アプリから予約するよう案内を出したい。
--   > **これは私のジムだけ。予約システムには影響を与えず、指定した単語並びのみ。**
--
-- ## 🔴 お名前は**リポジトリに書かない**
--
-- このリポジトリは public。お名前をコードに書くと実名がインターネットに公開される。
-- そのため単語は **本番DBの `tenants.trial_app_only_names`（店ごと）** に持たせ、
-- コード側には1文字も置かない。既定は空配列なので、**他の店は1ミリも変わらない**。
--
-- ## 🔴 一覧を公開ページに配らない
--
-- 判定を画面側でやるには単語リストをブラウザへ送る必要があり、
-- 誰でも開発者ツールで読めてしまう（＝実名の公開と同じ）。
-- そこで **「この名前は該当するか」だけを返す RPC** を置き、anon に EXECUTE を与える。
-- リストそのものは `get_tenant_public` にも**入れない**（入れたら全部漏れる）。
--
-- ## 判定は「正規化してから部分一致」
--
--   NFKC（全角/半角・半角カナを揃える）→ 空白と「・」を除去 →
--   ひらがな→カタカナ → 小文字化 → `strpos` で部分一致
--
-- 「内 賦」「内・賦」「ﾅｲﾌ」「ないふ」のような書き方の揺れを同じものとして扱うため。
-- 部分一致なので「姓だけ」「名だけ」を登録すれば両方に効く。
--
-- ## 🔴 効かせる範囲（ここを外すと「予約システムに影響を与える」）
--
--   効く     … trial_bookings の体験（booking_kind = 'trial'）だけ
--   効かない … ドロップイン / 会員の予約（bookings）/ 店の代理予約 / 他テナント
--
-- 単語が1つも登録されていない店では、判定関数は必ず false を返す。
-- ============================================================================

-- ── 単語リスト（店ごと。既定は空＝何も弾かない）──────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS trial_app_only_names text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.tenants.trial_app_only_names IS
  '体験予約ページ（/trial）で「アプリからご予約ください」と案内するお名前の単語。'
  '正規化したうえで部分一致で判定する。既定は空配列＝誰も弾かない。'
  '🔴 個人情報なので get_tenant_public では返さない（公開ページに配らない）。'
  '効くのは体験予約（trial_bookings の booking_kind = ''trial''）だけで、'
  '会員の予約・店の代理予約・ドロップインには効かない。';

-- 🔴 migration では誰の値も入れない。実際の単語は本番で店ごとに設定する
--    （CLAUDE.md: 特定テナント専用の変更を全テナントに適用しない／リポジトリに実名を置かない）。

-- ── 突き合わせ用の正規化 ──────────────────────────────────────────────────
-- クライアント側には同じ処理を持たせない（＝この関数が唯一の正）。
-- IMMUTABLE なのは、将来インデックスを張れるようにするため。
CREATE OR REPLACE FUNCTION public.normalize_name_for_match(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT lower(
    translate(
      -- NFKC で全角英数・半角カナ・全角スペースを揃えてから、空白と中黒を落とす
      regexp_replace(normalize(COALESCE(p_text, ''), NFKC), '[\s・]', '', 'g'),
      -- ひらがな → カタカナ（「ないふ」と「ナイフ」を同じものとして扱う）
      'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ',
      'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ'
    )
  );
$function$;

-- ── 「このお名前はアプリへの案内対象か」だけを返す ────────────────────────
-- 🔴 返り値は boolean だけ。どの単語に当たったかも、単語が何件あるかも返さない。
--    公開ページ（未ログイン）から呼ぶので、ここから一覧を再構成できてはいけない。
CREATE OR REPLACE FUNCTION public.trial_name_needs_app(p_tenant_id uuid, p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants t
    CROSS JOIN LATERAL unnest(COALESCE(t.trial_app_only_names, ARRAY[]::text[])) AS kw
    WHERE t.id = p_tenant_id
      -- 空文字や空白だけの単語は無視する。入れてしまうと strpos が必ず 1 を返し、
      -- **全員がアプリへの案内になる**（登録画面側でも弾くが、ここでも必ず見る）。
      AND public.normalize_name_for_match(kw) <> ''
      AND strpos(
            public.normalize_name_for_match(p_name),
            public.normalize_name_for_match(kw)
          ) > 0
  );
$function$;

GRANT EXECUTE ON FUNCTION public.trial_name_needs_app(uuid, text) TO anon, authenticated, service_role;

-- ── 最後の砦（画面を書き換えられても入らないように）──────────────────────
-- 公開ページの判定は案内のためのもので、送信自体は誰でも組み立てられる。
-- ここで止めないと「案内は出るが予約は入る」になる。
--
-- 🔴 判定に失敗したら**通す**。この機能のために予約が1件でも落ちるほうが重い。
--    （単語が0件の店ではそもそも false なので、他店では何も起きない）
CREATE OR REPLACE FUNCTION public.enforce_trial_app_only_names()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hit boolean := false;
BEGIN
  -- ドロップインは対象外（体験と同じ trial_bookings に同居している）。
  IF COALESCE(to_jsonb(NEW) ->> 'booking_kind', 'trial') <> 'trial' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT public.trial_name_needs_app(NEW.tenant_id, NEW.guest_name) INTO v_hit;
  EXCEPTION WHEN OTHERS THEN
    -- 判定できないときは黙って通す（予約を止めない）
    RETURN NEW;
  END;

  IF COALESCE(v_hit, false) THEN
    -- ⚠️ 文面に「この時間帯」を含めないこと。trial-book が満枠の拒否と取り違える。
    RAISE EXCEPTION '会員の方はアプリからご予約をお願いしています';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_trial_app_only_names ON public.trial_bookings;
CREATE TRIGGER enforce_trial_app_only_names
  BEFORE INSERT ON public.trial_bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_app_only_names();
