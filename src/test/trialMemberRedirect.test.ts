import { describe, expect, it } from "vitest";
import { normalizeTrialGuestName, requiresMemberBooking } from "../../supabase/functions/_shared/trial-member-redirect";

// Synthetic names only: real member names belong in private tenant configuration.
describe("trial member routing", () => {
  it.each(["山田太郎", "山田 太郎", "山田　太郎", "山\u200b田・太郎"])("matches names with formatting differences: %s", (name) => {
    expect(requiresMemberBooking(name, ["山田太郎"])).toBe(true);
  });

  it.each(["やまだたろう", "ヤマダタロウ", "ﾔﾏﾀﾞ ﾀﾛｳ"])("normalizes hiragana, katakana and half-width kana: %s", (name) => {
    expect(requiresMemberBooking(name, ["やまだ"])).toBe(true);
  });

  it("matches a configured name fragment, including names entered in reverse order", () => {
    expect(requiresMemberBooking("太郎 山田", ["山田"])).toBe(true);
    expect(requiresMemberBooking("テスト 太郎", ["太郎"])).toBe(true);
  });

  it("leaves other guests and tenants without configured rules eligible", () => {
    expect(requiresMemberBooking("鈴木花子", ["山田"])).toBe(false);
    expect(requiresMemberBooking("山田太郎", [])).toBe(false);
    expect(requiresMemberBooking("山田太郎", ["", "　", "・"])).toBe(false);
    expect(requiresMemberBooking("", ["山田"])).toBe(false);
  });

  it("normalizes compatibility characters without adding unconfigured aliases", () => {
    expect(normalizeTrialGuestName("ＴＥＳＴ　やまだ")).toBe("testヤマダ");
    expect(requiresMemberBooking("Yamada", ["山田"])).toBe(false);
  });
});
