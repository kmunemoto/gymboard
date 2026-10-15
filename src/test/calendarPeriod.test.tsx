/**
 * 予約カレンダーに「今回の利用期間」を出す（2026-10-15）。
 *
 * 宗本さん「お客様が毎回、今回の期間はいつからいつまでかカレンダーに分かりやすく期間を表示する」
 * 「（期間外の日を選んだときの一言は）入れる」「（店ごとの設定は）おすすめで」＝作らず、
 * お客様ごとの「利用期間の表示」に従う。
 *
 * 🔴 壊しやすいもの:
 *   1. カードと違う日付の帯（カレンダーだけ別に数える）
 *   2. 「この日から次の期間」を日付の範囲だけで決める
 *      → 使い切ったあとの期間内の日（本当は次の期間の1回目）と、猶予の日（本当は前回分）を間違える
 *   3. 利用期間を出さない設定のお客様に、帯や一言で期限を見せてしまう
 *   4. 日時の変更中に、動かす予約を残したまま数えて1回多くなる
 *   5. 定期予約の途中から次の期間に入ることを伝えない
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, renderHook, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { addDays, format } from "date-fns";
import i18n from "@/lib/i18n";
import { calendarPeriods, periodDayHint, repeatPeriodBreak, type CalendarPeriodView } from "@/lib/calendarPeriod";
import { computePlanUsage, type PlanUsageInput } from "@/lib/planUsage";
import { toJSTDate } from "@/lib/timezone";
import { Calendar } from "@/components/ui/calendar";
import { CalendarPeriodHint, CalendarPeriodLegend, useCalendarPeriod } from "@/components/booking/CalendarPeriod";

// 画面の部品（フック）の「今日」は 10/16 12:00 JST に固定する（スクショの日）
vi.mock("@/lib/timezone", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/timezone")>();
  return { ...orig, getJSTNow: () => orig.toJSTDate("2026-10-16T12:00:00+09:00") };
});

afterEach(cleanup);

const mk = (rows: string[]) => rows.map((d) => ({ booking_date: `${d}:00+09:00`, status: "予約済み" }));
const at = (ymd: string) => toJSTDate(`${ymd}T12:00:00+09:00`);
const lbl = (w: { start: Date; end: Date } | null | undefined) =>
  w ? `${format(w.start, "M/d")}〜${format(addDays(w.end, -1), "M/d")}` : null;
/** 月3回（スクショのお客様と同じプラン）。起算日 10/8 */
const plan = (extra: Partial<PlanUsageInput> = {}): PlanUsageInput => ({
  planType: "subscription", maxSessions: 3, startDate: "2026-10-08", cycleMonths: 1, graceDays: 0,
  allowOverflow: true, cycleStartPinned: false, ...extra,
});
const hint = (input: PlanUsageInput, rows: ReturnType<typeof mk>, day: string, now: string) =>
  periodDayHint(input, rows, day, calendarPeriods(input, rows, at(now)));
const hintText = (h: ReturnType<typeof hint>) =>
  !h ? null : h.kind === "inPeriod" ? `in ${lbl(h.period)} #${h.count}` : `${h.afterCurrent ? "next" : "start"} ${lbl(h.period)}`;

const ONE = mk(["2026-10-08T10:00"]); // 予約済み 1/3（スクショの状態）
const USED_UP = mk(["2026-10-08T10:00", "2026-10-18T10:00", "2026-10-22T10:00"]); // 3/3
const ROLL_KNOWN = mk(["2026-10-08T10:00", "2026-10-18T10:00", "2026-10-22T10:00", "2026-10-30T10:00"]); // 4件目は次の期間

