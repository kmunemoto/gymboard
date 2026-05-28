import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function maskEmail(email: string | null | undefined): string {
  if (!email) return "(no email)";
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SALUTE_SUPABASE_URL");
  const key = Deno.env.get("SALUTE_SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "Missing SALUTE_SUPABASE_URL or SALUTE_SUPABASE_SERVICE_ROLE_KEY" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const report: Record<string, unknown> = { salute_url: url };


  // 1. auth.users total
  try {
    let total = 0;
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      total += data.users.length;
      if (data.users.length < perPage) break;
      page++;
      if (page > 50) break;
    }
    report.auth_users_total = total;
  } catch (e) {
    report.auth_users_error = String(e);
  }

  // 2. Detect customer schema: try user_roles, then profiles.role
  const detection: Record<string, unknown> = {};

  // try user_roles
  const ur = await sb.from("user_roles").select("role", { count: "exact", head: false }).limit(1);
  detection.user_roles = ur.error ? { error: ur.error.message } : { ok: true, sample: ur.data };

  // try profiles
  const prof = await sb.from("profiles").select("*").limit(1);
  detection.profiles_sample_columns = prof.error
    ? { error: prof.error.message }
    : { columns: prof.data && prof.data[0] ? Object.keys(prof.data[0]) : [] };

  report.schema_detection = detection;

  // 3. Count customers — try multiple strategies
  let customerCount: number | null = null;
  let customerMethod = "";
  let sampleUserId: string | null = null;
  let sampleEmail: string | null = null;

  // Strategy A: user_roles where role='customer'
  if (!ur.error) {
    const { count, error } = await sb.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "customer");
    if (!error && count !== null) {
      customerCount = count;
      customerMethod = "user_roles.role='customer'";
      const { data: one } = await sb.from("user_roles").select("user_id").eq("role", "customer").limit(1).maybeSingle();
      if (one?.user_id) sampleUserId = one.user_id as string;
    }
  }

  // Strategy B: profiles.role
  if (customerCount === null && !prof.error) {
    const cols = prof.data && prof.data[0] ? Object.keys(prof.data[0]) : [];
    if (cols.includes("role")) {
      const { count } = await sb.from("profiles").select("user_id", { count: "exact", head: true }).eq("role", "customer");
      if (count !== null) {
        customerCount = count;
        customerMethod = "profiles.role='customer'";
        const { data: one } = await sb.from("profiles").select("user_id, id").eq("role", "customer").limit(1).maybeSingle();
        sampleUserId = (one as any)?.user_id ?? (one as any)?.id ?? null;
      }
    }
  }

  report.customer_count = customerCount;
  report.customer_method = customerMethod || "(not detected)";

  // Fetch sample email from auth.users
  if (sampleUserId) {
    const { data, error } = await sb.auth.admin.getUserById(sampleUserId);
    if (!error && data?.user) {
      sampleEmail = data.user.email ?? null;
      report.sample = {
        user_id: data.user.id,
        email_masked: maskEmail(sampleEmail),
      };
    } else if (error) {
      report.sample_error = error.message;
    }
  }

  return new Response(JSON.stringify(report, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
