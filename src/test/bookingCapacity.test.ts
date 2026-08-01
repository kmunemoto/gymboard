import { describe, it, expect } from "vitest";
import { checkSlotBlocked, type BookingWithTime } from "@/hooks/useBookings";

// 同時に受けられる予約数（tenants.booking_capacity）の判定。
// ベッド2台・施術者2名のような店では、同じ時間に2件まで入れられる必要がある。
// 既定1のときは「1件でも重なれば満枠」＝この機能を入れる前と完全に同じ挙動でなければならない。
//
// 最終判定はDB側の check_booking_overlap（supabase/migrations/20260801000000_booking_capacity.sql）。
// ここはクライアント側の事前チェックが同じ規則で動くことを見張るテスト。

const DATE = "2026-08-10";

const booking = (startTime: string, endTime: string, over: Partial<BookingWithTime> = {}): BookingWithTime => ({
  id: `${startTime}-${Math.random()}`,
  user_id: "u1",
  date: DATE,
  startTime,
  endTime,
  clientName: "テスト",
  status: "予約済み",
  booking_type: "月4回",
  ...over,
});

/** 10:00 開始・60分セッション・15分バッファの候補枠を判定する */
const check = (list: BookingWithTime[], capacity?: number, time = "10:00") =>
  checkSlotBlocked(list, DATE, time, undefined, 15, 60, capacity);

describe("予約の同時受入数（booking_capacity）", () => {
  it("既定1では、重なる予約が1件でもあれば満枠（従来の挙動）", () => {
    expect(check([])).toBe(false);
    expect(check([booking("10:00", "11:00")])).toBe(true);
    // capacity を明示的に 1 で渡しても同じ
    expect(check([booking("10:00", "11:00")], 1)).toBe(true);
  });

  it("capacity=2 なら、重なりが1件のうちはまだ予約できる", () => {
    expect(check([booking("10:00", "11:00")], 2)).toBe(false);
    expect(check([booking("10:00", "11:00"), booking("10:30", "11:30")], 2)).toBe(true);
  });

  it("capacity=3 なら3件目までOK、4件目で満枠", () => {
    const two = [booking("10:00", "11:00"), booking("10:00", "11:00")];
    expect(check(two, 3)).toBe(false);
    expect(check([...two, booking("10:00", "11:00")], 3)).toBe(true);
  });

  it("ブロック枠（休憩・臨時休業）は空きがあっても店全体を塞ぐ", () => {
    const blocked = booking("10:00", "11:00", { isBlocked: true, status: "ブロック済み" });
    expect(check([blocked], 5)).toBe(true);
    // 予約1件 + ブロック1件 → capacity に余裕があってもブロックが優先して不可
    expect(check([booking("10:00", "11:00"), blocked], 5)).toBe(true);
  });

  it("時間が重ならない予約は数に入らない", () => {
    // 10:00開始の候補は 11:15 まで占有（60分+15分バッファ）。11:15開始の予約とは重ならない
    expect(check([booking("11:15", "12:15")], 1)).toBe(false);
  });

  it("キャンセル済みは数に入らない", () => {
    const cancelled = booking("10:00", "11:00", { status: "キャンセル済み" });
    expect(check([cancelled], 1)).toBe(false);
    expect(check([cancelled, booking("10:00", "11:00")], 2)).toBe(false);
  });

  it("別の日の予約は数に入らない", () => {
    expect(check([booking("10:00", "11:00", { date: "2026-08-11" })], 1)).toBe(false);
  });

  it("capacity に 0 や負数が来ても 1 として扱う（全予約が入らなくなる事故を防ぐ）", () => {
    expect(check([], 0)).toBe(false);
    expect(check([booking("10:00", "11:00")], 0)).toBe(true);
    expect(check([booking("10:00", "11:00")], -3)).toBe(true);
  });

  it("バッファは既存予約の後ろにも効く（capacity に余裕があっても件数は数える）", () => {
    // 09:00-10:00 の予約は 10:15 まで占有。10:00開始の候補は重なる
    expect(check([booking("09:00", "10:00")], 1)).toBe(true);
    expect(check([booking("09:00", "10:00")], 2)).toBe(false);
  });
});
