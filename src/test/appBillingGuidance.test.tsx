/**
 * iPhone アプリから、ジムボードの有料プランの購入導線を外す（2026-10-07）。
 *
 * iOS 1.8.0 (167) が App Store の審査で却下された（ガイドライン 3.1.1）。
 * 宗本さん「一旦アプリから課金への案内の導線をけしてください。
 *          システムは消さずにまたいつでも戻せる様にして」。
 *
 * 🔴 壊しやすいもの:
 *   1. iPhone に料金・「このプランにする」・「Webでプランに申し込む」が残る（再却下）
 *   2. 「Webで変更できます」の一文がバナーやヘルプに残る（これも誘導とみなされる）
 *   3. フラグを true に戻しても元に戻らない（「いつでも戻せる」が嘘になる）
 *   4. Android・Web まで消える（指摘されていない）
 *
 * フラグの値そのもの（いま true か false か）は断言しない。止める／戻すたびにテストまで
 * 直させないため。値は各テストで差し込む（2026-10-07 に止め、10-08 に戻したが、このファイルは無変更で通る）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { PLAN_CARDS } from "@/lib/gymboardPlans";

type Platform = "ios" | "android" | "web";
interface Flags { ios: boolean; android: boolean }
/** iPhone だけ止めた状態（2026-10-07 に出した形） */
const IOS_HIDDEN: Flags = { ios: false, android: true };

afterEach(() => {
  cleanup();
  vi.resetModules();
  for (const m of [
    "@capacitor/core",
    "@/lib/featureFlags",
    "@/hooks/useTenant",
    "@/hooks/useTenantLimit",
    "@/integrations/supabase/client",
    "@/lib/nativeBridge",
  ]) vi.doUnmock(m);
});

const setup = async (platform: Platform, flags: Flags = IOS_HIDDEN) => {
  vi.doMock("@capacitor/core", async (orig) => ({
    ...(await orig<typeof import("@capacitor/core")>()),
    Capacitor: { isNativePlatform: () => platform !== "web", getPlatform: () => platform },
  }));
  vi.doMock("@/lib/featureFlags", async (orig) => ({
    ...(await orig<typeof import("@/lib/featureFlags")>()),
    IOS_BILLING_GUIDANCE_ENABLED: flags.ios,
    ANDROID_BILLING_GUIDANCE_ENABLED: flags.android,
  }));
  vi.doMock("@/hooks/useTenant", () => ({
    useTenant: () => ({ tenant: { id: "t1", gymboard_plan: "free" }, role: "owner", refetch: vi.fn() }),
  }));
  vi.doMock("@/hooks/useTenantLimit", () => ({
    useTenantLimit: () => ({
      status: { over_limit: true, customer_over: true, customer_count: 12, max_customers: 10, trainer_over: false, trainer_count: 1, max_trainers: null },
      role: "owner",
    }),
  }));
  vi.doMock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
  vi.doMock("@/lib/nativeBridge", () => ({ openExternalUrl: vi.fn() }));
  const { MemoryRouter } = await import("react-router-dom");
  return { MemoryRouter };
};

const renderBilling = async (platform: Platform, flags?: Flags) => {
  const { MemoryRouter } = await setup(platform, flags);
  const { default: TrainerBilling } = await import("@/components/trainer/TrainerBilling");
  return render(<MemoryRouter><TrainerBilling /></MemoryRouter>);
};

const paidPlans = PLAN_CARDS.filter((c) => c.plan !== "free");

describe("billingGuidanceShownOn", () => {
  it("端末ごとのフラグに従う。Web は常に出す", async () => {
    await setup("web", { ios: false, android: true });
    const a = await import("@/lib/appBillingGuidance");
    expect([a.billingGuidanceShownOn("ios"), a.billingGuidanceShownOn("android"), a.billingGuidanceShownOn("web")]).toEqual([false, true, true]);
  });

  it("逆向きにしても効く（片方の端末に固定されていない）", async () => {
    await setup("web", { ios: true, android: false });
    const a = await import("@/lib/appBillingGuidance");
    expect([a.billingGuidanceShownOn("ios"), a.billingGuidanceShownOn("android"), a.billingGuidanceShownOn("web")]).toEqual([true, false, true]);
  });

  it("2つのフラグが boolean として公開されている", async () => {
    const flags = (await import("@/lib/featureFlags")) as unknown as Record<string, unknown>;
    for (const k of ["IOS_BILLING_GUIDANCE_ENABLED", "ANDROID_BILLING_GUIDANCE_ENABLED"]) {
      expect(typeof flags[k], k).toBe("boolean");
    }
  });
});

