-- ============================================================================
-- user_id を引数で受け取る RPC に「呼び出し元の照合」を入れる（穴8の段階2）
-- ============================================================================
--
-- 穴8の段階1（20260806120000）で **権限**は塞いだ。
-- ただし **関数の形は変えていない**ので、
-- **ログインさえすれば他人の user_id を渡せる**関数が残っていた。
--
-- 段階2として本番を総ざらいしたところ、**段階1で見えていなかったものが出てきた。**
-- 段階1の検査は `prosrc` に `auth.uid()` を含む関数を「照合している」とみなして
-- 除外していたが、**auth.uid() を書いてあっても照合になっていない形**が3種あった。
--
-- ── 形1: NULL で素通りする比較（三値論理）★これが一番危なかった ────────
--
--   IF NOT public.has_role(auth.uid(), 'trainer') AND auth.uid() != _customer_id THEN
--     RAISE EXCEPTION '権限がありません';
--   END IF;
--
-- **未ログイン（anon）だと `auth.uid()` は NULL。**
--   `NULL != _customer_id` → **NULL**（false ではない）
--   `true AND NULL`        → **NULL**
--   `IF NULL THEN`         → **通らない ＝ 例外が出ない**
--
-- つまり **RAISE を素通りして本体が走る。**
-- `delete_customer_cascade` がこの形だった。実測で anon から実行できた:
--
--   DELETE FROM workouts / bookings / meals / messages
--        / notification_settings / profiles / user_roles  WHERE user_id = <任意>
--
-- **anon キーはアプリに埋め込まれているので、ログイン不要で誰の会員データも消せた。**
-- 加えて `has_role(auth.uid(),'trainer')` は**グローバルなロール判定でテナントを見ない**ため、
-- **A院のトレーナーが B院の会員を消せる**状態でもあった。
--
-- `complete_quest_stage` / `equip_item` / `get_quest_progress` も同じ形
--   （`IF v_user <> auth.uid() AND NOT has_role(...) THEN`）。
--
-- ── 形2: 引数を優先して、照合が無い ────────────────────────
--
--   v_user := COALESCE(p_user_id, auth.uid());
--   IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;
--
-- **引数を渡した時点で auth.uid() は見ない。** 「認証が必要です」は
-- 「引数も無く未ログイン」のときしか出ない。`execute_quest_battle` /
-- `get_player_combat_stats` がこの形。
--
-- ── 形3: そもそも照合が無い ────────────────────────────────
--
--   apply_raid_damage / check_*_milestones / process_session_rewards
--   / update_event_progress / spin_gacha
--
-- ── なぜ本体を書き換えず、包む形にしたか ────────────────────
--
-- 対象の本体は合計 40KB 超の plpgsql（レイドの判定、コンボ倍率、ランクアップ、
-- クエストの報酬…）。**照合を1行足すために本体を書き写すと、写し間違いが
-- そのままロジックの破壊になる。**
--
-- そこで **本体には一切触れず**、
--
--   1. 既存の関数を `<name>_unchecked` に **RENAME**（本体はバイト単位で不変）
--   2. `_unchecked` からは EXECUTE を全部剥がす（クライアントから直接は呼べない）
--   3. 元の名前で **照合してから中身を呼ぶだけの関数**を作り直す
--
-- という形にした。**ロジックの差分はゼロ**で、認可の判定は1か所に集まる。
-- （`delete_customer_cascade` だけは本体が短く、かつ壊れた IF を消す必要があるので
--   直接書き換えた。）
--
-- ⚠️ `_unchecked` は名前のとおり**照合していない本体**。
--    新しい呼び出し元を足すときは、必ず照合済みの方（元の名前）を呼ぶこと。
--
-- 検査: src/test/rpcCallerCheck.test.ts / security/check.sql の検査5-c
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 照合の本体
-- ----------------------------------------------------------------------------
-- 通す条件:
--   ・auth.uid() が NULL          … service_role・cron・トリガー等の内部呼び出し。
--                                    anon は下で EXECUTE を剥がすので到達できない
--   ・_target_user_id = auth.uid() … 本人
--   ・同じテナントの owner / trainer … トレーナーが会員に対して行う操作
--
-- ⚠️ **「本人だけ」にしないこと。** トレーナーが会員の user_id を渡す経路が本物としてある:
--
--   TrainerWeightJourneyPanel.tsx:104   check_weight_milestones(clientId)
--   TrainerClientDetail.tsx:499-538     process_session_rewards / check_training_milestones
--                                       / apply_raid_damage / update_event_progress
--   TrainerClientList.tsx:178           delete_customer_cascade(clientId)
--   useMeasurements.ts:71               本人 or トレーナー（TrainerClientDetail から
--                                       useMeasurements(clientId) で使われる）
--
-- それ以外は 42501 で落とす（PostgREST は 403 を返す）。

