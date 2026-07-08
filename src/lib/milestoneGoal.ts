// 3ヶ月ごとの中目標（棚卸し目標）が「見直し時期かどうか」を判定する純関数。
// トレーナーの顧客一覧Badge・顧客カルテの空状態ヒントで共通に使う。
//
// タイムゾーンについて: これは2つの実時刻(Date)間の経過日数という「絶対的な期間」の
// 判定であり、表示タイムゾーンに依存しない。periodReminder.ts と同じく、
// getJSTNow()/toJSTDate() (表示用にシフトされたJSTプロキシ) ではなく、
// 実時刻(new Date() 等)のエポック日数切り捨てで計算する
// (JSTプロキシの getTime() を生の期間計算に混ぜてはいけない — src/lib/timezone.ts 参照)。

/** 中目標の見直し目安（日数）。この日数以上経過していると「棚卸し時期」とみなす。 */
export const MILESTONE_REVIEW_DAYS = 90;

/**
 * 中目標が「見直し時期」かどうかを判定する。
 * - setAt が null（一度も設定していない）なら true（要設定・要棚卸し）
 * - 設定から MILESTONE_REVIEW_DAYS 日以上経過していれば true
 * - それ以外は false
 */
export function isMilestoneOverdue(setAt: string | null, now: Date): boolean {
  if (!setAt) return true;
  const MS = 86400000;
  const startOfDayUTC = (d: Date) => Math.floor(d.getTime() / MS);
  const daysElapsed = startOfDayUTC(now) - startOfDayUTC(new Date(setAt));
  return daysElapsed >= MILESTONE_REVIEW_DAYS;
}
