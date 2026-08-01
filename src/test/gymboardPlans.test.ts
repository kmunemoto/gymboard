import { describe, it, expect } from "vitest";
import {
  PLAN_CARDS,
  lookupKeyFor,
  detectStripeEnvironment,
  formatLimit,
} from "@/lib/gymboardPlans";
import { PLAN_MAP, FREE_PLAN } from "../../supabase/functions/_shared/gymboard-plans";

// 各プランの上限は「請求と実際に使える人数」を決める値なので、取り違えると
// お客様を不当にブロックする / 課金より多く使えてしまう、のどちらかが起きる。
// 4プランぶんを明示的に固定する（以前は free と premium しか検証しておらず、
// Starter/Standard の人数を変えてもテストが素通りしていた）。
const EXPECTED_LIMITS: Record<string, { customers: number | null; trainers: number | null }> = {
  free: { customers: 5, trainers: 1 },
  light: { customers: 20, trainers: 3 },
  standard: { customers: 30, trainers: 5 },
  premium: { customers: null, trainers: null },
};

describe("gymboardPlans", () => {
  it("maps plan + period to lookup_key", () => {
    expect(lookupKeyFor("light", "monthly")).toBe("gymboard_starter_monthly");
    expect(lookupKeyFor("light", "yearly")).toBe("gymboard_starter_yearly");
    expect(lookupKeyFor("standard", "monthly")).toBe("gymboard_standard_monthly");
    expect(lookupKeyFor("standard", "yearly")).toBe("gymboard_standard_yearly");
    expect(lookupKeyFor("premium", "monthly")).toBe("gymboard_pro_monthly");
    expect(lookupKeyFor("premium", "yearly")).toBe("gymboard_pro_yearly");
    expect(lookupKeyFor("free", "monthly")).toBeNull();
    expect(lookupKeyFor("free", "yearly")).toBeNull();
  });

  it("defines all 4 plans with correct limits", () => {
    expect(PLAN_CARDS).toHaveLength(4);
    for (const [plan, expected] of Object.entries(EXPECTED_LIMITS)) {
      const card = PLAN_CARDS.find((p) => p.plan === plan);
      expect(card, `PLAN_CARDS に ${plan} が無い`).toBeTruthy();
      expect(card!.maxCustomers, `${plan} の maxCustomers`).toBe(expected.customers);
      expect(card!.maxTrainers, `${plan} の maxTrainers`).toBe(expected.trainers);
    }
  });

  // クライアント(src/lib/gymboardPlans.ts)とエッジ関数(_shared/gymboard-plans.ts)は
  // 同じプラン定義を2箇所に持っている（前者のコメントも "Mirrors ..." と書いてある）。
  // 画面では新しい上限、Stripe Webhook が tenants.max_customers に書くのは古い上限、
  // という食い違いが起きても今までどのテストも気付けなかったため、突き合わせる。
  it("エッジ関数側のプラン定義と上限が一致する（片方だけ直す事故を防ぐ）", () => {
    for (const card of PLAN_CARDS) {
      if (card.plan === "free") {
        expect(FREE_PLAN.max_customers, "free の max_customers").toBe(card.maxCustomers);
        expect(FREE_PLAN.max_trainers, "free の max_trainers").toBe(card.maxTrainers);
        continue;
      }
      for (const period of ["monthly", "yearly"] as const) {
        const key = lookupKeyFor(card.plan, period);
        expect(key, `${card.plan}/${period} の lookup_key`).toBeTruthy();
        const def = PLAN_MAP[key as keyof typeof PLAN_MAP];
        expect(def, `PLAN_MAP に ${key} が無い`).toBeTruthy();
        expect(def.plan, `${key} の plan`).toBe(card.plan);
        expect(def.period, `${key} の period`).toBe(period);
        expect(def.max_customers, `${key} の max_customers`).toBe(card.maxCustomers);
        expect(def.max_trainers, `${key} の max_trainers`).toBe(card.maxTrainers);
      }
    }
  });

  it("uses live environment only for production hosts", () => {
    expect(detectStripeEnvironment("gymboard.lovable.app")).toBe("live");
    // 本番カスタムドメインも live（以前は sandbox に落ちて実課金が通らなかった）
    expect(detectStripeEnvironment("app.kyoto-salute.com")).toBe("live");
    expect(detectStripeEnvironment("id-preview--69ac2641-45d8-44e0-b60d-4e002a4f9c1c.lovable.app")).toBe("sandbox");
    expect(detectStripeEnvironment("localhost")).toBe("sandbox");
  });

  it("formats limit correctly", () => {
    expect(formatLimit(null)).toBe("無制限");
    expect(formatLimit(20)).toBe("20名まで");
  });
});
