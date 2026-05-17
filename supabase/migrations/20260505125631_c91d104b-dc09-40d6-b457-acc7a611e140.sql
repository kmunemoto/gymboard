-- Merge 臀部 into 脚, and split 腕 into 二頭筋 / 三頭筋 in muscle_group
UPDATE public.exercises SET muscle_group = '脚' WHERE muscle_group = '臀部';
UPDATE public.exercises SET muscle_group = '二頭筋' WHERE muscle_group = '腕' AND category = '上腕二頭筋';
UPDATE public.exercises SET muscle_group = '三頭筋' WHERE muscle_group = '腕' AND category = '上腕三頭筋';
-- Any remaining 腕 (without二頭/三頭 category) → default to 二頭筋
UPDATE public.exercises SET muscle_group = '二頭筋' WHERE muscle_group = '腕';