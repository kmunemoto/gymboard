// GymBoard 側: Salute プロジェクトの salute-export-counts を共有シークレットで呼び出し、
// 件数のみを取得して返す接続確認用関数。読み取りのみで、GymBoard 自身のDBにも
// Salute のDBにも一切書き込みを行わない。
//
// 必要な Secrets:
//   - MIGRATION_SHARED_SECRET: Salute 側と同一の合言葉
//   - SALUTE_EXPORT_URL: https://gvgrqaigffxtkvckjfur.supabase.co/functions/v1/salute-export-counts

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SALUTE_EXPORT_URL = Deno.env.get("SALUTE_EXPORT_URL");
    const SHARED_SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");

    if (!SALUTE_EXPORT_URL || !SHARED_SECRET) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Missing SALUTE_EXPORT_URL or MIGRATION_SHARED_SECRET",
          hint: "Configure both secrets in Cloud → Secrets.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const upstream = await fetch(SALUTE_EXPORT_URL, {
      method: "GET",
      headers: {
        "x-migration-secret": SHARED_SECRET,
        "Content-Type": "application/json",
      },
    });

    const text = await upstream.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    return new Response(
      JSON.stringify({
        ok: upstream.ok,
        readonly: true,
        gymboard_called: SALUTE_EXPORT_URL,
        upstream_status: upstream.status,
        upstream_response: parsed,
      }),
      {
        status: upstream.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
