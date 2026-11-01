// LINE（公式アカウント）で送ってよい相手の判定（2026-11-01・点検の拡大 send-line-message-1）。
// Deno（Edge Function）からも vitest からも import できるよう、import を持たない純粋な関数だけを置く。
// 見張り: src/test/lineRecipients.test.ts

/** tenant_members の有効な所属（status = 'active' のものだけを渡すこと） */
export interface LineMembership {
  tenantId: string;
  role: string;
}

const isStaff = (role: string) => role === "owner" || role === "trainer";

/**
 * 画面から（service_role 以外）、自分以外の人へ LINE を送ってよいか。
 *
 * 同じジムに一緒に在籍していて、どちらかがそのジムのスタッフ（owner / trainer）のときだけ:
 *   - スタッフ → そのジムのお客様（代理予約・取り消しの連絡）
 *   - お客様 → そのジムのスタッフ（予約・キャンセルの連絡）
 * 🔴 お客様同士は不可。以前は「同じジムなら誰にでも」で、お客様が他のお客様へ、全ジム共通の公式アカウント
 *    （Salute のアカウント）から任意の文面（リンク付き）を送れた。
 */
export function mayLineMessage(mine: readonly LineMembership[], theirs: readonly LineMembership[]): boolean {
  return mine.some((m) =>
    m.tenantId !== "" &&
    theirs.some((t) => t.tenantId === m.tenantId && (isStaff(m.role) || isStaff(t.role))),
  );
}
