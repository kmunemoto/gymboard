// Read-only connectivity check for the Salute source Supabase project.
// This function performs SELECT count(*) queries only. It does NOT create,
// update, or delete any data — in either the source (Salute) or destination
// (GymBoard) projects.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SALUTE_URL = Deno.env.get("SALUTE_SUPABASE_URL");
    const SALUTE_KEY = Deno.env.get("SALUTE_SUPABASE_SERVICE_ROLE_KEY");

    if (!SALUTE_URL || !SALUTE_KEY) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Missing SALUTE_SUPABASE_URL or SALUTE_SUPABASE_SERVICE_ROLE_KEY",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const salute = createClient(SALUTE_URL, SALUTE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Read-only counts.
    const countOf = async (
      table: string,
      filter?: (q: ReturnType<typeof salute.from>) => any,
    ) => {
      let q: any = salute.from(table).select("*", { count: "exact", head: true });
      if (filter) q = filter(q);
      const { count, error } = await q;
      if (error) return { count: null, error: error.message };
      return { count, error: null };
    };

    const [
      profilesTotal,
      profilesCustomers,
      profilesTrainers,
      bookings,
      workouts,
      tenants,
      tenantMembers,
    ] = await Promise.all([
      countOf("profiles"),
      countOf("profiles", (q) => q.eq("role", "customer")),
      countOf("profiles", (q) => q.eq("role", "trainer")),
      countOf("bookings"),
      countOf("workouts"),
      countOf("tenants"),
      countOf("tenant_members"),
    ]);

    return new Response(
      JSON.stringify({
        ok: true,
        connected_to: SALUTE_URL,
        readonly: true,
        counts: {
          profiles_total: profilesTotal,
          profiles_customers: profilesCustomers,
          profiles_trainers: profilesTrainers,
          bookings,
          workouts,
          tenants,
          tenant_members: tenantMembers,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
