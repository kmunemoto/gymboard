// 利用期間（サイクル）計算の Deno 版。
// クライアントの src/lib/courseProgress.ts / planUsage.ts の実効サイクル計算を
// エッジ関数（push-period-reminder）向けに最小移植したもの。
// 挙動を一致させるため、日付はすべて「JST 暦日の 00:00 を UTC の同時刻として扱う」
// 擬似日付（内部エポック日数）で扱う。時刻成分は捨てる。

/** yyyy-MM-dd を「JST暦日の00:00をUTCとみなす」エポックms へ。 */
export function ymdToEpoch(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** ISO/timestamptz を JST 暦日(yyyy-MM-dd)へ。 */
export function isoToJstYmd(iso: string): string {
  const t = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const MS = 86400000;
export const epochToDayNum = (epochMs: number): number => Math.floor(epochMs / MS);

/** epoch(ms) に m ヶ月足す（暦月・応当日ベース、JST暦日）。 */
function addMonthsEpoch(epochMs: number, m: number): number {
  const d = new Date(epochMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate());
}
const addDaysEpoch = (epochMs: number, days: number): number => epochMs + days * MS;

const normCycleMonths = (m?: number | null): number => (m && m > 0 ? Math.floor(m) : 1);
const normGraceDays = (g?: number | null): number => (g && g > 0 ? Math.floor(g) : 0);

export interface Win {
  start: number; // epoch ms（JST暦日00:00）
  end: number; // 排他上限
}

/** クライアント getCycleWindow と同じ [start, end)（end=アニバーサリー翌日）。 */
export function getCycleWindow(startYmd: string, targetEpoch: number, cycleMonths?: number | null): Win {
  const m = normCycleMonths(cycleMonths);
  const initial = ymdToEpoch(startYmd);
  if (targetEpoch < initial) {
    return { start: initial, end: addDaysEpoch(addMonthsEpoch(initial, m), 1) };
  }
  let start = initial;
  while (addMonthsEpoch(start, m) < targetEpoch) {
    start = addDaysEpoch(addMonthsEpoch(start, m), 1);
  }
  return { start, end: addDaysEpoch(addMonthsEpoch(start, m), 1) };
}

const countInRange = (dates: number[], from: number, toExclusive: number): number =>
  dates.filter((d) => d >= from && d < toExclusive).length;

/** クライアント graceLentToPrevCount と同じ（猶予で前サイクルへ繰り入れる件数）。 */
function graceLent(
  startYmd: string,
  maxSessions: number | null,
  cycleMonths: number | null | undefined,
  graceDays: number,
  win: Win,
  dates: number[],
): number {
  if (graceDays <= 0 || maxSessions == null || maxSessions <= 0) return 0;
  const startISO = ymdToEpoch(startYmd);
  if (win.start <= startISO) return 0;
  const prev = getCycleWindow(startYmd, addDaysEpoch(win.start, -1), cycleMonths);
  const prevCount = countInRange(dates, prev.start, win.start);
  const capacity = maxSessions - prevCount;
  if (capacity <= 0) return 0;
  const graceTailEnd = addDaysEpoch(win.start, graceDays);
  const tailEnd = graceTailEnd < win.end ? graceTailEnd : win.end;
  const tailCount = countInRange(dates, win.start, tailEnd);
  return Math.min(capacity, tailCount);
}

export interface EffectiveUsage {
  windowStart: number;
  windowEnd: number; // 排他上限（最終利用日 = end - 1日）
  used: number;
  remaining: number | null; // 無制限は null
  isUnlimited: boolean;
  periodPending: boolean;
}

/**
 * クライアント resolveEffectiveCycle + computePlanUsage（subscription 分岐）と同じ結果。
 * bookingIsos: そのお客様の非キャンセル予約の booking_date（ISO）配列。
 * 「新ルーティンの1回目がまだ未来なら現在の窓を維持」ロジック（#80）も含む。
 */
export function computeSubscriptionUsage(params: {
  startYmd: string;
  maxSessions: number | null;
  cycleMonths?: number | null;
  graceDays?: number | null;
  bookingIsos: string[];
  nowJstYmd: string;
}): EffectiveUsage | null {
  const { startYmd, maxSessions, cycleMonths, graceDays: g, bookingIsos, nowJstYmd } = params;
  if (!startYmd) return null;
  const graceDays = normGraceDays(g);
  const dates = bookingIsos.map((iso) => ymdToEpoch(isoToJstYmd(iso))).sort((a, b) => a - b);
  const refDay = ymdToEpoch(nowJstYmd);

  let anchor = startYmd;
  let win = getCycleWindow(anchor, ymdToEpoch(anchor), cycleMonths);

  const summarize = (w: Win, key: string) => {
    const lent = graceLent(key, maxSessions, cycleMonths, graceDays, w, dates);
    const inWin = dates.filter((d) => d >= w.start && d < w.end);
    return { lent, inWin };
  };

  const isUnlimited = maxSessions == null;

  for (let i = 0; i < 240; i++) {
    const { lent, inWin } = summarize(win, anchor);
    if (maxSessions != null && maxSessions > 0 && inWin.length - lent > maxSessions) {
      const rollDate = inWin[lent + maxSessions];
      if (rollDate > refDay) {
        // 1回目がまだ未来 → 現在の窓を維持、消化は上限で頭打ち
        return finalize(win, maxSessions, isUnlimited);
      }
      const newKey = isoToJstYmd(new Date(rollDate).toISOString());
      if (ymdToEpoch(newKey) <= ymdToEpoch(anchor)) break;
      anchor = newKey;
      win = getCycleWindow(anchor, rollDate, cycleMonths);
      continue;
    }
    if (refDay < win.end) {
      const used = Math.max(0, inWin.length - lent);
      return finalize(win, used, isUnlimited);
    }
    const next = dates.find((d) => d >= win.end);
    const target = next != null && next < refDay ? next : refDay;
    win = getCycleWindow(anchor, target, cycleMonths);
  }
  const { lent, inWin } = summarize(win, anchor);
  return finalize(win, Math.max(0, inWin.length - lent), isUnlimited);

  function finalize(w: Win, used: number, unlimited: boolean): EffectiveUsage {
    const remaining = unlimited || maxSessions == null ? null : Math.max(0, maxSessions - used);
    return {
      windowStart: w.start,
      windowEnd: w.end,
      used,
      remaining,
      isUnlimited: unlimited,
      periodPending: !unlimited && used === 0,
    };
  }
}

/** 期限前リマインドの節目判定。最終利用日(= windowEnd-1日)までの暦日残り日数。 */
export function periodReminderDaysLeft(windowEndEpoch: number, nowJstYmd: string): number {
  const lastDay = addDaysEpoch(windowEndEpoch, -1);
  return epochToDayNum(lastDay) - epochToDayNum(ymdToEpoch(nowJstYmd));
}
