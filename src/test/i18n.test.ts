import { describe, it, expect, beforeEach, vi } from "vitest";
import i18n, { SUPPORTED_LANGUAGES, changeLanguage, loadLocale } from "@/lib/i18n";

describe("i18n configuration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("initializes with supported languages and ja fallback", () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.options.fallbackLng).toContain("ja");
    expect(SUPPORTED_LANGUAGES).toEqual(["ja", "en", "ko", "zh-CN", "zh-TW"]);
  });

  it("translates known keys in ja and en (en は遅延読込)", async () => {
    await changeLanguage("ja");
    expect(i18n.t("settings.title")).toBe("設定");
    await changeLanguage("en");
    expect(i18n.t("settings.title")).toBe("Settings");
    expect(i18n.t("common.save")).toBe("Save");
  });

  it("loadLocale registers a lazy locale bundle", async () => {
    await loadLocale("ko");
    expect(i18n.hasResourceBundle("ko", "translation")).toBe(true);
    // ja は同梱、未対応言語は no-op（例外を投げない）
    await loadLocale("ja");
    await loadLocale("fr");
    expect(i18n.hasResourceBundle("ja", "translation")).toBe(true);
  });

  it("changeLanguage persists selection to localStorage", async () => {
    await changeLanguage("en");
    expect(localStorage.getItem("i18nextLng")).toMatch(/^en/);
    await changeLanguage("ja");
    expect(localStorage.getItem("i18nextLng")).toMatch(/^ja/);
  });

  it("falls back to ja for unsupported languages", async () => {
    await changeLanguage("fr");
    expect(i18n.t("settings.title")).toBe("設定");
  });
});
