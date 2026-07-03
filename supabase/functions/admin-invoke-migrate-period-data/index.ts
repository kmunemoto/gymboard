// Throwaway admin proxy — will be deleted immediately after use.
Deno.serve(async (req) => {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/migrate-period-data`;
  const body = req.method === "POST" ? await req.text() : "{}";
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
