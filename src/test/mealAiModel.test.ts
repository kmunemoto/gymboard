import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  MEAL_FALLBACK_MODEL, MEAL_PRIMARY_MODEL, MEAL_STAGE_TIMEOUTS, askWithFallback, isAccountLevelAiError,
  type AiCaller,
} from "../../supabase/functions/_shared/mealAiModel";

// 食事の写真の分析（analyze-meal）を、使える中で一番賢いモデルにする（2026-11-09）。
//
// 宗本さん「アプリの食事管理の AI の精度、一番賢いまで上げて」。
// 主は google/gemini-4-argon（Lovable AI Gateway で Google の最上位・正式版）。失敗・時間切れ・読めない答えのときだけ
// google/gemini-3.8-flash で1回聞き直す。以前の google/gemini-2.5-flash は廃止日（2026-10-20）を過ぎている。
//
// 2026-11-09 に Lovable のエージェントのサンドボックスで、公開されている和朝食の写真（Wikimedia Commons）を
// 同じ呼び方で送って確かめた: gemini-4-argon 200・7.5秒・8品（JSON だけ）／gemini-3.8-flash 200・8.9秒・10品。
// reasoning_effort: high は受け付けられたが 26.6秒・6品（味噌汁を落とした）だったので付けない。
//
// ── 変異テスト（2026-11-09 実施・どれも赤を確認）──────────────────────────
//   1. 主のモデルを廃止予定の google/gemini-2.5-flash に戻す                → 赤
//   2. 429・402 でも予備で聞き直す（混雑・クレジット不足を隠す）          → 赤
//   3. 読めない答えをそのまま返す（予備で聞き直さない）                     → 赤
//   4. analyze-meal が時間切れ（AbortController）を付けずに呼ぶ             → 赤
//   5. 時間の合計が Edge Function の上限（約150秒）を超える                  → 赤

const status = (code: number) => Object.assign(new Error(`AI error ${code}`), { status: code });
const json = (text: string): { dishes: unknown[] } | null => {
  try {
    const parsed = JSON.parse(text);
    return parsed?.dishes?.length ? parsed : null;
  } catch {
    return null;
  }
};
const OK = JSON.stringify({ dishes: [{ name: "鯖の塩焼き", weight_g: 70, ingredients: ["鯖"] }] });

describe("モデルの選び方", () => {
  it("主は Google の最上位（gemini-4-argon）、予備は速い正式版（gemini-3.8-flash）", () => {
    expect(MEAL_PRIMARY_MODEL).toBe("google/gemini-4-argon");
    expect(MEAL_FALLBACK_MODEL).toBe("google/gemini-3.8-flash");
  });

  it("🔴 廃止予定（廃止日を過ぎた）google/gemini-2.5-flash をどこでも使っていない", () => {
    for (const f of ["supabase/functions/_shared/mealAiModel.ts", "supabase/functions/analyze-meal/index.ts"]) {
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(code, f).not.toContain("gemini-2.5-flash");
    }
  });

  it("時間切れの合計が Edge Function の上限（約150秒）に収まる（最悪 140秒）", () => {
    const { dishes, nutrition } = MEAL_STAGE_TIMEOUTS;
    expect(dishes.primary + dishes.fallback + nutrition.primary + nutrition.fallback).toBeLessThanOrEqual(140_000);
    // 主には十分な時間を（試しでは1段目 7.5秒）
    expect(dishes.primary).toBeGreaterThanOrEqual(30_000);
    expect(nutrition.primary).toBeGreaterThanOrEqual(30_000);
  });
});

