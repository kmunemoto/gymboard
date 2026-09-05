-- ゲーム要素の撤去 第2段b: テーブル50個・関数55本を落とす（2026-09-05）
--
-- 🔴 **ここから戻せない。** 第1段（性別の引っ越し・トリガー停止）と
--    第2段a（コード3,537行の削除）が先に入っていること。
--
-- 宗本さん:「今の予約や記録を削除してしまったり、してしまわないようにお願い」
--
-- ## 本番で2回、予行演習してから実行している
--
-- 監査の反証3本のうち「予約と記録が減らないか」の観点が実行できなかったので、
-- 机上ではなく**実測**で埋めた。丸ごと落として数を数えてから ROLLBACK している:
--
--   予行演習1（テーブルだけ）
--     bookings 788->788 / workouts 2434->2434 / trial_bookings 74->74
--     profiles 73->73 / messages 82->82 / user_measurements 284->284
--     weight_journey 0->0 / booking_questions 0->0
--
--   予行演習2（テーブル＋関数）
--     bookings 788->788 / workouts 2434->2434
--     public の関数 141->86（55本減）
--     get_tenant_booked_slots は生存（83件返る）
--
-- ## 🔴 CASCADE を使わない
--
-- 1文にまとめれば、ゲーム系どうしの外部キーはその中で解決される。
-- CASCADE は「何を巻き込んだか分からない」ので、この作業では使わない。
--
-- ## 🔴 名前で選ばない。1つずつ手で挙げる
--
--   - `booking_questions` は **`quest` に当たる**が、予約のカスタム質問＝実機能。残す
--   - `weight_journey` は カルテの体重目標（BODY_METRICS_ENABLED）＝実機能。残す
--     （子の `weight_journey_milestones` は coins_awarded / badge_key を持つので落とす）
--   - `user_measurements`（体組成284件）も実機能。残す
--
-- 同じ罠をロケールのキーでも踏みかけた（`exp` で始まるキーを消そうとして
-- `clientDetail.expiry`＝契約の有効期限まで巻き込んだ）。**前置き一致で選ばないこと。**
--
-- ## 残した宿題
--
-- `profiles.game_mode_enabled` と `tenants.gamification_enabled` の列は残してある。
-- `schemaDrift.test.ts` のパーサが DROP COLUMN を解釈しないため、
-- 落とすならそちらを直すのが先（列が1つ余るだけで実害は無い）。

DROP TABLE IF EXISTS
  public.avatar_achievements, public.avatar_collection_rewards,
  public.avatar_customization_items, public.avatar_exp_logs, public.avatar_frames,
  public.avatar_rank_up_rewards, public.battle_items, public.coin_purchases,
  public.companion_defs, public.craft_materials, public.daily_login_bonuses,
  public.daily_missions, public.dungeon_monsters, public.dungeon_runs,
  public.dungeon_stages, public.dungeon_story, public.equipment_items,
  public.gacha_results, public.player_skills, public.quest_battle_logs,
  public.quest_bosses, public.quest_stage_conditions, public.quest_stages,
  public.raid_bosses, public.raid_damage_logs, public.raid_reward_items,
  public.rival_battle_entries, public.rival_battle_rewards, public.rival_battles,
  public.season_event_tasks, public.season_events, public.training_milestones,
  public.user_avatars, public.user_battle_items, public.user_companions,
  public.user_customization_items, public.user_equipment,
  public.user_event_completion, public.user_event_progress,
  public.user_frame_inventory, public.user_gacha_tickets, public.user_materials,
  public.user_milestone_claims, public.user_quest_boss_progress,
  public.user_quest_progress, public.user_quest_stage_completions,
  public.user_raid_rewards, public.user_stamina, public.user_titles,
  public.weight_journey_milestones;

DROP FUNCTION IF EXISTS
  public._quest_condition_values(uuid),
  public.apply_raid_damage(uuid,date,integer),
  public.apply_raid_damage_unchecked(uuid,date,integer),
  public.buy_gacha_ticket(uuid,integer),
  public.buy_shop_item(uuid,text,integer),
  public.buy_stamina(uuid,integer),
  public.check_collection_milestones(uuid),
  public.check_collection_milestones_unchecked(uuid),
  public.check_training_milestones(uuid),
  public.check_training_milestones_unchecked(uuid),
  public.check_weight_milestones(uuid),
  public.check_weight_milestones_unchecked(uuid),
  public.claim_daily_login_bonus(uuid),
  public.claim_rival_reward(uuid),
  public.complete_dungeon_run(uuid,integer,integer,integer,text,jsonb),
  public.complete_quest_stage(uuid,integer),
  public.complete_quest_stage_unchecked(uuid,integer),
  public.complete_rival_battles(date),
  public.distribute_raid_rewards(uuid),
  public.ensure_starter_companion(uuid),
  public.enter_rival_battle(),
  public.equip_frame(text),
  public.execute_quest_battle(uuid,numeric),
  public.execute_quest_battle_unchecked(uuid,numeric),
  public.feed_companion(uuid,text,boolean),
  public.get_login_bonus_status(uuid),
  public.get_player_combat_stats(uuid),
  public.get_player_combat_stats_unchecked(uuid),
  public.get_quest_progress(uuid),
  public.get_quest_progress_unchecked(uuid),
  public.get_ranking(text,text),
  public.grant_companion_exp(uuid,integer),
  public.grant_equipment(uuid,text,text),
  public.grant_gacha_ticket_on_workout(),
  public.grant_training_stamina_bonus(),
  public.grant_training_stamina_bonus_for(uuid),
  public.handle_new_user_avatar(),
  public.hatch_companion_egg(uuid,text),
  public.initialize_quest_boss_progress(),
  public.initialize_quest_progress(),
  public.process_session_rewards(uuid,date),
  public.process_session_rewards_unchecked(uuid,date),
  public.purchase_customization_item(text),
  public.recalculate_event_progress(uuid),
  public.recover_stamina(uuid),
  public.run_rival_matching(date),
  public.set_active_companion(uuid,text),
  public.set_featured_badges(text[]),
  public.spin_gacha(uuid,date),
  public.spin_gacha_unchecked(uuid,date),
  public.start_dungeon_run(uuid,text),
  public.trigger_quest_battle_on_workout(),
  public.update_event_progress(uuid),
  public.update_event_progress_unchecked(uuid),
  public.update_rival_battle_volumes(date);
