import { describe, it, expect } from "vitest";
import {
  DASHBOARD_STAT_TOGGLES,
  DASHBOARD_SECTION_TOGGLES,
  NAV_TAB_TOGGLES,
  isDisplayOn,
  isNavTabVisible,
  type GymDisplayColumn,
} from "@/lib/gymDisplaySettings";
import type { Tenant } from "@/hooks/useTenant";

// 表示ON/OFF判定はどれも「明示的に false のときだけ非表示」。
// テナント未取得・列未適用の環境でも既定で表示されること（＝従来どおり）が要。
const tenantWith = (patch: Partial<Record<GymDisplayColumn, boolean>>) =>
  ({ id: "t1", ...patch }) as unknown as Tenant;

describe("gymDisplaySettings", () => {
  it("既定は表示（テナント未取得・列が無い環境でも従来どおり全部出す）", () => {
    expect(isDisplayOn(null, "show_revenue_chart")).toBe(true);
    expect(isDisplayOn(undefined, "show_today_schedule")).toBe(true);
    // マイグレーション未適用で列自体が無い（undefined）ケース
    expect(isDisplayOn(tenantWith({}), "show_utilization_heatmap")).toBe(true);
  });

  it("明示的に false のときだけ非表示になる", () => {
    expect(isDisplayOn(tenantWith({ show_revenue_chart: false }), "show_revenue_chart")).toBe(false);
    expect(isDisplayOn(tenantWith({ show_revenue_chart: true }), "show_revenue_chart")).toBe(true);
  });

  it("項目ごとに独立して効く（1つ切っても他は表示のまま）", () => {
    const tenant = tenantWith({ show_revenue_chart: false });
    expect(isDisplayOn(tenant, "show_revenue_chart")).toBe(false);
    expect(isDisplayOn(tenant, "show_today_schedule")).toBe(true);
    expect(isDisplayOn(tenant, "show_utilization_heatmap")).toBe(true);
  });

  it("ホーム・顧客・予約・設定は常に表示（隠せない＝操作不能にならない）", () => {
    // 全部 false にしても、これらのタブは必ずメニューに残る
    const allOff = tenantWith(
      Object.fromEntries(NAV_TAB_TOGGLES.map((n) => [n.column, false])) as Record<GymDisplayColumn, boolean>,
    );
    for (const tab of ["dashboard", "clients", "schedule", "gym-settings"] as const) {
      expect(isNavTabVisible(allOff, tab)).toBe(true);
    }
  });

  it("設定でオフにしたタブはメニューから外れる", () => {
    const tenant = tenantWith({ show_nav_messages: false });
    expect(isNavTabVisible(tenant, "messages")).toBe(false);
    // 他のタブは巻き添えにならない
    expect(isNavTabVisible(tenant, "exercises")).toBe(true);
    expect(isNavTabVisible(tenant, "announcements")).toBe(true);
  });

  it("トグル定義に重複が無く、参照するカラムが一意である", () => {
    const columns = [
      ...DASHBOARD_STAT_TOGGLES,
      ...DASHBOARD_SECTION_TOGGLES,
      ...NAV_TAB_TOGGLES,
    ].map((x) => x.column);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it("メニューのトグルは対象タブと1対1で対応している", () => {
    const tabs = NAV_TAB_TOGGLES.map((n) => n.tab);
    expect(new Set(tabs).size).toBe(tabs.length);
    // 隠すと操作不能になり得るタブは対象に含めない
    for (const forbidden of ["dashboard", "clients", "schedule", "gym-settings"]) {
      expect(tabs).not.toContain(forbidden);
    }
  });
});
