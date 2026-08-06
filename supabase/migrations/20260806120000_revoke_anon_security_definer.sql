-- ============================================================================
-- anon から呼べる SECURITY DEFINER 関数を塞ぐ（穴6の続き）
-- ============================================================================
--
-- 穴6（20260805000000）でメールキューの4関数を塞いだが、**同じ形が他にもあった。**
-- 2026-08-06、本番DBを実測したところ:
--
--   anon から EXECUTE でき、かつ関数内に auth.uid() のチェックが無い
--   SECURITY DEFINER 関数（トリガー関数を除く＝PostgREST から実際に呼べるもの）
--   … **37件**
--
-- `anon` キーは全クライアントに埋め込まれているので、**ログイン不要で叩ける。**
--
-- ── 何ができてしまうか（実測に基づく代表例）────────────────────
--
--   buy_shop_item(p_user_id, ...)      他人のコインで買い物させ、残高を0にできる
--   grant_equipment(p_user_id, ...)    他人に任意の装備を配れる
--   complete_dungeon_run(..., p_total_coins, p_total_exp)
--                                      **数値を引数でそのまま渡せる。**検算が無い
--   get_ranking(p_type, p_gender)      全ジムの会員の user_id 一覧が取れる
--                                      → 上のすべての「他人の user_id」の入手元になる
--   get_booked_slots(check_date)       **全テナントの**予約表が日付指定で取れる
--
-- **共通の形は「user_id を引数で受け取り、呼び出し元と突き合わせていない」。**
--
-- ── 段階を分ける ────────────────────────────────────────────
--
-- このマイグレーションは **壊さないことが確実な範囲だけ**をやる。
--
--   段階1（ここ）: 権限を剥がす。呼び出し元を実測して安全を確認済み
--   段階2（別途）: 関数の中に auth.uid() のチェックを入れる／使わない関数を消す
--
-- 段階2を待たずに1を先に入れるのは、**いま anon から叩ける状態を止めるため。**
--
-- 検査: src/test/anonRpcExposure.test.ts / security/check.sql の検査5
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. anon から見えてよいポリシーを絞る（REVOKE の前にやること）
-- ----------------------------------------------------------------------------
-- 下の 3 で has_role の anon 実行権限を剥がす。
-- **その前に、anon にも適用されるポリシー（roles = {public}）から has_role を外す。**
--
-- 順序を逆にすると、anon がそのテーブルを読んだときに
-- 「0件」ではなく **permission denied for function has_role** が返る。
--
-- 実測: has_role を使うポリシーは104件あり、そのうち `{public}` は**7件だけ**。
-- 7件ともゲーミフィケーション系テーブルの SELECT で、**ログイン前に読む画面は無い**。
-- `TO authenticated` に絞るのが本来の姿。

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles = '{public}'
      AND cmd = 'SELECT'
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%has_role%'
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', r.policyname, r.tablename);
    RAISE NOTICE 'policy scoped to authenticated: %.%', r.tablename, r.policyname;
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 2. 呼び出し元が1件も無い関数 → anon / authenticated の両方から剥がす
-- ----------------------------------------------------------------------------
-- `src/` と `supabase/functions/` を走査して **26件すべて0件**を確認済み
-- （2026-08-06。`supabase/functions/mcp/` はビルド成果物なので数えていない）。
--
-- ⚠️ **DROP はしない。** 使っていないことは確認できたが、
--    トリガーや他の SECURITY DEFINER 関数の内部から呼ばれる経路は残る
--    （内部呼び出しは所有者権限で動くので、EXECUTE を剥がしても影響しない）。
--    権限だけ落とし、関数そのものの整理は段階2で判断する。

