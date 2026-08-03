import { describe, it, expect } from "vitest";
import { isSlotPastCutoff, isDayPastCutoff, DEFAULT_CUTOFF } from "@/lib/bookingCutoff";

// 予約の締切。2026-08-03 まで tenants.booking_cutoff_* は保存されるだけで
// 一度も読まれていなかった（＝どの店も当日予約を受けられなかった）。

/** JST の日時を epoch ms にする（テストを読みやすくするため） */
const jst = (s: string) => new Date(`${s}+09:00`).getTime();

const PREV_DAY = { type: "prev_day", hours: 24 };
const H2 = { type: "hours_before", hours: 2 };
const H0 = { type: "hours_before", hours: 0 };

describe("isSlotPastCutoff", () => {
  describe("prev_day（既定・2026-08-03 以前の挙動）", () => {
    it("前日のうちは予約できる", () => {
      expect(isSlotPastCutoff("2026-08-10", "10:00", PREV_DAY, jst("2026-08-09T23:59:00"))).toBe(false);
    });

    it("日付が変わった瞬間に、その日は全部締切", () => {
      const at0 = jst("2026-08-10T00:00:00");
      expect(isSlotPastCutoff("2026-08-10", "10:00", PREV_DAY, at0)).toBe(true);
      // 夜遅い枠でも同じ（日単位の締切なので）
      expect(isSlotPastCutoff("2026-08-10", "21:00", PREV_DAY, at0)).toBe(true);
    });
  });

  describe("hours_before", () => {
    it("2時間前より早ければ予約できる", () => {
      expect(isSlotPastCutoff("2026-08-10", "10:00", H2, jst("2026-08-10T07:59:00"))).toBe(false);
    });

    it("ちょうど2時間前で締切", () => {
      expect(isSlotPastCutoff("2026-08-10", "10:00", H2, jst("2026-08-10T08:00:00"))).toBe(true);
    });

    it("**同じ日の遅い枠はまだ予約できる**（日単位ではなく枠単位で効く）", () => {
      const at9 = jst("2026-08-10T09:00:00");
      expect(isSlotPastCutoff("2026-08-10", "10:00", H2, at9)).toBe(true);   // 締切済み
      expect(isSlotPastCutoff("2026-08-10", "18:00", H2, at9)).toBe(false);  // まだ取れる
    });

    it("hours=0 は開始時刻まで受け付ける", () => {
      expect(isSlotPastCutoff("2026-08-10", "10:00", H0, jst("2026-08-10T09:59:00"))).toBe(false);
      expect(isSlotPastCutoff("2026-08-10", "10:00", H0, jst("2026-08-10T10:00:00"))).toBe(true);
    });
  });

  describe("値が読めないときは prev_day に倒す（既存店の挙動を変えない）", () => {
    const beforeMidnight = jst("2026-08-09T23:00:00");
    const afterMidnight = jst("2026-08-10T00:30:00");

    for (const [label, cutoff] of [
      ["null", null],
      ["undefined", undefined],
      ["空オブジェクト", {}],
      ["type だけ null", { type: null, hours: 3 }],
      ["知らない type", { type: "whenever", hours: 3 }],
    ] as const) {
      it(`${label} → prev_day 扱い`, () => {
        expect(isSlotPastCutoff("2026-08-10", "10:00", cutoff, beforeMidnight)).toBe(false);
        expect(isSlotPastCutoff("2026-08-10", "10:00", cutoff, afterMidnight)).toBe(true);
      });
    }

    it("DEFAULT_CUTOFF は prev_day", () => {
      expect(isSlotPastCutoff("2026-08-10", "10:00", DEFAULT_CUTOFF, afterMidnight)).toBe(true);
    });
  });

  describe("壊れた値", () => {
    it("hours が負値・NaN なら 0 扱い（開始時刻まで）", () => {
      for (const hours of [-5, NaN]) {
        const c = { type: "hours_before", hours };
        expect(isSlotPastCutoff("2026-08-10", "10:00", c, jst("2026-08-10T09:59:00"))).toBe(false);
        expect(isSlotPastCutoff("2026-08-10", "10:00", c, jst("2026-08-10T10:01:00"))).toBe(true);
      }
    });

    it("時刻の形が壊れていても落ちない", () => {
      expect(() => isSlotPastCutoff("2026-08-10", "こわれ", H2, jst("2026-08-10T09:00:00"))).not.toThrow();
    });

    it("dateKey が空なら締切扱いにしない（枠が生成されない状態）", () => {
      expect(isSlotPastCutoff("", "10:00", H2, jst("2026-08-10T09:00:00"))).toBe(false);
    });
  });
});

describe("isDayPastCutoff（カレンダーの日付を落とす用）", () => {
  it("prev_day は従来どおり 0:00 で日ごと締切", () => {
    expect(isDayPastCutoff("2026-08-10", PREV_DAY, jst("2026-08-09T23:59:00"))).toBe(false);
    expect(isDayPastCutoff("2026-08-10", PREV_DAY, jst("2026-08-10T00:00:00"))).toBe(true);
  });

  it("hours_before は最終枠が締切を過ぎるまで日を残す", () => {
    // 最終枠 20:00 / 2時間前締切 → 18:00 までは日が生きている
    const last = 20 * 60;
    expect(isDayPastCutoff("2026-08-10", H2, jst("2026-08-10T17:59:00"), last)).toBe(false);
    expect(isDayPastCutoff("2026-08-10", H2, jst("2026-08-10T18:00:00"), last)).toBe(true);
  });

  it("最終枠が不明なら 24:00 とみなし、日を残す側に倒す", () => {
    // 個々の枠は isSlotPastCutoff が落とすので、通ってしまうことは無い
    expect(isDayPastCutoff("2026-08-10", H2, jst("2026-08-10T18:00:00"))).toBe(false);
    expect(isDayPastCutoff("2026-08-10", H2, jst("2026-08-10T22:00:00"))).toBe(true);
  });

  it("翌日以降は hours_before では締切にならない", () => {
    expect(isDayPastCutoff("2026-08-11", H2, jst("2026-08-10T23:00:00"))).toBe(false);
  });
});
