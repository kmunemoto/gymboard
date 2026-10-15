import { addDays, format, parseISO, startOfDay } from "date-fns";
import { getCycleWindow, resolveEffectiveCycle, type CycleWindow } from "./courseProgress";
import { computePlanUsage, type PlanUsageBooking, type PlanUsageInput } from "./planUsage";
import { getJSTNow, toJSTDate } from "./timezone";

/**
 * お客様の予約カレンダーに出す「利用期間」（2026-10-15）。
 *
 * 宗本さん「お客様が毎回、今回の期間はいつからいつまでかカレンダーに分かりやすく期間を表示する」。
 * 期間外の日を選んだときの一言（「この日から次の期間」）も入れる、店ごとの設定は作らない
 * （お客様ごとの「利用期間の表示」に従う）と決めた。
 *
 * 🔴 期間は**プロフィールのカード（computePlanUsage）と同じ計算**から出す。カレンダーだけ
 *    別に数えると、カードと帯の日付が食い違う。
 * 🔴 「この日を選んだらどの期間の何回目か」は、日付の範囲で決めない。**その日に予約が入ったと
 *    仮定して、回数の計算にそのまま通す**。日付だけで決めると次の2つを必ず間違える:
 *      - 回数を使い切ったあとは、期間内の日でも次の期間の1回目になる
 *      - 猶予（期限後◯日まで前回分として数える）の日は、期間外でも前回分になる
 *    猶予の日はお客様に案内しない（大目に見る運用で、店から勧めるものではない）ので、一言は出さない。
 */

/** カレンダーに出すもの。null は「出さない」（回数券・期間プラン・プラン未設定・体験など） */
export interface CalendarPeriodView {
  /** 今回の利用期間（カードと同じ）。1回目のご予約待ちの間は null */
  current: CycleWindow | null;
  /** 帯を敷く今回の範囲。次の期間が今回の途中から始まる（使い切り）ときは、その前日まで */
  currentBand: CycleWindow | null;
  /** 次の期間（予約がもう入っている、または起算日固定で決まっている）。無ければ null */
  next: CycleWindow | null;
  /** 1回目のご予約待ち（今回の期間がまだ決まっていない） */
  pending: boolean;
  /** 今回の残り回数（カードと同じ）。回数の上限が無いプランは null */
  remaining: number | null;
}

/** 日を選んだときの一言 */
export type PeriodDayHint =
  /** この日が1回目になって、新しい期間が始まる。afterCurrent: 今回の期間のあと（＝「次の期間」） */
  | { kind: "starts"; period: CycleWindow; afterCurrent: boolean }
  /** この日は、今回ではない期間（次の期間など）の count 回目 */
  | { kind: "inPeriod"; period: CycleWindow; count: number }
  | null;

const isSubscription = (input: PlanUsageInput | null | undefined): input is PlanUsageInput =>
  !!input && !!input.startDate && (input.planType ?? "subscription") === "subscription";

const activeTimes = (bookings: PlanUsageBooking[]) =>
  bookings.filter((b) => b.status !== "キャンセル済み").map((b) => ({ b, at: toJSTDate(b.booking_date) }));

/** その日を含む区切り（回数の数え方と同じ。未来の1回目へは先回りしない） */
const cycleAt = (input: PlanUsageInput, bookings: PlanUsageBooking[], day: Date) =>
  resolveEffectiveCycle({
    cycleStartDate: input.startDate!,
    maxSessions: input.maxSessions ?? null,
    cycleMonths: input.cycleMonths,
    cycleUnit: input.cycleUnit,
    graceDays: input.graceDays,
    bookings,
    referenceDate: day,
    reanchorRoutines: true,
    allowOverflow: input.allowOverflow,
    pinned: input.cycleStartPinned === true,
  });

/**
 * ある予約が属する期間と、その中で何回目か。猶予で前の期間へ回る予約は carry。
 * 同じ日に複数あるときは時刻順（回数の数え方と同じ）。
 */
const placeOf = (input: PlanUsageInput, bookings: PlanUsageBooking[], target: PlanUsageBooking) => {
  const at = toJSTDate(target.booking_date);
  const eff = cycleAt(input, bookings, startOfDay(at));
  if (!eff) return null;
  const inWindow = activeTimes(bookings)
    .filter((x) => x.at >= eff.window.start && x.at < eff.window.end)
    .sort((a, c) => a.at.getTime() - c.at.getTime());
  const i = inWindow.findIndex((x) => x.b === target);
  if (i < 0) return null;
  if (i < eff.lent) return { carry: true as const, window: eff.window, count: 0 };
  return { carry: false as const, window: eff.window, count: i - eff.lent + 1 };
};

