// 通知の再送 — 履歴の1行をもう一度送る。
//
// 送信履歴（TrainerEmailLog）で「届かなかった」が見えるようになったので、その場から
// もう一度送れるようにする。保存しておいた `template_data` で描画し直すので、
// **お客様には最初と同じ内容が届く**（文面が変わって混乱させない）。
//
// ## なぜ Edge Function なのか
//
// クライアントから `send-transactional-email` を直接呼ぶ経路は、
// 生のメールアドレス指定を**自分宛だけ**に制限している
// （正規ドメインから任意の宛先にそれらしいメールを送れると、フィッシングの踏み台になる）。
// 履歴の宛先はお客様のアドレスなので、その経路では送れない。
// ここで「その行が本当に自分のジムのものか」を確かめてから service_role で送る。
//
// ## 🔴 冪等キーは必ず新しくする
//
// 元のキーを使い回すと `notification_dedupe` に弾かれ、`duplicate` を記録して
// 200 で返ってくる。店から見ると「押したのに何も起きない」になる（一番タチが悪い）。

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const caller = await verifyCaller(req);
    if (!caller?.userId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    const tenantId: string | undefined = body?.tenant_id;
    const logId: string | undefined = body?.log_id;
    if (!tenantId || !logId) return json({ error: "target_required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 🔴 そのジムのスタッフか。グローバルな trainer ロールでは判定しない
    //    （自由登録で誰でも取れるので、他ジムの通知を再送できてしまう）
    const { data: membership, error: mErr } = await admin
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", caller.userId)
      .eq("status", "active")
      .in("role", ["owner", "trainer"])
      .maybeSingle();
    if (mErr) {
      console.error("resend-email: membership lookup failed", mErr);
      return json({ error: "membership_lookup_failed" }, 500);
    }
    if (!membership) return json({ error: "Forbidden" }, 403);

    // 🔴 その行が本当にこのジムのものか。tenant_id で必ず絞る
    //    （log_id だけで引くと、他ジムの通知を再送できてしまう）
    const { data: row } = await admin
      .from("email_send_log")
      .select("id, message_id, template_name, recipient_email, template_data")
      .eq("id", logId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!row) return json({ error: "not_found" }, 404);

    // 材料を探す。結果の行（sent / failed）は材料を持たないので、
    // 同じ message_id の行から拾う
    let templateData = row.template_data as Record<string, unknown> | null;
    if (!templateData && row.message_id) {
      const { data: src } = await admin
        .from("email_send_log")
        .select("template_data")
        .eq("message_id", row.message_id)
        .eq("tenant_id", tenantId)
        .not("template_data", "is", null)
        .limit(1)
        .maybeSingle();
      templateData = (src?.template_data as Record<string, unknown> | null) ?? null;
    }

    // 材料の無い古い行（この機能より前に送ったもの）は再送できない。
    // 黙って「送った」ことにしない
    if (!templateData) return json({ error: "no_payload" }, 409);

    const { data: result, error: sendErr } = await admin.functions.invoke(
      "send-transactional-email",
      {
        body: {
          templateName: row.template_name,
          // 履歴に残っているのは**解決済みの宛先**なので、そのまま使う
          recipientEmail: row.recipient_email,
          tenantId,
          templateData,
          // 🔴 毎回新しいキー。使い回すと重複排除に弾かれて何も起きない
          idempotencyKey: `resend-${row.id}-${crypto.randomUUID()}`,
        },
      },
    );
    if (sendErr) {
      console.error("resend-email: send failed", sendErr);
      return json({ error: "send_failed" }, 502);
    }

    // 配信停止リストに載っている宛先は、ここで止まるのが正しい
    // （届かないと分かっている先へ何度も送らない）。店にはそう伝える
    const payload = result as { success?: boolean; reason?: string } | null;
    if (payload && payload.success === false) {
      return json({ error: payload.reason ?? "send_failed" }, 409);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("resend-email: unexpected", e);
    return json({ error: "unexpected", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
