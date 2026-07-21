import { describe, it, expect } from "vitest";
import {
  PLAN_CARDS,
  lookupKeyFor,
  detectStripeEnvironment,
  formatLimit,
} from "@/lib/gymboardPlans";

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
    const free = PLAN_CARDS.find((p) => p.plan === "free")!;
    expect(free.maxCustomers).toBe(5);
    const pro = PLAN_CARDS.find((p) => p.plan === "premium")!;
    expect(pro.maxCustomers).toBeNull();
    expect(pro.maxTrainers).toBeNull();
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
