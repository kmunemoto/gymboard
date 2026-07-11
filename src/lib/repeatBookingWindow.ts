// 定期予約（毎週同じ曜日・時間でまとめて予約）が、予約可能期間（1ヶ月先まで）を
// 超えて作成されてしまう問題への対応。
//
// 顧客予約カレンダーは `toDate={addMonths(startOfDay(getJSTNow()), 1)}` で
// 「今日から1ヶ月先まで」しか開始日を選べないが、この上限は開始日1件にしか効かない。
// 定期予約は開始日から +7日ずつ最大 MAX_REPEAT_COUNT 回分をまとめて作成するため、
// 期間の終わり近くを開始日に選ぶと、2回目以降がこの上限を超えてしまう
// （例: 期間終了3日前を選んで4回コースを選択すると、最終回は3週間以上超過する）。
//
// ここでは「開始日から数えて、予約可能期間に収まる回数の上限」を計算する。
// UI側（選べる回数の絞り込み）と送信直前（二重防御）の両方から呼ぶ。

import { addMonths, startOfDay } from "date-fns";
import { getJSTNow } from "@/lib/timezone";

/** 定期予約で選べる最大回数（この回のみ＝1 を含む）。 */
export const MAX_REPEAT_COUNT = 4;

/**
 * startDate を1回目として、予約可能期間（maxBookableDate まで）に収まる回数の上限を返す。
 * count 回目の最終回は startDate + (count-1)*7日 になるため、それが maxBookableDate を
 * 超えない最大の count（1〜MAX_REPEAT_COUNT）を返す。1回目だけなら必ず1を返す
 * （startDate 自体は呼び出し側が既に予約可能期間内であることを保証している前提）。
 */
export function maxRepeatWeeksFor(
  startDate: Date,
  maxBookableDate: Date = addMonths(startOfDay(getJSTNow()), 1),
): number {
  let allowed = 1;
  for (let count = 2; count <= MAX_REPEAT_COUNT; count++) {
    const lastOccurrence = new Date(startDate);
    lastOccurrence.setDate(lastOccurrence.getDate() + (count - 1) * 7);
    if (lastOccurrence.getTime() > maxBookableDate.getTime()) break;
    allowed = count;
  }
  return allowed;
}
