import { describe, it, expect, vi, afterEach } from "vitest";

// ビルド時フラグの「掛け忘れ」の番人。
//
// ## なぜ要るか
//
// featureFlags.ts は「業種特化の兄弟アプリで、使わない機能を消すための口」だが、
// **フラグを足しただけで、実際の描画箇所に掛け忘れている**ものが3つ見つかった
// （2026-08、ゴルフボードの棚卸しで発覚）。
//
// 掛け忘れは上流では顕在化しない。上流はそのフラグが ON なので、
// 「包んでいない」ことと「包んだうえで ON」の見た目が同じになるため。
// **フォークが OFF にして初めて、消えるはずのものが残る形で表に出る。**
//
// 発覚した3件:
//   (A) 設定画面の骨格診断履歴 … POSTURE_ENABLED で包まれておらず、
//       姿勢分析を切った業種でも**空のセクション**が出っぱなしになる
//       （DiagnosisHistorySection は0件でもヘッダとカードを描く）
//   (B) 店側ナビの「種目管理」 … WORKOUT_LOG_ENABLED と非連動。
//       種目マスタを読むのは記録タブ・部位バランス・アバターだけなので、
//       記録を切った業種では**編集しても誰も見ない設定**が残る
//   (C) 予約カレンダーのレイドボス … GAMIFICATION_ENABLED で包まれておらず、
//       **ゲーミフィケーションOFFでも予約画面を開くたびに raid_bosses を問い合わせる**。
//       画面には出ないので誰も気づけない（上流も既定OFFなので上流で現に起きている）
//
// フラグはビルド時定数なので、テストでは vi.doMock でモジュールごと差し替える。

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/featureFlags");
});

/** featureFlags を一部だけ差し替えて読み込み直す */
const withFlags = (flags: Record<string, unknown>) => {
  vi.doMock("@/lib/featureFlags", async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    ...flags,
  }));
};

describe("(A) 骨格診断履歴は POSTURE_ENABLED に連動する", () => {
  // 画面全体のレンダリングには認証・Supabase・遅延読込が絡むため、
  // ここでは「フラグで包まれていること」をソースで検査する。
  // 描画そのものの回帰は customerFeatureGates.test.tsx が担当する。
  it("CustomerSettings が DiagnosisHistorySection を POSTURE_ENABLED で包んでいる", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/customer/CustomerSettings.tsx", "utf8");

    expect(src, "POSTURE_ENABLED を import していない").toMatch(
      /import\s*\{[^}]*POSTURE_ENABLED[^}]*\}\s*from\s*"@\/lib\/featureFlags"/,
    );

    // DiagnosisHistorySection の描画箇所（import 行ではない方）が
    // POSTURE_ENABLED && の内側にあること
    const usageIdx = src.lastIndexOf("<DiagnosisHistorySection");
    expect(usageIdx, "DiagnosisHistorySection の描画箇所が見つからない").toBeGreaterThan(-1);
    const before = src.slice(0, usageIdx);
    const gateIdx = before.lastIndexOf("POSTURE_ENABLED &&");
    expect(
      gateIdx,
      "DiagnosisHistorySection が POSTURE_ENABLED で包まれていません。" +
        "0件でもヘッダとカードを描くため、姿勢分析を切った業種で空セクションが残ります。",
    ).toBeGreaterThan(-1);
    // ゲートと描画の間に閉じ括弧だけの短い距離しか無いこと（別のゲートを拾っていない保証）
    expect(usageIdx - gateIdx).toBeLessThan(200);
  });
});

describe("(B) 種目管理タブは WORKOUT_LOG_ENABLED に連動する", () => {
  it("WORKOUT_LOG_ENABLED=false でナビから消える", async () => {
    withFlags({ WORKOUT_LOG_ENABLED: false });
    const { isNavTabVisible } = await import("@/lib/gymDisplaySettings");
    // テナント側のトグルは ON（既定）でも、ビルド時フラグが OFF なら出さない
    expect(isNavTabVisible({ show_nav_exercises: true } as never, "exercises")).toBe(false);
    expect(isNavTabVisible(null, "exercises")).toBe(false);
  });

  it("WORKOUT_LOG_ENABLED=true ならテナント設定どおりに出る", async () => {
    withFlags({ WORKOUT_LOG_ENABLED: true });
    const { isNavTabVisible } = await import("@/lib/gymDisplaySettings");
    expect(isNavTabVisible(null, "exercises")).toBe(true);
    expect(isNavTabVisible({ show_nav_exercises: true } as never, "exercises")).toBe(true);
    // 店が個別に消せることは変わらない（下の層はOFFにできるだけ、という規則）
    expect(isNavTabVisible({ show_nav_exercises: false } as never, "exercises")).toBe(false);
  });

  it("フラグは他のタブを巻き込まない", async () => {
    withFlags({ WORKOUT_LOG_ENABLED: false });
    const { isNavTabVisible } = await import("@/lib/gymDisplaySettings");
    expect(isNavTabVisible(null, "clients")).toBe(true);
    expect(isNavTabVisible(null, "schedule")).toBe(true);
    expect(isNavTabVisible(null, "messages")).toBe(true);
  });
});

describe("(C) レイドボスの取得は GAMIFICATION_ENABLED に連動する", () => {
  it("CustomerBooking が raid_bosses の取得前にフラグを見ている", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");

    expect(src, "GAMIFICATION_ENABLED を import していない").toMatch(
      /import\s*\{[^}]*GAMIFICATION_ENABLED[^}]*\}\s*from\s*"@\/lib\/featureFlags"/,
    );

    const fetchIdx = src.indexOf('.from("raid_bosses")');
    expect(fetchIdx, "raid_bosses の取得箇所が見つからない").toBeGreaterThan(-1);

    // 取得の直前で早期 return していること。
    // 「描画側だけ隠す」直し方では**問い合わせが残る**ので、それを弾く。
    const before = src.slice(0, fetchIdx);
    const guardIdx = before.lastIndexOf("if (!GAMIFICATION_ENABLED) return");
    expect(
      guardIdx,
      "raid_bosses の取得が GAMIFICATION_ENABLED で止まっていません。" +
        "表示されないだけで、予約画面を開くたびに問い合わせが飛びます。",
    ).toBeGreaterThan(-1);
    expect(fetchIdx - guardIdx).toBeLessThan(300);
  });
});
