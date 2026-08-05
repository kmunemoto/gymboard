const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCaller } from "../_shared/auth.ts";

const LINE_API = "https://api.line.me/v2/bot/message/push";
const MAX_MESSAGE_LEN = 2000;

// ============================================================
// 宛先の権限判定
// ============================================================
//
// ⚠️ **`hasRole(userId, "trainer")` を認可に使わないこと。**
//
// `user_roles` には tenant_id が無く、しかも `trainer` は新規登録画面から
// **誰でも自分で取れる**（自由登録は意図的に開けてある）。つまり
// 「トレーナーである」は権限の根拠にならない。トレーナーとして登録するだけで、
// 他ジムのお客様に任意の文面のLINEを送れてしまう。
//
// 同じ形の穴を send-push-notification（PR #246）と
// send-transactional-email（PR #257）で塞いだ。ここが最後の1つ。
//
// ⚠️ `get_my_tenant_id()` / `shares_tenant_with_me()` も使わないこと。
// どちらも `auth.uid()` 依存なので、service_role のクライアントから呼ぶと
// **エラー無しで NULL / false を返す**。`null === null` で素通りする。
// `tenant_members` を直接引く。

/** そのユーザーが所属している（active な）テナントIDの集合 */
async function tenantIdsOf(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await admin
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  const out = new Set<string>();
  for (const row of (data ?? []) as { tenant_id: string | null }[]) {
    // tenant_id が NULL の行を入れると「NULL 同士が一致した」判定を作ってしまう
    if (row.tenant_id) out.add(row.tenant_id);
  }
  return out;
}

/** 同じテナントに属しているか。**判定できなければ false（fail-close）** */
async function sharesTenant(
  admin: ReturnType<typeof createClient>,
  a: string,
  b: string,
): Promise<boolean> {
  const [mine, theirs] = await Promise.all([tenantIdsOf(admin, a), tenantIdsOf(admin, b)]);
  for (const t of mine) {
    if (theirs.has(t)) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---- AUTH: any authenticated user OR service role ----
    const caller = await verifyCaller(req);
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "LINE_CHANNEL_ACCESS_TOKEN not set" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id, line_user_id, to, message } = await req.json();

    if (typeof message !== "string" || message.length === 0 || message.length > MAX_MESSAGE_LEN) {
      return new Response(JSON.stringify({ error: "Invalid message" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // `to: "trainer"`（全トレーナーへの一斉送信）は廃止した。
    //
    // 実装は `get_trainer_ids()` を使っていたが、これは
    // `SELECT user_id FROM user_roles WHERE role = 'trainer'` で
    // **全テナント横断**。つまり1件の体験予約が、無関係な他ジムのトレーナー全員に
    // お客様の氏名と日時を配っていた。セキュリティだけでなく機能としても誤り。
    //
    // 呼び出し元を全部確認したところ **`to` を渡している箇所はゼロ**で、
    // クライアント側は既に `src/lib/tenantHelper.ts` の自テナント限定ヘルパーで
    // 宛先を解決し、`user_id` を渡す形に移行済みだった（＝この分岐は死んでいた）。
    // 意味論を決め直すより消すのが正しい。
    //
    // 黙って別の意味（宛先なし＝skip）に落とすと気づけないので、明示的に断る。
    if (to !== undefined) {
      return new Response(
        JSON.stringify({
          error: "`to` is no longer supported. Resolve recipients per tenant and pass `user_id`.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // AUTHZ
    //  - service_role … サーバ側の通知経路。宛先は呼び出し元が解決済み
    //  - 認証ユーザー … 自分自身、または**自分と同じテナントに属する人**のみ
    //  - 生の line_user_id … service_role のみ（LINE ID を直に指定できると
    //    テナントの概念を丸ごと迂回できるため）
    if (!caller.isServiceRole) {
      if (line_user_id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!caller.userId || typeof user_id !== "string" || !user_id) {
        return new Response(JSON.stringify({ error: "user_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (user_id !== caller.userId) {
        let allowed = false;
        try {
          allowed = await sharesTenant(supabase, caller.userId, user_id);
        } catch (e) {
          // 判定できないときは送らない（fail-close）。
          console.error("tenant check failed:", e);
          allowed = false;
        }
        if (!allowed) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    let targetLineId = line_user_id;
    if (!targetLineId && user_id) {
      const { data: profile } = await supabase
        .from("profiles").select("line_user_id").eq("user_id", user_id).maybeSingle();
      targetLineId = profile?.line_user_id;
    }

    if (!targetLineId) {
      return new Response(JSON.stringify({ skipped: true, reason: "no LINE linked" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(LINE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to: targetLineId, messages: [{ type: "text", text: message }] }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("LINE API error:", err);
      return new Response(JSON.stringify({ error: err }), {
        status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-line-message error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
