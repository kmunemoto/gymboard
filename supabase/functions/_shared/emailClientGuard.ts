// 画面（service_role 以外）から send-transactional-email を呼ばれたときに、サーバーが決め直す値
// （2026-11-01・点検の拡大 send-transactional-email-tenant-1 / send-transactional-email-link-1）。
// Deno（Edge Function）からも vitest からも import できるよう、import を持たない純粋な関数だけを置く。
// 見張り: src/test/emailClientGuard.test.ts

/** 重複を落とす。空なら null（＝この送信を正当化するジムが無い＝送らせない）。 */
export function uniqueTenantsOrNull(ids: readonly string[]): string[] | null {
  const out = [...new Set(ids.filter((id) => typeof id === "string" && id !== ""))];
  return out.length > 0 ? out : null;
}

/**
 * どのジムの送信履歴に載せるか。
 *
 * 画面が渡した tenantId は、この送信を正当化するジム（呼び出し元と宛先が一緒に在籍しているジム）の
 * 中にあるときだけ使う。無ければ候補が1つのときだけそれ、それ以外は null（どのジムの履歴にも載せない）。
 * 🔴 以前は画面の値をそのまま使っていたため、お客様が自分で作ったジムの履歴に「自分のジムのオーナーの
 *    ログイン用アドレス」が入った行を書き込ませて読めた（duplicate の行は送らずに宛先だけ残る）。
 */
export function pickVerifiedTenant(requested: unknown, allowed: readonly string[]): string | null {
  if (typeof requested === "string" && allowed.includes(requested)) return requested;
  return allowed.length === 1 ? allowed[0] : null;
}

/**
 * 画面から来た templateData のうち、メールの「誰から・どこへ」に関わる値をサーバーの値に置き換える。
 *
 * - `…Url`（ボタンの飛び先）: 画面の値は使わない。dashboardUrl だけは本番のオリジンにし、他は消す
 *   （正規の呼び出しは本番のオリジンしか渡さない。テンプレートの固定のリンクはテンプレート側の定数）
 * - gymName（差出人名・本文のジム名）: DB の tenants.gym_name。分からなければ消す（差出人は製品名になる）
 * - gymNote（お店からのご案内）: DB の tenants.booking_email_note（画面が渡してきたときだけ）
 *
 * 🔴 お客様が店のスタッフ宛てに「ジムボード運営」の名前で、攻撃者のサイトへのボタン付きの正規の通知を
 *    送れた（オーナーのパスワードを狙うフィッシング）。元の templateData は変えない。
 */
export function serverDecidedTemplateData(
  data: Record<string, unknown>,
  server: { appOrigin: string; gymName: string | null; gymNote: string | null },
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const key of Object.keys(out)) {
    if (!/url$/i.test(key)) continue;
    const v = out[key];
    if (key === "dashboardUrl" && typeof v === "string" && v !== "") out[key] = server.appOrigin;
    else delete out[key];
  }
  const gymName = (server.gymName ?? "").trim();
  if (gymName) out.gymName = gymName;
  else delete out.gymName;
  if ("gymNote" in out) out.gymNote = server.gymNote;
  return out;
}
