-- グローバルな trainer ロールだけで書けてしまうテーブルを塞ぐ
--
-- ## 前提: トレーナー登録は自由なまま
--
-- `signup-trainer` は自己サービスで、誰でも trainer ロールを取れる。
-- **これは仕様として維持する**（新規ジムが自分で登録できることが product の前提）。
-- 代わりに、「trainer になっただけで他テナントに手が届く先」を無くす。
--
-- ## 何が問題だったか
--
-- `has_role` が見る `public.user_roles` に `tenant_id` は無い。
-- **trainer はテナント横断のグローバル権限**なので、
--
--   USING (has_role(auth.uid(), 'trainer'::app_role))
--
-- とだけ書かれた書き込みポリシーは「誰でも登録できる権限」で全テナント共通のデータを
-- 書き換えられる、という意味になる。実際に以下が開いていた:
--
--   raid_bosses / raid_reward_items          … レイドの定義と報酬
--   season_events / season_event_tasks       … シーズンイベントの定義
--   season_pass_config / season_pass_levels  … シーズンパスの定義（FOR ALL）
--   avatar_customization_items               … アバターアイテムの定義
--   gym_settings                             … 旧・単一ジム時代の設定（未使用）
--
-- どれも `tenant_id` を持たない**全テナント共通のマスタ**。捨てアドレスで登録した
-- 誰かが「レイドを全部消す」「イベントを書き換える」ことができた。
--
-- ## 直し方
--
-- **書き込みポリシーを外して service_role 専用にする。** SELECT は今までどおり。
-- これらはコンテンツのマスタで、**アプリからは1箇所も書いていない**（2026-08-03 に全走査）。
-- 運用時の編集はダッシュボード（service_role）で行う。
--
-- なお apply_raid_damage() は SECURITY DEFINER なので、raid_bosses の
-- current_damage / defeated の更新はこの変更の影響を受けない。
--
-- ## 対象外（既に絞られていた）
--
--   counseling_responses  … AND tenant_id = get_my_tenant_id()
--   tenant_muscle_groups  … AND tenant_id = get_my_tenant_id()
--   google_calendar_tokens… AND auth.uid() = user_id

-- ============================================================
-- レイド
-- ============================================================
DROP POLICY IF EXISTS "Trainers manage raids insert" ON public.raid_bosses;
DROP POLICY IF EXISTS "Trainers manage raids update" ON public.raid_bosses;
DROP POLICY IF EXISTS "Trainers manage raids delete" ON public.raid_bosses;

DROP POLICY IF EXISTS "Trainers manage reward items insert" ON public.raid_reward_items;
DROP POLICY IF EXISTS "Trainers manage reward items update" ON public.raid_reward_items;
DROP POLICY IF EXISTS "Trainers manage reward items delete" ON public.raid_reward_items;

-- ============================================================
-- シーズンイベント
-- ============================================================
DROP POLICY IF EXISTS "Trainers manage events insert" ON public.season_events;
DROP POLICY IF EXISTS "Trainers manage events update" ON public.season_events;
DROP POLICY IF EXISTS "Trainers manage events delete" ON public.season_events;

DROP POLICY IF EXISTS "Trainers manage tasks insert" ON public.season_event_tasks;
DROP POLICY IF EXISTS "Trainers manage tasks update" ON public.season_event_tasks;
DROP POLICY IF EXISTS "Trainers manage tasks delete" ON public.season_event_tasks;

-- ============================================================
-- シーズンパス（FOR ALL だった。SELECT は別ポリシーで残る）
-- ============================================================
-- ⚠️ `DROP POLICY IF EXISTS` は**テーブルが無いと落ちる**（IF EXISTS はポリシーに
-- かかるのであってテーブルにはかからない）。season_pass_config / season_pass_levels は
-- **ジムボード本番に存在しない**（マイグレーションはあるが適用されていない）。
-- 兄弟アプリでも同じ状態がありえるので、テーブルの有無を見てから実行する。
DO $$
BEGIN
  IF to_regclass('public.season_pass_config') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Trainers manage season config" ON public.season_pass_config';
  END IF;
  IF to_regclass('public.season_pass_levels') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Trainers manage season levels" ON public.season_pass_levels';
  END IF;
END $$;

-- ============================================================
-- アバターのカスタマイズアイテム
-- ============================================================
DROP POLICY IF EXISTS "Trainers manage customization items insert" ON public.avatar_customization_items;
DROP POLICY IF EXISTS "Trainers manage customization items update" ON public.avatar_customization_items;
DROP POLICY IF EXISTS "Trainers manage customization items delete" ON public.avatar_customization_items;

-- ============================================================
-- 旧・単一ジム時代の設定（アプリからは未使用）
-- ============================================================
DROP POLICY IF EXISTS "Trainers can update gym settings" ON public.gym_settings;
DROP POLICY IF EXISTS "Trainers can insert gym settings" ON public.gym_settings;

-- ============================================================
-- storage: avatars バケットの tenant-logos/
-- ============================================================
-- `(storage.foldername(name))[1] = 'tenant-logos' AND has_role(trainer)` だけだったので、
-- trainer になれば `avatars/tenant-logos/` に任意のファイル名で置けた。
--
-- 実際にここへ書くのは Onboarding のロゴアップロード1箇所だけで、パスは
-- `tenant-logos/{user.id}-{timestamp}.{ext}`（src/pages/Onboarding.tsx:115）。
-- オンボーディング時点ではまだテナントが無いので get_my_tenant_id() は使えない。
-- 自分の user_id 始まりに限定する。
DROP POLICY IF EXISTS "Authenticated avatar uploads scoped to user folder" ON storage.objects;
CREATE POLICY "Authenticated avatar uploads scoped to user folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (
      (storage.foldername(name))[1] = 'tenant-logos'
      AND public.has_role(auth.uid(), 'trainer'::public.app_role)
      AND name LIKE 'tenant-logos/' || auth.uid()::text || '-%'
    )
  )
);

COMMENT ON TABLE public.raid_bosses IS
  '全テナント共通のマスタ。書き込みは service_role のみ（RLSポリシーを意図的に置いていない）。has_role(trainer) はテナント横断のグローバル権限なので、書き込み条件に使わないこと。';
COMMENT ON TABLE public.season_events IS
  '全テナント共通のマスタ。書き込みは service_role のみ（RLSポリシーを意図的に置いていない）。has_role(trainer) はテナント横断のグローバル権限なので、書き込み条件に使わないこと。';
