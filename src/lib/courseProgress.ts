import { addMonths, addDays, format, parseISO, startOfDay } from "date-fns";
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
 * graceEnabled（profiles.grace_enabled）が false のお客様には適用しない（=0）。
 * null/undefined は「適用する」（既定）。
 */
export const resolveGraceDays = (
  planName: string | null | undefined,
  tenantPlans: ReadonlyArray<{ plan_name: string; grace_days?: number | null }> | null | undefined,
  graceEnabled?: boolean | null,
): number => {
  if (graceEnabled === false) return 0;
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
 * サイクル窓 [start, end) に入る有効予約（キャンセル除外）を日時順で返す。
 * 予約は絶対時刻なので、JST擬似Dateの窓と比較するため toJSTDate でJST基準に揃える
 * （端末TZがJST以外でもサイクル判定が1日ずれないように）。
 */
const activeBookingsInWindow = <T extends DatedBooking>(bookings: T[], window: CycleWindow): T[] =>
  bookings
    .filter((b) => b.status !== "キャンセル済み")
    .filter((b) => {
      const d = toJSTDate(b.booking_date);
      return d >= window.start && d < window.end;
    })
    .sort((a, b) => new Date(a.booking_date).getTime() - new Date(b.booking_date).getTime());

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
 * 予約実績から referenceDate 時点の「実効サイクル」（起算日と窓）を解決する。
 *
 * ジムの運用「期限は1回目のトレーニング日から1ヶ月・回数を使い切ったら次のルーティン」に合わせ、
 * サイクル窓内の有効予約（猶予繰入を除く）が回数上限を超えた場合は、(上限+1)回目の予約日を
 * 新しい起算日として窓を引き直す。期限の終わりを待たず、期限内に始まった新しい1回目から
 * 次のルーティンが始まる。referenceDate を含む窓に到達するまで繰り返す。
 *
 * ただしロールは「新ルーティンの1回目の日が実際に来てから」。1回目がまだ未来の予約なら、
 * その日までは現在の窓（ジムが設定した利用期間）のまま表示し、超過予約は次ルーティン分
 * として消化数に数えない（上限で頭打ち）。
 * 上限なし（通い放題）・回数不明のプランではロールせず、従来の暦窓と一致する。
 */
export const resolveEffectiveCycle = (params: {
  cycleStartDate: string;
  maxSessions: number | null;
  cycleMonths?: number | null;
  graceDays?: number | null;
  bookings: DatedBooking[];
  referenceDate: Date;
  /** 表示用: サイクル窓を「実際の1回目のトレーニング日」起点に引き直す（既定 false=暦窓のまま） */
  anchorToFirstBooking?: boolean;
}): { cycleStartDate: string; window: CycleWindow; lent: number; used: number } | null => {
  const { maxSessions, cycleMonths, graceDays, bookings, referenceDate, anchorToFirstBooking } = params;
  let anchorKey = params.cycleStartDate;
  if (!anchorKey) return null;
  let window = getCycleWindow(anchorKey, startOfDay(parseISO(anchorKey)), cycleMonths);
  if (!window) return null;

  const refDay = startOfDay(referenceDate);
  const active = bookings.filter((b) => b.status !== "キャンセル済み");
  const activeDates = active
    .map((b) => toJSTDate(b.booking_date))
    .sort((a, b) => a.getTime() - b.getTime());

  const summarize = (w: CycleWindow, key: string) => {
    const lent = graceLentToPrevCount({
      cycleStartDate: key,
      maxSessions,
      cycleMonths,
      graceDays,
      windowStart: w.start,
      windowEnd: w.end,
      bookings: active,
    });
    const inWindow = activeDates.filter((d) => d >= w.start && d < w.end);
    return { lent, inWindow };
  };

  // 解決した窓を「実際の1回目のトレーニング日」起点に引き直して返す（表示用）。
  // ジムの運用「期限は1回目のトレーニング日から1ヶ月」に合わせ、暦の応当日境界（例 7/1）ではなく
  // そのサイクルで最初に予約した日（例 7/5）を利用期間の開始として見せる。
  // 猶予繰入分（lent）はこのサイクルの消化ではないので、繰入を除いた最初の予約（＝本来の1回目）を基準にする。
  // anchorToFirstBooking=false（既定, rebase 判定など内部用途）では引き直さず暦窓のまま返す。
  const finalizeWindow = (
    w: CycleWindow,
    lent: number,
    inWindow: Date[],
  ): { cycleStartDate: string; window: CycleWindow; lent: number; used: number } => {
    const used = Math.max(0, inWindow.length - lent);
    if (anchorToFirstBooking && used > 0) {
      const firstCore = inWindow[lent]; // 繰入分を飛ばした最初の予約＝本来の1回目
      if (firstCore && startOfDay(firstCore).getTime() > w.start.getTime()) {
        const key = format(startOfDay(firstCore), "yyyy-MM-dd");
        const rebased = getCycleWindow(key, firstCore, cycleMonths);
        if (rebased) return { cycleStartDate: key, window: rebased, lent, used };
      }
    }
    return { cycleStartDate: anchorKey, window: w, lent, used };
  };

  for (let i = 0; i < 240; i++) {
    const { lent, inWindow } = summarize(window, anchorKey);
    if (maxSessions != null && maxSessions > 0 && inWindow.length - lent > maxSessions) {
      // 回数上限を超過 → (上限+1)回目（猶予繰入はスキップ）の予約日を新しい起算日にロール
      const rollDate = inWindow[lent + maxSessions];
      // ただし新ルーティンの1回目がまだ先の日付なら、その日が来るまでは現在の窓のまま表示する
      // （ジムが設定した利用期間を維持。超過予約は次ルーティン分なので消化数は上限で頭打ち）。
      if (startOfDay(rollDate) > refDay) {
        return finalizeWindow(window, lent, inWindow.slice(0, lent + maxSessions));
      }
      const newKey = format(rollDate, "yyyy-MM-dd");
      if (newKey <= anchorKey) break; // 同日多重予約などでの無限ループ防止
      anchorKey = newKey;
      window = getCycleWindow(anchorKey, rollDate, cycleMonths)!;
      continue;
    }
    if (refDay < window.end) {
      return finalizeWindow(window, lent, inWindow);
    }
    // referenceDate はこの窓より後 → 次に予約のある日（無ければ referenceDate）まで暦窓を進める
    const next = activeDates.find((d) => d >= window.end);
    const target = next && next < refDay ? next : refDay;
    window = getCycleWindow(anchorKey, target, cycleMonths)!;
  }

  // ガード超過時のフォールバック（通常は到達しない）
  const w = getCycleWindow(anchorKey, referenceDate, cycleMonths)!;
  const { lent, inWindow } = summarize(w, anchorKey);
  return finalizeWindow(w, lent, inWindow);
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
  const cycleBookings = activeBookingsInWindow(bookings, cycle);

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
 * 判定は resolveEffectiveCycle が返す実効サイクル（回数使い切りによるロール反映後）で行う。
 * 発動する条件:
 *   - 起算日が未設定（初回契約）
 *   - 実効サイクル窓で回数上限を使い切った後の期限内予約（＝新ルーティンの1回目。
 *     期限の終わりを待たずに予約日へ起算日を合わせる）
 *   - 予約日を含む窓に「前サイクルへ繰り入れない」有効予約が0件で、かつ
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

  // 実効サイクル: 回数を使い切って期限内に始まった新ルーティンがあれば、その起算日・窓で判定する
  const eff = resolveEffectiveCycle({
    cycleStartDate,
    maxSessions,
    cycleMonths,
    graceDays,
    bookings: active,
    referenceDate: bookingDate,
  });
  if (!eff) return false;
  const { window, lent } = eff;
  const effStartKey = eff.cycleStartDate;
  if (bookingDateKey < effStartKey) return false; // 実効起算日より前への予約では動かさない

  const isFirstWindow = window.start.getTime() === startOfDay(parseISO(effStartKey)).getTime();

  // 猶予: この予約自身が「大目に見た前サイクル分」に繰り入れられるなら次のルーティンではない
  if (graceDays > 0 && !isFirstWindow && maxSessions != null && maxSessions > 0) {
    const graceTailEnd = addDays(window.start, graceDays);
    const inGraceTail = bookingDate >= window.start && bookingDate < graceTailEnd;
    if (inGraceTail) {
      const prevWindow = getCycleWindow(effStartKey, addDays(window.start, -1), cycleMonths);
      if (prevWindow) {
        const prevCount = countActiveInRange(active, prevWindow.start, window.start);
        const prevCapacity = maxSessions - prevCount;
        // 自分より前に猶予帯へ入った予約が先に前サイクルへ充当される
        const tailBefore = countActiveInRange(active, window.start, bookingDate);
        if (prevCapacity > 0 && tailBefore < prevCapacity) return false;
      }
    }
  }

  // 回数を使い切った後の期限内予約は「次のルーティンの1回目」→ 予約日を起算日に
  // （期限の終わりを待たずにロール。予約日より前の有効予約が上限に達しているかで判定）
  if (maxSessions != null && maxSessions > 0) {
    const graceTailEnd = addDays(window.start, graceDays);
    const lentLimit = graceTailEnd < bookingDate ? graceTailEnd : bookingDate;
    const lentBefore = Math.min(lent, countActiveInRange(active, window.start, lentLimit));
    const before = countActiveInRange(active, window.start, bookingDate) - lentBefore;
    if (before >= maxSessions) return true;
  }

  // 現サイクル窓の予約から前サイクルへ繰り入れる分（大目に見た消化）を除いた「本来の」件数
  const inWindow = countActiveInRange(active, window.start, window.end);
  const coreInWindow = inWindow - lent;
  if (coreInWindow > 0) return false; // すでにこのルーティンの（繰り入れ以外の）予約がある

  // 最初の窓（リセット直後・まだ一度も使っていない起算日）なら予約日に合わせる
  if (isFirstWindow) return true;

  // ロール済みの窓: 直前サイクルを上限まで消化済みのときだけ「次のルーティン」とみなす
  if (maxSessions == null || maxSessions <= 0) return false; // 無制限は自動では動かさない
  const prevWindow = getCycleWindow(effStartKey, addDays(window.start, -1), cycleMonths);
  if (!prevWindow) return false;
  // 前サイクルの物理予約数 + 猶予で繰り入れた分が上限に達していれば「次のルーティン」
  const prevCount = countActiveInRange(active, prevWindow.start, window.start);
  return prevCount + lent >= maxSessions;
};

/**
 * 特定の予約がそのお客様の今回の何回目に当たるかを返す
 * 戻り値: { index: 1始まり, total: 月間回数 or null(通い放題/未設定) }
 *
 * 数える窓は暦の応当日窓ではなく resolveEffectiveCycle が返す「実効サイクル」で決める
 * （プロフィールの「予約済み n/N」を出す computePlanUsage と同じ窓）。
 * このジムの運用では回数を使い切った時点で、期限の終わりを待たずに次のルーティンが始まる。
 * 暦窓のまま数えると、新ルーティンの途中で応当日をまたいだ予約がその窓の1件目になり、
 * プロフィールの回数とチップの回数がずれる。
 * 例: 起算日 6/30・月4回で 6/30, 7/8, 7/13, 7/21, 7/28, 8/7 と予約したケース。
 *     7/28 から新ルーティンが始まっているのに、暦窓 [7/31, 8/31) では 8/7 が窓の1件目になり、
 *     2/4 と出るべきチップが 1/4 と表示されていた。
 *
 * graceDays（猶予日数）を渡すと、期限明けの猶予帯で前サイクルへ繰り入れられた
 * 予約（大目に見た消化）は「前サイクルの続きの回数」として数える。
 * 例: 月8回・前サイクル7回消化・期限翌日の予約 → 「8/8」（新ルーティンの1/8ではなく）。
 */
export const getBookingProgressIndex = (
  bookingId: string,
  cycleStartDate: string | null | undefined,
  plan: string | null | undefined,
  bookings: BookingForProgress[],
  cycleMonths?: number | null,
  graceDays?: number | null,
): { index: number; total: number | null; isUnlimited: boolean; isUnconfigured: boolean; isOverflow: boolean; isGraceCarryover: boolean } | null => {
  const target = bookings.find((b) => b.id === bookingId);
  if (!target) return null;
  const targetDate = toJSTDate(target.booking_date);
  const progress = computeCourseProgress(cycleStartDate, plan, bookings, targetDate, cycleMonths);
  if (!progress.cycle) {
    return { index: 0, total: progress.monthlyTotal, isUnlimited: progress.isUnlimited, isUnconfigured: progress.isUnconfigured, isOverflow: false, isGraceCarryover: false };
  }
  const total = progress.monthlyTotal;

  // 暦窓（computeCourseProgress）を実効サイクルの窓に置き換える。
  // 回数上限のあるプランだけが対象で、通い放題・未設定は暦窓のまま（従来どおり）。
  let cycle = progress.cycle;
  let cycleBookings = progress.cycleBookings;
  let effStartKey = cycleStartDate ?? "";
  let lent = 0;
  if (!progress.isUnlimited && total !== null && total > 0 && cycleStartDate) {
    const eff = resolveEffectiveCycle({
      cycleStartDate,
      maxSessions: total,
      cycleMonths,
      graceDays,
      bookings,
      referenceDate: targetDate,
    });
    if (eff) {
      cycle = eff.window;
      cycleBookings = activeBookingsInWindow(bookings, eff.window);
      effStartKey = eff.cycleStartDate;
      lent = eff.lent;
    }
  }

  const rawIndex = cycleBookings.findIndex((b) => b.id === bookingId) + 1;
  if (rawIndex === 0) return null;

  // 猶予: この窓の先頭で前サイクルへ繰り入れられた予約なら「前サイクルの n 回目」として返す。
  // 繰り入れは窓先頭の予約から順に（前サイクルの残り回数ぶんまで）適用される。
  if (lent > 0 && total !== null) {
    if (rawIndex <= lent) {
      // 前サイクルの消化数 + 繰入順 = 前サイクルとしての回数（例: 7消化 + 1件目 = 8/8）
      const prevWindow = getCycleWindow(effStartKey, addDays(cycle.start, -1), cycleMonths);
      const prevCount = prevWindow ? countActiveInRange(bookings, prevWindow.start, cycle.start) : 0;
      return {
        index: Math.min(total, prevCount + rawIndex),
        total,
        isUnlimited: progress.isUnlimited,
        isUnconfigured: progress.isUnconfigured,
        isOverflow: false,
        isGraceCarryover: true, // 大目に見た消化（前サイクルへ繰入）
      };
    }
    // 繰入より後の予約は、繰入分を除いた順番で数える（新ルーティンの1回目から）
    const adjusted = rawIndex - lent;
    return {
      index: ((adjusted - 1) % total) + 1,
      total,
      isUnlimited: progress.isUnlimited,
      isUnconfigured: progress.isUnconfigured,
      isOverflow: false,
      isGraceCarryover: false,
    };
  }

  // ルーティン循環: プラン回数を超えたら次のルーティンの1回目として扱う。
  // 実効サイクルを使えば窓が回数上限を超えることは基本的に無いが、同日に上限を超える
  // 予約が入った場合など resolveEffectiveCycle が窓を引き直せないケースの保険として残す。
  const index = (!progress.isUnlimited && total !== null && total > 0)
    ? ((rawIndex - 1) % total) + 1
    : rawIndex;

  return {
    index,
    total,
    isUnlimited: progress.isUnlimited,
    isUnconfigured: progress.isUnconfigured,
    isOverflow: false,
    isGraceCarryover: false,
  };
};
