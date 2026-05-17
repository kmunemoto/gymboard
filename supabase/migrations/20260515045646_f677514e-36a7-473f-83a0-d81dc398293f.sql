ALTER TABLE public.raid_bosses ADD COLUMN IF NOT EXISTS boss_video_url text;

UPDATE public.raid_bosses SET boss_video_url = 'https://clsvdhovzqrkojvkvekw.supabase.co/storage/v1/object/public/avatars/raid/goblin_idle.mp4'
WHERE boss_name ILIKE '%ゴブリン%' OR boss_name ILIKE '%goblin%';

UPDATE public.raid_bosses SET boss_video_url = 'https://clsvdhovzqrkojvkvekw.supabase.co/storage/v1/object/public/avatars/raid/orc_idle.mp4'
WHERE boss_name ILIKE '%オーク%' OR boss_name ILIKE '%orc%';

UPDATE public.raid_bosses SET boss_video_url = 'https://clsvdhovzqrkojvkvekw.supabase.co/storage/v1/object/public/avatars/raid/dragon_idle.mp4'
WHERE boss_name ILIKE '%ドラゴン%' OR boss_name ILIKE '%dragon%';