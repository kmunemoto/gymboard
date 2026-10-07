/**
 * お客様の予約カレンダーの「残り枠」（2026-10-06 宗本さん「各日にちが残り何枠空いているか
 * リアルタイムで表示される機能を追加して」）。
 *
 * 🔴 壊しやすいもの:
 *   1. 開始時刻（15分刻み）の数を数える → 1日「残47」になって意味が無い
 *   2. カレンダーの「満」と数字が食い違う（数字があるのに押せない／押せるのに数字が無い）
 *   3. 設定 OFF の店まで数字が出る・読み直しが走る
 *   4. 画面が隠れている間も読み直し続ける（バックエンドの利用量＝クレジットが減る）
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import { bookingSlotMinutes, minutesToTime } from "@/lib/businessHours";
import { isFootprintBlocked } from "@/lib/bookingOptionFit";
import { isDayFullyBooked } from "@/lib/bookingDayFull";
import { dayUnselectableReason, isDayUnselectable, type CalendarDayRules } from "@/lib/bookingCalendarDay";
import {
  countRemainingSlots, dayRemainingBadge, FEW_REMAINING_SLOTS, type RemainingSlotsInput,
} from "@/lib/dayRemainingSlots";
import type { BookedSlot } from "@/lib/bookedSlots";
import BookingCalendarDay from "@/components/booking/BookingCalendarDay";
import { useLiveRefresh, LIVE_REFRESH_MS } from "@/hooks/useLiveRefresh";

// 御所南と同じ形: 10:00〜22:30・1枠60分・間15分・同時に1人
const HOURS = { start: "10:00", end: "22:30" };
const DATE = "2026-10-15";
const STARTS = bookingSlotMinutes(HOURS, 60, null); // 15分刻み
const booked = (start: string, end: string, isBlock = false): BookedSlot => ({
  date: DATE, startTime: start, endTime: end, isBlock, staffUserId: null,
});
const input = (over: Partial<RemainingSlotsInput> = {}): RemainingSlotsInput => ({
  starts: STARTS, bookedSlots: [], date: DATE, weekday: 4,
  footprintMinutes: 75, capacityWindows: null, defaultCapacity: 1,
  staffUserId: null, exclude: null, isClosedAt: () => false, ...over,
});

describe("その日、あと何回入れられるか", () => {
  it("🔴 開始時刻の数（15分刻みで47通り）ではなく、入れられる回数を数える", () => {
    expect(STARTS.length).toBe(47);
    // 10:00, 11:15, … 21:15 の10回（最後の開始は 22:30-60分=21:30 まで）
    expect(countRemainingSlots(input())).toBe(10);
  });

  it("予約が1件入ると、その前後を避けて数え直す", () => {
    // 14:00〜15:15（1枠＋間）が埋まっている
    // → 10:00, 11:15, 12:30, 15:15, 16:30, 17:45, 19:00, 20:15, 21:30 の9回
    expect(countRemainingSlots(input({ bookedSlots: [booked("14:00", "15:15")] }))).toBe(9);
  });

  it("店のブロックで1日ふさがっていれば 0", () => {
    expect(countRemainingSlots(input({ bookedSlots: [booked("10:00", "22:30", true)] }))).toBe(0);
  });

  it("同時に2人受けられる店では倍になる", () => {
    expect(countRemainingSlots(input({ defaultCapacity: 2 }))).toBe(20);
  });

  it("受付しない時間・締切を過ぎた時刻は数えない（当日の夕方以降だけ取れる、など）", () => {
    const before18 = (m: number) => m < 18 * 60;
    // 18:00, 19:15, 20:30 の3回
    expect(countRemainingSlots(input({ isClosedAt: before18 }))).toBe(3);
    expect(countRemainingSlots(input({ isClosedAt: () => true }))).toBe(0);
  });

  it("🔴 「満」の判定（isDayFullyBooked）と必ず食い違わない: 0 ⇔ 満", () => {
    // 決まった並びで予約を置いて、色々な埋まり方を作る
    for (let seed = 1; seed <= 300; seed++) {
      const slots: BookedSlot[] = [];
      let x = seed;
      const next = () => (x = (x * 1103515245 + 12345) % 2147483648);
      const n = next() % 8;
      for (let i = 0; i < n; i++) {
        const start = 600 + (next() % 47) * 15;
        const len = [75, 90, 105, 30][next() % 4];
        slots.push(booked(minutesToTime(start), minutesToTime(Math.min(start + len, 1350)), next() % 5 === 0));
      }
      const cap = 1 + (next() % 2);
      const closedBefore = next() % 3 === 0 ? 600 + (next() % 40) * 15 : 0;
      const isClosedAt = (m: number) => m < closedBefore;
      const count = countRemainingSlots(input({ bookedSlots: slots, defaultCapacity: cap, isClosedAt }));
      const full = isDayFullyBooked(STARTS, (m) =>
        isClosedAt(m) || isFootprintBlocked({
          bookedSlots: slots, date: DATE, weekday: 4, startMinutes: m, footprintMinutes: 75,
          capacityWindows: null, defaultCapacity: cap, staffUserId: null, exclude: null,
        }),
      );
      expect(count === 0, `seed ${seed}`).toBe(full);
    }
  });
});

describe("日付の下に何を出すか", () => {
  it("満枠・上限・受付を止めた日は「満」。定休日などの理由では何も出さない", () => {
    for (const r of ["full", "limitReached", "hardClosed"] as const) {
      expect(dayRemainingBadge(r, 0), r).toEqual({ kind: "full" });
    }
    for (const r of ["past", "closed", "paymentGate", "staffOff", "beyondWindow"] as const) {
      expect(dayRemainingBadge(r, 5), r).toBeNull();
    }
  });

  it("0 なら出さない（当日で締切を過ぎた日など）。少なければ目立たせる", () => {
    expect(dayRemainingBadge(null, 0)).toBeNull();
    expect(dayRemainingBadge(null, FEW_REMAINING_SLOTS)).toEqual({ kind: "remaining", count: FEW_REMAINING_SLOTS, few: true });
    expect(dayRemainingBadge(null, FEW_REMAINING_SLOTS + 1)).toEqual({ kind: "remaining", count: FEW_REMAINING_SLOTS + 1, few: false });
  });

  it("選べない日では数えない（重い計算を無駄にしない）", () => {
    const count = vi.fn(() => 3);
    dayRemainingBadge("closed", count);
    expect(count).not.toHaveBeenCalled();
    expect(dayRemainingBadge(null, count)).toEqual({ kind: "remaining", count: 3, few: false });
  });

  it("選べない理由は、今までの「選べるか」と1対1（足しても判定は変わらない）", () => {
    const base: CalendarDayRules = {
      today: "2026-10-06", businessHours: { start: "10:00", end: "22:30", days: { 5: null } } as never,
      closedDays: [], hasOwnBookingOn: () => false, isDayFull: (d) => d === "2026-10-14",
      staffSchedules: null, staffUserId: null, bookingWindowDays: 30, nextCyclePaymentGate: null,
    };
    expect(dayUnselectableReason("2026-10-05", base)).toBe("past");
    expect(dayUnselectableReason("2026-10-09", base)).toBe("closed"); // 金曜＝定休日
    expect(dayUnselectableReason("2026-10-14", base)).toBe("full");
    expect(dayUnselectableReason("2026-10-15", base)).toBeNull();
    expect(dayUnselectableReason("2026-12-01", base)).toBe("beyondWindow");
    for (const d of ["2026-10-05", "2026-10-09", "2026-10-14", "2026-10-15", "2026-12-01"]) {
      expect(isDayUnselectable(d, base), d).toBe(dayUnselectableReason(d, base) !== null);
    }
  });
});

describe("カレンダーの1日ぶん", () => {
  afterEach(cleanup);
  const day = new Date(2026, 9, 15);

  it("「残N」を出す。少ない日は目立つ色", () => {
    render(<BookingCalendarDay date={day} ownUpcoming={false} ownPast={false} onColoredCell={false}
      badge={{ kind: "remaining", count: 1, few: true }} />);
    const el = screen.getByTestId("day-remaining");
    expect(el).toHaveTextContent(i18n.t("booking.remainingSlots", { count: 1 }));
    expect(el.className).toContain("text-warning");
  });

  it("選択中・今日のマス（背景に色）では目立つ色にしない（色の上に色で読めなくなる）", () => {
    render(<BookingCalendarDay date={day} ownUpcoming={false} ownPast={false} onColoredCell
      badge={{ kind: "remaining", count: 1, few: true }} />);
    expect(screen.getByTestId("day-remaining").className).not.toContain("text-warning");
  });

  it("満枠の日は「満」", () => {
    render(<BookingCalendarDay date={day} ownUpcoming={false} ownPast={false} onColoredCell={false} badge={{ kind: "full" }} />);
    expect(screen.getByTestId("day-remaining")).toHaveTextContent(i18n.t("booking.dayFullShort"));
  });

  it("出さない日（設定 OFF を含む）は何も足さない＝今まで通り", () => {
    render(<BookingCalendarDay date={day} ownUpcoming ownPast={false} onColoredCell={false} badge={null} />);
    expect(screen.queryByTestId("day-remaining")).toBeNull();
    expect(screen.getByText("15")).toBeInTheDocument();
  });
});

describe("開いている間の読み直し", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("ON なら1分ごとに読み直す", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    renderHook(() => useLiveRefresh(refresh, true));
    vi.advanceTimersByTime(LIVE_REFRESH_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("🔴 OFF の店では一度も読まない", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    renderHook(() => useLiveRefresh(refresh, false));
    vi.advanceTimersByTime(LIVE_REFRESH_MS * 5);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("🔴 画面が隠れている間は読まない。戻った瞬間に1回読む", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    let state = "hidden";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    renderHook(() => useLiveRefresh(refresh, true));
    vi.advanceTimersByTime(LIVE_REFRESH_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
    state = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("画面を閉じたら止まる", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useLiveRefresh(refresh, true));
    unmount();
    vi.advanceTimersByTime(LIVE_REFRESH_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("配線", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const BOOKING = strip(readFileSync("src/components/customer/CustomerBooking.tsx", "utf8"));

  it("店の設定で出し分け、読み直しも同じ設定で止める", () => {
    expect(BOOKING).toContain("const showRemaining = tenant?.show_remaining_slots === true;");
    expect(BOOKING).toContain("useLiveRefresh(fetchBookedSlots, showRemaining)");
    expect(BOOKING).toContain("!showRemaining ? null : dayRemainingBadge(");
    expect(BOOKING).toContain("{showRemaining && <RemainingSlotsLegend />}");
  });

  it("🔴 数える材料は枠一覧と同じ（開始時刻・占有・受付しない帯・締切）", () => {
    expect(BOOKING).toContain("dayUnselectableReason(key, calendarDayRules)");
    expect(BOOKING).toContain("starts: staffBookingSlotMinutes(businessHours, totalMinutes, weekdayOfDateKey(key), staffSchedules, selectedStaffId)");
    expect(BOOKING).toContain("footprintMinutes: sessionFootprintMinutes(slotMinutes, gridOptionMinutes, bookingBufferMinutes)");
    expect(BOOKING).toContain("isClosedAt: (m) => isSlotNotAccepting(key, minutesToTime(m)) || isSlotPastCutoff(key, minutesToTime(m), cutoff)");
    // 枠一覧（generateSlots）も同じ開始時刻の並びを使っている
    expect(BOOKING).toContain("for (const totalMin of staffBookingSlotMinutes(\n      businessHours, totalMinutes, weekday, staffSchedules, selectedStaffId,");
  });

  it("設定画面にスイッチがある", () => {
    expect(readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8")).toContain("<RemainingSlotsCard />");
  });

  it("DB の既定は OFF（今まで通り）", () => {
    const sql = readFileSync("supabase/migrations/20261006010000_show_remaining_slots.sql", "utf8");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS show_remaining_slots boolean NOT NULL DEFAULT false/);
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("文言（5言語）", () => {
    for (const lang of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const j = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      expect(j.booking.remainingSlots, lang).toContain("{{count}}");
      expect(j.booking.dayFullShort, lang).toBeTruthy();
      expect(j.booking.remainingSlotsLegend, lang).toBeTruthy();
      for (const k of ["Label", "Desc", "Saved", "SaveFailed"]) {
        expect(j.settings.trainer[`showRemainingSlots${k}`], `${lang} ${k}`).toBeTruthy();
      }
    }
  });
});
