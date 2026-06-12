// Shared helpers for verifying caller identity in edge functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export interface CallerIdentity {
  userId: string | null;
  isServiceRole: boolean;
  email?: string | null;
}

/**
 * Verify the Authorization header. Returns:
 *  - { isServiceRole: true } if the bearer token equals the project's SUPABASE_SERVICE_ROLE_KEY
 *  - { userId } if it's a valid user JWT
 *  - null if the header is missing or invalid
 */
export async function verifyCaller(req: Request): Promise<CallerIdentity | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (token === serviceKey) {
    return { userId: null, isServiceRole: true };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  if (!anonKey) return null;

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return { userId: data.user.id, isServiceRole: false };
}

export async function hasRole(userId: string, role: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);
  const { data } = await admin.rpc("has_role", { _user_id: userId, _role: role });
  return !!data;
}
