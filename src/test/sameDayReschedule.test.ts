import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isLaterTodayError, laterTodayFloor, sameDayRescheduleRule } from "@/lib/sameDayReschedule";

// 当日の予約を動かすときの扱い（2026-11-07 宗本さんの決定。src/lib/sameDayReschedule.ts）。
//   当日キャンセル・当日の明日以降への変更 … 1回消化
//   同じ日の中での時間の変更 ……………… 消化しない（アプリからはできないので、店に頼んでもらう）
//   ただしジムの設定（same_day_later_reschedule_enabled）が ON なら、同じ日の**後ろ**の時間へは
//   お客様がアプリから動かせる（"laterToday"・同日 宗本さんの要望）

const TODAY = "2026-11-07";

describe("sameDayRescheduleRule", () => {
  it("当日の予約を明日以降へ動かすと消化（forfeit）", () => {
    expect(sameDayRescheduleRule({ penaltyEnabled: true, targetDate: TODAY, newDate: "2026-11-08", today: TODAY })).toBe("forfeit");
    expect(sameDayRescheduleRule({ penaltyEnabled: true, targetDate: TODAY, newDate: "2026-11-14", today: TODAY })).toBe("forfeit");
    // 後ろへ動かせるジムでも、明日以降は消化のまま
    expect(sameDayRescheduleRule({ penaltyEnabled: true, laterFrom: "17:00", targetDate: TODAY, newDate: "2026-11-08", newStart: "18:00", today: TODAY })).toBe("forfeit");
  });

  it("🔴 同じ日の別の時間へは消化しない。アプリでは動かさず、店に頼んでもらう（contactGym）", () => {
    expect(sameDayRescheduleRule({ penaltyEnabled: true, targetDate: TODAY, newDate: TODAY, today: TODAY })).toBe("contactGym");
    // 後ろへ動かせないジム（laterFrom なし）では、後ろの時間でも店へ
    expect(sameDayRescheduleRule({ penaltyEnabled: true, laterFrom: null, targetDate: TODAY, newDate: TODAY, newStart: "19:00", today: TODAY })).toBe("contactGym");
  });

  it("🔴 後ろへ動かせるジムでは、同じ日の後ろの時間へはアプリから動かす（laterToday・消化しない）", () => {
    expect(sameDayRescheduleRule({ penaltyEnabled: true, laterFrom: "17:00", targetDate: TODAY, newDate: TODAY, newStart: "17:15", today: TODAY })).toBe("laterToday");
    expect(sameDayRescheduleRule({ penaltyEnabled: true, laterFrom: "17:00", targetDate: TODAY, newDate: TODAY, newStart: "21:30", today: TODAY })).toBe("laterToday");
    // 消化の設定が OFF のジムでも同じ（DB の関数で動かす）
    expect(sameDayRescheduleRule({ penaltyEnabled: false, laterFrom: "17:00", targetDate: TODAY, newDate: TODAY, newStart: "18:00", today: TODAY })).toBe("laterToday");
  });

  it("🔴 後ろへ動かせるジムでも、前の時間・同じ時刻は今まで通り（消化 ON なら店へ）", () => {
    expect(sameDayRescheduleRule({ penaltyEnabled: true, laterFrom: "17:00", targetDate: TODAY, newDate: TODAY, newStart: "16:45", today: TODAY })).toBe("contactGym");
    expect(sameDayRescheduleRule({ penaltyEnabled: true, laterFrom: "17:00", targetDate: TODAY, newDate: TODAY, newStart: "17:00", today: TODAY })).toBe("contactGym");
    expect(sameDayRescheduleRule({ penaltyEnabled: false, laterFrom: "17:00", targetDate: TODAY, newDate: TODAY, newStart: "16:45", today: TODAY })).toBe("normal");
  });

  it("当日の予約でなければ、いつもどおり（明日の予約を動かしても消化しない）", () => {
    expect(sameDayRescheduleRule({ penaltyEnabled: true, targetDate: "2026-11-08", newDate: "2026-11-09", today: TODAY })).toBe("normal");
    expect(sameDayRescheduleRule({ penaltyEnabled: true, targetDate: "2026-11-08", newDate: "2026-11-08", today: TODAY })).toBe("normal");
    expect(sameDayRescheduleRule({ penaltyEnabled: true, laterFrom: "17:00", targetDate: "2026-11-08", newDate: "2026-11-08", newStart: "18:00", today: TODAY })).toBe("normal");
  });

  it("当日キャンセルの消化がオフのジムでは、当日でもいつもどおり", () => {
    expect(sameDayRescheduleRule({ penaltyEnabled: false, targetDate: TODAY, newDate: "2026-11-08", today: TODAY })).toBe("normal");
    expect(sameDayRescheduleRule({ penaltyEnabled: false, targetDate: TODAY, newDate: TODAY, today: TODAY })).toBe("normal");
  });
});

