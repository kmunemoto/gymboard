// メールの回数の上限を「店が消せない記録」（email_send_quota）で数える（2026-11-10・定期点検
// trial-book-2 / trial-book-cap-1 / resend-email-1 / invite-email-relay-1）。
//
// 以前は体験予約の確認メールの上限を trial_bookings の行で数えていた。ジムのオーナーは自分のジムの行を消せる・
// 作成日時や宛先を書き換えられるので、数え直させて同じ人へ何通でも送れた。宛先も文字のまま比べていたので、
// 大文字や +1 を足すだけで別の宛先になった。記録は service_role だけが書ける表に積み、宛先はそろえてから数える。
//
// 表と数え方の本体: supabase/migrations/20261110010000_email_send_quota_and_trial_booking_guard.sql
// import なし（vitest からもそのまま読める）。

/**
 * 数えるための宛先の形。前後の空白なし・NFKC・小文字・+タグなし・ドメインの末尾の点なし。
 * Gmail は点も落とす（taro.yamada@ と taroyamada@ は同じ受信箱）・googlemail.com は gmail.com。
 * ⚠️ 数えるためだけの形。送る宛先はこれに置き換えない（+タグは振り分けに使われる）。
 */
export function canonicalEmail(raw: string): string {
  const s = raw.normalize("NFKC").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at <= 0) return s;
  let local = s.slice(0, at);
  let domain = s.slice(at + 1).replace(/\.+$/, "");
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** 記録に残す宛先の印（そろえた形の SHA-256。アドレスそのものは残さない） */
export async function recipientKey(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalEmail(raw)));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type QuotaKind = "guest_confirm" | "resend" | "unclaimed_user";

export interface QuotaLimits {
  /** 同じ宛先へ、全部のジムを合わせて24時間に何通まで */
  perRecipient24h?: number;
  /** 1つのジムから1時間に何通まで */
  perTenant1h?: number;
  /** 1つのジムから24時間に何通まで */
  perTenant24h?: number;
  /** 同じもと（再送なら元の送信）につき何回まで */
  perSource?: number;
}

/** 送信履歴の「再送」: 1通につき2回まで・1つのジムで24時間30通まで・同じ宛先へ24時間5通まで */
export const RESEND_LIMITS: QuotaLimits = { perRecipient24h: 5, perTenant24h: 30, perSource: 2 };

/**
 * まだ本人が来ていない取り込みのアカウント（招待でアドレスを付けただけ）宛て: 同じ宛先へ24時間10通まで。
 * 本番の過去90日で、こうしたアカウント宛てのメールは0通（2026-11-10）。普通のお客様（ログインしたことがある人）は数えない
 * （予約の確認・取り消しは1人1日13〜17通のこともある）。
 */
export const UNCLAIMED_USER_LIMITS: QuotaLimits = { perRecipient24h: 10 };

export type QuotaReason = "recipient" | "tenant_hour" | "tenant_day" | "source" | "error";
export type QuotaResult = { ok: true; id: string } | { ok: false; reason: QuotaReason; detail?: string };

// deno-lint-ignore no-explicit-any
type AdminClient = { rpc: (fn: string, args: Record<string, unknown>) => any; from: (table: string) => any };

/**
 * 上限の内なら1通ぶん積む（数える→積むは DB の中で1本ずつ）。DB に聞けなかったときは error（呼ぶ側が送らない）。
 * 送れなかったとき（予約が作れなかった等）は releaseEmailSend で戻す。
 */
export async function reserveEmailSend(
  admin: AdminClient,
  args: { kind: QuotaKind; recipient: string; tenantId: string | null; sourceRef?: string | null; limits: QuotaLimits },
): Promise<QuotaResult> {
  try {
    const { data, error } = await admin.rpc("reserve_email_send", {
      p_kind: args.kind,
      p_recipient_key: await recipientKey(args.recipient),
      p_tenant_id: args.tenantId,
      p_source_ref: args.sourceRef ?? null,
      p_max_recipient_24h: args.limits.perRecipient24h ?? null,
      p_max_tenant_1h: args.limits.perTenant1h ?? null,
      p_max_tenant_24h: args.limits.perTenant24h ?? null,
      p_max_source: args.limits.perSource ?? null,
    });
    if (error) return { ok: false, reason: "error", detail: error.message ?? String(error) };
    const r = data as { ok?: boolean; id?: string; reason?: string } | null;
    if (r?.ok === true && typeof r.id === "string") return { ok: true, id: r.id };
    const reason = r?.reason;
    if (reason === "recipient" || reason === "tenant_hour" || reason === "tenant_day" || reason === "source") {
      return { ok: false, reason };
    }
    return { ok: false, reason: "error", detail: "unexpected response" };
  } catch (e) {
    return { ok: false, reason: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

/** 積んだ1通ぶんを戻す（予約が作れなかった・送る前に止めたとき）。失敗しても上限が少し早く来るだけなので投げない */
export async function releaseEmailSend(admin: AdminClient, id: string): Promise<void> {
  try {
    await admin.from("email_send_quota").delete().eq("id", id);
  } catch {
    // 戻せなくても送信は安全側（上限が1つぶん早く来るだけ）
  }
}
