/**
 * 週に何日かだけ、会員の1日の上限を増やす（2026-10-22）。
 *
 * 宗本さん「1週間に受ける予約の数を2つ増やします。基本一日5枠までにして、週に2日5枠が
 * 埋まったら他の曜日は枠の上限を自動で4枠までにする。体験予約はこれに影響されません」
 * → 週は **月曜〜日曜**、会員5人の日も合計の上限（体験込み）は **そのまま**、と確認済み。
 *
 *   その日の会員の上限 =
 *     その週の「ほかの日」で、会員が peakLimit 人以上の日が peakDays 日未満 → peakLimit（例 5）
 *     それ以上                                                         → dailyLimit（例 4）
 *
 * 🔴 判定の正は DB の `tenant_member_day_limits`（会員の自己予約を止める・カレンダーの受付終了・
 *    残り枠）。ここは予定表の「n/◯人」を出すための**同じ計算の写し**。変えるときは両方そろえる。
 *
 * 「その日だけ上限を外す」日は上限なし（null）で、多い日の数にも入れない（DB と同じ）。
 */

export interface WeeklyPeakSettings {
  /** 会員の1日の上限（tenants.daily_booking_limit）。null=上限なし */
  dailyLimit: number | null;
  /** 多い日の上限（tenants.weekly_peak_limit）。null=増やさない */
  peakLimit: number | null;
  /** 多い日にできる日数（週に・tenants.weekly_peak_days）。null=増やさない */
  peakDays: number | null;
}

/** 設定が効いているか。DB と同じく、多い日の上限が会員の上限より大きいときだけ */
export const weeklyPeakEnabled = (s: WeeklyPeakSettings): boolean =>
  s.dailyLimit != null && s.peakLimit != null && s.peakDays != null && s.peakLimit > s.dailyLimit;

/**
 * 設定画面で保存する値。
 * 「週に◯日まで」を選んでいなければ増やさない（両方 null。人数が残っていても書かない）。
 * 日数を選んだのに、人数が無い・1日の上限以下なら "invalid"（増やす意味が無い）。
 */
export const weeklyPeakSaveValues = (
  dailyLimit: number | null,
  peakDays: number | null,
  peakLimit: number | null,
): { weekly_peak_days: number | null; weekly_peak_limit: number | null } | "invalid" => {
  if (peakDays === null || dailyLimit === null) return { weekly_peak_days: null, weekly_peak_limit: null };
  if (peakLimit === null || peakLimit <= dailyLimit) return "invalid";
  return { weekly_peak_days: peakDays, weekly_peak_limit: peakLimit };
};

const pad = (n: number) => String(n).padStart(2, "0");

/** その日を含む週（月曜〜日曜）の7日分の "yyyy-MM-dd"。端末のタイムゾーンに左右されないよう UTC で数える */
export const isoWeekKeys = (dateKey: string): string[] => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const fromMonday = (new Date(base).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const t = new Date(base + (i - fromMonday) * 86_400_000);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  });
};

/**
 * その日の会員の上限。null=上限なし。
 * `countOn` は会員の件数（予定表の `bookedCountOn` = DB の `tenant_day_booking_count` と同じ数え方）。
 */
export function memberLimitOn(
  dateKey: string,
  s: WeeklyPeakSettings,
  countOn: (dateKey: string) => number,
  uncappedOn: (dateKey: string) => boolean,
): number | null {
  if (uncappedOn(dateKey) || s.dailyLimit == null) return null;
  if (!weeklyPeakEnabled(s)) return s.dailyLimit;
  const peak = s.peakLimit as number;
  const otherPeakDays = isoWeekKeys(dateKey).filter(
    (k) => k !== dateKey && !uncappedOn(k) && countOn(k) >= peak,
  ).length;
  return otherPeakDays < (s.peakDays as number) ? peak : s.dailyLimit;
}