DO $$
DECLARE
  sig TEXT;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    -- ゲーミフィケーション（GAMIFICATION_ENABLED = false で画面からは消えている）
    'public._quest_condition_values(uuid)',
    'public.buy_gacha_ticket(uuid, integer)',
    'public.buy_shop_item(uuid, text, integer)',
    'public.buy_stamina(uuid, integer)',
    'public.claim_daily_login_bonus(uuid)',
    'public.complete_dungeon_run(uuid, integer, integer, integer, text, jsonb)',
    'public.ensure_starter_companion(uuid)',
    'public.ensure_starter_items(uuid)',
    'public.feed_companion(uuid, text, boolean)',
    'public.get_login_bonus_status(uuid)',
    'public.get_ranking(text, text)',
    'public.grant_companion_exp(uuid, integer)',
    'public.grant_equipment(uuid, text, text)',
    'public.grant_training_stamina_bonus_for(uuid)',
    'public.hatch_companion_egg(uuid, text)',
    'public.initialize_starter_equipment_for_user(uuid)',
    'public.recover_stamina(uuid)',
    'public.set_active_companion(uuid, text)',
    'public.start_dungeon_run(uuid, text)',
    -- 全テナントの予約表が取れる。後継の get_tenant_booked_slots に置き換わった残骸
    'public.get_booked_slots(date)',
    -- 全ジムのスタッフの user_id 一覧。穴5（send-line-message）で問題になった関数
    'public.get_trainer_ids()',
    -- ⚠️ この3つを authenticated から剥がしたのは**誤り**。20260806140000 で戻している。
    --    「ポリシーの中からは所有者権限で評価されるので影響しない」と書いていたが、
    --    **RLS のポリシー式はクエリを投げたロールの権限で評価される。**
    --    本番で 42501 permission denied for function shares_tenant_with_me が出た。
    --    ここを消さずに残してあるのは、消すと適用済みDBとの対応が崩れるため。
    --    **兄弟アプリへ持っていくときは、この3つを下の「anon だけ剥がす」側に置くこと。**
    'public.has_tenant_role(uuid, uuid, text[])',
    'public.is_tenant_member(uuid, uuid)',
    -- is_tenant_over_limit はポリシーから使われていないので、剥がしたままでよい
    -- （呼び出し元の get_tenant_limit_status / enforce_tenant_plan_limit は両方 DEFINER）
    'public.is_tenant_over_limit(uuid)',
    'public.shares_tenant_with_me(uuid)',
    -- 現在は未使用（明示的に anon へ GRANT された公開APIだが呼び出し元0件）
    'public.get_default_tenant_public()'
  ]
  LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
    END IF;
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 3. クライアントがログイン後に呼ぶ関数 → anon だけ剥がす
-- ----------------------------------------------------------------------------
-- authenticated は残す。**剥がすとアプリが壊れる。**
--
--   check_weight_milestones          useMeasurements.ts:71 / TrainerWeightJourneyPanel.tsx:104
--   check_collection_milestones      useAvatar.ts:248
--   check_training_milestones        raidUtils.ts:90
--   apply_raid_damage                raidUtils.ts:32
--   process_session_rewards          raidUtils.ts:46
--   update_event_progress            useSeasonEvents.ts:98
--   lookup_tenant_by_staff_invite_code  JoinGymStaff.tsx:65（ログイン必須の画面）
--   has_role                         _shared/auth.ts:42（service_role で呼ぶ）
--
-- ⚠️ **has_role は authenticated から絶対に剥がさないこと。**
--    104件のポリシーが使っている。剥がすとアプリ全体が即死する。

DO $$
DECLARE
  sig TEXT;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.apply_raid_damage(uuid, date, integer)',
    'public.check_collection_milestones(uuid)',
    'public.check_training_milestones(uuid)',
    'public.check_weight_milestones(uuid)',
    'public.process_session_rewards(uuid, date)',
    'public.update_event_progress(uuid)',
    'public.lookup_tenant_by_staff_invite_code(text)',
    'public.has_role(uuid, app_role)'
  ]
  LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', sig);
    END IF;
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 4. anon から呼べて「正しい」もの（触らない）
-- ----------------------------------------------------------------------------
-- ログイン前の画面（体験予約・ドロップイン予約）が使うので、**塞ぐと予約できなくなる。**
--
--   get_tenant_public(uuid)                    TrialBooking.tsx:86 / DropInBooking.tsx:82
--   get_tenant_booked_slots(uuid, date, date)  CustomerBooking / TrialBooking / DropInBooking
--   lookup_tenant_by_invite_code(text)         招待リンクからの参加（ログイン前に照合する）
--
-- ⚠️ **この3つを「安全のため」と言って塞がないこと。**
--    塞ぐと未ログインの予約ページが真っ白になる。
--    返している列に個人情報が無いことは確認済み（ジム名・ロゴ・営業設定・時間帯のみ）。


-- ----------------------------------------------------------------------------
-- 5. 段階2で決めること（このマイグレーションではやらない）
-- ----------------------------------------------------------------------------
-- 上で権限は塞いだが、**関数の形（user_id を引数で受け取り照合しない）は残っている。**
-- authenticated を残した6件は、**ログインさえすれば他人の user_id を渡せる。**
--
--   ・ゲーミフィケーションを復活させるなら、関数内に auth.uid() の照合を入れる
--     （ただし check_weight_milestones は**トレーナーが会員の user_id を渡す**ので、
--       「本人 または 同じテナントのスタッフ」という条件にする必要がある）
--   ・復活させないなら、関数ごと削除する
--
-- **どちらにせよ、いま anon から叩ける状態を止めるほうが先。**
