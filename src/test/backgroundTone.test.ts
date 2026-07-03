import { describe, it, expect } from "vitest";
import { visibleRegion, weightedMeanLuma, decideToneFromLuma } from "@/lib/backgroundTone";

// RGBA ピクセル配列を作る（全ピクセル同色）
const solid = (w: number, h: number, v: number): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return data;
};

describe("decideToneFromLuma（暗幕込みの実効輝度で黒/白を判定）", () => {
  it("暗い背景は dark（→ 白文字）", () => {
    expect(decideToneFromLuma(0)).toBe("dark");
    expect(decideToneFromLuma(0.3)).toBe("dark");
  });
  it("明るい背景は light（→ 従来の濃色文字）", () => {
    expect(decideToneFromLuma(1)).toBe("light");
    expect(decideToneFromLuma(0.8)).toBe("light");
  });
  it("中間トーンは暗幕(18%)を織り込んで dark 側に倒す", () => {
    // 実効輝度 = 0.82*m + 0.02 なので m=0.55 → 0.47 < 0.5 → dark
    expect(decideToneFromLuma(0.55)).toBe("dark");
    // m=0.62 → 0.528 → light
    expect(decideToneFromLuma(0.62)).toBe("light");
  });
});

describe("weightedMeanLuma（上部1/3は2倍の重み）", () => {
  it("真っ黒は0・真っ白は1", () => {
    expect(weightedMeanLuma(solid(4, 4, 0), 4, 4)).toBeCloseTo(0, 5);
    expect(weightedMeanLuma(solid(4, 4, 255), 4, 4)).toBeCloseTo(1, 2);
  });

  it("上部が白・下部が黒なら、均等平均(1/3)より白寄りになる", () => {
    // 3行: 上1行=白(重み2)、下2行=黒(重み1) → (1*2)/(2+1+1) = 0.5
    const w = 2;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = y === 0 ? 255 : 0;
        const i = (y * w + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const mean = weightedMeanLuma(data, w, h);
    expect(mean).toBeGreaterThan(1 / 3); // 均等平均より上
    expect(mean).toBeCloseTo(0.5, 2);
  });

  it("不正な入力は中立値(0.5)", () => {
    expect(weightedMeanLuma(new Uint8ClampedArray(0), 0, 0)).toBe(0.5);
  });
});

describe("visibleRegion（画面に実際に表示される画像範囲）", () => {
  it("切り抜き範囲(%)が指定されていればそれを画像pxへ変換", () => {
    const r = visibleRegion(1000, 800, { x: 10, y: 20, width: 50, height: 25 }, 390, 844);
    expect(r.x).toBe(100);
    expect(r.y).toBe(160);
    expect(r.w).toBe(500);
    expect(r.h).toBe(200);
  });

  it("cover表示（範囲未設定）は画面アスペクト比の中央トリミング範囲", () => {
    // 横長画像(2000x1000) を縦長画面(390x844)で cover → 縦は全高、横は中央の一部
    const r = visibleRegion(2000, 1000, null, 390, 844);
    expect(r.h).toBeCloseTo(1000, 0);
    expect(r.w).toBeCloseTo(1000 * (390 / 844), 0);
    expect(r.x).toBeCloseTo((2000 - r.w) / 2, 0);
    expect(r.y).toBeCloseTo(0, 0);
  });

  it("画面サイズ不明なら画像全体", () => {
    const r = visibleRegion(1000, 800, null, 0, 0);
    expect(r).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });
});
