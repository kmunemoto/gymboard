import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { computeKeyboardInset, MIN_KEYBOARD_PX, KEYBOARD_INSET_VAR } from "@/lib/keyboardInset";

// チャットの入力欄がキーボードに隠れない、を見張る。
//
// ── なぜ要るか（2026-09-01）─────────────────────────────────────────
// 実際に起きた不具合: トレーナー側のチャットで文字を打つと、入力欄がキーボードの
// 裏に入り、**自分が今何を入力しているか見えない**。原因は `h-[calc(100vh-200px)]`。
// iOS の WKWebView では 100vh がキーボードで縮まないため、カードが元の高さのまま残り、
// その一番下にある入力欄が画面外へ押し出されていた。
//
// これは「壊れてもエラーが出ない」たぐいの不具合で、気づけるのは実機で打ったときだけ。
// しかもクラウドのセッションからはネイティブを動かせない。振る舞いをコードで固定する。

const stripJs = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const readCode = (path: string): string => stripJs(readFileSync(path, "utf8"));

const TRAINER = "src/components/trainer/TrainerMessages.tsx";
const CUSTOMER = "src/components/customer/CustomerChat.tsx";

describe("キーボードの高さの算出", () => {
  it("キーボードが出ていなければ 0", () => {
    expect(computeKeyboardInset({ innerHeight: 800, viewportHeight: 800, offsetTop: 0 })).toBe(0);
  });

  it("🔴 覆っている高さをそのまま返す", () => {
    expect(computeKeyboardInset({ innerHeight: 800, viewportHeight: 460, offsetTop: 0 })).toBe(340);
  });

  it("🔴 ページがスクロールしていても（offsetTop > 0）正しく出す", () => {
    // iOS はキーボードを出すとき、入力欄を見せるためにページ側をずらすことがある。
    // offsetTop を足し忘れると、その分だけキーボードを低く見積もる。
    expect(computeKeyboardInset({ innerHeight: 800, viewportHeight: 460, offsetTop: 120 })).toBe(220);
  });

  it("🔴 アドレスバーの伸縮くらいの差は 0 に丸める", () => {
    // これを 0 にしないと、スクロールするたびにチャットが数十px ぴょこぴょこ動く。
    expect(computeKeyboardInset({ innerHeight: 800, viewportHeight: 800 - (MIN_KEYBOARD_PX - 1), offsetTop: 0 })).toBe(0);
    expect(computeKeyboardInset({ innerHeight: 800, viewportHeight: 800 - MIN_KEYBOARD_PX, offsetTop: 0 })).toBe(MIN_KEYBOARD_PX);
  });

  it("負の値やNaNでも壊れない", () => {
    expect(computeKeyboardInset({ innerHeight: 800, viewportHeight: 900, offsetTop: 0 })).toBe(0);
    expect(computeKeyboardInset({ innerHeight: NaN, viewportHeight: 460, offsetTop: 0 })).toBe(0);
  });
});

