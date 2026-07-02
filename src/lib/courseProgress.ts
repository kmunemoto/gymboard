import { addMonths, addDays, parseISO, startOfDay } from "date-fns";
import { PlanType, planOptions } from "./dummyData";
import { getJSTNow, toJSTDate } from "./timezone";

/**
 * Plan名から月間セッション回数を導出
 * 通い放題は -1 (= 上限なし)、未設定/不明は null
 */
export const getMonthlySessionCount = (plan: string | null | undefined): number | null => {
  if (!plan) return null;
  if (plan === "通い放題") return -1;
  // "月4回" / "月6回" / "月8回" のような形式から数字を抽出
  const match = plan.match(/月(\d+)回/);
  if (match) return parseInt(match[1], 10);
  return null;
};

export interface CycleWindow {
  start: Date;
  end: Date;
}

/** サイクル月数を正規化（未設定/不正は1）。 */
const normCycleMonths = (cycleMonths?: number | null): number =>
  cycleMonths && cycleMonths > 0 ? Math.floor(cycleMonths) : 1;

/**
 * プラン名 + tenant_plans 定義からサイクル月数を解決する（既定 1）。
 * ジム／プランごとに利用期間（応当日ベースの月数）を設定できる。
 */
export const resolveCycleMonths = (
  planName: string | null | undefined,
  tenantPlans: ReadonlyArray<{ plan_name: string; cycle_months?: number | null }> | null | undefined,
): number => {
  if (!planName || !tenantPlans) return 1;
  const p = tenantPlans.find((tp) => tp.plan_name === planName);
  return normCycleMonths(p?.cycle_months);
};

/**
 * cycle_start_date を起算日として、targetDate を含むサイクル期間 [start, end) を求める。
 * cycleMonths でサイクルの長さ（月数・応当日ベース）を指定できる（既定 1ヶ月）。
 *
 * 仕様: アニバーサリー日（起算日の cycleMonths ヶ月後の同日）は「前サイクルの最終日」として扱う。
 * 例: cycle_start_date = 2026-05-19, cycleMonths=1 の場合
 *   - サイクル1: 2026-05-19 〜 2026-06-19（6/19 を含む）
 *   - サイクル2: 2026-06-20 〜 2026-07-19（6/20 から開始）
 * 返り値の end はアニバーサリー翌日の 00:00（排他的上限）。
 * 比較は暦日（startOfDay）基準で行い、時刻成分の影響を排除する。
 */
export const getCycleWindow = (
  cycleStartDate: string | null | undefined,
  targetDate: Date,
  cycleMonths?: number | null,
): CycleWindow | null => {
  if (!cycleStartDate) return null;
  const m = normCycleMonths(cycleMonths);
  const initialStart = parseISO(cycleStartDate);
  const targetDay = startOfDay(targetDate);

  // 契約起算日より前は、最初のサイクルを返す（架空の「前回」を作らない）
  if (targetDay < initialStart) {
    return { start: initialStart, end: addDays(addMonths(initialStart, m), 1) };
  }

  // アニバーサリー日（addMonths(start,m)）が targetDay より「厳密に前」のときだけ次サイクルへ進める。
  // → アニバーサリー日と一致する日は現サイクルに含める。
  let start = initialStart;
  while (addMonths(start, m) < targetDay) {
    start = addDays(addMonths(start, m), 1);
  }
  return { start, end: addDays(addMonths(start, m), 1) };
};

export interface BookingForProgress {
  id: string;
  booking_date: string; // ISO string
  status: string;
}

export interface CourseProgress {
  /** 0回目（未設定や対象外）なら null */
  cycle: CycleWindow | null;
  monthlyTotal: number | null; // -1 = 通い放題, null = 未設定
  /** サイクル内の有効予約（キャンセル除外、日時順） */
  cycleBookings: BookingForProgress[];
  /** 実施済み（過去）件数 */
  completedCount: number;
  /** 予約済み（未来）件数 */
  upcomingCount: number;
  /** 合計（completed + upcoming） */
  totalUsed: number;
  isUnlimited: boolean;
  isUnconfigured: boolean;
}

export const computeCourseProgress = (
  cycleStartDate: string | null | undefined,
  plan: string | null | undefined,
  bookings: BookingForProgress[],
  referenceDate: Date = getJSTNow(),
  cycleMonths?: number | null,
): CourseProgress => {
  const monthlyTotal = getMonthlySessionCount(plan);
  const isUnlimited = monthlyTotal === -1;
  const isUnconfigured = monthlyTotal === null || !cycleStartDate;

  const cycle = getCycleWindow(cycleStartDate, referenceDate, cycleMonths);

  if (!cycle) {
    return {
      cycle: null,
      monthlyTotal,
      cycleBookings: [],
      completedCount: 0,
      upcomingCount: 0,
      totalUsed: 0,
      isUnlimited,
      isUnconfigured,
    };
  }

  const now = referenceDate;
  const cycleBookings = bookings
    .filter((b) => b.status !== "キャンセル済み")
    .filter((b) => {
      // 予約は絶対時刻。JST擬似Dateの窓と比較するため toJSTDate でJST基準に揃える
      // （端末TZがJST以外でもサイクル判定が1日ずれないように）。
      const d = toJSTDate(b.booking_date);
      return d >= cycle.start && d < cycle.end;
    })
    .sort((a, b) => new Date(a.booking_date).getTime() - new Date(b.booking_date).getTime());

  const completedCount = cycleBookings.filter((b) => toJSTDate(b.booking_date) <= now).length;
  const upcomingCount = cycleBookings.length - completedCount;

  return {
    cycle,
    monthlyTotal,
    cycleBookings,
    completedCount,
    upcomingCount,
    totalUsed: cycleBookings.length,
    isUnlimited,
    isUnconfigured,
  };
};