describe("laterTodayFloor（当日の後ろへ動かせるときの下限）", () => {
  const target = { date: TODAY, startTime: "17:00" };

  it("設定が ON・当日の予約・まだ始まっていない → 下限は元の開始時刻", () => {
    expect(laterTodayFloor({ enabled: true, target, today: TODAY, nowTime: "12:35" })).toBe("17:00");
    expect(laterTodayFloor({ enabled: true, target, today: TODAY, nowTime: "16:59" })).toBe("17:00");
  });

  it("🔴 始まった（開始時刻を過ぎた）予約は動かさない（DB も同じ）", () => {
    expect(laterTodayFloor({ enabled: true, target, today: TODAY, nowTime: "17:00" })).toBeNull();
    expect(laterTodayFloor({ enabled: true, target, today: TODAY, nowTime: "17:30" })).toBeNull();
  });

  it("設定が OFF・変更中でない・当日の予約でない・時刻が無い → null", () => {
    expect(laterTodayFloor({ enabled: false, target, today: TODAY, nowTime: "12:00" })).toBeNull();
    expect(laterTodayFloor({ enabled: true, target: null, today: TODAY, nowTime: "12:00" })).toBeNull();
    expect(laterTodayFloor({ enabled: true, target: { date: "2026-11-08", startTime: "17:00" }, today: TODAY, nowTime: "12:00" })).toBeNull();
    expect(laterTodayFloor({ enabled: true, target: { date: TODAY, startTime: "" }, today: TODAY, nowTime: "12:00" })).toBeNull();
  });
});

describe("isLaterTodayError", () => {
  it("move_booking_later_today の断り（GB013）だけ", () => {
    expect(isLaterTodayError({ code: "GB013" })).toBe(true);
    expect(isLaterTodayError({ code: "GB012" })).toBe(false);
    expect(isLaterTodayError({ code: "P0001" })).toBe(false);
    expect(isLaterTodayError(null)).toBe(false);
    expect(isLaterTodayError("GB013")).toBe(false);
  });
});

