import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";

// 下部ナビの丸ボタン（予約）が、フラグの組み合わせによらず中央に来ることの検査。
//
// ── なぜ要るか ──────────────────────────────────────────────────
// 全タブを `flex-1` で並べるだけだと、**タブが偶数個になると中央に来ない。**
// N個・i番目（1始まり）の中心は `((i - 1) + 0.5) / N`。
//
//   記録ON・食事OFF → ホーム 記録 [予約] 設定 → 3/4 → 62.5%（右に12.5%ズレる）
//   記録OFF・食事ON → ホーム [予約] 食事 設定 → 2/4 → 37.5%
//
// **ジムボードは5タブ全ONなので表に出ない。** ピラボードが実機で発見した
// （画面幅の12.5%＝100px以上ズレていた）。**上流のバグ。**
//
// ── jsdom は幅を計算しない ──────────────────────────────────────
// レイアウトが無いので「中央に来ているか」をピクセルでは測れない。
// **構造で判定する。** 次の2つが成り立てば、CSS 上は必ず等幅になる:
//
//   1. 左右のグループの flex 係数が等しい      → 中央グループが真ん中に来る
//   2. 各グループで「flex 係数 == 子要素数」    → 全スロットが等幅になる
//
// ── ⚠️ 2 を省くと検査が素通りする ──────────────────────────────
// ピラボードの敵対的レビューで見つかった穴。1 だけを見ると、
// **両側を同時に `flex-1` に変える**改変を通してしまう
// （予約は中央のままなので目的は満たされて見えるが、中央スロットだけ幅が変わる）。
// 最初の変異テストが**片側しかずらしていなかった**のが見落としの原因。
//
// ── 変異テスト（2026-08-06 実施・5件とも赤を確認）────────────────
//   1. 右グループの flex だけ変える                 → 赤
//   2. **左右を同時に flex:1 にする**（例の穴）      → 赤（2 の検査が捕まえる）
//   3. スペーサーを消す                              → 赤
//   4. 中央を固定幅（flex 無し）にする                → 赤
//   5. スペーサーを button にする                     → 赤（ラベル一覧に混ざる）

const groups = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-nav-group]")).map((el) => ({
    name: el.dataset.navGroup!,
    slots: Number(el.dataset.slots),
    flex: el.style.flex,
    children: el.children.length,
  }));

const navLabels = () =>
  Array.from(document.querySelectorAll("nav button")).map((b) => b.textContent?.trim() ?? "");

async function renderNav(flags: { workoutLog: boolean; meals: boolean }) {
  vi.resetModules();
  vi.doMock("@/lib/featureFlags", async () => {
    const actual = await vi.importActual<typeof import("@/lib/featureFlags")>("@/lib/featureFlags");
    return { ...actual, WORKOUT_LOG_ENABLED: flags.workoutLog, MEALS_ENABLED: flags.meals };
  });
  const { default: BottomNav } = await import("@/components/customer/BottomNav");
  render(<BottomNav activeTab="home" onTabChange={() => {}} />);
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("@/lib/featureFlags");
});

/** フラグの4通りすべて。**偶数タブになる2通りが本命** */
const CASES = [
  { name: "記録ON・食事ON（5タブ・従来から変わらない）", workoutLog: true, meals: true, tabs: 5 },
  { name: "記録OFF・食事OFF（3タブ）", workoutLog: false, meals: false, tabs: 3 },
  { name: "★記録ON・食事OFF（4タブ・ピラボードの構成）", workoutLog: true, meals: false, tabs: 4 },
  { name: "★記録OFF・食事ON（4タブ）", workoutLog: false, meals: true, tabs: 4 },
];

describe("下部ナビ: 予約ボタンが常に中央に来る", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it("左右のグループの flex 係数が等しい", async () => {
        await renderNav(c);
        const g = groups();
        const left = g.find((x) => x.name === "left")!;
        const right = g.find((x) => x.name === "right")!;
        expect(left, "left グループがありません").toBeTruthy();
        expect(right, "right グループがありません").toBeTruthy();
        expect(
          left.flex,
          `左右の flex が違うので予約ボタンが中央に来ません（左 ${left.flex} / 右 ${right.flex}）`,
        ).toBe(right.flex);
      });

      it("各グループで「flex 係数 == 子要素数」が成り立つ（全スロット等幅）", async () => {
        await renderNav(c);
        for (const g of groups()) {
          // ⚠️ この検査を省くと、両側を同時に flex:1 に変える改変を素通りさせる
          expect(
            g.children,
            `${g.name} グループの子要素数(${g.children})が flex 係数(${g.slots})と違います。` +
              `中央スロットだけ幅が変わります`,
          ).toBe(g.slots);
          expect(String(g.flex), `${g.name} グループに flex 係数が設定されていません`).toContain(
            String(g.slots),
          );
        }
      });

      it("中央グループは予約ボタン1つだけ", async () => {
        await renderNav(c);
        const center = groups().find((x) => x.name === "center")!;
        expect(center.children).toBe(1);
        expect(center.slots).toBe(1);
        expect(screen.getByText(i18n.t("nav.booking"))).toBeTruthy();
      });

      it(`タブが ${c.tabs} 個で、スペーサーがラベルに混ざらない`, async () => {
        await renderNav(c);
        // spacer を button にすると、ここに空文字が混ざって既存の検査が壊れる
        const labels = navLabels();
        expect(labels).toHaveLength(c.tabs);
        expect(labels).not.toContain("");
      });
    });
  }

  it("5タブのときスペーサーは0個（従来と同じ等幅5分割）", async () => {
    await renderNav({ workoutLog: true, meals: true });
    const spacers = document.querySelectorAll('nav [aria-hidden="true"].flex-1');
    expect(spacers.length, "5タブではスペーサーは要りません").toBe(0);
  });

  it("4タブのときスペーサーが1個入り、中央側に置かれる", async () => {
    // ⚠️ 端に置くと隣のタブが中央寄りになり、端が空いて不自然になる
    await renderNav({ workoutLog: true, meals: false });
    const right = document.querySelector<HTMLElement>('[data-nav-group="right"]')!;
    expect(right.children.length).toBe(2);
    expect(
      right.children[0].getAttribute("aria-hidden"),
      "スペーサーは中央側（グループの先頭）に置いてください",
    ).toBe("true");
    expect(right.children[1].tagName).toBe("BUTTON");
  });
});
