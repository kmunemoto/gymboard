import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/migrate-period-data`
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dry_run: false }),
  })
  const text = await res.text()
  return new Response(text, {
    status: res.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