describe("カレンダーに出す期間（カードと同じ）", () => {
  it("🔴 今回の期間はカードの利用期間と同じ（10/8〜11/8・あと2回）", () => {
    const v = calendarPeriods(plan(), ONE, at("2026-10-16"))!;
    const card = computePlanUsage(plan(), ONE, at("2026-10-16"));
    expect(lbl(v.current)).toBe("10/8〜11/8");
    expect(v.current!.start).toEqual(card.windowStart);
    expect(v.current!.end).toEqual(card.windowEnd);
    expect(v.remaining).toBe(2);
    expect(v.next).toBeNull();
    expect(lbl(v.currentBand)).toBe("10/8〜11/8");
  });

  it("次の期間の予約が入っているなら、次の期間も出す。今回の帯は次の期間の前日まで（使い切り）", () => {
    const v = calendarPeriods(plan(), ROLL_KNOWN, at("2026-10-16"))!;
    expect(lbl(v.current)).toBe("10/8〜11/8"); // 説明はカードと同じ
    expect(v.remaining).toBe(0);
    expect(lbl(v.next)).toBe("10/30〜11/30");
    expect(lbl(v.currentBand)).toBe("10/8〜10/29");
  });

  it("期間が明けたあとの予約（11/20）も次の期間として出す。今回の帯は削らない", () => {
    const v = calendarPeriods(plan(), mk(["2026-10-08T10:00", "2026-11-20T10:00"]), at("2026-10-16"))!;
    expect(lbl(v.next)).toBe("11/20〜12/20");
    expect(lbl(v.currentBand)).toBe("10/8〜11/8");
  });

  it("1回目のご予約待ち（今の区切りに予約が無い）: 今回の帯は出さず pending", () => {
    const v = calendarPeriods(plan({ startDate: "2026-09-01" }), mk(["2026-09-01T10:00", "2026-09-08T10:00"]), at("2026-10-16"))!;
    expect(v.pending).toBe(true);
    expect(v.current).toBeNull();
  });

  it("1回目が未来の日（10/22）: 帯は 10/22 から（カードの「10/22から開始」と同じ）", () => {
    const v = calendarPeriods(plan({ startDate: "2026-10-06" }), mk(["2026-09-10T10:00", "2026-10-22T10:00"]), at("2026-10-15"))!;
    expect(lbl(v.current)).toBe("10/22〜11/22");
    expect(v.next).toBeNull();
  });

  it("起算日固定のお客様: 次の期間は予約が無くても暦で決まっているので出す", () => {
    const v = calendarPeriods(plan({ cycleStartPinned: true }), ONE, at("2026-10-16"))!;
    expect(lbl(v.current)).toBe("10/8〜11/8");
    expect(lbl(v.next)).toBe("11/9〜12/9");
  });

  it("猶予で前回分になる予約（期限翌日 11/9）は、次の期間として出さない", () => {
    const v = calendarPeriods(plan({ graceDays: 7 }), mk(["2026-10-08T10:00", "2026-11-09T10:00"]), at("2026-10-16"))!;
    expect(v.next).toBeNull();
  });

  it("回数券・期間プラン・プラン未設定は出さない", () => {
    expect(calendarPeriods(plan({ planType: "ticket", validityDays: 90 }), ONE, at("2026-10-16"))).toBeNull();
    expect(calendarPeriods(plan({ planType: "period", maxSessions: null }), ONE, at("2026-10-16"))).toBeNull();
    expect(calendarPeriods(null, ONE, at("2026-10-16"))).toBeNull();
    expect(calendarPeriods(plan({ startDate: null }), ONE, at("2026-10-16"))).toBeNull();
  });
});

describe("日を選んだときの一言（その日に予約が入ったと仮定して数える）", () => {
  it("今回の期間内で、まだ回数が残っている日は何も出さない", () => {
    expect(hint(plan(), ONE, "2026-10-20", "2026-10-16")).toBeNull();
  });

  it("🔴 期間が明けた日（11/10）: 「この日から次の期間（11/10〜12/10）。この日が1回目」", () => {
    expect(hintText(hint(plan(), ONE, "2026-11-10", "2026-10-16"))).toBe("next 11/10〜12/10");
    expect(hintText(hint(plan(), ONE, "2026-11-09", "2026-10-16"))).toBe("next 11/9〜12/9");
  });

  it("🔴 使い切ったあとは、期間内の日（10/25）でも次の期間の1回目になる", () => {
    expect(hintText(hint(plan(), USED_UP, "2026-10-25", "2026-10-16"))).toBe("next 10/25〜11/25");
  });

  it("次の期間がもう決まっているなら、その期間の何回目か（11/3 は 10/30〜11/30 の2回目）", () => {
    expect(hintText(hint(plan(), ROLL_KNOWN, "2026-11-03", "2026-10-16"))).toBe("in 10/30〜11/30 #2");
  });

  it("1回目のご予約待ち: 「この日から 11/20 までが利用期間（この日が1回目）」", () => {
    const p = plan({ startDate: "2026-09-01" });
    expect(hintText(hint(p, mk(["2026-09-01T10:00", "2026-09-08T10:00"]), "2026-10-20", "2026-10-16"))).toBe("start 10/20〜11/20");
  });

  it("1回目（10/22）より前の日を選ぶと、その日から期間が始まる（10/18〜11/18）", () => {
    const p = plan({ startDate: "2026-10-06" });
    expect(hintText(hint(p, mk(["2026-09-10T10:00", "2026-10-22T10:00"]), "2026-10-18", "2026-10-15"))).toBe("start 10/18〜11/18");
  });

  it("🔴 猶予の日（期限翌日〜7日）は前回分になるので何も出さない（猶予は案内しない）。猶予を過ぎた日は次の期間", () => {
    const p = plan({ graceDays: 7 });
    expect(hint(p, ONE, "2026-11-10", "2026-10-16")).toBeNull();
    expect(hintText(hint(p, ONE, "2026-11-20", "2026-10-16"))).toBe("next 11/20〜12/20");
  });

  it("起算日固定: 次の期間の何回目か（期間は暦どおり 11/9〜12/9）", () => {
    expect(hintText(hint(plan({ cycleStartPinned: true }), ONE, "2026-11-12", "2026-10-16"))).toBe("in 11/9〜12/9 #1");
  });

  it("超過を許さないプランで使い切ったら、期間内の日は何も出さない（予約できない案内は別に出る）", () => {
    expect(hint(plan({ allowOverflow: false }), USED_UP, "2026-10-25", "2026-10-16")).toBeNull();
  });

  it("起算日より前の日・対象外のプランは出さない", () => {
    expect(hint(plan(), ONE, "2026-10-01", "2026-10-16")).toBeNull();
    expect(periodDayHint(plan({ planType: "ticket" }), ONE, "2026-11-20", null)).toBeNull();
  });
});

