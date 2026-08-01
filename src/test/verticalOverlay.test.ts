import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// 業種語彙のオーバーレイ（src/locales/vertical.ts）の回帰テスト。
//
// 兄弟アプリ（ストレッチボード・セッコツボード・ピラボード）は GymBoard のフォークで、
// `git merge upstream/main` で上流に追従し続ける。約1,900キーある ja.json を
// フォークが書き換えると、上流が文言を足すたびに衝突し、解決のたびに新しい文言を
// 取りこぼす危険がある（mem/ops/vertical-fork.md）。
//
// そのため base の ja.json は上流とバイト一致のまま保ち、変えたいキーだけを
// vertical.ja.json に書いて深いマージで重ねる。ここはその仕組みの番人。

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/locales/vertical.ja.json");
});

describe("業種語彙オーバーレイ", () => {
  it("GymBoard 本体では空なので、文言は base のまま（挙動が変わらない）", async () => {
    const overlay = JSON.parse(readFileSync("src/locales/vertical.ja.json", "utf8"));
    expect(overlay, "GymBoard 本体の vertical.ja.json は空であること").toEqual({});

    const i18n = (await import("@/lib/i18n")).default;
    await i18n.changeLanguage("ja");
    // ジム向けの語彙がそのまま出る
    expect(i18n.t("nav.training")).toBe("記録");
    expect(i18n.t("nav.meals")).toBe("食事");
  });

  it("オーバーレイに書いたキーだけが差し替わる（施術系の業種を想定）", async () => {
    vi.doMock("@/locales/vertical.ja.json", () => ({
      default: {
        nav: { training: "施術記録" },
        booking: { title: "施術のご予約" },
      },
    }));
    const i18n = (await import("@/lib/i18n")).default;
    await i18n.changeLanguage("ja");

    // 上書きしたキー
    expect(i18n.t("nav.training")).toBe("施術記録");
    expect(i18n.t("booking.title")).toBe("施術のご予約");
  });

  it("同じ入れ子の中で、書かなかったキーは base のまま残る（深いマージ）", async () => {
    vi.doMock("@/locales/vertical.ja.json", () => ({
      // nav の training だけを差し替える。nav.home / nav.meals は触らない
      default: { nav: { training: "施術記録" } },
    }));
    const i18n = (await import("@/lib/i18n")).default;
    await i18n.changeLanguage("ja");

    expect(i18n.t("nav.training")).toBe("施術記録");
    // 浅いマージだと nav ごと置き換わってここが消える
    expect(i18n.t("nav.home")).toBe("ホーム");
    expect(i18n.t("nav.meals")).toBe("食事");
    expect(i18n.t("nav.booking")).toBe("予約");
  });

  it("オーバーレイに無い名前空間はまるごと base のまま", async () => {
    vi.doMock("@/locales/vertical.ja.json", () => ({
      default: { nav: { training: "施術記録" } },
    }));
    const i18n = (await import("@/lib/i18n")).default;
    await i18n.changeLanguage("ja");
    // settings 名前空間には一切触れていない
    expect(i18n.t("settings.plans.slotDuration")).toBe("予約枠の間隔");
  });

  it("ブランド補間はオーバーレイ後も生きている", async () => {
    vi.doMock("@/locales/vertical.ja.json", () => ({
      default: { nav: { training: "施術記録" } },
    }));
    const i18n = (await import("@/lib/i18n")).default;
    const { BRAND } = await import("@/lib/brand");
    await i18n.changeLanguage("ja");
    expect(i18n.t("common.brand")).toBe(BRAND.ja);
    expect(i18n.t("common.brand")).not.toContain("{{");
  });

  it("hasVerticalOverlay は空を「無し」と判定する", async () => {
    const { hasVerticalOverlay } = await import("@/locales/vertical");
    expect(hasVerticalOverlay("ja")).toBe(false); // GymBoard 本体は空
    expect(hasVerticalOverlay("en")).toBe(false); // 未登録
  });
});
