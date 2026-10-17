/**
 * 営業時間外・定休日に、店がイレギュラーで予約を入れる（2026-10-17）。
 *
 * 宗本さん「イレギュラーで営業時間外に予約をジム側で手入力で入れられる機能」。
 * 決めたこと: 1日の上限に「数えない」／定休日にも「入れられる」。
 *
 * 🔴 壊しやすいもの:
 *   1. 時間外の予約が予定表の「日」表示に出ない（行を営業時間からだけ作っている）
 *   2. 担当のシフト外（GB002）で断られる
 *   3. 1日の上限に数えてしまう（DB の2か所と予定表の人数のどれか1つでも）
 *   4. お客様が自分の予約に印を付けて、1日の上限をすり抜ける
 *   5. 日付をまたぐ予約（23:30 開始で翌 0:30 終了）を作る
 *   6. 午前・午後の打ち間違い（確認なしで入る）
 *   7. お客様が時間外の予約を「変更」して、巻き戻しで元に戻せなくなる
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderHook, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import { endTimeOf, isOutsideBusinessHours, outsideHoursStarts, withBookingStartTimes } from "@/lib/outsideHours";
import { minutesToTime } from "@/lib/businessHours";

vi.mock("@/hooks/useBookingClosedDays", () => ({
  useBookingClosedDays: () => ({ closedDays: [], refetch: vi.fn() }),
  useCloseDay: () => ({ close: vi.fn(), reopen: vi.fn(), saving: false }),
  useUncappedDays: () => ({ uncappedDays: [], refetch: vi.fn() }),
  useUncapDay: () => ({ uncap: vi.fn(), recap: vi.fn(), saving: false }),
}));

const { useDayReception } = await import("@/hooks/useDayReception");
const { OutsideHoursPicker, OutsideHoursBadge } = await import("@/components/trainer/OutsideHoursPicker");

afterEach(cleanup);

/** サルーテと同じ営業時間（10:00〜22:30）。日曜だけ定休日にした版も使う */
const HOURS = { start: "10:00", end: "22:30" };
const HOURS_SUN_CLOSED = { start: "10:00", end: "22:30", days: { "0": null } };
const times = (ms: number[]) => ms.map(minutesToTime);

describe("選べる開始時刻（営業時間外だけ）", () => {
  it("🔴 60分のセッション: 開店前は 0:00〜9:45、閉店後は 21:45〜23:00（営業時間内に収まる時刻は出さない）", () => {
    const s = outsideHoursStarts(HOURS, "2026-10-20", 60);
    expect(s.closedDay).toBe(false);
    expect(times(s.before)[0]).toBe("00:00");
    expect(times(s.before).slice(-3)).toEqual(["09:15", "09:30", "09:45"]); // 開店にかかるものも入る
    expect(times(s.after)).toEqual(["21:45", "22:00", "22:15", "22:30", "22:45", "23:00"]);
    expect(times(s.after)).not.toContain("21:30"); // 21:30〜22:30 は営業時間内（普通の枠）
  });

  it("🔴 日付をまたぐ予約は作らない（60分なら 23:00 開始まで、90分なら 22:30 開始まで）", () => {
    expect(times(outsideHoursStarts(HOURS, "2026-10-20", 60).after).slice(-1)).toEqual(["23:00"]);
    expect(times(outsideHoursStarts(HOURS, "2026-10-20", 90).after).slice(-1)).toEqual(["22:30"]);
  });

  it("🔴 定休日は1日中が時間外（決めたこと 2）", () => {
    const s = outsideHoursStarts(HOURS_SUN_CLOSED, "2026-10-18", 60); // 日曜
    expect(s.closedDay).toBe(true);
    expect(s.before).toEqual([]);
    expect(times(s.after)[0]).toBe("00:00");
    expect(times(s.after)).toContain("12:00");
    expect(times(s.after).slice(-1)).toEqual(["23:00"]);
  });

  it("時間外かどうか（一部でもかかれば時間外）", () => {
    expect(isOutsideBusinessHours(HOURS, "2026-10-20", 7 * 60, 60)).toBe(true);
    expect(isOutsideBusinessHours(HOURS, "2026-10-20", 9 * 60 + 30, 60)).toBe(true);
    expect(isOutsideBusinessHours(HOURS, "2026-10-20", 22 * 60, 60)).toBe(true);
    expect(isOutsideBusinessHours(HOURS, "2026-10-20", 12 * 60, 60)).toBe(false);
    expect(isOutsideBusinessHours(HOURS_SUN_CLOSED, "2026-10-18", 12 * 60, 60)).toBe(true);
    expect(endTimeOf(7 * 60, 60)).toBe("08:00");
  });

  it("🔴 予定表の行に、予約の開始時刻を足す（時間外の 07:00 の予約が表に出る）", () => {
    expect(withBookingStartTimes(["10:00", "10:15"], [{ startTime: "07:00" }, { startTime: "10:00" }, { startTime: "23:00" }]))
      .toEqual(["07:00", "10:00", "10:15", "23:00"]);
  });
});

