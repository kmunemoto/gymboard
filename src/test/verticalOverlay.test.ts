import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createInstance } from "i18next";
import { upstreamOnly } from "./helpers/upstream";

// 業種語彙のオーバーレイ（src/locales/vertical.ts）の回帰テスト。
//
// 兄弟アプリ（ストレッチボード・セッコツボード・ピラボード）は GymBoard のフォークで、
// `git merge upstream/main` で上流に追従し続ける。約1,900キーある ja.json を
// フォークが書き換えると、上流が文言を足すたびに衝突し、解決のたびに新しい文言を
// 取りこぼす危険がある（mem/ops/vertical-fork.md）。
//
// そのため base の ja.json は上流とバイト一致のまま保ち、変えたいキーだけを
// vertical.ja.json に書いて深いマージで重ねる。ここはその仕組みの番人。
//
// ## テストの組み立て方（2026-08-01 に作り直した）
//
// 以前は「アプリの i18n シングルトンに vi.doMock でオーバーレイを差し込み、
// base の文言をリテラルで断言する」形だった。これは**上流でしか通らない**:
//   - base のリテラル（"食事" 等）はフォークがオーバーレイで変える
//   - i18next の addResourceBundle は共有インスタンスを破壊的に更新するため、
//     実物のオーバーレイが載った状態が後続テストに漏れる
//     （実際にフォーク構成で再現した。vi.resetModules では戻らない）
// そこで、
//   - **仕組みの検証**は独立した i18next インスタンス＋合成データで行う（どの構成でも同じ）
//   - **実配線の検証**は「実物のオーバーレイに書いたキーが実際にその値になるか」で行う
//     （上流では空なので空回り、フォークでは意味を持つ）
// に分けた。

const BASE_JA = JSON.parse(readFileSync("src/locales/ja.json", "utf8")) as Record<string, any>;
const REAL_OVERLAY = JSON.parse(
  readFileSync("src/locales/vertical.ja.json", "utf8"),
) as Record<string, any>;

/** dotted path で入れ子から値を取る */
const at = (obj: Record<string, any>, path: string) =>
  path.split(".").reduce<any>((o, k) => o?.[k], obj);

/** 葉の dotted path を列挙する（配列は葉として扱う。returnObjects で丸ごと引かれるため） */
function leaves(obj: Record<string, any>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && !Array.isArray(v) ? leaves(v, p) : [p];
  });
}

/** src/lib/i18n.ts と同じ作法（deep=true / overwrite=true）で重ねた独立インスタンス */
async function withOverlay(base: Record<string, unknown>, overlay: Record<string, unknown>) {
  const inst = createInstance();
  await inst.init({ lng: "ja", resources: { ja: { translation: base } }, interpolation: { escapeValue: false } });
  inst.addResourceBundle("ja", "translation", overlay, true, true);
  return inst;
}

describe("オーバーレイの仕組み（合成データ・どの構成でも同じ結果）", () => {
  it("書いたキーだけが差し替わる", async () => {
    const i = await withOverlay(
      { nav: { home: "ホーム", training: "記録" }, booking: { title: "ご予約" } },
      { nav: { training: "施術記録" }, booking: { title: "施術のご予約" } },
    );
    expect(i.t("nav.training")).toBe("施術記録");
    expect(i.t("booking.title")).toBe("施術のご予約");
  });

  it("同じ入れ子の中で、書かなかったキーは base のまま残る（深いマージ）", async () => {
    const i = await withOverlay(
      { nav: { home: "ホーム", training: "記録", meals: "食事", booking: "予約" } },
      { nav: { training: "施術記録" } },
    );
    expect(i.t("nav.training")).toBe("施術記録");
    // 浅いマージだと nav ごと置き換わってここが消える
    expect(i.t("nav.home")).toBe("ホーム");
    expect(i.t("nav.meals")).toBe("食事");
    expect(i.t("nav.booking")).toBe("予約");
  });

  it("オーバーレイに無い名前空間はまるごと base のまま", async () => {
    const i = await withOverlay(
      { nav: { training: "記録" }, settings: { plans: { slotDuration: "予約枠の間隔" } } },
      { nav: { training: "施術記録" } },
    );
    expect(i.t("settings.plans.slotDuration")).toBe("予約枠の間隔");
  });

  it("空のオーバーレイは何も変えない", async () => {
    const base = { nav: { home: "ホーム", training: "記録" } };
    const i = await withOverlay(base, {});
    expect(i.t("nav.home")).toBe("ホーム");
    expect(i.t("nav.training")).toBe("記録");
  });
});

