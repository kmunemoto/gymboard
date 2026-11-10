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
//
// ## 🔴 回数の上限と配信停止（2026-11-10 定期点検 resend-email-1）
//
// 以前は状態も回数も見なかったので、ジムを開いた人が「自分のジム宛ての体験予約（宛先は他人）」の行を何度でも
// 再送でき、正規のドメインから同じ人へ上限なしで送れた（確認メールは配信停止も効かない MUST_DELIVER）。いまは:
// - 届かなかった行（failed・dlq・bounced）だけ。同じ送信がもう届いていれば断る（already_delivered）
// - 1通につき2回・1つのジムで24時間30通・同じ宛先へ24時間5通まで（店が消せない記録で数える。../_shared/emailQuota.ts）
// - 必ず届けるメールでも配信停止を見る（honorSuppression）
// - 営業中（active・trial）のジムだけ
//
// ## 🔴 送信は invokeAsService で頼む
//
// supabase.functions.invoke だと本番の鍵（sb_secret_…）が Authorization に載らず、send-transactional-email が
// 401 で断っていた（2026-11-10 まで、再送は一度も成功していなかった。../_shared/invokeAsService.ts）。

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCaller } from "../_shared/auth.ts";
import { invokeAsService } from "../_shared/invokeAsService.ts";
import { RESEND_LIMITS, releaseEmailSend, reserveEmailSend } from "../_shared/emailQuota.ts";

// どの版が動いているかを外から確かめるための印（全部の応答に付く。中身は日付だけ）。
const BUILD = "2026-11-10-resend-limits";

/** 再送してよい行の状態（画面が「届かなかった」として再送ボタンを出すもの。rejected は材料が無いので no_payload になる） */
const RESENDABLE_STATUSES = new Set(["failed", "dlq", "bounced", "rejected"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-gymboard-build": BUILD,
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
      .select("id, message_id, template_name, recipient_email, template_data, status")
      .eq("id", logId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!row) return json({ error: "not_found" }, 404);

    // 🔴 届かなかった行だけ（画面がボタンを出すのと同じ条件。届いた行・送信中の行は再送しない）
    if (!RESENDABLE_STATUSES.has(String(row.status))) return json({ error: "not_failed" }, 409);

    // 🔴 招待メールは再送しない（2026-11-01 点検 invite-link-in-log-1）。履歴のリンク（ログインの鍵入り）は
    //    伏せてあるので描き直せない。お客様のカードの「招待する」からやり直すと、新しいリンクで送られる
    if (row.template_name === "customer-invite") return json({ error: "invite_needs_reissue" }, 409);

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

    // 同じ送信（message_id）が、あとで届いていれば送り直さない（日をまたいだ再試行で、古い日の行に失敗が残ることがある）
    if (row.message_id) {
      const { count: delivered } = await admin
        .from("email_send_log")
        .select("id", { count: "exact", head: true })
        .eq("message_id", row.message_id)
        .eq("tenant_id", tenantId)
        .eq("status", "sent");
      if ((delivered ?? 0) > 0) return json({ error: "already_delivered" }, 409);
    }

    // 営業中のジムだけ（お試し期間が切れたジムから、昔の行を送り続けさせない）
    const { data: gym } = await admin.from("tenants").select("status").eq("id", tenantId).maybeSingle();
    if (!gym || !["active", "trial"].includes(String(gym.status))) return json({ error: "Forbidden" }, 403);

    // 🔴 回数の上限（1通2回・1ジム24時間30通・同じ宛先24時間5通）。店が消せない記録で数える
    const quota = await reserveEmailSend(admin, {
      kind: "resend",
      recipient: String(row.recipient_email ?? ""),
      tenantId,
      sourceRef: String(row.message_id ?? row.id),
      limits: RESEND_LIMITS,
    });
    if (!quota.ok) {
      if (quota.reason === "error") {
        console.error("resend-email: quota check failed", quota.detail);
        return json({ error: "send_failed" }, 500);
      }
      return json({ error: "resend_limited" }, 429);
    }

    // 🔴 supabase.functions.invoke は使わない（鍵が載らず 401 になる。../_shared/invokeAsService.ts）
    const sent = await invokeAsService("send-transactional-email", {
      templateName: row.template_name,
      // 履歴に残っているのは**解決済みの宛先**なので、そのまま使う
      recipientEmail: row.recipient_email,
      tenantId,
      templateData,
      // 🔴 毎回新しいキー。使い回すと重複排除に弾かれて何も起きない
      idempotencyKey: `resend-${row.id}-${crypto.randomUUID()}`,
      // 🔴 必ず届けるメール（体験予約の確認など）でも、再送では配信停止を見る
      honorSuppression: true,
    });
    if (sent.error) {
      console.error("resend-email: send failed", sent.error);
      await releaseEmailSend(admin, quota.id);
      return json({ error: "send_failed" }, 502);
    }

    // 配信停止リストに載っている宛先は、ここで止まるのが正しい
    // （届かないと分かっている先へ何度も送らない）。店にはそう伝える
    const payload = sent.data as { success?: boolean; reason?: string } | null;
    if (payload && payload.success === false) {
      await releaseEmailSend(admin, quota.id);
      return json({ error: payload.reason ?? "send_failed" }, 409);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("resend-email: unexpected", e);
    return json({ error: "unexpected", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
