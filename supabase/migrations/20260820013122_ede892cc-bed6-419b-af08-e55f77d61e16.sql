CREATE OR REPLACE FUNCTION _probe_deploy() RETURNS TABLE(name text, status_code integer, content text) LANGUAGE plpgsql AS $$
DECLARE
  id1 bigint;
  id2 bigint;
BEGIN
  id1 := net.http_post(
    url := 'https://rrbfwitprzuevzytykrq.supabase.co/functions/v1/send-transactional-email',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  id2 := net.http_post(
    url := 'https://rrbfwitprzuevzytykrq.supabase.co/functions/v1/auth-email-hook',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  PERFORM pg_sleep(2);
  RETURN QUERY SELECT 'send-transactional-email'::text, r.status_code, left(r.content,200) FROM net._http_response r WHERE r.id = id1;
  RETURN QUERY SELECT 'auth-email-hook'::text, r.status_code, left(r.content,200) FROM net._http_response r WHERE r.id = id2;
END;
$$;
SELECT * FROM _probe_deploy();
DROP FUNCTION _probe_deploy();