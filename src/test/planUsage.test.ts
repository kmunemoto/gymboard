import { describe, it, expect } from "vitest";
import { computePlanUsage, resolvePlanUsageInput } from "@/lib/planUsage";
import { toJSTDate } from "@/lib/timezone";

// 「現在」を固定（2026-07-10 12:00 JST）。toJSTDate を通すことで端末TZに依存せず
// JST基準の比較になる（バグ修正の核心）。下の期待値は全タイムゾーンで成立する。
const NOW = toJSTDate("2026-07-10T12:00:00+09:00");
const b = (iso: string, status = "予約済み") => ({ booking_date: iso, status });

describe("computePlanUsage", () => {
  it("月額(subscription)は今サイクル[6/20,7/21)で集計し、月初でリセットされる", () => {
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 6, validityDays: null, startDate: "2026-06-20" },
      [
        b("2026-06-20T00:30:00+09:00"), // 初日早朝（範囲内）
        b("2026-06-22T10:00:00+09:00"),
        b("2026-07-05T09:00:00+09:00"),
        b("2026-07-10T23:00:00+09:00"), // now より後（未実施だが範囲内）
        b("2026-07-21T09:00:00+09:00"), // 次サイクル（範囲外）
        b("2026-07-06T10:00:00+09:00", "キャンセル済み"), // 除外
      ],
      NOW,
    );
    expect(usage.kind).toBe("subscription");
    expect(usage.total).toBe(6);
    expect(usage.used).toBe(4); // 6/20,6/22,7/05,7/10（7/21は次サイクル、キャンセルは除外）
    expect(usage.remaining).toBe(2);
    expect(usage.isUnlimited).toBe(false);
  });

  it("回数券(ticket)は有効期間内の合計で集計し、月をまたいでもリセットしない", () => {
    const usage = computePlanUsage(
      { planType: "ticket", maxSessions: 10, validityDays: 90, startDate: "2026-06-20" },
      [
        b("2026-06-22T10:00:00+09:00"),
        b("2026-07-05T09:00:00+09:00"),
        b("2026-08-15T10:00:00+09:00"), // 翌々月でも有効期間内（90日 = ~9/18まで）
        b("2026-10-01T10:00:00+09:00"), // 有効期間外
      ],
      NOW,
    );
    expect(usage.kind).toBe("ticket");
    expect(usage.total).toBe(10);
    expect(usage.used).toBe(3);
    expect(usage.remaining).toBe(7);
  });

  it("通い放題(max_sessions=null)は無制限扱い", () => {
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: null, validityDays: null, startDate: "2026-06-20" },
      [b("2026-06-22T10:00:00+09:00"), b("2026-07-05T09:00:00+09:00")],
      NOW,
    );
    expect(usage.isUnlimited).toBe(true);
    expect(usage.total).toBeNull();
    expect(usage.remaining).toBeNull();
    expect(usage.used).toBe(2);
  });

  it("期間プラン(period)は期限切れを判定する", () => {
    const usage = computePlanUsage(
      { planType: "period", maxSessions: null, validityDays: 30, startDate: "2026-05-01" },
      [],
      NOW,
    );
    expect(usage.isUnlimited).toBe(true);
    expect(usage.isExpired).toBe(true); // 5/01 + 30日 < 7/10
  });

  it("起算日が無い場合は未設定扱い", () => {
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 4, validityDays: null, startDate: null },
      [],
      NOW,
    );
    expect(usage.isUnconfigured).toBe(true);
  });
});

describe("resolvePlanUsageInput", () => {
  it("tenant_plans があればそれを正とする", () => {
    const input = resolvePlanUsageInput("回数券10", { plan_type: "ticket", max_sessions: 10, validity_days: 90 }, "2026-06-20");
    expect(input).toEqual({ planType: "ticket", maxSessions: 10, validityDays: 90, startDate: "2026-06-20" });
  });

  it("tenant_plans に無い『月N回』は subscription として解決（旧データ互換）", () => {
    const input = resolvePlanUsageInput("月3回", null, "2026-06-20");
    expect(input).toEqual({ planType: "subscription", maxSessions: 3, validityDays: null, startDate: "2026-06-20" });
  });

  it("『通い放題』は無制限の subscription として解決", () => {
    const input = resolvePlanUsageInput("通い放題", null, "2026-06-20");
    expect(input).toEqual({ planType: "subscription", maxSessions: null, validityDays: null, startDate: "2026-06-20" });
  });

  it("解決できない名称は null", () => {
    expect(resolvePlanUsageInput("プラン未設定", null, "2026-06-20")).toBeNull();
    expect(resolvePlanUsageInput(null, null, "2026-06-20")).toBeNull();
  });
});
