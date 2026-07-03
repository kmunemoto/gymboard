// Throwaway admin proxy: invokes migrate-period-data with the project's service_role key.
// Protected by CRON_SECRET header to avoid abuse. Delete after use.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  const provided = req.headers.get("x-cron-secret") ?? "";
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401 });
  }
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/migrate-period-data`;
  const body = await req.text();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: body || "{}",
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
});
