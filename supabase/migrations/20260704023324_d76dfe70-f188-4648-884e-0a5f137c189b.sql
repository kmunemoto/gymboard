ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS grace_enabled boolean;
COMMENT ON COLUMN public.profiles.grace_enabled IS 'プランの猶予日数（grace_days）をこのお客様に適用するか。null/true=適用（既定）、false=適用しない（期限どおり）。';