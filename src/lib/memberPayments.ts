/**
 * 会員からジムへの入金の記録（`member_payments`）を扱う。
 *
 * ── 🔴 これは「記録」であって「決済」ではない ────────────────
 * アプリはお金を動かさない。現金・振込・カードでジムが受け取った事実を残すだけ。
 * アプリ内決済をやるなら Stripe Connect の加盟店審査が絡む別プロジェクトになる。
 * （既存の Stripe はジムがジムボードに払う SaaS 利用料専用で、別物）
 *
 * ── なぜ作ったか ────────────────────────────────────────────
 * それまでの入金の実体は `profiles.paid_this_month`（boolean）だけで、
 * **しかも書き込む UI が1つも無かった**（2026-08-08 の棚卸しで判明）。
 * 1ビットでは「いくら・いつ・何の名目・どう受け取ったか」が残らず、
 * 揉めたときの証拠にもならない。
 */

export const PAYMENT_METHODS = ["現金", "銀行振込", "クレジットカード", "その他"] as const;
export const PAYMENT_KINDS = ["月謝", "回数券", "都度払い", "入会金", "その他"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export interface MemberPayment {
  id: string;
  tenant_id: string;
  user_id: string;
  amount_yen: number;
  paid_on: string;        // YYYY-MM-DD
  method: PaymentMethod;
  kind: PaymentKind;
  plan_name: string | null;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

/** 「¥12,000」の形。0 も「¥0」と出す（未入力とは違う） */
export const formatYen = (yen: number): string =>
  `¥${Math.round(yen).toLocaleString("ja-JP")}`;

/**
 * 入力された金額が保存できる値か。だめなら理由（日本語）を返す。
 * DB 側の CHECK（0〜1,000万）と同じ範囲にしてある。
 */
export function validateAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "金額を入れてください";
  if (!/^\d+$/.test(trimmed)) return "金額は数字だけで入れてください";
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return "金額を正しく入れてください";
  if (n > 10_000_000) return "金額が大きすぎます";
  return null;
}

/** YYYY-MM を取り出す。集計のキーに使う */
export const monthKeyOf = (paidOn: string): string => paidOn.slice(0, 7);

/**
 * 月ごとの入金合計。
 *
 * ⚠️ **これが売上の唯一の正。**
 * 以前のダッシュボードは「定価 × サイクル開始日」で売上を推計していた
 * （`getRevenueCycleStartDates`）。実際に受け取ったかは見ていないため、
 * 滞納していても満額が計上され、経営判断の土台にならなかった。
 */
export function revenueByMonth(payments: MemberPayment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payments) {
    const key = monthKeyOf(p.paid_on);
    map.set(key, (map.get(key) ?? 0) + p.amount_yen);
  }
  return map;
}

/** ある月に入金があった人の user_id の集合 */
export function paidUserIdsIn(payments: MemberPayment[], monthKey: string): Set<string> {
  const s = new Set<string>();
  for (const p of payments) {
    if (monthKeyOf(p.paid_on) === monthKey) s.add(p.user_id);
  }
  return s;
}

export interface OutstandingMember {
  user_id: string;
  name: string;
  planName: string | null;
  expectedYen: number | null;
}

/**
 * 未収（今月まだ入金の記録が無い在籍会員）を出す。
 *
 * 「滞納してる人が普通に予約を取り続けても気づけない」という穴に対する最小の答え。
 * **督促や予約ブロックはしない。** 気づけるようにするだけ。
 *
 * ⚠️ 除外するもの:
 *   - 休会・退会（`isActiveMember` が false）… 払わなくて当然なので出さない
 *   - プラン未設定 … 月謝の概念が無いので「未収」と呼べない
 *
 * ⚠️ **「入金が無い＝滞納」ではない。** 記録し忘れているだけかもしれない。
 *    画面では「未収」ではなく「今月の入金が未記録」という言い方にすること。
 */
export function outstandingMembers(params: {
  members: { user_id: string; name: string; status: string | null; planName: string | null }[];
  payments: MemberPayment[];
  monthKey: string;
  priceOf: (planName: string) => number | null;
  isActive: (status: string | null) => boolean;
}): OutstandingMember[] {
  const paid = paidUserIdsIn(params.payments, params.monthKey);
  return params.members
    .filter((m) => params.isActive(m.status))
    .filter((m) => !!m.planName)
    .filter((m) => !paid.has(m.user_id))
    .map((m) => ({
      user_id: m.user_id,
      name: m.name,
      planName: m.planName,
      expectedYen: m.planName ? params.priceOf(m.planName) : null,
    }));
}

/** 顧客ごとの入金合計（カルテの「これまでのお支払い」表示用） */
export function totalPaid(payments: MemberPayment[]): number {
  return payments.reduce((sum, p) => sum + p.amount_yen, 0);
}
