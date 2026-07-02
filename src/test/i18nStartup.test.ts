import { describe, it, expect, vi } from "vitest";

// アプリ起動時のロケール復元の回帰テスト。
// ロケールは遅延読込（ja のみ同梱）のため、保存済みの非日本語ロケールを
// 起動時に読み込んで適用できるかを検証する。
// 注意: i18next はシングルトンのため、@/lib/i18n を静的 import している
// テストファイル内では起動処理を再現できない（isInitialized が true のまま）。
// このファイルは他を import せず、localStorage を用意してから動的 import する
// ＝ 実際のアプリ起動と同じ順序を再現する専用ファイル。
describe("i18n startup（ロケール遅延読込の起動時復元）", () => {
  it("保存済みの非日本語ロケール(en)を起動時に読み込んで適用する", async () => {
    // モジュール初期化「前」に保存言語を用意（実端末の2回目以降の起動を再現）。
    // resolvedLanguage は起動直後 ja に解決されるため、実装が i18n.language を
    // 見ないと en/ko/zh ユーザーが毎回日本語に戻る回帰が起きる。
    localStorage.setItem("i18nextLng", "en");
    const i18n = (await import("@/lib/i18n")).default;
    await vi.waitFor(() => {
      expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
      expect(i18n.resolvedLanguage).toBe("en");
      expect(i18n.t("settings.title")).toBe("Settings");
    });
  });
});
