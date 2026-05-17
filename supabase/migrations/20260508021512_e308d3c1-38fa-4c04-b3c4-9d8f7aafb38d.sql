
DO $$
DECLARE
  u record;
  v_total_sessions int;
  v_max_day_vol numeric;
  v_max_month_vol numeric;
  v_distinct_ex int;
  v_pb_count int;
  v_max_groups int;
  v_avatar record;
  v_gacha_count int;
  v_event_count int;
  v_raid_count int;
  v_has_photo boolean;
  v_combo5 int;
  v_max_combo int;
  v_lvl int;
  v_total_coins int;
BEGIN
  FOR u IN SELECT DISTINCT user_id FROM workouts LOOP
    -- total sessions (distinct dates)
    SELECT COUNT(DISTINCT workout_date) INTO v_total_sessions FROM workouts WHERE user_id = u.user_id;

    -- max day volume
    SELECT COALESCE(MAX(day_vol), 0) INTO v_max_day_vol FROM (
      SELECT workout_date, SUM(
        CASE WHEN sets IS NOT NULL THEN (
          SELECT COALESCE(SUM((s->>'weight')::numeric * (s->>'reps')::numeric),0)
          FROM jsonb_array_elements(sets) s
        ) ELSE COALESCE(weight,0)*COALESCE(reps,0) END
      ) AS day_vol
      FROM workouts WHERE user_id = u.user_id
      GROUP BY workout_date
    ) t;

    -- max month volume
    SELECT COALESCE(MAX(m_vol),0) INTO v_max_month_vol FROM (
      SELECT to_char(workout_date,'YYYY-MM') AS m, SUM(
        CASE WHEN sets IS NOT NULL THEN (
          SELECT COALESCE(SUM((s->>'weight')::numeric * (s->>'reps')::numeric),0)
          FROM jsonb_array_elements(sets) s
        ) ELSE COALESCE(weight,0)*COALESCE(reps,0) END
      ) AS m_vol
      FROM workouts WHERE user_id = u.user_id
      GROUP BY to_char(workout_date,'YYYY-MM')
    ) t;

    -- distinct exercises
    SELECT COUNT(DISTINCT exercise_id) INTO v_distinct_ex FROM workouts WHERE user_id = u.user_id;

    -- max muscle groups in any month
    SELECT COALESCE(MAX(g),0) INTO v_max_groups FROM (
      SELECT to_char(w.workout_date,'YYYY-MM') AS m, COUNT(DISTINCT e.muscle_group) AS g
      FROM workouts w LEFT JOIN exercises e ON e.id = w.exercise_id
      WHERE w.user_id = u.user_id
      GROUP BY to_char(w.workout_date,'YYYY-MM')
    ) t;

    -- PB count (approx: count of (exercise, date) where new max weight)
    WITH per AS (
      SELECT w.exercise_id, w.workout_date,
        GREATEST(
          COALESCE(w.weight,0),
          COALESCE((SELECT MAX((s->>'weight')::numeric) FROM jsonb_array_elements(w.sets) s), 0)
        ) AS max_w
      FROM workouts w WHERE w.user_id = u.user_id
    ), running AS (
      SELECT exercise_id, workout_date, max_w,
        MAX(max_w) OVER (PARTITION BY exercise_id ORDER BY workout_date ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max
      FROM per
    )
    SELECT COUNT(*) INTO v_pb_count FROM running WHERE max_w > 0 AND prev_max IS NOT NULL AND max_w > prev_max;

    -- avatar info
    SELECT level, COALESCE(max_combo_reached,0) AS mc, COALESCE(combo_5_count,0) AS c5, COALESCE(coins,0) AS co
      INTO v_avatar FROM user_avatars WHERE user_id = u.user_id;
    v_lvl := COALESCE(v_avatar.level, 1);
    v_max_combo := COALESCE(v_avatar.mc, 0);
    v_combo5 := COALESCE(v_avatar.c5, 0);
    v_total_coins := COALESCE(v_avatar.co, 0);

    SELECT COUNT(*) INTO v_gacha_count FROM gacha_results WHERE user_id = u.user_id;
    SELECT COUNT(*) INTO v_event_count FROM user_event_completion WHERE user_id = u.user_id;
    SELECT COUNT(DISTINCT raid_id) INTO v_raid_count FROM raid_damage_logs WHERE user_id = u.user_id;
    SELECT EXISTS(SELECT 1 FROM progress_photos WHERE user_id = u.user_id) INTO v_has_photo;

    -- Insert achievements
    INSERT INTO avatar_achievements (user_id, achievement_key)
    SELECT u.user_id, k FROM (VALUES
      ('first_step'),('first_session')
    ) AS x(k) WHERE v_total_sessions >= 1
    ON CONFLICT DO NOTHING;

    IF v_total_sessions >= 10 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'regular_visitor') ON CONFLICT DO NOTHING; END IF;
    IF v_total_sessions >= 50 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'fifty_sessions') ON CONFLICT DO NOTHING; END IF;
    IF v_total_sessions >= 100 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'hundred_sessions') ON CONFLICT DO NOTHING; END IF;
    IF v_total_sessions >= 200 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'two_hundred_sessions') ON CONFLICT DO NOTHING; END IF;

    IF v_max_day_vol >= 1000 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'ton_club') ON CONFLICT DO NOTHING; END IF;
    IF v_max_day_vol >= 10000 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'ten_ton_club') ON CONFLICT DO NOTHING; END IF;

    IF v_max_month_vol >= 50000 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'month_50k') ON CONFLICT DO NOTHING; END IF;
    IF v_max_month_vol >= 200000 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'month_200k') ON CONFLICT DO NOTHING; END IF;

    IF v_distinct_ex >= 5 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'multiplayer') ON CONFLICT DO NOTHING; END IF;

    IF v_max_groups >= 5 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'balance_master') ON CONFLICT DO NOTHING; END IF;
    IF v_max_groups >= 7 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'all_rounder') ON CONFLICT DO NOTHING; END IF;

    IF v_pb_count >= 1 THEN
      INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'power_up') ON CONFLICT DO NOTHING;
      INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'first_pb') ON CONFLICT DO NOTHING;
    END IF;
    IF v_pb_count >= 10 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'best_hunter') ON CONFLICT DO NOTHING; END IF;
    IF v_pb_count >= 30 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'record_breaker') ON CONFLICT DO NOTHING; END IF;

    IF v_lvl >= 10 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'level_10') ON CONFLICT DO NOTHING; END IF;
    IF v_lvl >= 25 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'level_25') ON CONFLICT DO NOTHING; END IF;
    IF v_lvl >= 50 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'level_50') ON CONFLICT DO NOTHING; END IF;

    IF v_max_combo >= 3 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'combo_starter') ON CONFLICT DO NOTHING; END IF;
    IF v_max_combo >= 10 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'combo_king') ON CONFLICT DO NOTHING; END IF;
    IF v_combo5 >= 3 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'combo_master_ach') ON CONFLICT DO NOTHING; END IF;

    IF v_total_coins >= 500 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'coin_collector') ON CONFLICT DO NOTHING; END IF;

    IF v_gacha_count >= 1 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'gacha_beginner') ON CONFLICT DO NOTHING; END IF;
    IF v_gacha_count >= 30 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'gacha_addict') ON CONFLICT DO NOTHING; END IF;
    IF EXISTS(SELECT 1 FROM gacha_results WHERE user_id = u.user_id AND rarity IN ('epic','legendary')) THEN
      INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'gacha_lucky') ON CONFLICT DO NOTHING;
    END IF;
    IF EXISTS(SELECT 1 FROM gacha_results WHERE user_id = u.user_id AND rarity = 'legendary') THEN
      INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'gacha_legend') ON CONFLICT DO NOTHING;
    END IF;

    IF v_event_count >= 1 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'first_event') ON CONFLICT DO NOTHING; END IF;
    IF v_event_count >= 3 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'event_master') ON CONFLICT DO NOTHING; END IF;

    IF v_raid_count >= 1 THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'first_raid') ON CONFLICT DO NOTHING; END IF;

    IF v_has_photo THEN INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'first_shot') ON CONFLICT DO NOTHING; END IF;

    -- Mission related
    IF EXISTS(SELECT 1 FROM daily_missions WHERE user_id = u.user_id AND COALESCE(array_length(completed_keys,1),0) >= 1) THEN
      INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'mission_clear') ON CONFLICT DO NOTHING;
    END IF;
    IF (SELECT COALESCE(SUM(COALESCE(array_length(completed_keys,1),0)),0) FROM daily_missions WHERE user_id = u.user_id) >= 30 THEN
      INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'mission_master') ON CONFLICT DO NOTHING;
    END IF;
    IF EXISTS(SELECT 1 FROM daily_missions WHERE user_id = u.user_id AND all_completed = true) THEN
      INSERT INTO avatar_achievements (user_id, achievement_key) VALUES (u.user_id,'perfect_day') ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;
