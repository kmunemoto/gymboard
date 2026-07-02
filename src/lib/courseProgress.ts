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

/** 猶予日数を正規化（未設定/不正は0＝猶予なし）。 */
const normGraceDays = (graceDays?: number | null): number =>
  graceDays && graceDays > 0 ? Math.floor(graceDays) : 0;

/**
 * プラン名 + tenant_plans 定義から猶予日数を解決する（既定 0）。
 * 「期限を graceDays 日過ぎても、前サイクルが未消化なら前サイクル分として大目に見る」。
 */
export const resolveGraceDays = (
  planName: string | null | undefined,
  tenantPlans: ReadonlyArray<{ plan_name: string; grace_days?: number | null }> | null | undefined,
): number => {
  if (!planName || !tenantPlans) return 0;
  const p = tenantPlans.find((tp) => tp.plan_name === planName);
  return normGraceDays(p?.grace_days);
};

type DatedBooking = { booking_date: string; status: string };

const countActiveInRange = (bookings: DatedBooking[], from: Date, toExclusive: Date): number =>
  bookings.filter((b) => {
    if (b.status === "キャンセル済み") return false;
    const d = toJSTDate(b.booking_date);
    return d >= from && d < toExclusive;
  }).length;

/**
 * 猶予（grace）で「参照サイクル窓 [windowStart, windowEnd) の中から、直前サイクルへ
 * 繰り入れる（大目に見た消化とみなす）予約の件数」を返す。
 * = min(直前サイクルの残り回数, 猶予帯 [windowStart, windowStart+graceDays) の予約数)。
 * この件数を現サイクルの消化数から差し引くことで、大目に見た回が「新サイクルの1回目」
 * として誤表示されるのを防ぐ。無制限プラン・graceDays=0・最初の窓では 0。
 */
export const graceLentToPrevCount = (params: {
  cycleStartDate: string;
  maxSessions: number | null;
  cycleMonths?: number | null;
  graceDays?: number | null;
  windowStart: Date;
  windowEnd: Date;
  bookings: DatedBooking[];
}): number => {
  const graceDays = normGraceDays(params.graceDays);
  const { maxSessions, cycleStartDate, cycleMonths, windowStart, windowEnd, bookings } = params;
  if (graceDays <= 0 || maxSessions == null || maxSessions <= 0) return 0;
  const startISO = startOfDay(parseISO(cycleStartDate));
  if (windowStart.getTime() <= startISO.getTime()) return 0; // 最初の窓＝前サイクル無し
  const prev = getCycleWindow(cycleStartDate, addDays(windowStart, -1), cycleMonths);
  if (!prev) return 0;
  const prevCount = countActiveInRange(bookings, prev.start, windowStart);
  const capacity = maxSessions - prevCount;
  if (capacity <= 0) return 0;
  const graceTailEnd = addDays(windowStart, graceDays);
  // 猶予帯（窓の先頭 graceDays 日）の予約数。窓を越える分は含めない。
  const tailEnd = graceTailEnd < windowEnd ? graceTailEnd : windowEnd;
  const tailCount = countActiveInRange(bookings, windowStart, tailEnd);
  return Math.min(capacity, tailCount);
};

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
 *   - 予約日を含むサイクル窓に「前サイクルへ繰り入れない」有効予約が0件で、かつ
 *       (a) その窓が最初の窓（＝起算日リセット直後・未使用の起算日）か、
 *       (b) 直前のサイクルを回数上限まで消化済み（きっちり使い切って次へ）
 * 発動しない例: 「大目に見た消化」（前サイクル未消化のまま期限を graceDays 日まで
 * 超過して消化した回）は前サイクル分として繰り入れられるため起算日は動かない。
 * 無制限プランは (a) のみ。過去日への予約（起算日より前）は動かさない。
 *
 * graceDays（猶予日数）を渡すと、猶予帯 [window.start, window.start+graceDays) の予約は
 * 前サイクルに空きがある限り前サイクル分とみなし、(b) の「上限まで消化済み」判定にも
 * 繰り入れて数える（graceDays=0 は従来挙動と完全一致）。
 */
export const shouldRebaseCycleStart = (params: {
  cycleStartDate: string | null | undefined;
  /** プランの回数上限。null = 無制限 */
  maxSessions: number | null;
  cycleMonths?: number | null;
  /** 猶予日数（既定 0＝猶予なし） */
  graceDays?: number | null;
  /** 新規予約の日付キー（yyyy-MM-dd） */
  bookingDateKey: string;
  /** その顧客の既存予約（新規作成分は含めない） */
  existingBookings: BookingForProgress[];
}): boolean => {
  const { cycleStartDate, maxSessions, cycleMonths, bookingDateKey, existingBookings } = params;
  if (!cycleStartDate) return true; // 起算日未設定 → 1回目の予約日を起算日に

  // 起算日より過去の日付への予約（過去分の記録など）では動かさない
  if (bookingDateKey < cycleStartDate) return false;

  const graceDays = normGraceDays(params.graceDays);
  const active = existingBookings.filter((b) => b.status !== "キャンセル済み");
  const bookingDate = parseISO(bookingDateKey);
  const window = getCycleWindow(cycleStartDate, bookingDate, cycleMonths);
  if (!window) return false;

  const isFirstWindow = window.start.getTime() === startOfDay(parseISO(cycleStartDate)).getTime();

  // 猶予: この予約自身が「大目に見た前サイクル分」に繰り入れられるなら次のルーティンではない
  if (graceDays > 0 && !isFirstWindow && maxSessions != null && maxSessions > 0) {
    const graceTailEnd = addDays(window.start, graceDays);
    const inGraceTail = bookingDate >= window.start && bookingDate < graceTailEnd;
    if (inGraceTail) {
      const prevWindow = getCycleWindow(cycleStartDate, addDays(window.start, -1), cycleMonths);
      if (prevWindow) {
        const prevCount = countActiveInRange(active, prevWindow.start, window.start);
        const prevCapacity = maxSessions - prevCount;
        // 自分より前に猶予帯へ入った予約が先に前サイクルへ充当される
        const tailBefore = countActiveInRange(active, window.start, bookingDate);
        if (prevCapacity > 0 && tailBefore < prevCapacity) return false;
      }
    }
  }

  // 現サイクル窓の予約から前サイクルへ繰り入れる分（大目に見た消化）を除いた「本来の」件数
  const inWindow = countActiveInRange(active, window.start, window.end);
  const lent = graceLentToPrevCount({
    cycleStartDate,
    maxSessions,
    cycleMonths,
    graceDays,
    windowStart: window.start,
    windowEnd: window.end,
    bookings: active,
  });
  const coreInWindow = inWindow - lent;
  if (coreInWindow > 0) return false; // すでにこのルーティンの（繰り入れ以外の）予約がある

  // 最初の窓（リセット直後・まだ一度も使っていない起算日）なら予約日に合わせる
  if (isFirstWindow) return true;

  // ロール済みの窓: 直前サイクルを上限まで消化済みのときだけ「次のルーティン」とみなす
  if (maxSessions == null || maxSessions <= 0) return false; // 無制限は自動では動かさない
  const prevWindow = getCycleWindow(cycleStartDate, addDays(window.start, -1), cycleMonths);
  if (!prevWindow) return false;
  // 前サイクルの物理予約数 + 猶予で繰り入れた分が上限に達していれば「次のルーティン」
  const prevCount = countActiveInRange(active, prevWindow.start, window.start);
  return prevCount + lent >= maxSessions;
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