describe("定期予約: 途中の回から次の期間に入るなら知らせる", () => {
  it("🔴 10/29 から毎週4回: 10/29・11/5 で今回の3回が埋まり、11/12（3回目）から次の期間", () => {
    expect(repeatPeriodBreak(plan(), ONE, "2026-10-29", 4)).toEqual({ dateKey: "2026-11-12", ordinal: 3 });
  });

  it("期間内でも使い切った次の回から次の期間（10/20 が3回目、10/27 から次）", () => {
    expect(repeatPeriodBreak(plan(), mk(["2026-10-08T10:00", "2026-10-18T10:00"]), "2026-10-20", 3))
      .toEqual({ dateKey: "2026-10-27", ordinal: 2 });
  });

  it("全部今回の期間に収まるなら何も出さない。1回だけのときも出さない", () => {
    expect(repeatPeriodBreak(plan(), ONE, "2026-10-20", 2)).toBeNull();
    expect(repeatPeriodBreak(plan(), ONE, "2026-11-20", 1)).toBeNull();
  });
});

describe("画面の部品", () => {
  it("🔴 利用期間を出さない設定のお客様には、帯も説明も一言も出さない", () => {
    const { result } = renderHook(() => useCalendarPeriod(plan(), ONE, false));
    expect(result.current.view).toBeNull();
    expect(result.current.calendarClass).toBe("");
    expect(result.current.dayPicker.modifiers.periodCurrent).toEqual([]);
    expect(result.current.hintFor("2026-11-10")).toBeNull();
    expect(result.current.repeatNoteFor("2026-10-29", 4)).toBeNull();
  });

  it("🔴 日時の変更中は、動かす予約を除いて数える（3/3 のうち 10/22 を動かすなら 10/25 は今回の3回目）", () => {
    const moving = { date: "2026-10-22", startTime: "10:00" };
    const withMove = renderHook(() => useCalendarPeriod(plan(), USED_UP, true, moving)).result.current;
    const noMove = renderHook(() => useCalendarPeriod(plan(), USED_UP, true, null)).result.current;
    expect(hintText(noMove.hintFor("2026-10-25"))).toBe("next 10/25〜11/25");
    expect(withMove.hintFor("2026-10-25")).toBeNull();
  });

  it("定期予約の一言は文言にして返す", () => {
    const { result } = renderHook(() => useCalendarPeriod(plan(), ONE, null));
    expect(result.current.repeatNoteFor("2026-10-29", 4)).toBe(i18n.t("booking.periodRepeatNote", { date: "11/12", n: 3 }));
  });

  it("カレンダーのマスに印が付く（今回の帯は 10/8〜10/29、次の期間は 10/30 から）", () => {
    const { result } = renderHook(() => useCalendarPeriod(plan(), ROLL_KNOWN, true));
    const { container } = render(<Calendar mode="single" month={new Date(2026, 9, 1)} {...result.current.dayPicker} />);
    const day = (n: number) => Array.from(container.querySelectorAll("button[name='day']"))
      .find((b) => b.textContent === String(n) && !b.className.includes("day-outside"))!;
    expect(result.current.calendarClass).not.toBe("");
    expect(day(8).className).toContain("cal-period-start");
    expect(day(8).className).toContain("cal-period-current");
    expect(day(20).className).toContain("cal-period-current");
    expect(day(29).className).toContain("cal-period-end");
    expect(day(29).className).not.toContain("cal-period-next");
    expect(day(30).className).toContain("cal-period-next");
    expect(day(30).className).toContain("cal-period-start");
    expect(day(30).className).not.toContain("cal-period-current");
    expect(day(7).className).not.toContain("cal-period");
  });

  it("説明: 今回の利用期間と残り回数・次の期間・1回目のご予約待ち", () => {
    const view: CalendarPeriodView = {
      current: { start: new Date(2026, 9, 8), end: new Date(2026, 10, 9) },
      currentBand: { start: new Date(2026, 9, 8), end: new Date(2026, 9, 30) },
      next: { start: new Date(2026, 9, 30), end: new Date(2026, 11, 1) },
      pending: false,
      remaining: 0,
    };
    render(<CalendarPeriodLegend view={view} />);
    expect(screen.getByText(i18n.t("booking.periodLegendCurrent", { start: "10/8", end: "11/8" }), { exact: false })).toBeTruthy();
    expect(screen.getByText(i18n.t("booking.periodLegendAllBooked"))).toBeTruthy();
    expect(screen.getByText(i18n.t("booking.periodLegendNext", { start: "10/30", end: "11/30" }))).toBeTruthy();
    cleanup();
    render(<CalendarPeriodLegend view={{ ...view, current: null, currentBand: null, next: null, pending: true }} />);
    expect(screen.getByText(i18n.t("booking.periodLegendPending"))).toBeTruthy();
    cleanup();
    render(<CalendarPeriodLegend view={null} />);
    expect(screen.queryByTestId("calendar-period-legend")).toBeNull();
  });

  it("一言: 次の期間・期間の始まり・次の期間の何回目", () => {
    const period = { start: new Date(2026, 10, 10), end: new Date(2026, 11, 11) };
    render(<CalendarPeriodHint hint={{ kind: "starts", period, afterCurrent: true }} />);
    expect(screen.getByText(i18n.t("booking.periodHintNext", { start: "11/10", end: "12/10" }))).toBeTruthy();
    cleanup();
    render(<CalendarPeriodHint hint={{ kind: "starts", period, afterCurrent: false }} />);
    expect(screen.getByText(i18n.t("booking.periodHintStart", { end: "12/10" }))).toBeTruthy();
    cleanup();
    render(<CalendarPeriodHint hint={{ kind: "inPeriod", period, count: 2 }} />);
    expect(screen.getByText(i18n.t("booking.periodHintInPeriod", { start: "11/10", end: "12/10", count: 2 }))).toBeTruthy();
    cleanup();
    render(<CalendarPeriodHint hint={null} />);
    expect(screen.queryByTestId("calendar-period-hint")).toBeNull();
  });
});

