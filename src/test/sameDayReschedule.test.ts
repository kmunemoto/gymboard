import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sameDayRescheduleRule } from "@/lib/sameDayReschedule";

// 当日の予約を動かすときの扱い（2026-11-07 宗本さんの決定。src/lib/sameDayReschedule.ts）。
//   当日キャンセル・当日の明日以降への変更 … 1回消化
//   同じ日の中での時間の変更 ……………… 消化しない（アプリからはできないので、店に頼んでもらう）

const TODAY = "2026-11-07";

describe("sameDayRescheduleRule", () => {
  it("当日の予約を明日以降へ動かすと消化（forfeit）", () => {
    expect(sameDayRescheduleRule({ penaltyEnabled: true, targetDate: TODAY, newDate: "2026-11-08", today: TODAY })).toBe("forfeit");
    expect(sameDayRescheduleRule({ penaltyEnabled: true, targetDate: TODAY, newDate: "2026-11-14", today: TODAY })).toBe("forfeit");
  });

  it("🔴 同じ日の別の時間へは消化しない。アプリでは動かさず、店に頼んでもらう（contactGym）", () => {
    expect(sameDayRescheduleRule({ penaltyEnabled: true, targetDate: TODAY, newDate: TODAY, today: TODAY })).toBe("contactGym");
  });

  it("当日の予約でなければ、いつもどおり（明日の予約を動かしても消化しない）", () => {
    expect(sameDayRescheduleRule({ penaltyEnabled: true, targetDate: "2026-11-08", newDate: "2026-11-09", today: TODAY })).toBe("normal");
    expect(sameDayRescheduleRule({ penaltyEnabled: true, targetDate: "2026-11-08", newDate: "2026-11-08", today: TODAY })).toBe("normal");
  });

  it("当日キャンセルの消化がオフのジムでは、当日でもいつもどおり", () => {
    expect(sameDayRescheduleRule({ penaltyEnabled: false, targetDate: TODAY, newDate: "2026-11-08", today: TODAY })).toBe("normal");
    expect(sameDayRescheduleRule({ penaltyEnabled: false, targetDate: TODAY, newDate: TODAY, today: TODAY })).toBe("normal");
  });
});

describe("お客様の予約変更の画面（CustomerBooking）", () => {
  const src = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
  const start = src.indexOf("sameDayRescheduleRule({");
  const warn = src.indexOf("setRescheduleForfeitPending(true)");
  const call = src.indexOf("await rescheduleBooking(");

  it("同じ日の中の変更は、消化の警告・変更の実行より前に止めて、店への連絡を案内する", () => {
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(warn);
    expect(start).toBeLessThan(call);
    const block = src.slice(start, src.indexOf("return;", start));
    expect(block).toContain('=== "contactGym"');
    expect(block).toContain('toast.error(t("booking.sameDayTimeChangeContactGym"))');
    // 判定はジムの設定・動かす前の日・動かす先の日・今日（JST）で行う
    expect(block).toContain("penaltyEnabled: !!tenant?.same_day_cancel_penalty_enabled");
    expect(block).toContain("targetDate: rescheduleTarget.date");
    expect(block).toContain("newDate: dateKey");
    expect(block).toContain("today: getJSTToday()");
  });

  it("明日以降への変更の消化（forfeitOld）は今までどおり", () => {
    expect(src).toContain("{ forfeitOld: rescheduleTargetForfeits }");
  });
});

describe("文面（5言語）", () => {
  const locales = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
  const read = (loc: string) => JSON.parse(readFileSync(`src/locales/${loc}.json`, "utf8"));

  it("店への連絡を案内する文が全言語にある", () => {
    for (const loc of locales) {
      const text: unknown = read(loc).booking.sameDayTimeChangeContactGym;
      expect(typeof text === "string" && text.length > 0, loc).toBe(true);
    }
  });

  it("日本語: 設定の説明・お客様の警告・店のチェックの説明が、新しい決まり（明日以降は消化・同じ日の中は消化しない）を書いている", () => {
    const ja = read("ja");
    expect(ja.settings.trainer.sameDayPenaltyDesc).toContain("明日以降");
    expect(ja.settings.trainer.sameDayPenaltyDesc).toContain("同じ日の中");
    expect(ja.booking.rescheduleForfeitWarningDesc).toContain("明日以降");
    expect(ja.booking.rescheduleForfeitWarningDesc).toContain("同じ日の中");
    expect(ja.schedule.sameDayForfeitCheckboxDesc).toContain("同じ日の中");
    // 設定の説明で外すよう案内するチェックの名前は、予定表に実際に出る名前と同じ
    expect(ja.settings.trainer.sameDayPenaltyDesc).toContain(`「${ja.schedule.sameDayForfeitCheckbox}」`);
  });
});
