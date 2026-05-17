ALTER TABLE public.quest_battle_logs REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.quest_battle_logs;