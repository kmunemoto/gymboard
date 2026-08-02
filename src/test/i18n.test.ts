import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import i18n, { SUPPORTED_LANGUAGES, changeLanguage, loadLocale } from "@/lib/i18n";

/**
 * ja 側の期待値は「base + 業種オーバーレイ」から引く。
 * リテラル（"設定"）で断言すると、その語をオーバーレイしたフォークで必ず落ちる
 * （mem/ops/vertical-fork.md「上流のテストがフォークで落ちないようにする」）。
 * en 側はロケールを上流とバイト一致のまま保つ方針なのでリテラルでよい。
 */
const effectiveJa = (key: string): string => {
  const base = JSON.parse(readFileSync("src/locales/ja.json", "utf8"));
  const overlay = JSON.parse(readFileSync("src/locales/vertical.ja.json", "utf8"));
  const at = (o: unknown, k: string) =>
    k.split(".").reduce<unknown>((v, part) => (v as Record<string, unknown>)?.[part], o);
  return (at(overlay, key) ?? at(base, key)) as string;
};

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
    // 生のキーがそのまま返る＝リソース未ロード、を確実に弾く
    expect(i18n.t("settings.title")).not.toBe("settings.title");
    expect(i18n.t("settings.title")).toBe(effectiveJa("settings.title"));
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
    expect(i18n.t("settings.title")).toBe(effectiveJa("settings.title"));
  });
});
