import { addDays, addMonths, format, parseISO, startOfDay } from "date-fns";
import { resolveEffectiveCycle, type CycleWindow } from "./courseProgress";
import {
  PLAN_USAGE_EXCLUDED_PLAN_NAMES,
  resolvePlanUsageInput,
  type PlanUsageBooking,
  type PlanUsageInput,
} from "./planUsage";
import { getJSTNow, toJSTDate } from "./timezone";

/**
 * レポート（月次レポート・トレーニング部位バランス・ホームの「今回のレポート」）の期間。
 *
 * 🔴 **プロフィールのカード（PlanUsageCard / computePlanUsage）の「利用期間」と同じ区切りにする**（2026-10-15）。
 *
 * 回数を「区切りの1回目の日から1ヶ月」で数えるように直したあと、宗本さん「（レポートの期間も）揃えて」。
 * 以前は月次レポートとホームが保存された起算日からの1ヶ月ごと、部位バランスが暦の月（1日〜月末）で
 * 区切っていて、カードの利用期間とずれていた（今の区切りに予約があるお客様29人中13人）。
 *
 * - offset 0 は、カードが今出している利用期間そのもの
 * - offset -1, -2, … はその前の期間。各期間は「区切りの1回目の日から、次の区切りの1回目の前日まで」。
 *   区切りは回数の数え方と同じ（1回目の日から1ヶ月・使い切ったら次へ）なので、期間どうしは
 *   隙間も重なりもなく続き、どの来店もちょうど1つの期間に入る
 * - 区切りの間が数日空いただけなら、その日々は前の期間に含める（数日だけの期間を作らない）。
 *   1ヶ月以上空いたときは、空いた月がそれぞれ1つの期間になる
 * - 猶予で前の区切りへ回した予約（チップの「前回分」）は、前の期間に入れる
 * - 起算日より前は、プランの区切りの長さで1つずつさかのぼる
 * - 月N回などのサブスク以外（回数券・期間プラン）、起算日なし、カードを出さないプランは null。
 *   呼び出し側は従来の期間を使う（他のプランの表示を変えない）
 */
export interface ReportPeriodSource {
  planName: string | null | undefined;
  cycleStartDate: string | null | undefined;
  /** profiles.cycle_start_pinned */
  cycleStartPinned?: boolean | null;
  /** profiles.grace_enabled（false のお客様には猶予を適用しない。カードと同じ） */
  graceEnabled?: boolean | null;
  /** カードに渡しているのと同じプラン一覧（useTenant の allPlans） */
  tenantPlans: ReadonlyArray<TenantPlanLike>;
  /** そのお客様の予約（キャンセル済みを含んでよい。booking_date は ISO） */
  bookings: PlanUsageBooking[];
}

type TenantPlanLike = NonNullable<Parameters<typeof resolvePlanUsageInput>[1]> & { plan_name: string };

/** JST の日付（00:00）。期間は [start, end) */
export type ReportPeriod = CycleWindow;

/** PlanUsageCard と同じ手順で材料を作る。カードを出さないプランは null */
const cardInput = (source: ReportPeriodSource): PlanUsageInput | null => {
  const { planName } = source;
  if (!planName || PLAN_USAGE_EXCLUDED_PLAN_NAMES.has(planName)) return null;
  const tenantPlan = source.tenantPlans.find((p) => p.plan_name === planName) ?? null;
  const input = resolvePlanUsageInput(planName, tenantPlan, source.cycleStartDate, source.cycleStartPinned);
  if (!input) return null;
  if (source.graceEnabled === false) input.graceDays = 0;
  return input;
};

const effectiveCycle = (
  input: PlanUsageInput,
  bookings: PlanUsageBooking[],
  referenceDate: Date,
  mode: "card" | "past",
) =>
  resolveEffectiveCycle({
    cycleStartDate: input.startDate!,
    maxSessions: input.maxSessions ?? null,
    cycleMonths: input.cycleMonths,
    cycleUnit: input.cycleUnit,
    graceDays: input.graceDays,
    bookings,
    referenceDate,
    // card: computePlanUsage（subscription）と同じ。未来の1回目の日にも合わせる＝カードの利用期間そのもの
    // past: 区切りは回数と同じ規則（1回目の日から）。ただし、その日より先の予約へは先回りしない
    ...(mode === "card" ? { anchorToFirstBooking: true } : { reanchorRoutines: true }),
    allowOverflow: input.allowOverflow,
    pinned: input.cycleStartPinned === true,
  });