describe("配線（予約画面）", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const BOOKING = strip(readFileSync("src/components/customer/CustomerBooking.tsx", "utf8"));

  it("カードと同じ材料・お客様ごとの表示設定・変更中の予約で計算し、帯・説明・一言・定期予約の一言を出す", () => {
    expect(BOOKING).toContain("useCalendarPeriod(planUsageInput, planBookingsForUsage, profile?.show_usage_period, excludeSlot)");
    expect(BOOKING).toContain("{...period.dayPicker}");
    expect(BOOKING).toContain("${period.calendarClass}");
    expect(BOOKING).toContain("<CalendarPeriodLegend view={period.view} />");
    expect(BOOKING).toContain("{!isViewOnlyDay(dateKey) && <CalendarPeriodHint hint={period.hintFor(dateKey)} />}");
    expect(BOOKING).toContain("periodNote={period.repeatNoteFor(dateKey, repeatWeeks)}");
  });

  it("文言（5言語）", () => {
    for (const lang of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const j = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      for (const k of ["periodLegendCurrent", "periodLegendRemaining", "periodLegendAllBooked", "periodLegendNext", "periodLegendPending", "periodHintNext", "periodHintStart", "periodHintInPeriod", "periodRepeatNote"]) {
        expect(j.booking[k], `${lang} ${k}`).toBeTruthy();
      }
    }
  });
});
