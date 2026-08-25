// 取り込んだ顧客への招待 — アカウントの引き渡し。
//
// CSV 一括登録（import-customers）で作った顧客は、ログイン手段の無いアカウント
// （配達できないアドレス・パスワード無し）として店の中にだけ存在する。
// ここで初めて本人のメールアドレスを設定し、パスワード設定リンクを送る。
//
// ## 🔴 紐づけは「氏名の照合」ではなく「アカウントの引き渡し」
//
// 招待メールを受け取った本人がパスワードを設定した瞬間、そのアカウントは本人の物になる。
// 照合ロジックが存在しないので、同姓同名で他人のカルテが見える事故が原理的に起きない。
// 裏返すと、**店が入力したメールアドレスがそのまま鍵になる**。宛先を打ち間違えると
// 別人にリンクが届くので、メール本文に「心当たりが無い場合は破棄してください」を必ず入れる。
//
// ## リンクの形
//
// GoTrue の recovery リンクを generateLink で作り、既存の /reset-password 画面に
// 合流させる（token_hash + verifyOtp。パスワード再設定と同じ受け口）。
// invite 種別を使わないのは、GoTrue の invite が**新規ユーザー専用**で、
// 既に存在するこのアカウントには発行できないため。
//
// ## 権限
//
// import-customers と同じ: そのテナントの owner として在籍していることを tenant_members で
// 確かめる。🔴 グローバルな trainer ロール（hasRole）では判定しない — 自由登録で
// 誰でも取れる権限なので、それを根拠にすると他ジムの顧客のメールを差し替えられてしまう。

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 唯一の宣言は src/lib/brand.ts の PRODUCTION_WEB_ORIGIN（Deno からは import できない）
const PRODUCTION_WEB_ORIGIN = "https://app.kyoto-salute.com";

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
    const targetUserId: string | undefined = body?.user_id;
    const email: string = typeof body?.email === "string" ? body.email.trim() : "";

    if (!tenantId || !targetUserId) return json({ error: "target_required" }, 400);
    // 厳密な形式検査はしない（メール RFC は正規表現で守れない）。明らかな入力ミスだけ弾く
    if (!email || email.length > 255 || !email.includes("@") || /\s/.test(email)) {
      return json({ error: "invalid_email" }, 400);
    }
    // 取り込みが使うプレースホルダのドメインには送れない（無限ループの芽を摘む）
    if (email.toLowerCase().endsWith("@gymboard.invalid")) {
      return json({ error: "invalid_email" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 🔴 そのテナントの owner として在籍しているか（import-customers と同じ判定）
    const { data: membership, error: mErr } = await admin
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", caller.userId)
      .eq("status", "active")
      .eq("role", "owner")
      .maybeSingle();
    if (mErr) {
      console.error("invite-customer: membership lookup failed", mErr);
      return json({ error: "membership_lookup_failed" }, 500);
    }
    if (!membership) return json({ error: "Forbidden" }, 403);

    // 対象が「このテナントの、取り込まれた、まだ本人が来ていない顧客」であること。
    // どれか1つでも欠けたら触らない（普通の顧客のメールを差し替える事故を防ぐ）
    const { data: target } = await admin
      .from("tenant_members")
      .select("user_id, display_name")
      .eq("tenant_id", tenantId)
      .eq("user_id", targetUserId)
      .eq("role", "customer")
      .maybeSingle();
    if (!target) return json({ error: "not_a_customer" }, 404);

    const { data: prof } = await admin
      .from("profiles")
      .select("display_name, imported_at, claimed_at")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (!prof?.imported_at) return json({ error: "not_imported" }, 409);
    if (prof.claimed_at) return json({ error: "already_claimed" }, 409);

    // 三重目の帯: アカウント側にも取り込み印（import-customers が付けた metadata）があること
    const { data: authUser, error: uErr } = await admin.auth.admin.getUserById(targetUserId);
    if (uErr || !authUser?.user) return json({ error: "account_not_found" }, 404);
    if (authUser.user.user_metadata?.imported !== true) {
      return json({ error: "not_imported" }, 409);
    }

    // 1) メールを本人のアドレスに差し替える。
    //    email_confirm: true は「店がこの宛先を保証する」の意（招待の意味論そのもの）
    const { error: updErr } = await admin.auth.admin.updateUserById(targetUserId, {
      email,
      email_confirm: true,
    });
    if (updErr) {
      // 既に誰かが使っているアドレス。その人は自分のアカウントでログインすればよいので、
      // ここで無理に紐づけ（マージ）はしない。店にそのまま伝える
      const msg = updErr.message?.toLowerCase() ?? "";
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return json({ error: "email_taken" }, 409);
      }
      console.error("invite-customer: email update failed", updErr);
      return json({ error: "email_update_failed" }, 500);
    }

    // 2) パスワード設定リンク。既存の /reset-password（token_hash + verifyOtp）に合流させる
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    const hashedToken = link?.properties?.hashed_token;
    if (linkErr || !hashedToken) {
      console.error("invite-customer: generateLink failed", linkErr);
      return json({ error: "link_generation_failed" }, 500);
    }
    const inviteUrl =
      `${PRODUCTION_WEB_ORIGIN}/reset-password?token_hash=${encodeURIComponent(hashedToken)}` +
      `&type=recovery&flow=invite`;

    // 3) 招待メール。テンプレートは service_role 経路専用
    //    （CLIENT_ALLOWED_TEMPLATES に入れない = クライアントから任意の宛先に送れない）
    const { data: gym } = await admin
      .from("tenants")
      .select("gym_name")
      .eq("id", tenantId)
      .maybeSingle();

    const { data: sendResult, error: sendErr } = await admin.functions.invoke(
      "send-transactional-email",
      {
        body: {
          templateName: "customer-invite",
          recipientEmail: email,
          tenantId,
          idempotencyKey: `customer-invite-${targetUserId}-${crypto.randomUUID()}`,
          templateData: {
            gymName: gym?.gym_name ?? "",
            customerName: prof.display_name ?? target.display_name ?? "",
            inviteUrl,
          },
        },
      },
    );
    if (sendErr) {
      console.error("invite-customer: send failed", sendErr);
      return json({ error: "send_failed" }, 502);
    }
    const payload = sendResult as { success?: boolean; reason?: string } | null;
    if (payload && payload.success === false) {
      // 配信停止リスト（過去に不達）。届かないと分かっている宛先には送らない
      return json({ error: payload.reason ?? "send_failed" }, 409);
    }

    // 4) 送信に成功したときだけ「招待済み」にする。
    //    失敗時に埋めると、バッジが「招待済み」なのにメールが届いていない状態を作る
    await admin
      .from("profiles")
      .update({ invited_at: new Date().toISOString() })
      .eq("user_id", targetUserId);

    return json({ ok: true });
  } catch (e) {
    console.error("invite-customer: unexpected", e);
    return json({ error: "unexpected", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
