const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s: number) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");
    const SALUTE = Deno.env.get("SALUTE_SUPABASE_URL");
    if (!SECRET || !SALUTE) return json({ ok: false, error: "env missing" }, 500);

    const { booking_date, guest_name } = await req.json().catch(() => ({}));
    if (!booking_date || !guest_name) return json({ ok: false, error: "booking_date and guest_name required" }, 400);

    const res = await fetch(`${SALUTE.replace(/\/$/, "")}/functions/v1/sync-trial-booking-from-gymboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-migration-secret": SECRET },
      body: JSON.stringify({ booking_date, guest_name, action: "cancel" }),
    });

    console.log(`[trial-cancel-relay] salute status=${res.status} body=${(await res.text()).slice(0,200)}`);
    return json({ ok: res.ok, salute_status: res.status }, 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