/**
 * 区切りの先頭で、猶予により前の区切りへ回った予約（lent 件）の最後の日。無ければ null。
 * その日までは前の区切りの期間に入れる。ただし、この区切りの1回目と同じ日なら
 * 1日を分けられないので、この区切りに残す（1回目の日より後ろへは動かさない）。
 */
const carryoverEnd = (window: CycleWindow, lent: number, bookings: PlanUsageBooking[]): Date | null => {
  if (lent <= 0) return null;
  const inWindow = bookings
    .filter((b) => b.status !== "キャンセル済み")
    .map((b) => toJSTDate(b.booking_date))
    .filter((d) => d >= window.start && d < window.end)
    .sort((a, b) => a.getTime() - b.getTime());
  const last = inWindow[lent - 1];
  if (!last) return null;
  const end = addDays(startOfDay(last), 1);
  const firstCore = inWindow[lent];
  if (firstCore && startOfDay(firstCore) < end) return startOfDay(firstCore);
  return end;
};

const stepBack = (d: Date, input: PlanUsageInput): Date => {
  const n = input.cycleMonths && input.cycleMonths > 0 ? Math.floor(input.cycleMonths) : 1;
  if (input.cycleUnit === "weeks") return addDays(d, -7 * n);
  if (input.cycleUnit === "days") return addDays(d, -n);
  return addMonths(d, -n);
};

const hasActiveBooking = (bookings: PlanUsageBooking[], from: Date, toExclusive: Date): boolean =>
  bookings.some((b) => {
    if (b.status === "キャンセル済み") return false;
    const d = toJSTDate(b.booking_date);
    return d >= from && d < toExclusive;
  });

const previousPeriod = (next: ReportPeriod, input: PlanUsageInput, bookings: PlanUsageBooking[]): ReportPeriod => {
  const contractStart = startOfDay(parseISO(input.startDate!));
  let refDay = addDays(next.start, -1);
  for (let guard = 0; guard < 240 && refDay >= contractStart; guard++) {
    const q = effectiveCycle(input, bookings, refDay, "past");
    if (!q || q.window.start >= next.start) break;
    const carry = carryoverEnd(q.window, q.lent, bookings);
    if (carry && refDay < carry) {
      // refDay は前の区切りへ回した予約の日まで → その日々は、さらに前の区切りの期間
      refDay = addDays(q.window.start, -1);
      continue;
    }
    const start = carry ?? q.window.start;
    // 次の区切りの1回目で途中から切られた「来店の無い日々」は、さらに前の期間に含める。
    // 区切りの間が数日空くたびに「7/24〜7/26」のような数日だけの期間ができないように
    // （各期間は「区切りの1回目の日から、次の区切りの1回目の前日まで」になる）。
    // 使い切りで切られた区切り（来店がある）はそのまま1つの期間。
    if (next.start < q.window.end && !hasActiveBooking(bookings, start, next.start)) {
      refDay = addDays(start, -1);
      continue;
    }
    return { start, end: next.start };
  }
  return { start: stepBack(next.start, input), end: next.start };
};

/**
 * カードと同じ区切りでのレポートの期間。offset 0 = 今（カードの利用期間）、-1 = その前、…
 * null は「この仕組みの対象外」（呼び出し側の従来の期間を使う）。
 */
export function reportPeriodAt(
  source: ReportPeriodSource,
  offset: number,
  now: Date = getJSTNow(),
): ReportPeriod | null {
  const input = cardInput(source);
  if (!input || !input.startDate) return null;
  if ((input.planType ?? "subscription") !== "subscription") return null;
  const eff = effectiveCycle(input, source.bookings, now, "card");
  if (!eff) return null;
  let period: ReportPeriod = { start: eff.window.start, end: eff.window.end };
  // 予約の無い今の区切りの先頭に「猶予で前回分に回った予約」があれば、その日までは前の期間
  const carry = carryoverEnd(eff.window, eff.lent, source.bookings);
  if (carry && carry < period.end) period = { start: carry, end: period.end };
  for (let k = 0; k > offset; k--) period = previousPeriod(period, input, source.bookings);
  return period;
}

/** 「10/22〜11/22」（end は含まないので、その前日まで）。カードの「利用期間」と同じ書き方 */
export const reportPeriodLabel = (p: ReportPeriod): string =>
  `${format(p.start, "M/d")}〜${format(addDays(p.end, -1), "M/d")}`;