describe("時刻を選ぶ部品", () => {
  const base = { dateKey: "2026-10-20", operatingHours: HOURS, sessionMinutes: 60, isBlocked: () => false };

  it("開店前／閉店後に分けて並べ、選ぶと開始〜終了を出す。重なる時刻は押せない", () => {
    const onChange = vi.fn();
    const { rerender } = render(<OutsideHoursPicker {...base} value="" onChange={onChange} confirming={false} isBlocked={(t) => t === "07:30"} />);
    expect(screen.getByText(i18n.t("schedule.outsideHoursBefore"))).toBeTruthy();
    expect(screen.getByText(i18n.t("schedule.outsideHoursAfter"))).toBeTruthy();
    expect((screen.getByRole("button", { name: /^07:30/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "07:00" }));
    expect(onChange).toHaveBeenCalledWith("07:00");
    rerender(<OutsideHoursPicker {...base} value="07:00" onChange={onChange} confirming={false} />);
    expect(screen.getByText("07:00〜08:00")).toBeTruthy();
  });

  it("🔴 1回目に押したあとは、日付と時刻を大きく出して確認する（打ち間違い防止）", () => {
    render(<OutsideHoursPicker {...base} value="07:00" onChange={vi.fn()} confirming />);
    const box = screen.getByTestId("outside-hours-confirm");
    expect(box.textContent).toContain("07:00");
    expect(box.textContent).toContain("08:00");
  });

  it("定休日は「定休日（終日）」の1区分", () => {
    render(<OutsideHoursPicker {...base} dateKey="2026-10-18" operatingHours={HOURS_SUN_CLOSED} value="" onChange={vi.fn()} confirming={false} />);
    expect(screen.getByText(i18n.t("schedule.outsideHoursClosedDay"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("schedule.outsideHoursBefore"))).toBeNull();
  });

  it("予定表の印", () => {
    render(<OutsideHoursBadge />);
    expect(screen.getByTestId("outside-hours-badge").textContent).toContain(i18n.t("schedule.outsideHoursBadge"));
  });
});

describe("1日の上限に数えない（決めたこと 1）", () => {
  it("🔴 予定表の人数（受付の札）から時間外の予約を除く", () => {
    const bookings = [
      { date: "2026-10-20", status: "予約済み", user_id: "a" },
      { date: "2026-10-20", status: "予約済み", user_id: "b", outsideHours: true },
      { date: "2026-10-20", status: "予約済み", user_id: "c" },
    ];
    const { result } = renderHook(() => useDayReception("2026-10-19", "2026-10-25", bookings, 4));
    expect(result.current.bookedCountOn("2026-10-20")).toBe(2);
  });

  const SQL = readFileSync("supabase/migrations/20261017010000_outside_hours_bookings.sql", "utf8");
  const fn = (name: string) => {
    const i = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    expect(i, name).toBeGreaterThan(-1);
    return SQL.slice(i, SQL.indexOf("$function$;", i));
  };

  it("🔴 DB の数え方（tenant_day_booking_count・get_tenant_closed_days）も時間外を除く", () => {
    expect(fn("tenant_day_booking_count")).toContain("AND NOT b.outside_hours");
    expect(fn("get_tenant_closed_days")).toContain("AND NOT b.outside_hours");
  });

  it("列の既定は false（今までの予約は全部「時間内」のまま）・テナント固有の値を入れない", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS outside_hours boolean NOT NULL DEFAULT false/);
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("🔴 印を付けられるのは店のスタッフとサービスロールだけ（お客様が付けたら外す）", () => {
    const guard = SQL.slice(SQL.indexOf("FUNCTION public.guard_booking_outside_hours_flag()"), SQL.indexOf("$fn$;"));
    expect(guard).toContain("has_tenant_role(NEW.tenant_id, v_actor, ARRAY['owner', 'trainer'])");
    expect(guard).toContain("NEW.outside_hours := false;");
    expect(SQL).toMatch(/CREATE TRIGGER trg_guard_booking_outside_hours_flag\s+BEFORE INSERT OR UPDATE ON public\.bookings/);
  });

  it("🔴 担当のシフト外（GB002）は、時間外の予約で、入れた人が店のスタッフのときだけ見ない", () => {
    const shift = fn("guard_booking_staff_shift");
    expect(shift).toMatch(/outside_hours'\)::boolean, false\)\s+AND \(auth\.uid\(\) IS NULL\s+OR public\.has_tenant_role\(NEW\.tenant_id, auth\.uid\(\), ARRAY\['owner', 'trainer'\]\)\)/);
    expect(shift).toContain("ERRCODE = 'GB002'"); // それ以外は今まで通り断る
  });
});

describe("配線", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const SCHEDULE = strip(readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8"));
  const HOOK = strip(readFileSync("src/hooks/useBookings.ts", "utf8"));

  it("代理予約: スイッチ・時刻の選択・2回押す確認・印を付けて作る・閉じたら戻す", () => {
    expect(SCHEDULE).toContain("<OutsideHoursToggle checked={proxyOutside}");
    expect(SCHEDULE).toContain("<OutsideHoursPicker dateKey={proxyDateKey}");
    expect(SCHEDULE).toContain("if (proxyOutside && !proxyOutsideConfirm) { setProxyOutsideConfirm(true); return; }");
    expect(SCHEDULE).toContain("outsideHours: proxyOutside }");
    expect(SCHEDULE).toContain("proxyOpts.minutes, proxyOpts.snapshot, proxyOutside);");
    expect(SCHEDULE).toContain("if (!o) { setProxyOutside(false); setProxyOutsideConfirm(false); }");
  });

  it("🔴 時間外の入力では、定休日・担当の休みの曜日も選べ、出勤曜日の事前チェックで止めない", () => {
    expect(SCHEDULE).toContain("if (proxyOutside) return false;");
    expect(SCHEDULE).toContain("if (!proxyOutside && proxyStaffId && !staffWorksOnWeekday(");
  });

  it("🔴 重なりの確認は普通の枠と同じ判定（時間外でもダブルブッキングしない）", () => {
    expect(SCHEDULE).toContain("isBlocked={(time) => checkSlotBlocked(bookings, proxyDateKey, time, undefined, bookingBufferMinutes, proxySessionMinutes, capacityAt(proxyDateKey, time), proxyStaffId || null)}");
  });

  it("🔴 予定表の「日」表示の行に予約の開始時刻を足す・時間外の印を出す", () => {
    expect(SCHEDULE).toContain("withBookingStartTimes(businessGridMinutes(tenant?.operating_hours).map(minutesToTime), bookings)");
    expect(SCHEDULE).toContain("{session.outsideHours && <OutsideHoursBadge />}");
    expect(SCHEDULE).toContain("{booking.outsideHours && <OutsideHoursBadge />}");
    expect(readFileSync("src/components/trainer/WeekTimelineView.tsx", "utf8")).toContain("b.outsideHours &&");
  });

  it("予約の作成・読み出し: 印は付けるときだけ送る（列が未適用のDBでも普通の予約は通る）", () => {
    expect(HOOK).toContain("...(opts.outsideHours ? { outside_hours: true } : {}),");
    expect(HOOK).toContain("outsideHours: row.outside_hours === true,");
    expect(HOOK).toContain("staffUserId, customAnswers, optionMinutes, bookingOptions, outsideHours,");
  });

  it("🔴 お客様は時間外の予約を「変更」しない（ジムへの連絡を案内。キャンセルはできる）", () => {
    const BOOKING = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
    expect(BOOKING).toContain('if (b.outsideHours) { toast.info(t("booking.outsideHoursRescheduleNote")); return; }');
  });

  it("文言（5言語）", () => {
    for (const lang of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const j = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      for (const k of ["outsideHoursToggle", "outsideHoursToggleDesc", "outsideHoursBefore", "outsideHoursAfter", "outsideHoursClosedDay", "outsideHoursNone", "outsideHoursConfirm", "outsideHoursConfirmBtn", "outsideHoursBadge"]) {
        expect(j.schedule[k], `${lang} ${k}`).toBeTruthy();
      }
      expect(j.schedule.outsideHoursConfirm, lang).toContain("{{start}}");
      expect(j.booking.outsideHoursRescheduleNote, lang).toBeTruthy();
    }
  });
});
