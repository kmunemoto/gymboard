import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@/lib/i18n";

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
  it("既定（全ON = ジムボード本体）では5タブすべて出る", async () => {
    await renderNav();
    const labels = navLabels();
    expect(labels).toHaveLength(5);
    expect(labels).toContain("ホーム");
    expect(labels).toContain("記録");
    expect(labels).toContain("予約");
    expect(labels).toContain("食事");
    expect(labels).toContain("設定");
  });

  it("WORKOUT_LOG_ENABLED=false でトレーニング記録タブが消える", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      WORKOUT_LOG_ENABLED: false,
    }));
    await renderNav();
    const labels = navLabels();
    expect(labels).not.toContain("記録");
    expect(labels).toHaveLength(4);
  });

  it("MEALS_ENABLED=false で食事タブが消える", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      MEALS_ENABLED: false,
    }));
    await renderNav();
    const labels = navLabels();
    expect(labels).not.toContain("食事");
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
    expect(labels).toEqual(["ホーム", "予約", "設定"]);
    // 中央の大きい予約ボタンも維持されている
    expect(screen.getByText("予約")).toBeTruthy();
  });
});

describe("お客様アプリの機能ゲート（フラグ定義）", () => {
  it("ジムボード本体では全フラグが既定ONで、従来の挙動と一致する", async () => {
    const flags = await import("@/lib/featureFlags");
    expect(flags.WORKOUT_LOG_ENABLED).toBe(true);
    expect(flags.MEALS_ENABLED).toBe(true);
    expect(flags.POSTURE_ENABLED).toBe(true);
    expect(flags.MUSCLE_RADAR_ENABLED).toBe(true);
    expect(flags.BODY_METRICS_ENABLED).toBe(true);
    expect(flags.WORKOUT_SHARE_ENABLED).toBe(true);
  });
});
