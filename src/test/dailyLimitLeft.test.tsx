/**
 * 残り枠に「1日の上限人数」を効かせる（2026-10-06）。
 *
 * 宗本さん「僕のジムの場合、一日4枠までって制限掛けてるので、その設定は考慮しないと」。
 * 上限4の店で、時間だけで数えた「残7」が出ていた。
 *
 * 🔴 壊しやすいもの:
 *   1. 上限を見ない（残7のまま）
 *   2. 画面側で予約を数え直す（体験・当日キャンセル消化の扱いが DB とズレる）
 *   3. 上限に達した日・手で閉めた日に何も出ない（どちらも「満」にする。2026-10-07）
 *   4. 他のジムの会員・未ログインにも日ごとの件数を返す
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useTenant", () => ({ useTenant: () => ({ tenant: { id: "t1" } }) }));

const { useDailyLimitLeft } = await import("@/hooks/useDailyLimitLeft");
const { dayUnselectableReason } = await import("@/lib/bookingCalendarDay");
const { dayRemainingBadge } = await import("@/lib/dayRemainingSlots");

beforeEach(() => rpc.mockReset());

describe("useDailyLimitLeft", () => {
  it("日ごとの「あと何件」を返す。上限の無い日（返ってこない日）は Infinity", async () => {
    rpc.mockResolvedValue({ data: [{ limit_date: "2026-10-13", left_count: 2 }, { limit_date: "2026-10-15", left_count: 0 }], error: null });
    const { result } = renderHook(() => useDailyLimitLeft(true, "2026-11-06", 1));
    await waitFor(() => expect(result.current("2026-10-13")).toBe(2));
    expect(result.current("2026-10-15")).toBe(0);
    expect(result.current("2026-10-20")).toBe(Number.POSITIVE_INFINITY);
    expect(rpc).toHaveBeenCalledWith("get_tenant_daily_limit_left", expect.objectContaining({ p_tenant_id: "t1", to_date: "2026-11-06" }));
  });

  it("🔴 設定 OFF の店では問い合わせない（今まで通り）", async () => {
    const also = vi.fn();
    const { result } = renderHook(() => useDailyLimitLeft(false, "2026-11-06", 1, also));
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).not.toHaveBeenCalled();
    expect(also).not.toHaveBeenCalled();
    expect(result.current("2026-10-13")).toBe(Number.POSITIVE_INFINITY);
  });

  it("読めなければ上限で絞らない（時間だけで数える）", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    const { result } = renderHook(() => useDailyLimitLeft(true, "2026-11-06", 1));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(result.current("2026-10-13")).toBe(Number.POSITIVE_INFINITY);
  });

  it("埋まり枠を読み直すたびに読み直し、受付終了の日の一覧も一緒に読み直す", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const also = vi.fn();
    const { rerender } = renderHook(({ trigger }) => useDailyLimitLeft(true, "2026-11-06", trigger, also), { initialProps: { trigger: 1 } });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    rerender({ trigger: 2 });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(also).toHaveBeenCalledTimes(2);
  });
});

describe("上限に達した日も、手で閉めた日（受付停止中）も「満」", () => {
  const rules = (manual: boolean) => ({
    today: "2026-10-06", businessHours: { start: "10:00", end: "22:30" } as never,
    closedDays: [{ closed_date: "2026-10-13", manual, reason: null }],
    hasOwnBookingOn: () => false, isDayFull: () => false,
    staffSchedules: null, staffUserId: null, bookingWindowDays: 30, nextCyclePaymentGate: null,
  });

  it("上限に達した日 → limitReached → 「満」", () => {
    const reason = dayUnselectableReason("2026-10-13", rules(false));
    expect(reason).toBe("limitReached");
    expect(dayRemainingBadge(reason, 0)).toEqual({ kind: "full" });
  });

  it("手で閉めた日（受付停止中） → hardClosed → 「満」", () => {
    // 宗本さん「受付停止中も満と表示するようにして、枠の上限と同意味」（2026-10-07）
    const reason = dayUnselectableReason("2026-10-13", rules(true));
    expect(reason).toBe("hardClosed");
    expect(dayRemainingBadge(reason, 0)).toEqual({ kind: "full" });
  });
});

describe("配線とDB", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const BOOKING = strip(readFileSync("src/components/customer/CustomerBooking.tsx", "utf8"));
  const SQL = readFileSync("supabase/migrations/20261006020000_daily_limit_left.sql", "utf8").replace(/--[^\n]*/g, "");

  it("🔴 残り = min(上限まであと何件, 時間に入る回数)", () => {
    expect(BOOKING).toContain("useDailyLimitLeft(showRemaining, maxBookableKey, bookedSlots, refetchClosedDays)");
    expect(BOOKING).toContain("() => Math.min(limitLeftOn(key), countRemainingSlots({");
  });

  it("🔴 件数は上限のガードと同じ関数で数える（画面で数え直さない）", () => {
    expect(SQL).toContain("public.tenant_day_booking_count(p_tenant_id, d::date)");
    expect(SQL).toMatch(/booking_uncapped_days/);
  });

  it("🔴 自分のジムだけ・未ログインは先に弾く・anon に渡さない", () => {
    expect(SQL).toMatch(/IF v_uid IS NULL OR NOT public\.is_tenant_member\(p_tenant_id, v_uid\) THEN\s+RETURN;/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.get_tenant_daily_limit_left\(uuid, date, date\) FROM PUBLIC, anon;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_tenant_daily_limit_left\(uuid, date, date\) TO authenticated;/);
    expect(SQL).not.toMatch(/TO anon/);
  });

  it("読む範囲は受付終了の一覧と同じ上限（92日）", () => {
    expect(SQL).toContain("to_date > from_date + 92");
  });
});
