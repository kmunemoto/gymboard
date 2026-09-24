/**
 * テーマカラーの選び方（2026-09-24）: 色（4×4）→ トーン（4つ）の2段。
 * 色を替えてもトーンはそのまま、トーンを替えても色はそのまま。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@/lib/i18n";
import ThemeColorSwitcher from "@/components/ThemeColorSwitcher";
import { THEME_COLORS, LEGACY_THEME_IDS } from "@/lib/themeColor";

const stored = () => localStorage.getItem("gymboard.themeColor");
const accentNow = () => document.documentElement.style.getPropertyValue("--accent");
const pressed = (testId: string) => screen.getByTestId(testId).getAttribute("aria-pressed");

beforeEach(() => {
  localStorage.removeItem("gymboard.themeColor");
  document.documentElement.removeAttribute("style");
});

describe("ThemeColorSwitcher", () => {
  it("色16・トーン4を出し、最初は以前からのティール（ティール・ソフト）", () => {
    render(<ThemeColorSwitcher />);
    expect(screen.getAllByTestId(/^theme-family-/)).toHaveLength(16);
    expect(screen.getAllByTestId(/^theme-tone-/)).toHaveLength(4);
    expect(pressed("theme-family-teal")).toBe("true");
    expect(pressed("theme-tone-soft")).toBe("true");
    expect(screen.getByTestId("theme-current")).toHaveTextContent("ティール・ソフト");
  });

  it("色を替えてもトーンはそのまま。押した瞬間にアプリの色が変わる", () => {
    render(<ThemeColorSwitcher />);
    fireEvent.click(screen.getByTestId("theme-tone-dusty"));
    expect(stored()).toBe("teal-dusty");

    fireEvent.click(screen.getByTestId("theme-family-pink"));
    expect(stored()).toBe("pink-dusty");
    expect(accentNow()).toBe(THEME_COLORS.find((p) => p.id === "pink-dusty")!.vars["--accent"]);
    expect(pressed("theme-family-pink")).toBe("true");
    expect(pressed("theme-family-teal")).toBe("false");
    expect(pressed("theme-tone-dusty")).toBe("true");
    expect(screen.getByTestId("theme-current")).toHaveTextContent("ピンク・くすみ");
  });

  it("トーンを替えても色はそのまま", () => {
    render(<ThemeColorSwitcher />);
    fireEvent.click(screen.getByTestId("theme-family-indigo"));
    fireEvent.click(screen.getByTestId("theme-tone-deep"));
    expect(stored()).toBe("indigo-deep");
    expect(pressed("theme-family-indigo")).toBe("true");
    expect(pressed("theme-tone-deep")).toBe("true");
    expect(pressed("theme-tone-soft")).toBe("false");
  });

  it("6色だったころの id で保存されている人は、その色が選ばれた状態で開く", () => {
    localStorage.setItem("gymboard.themeColor", "blue");
    render(<ThemeColorSwitcher />);
    const [family, tone] = LEGACY_THEME_IDS.blue.split("-");
    expect(pressed(`theme-family-${family}`)).toBe("true");
    expect(pressed(`theme-tone-${tone}`)).toBe("true");
  });
});