describe("askWithFallback（主 → 予備）", () => {
  const timeouts = { primary: 50_000, fallback: 25_000 };

  it("主が読める答えを返したら、それで終わり（予備は呼ばない）", async () => {
    const call = vi.fn<AiCaller>().mockResolvedValueOnce(OK);
    const res = await askWithFallback(call, json, timeouts);
    expect(res.model).toBe(MEAL_PRIMARY_MODEL);
    expect(res.result?.dishes).toHaveLength(1);
    expect(call.mock.calls).toEqual([[MEAL_PRIMARY_MODEL, 50_000]]);
  });

  it("主が失敗（500）したら、予備で1回だけ聞き直す", async () => {
    const call = vi.fn<AiCaller>().mockRejectedValueOnce(status(500)).mockResolvedValueOnce(OK);
    const log = vi.fn();
    const res = await askWithFallback(call, json, timeouts, log);
    expect(res.model).toBe(MEAL_FALLBACK_MODEL);
    expect(res.result).not.toBeNull();
    expect(call.mock.calls).toEqual([[MEAL_PRIMARY_MODEL, 50_000], [MEAL_FALLBACK_MODEL, 25_000]]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("主が時間切れ（AbortError）でも、予備で聞き直す", async () => {
    const abort = Object.assign(new Error("The signal has been aborted"), { name: "AbortError" });
    const call = vi.fn<AiCaller>().mockRejectedValueOnce(abort).mockResolvedValueOnce(OK);
    expect((await askWithFallback(call, json, timeouts)).model).toBe(MEAL_FALLBACK_MODEL);
  });

  it("主の答えが読めない（JSON でない・料理が空）なら、予備で聞き直す", async () => {
    for (const bad of ["ごめんなさい、わかりません", JSON.stringify({ dishes: [] })]) {
      const call = vi.fn<AiCaller>().mockResolvedValueOnce(bad).mockResolvedValueOnce(OK);
      const res = await askWithFallback(call, json, timeouts);
      expect(res.model).toBe(MEAL_FALLBACK_MODEL);
      expect(res.result).not.toBeNull();
    }
  });

  it("🔴 429（混雑）・402（クレジット不足）は予備で聞き直さず、そのまま投げる（今まで通りの案内になる）", async () => {
    for (const code of [429, 402]) {
      const call = vi.fn<AiCaller>().mockRejectedValueOnce(status(code));
      await expect(askWithFallback(call, json, timeouts)).rejects.toMatchObject({ status: code });
      expect(call).toHaveBeenCalledTimes(1);
      expect(isAccountLevelAiError(status(code))).toBe(true);
    }
    expect(isAccountLevelAiError(status(500))).toBe(false);
    expect(isAccountLevelAiError(null)).toBe(false);
  });

  it("予備も読めなければ result は null（呼ぶ側が「もう一度お試しください」を返す）。予備の失敗はそのまま投げる", async () => {
    const both = vi.fn<AiCaller>().mockResolvedValueOnce("x").mockResolvedValueOnce("y");
    const res = await askWithFallback(both, json, timeouts);
    expect(res).toEqual({ result: null, model: MEAL_FALLBACK_MODEL, raw: "y" });

    const failing = vi.fn<AiCaller>().mockRejectedValueOnce(status(500)).mockRejectedValueOnce(status(503));
    await expect(askWithFallback(failing, json, timeouts)).rejects.toMatchObject({ status: 503 });
  });
});

describe("analyze-meal のつなぎ方", () => {
  const src = readFileSync("supabase/functions/analyze-meal/index.ts", "utf8");

  it("1段目（写真→料理）も2段目（栄養）も、主 → 予備で聞く", () => {
    expect(src.match(/await askWithFallback\(/g)?.length).toBe(2);
    expect(src).toContain("MEAL_STAGE_TIMEOUTS.dishes");
    expect(src).toContain("MEAL_STAGE_TIMEOUTS.nutrition");
    // 写真はこれまで通り1段目にだけ渡す（detail: high のまま）
    expect(src).toMatch(/image_url: \{ url: resolvedImageUrl, detail: "high" \}/);
  });

  it("AI の呼び出しに時間切れ（AbortController）を付けている", () => {
    expect(src).toMatch(/new AbortController\(\)/);
    expect(src).toMatch(/signal: ctrl\.signal/);
    expect(src).toMatch(/clearTimeout\(timer\)/);
  });

  it("推論の深さ（reasoning_effort）は付けない（試しで遅く、料理を落とした）", () => {
    expect(src).not.toMatch(/reasoning_effort|reasoning:/);
    expect(src).toContain("body: JSON.stringify({ model, messages })");
  });

  it("デプロイの確認用の印（x-gymboard-build）を新しくしている", () => {
    expect(src).toContain('const BUILD = "2026-11-09-gemini-4-argon";');
  });

  it("429・402 の案内（今まで通り）は残っている", () => {
    expect(src).toContain("err.status === 429");
    expect(src).toContain("err.status === 402");
  });
});
