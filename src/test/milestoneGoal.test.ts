import { describe, it, expect } from "vitest";
import { isMilestoneOverdue, MILESTONE_REVIEW_DAYS } from "@/lib/milestoneGoal";

const NOW = new Date("2026-07-08T12:00:00Z"); // 固定の基準時刻
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

describe("isMilestoneOverdue", () => {
  it("setAt が null（一度も設定していない）なら true", () => {
    expect(isMilestoneOverdue(null, NOW)).toBe(true);
  });

  it("設定直後（0日経過）は false", () => {
    expect(isMilestoneOverdue(daysBefore(0), NOW)).toBe(false);
  });

  it(`${MILESTONE_REVIEW_DAYS - 1}日経過は false（まだ見直し時期でない）`, () => {
    expect(isMilestoneOverdue(daysBefore(MILESTONE_REVIEW_DAYS - 1), NOW)).toBe(false);
  });

  it(`ちょうど${MILESTONE_REVIEW_DAYS}日経過は true（見直し時期）`, () => {
    expect(isMilestoneOverdue(daysBefore(MILESTONE_REVIEW_DAYS), NOW)).toBe(true);
  });

  it(`${MILESTONE_REVIEW_DAYS + 1}日経過は true`, () => {
    expect(isMilestoneOverdue(daysBefore(MILESTONE_REVIEW_DAYS + 1), NOW)).toBe(true);
  });
});
