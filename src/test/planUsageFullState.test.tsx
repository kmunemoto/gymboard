import { readFileSync } from "fs";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";
import PlanUsageBadge from "@/components/customer/PlanUsageBadge";
import { computePlanUsage, type PlanUsageInput } from "@/lib/planUsage";

// 使い切り状態（残り0）の見せ方の見張り（2026-08-26）。
//
// もともと残り0は種別を問わず赤い「予約枠なし」だった。だが月N回サブスクでは
// **残り0でも次のサイクルに入る日付の予約は取れる**（上限の判定は UI も DB も
// 「予約対象日が属するサイクル」で数える。planSessionLimit.test.ts が固定）。
// 赤い「枠なし」は「もう予約してはいけない」に読めてしまい、お客様が先の予約を
// 遠慮してしまうため、サブスクだけ「今回分は予約済み」（アクセント色）に変えた。
//
// 🔴 回数券（ticket）は次のサイクルで回復しない（使い切りで恒久）。
//    こちらまで「予約済み（完了）」の見た目にすると、もう使えない回数券で
//    予約できるかのように誤解させる。赤の「予約枠なし」のまま守ること。
//
// 文言は i18n キーから引く（フォークが vertical.ja.json で語彙を差し替えるため、
// 日本語リテラルの直接アサートは forkHostileTests が禁じている）。

afterEach(() => cleanup());

/** 月3回サブスクを予約で使い切った状態（スクリーンショットの Salute と同じ形） */
const subscriptionFull = () => {
  const input: PlanUsageInput = {
    planType: "subscription",
    maxSessions: 3,
    cycleMonths: 1,
    startDate: "2026-08-05",
  };
  const bookings = ["2026-08-10", "2026-08-20", "2026-08-30"].map((d) => ({
    booking_date: `${d}T21:30:00+09:00`,
    status: "予約済み",
  }));
  return computePlanUsage(input, bookings, new Date("2026-08-25T12:00:00+09:00"));
};

/** 回数券（5回・期限内）を使い切った状態 */
const ticketFull = () => {
  const input: PlanUsageInput = {
    planType: "ticket",
    maxSessions: 5,
    validityDays: 90,
    startDate: "2026-08-01",
  };
  const bookings = ["2026-08-03", "2026-08-06", "2026-08-10", "2026-08-13", "2026-08-17"].map(
    (d) => ({ booking_date: `${d}T10:00:00+09:00`, status: "予約済み" }),
  );
  return computePlanUsage(input, bookings, new Date("2026-08-25T12:00:00+09:00"));
};

describe("🔴 サブスクの残り0は「完了」であって「エラー」ではない", () => {
  it("前提: 使い切り状態が正しく作れている", () => {
    const usage = subscriptionFull();
    expect(usage.kind).toBe("subscription");
    expect(usage.remaining).toBe(0);
    expect(usage.consumed).toBe(true);
  });

  it("バッジが「今回分は予約済み」になる（「予約枠なし」ではない）", () => {
    render(<PlanUsageBadge usage={subscriptionFull()} />);
    expect(screen.getByText(i18n.t("booking.cycleFullBadge"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("booking.noSlotsLeft"))).toBeNull();
  });

  it("バッジが赤（destructive）ではなくアクセント色", () => {
    const { container } = render(<PlanUsageBadge usage={subscriptionFull()} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain("text-accent");
    expect(badge.className).not.toContain("destructive");
  });
});

describe("🔴 回数券の残り0は従来どおり（回復しないので「予約済み＝完了」に見せない）", () => {
  it("前提: 使い切り状態が正しく作れている", () => {
    const usage = ticketFull();
    expect(usage.kind).toBe("ticket");
    expect(usage.remaining).toBe(0);
    expect(usage.isExpired).toBe(false);
  });

  it("バッジが「予約枠なし」のまま・赤のまま", () => {
    const { container } = render(<PlanUsageBadge usage={ticketFull()} />);
    expect(screen.getByText(i18n.t("booking.noSlotsLeft"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("booking.cycleFullBadge"))).toBeNull();
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain("text-destructive");
  });
});

describe("案内文とバー色（PlanUsageCard 側の分岐のかたち）", () => {
  // PlanUsageCard は tenantPlans の解決を挟むので、分岐そのものはソースで見張る。
  // （kind での出し分けを消して destructive 一本に戻す変更を検出する）
  const src = () => readFileSync("src/components/customer/PlanUsageCard.tsx", "utf8");

  it("使い切りの案内はサブスクだけ periodConsumed（回数券は ticketUsedUp）", () => {
    expect(src()).toMatch(
      /usage\.kind === "subscription" \? t\("booking\.periodConsumed"\) : t\("booking\.ticketUsedUp"\)/,
    );
  });

  it("残り0のバー色もサブスクだけアクセント（回数券は赤のまま）", () => {
    expect(src()).toMatch(
      /usage\.remaining === 0 \? \(usage\.kind === "subscription" \? "bg-accent" : "bg-destructive"\)/,
    );
  });

  it("案内文が「先の予約が取れる」ことに触れている（ja）", () => {
    // 文言そのものは変わってよいが、「次回分（先の予約）」への言及が消えたら
    // この改修の意図ごと巻き戻っている。キーの値を i18n から引いて確認する。
    expect(String(i18n.t("booking.periodConsumed"))).toContain("次回分");
  });
});
