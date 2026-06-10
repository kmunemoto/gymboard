// GymBoard 側: 試験移行で部分失敗したお客様を完全削除するワンオフ関数。
// service_role で auth.users と関連テーブルを順に削除する。
// Body: { "email": "hiroko_kawai0126@icloud.com" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";

function json(b: unknown, s: number) {
  return new Response(JSON.stringify(b, null, 2), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const email: string | undefined = body?.email;
    if (!email) return json({ ok: false, error: "email required" }, 400);

    // 1. migration_user_map から gymboard_user_id を取得 (email でも可)
    const { data: mapRow } = await admin
      .from("migration_user_map")
      .select("gymboard_user_id, salute_user_id")
      .eq("email", email)
      .eq("tenant_id", TENANT_ID)
      .maybeSingle();

    let userId = mapRow?.gymboard_user_id ?? null;

    // 2. auth.users から email で検索 (map に無くても削除できるように)
    let authUserId: string | null = null;
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const u = listed.data?.users?.find(
      (x) => (x.email ?? "").toLowerCase() === email.toLowerCase(),
    );
    if (u) authUserId = u.id;
    if (!userId && authUserId) userId = authUserId;

    if (!userId) {
      return json({ ok: true, email, note: "no records found for this email" }, 200);
    }

    const counts = async () => ({
      workouts: (await admin.from("workouts").select("id", { count: "exact", head: true }).eq("user_id", userId!)).count ?? 0,
      bookings: (await admin.from("bookings").select("id", { count: "exact", head: true }).eq("user_id", userId!)).count ?? 0,
      tenant_members: (await admin.from("tenant_members").select("id", { count: "exact", head: true }).eq("user_id", userId!)).count ?? 0,
      user_roles: (await admin.from("user_roles").select("id", { count: "exact", head: true }).eq("user_id", userId!)).count ?? 0,
      profiles: (await admin.from("profiles").select("id", { count: "exact", head: true }).eq("user_id", userId!)).count ?? 0,
      migration_user_map: (await admin.from("migration_user_map").select("id", { count: "exact", head: true }).eq("gymboard_user_id", userId!)).count ?? 0,
      auth_users: authUserId ? 1 : 0,
    });

    const before = await counts();

    // 3. 関連データ削除 (FK CASCADE があるテーブルもあるが明示削除)
    const errors: string[] = [];
    const del = async (table: string, col: string) => {
      const { error } = await admin.from(table).delete().eq(col, userId);
      if (error) errors.push(`${table}: ${error.message}`);
    };
    await del("workouts", "user_id");
    await del("bookings", "user_id");
    await del("tenant_members", "user_id");
    await del("user_roles", "user_id");
    await del("profiles", "user_id");
    await admin.from("migration_user_map").delete().eq("gymboard_user_id", userId);

    // 4. auth.users 削除
    let authDeleted = false;
    if (authUserId) {
      const r = await admin.auth.admin.deleteUser(authUserId);
      if (r.error) errors.push(`auth.users: ${r.error.message}`);
      else authDeleted = true;
    }

    const after = await counts();

    return json({
      ok: errors.length === 0,
      email,
      gymboard_user_id: userId,
      salute_user_id: mapRow?.salute_user_id ?? null,
      before,
      after,
      auth_deleted: authDeleted,
      errors,
    }, 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
