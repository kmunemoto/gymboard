-- ソーシャルログイン（Apple / Google）で登録した人の表示名を拾えるようにする（2026-08-08）
--
-- ── 何が起きていたか ──────────────────────────────────────────
-- handle_new_user は自前のサインアップフォームだけを前提に書かれていた。
--
--   COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email)
--
-- `display_name` を入れるのは **Auth.tsx のフォームだけ**（src/pages/Auth.tsx:187）。
-- Apple も Google も `display_name` というキーは持たないので、
-- ソーシャルログインで入ってきた人は **必ず NEW.email に落ちる。**
--
--   Google … full_name / name（+ given_name / family_name）を入れる
--   Apple  … full_name を入れる。ただし **初回認可のときだけ**で、
--            しかも本人が名前の共有を拒否すれば何も来ない
--
-- ── 🔴 Apple の「メールを非公開」と重なると実害になる ─────────────
-- Apple ログインは既定で転送用アドレスを配る。
--
--   abc123def@privaterelay.appleid.com
--
-- 従来のコードだと **これがそのままお客様の表示名になり、**
-- トレーナーの顧客一覧にこの文字列が並ぶ。
--
-- ⚠️ **ここでメールに落とさないこと。** 一見「名前が入っている」ので
--    UI 側の未設定チェックをすり抜けてしまう。実際には識別できない文字列なので、
--    **NULL のままにして「名前未設定」に倒すほうが正しい。**
--
--    src/components/trainer/TrainerClientList.tsx の isUnnamed() が
--    NULL を拾って一覧で目立たせるので、トレーナーが名前を埋める導線に乗る。
--    profiles.display_name は nullable で、UI は全箇所 `|| t("common.nameUnset")`
--    のフォールバックを持っている（NULL は想定済みの状態）。
--
-- ── 通常のメール登録の挙動は変えない ──────────────────────────
-- メールアドレスで登録した人にとって、メールは意味のある識別子なので
-- 従来どおりフォールバックに残す。除外するのは privaterelay だけ。
--
-- ── 🔴 この関数は、本番では**まだ誰からも呼ばれていない** ─────────
-- 2026-08-08 に実測したところ、本番の auth.users に**ユーザートリガーが0件**だった。
-- リポジトリの 20260507051932 が作るはずの
-- `on_auth_user_created_profile` / `on_auth_user_created_role` が存在しない。
--
--   auth.users の内部トリガー   30件（見えている）
--   DB全体のユーザートリガー    36件（見えている）
--   auth.users のユーザートリガー 0件  ← 権限ではなく、本当に無い
--
-- **意図的に復活させない判断をした（2026-08-08）。**
--   ・いまの流れ（JoinGym / Onboarding が upsert で profiles を作る）は破綻していない
--   ・auth.users の AFTER INSERT トリガーは、失敗すると**新規登録そのものが止まる**。
--     いま無いということは、その故障モードが存在しない状態でもある
--
-- したがってこの CREATE OR REPLACE は**現時点では不活性**。
-- トリガーを復活させたときに正しく動くようにしてあるだけ。
-- 表示名の実務上の入り口は JoinGym.tsx と Onboarding.tsx（どちらも upsert）。
-- 経緯は mem/auth/social-login.md。

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  meta     jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  resolved text;
BEGIN
  -- 優先順。自前のフォームが入れた値を最優先にし、次にプロバイダ由来の氏名を見る。
  --   display_name … Auth.tsx のサインアップフォーム
  --   full_name    … Google / Apple（Apple は初回のみ・共有を拒否すると来ない）
  --   name         … Google
  -- 空文字は「入っていない」と同じ扱いにする（NULLIF + btrim）。
  resolved := COALESCE(
    NULLIF(btrim(meta->>'display_name'), ''),
    NULLIF(btrim(meta->>'full_name'), ''),
    NULLIF(btrim(meta->>'name'), '')
  );

  -- 名前が取れなかったときだけメールに落とす。
  -- ⚠️ Apple の転送用アドレスは除外する（識別できない文字列を名前にしない）。
  IF resolved IS NULL
     AND NEW.email IS NOT NULL
     AND lower(NEW.email) NOT LIKE '%@privaterelay.appleid.com'
  THEN
    resolved := NULLIF(btrim(NEW.email), '');
  END IF;

  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, resolved)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'auth.users の INSERT で profiles を作る。表示名は display_name → full_name → name → email の順。'
  ' Apple の @privaterelay.appleid.com は名前として使わず NULL のままにする（「名前未設定」に倒す）。';

-- ⚠️ handle_new_user_role には**触らない。**
--    ロールは metadata に関係なく必ず 'customer' を入れる仕様で、
--    これは OAuth のメタデータが攻撃者に細工されうることへの対策。
--    「Google が role を入れてくれるなら読もう」としないこと。
--    トレーナー昇格は signup-trainer（Edge Function）が別途行う。
