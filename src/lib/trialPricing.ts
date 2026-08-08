// 体験トレーニングの料金表示。
//
// ── なぜ関数にするか ────────────────────────────────────────────
// 体験の料金は**ジムごとの設定**（tenants.trial_price_yen）。
// 予約ページ・ジム設定・メールの3か所で同じ判断（出すか / どう書くか）をするので、
// **コードに金額を書かない**という約束をここ1か所で守る。
//
// 本番には14テナントいる。無料体験で集客しているジムもありうるので、
// 特定のジムの金額をコードに置くと全ジムに波及する
// （CLAUDE.md「特定テナント専用の変更を全テナントに適用しない」）。

/**
 * 料金を表示するか。
 *
 * ⚠️ `null` と `0` は違う。
 *   - `null` … 料金の設定なし。**何も表示しない**（従来どおりの見た目）
 *   - `0`    … ジムが「¥0」と明示した。**「¥0」と表示する**
 *
 * `if (!price)` と書くと 0 が落ちる。必ずこの関数を通すこと。
 */
export function hasTrialPrice(yen: number | null | undefined): yen is number {
  return typeof yen === "number" && Number.isFinite(yen) && yen >= 0;
}

/**
 * 金額だけを整形する（例: `3000` → `¥3,000`）。
 * 表示するかどうかの判断は含まないので、呼ぶ前に `hasTrialPrice` を通すこと。
 */
export function formatYen(yen: number): string {
  return `¥${Math.round(yen).toLocaleString("ja-JP")}`;
}

/**
 * メール本文など、プレーンテキストで料金を1行にするとき用。
 * 表示できないときは `null` を返すので、呼び出し側で行ごと落とせる。
 *
 * @param taxIncludedLabel 「（税込）」相当の文言。i18n の都合で呼び出し側から渡す。
 */
export function trialPriceLine(
  yen: number | null | undefined,
  taxIncludedLabel: string,
): string | null {
  if (!hasTrialPrice(yen)) return null;
  return `${formatYen(yen)}${taxIncludedLabel}`;
}
