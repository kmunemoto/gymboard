import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { OPTION_DESCRIPTION_MAX, validateBookingOption } from "@/lib/bookingOptions";

// ────────────────────────────────────────────────────────────────
// オプションの説明文（2026-09-20 宗本さんの要望）
//
// > こんな感じでオプションに、僕のジムの場合ならストレッチの説明やメリットも
// > 説明書きしたい。
//
// 🔴 調べたら `booking_options.description` は **2026-09-02 から既にあった**。
//    列も、公開RPC `get_tenant_booking_options` の戻りも、`BookingOptionPicker`
//    （店の代理予約で使う）の表示も揃っていた。足りなかったのは画面2つ:
//
//      1. 店の設定画面に入力欄が無く、**設定できなかった**（select にも無かった）
//      2. お客様が読む確認カードに**出していなかった**
//
//    どちらか片方だけ直すと「書けるのに誰にも見えない」「出す場所はあるのに
//    書けない」のまま。両方そろって初めて機能になる。
// ────────────────────────────────────────────────────────────────

const stripJs = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const read = (p: string) => stripJs(readFileSync(p, "utf8"));
const readSql = (p: string) =>
  readFileSync(p, "utf8").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

const SETTINGS = "src/components/trainer/TrainerBookingOptions.tsx";
const CONFIRM = "src/components/booking/BookingOptionConfirm.tsx";
const MIGRATION = "supabase/migrations/20260920020000_booking_option_description.sql";

describe("説明文の検証", () => {
  // 🔴 画面の文言をそのまま使わない（フォークが語を差し替えると落ちる。forkHostileTests）
  const base = { name: "opt", duration_minutes: 30, price_yen: 3000 };

  it("空・未設定はそのまま通る（説明は任意）", () => {
    expect(validateBookingOption(base)).toBeNull();
    expect(validateBookingOption({ ...base, description: "" })).toBeNull();
    expect(validateBookingOption({ ...base, description: null })).toBeNull();
  });

  it("上限ちょうどは通る", () => {
    expect(validateBookingOption({ ...base, description: "あ".repeat(OPTION_DESCRIPTION_MAX) })).toBeNull();
  });

  it("🔴 上限を超えたら断る", () => {
    expect(validateBookingOption({ ...base, description: "あ".repeat(OPTION_DESCRIPTION_MAX + 1) }))
      .toBe("description");
  });

  it("名前・時間・料金の検証は今までどおり", () => {
    expect(validateBookingOption({ ...base, name: "" })).toBe("name");
    expect(validateBookingOption({ ...base, duration_minutes: 999 })).toBe("duration");
    expect(validateBookingOption({ ...base, price_yen: -1 })).toBe("price");
  });
});

describe("🔴 DB と画面で同じ上限にする", () => {
  it("CHECK の値が OPTION_DESCRIPTION_MAX と一致している", () => {
    const sql = readSql(MIGRATION);
    const m = /char_length\(description\) <= (\d+)/.exec(sql);
    expect(m, "CHECK が読めない").not.toBeNull();
    expect(Number(m![1])).toBe(OPTION_DESCRIPTION_MAX);
  });

  it("NULL は許す（説明を書かない店が大多数）", () => {
    expect(readSql(MIGRATION)).toMatch(/description IS NULL OR char_length\(description\)/);
  });
});

describe("🔴 店が設定できること", () => {
  const code = read(SETTINGS);

  it("読み込みの select に description が入っている", () => {
    // ここに無いと、保存しても次に開いたとき空に戻る
    expect(code).toMatch(/\.select\("id, name, duration_minutes, price_yen, description, enabled, sort_order"\)/);
  });

  it("入力欄がある（1行の Input ではなく複数行）", () => {
    expect(code).toContain("<Textarea");
    expect(code).toContain("bookingOptions.descriptionLabel");
  });

  it("保存している", () => {
    expect(code).toMatch(/description: o\.description\.trim\(\) \|\| null/);
  });

  it("空欄を NULL にしている（空文字のまま入れない）", () => {
    // "" のまま入れると「説明がある」扱いになり、お客様の画面に空行が出る
    expect(code).toMatch(/o\.description\.trim\(\) \|\| null/);
  });

  it("画面側でも文字数を止めている", () => {
    expect(code).toMatch(/maxLength=\{OPTION_DESCRIPTION_MAX\}/);
  });

  it("保存前に検証へ渡している", () => {
    expect(code).toMatch(/validateBookingOption\(\{[\s\S]{0,200}description: o\.description/);
  });
});

describe("🔴 お客様に見えること", () => {
  const code = read(CONFIRM);

  it("確認カードに説明を出している", () => {
    expect(code).toContain('data-testid="booking-option-description"');
  });

  it("オプションが1つの店でも複数の店でも出る", () => {
    // 1つだけのときは2択タイル、複数のときは一覧。**両方**に要る
    const hits = code.match(/data-testid="booking-option-description"/g) ?? [];
    expect(hits.length, "片方の並びにしか出していません").toBe(2);
  });

  it("改行を残す（店が書いた段落を潰さない）", () => {
    expect(code).toMatch(/whitespace-pre-wrap/);
  });

  it("説明が無い店では何も出さない", () => {
    expect(code).toMatch(/\{only\.description && \(/);
    expect(code).toMatch(/\{o\.description && \(/);
  });

  for (const lng of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
    it(`${lng}: 文言がそろっている`, () => {
      const bo = JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8")).bookingOptions;
      for (const k of ["descriptionLabel", "descriptionPlaceholder", "descriptionHelp"]) {
        expect(typeof bo[k], `${lng}.${k}`).toBe("string");
        expect(bo[k].length, `${lng}.${k}`).toBeGreaterThan(0);
      }
      expect(typeof bo.invalid.description, `${lng}.invalid.description`).toBe("string");
    });
  }
});
