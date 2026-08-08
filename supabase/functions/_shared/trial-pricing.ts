// 体験トレーニングの料金表示（Edge Function 側）。
//
// クライアント側の `src/lib/trialPricing.ts` と**同じ判断**をする。
// 片方だけ直すと「画面には ¥3,000 と出ているのにメールには出ない」がすぐ起きるので、
// 検査（src/test/trialPricing.test.ts）で両方の存在を突き合わせている。
//
// ⚠️ 金額はここに書かない。ジムごとの設定（tenants.trial_price_yen）から渡ってくる。

/**
 * 料金を表示するか。
 *
 * ⚠️ `null` と `0` は違う。
 *   - `null` … 料金の設定なし。**何も表示しない**
 *   - `0`    … ジムが「¥0」と明示した。**「¥0」と表示する**
 *
 * `if (!price)` と書くと 0 が落ちる。必ずこの関数を通すこと。
 */
export function hasTrialPrice(yen: number | null | undefined): yen is number {
  return typeof yen === "number" && Number.isFinite(yen) && yen >= 0;
}

/** 金額だけを整形する（例: `3000` → `¥3,000`） */
export function formatYen(yen: number): string {
  return `¥${Math.round(yen).toLocaleString("ja-JP")}`;
}

/**
 * メール本文に出す料金の1行。表示できないときは `null`（行ごと落とす）。
 * 例: `¥3,000（税込）`
 */
export function trialPriceLine(yen: number | null | undefined): string | null {
  if (!hasTrialPrice(yen)) return null;
  return `${formatYen(yen)}（税込）`;
}