describe("実際の配線（このリポジトリの vertical.ja.json）", () => {
  it("オーバーレイに書いたキーは、実際に t() でその値になる", async () => {
    // 上流はオーバーレイが空なので空回りする。フォークでは全キーが検証対象になる。
    const i18n = (await import("@/lib/i18n")).default;
    const { BRAND } = await import("@/lib/brand");
    await i18n.changeLanguage("ja");

    // t() は補間を展開して返すので、生のJSON文字列とそのまま比べると
    // 補間を含む値で必ず落ちる。ブランド3種は値が確定しているので展開してから比べ、
    // それ以外の変数（{{count}} / {{gym}} 等）は呼び出し時の引数が無いと決まらないので対象外にする。
    // （2026-08-02: この罠は下の「base の値がそのまま出る」テストでは回避していたのに、
    //   こちらで踏んだまま残っていた。セッコツボードの help.subtitle で初めて表面化した）
    const expand = (s: string) =>
      s
        .replace(/\{\{brandJa\}\}/g, BRAND.ja)
        .replace(/\{\{brandEn\}\}/g, BRAND.en)
        .replace(/\{\{brandApp\}\}/g, BRAND.app);

    let checked = 0;
    for (const key of leaves(REAL_OVERLAY)) {
      const want = at(REAL_OVERLAY, key);
      if (typeof want !== "string") continue; // 配列は returnObjects 経由なので対象外
      const expected = expand(want);
      if (expected.includes("{{")) continue; // ブランド以外の変数が残る値は評価できない
      expect(i18n.t(key), `${key} がオーバーレイの値になっていない`).toBe(expected);
      checked++;
    }

    // オーバーレイが空でない（＝フォーク）のに1件も検証できていないなら、
    // 上の continue が効きすぎている。黙って素通りさせない。
    if (leaves(REAL_OVERLAY).length > 0) {
      expect(checked, "オーバーレイに値があるのに1件も検証できていない").toBeGreaterThan(0);
    }
  });

  it("オーバーレイに無いキーは base ja.json の値がそのまま出る", async () => {
    const i18n = (await import("@/lib/i18n")).default;
    await i18n.changeLanguage("ja");
    const overlaid = new Set(leaves(REAL_OVERLAY));
    // 代表的なキーだけ見る（全1,900キーを回すと補間ありの値で誤検知するため）
    for (const key of ["nav.home", "nav.booking", "nav.settings", "common.save"]) {
      if (overlaid.has(key)) continue;
      expect(i18n.t(key), `${key} が base と違う`).toBe(at(BASE_JA, key));
    }
  });

  it("ブランド補間はオーバーレイ後も生きている", async () => {
    const i18n = (await import("@/lib/i18n")).default;
    const { BRAND } = await import("@/lib/brand");
    await i18n.changeLanguage("ja");
    expect(i18n.t("common.brand")).toBe(BRAND.ja);
    expect(i18n.t("common.brand")).not.toContain("{{");
  });

  it("hasVerticalOverlay は未登録の言語を「無し」と判定する", async () => {
    const { hasVerticalOverlay } = await import("@/locales/vertical");
    expect(hasVerticalOverlay("en")).toBe(false); // 未登録（どの構成でも false）
  });
});

// 「本体のオーバーレイは空」は上流だけの前提。フォークはここに業種語彙を入れる。
upstreamOnly("GymBoard 本体のオーバーレイ", () => {
  it("vertical.ja.json は空で、ジム向けの語彙がそのまま出る", async () => {
    expect(REAL_OVERLAY).toEqual({});

    const { hasVerticalOverlay } = await import("@/locales/vertical");
    expect(hasVerticalOverlay("ja")).toBe(false);

    const i18n = (await import("@/lib/i18n")).default;
    await i18n.changeLanguage("ja");
    expect(i18n.t("nav.training")).toBe("記録");
    expect(i18n.t("nav.meals")).toBe("食事");
  });
});