describe("チャットの入力欄がキーボードに隠れない", () => {
  const trainer = readCode(TRAINER);
  const customer = readCode(CUSTOMER);

  it("🔴 スマホのチャットの高さに 100vh を使っていない", () => {
    // `md:h-[calc(100vh-…)]` は PC 用なので許す。頭に `md:` が付かないものだけを拾う。
    const mobileVh = (code: string) => code.match(/(?:^|[\s"'`])h-\[calc\(100vh[^\]]*\]/g) ?? [];
    expect(mobileVh(trainer)).toEqual([]);
    expect(mobileVh(customer)).toEqual([]);
  });

  it("🔴 下端をキーボードの高さに合わせている（両方の画面）", () => {
    for (const code of [trainer, customer]) {
      expect(code).toContain(`bottom-[max(var(${KEYBOARD_INSET_VAR},0px)`);
    }
  });

  it("🔴 --kb を実際に流し込んでいる（変数を書いただけで誰も更新しない、を防ぐ）", () => {
    for (const code of [trainer, customer]) {
      expect(code).toContain("useKeyboardInset");
    }
  });

  it("🔴 キーボードの開閉で一番下の発言へ戻す", () => {
    // 高さが変わったのに位置を直さないと、直前まで読んでいた発言が隠れる。
    for (const code of [trainer, customer]) {
      expect(code).toMatch(/\[keyboardInset, search\.active\]/);
    }
  });

  it("上端はアプリのヘッダーを避けている（実測値）", () => {
    for (const code of [trainer, customer]) {
      expect(code).toContain("top-[var(--app-header-h,");
    }
  });
});

describe("🔴 逃がし幅を数字で直書きしない（2026-09-01 に実機で踏んだ）", () => {
  const trainer = readCode(TRAINER);
  const customer = readCode(CUSTOMER);

  // 実際に起きたこと: 下端の逃がしを 4rem と直書きしていた。safe-area が 0 の
  // 手元のブラウザではナビが 58px で 6px 余り、通ってしまった。ところが
  // **Android の実機はシステムバーぶんナビが 106px になり、入力欄が 34px
  // ナビの裏に潜り込んで、押せない・打てない**状態で出荷された。
  //
  // ナビの高さは端末のシステムバー・文字サイズ・タブの本数（お客様側は中央の
  // 丸ボタンで更に高い）で変わる。決め打ちできる数字ではない。

  it("🔴 チャットの下端はナビの実測値を見ている", () => {
    for (const code of [trainer, customer]) {
      expect(code).toContain("var(--nav-h,");
    }
  });

  it("🔴 ナビとヘッダーが自分の高さを流している", () => {
    // 変数を読む側だけ直しても、誰も書かなければ既定値のままになる。
    for (const f of [
      "src/components/trainer/TrainerSidebar.tsx",
      "src/components/customer/BottomNav.tsx",
    ]) {
      expect(readCode(f), f).toContain("useMeasuredHeightVar");
      expect(readCode(f), f).toContain("NAV_HEIGHT_VAR");
    }
    for (const f of [
      "src/components/trainer/TrainerView.tsx",
      "src/components/customer/CustomerView.tsx",
    ]) {
      expect(readCode(f), f).toContain("useMeasuredHeightVar");
      expect(readCode(f), f).toContain("APP_HEADER_VAR");
    }
  });

  it("🔴 border-box で観測している（padding＝safe-area の変化を拾うため）", () => {
    // 既定の content-box だと、画面回転やジェスチャーナビ切替でインセットが
    // 変わっても変数が古いままになり、また入力欄がナビの裏へ入る。
    // これはブラウザでの再現中に実際に取りこぼした。
    const hook = readCode("src/hooks/useMeasuredHeightVar.ts");
    expect(hook).toMatch(/box:\s*"border-box"/);
  });

  it("既定値は大きめ（足りないと操作不能、余っても隙間が空くだけ）", () => {
    for (const code of [trainer, customer]) {
      const m = code.match(/var\(--nav-h,([\d.]+)rem\)/);
      expect(m, "--nav-h の既定値が読めません").not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(5);
    }
  });

  it("変数が無くても片付けが走る（購読しっぱなしにしない）", () => {
    const hook = readCode("src/hooks/useMeasuredHeightVar.ts");
    expect(hook).toContain("ro.disconnect()");
    expect(hook).toContain("removeProperty");
  });
});

describe("キーボードの高さの取り込み方", () => {
  const hook = readCode("src/hooks/useKeyboardInset.ts");

  it("🔴 visualViewport から取る（Capacitor の keyboardHeight を値として使わない）", () => {
    // WebView ごと縮む環境（Android の adjustResize 等）では二重に引いてしまう。
    // visualViewport は「実際に見えている領域」なので、その場合は自動的に 0 になる。
    expect(hook).toContain("visualViewport");
    expect(hook).not.toContain("keyboardHeight");
  });

  it("visualViewport が無い環境でも落ちない", () => {
    expect(hook).toMatch(/if \(!vv\)/);
  });

  it("🔴 後片付けをしている（購読しっぱなしにしない）", () => {
    expect(hook).toContain("removeEventListener");
    expect(hook).toContain("removeProperty");
  });
});
