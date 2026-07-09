
-- Set long cache-control on the new logo so Cloudflare/browsers cache it
UPDATE storage.objects
SET metadata = jsonb_set(metadata, '{cacheControl}', '"max-age=31536000, immutable"')
WHERE bucket_id='avatars' AND name='tenant-logos/salute-gosho-minami-2026-07-09.webp';

-- Point the tenant at the new optimized WebP logo
UPDATE public.tenants
SET logo_url='https://rrbfwitprzuevzytykrq.supabase.co/storage/v1/object/public/avatars/tenant-logos/salute-gosho-minami-2026-07-09.webp'
WHERE id='ceda19b0-d5e0-4928-ab2e-996a0b823af4';
