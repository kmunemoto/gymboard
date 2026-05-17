ALTER TABLE public.quest_bosses ADD COLUMN IF NOT EXISTS boss_image_url text;
ALTER TABLE public.quest_stages ADD COLUMN IF NOT EXISTS background_image_url text;

UPDATE public.quest_stages SET background_image_url = '/quest/bg-stage1.png' WHERE stage_number = 1;
UPDATE public.quest_stages SET background_image_url = '/quest/bg-stage2.png' WHERE stage_number = 2;
UPDATE public.quest_stages SET background_image_url = '/quest/bg-stage3.png' WHERE stage_number = 3;

UPDATE public.quest_bosses SET boss_image_url = '/quest/boss-stage1.png' WHERE stage_id = 1;
UPDATE public.quest_bosses SET boss_image_url = '/quest/boss-stage2.png' WHERE stage_id = 2;
UPDATE public.quest_bosses SET boss_image_url = '/quest/boss-stage3.png' WHERE stage_id = 3;