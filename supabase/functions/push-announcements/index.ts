// お知らせのプッシュ通知配信。
// 「公開済み（published_at <= now）かつ 未送信（push_sent_at IS NULL）」のお知らせを
// 原子的にクレームしてからプッシュ通知を送る（多重起動しても二重送信しない）。
// 呼び出し元:
//   - お知らせ作成/更新直後のアプリ（fire-and-forget。即時公開分をすぐ届ける）
//   - pg_cron（10分おき等。予約公開（published_at が未来）分を公開時刻に届ける）
// 対象者: target='all' はテナントの有効なお客様全員、target=<user_id> はその1名。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// 導入・停止期間の古いお知らせを誤って一斉送信しないための安全窓。
// published_at がこれより古い未送信分は送らずマークだけする。
const MAX_AGE_HOURS = 24;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // 認証: service_role / CRON_SECRET / ログイン済みユーザー のいずれか。
  // 処理はクレーム済みの公開due分のみで冪等なため、認証ユーザーからの起動は安全
  // （悪意ある連打でも、送信は1お知らせにつき1回しか起きない）。
  const caller = await verifyCaller(req);
  const cronSecret = Deno.env.get("CRON_SECRET");
  const cronAuthorized = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!caller?.isServiceRole && !cronAuthorized && !caller?.userId) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const nowIso = new Date().toISOString();

    // 公開済み・未送信のお知らせを取得
    const { data: due, error: dueErr } = await supabase
      .from("announcements")
      .select("id, title, body, target, tenant_id, published_at")
      .is("push_sent_at", null)
      .lte("published_at", nowIso)
      .order("published_at", { ascending: true })
      .limit(20);
    if (dueErr) throw dueErr;
    if (!due || due.length === 0) return json({ processed: 0, sent: 0 });

    const cutoff = Date.now() - MAX_AGE_HOURS * 3600_000;
    let processed = 0;
    let sent = 0;
    const results: { id: string; recipients: number; skipped?: string }[] = [];

    for (const a of due as any[]) {
      // 原子的クレーム: 先にマークできた実行だけが送信する（二重送信防止）
      const { data: claimed } = await supabase
        .from("announcements")
        .update({ push_sent_at: new Date().toISOString() } as any)
        .eq("id", a.id)
        .is("push_sent_at", null)
        .select("id")
        .maybeSingle();
      if (!claimed) continue; // 他の実行がクレーム済み
      processed++;

      // 古すぎるお知らせは送らない（マークのみ）
      if (new Date(a.published_at).getTime() < cutoff) {
        results.push({ id: a.id, recipients: 0, skipped: "too_old" });
        continue;
      }

      // 対象者を解決
      let userIds: string[] = [];
      if (a.target && a.target !== "all") {
        userIds = [a.target];
      } else if (a.tenant_id) {
        const { data: members } = await supabase
          .from("tenant_members")
          .select("user_id")
          .eq("tenant_id", a.tenant_id)
          .eq("role", "customer")
          .eq("status", "active");
        userIds = (members ?? []).map((m: any) => m.user_id);
      }
      if (userIds.length === 0) {
        results.push({ id: a.id, recipients: 0, skipped: "no_recipients" });
        continue;
      }

      const preview = a.body.length > 60 ? `${a.body.slice(0, 60)}...` : a.body;
      try {
        const { error: pushErr } = await supabase.functions.invoke("send-push-notification", {
          body: {
            user_ids: userIds,
            title: `お知らせ: ${a.title}`.slice(0, 100),
            body: preview,
            url: "/",
            tag: `announcement-${a.id}`,
          },
        });
        if (pushErr) console.error(`announcement push failed for ${a.id}:`, pushErr);
        else sent++;
        results.push({ id: a.id, recipients: userIds.length });
      } catch (e) {
        console.error(`announcement push exception for ${a.id}:`, e);
        results.push({ id: a.id, recipients: userIds.length, skipped: "push_error" });
      }
    }

    return json({ processed, sent, results });
  } catch (e) {
    console.error("push-announcements error:", e);
    return json({ error: String(e) }, 500);
  }

  function json(obj: unknown, status = 200) {
    return new Response(JSON.stringify(obj), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