/**
 * 新しく作る予約が「次のルーティンの1回目」なら true（起算日をその日に合わせてよい）。
 *
 * ジムの運用「期限は1回目のトレーニング日から1ヶ月」に合わせるための判定。
 * 発動する条件（すべて安全側）:
 *   - 起算日が未設定（初回契約）
 *   - 予約日を含むサイクル窓に有効予約が0件で、かつ
 *       (a) その窓が最初の窓（＝起算日リセット直後・未使用の起算日）か、
 *       (b) 直前のサイクルを回数上限まで消化済み（きっちり使い切って次へ）
 * 発動しない例: 「大目に見た消化」（前サイクル未消化のまま期限超過で消化した回）は
 * (b) を満たさないため起算日は動かない。無制限プランは (a) のみ。
 * 過去日への予約（起算日より前）は動かさない。
 */
export const shouldRebaseCycleStart = (params: {
  cycleStartDate: string | null | undefined;
  /** プランの回数上限。null = 無制限 */
  maxSessions: number | null;
  cycleMonths?: number | null;
  /** 新規予約の日付キー（yyyy-MM-dd） */
  bookingDateKey: string;
  /** その顧客の既存予約（新規作成分は含めない） */
  existingBookings: BookingForProgress[];
}): boolean => {
  const { cycleStartDate, maxSessions, cycleMonths, bookingDateKey, existingBookings } = params;
  if (!cycleStartDate) return true; // 起算日未設定 → 1回目の予約日を起算日に

  // 起算日より過去の日付への予約（過去分の記録など）では動かさない
  if (bookingDateKey < cycleStartDate) return false;

  const active = existingBookings.filter((b) => b.status !== "キャンセル済み");
  const window = getCycleWindow(cycleStartDate, parseISO(bookingDateKey), cycleMonths);
  if (!window) return false;

  const inWindow = active.filter((b) => {
    const d = toJSTDate(b.booking_date);
    return d >= window.start && d < window.end;
  }).length;
  if (inWindow > 0) return false; // すでにこのルーティンの予約がある

  // 最初の窓（リセット直後・まだ一度も使っていない起算日）なら予約日に合わせる
  if (window.start.getTime() === startOfDay(parseISO(cycleStartDate)).getTime()) return true;

  // ロール済みの窓: 直前サイクルを上限まで消化済みのときだけ「次のルーティン」とみなす
  if (maxSessions == null || maxSessions <= 0) return false; // 無制限は自動では動かさない
  const prevWindow = getCycleWindow(cycleStartDate, addDays(window.start, -1), cycleMonths);
  if (!prevWindow) return false;
  const prevCount = active.filter((b) => {
    const d = toJSTDate(b.booking_date);
    return d >= prevWindow.start && d < prevWindow.end;
  }).length;
  return prevCount >= maxSessions;
};

/**
 * 特定の予約がそのお客様の今回の何回目に当たるかを返す
 * 戻り値: { index: 1始まり, total: 月間回数 or null(通い放題/未設定) }
 */
export const getBookingProgressIndex = (
  bookingId: string,
  cycleStartDate: string | null | undefined,
  plan: string | null | undefined,
  bookings: BookingForProgress[],
  cycleMonths?: number | null,
): { index: number; total: number | null; isUnlimited: boolean; isUnconfigured: boolean; isOverflow: boolean } | null => {
  const target = bookings.find((b) => b.id === bookingId);
  if (!target) return null;
  const targetDate = toJSTDate(target.booking_date);
  const progress = computeCourseProgress(cycleStartDate, plan, bookings, targetDate, cycleMonths);
  if (!progress.cycle) {
    return { index: 0, total: progress.monthlyTotal, isUnlimited: progress.isUnlimited, isUnconfigured: progress.isUnconfigured, isOverflow: false };
  }
  const rawIndex = progress.cycleBookings.findIndex((b) => b.id === bookingId) + 1;
  if (rawIndex === 0) return null;
  const total = progress.monthlyTotal;
  // ルーティン循環: プラン回数を超えたら次のルーティンの1回目として扱う
  const index = (!progress.isUnlimited && total !== null && total > 0)
    ? ((rawIndex - 1) % total) + 1
    : rawIndex;

  return {
    index,
    total,
    isUnlimited: progress.isUnlimited,
    isUnconfigured: progress.isUnconfigured,
    isOverflow: false,
  };
};