CREATE OR REPLACE FUNCTION public.assert_can_act_for(_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- service_role / 内部呼び出し
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF _target_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required' USING ERRCODE = '22023';
  END IF;

  -- 本人
  IF _target_user_id = auth.uid() THEN
    RETURN;
  END IF;

  -- 同じテナントのスタッフ（owner / trainer）
  -- get_my_tenant_id() は LIMIT 1 なので、複数テナントに属する人を取りこぼす。
  -- ここは tenant_members 同士を突き合わせる。
  IF EXISTS (
    SELECT 1
    FROM public.tenant_members me
    JOIN public.tenant_members target ON target.tenant_id = me.tenant_id
    WHERE me.user_id = auth.uid()
      AND me.status = 'active'
      AND me.role = ANY (ARRAY['owner', 'trainer'])
      AND target.user_id = _target_user_id
      AND target.status = 'active'
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'not allowed to act for user %', _target_user_id
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.assert_can_act_for(uuid) IS
  '「本人 または 同じテナントの owner/trainer」でなければ 42501 で落とす。'
  'user_id を引数で受け取る SECURITY DEFINER 関数の先頭で PERFORM する。'
  'auth.uid() が NULL（service_role・cron・トリガー）は対象外。';

-- クライアントから直接呼ぶ必要はない。ポリシーからも使っていない。
REVOKE EXECUTE ON FUNCTION public.assert_can_act_for(uuid) FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. delete_customer_cascade（★最優先。未ログインで会員データを消せた）
-- ----------------------------------------------------------------------------
-- ここだけは包まずに直接書き換える。**壊れた IF を残すわけにいかない**ため。
-- DELETE の並びは元のまま（tenant_members を消さないのも元のまま）。

CREATE OR REPLACE FUNCTION public.delete_customer_cascade(_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_can_act_for(_customer_id);

  DELETE FROM public.workouts WHERE user_id = _customer_id;
  DELETE FROM public.bookings WHERE user_id = _customer_id;
  DELETE FROM public.meals WHERE user_id = _customer_id;
  DELETE FROM public.messages WHERE sender_id = _customer_id OR receiver_id = _customer_id;
  DELETE FROM public.notification_settings WHERE user_id = _customer_id;
  DELETE FROM public.profiles WHERE user_id = _customer_id;
  DELETE FROM public.user_roles WHERE user_id = _customer_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_customer_cascade(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_customer_cascade(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- 3. 残りを包む
-- ----------------------------------------------------------------------------
-- 各ブロックは「まだ包んでいないときだけ」動く（再実行しても二重に包まれない）。
-- 関数が無い構成（ゲーミフィケーションを持たない兄弟アプリ）でも落ちない。

-- check_weight_milestones ─ 体重ジャーニー。**ゲーミフィケーションOFFでも生きている**
DO $mig$
BEGIN
  IF to_regprocedure('public.check_weight_milestones(uuid)') IS NOT NULL
     AND to_regprocedure('public.check_weight_milestones_unchecked(uuid)') IS NULL THEN
    ALTER FUNCTION public.check_weight_milestones(uuid) RENAME TO check_weight_milestones_unchecked;
    REVOKE EXECUTE ON FUNCTION public.check_weight_milestones_unchecked(uuid) FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.check_weight_milestones(p_user_id uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
    BEGIN
      PERFORM public.assert_can_act_for(p_user_id);
      RETURN public.check_weight_milestones_unchecked(p_user_id);
    END;
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.check_weight_milestones(uuid) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.check_weight_milestones(uuid) TO authenticated;
  END IF;
END $mig$;

-- check_collection_milestones ─ useAvatar.ts:248
DO $mig$
BEGIN
  IF to_regprocedure('public.check_collection_milestones(uuid)') IS NOT NULL
     AND to_regprocedure('public.check_collection_milestones_unchecked(uuid)') IS NULL THEN
    ALTER FUNCTION public.check_collection_milestones(uuid) RENAME TO check_collection_milestones_unchecked;
    REVOKE EXECUTE ON FUNCTION public.check_collection_milestones_unchecked(uuid) FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.check_collection_milestones(_user_id uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
    BEGIN
      PERFORM public.assert_can_act_for(_user_id);
      RETURN public.check_collection_milestones_unchecked(_user_id);
    END;
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.check_collection_milestones(uuid) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.check_collection_milestones(uuid) TO authenticated;
  END IF;
END $mig$;

-- check_training_milestones ─ raidUtils.ts:90 ← TrainerClientDetail.tsx:510
DO $mig$
BEGIN
  IF to_regprocedure('public.check_training_milestones(uuid)') IS NOT NULL
     AND to_regprocedure('public.check_training_milestones_unchecked(uuid)') IS NULL THEN
    ALTER FUNCTION public.check_training_milestones(uuid) RENAME TO check_training_milestones_unchecked;
    REVOKE EXECUTE ON FUNCTION public.check_training_milestones_unchecked(uuid) FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.check_training_milestones(p_user_id uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
    BEGIN
      PERFORM public.assert_can_act_for(p_user_id);
      RETURN public.check_training_milestones_unchecked(p_user_id);
    END;
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.check_training_milestones(uuid) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.check_training_milestones(uuid) TO authenticated;
  END IF;
END $mig$;

-- update_event_progress ─ useSeasonEvents.ts:98 ← TrainerClientDetail.tsx:538
DO $mig$
BEGIN
  IF to_regprocedure('public.update_event_progress(uuid)') IS NOT NULL
     AND to_regprocedure('public.update_event_progress_unchecked(uuid)') IS NULL THEN
    ALTER FUNCTION public.update_event_progress(uuid) RENAME TO update_event_progress_unchecked;
    REVOKE EXECUTE ON FUNCTION public.update_event_progress_unchecked(uuid) FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.update_event_progress(_user_id uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
    BEGIN
      PERFORM public.assert_can_act_for(_user_id);
      RETURN public.update_event_progress_unchecked(_user_id);
    END;
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.update_event_progress(uuid) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.update_event_progress(uuid) TO authenticated;
  END IF;
END $mig$;

-- process_session_rewards ─ raidUtils.ts:46 ← TrainerClientDetail.tsx:499
-- ⚠️ この関数は**現時点で本番では動かない**（本体が参照する public.training_sessions が
--    存在せず 42P01 になる）。呼び出し側が GAMIFICATION_ENABLED=false ＋ try/catch
--    なので誰も気づいていなかった。ここでは権限だけ正し、本体には触らない。
DO $mig$
BEGIN
  IF to_regprocedure('public.process_session_rewards(uuid, date)') IS NOT NULL
     AND to_regprocedure('public.process_session_rewards_unchecked(uuid, date)') IS NULL THEN
    ALTER FUNCTION public.process_session_rewards(uuid, date) RENAME TO process_session_rewards_unchecked;
    REVOKE EXECUTE ON FUNCTION public.process_session_rewards_unchecked(uuid, date) FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.process_session_rewards(_user_id uuid, _workout_date date)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
    BEGIN
      PERFORM public.assert_can_act_for(_user_id);
      RETURN public.process_session_rewards_unchecked(_user_id, _workout_date);
    END;
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.process_session_rewards(uuid, date) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.process_session_rewards(uuid, date) TO authenticated;
  END IF;
END $mig$;

-- apply_raid_damage ─ raidUtils.ts:32 ← TrainerClientDetail.tsx:527
DO $mig$
BEGIN
  IF to_regprocedure('public.apply_raid_damage(uuid, date, integer)') IS NOT NULL
     AND to_regprocedure('public.apply_raid_damage_unchecked(uuid, date, integer)') IS NULL THEN
    ALTER FUNCTION public.apply_raid_damage(uuid, date, integer) RENAME TO apply_raid_damage_unchecked;
    REVOKE EXECUTE ON FUNCTION public.apply_raid_damage_unchecked(uuid, date, integer) FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.apply_raid_damage(_user_id uuid, _workout_date date, _damage integer)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
    BEGIN
      PERFORM public.assert_can_act_for(_user_id);
      RETURN public.apply_raid_damage_unchecked(_user_id, _workout_date, _damage);
    END;
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.apply_raid_damage(uuid, date, integer) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.apply_raid_damage(uuid, date, integer) TO authenticated;
  END IF;
END $mig$;

-- complete_quest_stage ─ 形1（NULL で素通り）。呼び出し元は0件
DO $mig$
BEGIN
  IF to_regprocedure('public.complete_quest_stage(uuid, integer)') IS NOT NULL
     AND to_regprocedure('public.complete_quest_stage_unchecked(uuid, integer)') IS NULL THEN
    ALTER FUNCTION public.complete_quest_stage(uuid, integer) RENAME TO complete_quest_stage_unchecked;
    REVOKE EXECUTE ON FUNCTION public.complete_quest_stage_unchecked(uuid, integer) FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.complete_quest_stage(p_user_id uuid, p_stage_id integer)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
    BEGIN
      PERFORM public.assert_can_act_for(p_user_id);
      RETURN public.complete_quest_stage_unchecked(p_user_id, p_stage_id);
    END;
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.complete_quest_stage(uuid, integer) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.complete_quest_stage(uuid, integer) TO authenticated;
  END IF;
END $mig$;

-- equip_item ─ 形1。呼び出し元は0件
DO $mig$
BEGIN
  IF to_regprocedure('public.equip_item(uuid, uuid)') IS NOT NULL
     AND to_regprocedure('public.equip_item_unchecked(uuid, uuid)') IS NULL THEN
    ALTER FUNCTION public.equip_item(uuid, uuid) RENAME TO equip_item_unchecked;
    REVOKE EXECUTE ON FUNCTION public.equip_item_unchecked(uuid, uuid) FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.equip_item(p_user_id uuid, p_item_id uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
    BEGIN
      PERFORM public.assert_can_act_for(p_user_id);
      RETURN public.equip_item_unchecked(p_user_id, p_item_id);
    END;
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.equip_item(uuid, uuid) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.equip_item(uuid, uuid) TO authenticated;
  END IF;
END $mig$;

-- get_quest_progress ─ 形1。呼び出し元は0件
DO $mig$
BEGIN
  IF to_regprocedure('public.get_quest_progress(uuid)') IS NOT NULL
     AND to_regprocedure('public.get_quest_progress_unchecked(uuid)') IS NULL THEN
    ALTER FUNCTION public.get_quest_progress(uuid) RENAME TO get_quest_progress_unchecked;
    REVOKE EXECUTE ON FUNCTION public.get_quest_progress_unchecked(uuid) FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.get_quest_progress(p_user_id uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
    BEGIN
      PERFORM public.assert_can_act_for(p_user_id);
      RETURN public.get_quest_progress_unchecked(p_user_id);
    END;
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.get_quest_progress(uuid) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.get_quest_progress(uuid) TO authenticated;
  END IF;
END $mig$;

-- execute_quest_battle ─ 形2（COALESCE(p_user_id, auth.uid())）。
-- 呼び出し元は workouts の AFTER トリガー trg_quest_battle_on_workout のみ。
-- そのトリガー関数は SECURITY DEFINER かつ EXCEPTION を握りつぶすので、
-- **ここで 42501 になってもトレーニングの保存は失敗しない**（実測で確認済み）。
DO $mig$
BEGIN
  IF to_regprocedure('public.execute_quest_battle(uuid, numeric)') IS NOT NULL
     AND to_regprocedure('public.execute_quest_battle_unchecked(uuid, numeric)') IS NULL THEN
    ALTER FUNCTION public.execute_quest_battle(uuid, numeric) RENAME TO execute_quest_battle_unchecked;
    REVOKE EXECUTE ON FUNCTION public.execute_quest_battle_unchecked(uuid, numeric) FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.execute_quest_battle(p_user_id uuid, p_session_volume numeric)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
    BEGIN
      PERFORM public.assert_can_act_for(p_user_id);
      RETURN public.execute_quest_battle_unchecked(p_user_id, p_session_volume);
    END;
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.execute_quest_battle(uuid, numeric) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.execute_quest_battle(uuid, numeric) TO authenticated;
  END IF;
END $mig$;

-- get_player_combat_stats ─ 形2。execute_quest_battle の中からも呼ばれる
DO $mig$
BEGIN
  IF to_regprocedure('public.get_player_combat_stats(uuid)') IS NOT NULL
     AND to_regprocedure('public.get_player_combat_stats_unchecked(uuid)') IS NULL THEN
    ALTER FUNCTION public.get_player_combat_stats(uuid) RENAME TO get_player_combat_stats_unchecked;
    REVOKE EXECUTE ON FUNCTION public.get_player_combat_stats_unchecked(uuid) FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.get_player_combat_stats(p_user_id uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
    BEGIN
      PERFORM public.assert_can_act_for(p_user_id);
      RETURN public.get_player_combat_stats_unchecked(p_user_id);
    END;
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.get_player_combat_stats(uuid) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.get_player_combat_stats(uuid) TO authenticated;
  END IF;
END $mig$;

-- spin_gacha ─ 形3（照合が無い）。呼び出し元は0件
DO $mig$
BEGIN
  IF to_regprocedure('public.spin_gacha(uuid, date)') IS NOT NULL
     AND to_regprocedure('public.spin_gacha_unchecked(uuid, date)') IS NULL THEN
    ALTER FUNCTION public.spin_gacha(uuid, date) RENAME TO spin_gacha_unchecked;
    REVOKE EXECUTE ON FUNCTION public.spin_gacha_unchecked(uuid, date) FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.spin_gacha(_user_id uuid, _result_date date)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
    BEGIN
      PERFORM public.assert_can_act_for(_user_id);
      RETURN public.spin_gacha_unchecked(_user_id, _result_date);
    END;
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.spin_gacha(uuid, date) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.spin_gacha(uuid, date) TO authenticated;
  END IF;
END $mig$;


-- ----------------------------------------------------------------------------
-- 4. 包まないが anon は剥がすもの
-- ----------------------------------------------------------------------------
-- remove_staff_member は自前で `auth.uid() IS NULL` を弾いており、実測でも
-- anon から呼ぶと「ログインが必要です」で落ちる。**それでも anon に残す理由が無い。**

DO $mig$
BEGIN
  IF to_regprocedure('public.remove_staff_member(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.remove_staff_member(uuid) FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.remove_staff_member(uuid) TO authenticated;
  END IF;
END $mig$;


-- ----------------------------------------------------------------------------
-- 5. 引数名は変えていない（変えるとクライアントが壊れる）
-- ----------------------------------------------------------------------------
-- PostgREST の RPC は **名前付き引数**で呼ぶ。
--
--   supabase.rpc("check_weight_milestones", { p_user_id: ... })   ← p_ 付き
--   supabase.rpc("apply_raid_damage",       { _user_id: ... })    ← _ 付き
--
-- **元の関数と同じ引数名にしてある。**揃えたくなっても揃えないこと
-- （`_user_id` に統一した瞬間に、p_ で呼んでいる2画面が 404 になる）。
