// 顧客の一括登録（CSV）— アカウントを作って在籍させるところ。
//
// ## なぜ Edge Function なのか
//
// 取り込む顧客には**ログイン手段を持たない auth のアカウント**を1件ずつ作る。
// auth.users を作れるのは service_role の admin API だけなので、SQL からはできない。
//
// アカウントを作る理由は migration（20260825010000_customer_import.sql）の冒頭に書いた。
// 要点だけ言うと、顧客一覧の起点が tenant_members（user_id NOT NULL・FK → auth.users）で、
// 予約のトリガも user_roles（同じく FK）に書くため、実体の無い顧客は
// 一覧にも出ないし予約も入れられないから。
//
// ⚠️ ここで作るアカウントは**誰にも通知しない**。メールアドレスは配達できない
//    プレースホルダで、パスワードもソーシャル連携も無い＝ログインできない。
//    店が「招待する」を押したときに初めて本人のアドレスを設定して招待を送る。
//
// ## 権限
//
// 🔴 hasRole('trainer') で判定しない。trainer は自由登録で取れるテナント横断の
//    グローバル権限なので、それを根拠にすると他ジムに顧客を作れてしまう
//    （signup-trainer/index.ts の注意書き・mem/ops/tenant-boundary.md）。
//    tenant_members に「そのテナントの owner として在籍している」ことを見る。
//
// オーナー限定にしているのは、画面が「データ」カテゴリ（オーナー限定）の中にあるのと、
// 一括登録が有料プランの席を大量に消費する操作だから。スタッフにも開くなら、
// 画面の出し分けとここの両方を同時に変えること（片方だけだと 403 になる）。

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * 1回の呼び出しで扱う上限。
 * アカウント作成は1件ずつ admin API を叩くので、多すぎると関数の実行時間に当たる。
 * 呼び出し側（画面）が分割して繰り返し呼び、進み具合を出す。
 */
const MAX_ROWS = 100;

/** 同時に作る数。上げすぎると auth 側で詰まる。 */
const CONCURRENCY = 8;

interface ImportRowInput {
  display_name?: string;
  name_kana?: string | null;
  phone?: string | null;
  plan?: string | null;
  status?: string | null;
  joined_at?: string | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 失敗したときに片付けるため、作ったアカウントを覚えておく
  const created: string[] = [];

  try {
    const caller = await verifyCaller(req);
    if (!caller?.userId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    const tenantId: string | undefined = body?.tenant_id;
    const rows: ImportRowInput[] = Array.isArray(body?.rows) ? body.rows : [];

    if (!tenantId) return json({ error: "tenant_required" }, 400);
    if (rows.length === 0) return json({ error: "rows_required" }, 400);
    if (rows.length > MAX_ROWS) return json({ error: "too_many_rows", max: MAX_ROWS }, 400);

    // 🔴 そのテナントの owner として在籍しているか。
    //    グローバルな trainer ロールでは判定しない
    const { data: membership, error: mErr } = await admin
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", caller.userId)
      .eq("status", "active")
      .eq("role", "owner")
      .maybeSingle();
    if (mErr) {
      console.error("import-customers: membership lookup failed", mErr);
      return json({ error: "membership_lookup_failed" }, 500);
    }
    if (!membership) return json({ error: "Forbidden" }, 403);

    // 1) アカウントを作る（配達できないアドレス・パスワード無し＝ログインできない）
    const prepared: (ImportRowInput & { user_id: string })[] = new Array(rows.length);

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const slice = rows.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (row, k) => {
          const { data, error } = await admin.auth.admin.createUser({
            email: `csv-import+${crypto.randomUUID()}@gymboard.invalid`,
            email_confirm: false,
            user_metadata: { imported: true, tenant_id: tenantId },
          });
          if (error || !data?.user) throw new Error(error?.message ?? "createUser failed");
          return { index: i + k, row, userId: data.user.id };
        }),
      );
      for (const r of results) {
        created.push(r.userId);
        prepared[r.index] = { ...r.row, user_id: r.userId };
      }
    }

    // 2) 在籍・人の情報をまとめて入れる。**途中で失敗したら1件も入らない**
    const { data: count, error: rpcErr } = await admin.rpc("import_customers", {
      _tenant_id: tenantId,
      _rows: prepared,
    });

    if (rpcErr) {
      console.error("import-customers: import_customers failed", rpcErr);
      await cleanUp(admin, created);
      // 人数上限（check_violation）の文言はそのまま店に見せたい
      return json({ error: "import_failed", detail: rpcErr.message }, 400);
    }

    return json({ imported: count ?? prepared.length });
  } catch (e) {
    console.error("import-customers: unexpected", e);
    await cleanUp(admin, created);
    return json({ error: "unexpected", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/**
 * 途中で失敗したときに、作ってしまったアカウントを消す。
 *
 * ⚠️ ここが漏れると、どのテナントにも属さない幽霊アカウントが auth に溜まる。
 *    消せなかったものはログに残す（消せないこと自体で取り込みを失敗にはしない）。
 */
async function cleanUp(
  admin: ReturnType<typeof createClient>,
  userIds: readonly string[],
): Promise<void> {
  for (const id of userIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error("import-customers: failed to clean up user", id, error.message);
  }
}
