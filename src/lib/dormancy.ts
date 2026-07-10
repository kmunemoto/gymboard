// 「しばらく来ていない（休眠）お客様」の判定ロジック（純関数）。
// 顧客一覧(TrainerClientList)で、来店実績ベースにお客様を休眠として折りたたむのに使う。
//
// 定義（トレーナーダッシュボードの離脱検知と同じ考え方）:
//  - 最終来店 = 過去の非キャンセル予約のうち最新のもの（useProfile が last_visit_date として算出）。
//  - 休眠 = 今後の予約が無く、かつ最終活動（最終来店。来店実績が無ければ登録日）から
//    しきい値日数以上が経過している。今後の予約が1件でもあれば絶対に休眠にしない。
//
// タイムゾーン: 経過日数は必ず JST の暦日で数える。getJSTNow()/toJSTDate() は
// どちらも同じ +9h シフトのプロキシDateなので、エポック日(切り捨て)の差は
// JSTの日付境界をまたいだ回数＝JST暦日差になる（src/lib/timezone.ts 参照）。

import { getJSTNow, toJSTDate } from "@/lib/timezone";
import type { ProfileWithBooking } from "@/hooks/useProfile";

/** 「しばらく来ていない（休眠）」と見なす既定のしきい値（日数）。 */
export const DEFAULT_DORMANT_DAYS = 30;

/** 顧客一覧の休眠しきい値として選べる日数。 */
export const DORMANT_DAY_OPTIONS = [30, 60, 90] as const;

const MS_PER_DAY = 86400000;

/**
 * fromIso（UTC ISO文字列）から nowJst（JSTプロキシDate）までの経過日数を JST暦日で返す。
 * nowJst は必ず getJSTNow() 由来の JSTプロキシDate を渡すこと（生の new Date() は不可）。
 */
const jstDaysBetween = (fromIso: string, nowJst: Date): number =>
  Math.floor(nowJst.getTime() / MS_PER_DAY) - Math.floor(toJSTDate(fromIso).getTime() / MS_PER_DAY);

/**
 * お客様の「最終活動」からの経過日数（JST暦日）。
 * 来店実績があれば最終来店日、無ければ登録日(created_at)を基準にする。
 */
export const daysSinceLastActivity = (
  c: Pick<ProfileWithBooking, "last_visit_date" | "created_at">,
  nowJst: Date = getJSTNow(),
): number => {
  const iso = c.last_visit_date ?? c.created_at;
  if (!iso) return 0;
  return jstDaysBetween(iso, nowJst);
};

/**
 * お客様が「しばらく来ていない（休眠）」かどうか。
 *  - 今後の予約が1件でもあれば必ず false（来店予定がある人は隠さない）。
 *  - それ以外は、最終活動から thresholdDays 日以上経過していれば true。
 */
export const isDormant = (
  c: Pick<ProfileWithBooking, "next_booking_date" | "last_visit_date" | "created_at">,
  thresholdDays: number,
  nowJst: Date = getJSTNow(),
): boolean => {
  if (c.next_booking_date) return false;
  return daysSinceLastActivity(c, nowJst) >= thresholdDays;
};