describe("お客様の予約変更の画面（CustomerBooking）", () => {
  const src = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
  const handlerStart = src.indexOf("const handleReschedule = async () => {");
  const handler = src.slice(handlerStart, src.indexOf("const cancelTargetForfeits", handlerStart));

  it("下限は、ジムの設定（=== true）・変更中の予約・今日・今の時刻（JST）から決める。今開いている日が今日のときだけ効かせる", () => {
    expect(src).toContain(
      "laterTodayFloor({ enabled: tenant?.same_day_later_reschedule_enabled === true, target: b, today: getJSTToday(), nowTime: formatJST(new Date(), \"HH:mm\") })",
    );
    expect(src).toContain("const laterTodayFrom = laterTodayFromFor(rescheduleTarget);");
    expect(src).toContain("const laterFloor = dateKey === getJSTToday() ? laterTodayFrom : null;");
  });

  it("🔴 判定は変更の実行より前に1回だけ行い、締切・消化の警告・回数上限の先回りより前に置く", () => {
    const rule = handler.indexOf("const rule = sameDayRescheduleRule({");
    expect(rule).toBeGreaterThan(0);
    expect(handler.match(/sameDayRescheduleRule\(/g)).toHaveLength(1);
    expect(rule).toBeLessThan(handler.indexOf("isSlotPastCutoff(dateKey, slot.time, cutoff)"));
    expect(rule).toBeLessThan(handler.indexOf("setRescheduleForfeitPending(true)"));
    expect(rule).toBeLessThan(handler.indexOf("await rescheduleBooking("));
    const call = handler.slice(rule, handler.indexOf(";", rule));
    expect(call).toContain("penaltyEnabled: !!tenant?.same_day_cancel_penalty_enabled");
    expect(call).toContain("laterFrom: laterTodayFrom");
    expect(call).toContain("targetDate: rescheduleTarget.date");
    expect(call).toContain("newDate: dateKey");
    expect(call).toContain("newStart: slot.time");
    expect(call).toContain("today: getJSTToday()");
  });

  it("同じ日の中で後ろへ動かせない変更は、消化の警告・変更の実行より前に止めて、店への連絡を案内する", () => {
    const stop = handler.indexOf('if (rule === "contactGym") { toast.error(t("booking.sameDayTimeChangeContactGym")); setSelectedSlot(null); return; }');
    expect(stop).toBeGreaterThan(0);
    expect(stop).toBeLessThan(handler.indexOf("setRescheduleForfeitPending(true)"));
    expect(stop).toBeLessThan(handler.indexOf("await rescheduleBooking("));
  });

  it("🔴 後ろへの変更（later）は締切の例外・消化の警告も回数上限の先回りもしない・DB の関数で動かす", () => {
    expect(handler).toContain('const later = rule === "laterToday";');
    expect(handler).toContain("if (isSlotPastCutoff(dateKey, slot.time, cutoff) && !later) {");
    expect(handler).toContain("if (!later && rescheduleTargetForfeits && isPlanLimitReachedOn(dateKey)) {");
    expect(handler).toContain("if (!later && rescheduleTargetForfeits && !rescheduleForfeitPending) {");
    expect(handler).toMatch(
      /const \{ error, restoreFailed \} = later\s+\? await moveBookingLaterToday\(rescheduleTarget\.id, dateKey, slot\.time\)\s+: await rescheduleBooking\(rescheduleTarget\.id, dateKey, slot\.time, \{ forfeitOld: rescheduleTargetForfeits \}\);/,
    );
    // 断られたとき（設定が OFF になった・始まった等）は、専用の案内
    expect(handler).toContain('isLaterTodayError(error) ? t("booking.laterTodayNotAllowed")');
  });

  it("明日以降への変更の消化（forfeitOld）は今までどおり", () => {
    expect(src).toContain("{ forfeitOld: rescheduleTargetForfeits }");
  });

  it("🔴 枠: 今日を開いているとき、元の開始時刻より後ろの枠だけ締切を外す（前の枠は今まで通り）", () => {
    expect(src).toContain("const tooSoon = isSlotPastCutoff(dateKey, time, cutoff);");
    expect(src).toContain("const late = tooSoon && !(laterFloor !== null && time > laterFloor);");
    expect(src).toContain("available: !selectedDayViewOnly && !blocked && !late && !overLimit && !notAccepting,");
    expect(src).toContain("blocked, tooSoon: late, overLimit, notAccepting,");
  });

  it("後ろへ動かせるときは「見るだけ」の日・「見るだけ」の案内にしない。代わりに後ろへ動かせる案内を出す", () => {
    expect(src).toContain("!!date && date === getJSTToday() && laterTodayFrom === null && isDayPastCutoff(");
    expect(src).toContain("const selectedDayViewOnly = isDayViewOnly(closedDays, dateKey, hasOwnBookingOn(dateKey)) && laterFloor === null;");
    expect(src).toContain(
      "<SameDayNotice laterToday={laterFloor !== null} viewOnly={isViewOnlyDay(dateKey)} phone={tenant?.phone} lineUrl={tenant?.line_url} onOpenChat={onOpenChat} />",
    );
  });

  it("当日の後ろへ動かせる予約で「変更」を押したら、今日を開いておく", () => {
    const start = src.slice(src.indexOf("const startReschedule = (b: BookingWithTime) => {"), src.indexOf("const cancelReschedule"));
    expect(start).toContain("setSelectedDate(laterTodayFromFor(b) !== null ? startOfDay(getJSTNow()) : undefined);");
  });

  it("明日以降へ動かすときの消化の警告で、後ろへ動かせるジムでは「今日の後ろなら消化しない」と伝える", () => {
    expect(src).toContain(
      't(laterTodayFrom !== null ? "booking.rescheduleForfeitWarningDescLaterToday" : "booking.rescheduleForfeitWarningDesc")',
    );
  });
});

describe("文面（5言語）", () => {
  const locales = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
  const read = (loc: string) => JSON.parse(readFileSync(`src/locales/${loc}.json`, "utf8"));

  it("店への連絡・後ろへ動かせる案内・断られたとき・消化の警告（後ろへ動かせるジム用）・設定の文が全言語にある", () => {
    for (const loc of locales) {
      const j = read(loc);
      for (const text of [
        j.booking.sameDayTimeChangeContactGym,
        j.booking.laterTodayHint,
        j.booking.laterTodayNotAllowed,
        j.booking.rescheduleForfeitWarningDescLaterToday,
        j.settings.trainer.sameDayLaterMoveTitle,
        j.settings.trainer.sameDayLaterMoveDesc,
      ]) {
        expect(typeof text === "string" && text.length > 0, loc).toBe(true);
      }
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

  it("日本語: 後ろへの変更の文は「後ろ」「消化にはならない」を書き、前の時間は店へと案内する", () => {
    const ja = read("ja");
    for (const text of [ja.booking.laterTodayHint, ja.booking.rescheduleForfeitWarningDescLaterToday, ja.settings.trainer.sameDayLaterMoveDesc]) {
      expect(text).toContain("後ろ");
      expect(text).toMatch(/消化には(なり|なら)/);
    }
    expect(ja.booking.laterTodayHint).toContain("前の時間");
    expect(ja.settings.trainer.sameDayLaterMoveDesc).toContain("前の時間");
    // 締切が「前日まで」のジムでも使えることを、設定の説明で伝えている
    expect(ja.settings.trainer.sameDayLaterMoveDesc).toContain("締切");
  });
});
