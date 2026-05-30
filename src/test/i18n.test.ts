import { describe, it, expect, beforeEach } from "vitest";
import i18n, { SUPPORTED_LANGUAGES } from "@/lib/i18n";

describe("i18n configuration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("initializes with supported languages and ja fallback", () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.options.fallbackLng).toContain("ja");
    expect(SUPPORTED_LANGUAGES).toEqual(["ja", "en", "ko"]);
  });

  it("translates known keys in ja and en", async () => {
    await i18n.changeLanguage("ja");
    expect(i18n.t("settings.title")).toBe("設定");
    await i18n.changeLanguage("en");
    expect(i18n.t("settings.title")).toBe("Settings");
    expect(i18n.t("common.save")).toBe("Save");
  });

  it("changeLanguage persists selection to localStorage", async () => {
    await i18n.changeLanguage("en");
    expect(localStorage.getItem("i18nextLng")).toMatch(/^en/);
    await i18n.changeLanguage("ja");
    expect(localStorage.getItem("i18nextLng")).toMatch(/^ja/);
  });

  it("falls back to ja for unsupported languages", async () => {
    await i18n.changeLanguage("fr");
    expect(i18n.t("settings.title")).toBe("設定");
  });
});
