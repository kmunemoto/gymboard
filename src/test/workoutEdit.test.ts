import { describe, it, expect } from "vitest";
import { buildWorkoutSetsUpdate } from "@/lib/workoutEdit";

describe("buildWorkoutSetsUpdate", () => {
  it("有効なセットを1始まりで採番し、先頭を weight/reps に反映する", () => {
    const r = buildWorkoutSetsUpdate([
      { weight: "60", reps: "10" },
      { weight: "62.5", reps: "8" },
    ]);
    expect(r.valid).toBe(true);
    expect(r.sets).toEqual([
      { set: 1, weight: 60, reps: 10 },
      { set: 2, weight: 62.5, reps: 8 },
    ]);
    expect(r.weight).toBe(60);
    expect(r.reps).toBe(10);
  });

  it("空欄のセットは捨てて採番し直す", () => {
    const r = buildWorkoutSetsUpdate([
      { weight: "", reps: "" },
      { weight: "40", reps: "12" },
      { weight: "45", reps: "" }, // 回数欠け → 捨てる
    ]);
    expect(r.valid).toBe(true);
    expect(r.sets).toEqual([{ set: 1, weight: 40, reps: 12 }]);
    expect(r.weight).toBe(40);
    expect(r.reps).toBe(12);
  });

  it("1件も有効なセットが無ければ valid:false", () => {
    const r = buildWorkoutSetsUpdate([
      { weight: "", reps: "" },
      { weight: "50", reps: "" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.sets).toEqual([]);
    expect(r.weight).toBeNull();
    expect(r.reps).toBeNull();
  });

  it("自重（重量0）は有効なセットとして扱う", () => {
    const r = buildWorkoutSetsUpdate([{ weight: "0", reps: "15" }]);
    expect(r.valid).toBe(true);
    expect(r.sets).toEqual([{ set: 1, weight: 0, reps: 15 }]);
    expect(r.weight).toBe(0);
    expect(r.reps).toBe(15);
  });

  it("数値として解釈できない入力は捨てる", () => {
    const r = buildWorkoutSetsUpdate([
      { weight: "abc", reps: "10" },
      { weight: "70", reps: "5" },
    ]);
    expect(r.valid).toBe(true);
    expect(r.sets).toEqual([{ set: 1, weight: 70, reps: 5 }]);
  });

  it("小数の重量・前後空白を正しく解釈する", () => {
    const r = buildWorkoutSetsUpdate([{ weight: " 52.5 ", reps: " 6 " }]);
    expect(r.valid).toBe(true);
    expect(r.sets).toEqual([{ set: 1, weight: 52.5, reps: 6 }]);
  });
});