const sameDay = (a: Date, c: Date) => startOfDay(a).getTime() === startOfDay(c).getTime();

/** カレンダーに出す期間。対象外なら null */
export function calendarPeriods(
  input: PlanUsageInput | null | undefined,
  bookings: PlanUsageBooking[],
  now: Date = getJSTNow(),
): CalendarPeriodView | null {
  if (!isSubscription(input)) return null;
  const usage = computePlanUsage(input, bookings, now);
  if (usage.kind !== "subscription" || !usage.windowStart || !usage.windowEnd) return null;
  const current = usage.periodPending ? null : { start: usage.windowStart, end: usage.windowEnd };

  // 次の期間: 今回より後ろの期間に属する予約のうち、いちばん早いものの期間
  let next: CycleWindow | null = null;
  const from = current?.start ?? startOfDay(now);
  for (const { b, at } of activeTimes(bookings).sort((a, c) => a.at.getTime() - c.at.getTime())) {
    if (at < from) continue;
    const place = placeOf(input, bookings, b);
    if (!place || place.carry) continue;
    if (current && place.window.start.getTime() <= current.start.getTime()) continue;
    next = place.window;
    break;
  }
  // 起算日固定のお客様は、予約が無くても次の期間が暦で決まっている
  if (!next && current && input.cycleStartPinned === true) {
    next = getCycleWindow(input.startDate, current.end, input.cycleMonths, input.cycleUnit);
  }

  const currentBand = current && next && next.start < current.end && next.start > current.start
    ? { start: current.start, end: next.start }
    : current;
  return { current, currentBand, next, pending: current === null, remaining: usage.remaining };
}

/** 「この日に予約したら」の一言。dateKey は yyyy-MM-dd。出さないときは null */
export function periodDayHint(
  input: PlanUsageInput | null | undefined,
  bookings: PlanUsageBooking[],
  dateKey: string,
  view: CalendarPeriodView | null,
): PeriodDayHint {
  if (!isSubscription(input) || !view) return null;
  const day = startOfDay(parseISO(dateKey));
  if (day < startOfDay(parseISO(input.startDate!))) return null;
  const probe: PlanUsageBooking = { booking_date: `${dateKey}T12:00:00+09:00`, status: "予約済み" };
  const place = placeOf(input, [...bookings, probe], probe);
  if (!place || place.carry) return null; // 猶予の日（前回分）は案内しない
  if (view.current && place.window.start.getTime() === view.current.start.getTime()) return null; // 今回の分
  if (place.count === 1 && sameDay(place.window.start, day)) {
    return { kind: "starts", period: place.window, afterCurrent: !!view.current && day >= view.current.start };
  }
  return { kind: "inPeriod", period: place.window, count: place.count };
}

/**
 * 定期予約（毎週くり返し）で、途中から次の期間に入るなら、その回。
 * 1回目（選んだ日）の扱いは periodDayHint が出すので、ここでは2回目以降だけを見る。
 */
export function repeatPeriodBreak(
  input: PlanUsageInput | null | undefined,
  bookings: PlanUsageBooking[],
  dateKey: string,
  weeks: number,
): { dateKey: string; ordinal: number } | null {
  if (!isSubscription(input) || weeks < 2) return null;
  const first = parseISO(dateKey);
  const probes: PlanUsageBooking[] = Array.from({ length: weeks }, (_, i) => ({
    booking_date: `${format(addDays(first, i * 7), "yyyy-MM-dd")}T12:00:00+09:00`,
    status: "予約済み",
  }));
  const all = [...bookings, ...probes];
  /** その回が数えられる期間の開始日（猶予で前の期間へ回る回は、前の期間） */
  const ownerStart = (probe: PlanUsageBooking): number | null => {
    const place = placeOf(input, all, probe);
    if (!place) return null;
    if (!place.carry) return place.window.start.getTime();
    const prev = cycleAt(input, all, addDays(place.window.start, -1));
    return prev ? prev.window.start.getTime() : null;
  };
  let before = ownerStart(probes[0]);
  for (let i = 1; i < probes.length; i++) {
    const owner = ownerStart(probes[i]);
    if (owner != null && before != null && owner !== before) {
      return { dateKey: probes[i].booking_date.slice(0, 10), ordinal: i + 1 };
    }
    before = owner;
  }
  return null;
}

/** 帯の範囲 [start, end) を、カレンダーの「その日を含む」範囲（最終日まで）にする */
export const inclusiveRange = (w: CycleWindow) => ({ from: w.start, to: addDays(w.end, -1) });
