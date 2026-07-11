import { describe, it, expect } from "vitest";
import { maxRepeatWeeksFor, MAX_REPEAT_COUNT } from "@/lib/repeatBookingWindow";

// startDate と maxBookableDate は共に「時刻を持たないローカル日付」として扱う
// （呼び出し側のカレンダー/toDate と同じ前提）。
const day = (offsetDays: number) => new Date(2026, 6, 1 + offsetDays); // 2026-07-01 起点

describe("maxRepeatWeeksFor", () => {
  it("十分に余裕がある期間（+30日）なら最大回数(4)まで選べる", () => {
    expect(maxRepeatWeeksFor(day(0), day(30))).toBe(4);
  });

  it("開始日がそのまま期間の終わり（+0日）なら1回のみ", () => {
    expect(maxRepeatWeeksFor(day(0), day(0))).toBe(1);
  });

  it("2回目の日(+7日)ちょうどまでなら2回まで（境界は含む）", () => {
    expect(maxRepeatWeeksFor(day(0), day(7))).toBe(2);
  });

  it("2回目の前日(+6日)までしか無ければ1回のみ", () => {
    expect(maxRepeatWeeksFor(day(0), day(6))).toBe(1);
  });

  it("3回目の日(+14日)ちょうどまでなら3回まで", () => {
    expect(maxRepeatWeeksFor(day(0), day(14))).toBe(3);
  });

  it("4回目の前日(+20日)までなら3回まで（4回目の+21日は超過）", () => {
    expect(maxRepeatWeeksFor(day(0), day(20))).toBe(3);
  });

  it("4回目の日(+21日)ちょうどまでなら4回まで（最大回数の境界も含む）", () => {
    expect(maxRepeatWeeksFor(day(0), day(21))).toBe(4);
  });

  it(`MAX_REPEAT_COUNT を超えて増やそうとしても${MAX_REPEAT_COUNT}が上限`, () => {
    expect(maxRepeatWeeksFor(day(0), day(365))).toBe(MAX_REPEAT_COUNT);
  });

  it("既定引数（maxBookableDate省略）は今日から1ヶ月先までなので、今日を起点にすれば4回選べる", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expect(maxRepeatWeeksFor(today)).toBe(4);
  });
});
