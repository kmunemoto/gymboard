import { describe, it, expect } from "vitest";
import { isDormant, daysSinceLastActivity, DEFAULT_DORMANT_DAYS } from "@/lib/dormancy";
import { toJSTDate } from "@/lib/timezone";

const NOW_ISO = "2026-07-08T12:00:00Z"; // 固定の基準時刻
const NOW_JST = toJSTDate(NOW_ISO); // 判定に渡す JSTプロキシDate
// 同じ時刻(12:00Z)から n 日前の ISO。時刻を揃えるので JST暦日差はちょうど n になる。
const daysBefore = (n: number) => new Date(new Date(NOW_ISO).getTime() - n * 86400000).toISOString();

const base = {
  next_booking_date: null as string | null,
  last_visit_date: null as string | null,
  created_at: daysBefore(0),
};

describe("isDormant", () => {
  it("今後の予約がある人は、どれだけ来ていなくても休眠にしない", () => {
    expect(
      isDormant(
        { ...base, next_booking_date: new Date(new Date(NOW_ISO).getTime() + 86400000).toISOString(), last_visit_date: daysBefore(365) },
        DEFAULT_DORMANT_DAYS,
        NOW_JST,
      ),
    ).toBe(false);
  });

  it("最終来店からちょうどしきい値日数なら休眠", () => {
    expect(isDormant({ ...base, last_visit_date: daysBefore(30) }, 30, NOW_JST)).toBe(true);
  });

  it("最終来店からしきい値未満（29日）なら休眠でない", () => {
    expect(isDormant({ ...base, last_visit_date: daysBefore(29) }, 30, NOW_JST)).toBe(false);
  });

  it("来店実績が無くても、登録からしきい値以上経過していれば休眠", () => {
    expect(isDormant({ ...base, last_visit_date: null, created_at: daysBefore(40) }, 30, NOW_JST)).toBe(true);
  });

  it("来店実績が無く登録間もない新規は休眠にしない", () => {
    expect(isDormant({ ...base, last_visit_date: null, created_at: daysBefore(5) }, 30, NOW_JST)).toBe(false);
  });

  it("しきい値を変えると判定が変わる（60日なら45日来店なしは休眠でない）", () => {
    expect(isDormant({ ...base, last_visit_date: daysBefore(45) }, 60, NOW_JST)).toBe(false);
    expect(isDormant({ ...base, last_visit_date: daysBefore(45) }, 30, NOW_JST)).toBe(true);
  });
});

describe("daysSinceLastActivity", () => {
  it("最終来店日を優先して経過日数を返す", () => {
    expect(daysSinceLastActivity({ last_visit_date: daysBefore(10), created_at: daysBefore(100) }, NOW_JST)).toBe(10);
  });

  it("来店実績が無ければ登録日からの経過日数を返す", () => {
    expect(daysSinceLastActivity({ last_visit_date: null, created_at: daysBefore(20) }, NOW_JST)).toBe(20);
  });
});
