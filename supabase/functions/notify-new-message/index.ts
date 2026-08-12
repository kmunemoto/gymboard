// 新着メッセージのプッシュ通知。
//
// ── なぜサーバー側に移したか（2026-08-11）────────────────────────────
//
// もともと通知は `src/hooks/useMessages.ts` の sendMessage の中で
// fire-and-forget していた。つまり**送信者の端末が投げていた**ので:
//
//   ・送信直後にアプリを閉じる／画面を切り替えると **通知が飛ばない**
//   ・電波が切れれば飛ばない。失敗しても console に出るだけで誰も気づけない
//   ・宛先の解決も送信者の権限で行うため、余計な profiles 参照が2回走っていた
//
// 「送れたように見えて相手に届いていない」型の壊れ方で、
// 送った本人にも受け取る側にも分からない。DB の INSERT を起点に切り替える。
//
// 呼び出し元は `messages` の AFTER INSERT トリガー（notify_new_message）。
// pg_net で vault の service_role キーを Authorization に載せて叩く。
//
// ── 入力は message_id だけ ────────────────────────────────────────
// タイトルや本文を受け取らない。**実在する行の内容しか通知に載らない**ようにするため。
// 万一この入り口を叩かれても、DB に無いメッセージの通知は作れない。
//
// ── LINE は引き継いでいない ──────────────────────────────────────
// クライアント側には LINE 送信もあったが、`LINE_INTEGRATION_ENABLED = false`
// （src/lib/featureFlags.ts）なので**実際には何も送っていなかった**。
// 復活させるときは、クライアントではなくここに足すこと。
// 理由と再開条件は src/lib/lineNotify.ts の冒頭コメント。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/** 通知本文に載せる本文の長さ。プレビューなので長すぎても通知側で切られる。 */
const PREVIEW_MAX = 40;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * 通知に出す本文。
 *
 * ⚠️ 添付だけ（本文が空）で送れる。そのとき空文字を渡すと**中身の無い通知**が出て
 *    「何か届いたが何かは分からない」になる。種別を文言にする。
 */
function preview(text: string, attachmentType: string | null): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) {
    if (attachmentType === "image") return "写真が届きました";
    if (attachmentType === "video") return "動画が届きました";
    return "メッセージが届きました";
  }
  const label = attachmentType === "image" ? "[写真] " : attachmentType === "video" ? "[動画] " : "";
  const room = PREVIEW_MAX - label.length;
  return label + (oneLine.length > room ? `${oneLine.slice(0, room)}…` : oneLine);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // daily-trainer-summary と同じ認可。service_role か CRON_SECRET のいずれかを必須にする。
  const caller = await verifyCaller(req);
  const cronSecret = Deno.env.get("CRON_SECRET");
  const cronAuthorized = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!caller?.isServiceRole && !cronAuthorized) {
    return json({ error: "Forbidden" }, 403);
  }

  try {
    const { message_id } = await req.json().catch(() => ({ message_id: null }));
    if (!message_id || typeof message_id !== "string") {
      return json({ error: "message_id required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: message, error: msgErr } = await supabase
      .from("messages")
      .select("id, sender_id, receiver_id, content, attachment_type, created_at")
      .eq("id", message_id)
      .maybeSingle();
    if (msgErr) throw msgErr;
    // 送信直後に取り消された等。通知する相手も内容も無いので黙って終わる。
    if (!message) return json({ skipped: "message_not_found" });

    // 冪等キーはメッセージ1件につき1つ。トリガーの再実行や再試行で二重に鳴らさない。
    const idempotencyKey = `new-message:${message.id}`;
    const { data: already } = await supabase
      .from("notification_dedupe")
      .select("idempotency_key")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (already) return json({ skipped: "already_sent" });

    // 送信者名。取れなくても通知そのものは出す（無言で落とすほうが害が大きい）。
    const { data: senderProfile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", message.sender_id)
      .maybeSingle();
    const senderName = senderProfile?.display_name?.trim() || "メッセージ";

    // 先に予約してからプッシュを投げる（同時多重起動レース対策。他の通知系と同じ方式）
    await supabase
      .from("notification_dedupe")
      .upsert({ idempotency_key: idempotencyKey, sent_at: new Date().toISOString() });

    const { error: pushErr } = await supabase.functions.invoke("send-push-notification", {
      body: {
        user_ids: [message.receiver_id],
        title: `${senderName}さんからメッセージ`,
        body: preview(message.content, message.attachment_type ?? null),
        url: "/",
        // 同じ相手からの連投を1つにまとめる（クライアント実装時からの挙動を踏襲）
        tag: `chat-${message.sender_id}-${message.receiver_id}`,
      },
    });
    if (pushErr) {
      // 予約した冪等キーを戻す。ここを残すと「1回失敗したメッセージは
      // 二度と通知できない」状態になる（再実行しても already_sent で弾かれる）。
      await supabase.from("notification_dedupe").delete().eq("idempotency_key", idempotencyKey);
      console.error("notify-new-message push failed:", pushErr);
      return json({ error: "push_failed", detail: String(pushErr) }, 500);
    }

    return json({ sent: 1, message_id: message.id });
  } catch (err) {
    console.error("notify-new-message error:", err);
    return json({ error: String(err) }, 500);
  }
});
