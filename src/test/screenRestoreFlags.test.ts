import { describe, it, expect, vi } from "vitest";

// 🔴 機能フラグで塞いだタブは戻さない（戻すと CustomerView が中身を描かず、真っ白な画面になる）。
// このリポジトリでは4つとも ON なので、OFF の状態はフォーク（業種別の兄弟アプリ）でしか起きない。
// ここでだけフラグを OFF にして確かめる（src/test/screenRestore.test.tsx の補い）。
vi.mock("@/lib/featureFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/featureFlags")>()),
  WORKOUT_LOG_ENABLED: false,
  MEALS_ENABLED: false,
  POSTURE_ENABLED: false,
  MONTHLY_REPORT_ENABLED: false,
}));

describe("🔴 フラグで塞いだタブは戻さない", () => {
  it("塞いだタブは戻さず、塞いでいないタブは戻す", async () => {
    const { isRestorableCustomerTab, isCustomerScreen } = await import("@/lib/screenRestore");
    for (const tab of ["training", "photos", "meals", "posture", "report"]) {
      expect(isRestorableCustomerTab(tab), tab).toBe(false);
      expect(isCustomerScreen({ tab }), tab).toBe(false);
    }
    for (const tab of ["home", "booking", "chat", "settings", "videos"]) {
      expect(isRestorableCustomerTab(tab), tab).toBe(true);
    }
  });
});