describe("設定 → プラン・お支払い（TrainerBilling）", () => {
  it("🔴 iPhone（止めている）: いまのプランだけ。料金・プランの一覧・購入ボタン・Web の案内は出さない", async () => {
    const { container } = await renderBilling("ios");
    expect(screen.getByText(i18n.t("settings.billing.currentPlan"))).toBeTruthy();
    expect(screen.getByText(PLAN_CARDS.find((c) => c.plan === "free")!.name)).toBeTruthy();

    expect(screen.queryAllByText(i18n.t("settings.billing.selectPlan"))).toHaveLength(0);
    expect(screen.queryByText(i18n.t("settings.billing.applyWeb"))).toBeNull();
    expect(screen.queryByText(i18n.t("settings.billing.applyDesc"))).toBeNull();
    expect(screen.queryByText(i18n.t("settings.billing.nativeCheckoutNote"))).toBeNull();
    expect(screen.queryByText(i18n.t("settings.billing.portalInfo"))).toBeNull();
    for (const c of paidPlans) expect(screen.queryByText(c.name), c.name).toBeNull();
    expect(container.textContent).not.toContain("¥");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("🔴 iPhone でフラグを true に戻すと、元の購入導線が戻る", async () => {
    await renderBilling("ios", { ios: true, android: true });
    expect(screen.getAllByText(i18n.t("settings.billing.selectPlan")).length).toBe(paidPlans.length);
    expect(screen.getByText(i18n.t("settings.billing.applyWeb"))).toBeTruthy();
  });

  it("Android は今まで通り（指摘されていない）", async () => {
    await renderBilling("android");
    expect(screen.getAllByText(i18n.t("settings.billing.selectPlan")).length).toBe(paidPlans.length);
  });

  it("Web は今まで通り", async () => {
    await renderBilling("web");
    expect(screen.getAllByText(i18n.t("settings.billing.selectThis")).length).toBe(paidPlans.length);
  });
});

describe("プラン上限の警告バナー（PlanLimitBanner）", () => {
  const renderBanner = async (platform: Platform, flags?: Flags) => {
    await setup(platform, flags);
    const { default: PlanLimitBanner } = await import("@/components/PlanLimitBanner");
    return render(<PlanLimitBanner onUpgrade={vi.fn()} onManageCustomers={vi.fn()} />);
  };

  it("🔴 iPhone（止めている）: 「Webで変更できます」を書かない。アップグレードのボタンも出さない", async () => {
    await renderBanner("ios");
    expect(screen.getByText(i18n.t("planLimit.overDescApp"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("planLimit.overDescNative"))).toBeNull();
    expect(screen.queryByText(i18n.t("planLimit.upgrade"))).toBeNull();
    // 顧客の整理には行ける（購入の導線ではない）
    expect(screen.getByText(i18n.t("planLimit.manageCustomers"))).toBeTruthy();
  });

  it("新しい文言は、元の文言から「Webで変更できます」を抜いただけ", () => {
    expect(i18n.t("planLimit.overDescApp")).not.toBe(i18n.t("planLimit.overDescNative"));
    expect(i18n.t("planLimit.overDescApp").length).toBeLessThan(i18n.t("planLimit.overDescNative").length);
  });

  it("iPhone でフラグを true に戻すと元の文言", async () => {
    await renderBanner("ios", { ios: true, android: true });
    expect(screen.getByText(i18n.t("planLimit.overDescNative"))).toBeTruthy();
  });

  it("Android・Web は今まで通り", async () => {
    await renderBanner("android");
    expect(screen.getByText(i18n.t("planLimit.overDescNative"))).toBeTruthy();
    cleanup();
    vi.resetModules();
    await renderBanner("web");
    expect(screen.getByText(i18n.t("planLimit.overDescWeb"))).toBeTruthy();
    expect(screen.getByText(i18n.t("planLimit.upgrade"))).toBeTruthy();
  });
});

describe("ヘルプ（TrainerHelpGuide）の「プランのご契約方法」", () => {
  const renderHelp = async (platform: Platform, flags?: Flags) => {
    await setup(platform, flags);
    const { default: TrainerHelpGuide } = await import("@/components/trainer/TrainerHelpGuide");
    return render(<TrainerHelpGuide />);
  };

  it("🔴 iPhone（止めている）: 節ごと出さない", async () => {
    await renderHelp("ios");
    expect(screen.queryByText(i18n.t("help.section5Title"))).toBeNull();
    // 他の節は残る
    expect(screen.getByText(i18n.t("help.section4Title"))).toBeTruthy();
  });

  it("iPhone でフラグを true に戻すと出る／Web は今まで通り", async () => {
    await renderHelp("ios", { ios: true, android: true });
    expect(screen.getByText(i18n.t("help.section5Title"))).toBeTruthy();
    cleanup();
    vi.resetModules();
    await renderHelp("web");
    expect(screen.getByText(i18n.t("help.section5Title"))).toBeTruthy();
  });
});
