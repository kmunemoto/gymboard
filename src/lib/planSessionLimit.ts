/**
 * プランの回数上限（`tenant_plans.max_sessions` × `allow_overflow`）。
 *
 * ## 2026-08-21 まで「表示だけ」だった
 *
 * `max_sessions`（月4回・月8回…）は以前からあり、`PlanUsageCard` が
 * 「残り0回」の赤いバッジまで出していたが、**一度も強制されていなかった**。
 * 押せば普通に予約できる。`allow_overflow` も超過の可否を切り替える意図で
 * 作られたまま未実装のデッドカラムだった。新しい列を足さず、この2つを繋いだ。
 *
 *   allow_overflow = true（既定・現在の全プラン） … 今までどおり超過できる
 *   allow_overflow = false                        … 上限で拒否（DB は GB004）
 *
 * ## 🔴 表示と判定は必ず同じ数を使う
 *
 * 消化数は `computePlanUsage`（`src/lib/planUsage.ts`）がカードに出している
 * `used` / `remaining` そのもの。ここで別に数え直さないのは、
 * **「カードは残1回と言うのに予約が拒否される」を構造的に起こさない**ため。
 *
 * 超過を許さないプランでは `resolveEffectiveCycle` の自動ロールも止まる
 * （`allowOverflow: false`）。止めないと、設定をONにした時点で既に超過している
 * お客様の窓がロールして「残り7回」と出てしまい、DB の拒否と食い違う。
 *
 * 最終判定は DB のトリガー（`guard_booking_plan_limit`）。ここは画面で先に見せるため。
 */
import type { PlanUsage } from "@/lib/planUsage";

/**
 * この人はもうこのサイクルで予約を取れないか（＝次の予約が上限を超えるか）。
 *
 * @param usage        `computePlanUsage` の結果（カードが出しているものと同じ）。
 *                     🔴 **予約しようとしている日**を基準に計算したものを渡すこと。
 *                     DB（guard_booking_plan_limit）は予約日の属するサイクル窓で数えるので、
 *                     「今日」基準だと、DB が通す次サイクルの予約まで画面が塞いでしまう
 * @param allowOverflow `tenant_plans.allow_overflow`。true/null なら常に false（従来どおり）
 * @param planType     `tenant_plans.plan_type`。**subscription 以外は常に false**。
 *                     回数券（ticket）は窓が購入日起算で月次窓と別物、期間（period）は
 *                     回数無制限。DB トリガーも subscription 以外は強制しない。
 *                     省略時（プラン行が読めない旧データ互換）は subscription 扱い
 */
export const isPlanSessionLimitReached = (
  usage: PlanUsage | null | undefined,
  allowOverflow: boolean | null | undefined,
  planType?: string | null,
): boolean => {
  if (planType != null && planType !== "subscription") return false;  // DB トリガーと同じ絞り
  if (allowOverflow !== false) return false;      // 既定は超過を許す＝止めない
  if (!usage) return false;
  if (usage.isUnconfigured) return false;         // プラン未確定は判定しない（カードも出ない）
  if (usage.isUnlimited) return false;            // 通い放題
  if (usage.total === null) return false;
  return usage.used >= usage.total;
};

/**
 * DB が「プランの回数上限」で拒否したか。
 * SQLSTATE `GB004`（`20260821040000_plan_session_limit.sql` がこの用途専用に付けている）。
 *
 * GB001（担当が満枠）・GB002（担当がシフト外）・GB003（時間帯の回数上限）と混ぜないのは、
 * お客様への案内が変わるため（GB003＝別の時間帯なら取れる / GB004＝今サイクルはもう取れない）。
 */
export const isPlanLimitError = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { code?: string }).code === "GB004";
