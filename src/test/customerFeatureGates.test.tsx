import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { upstreamOnly } from "./helpers/upstream";

// お客様アプリの機能ON/OFF（src/lib/featureFlags.ts）の回帰テスト。
//
// トレーナー側は tenants.show_nav_* で店ごとに出し分けられるのに、
// **お客様側には従来ON/OFFの仕組みが一切無かった**（show_* は全てトレーナー画面専用）。
// そのため業種特化の兄弟アプリ（ストレッチ・鍼灸・エステ…）に複製すると、
// 使わない「トレーニング記録」「食事」タブが出っぱなしになる。
//
// ここでは下部ナビを対象に、フラグを落とすとタブが消えること／
// 消してはいけないタブ（ホーム・予約・設定）は必ず残ることを見張る。
// フラグはビルド時定数なので、テストでは vi.mock でモジュールごと差し替える。

const renderNav = async () => {
  const { default: BottomNav } = await import("@/components/customer/BottomNav");
  render(<BottomNav activeTab="home" onTabChange={() => {}} />);
};

/** 下部ナビに出ているタブのラベル一覧 */
const navLabels = () =>
  Array.from(document.querySelectorAll("nav button")).map((b) => b.textContent?.trim() ?? "");

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("@/lib/featureFlags");
});

describe("お客様アプリの機能ゲート（下部ナビ）", () => {
  it("全ONなら5タブすべて出る", async () => {
    // 実フラグに依存させない（フォークは false にするので、依存すると必ず落ちる）。
    // 文言も翻訳キーから引く（フォークは vertical.ja.json で語彙を差し替えるため）。
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      WORKOUT_LOG_ENABLED: true,
      MEALS_ENABLED: true,
    }));
    await renderNav();
    expect(navLabels()).toEqual([
      i18n.t("nav.home"),
      i18n.t("nav.training"),
      i18n.t("nav.booking"),
      i18n.t("nav.meals"),
      i18n.t("nav.settings"),
    ]);
  });

  it("WORKOUT_LOG_ENABLED=false でトレーニング記録タブが消える", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      WORKOUT_LOG_ENABLED: false,
      MEALS_ENABLED: true,
    }));
    await renderNav();
    const labels = navLabels();
    expect(labels).not.toContain(i18n.t("nav.training"));
    expect(labels).toHaveLength(4);
  });

  it("MEALS_ENABLED=false で食事タブが消える", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      MEALS_ENABLED: false,
      WORKOUT_LOG_ENABLED: true,
    }));
    await renderNav();
    const labels = navLabels();
    expect(labels).not.toContain(i18n.t("nav.meals"));
    expect(labels).toHaveLength(4);
  });

  it("両方OFF（施術系の業種を想定）でも ホーム・予約・設定 は必ず残る", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      WORKOUT_LOG_ENABLED: false,
      MEALS_ENABLED: false,
    }));
    await renderNav();
    const labels = navLabels();
    // 消すとアプリが操作不能になるタブは落とせない
    expect(labels).toEqual([i18n.t("nav.home"), i18n.t("nav.booking"), i18n.t("nav.settings")]);
    // 中央の大きい予約ボタンも維持されている
    expect(screen.getByText(i18n.t("nav.booking"))).toBeTruthy();
  });
});

const CUSTOMER_FLAGS = [
  "WORKOUT_LOG_ENABLED",
  "MEALS_ENABLED",
  "POSTURE_ENABLED",
  "MUSCLE_RADAR_ENABLED",
  "BODY_METRICS_ENABLED",
  "WORKOUT_SHARE_ENABLED",
] as const;

describe("お客様アプリの機能ゲート（フラグ定義）", () => {
  it("お客様向けフラグが全て boolean として公開されている", async () => {
    const flags = (await import("@/lib/featureFlags")) as unknown as Record<string, unknown>;
    for (const k of CUSTOMER_FLAGS) {
      expect(typeof flags[k], `${k} が未定義、または boolean でない`).toBe("boolean");
    }
  });

  // 記録タブを切るとレーダーとシェアはデータ源を失う。どの業種でも守るべき関係。
  it("トレーニング記録がOFFなら、レーダーとシェアもOFF", async () => {
    const f = await import("@/lib/featureFlags");
    if (!f.WORKOUT_LOG_ENABLED) {
      expect(f.MUSCLE_RADAR_ENABLED).toBe(false);
      expect(f.WORKOUT_SHARE_ENABLED).toBe(false);
    }
  });
});

upstreamOnly("ジムボード本体の既定値", () => {
  it("お客様向けフラグは全て既定ON（従来の挙動と一致する）", async () => {
    const flags = (await import("@/lib/featureFlags")) as unknown as Record<string, unknown>;
    for (const k of CUSTOMER_FLAGS) {
      expect(flags[k], `${k}`).toBe(true);
    }
  });
});
