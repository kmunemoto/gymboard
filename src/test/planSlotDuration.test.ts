import { describe, it, expect } from "vitest";
import { resolvePlanSlotMinutes } from "@/lib/planSlotDuration";

describe("resolvePlanSlotMinutes", () => {
  const plans = [
    { plan_name: "月4回", slot_duration_minutes: null },
    { plan_name: "月4回(30分)", slot_duration_minutes: 30 },
    { plan_name: "月8回", slot_duration_minutes: 90 },
  ];

  it("プランに設定があればそれを使う", () => {
    expect(resolvePlanSlotMinutes("月4回(30分)", plans, 60)).toBe(30);
    expect(resolvePlanSlotMinutes("月8回", plans, 60)).toBe(90);
  });

  it("プランの設定が null（未設定）ならジムの既定値を継承する", () => {
    expect(resolvePlanSlotMinutes("月4回", plans, 60)).toBe(60);
    expect(resolvePlanSlotMinutes("月4回", plans, 45)).toBe(45);
  });

  it("該当プランが見つからない（削除済み・体験予約など）ならジムの既定値", () => {
    expect(resolvePlanSlotMinutes("廃止済みプラン", plans, 60)).toBe(60);
    expect(resolvePlanSlotMinutes("初回無料体験", plans, 60)).toBe(60);
  });

  it("プラン名・プラン一覧が無い場合もジムの既定値", () => {
    expect(resolvePlanSlotMinutes(null, plans, 60)).toBe(60);
    expect(resolvePlanSlotMinutes(undefined, plans, 60)).toBe(60);
    expect(resolvePlanSlotMinutes("月4回", null, 60)).toBe(60);
    expect(resolvePlanSlotMinutes("月4回", undefined, 60)).toBe(60);
    expect(resolvePlanSlotMinutes("月4回", [], 60)).toBe(60);
  });
});
