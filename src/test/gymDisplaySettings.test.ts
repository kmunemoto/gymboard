import { describe, it, expect } from "vitest";
import {
  DASHBOARD_STAT_TOGGLES,
  DASHBOARD_SECTION_TOGGLES,
  NAV_TAB_TOGGLES,
  ALL_DISPLAY_TOGGLES,
  GYM_DISPLAY_PRESETS,
  detectPreset,
  isDisplayOn,
  isNavTabVisible,
  presetToValues,
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

// 表示量プリセット（機能が多すぎる問題への対処）。
// 重要な不変条件は「既存ジムの表示を勝手に変えないこと」。プリセットは
// (1) 新規ジムのオンボーディング (2) 設定画面で明示的に押したとき、にだけ効く。
describe("表示量のプリセット", () => {
  it("どのプリセットも17項目すべてを明示した値を返す", () => {
    // 一部だけ書くと、残りが前の設定のまま中途半端に混ざる
    for (const preset of GYM_DISPLAY_PRESETS) {
      const values = presetToValues(preset);
      expect(Object.keys(values).length, preset).toBe(ALL_DISPLAY_TOGGLES.length);
      for (const { column } of ALL_DISPLAY_TOGGLES) {
        expect(typeof values[column], `${preset}.${column}`).toBe("boolean");
      }
    }
  });

  it("full は従来どおり全部表示（＝DBの既定値と同じ）", () => {
    const values = presetToValues("full");
    for (const { column } of ALL_DISPLAY_TOGGLES) expect(values[column], column).toBe(true);
  });

  it("simple ⊂ standard ⊂ full の包含関係になっている", () => {
    const simple = presetToValues("simple");
    const standard = presetToValues("standard");
    for (const { column } of ALL_DISPLAY_TOGGLES) {
      if (simple[column]) expect(standard[column], `${column} が simple にあって standard に無い`).toBe(true);
    }
    const simpleOn = ALL_DISPLAY_TOGGLES.filter((tg) => simple[tg.column]).length;
    const standardOn = ALL_DISPLAY_TOGGLES.filter((tg) => standard[tg.column]).length;
    expect(simpleOn).toBeGreaterThan(0);
    expect(simpleOn).toBeLessThan(standardOn);
    expect(standardOn).toBeLessThan(ALL_DISPLAY_TOGGLES.length);
  });

  it("simple でも「今日の予定」は残る（毎日必ず見るため）", () => {
    const simple = presetToValues("simple");
    expect(simple.show_today_schedule).toBe(true);
    expect(simple.show_stat_today_sessions).toBe(true);
  });

  it("プリセットは隠せないタブ（ホーム・顧客・予約・設定）に触れない", () => {
    // これらはそもそもトグル対象外。プリセットが誤って含めていないことを確認する
    const columns = ALL_DISPLAY_TOGGLES.map((tg) => tg.column as string);
    for (const core of ["show_nav_dashboard", "show_nav_clients", "show_nav_schedule", "show_nav_gym_settings"]) {
      expect(columns).not.toContain(core);
    }
    for (const preset of GYM_DISPLAY_PRESETS) {
      for (const tab of ["dashboard", "clients", "schedule", "gym-settings"] as const) {
        expect(isNavTabVisible(tenantWith(presetToValues(preset)), tab), `${preset}/${tab}`).toBe(true);
      }
    }
  });

  it("detectPreset は今の設定に一致するプリセットを返す", () => {
    for (const preset of GYM_DISPLAY_PRESETS) {
      expect(detectPreset(tenantWith(presetToValues(preset)))).toBe(preset);
    }
  });

  it("どのプリセットとも違う設定は null（カスタム扱い）", () => {
    const custom = { ...presetToValues("full"), show_nav_messages: false };
    expect(detectPreset(tenantWith(custom))).toBeNull();
  });

  it("列が1つも無い（未適用）テナントは full 扱いになる", () => {
    // 既定は全て表示なので、未適用環境で「シンプル」と誤判定して驚かせない
    expect(detectPreset(tenantWith({}))).toBe("full");
  });
});
