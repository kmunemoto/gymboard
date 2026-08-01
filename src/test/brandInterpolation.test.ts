import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import i18n from "@/lib/i18n";
import { loadLocale } from "@/lib/i18n";
import { BRAND } from "@/lib/brand";

// 製品名（ジムボード / GymBoard / gymboard）はロケールJSONに直接書かず、
// src/lib/brand.ts から {{brandJa}} / {{brandEn}} / {{brandApp}} で注入する。
//
// 理由は業種特化の兄弟アプリ（ピラボード・セッコツボード・ストレッチ版…）。
// 兄弟は GymBoard のフォークとして作られ、`git merge upstream/main` で上流の修正を
// 取り込み続ける。ロケールJSONに製品名が入っていると、兄弟が名前を書き換えた瞬間に
// 5言語×全キーが恒久的なコンフリクト源になる（mem/ops/vertical-fork.md）。
// このテストは「ロケールJSONに製品名を書き戻してしまう」のを防ぐ番人。

const LANGS = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
const raw = (l: string) => readFileSync(`src/locales/${l}.json`, "utf8");

/** 製品名の直書きを探す正規表現（brand.ts から作る） */
function brandLiteralPattern(): RegExp {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = [BRAND.ja, BRAND.en, `${BRAND.app}アプリ`].map(escape);
  return new RegExp(names.join("|"), "g");
}

describe("ブランド名のロケール注入", () => {
  it("ロケールJSONに製品名の literal が残っていない", () => {
    for (const l of LANGS) {
      const src = raw(l);
      // {{brandJa}} などの変数名に含まれる "brand" は別物なので、製品名そのものだけを見る。
      // 製品名は brand.ts から引く。直書きすると、兄弟アプリ（業種特化フォーク）が
      // 自分のブランド名をロケールに書き戻しても、この番人が素通りしてしまう。
      const hits = src.match(brandLiteralPattern()) ?? [];
      expect(hits, `${l}.json に製品名の直書きが残っています: ${hits.join(", ")}`).toEqual([]);
    }
  });

  // 業種オーバーレイと業種プリセットも同じ規則で守る。
  //
  // ここを見ていないと、`scripts/extract-vertical-overlay.mjs` の出力を
  // そのまま採用したときに **Phase 0-A（brand.ts からの注入）が死ぬ**。
  // フォークの ja.json が Phase 0-A より前の世代だと製品名がリテラルで入っており、
  // 上流の `{{brandJa}}` と値が違うので「フォークが変えた葉」として抽出されてしまう。
  // セッコツボードでは実際に26葉が紛れ込んだ（2026-08-01）。
  // 抽出スクリプト側でも除外・警告するが、最後の砦としてここでも見る。
  it("業種オーバーレイ・プリセットに製品名の literal が残っていない", () => {
    const targets = [
      "src/locales/vertical.ja.json",
      ...readdirSync("mem/ops/vertical-presets")
        .filter((f) => f.endsWith(".vertical.ja.json"))
        .map((f) => `mem/ops/vertical-presets/${f}`),
    ];
    for (const path of targets) {
      const src = readFileSync(path, "utf8");
      const hits = src.match(brandLiteralPattern()) ?? [];
      expect(
        hits,
        `${path} に製品名の直書きが残っています: ${hits.join(", ")}\n` +
          `オーバーレイに製品名を書くと brand.ts を変えても文言が追従しません。` +
          `該当キーはオーバーレイから外し、base の {{brandJa}} 等の補間に任せてください。`,
      ).toEqual([]);
    }
  });

  it("製品名を出すキーは interpolation 変数を使っている", () => {
    const jaJson = JSON.parse(raw("ja")) as Record<string, unknown>;
    const get = (path: string) => path.split(".").reduce<any>((o, k) => o?.[k], jaJson);
    expect(get("common.brand")).toBe("{{brandJa}}");
    expect(get("auth.appTitle")).toBe("{{brandJa}}");
    // 法務ページは全言語で日本語表記のまま（英字表記と小文字識別子の両方を使う）
    expect(get("terms.appSubtitle")).toContain("{{brandJa}}");
    expect(get("terms.appSubtitle")).toContain("{{brandApp}}");
  });

  it("実際に t() を通すと brand.ts の値に解決される（ja）", async () => {
    await i18n.changeLanguage("ja");
    expect(i18n.t("common.brand")).toBe(BRAND.ja);
    expect(i18n.t("auth.appTitle")).toBe(BRAND.ja);
    // 変数が未解決のまま画面に出ていないこと
    expect(i18n.t("terms.appSubtitle")).not.toContain("{{");
    expect(i18n.t("terms.appSubtitle")).toContain(BRAND.ja);
    expect(i18n.t("terms.appSubtitle")).toContain(BRAND.app);
  });

  it("他言語でも解決される（en は英字表記を使う）", async () => {
    const ok = await loadLocale("en");
    expect(ok).toBe(true);
    await i18n.changeLanguage("en");
    expect(i18n.t("common.brand")).toBe(BRAND.en);
    expect(i18n.t("settings.notification.deniedIos")).toContain(BRAND.en);
    expect(i18n.t("settings.notification.deniedIos")).not.toContain("{{");
    await i18n.changeLanguage("ja");
  });

  it("5言語のキー集合が一致したままである", () => {
    const leaves = (o: any, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === "object" ? leaves(v, `${p}${k}.`) : [`${p}${k}`],
      );
    const base = leaves(JSON.parse(raw("ja"))).sort();
    for (const l of LANGS.filter((x) => x !== "ja")) {
      const keys = leaves(JSON.parse(raw(l))).sort();
      const missing = base.filter((k) => !keys.includes(k));
      expect(missing, `${l}.json に足りないキー: ${missing.slice(0, 10).join(", ")}`).toEqual([]);
    }
  });
});
