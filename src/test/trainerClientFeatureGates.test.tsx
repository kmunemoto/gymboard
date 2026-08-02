import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { upstreamOnly } from "./helpers/upstream";

// 顧客側フィーチャーフラグをトレーナー画面（TrainerClientDetail）にも効かせる回帰テスト。
// フォークでお客様側だけ絞った結果、トレーナー側が上流ジムボードのまま残るのを防ぐ。
//
// 消してはいけないもの（概要・予約・チャット・骨格）が残ることも検証する。
// これが落ちると店がカルテを操作不能にできてしまう。

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("@/lib/featureFlags");
});

const setup = async () => {
  vi.doMock("@/hooks/useTenant", () => ({
    useTenant: () => ({
      tenant: { id: "t1", slot_duration_minutes: 60 },
      membership: null,
      role: "owner",
      plans: [],
      loading: false,
      refetch: vi.fn(),
    }),
  }));
  vi.doMock("@/hooks/useProfile", () => ({
    useProfile: () => ({ profile: { user_id: "c1", display_name: "テスト顧客" }, loading: false, refetch: vi.fn() }),
  }));
  vi.doMock("@/hooks/useMeasurements", () => ({
    useMeasurements: () => ({
      measurements: [],
      chartData: [],
      saveMeasurement: vi.fn(),
      deleteMeasurement: vi.fn(),
      latest: null,
      loading: false,
    }),
  }));
  vi.doMock("@/hooks/useMessages", () => ({
    useMessages: () => ({ messages: [], loading: false, sendMessage: vi.fn(), markAsRead: vi.fn() }),
  }));
  vi.doMock("@/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "u1" }, session: null, loading: false }),
  }));
  vi.doMock("@/integrations/supabase/client", () => ({
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { display_name: "テスト顧客", plan: "月4" }, error: null }),
            order: () => ({
              order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
            limit: () => Promise.resolve({ data: [], error: null }),
            gte: () => ({ lt: () => Promise.resolve({ data: [], error: null }) }),
          }),
          order: () => {
            const result: any = Promise.resolve({ data: [], error: null });
            result.order = () => Promise.resolve({ data: [], error: null });
            return result;
          },
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }), in: () => Promise.resolve({ error: null }) }),
      }),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    },
  }));
  const stub = (name: string) => ({ default: () => <div data-testid={name} /> });
  vi.doMock("@/components/customer/PlanUsageCard", () => stub("plan-usage-card"));
  vi.doMock("@/components/customer/posture/DiagnosisHistorySection", () => stub("diagnosis-history"));
  vi.doMock("@/components/trainer/TrainerMonthlyComment", () => stub("monthly-comment"));
  vi.doMock("@/components/customer/MuscleBalanceRadar", () => stub("muscle-radar"));
  vi.doMock("@/components/trainer/TrainerWeightJourneyPanel", () => stub("weight-journey"));
  vi.doMock("@/components/trainer/clientDetail/TrainingGrowthChart", () => stub("growth-chart"));
  vi.doMock("@/components/customer/SessionExpSummaryDialog", () => stub("session-exp"));
  vi.doMock("@/components/customer/MilestoneAchievedDialog", () => stub("milestone-dialog"));
  vi.doMock("@/lib/tenantHelper", () => ({ fetchMyTenantId: () => Promise.resolve("t1") }));

  const { default: TrainerClientDetail } = await import("@/components/trainer/TrainerClientDetail");
  render(<TrainerClientDetail clientId="c1" onBack={() => {}} />);
  // プロフィール取得の useEffect を待つ
  await screen.findByText("テスト顧客", {}, { timeout: 3000 }).catch(() => null);
};

const tabLabels = () =>
  Array.from(document.querySelectorAll('[role="tab"]')).map((el) => el.textContent?.trim() ?? "");

describe("トレーナー顧客カルテの機能ゲート（タブ）", () => {
  it("全ONなら記録・食事タブが出る", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      WORKOUT_LOG_ENABLED: true,
      MEALS_ENABLED: true,
      BODY_METRICS_ENABLED: true,
      MUSCLE_RADAR_ENABLED: true,
      MONTHLY_REPORT_ENABLED: false,
      GAMIFICATION_ENABLED: false,
    }));
    await setup();
    const labels = tabLabels();
    expect(labels).toContain(i18n.t("clientDetail.tabTraining"));
    expect(labels).toContain(i18n.t("clientDetail.tabMeals"));
    expect(labels).toContain(i18n.t("clientDetail.tabOverview"));
    expect(labels).toContain(i18n.t("clientDetail.tabBookings"));
    expect(labels).toContain(i18n.t("clientDetail.tabSkeletal"));
    expect(labels).toContain(i18n.t("clientDetail.tabChat"));
  });

  it("WORKOUT_LOG_ENABLED=false で記録タブが消える", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      WORKOUT_LOG_ENABLED: false,
      MEALS_ENABLED: true,
      BODY_METRICS_ENABLED: true,
      MUSCLE_RADAR_ENABLED: false,
      MONTHLY_REPORT_ENABLED: false,
      GAMIFICATION_ENABLED: false,
    }));
    await setup();
    const labels = tabLabels();
    expect(labels).not.toContain(i18n.t("clientDetail.tabTraining"));
    expect(labels).toContain(i18n.t("clientDetail.tabOverview"));
    expect(labels).toContain(i18n.t("clientDetail.tabBookings"));
    expect(labels).toContain(i18n.t("clientDetail.tabSkeletal"));
    expect(labels).toContain(i18n.t("clientDetail.tabChat"));
  });

  it("MEALS_ENABLED=false で食事タブが消える", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      WORKOUT_LOG_ENABLED: true,
      MEALS_ENABLED: false,
      BODY_METRICS_ENABLED: true,
      MUSCLE_RADAR_ENABLED: true,
      MONTHLY_REPORT_ENABLED: false,
      GAMIFICATION_ENABLED: false,
    }));
    await setup();
    const labels = tabLabels();
    expect(labels).not.toContain(i18n.t("clientDetail.tabMeals"));
    expect(labels).toContain(i18n.t("clientDetail.tabTraining"));
  });

  it("両方OFFでも 概要・予約・骨格・チャット は必ず残る", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      WORKOUT_LOG_ENABLED: false,
      MEALS_ENABLED: false,
      BODY_METRICS_ENABLED: false,
      MUSCLE_RADAR_ENABLED: false,
      MONTHLY_REPORT_ENABLED: false,
      GAMIFICATION_ENABLED: false,
    }));
    await setup();
    const labels = tabLabels();
    expect(labels).toEqual([
      i18n.t("clientDetail.tabOverview"),
      i18n.t("clientDetail.tabBookings"),
      i18n.t("clientDetail.tabSkeletal"),
      i18n.t("clientDetail.tabChat"),
    ]);
  });

  it("BODY_METRICS_ENABLED=false で体重ジャーニーパネルが消える", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      WORKOUT_LOG_ENABLED: false,
      MEALS_ENABLED: false,
      BODY_METRICS_ENABLED: false,
      MUSCLE_RADAR_ENABLED: false,
      MONTHLY_REPORT_ENABLED: false,
      GAMIFICATION_ENABLED: false,
    }));
    await setup();
    expect(screen.queryByTestId("weight-journey")).toBeNull();
  });

  it("BODY_METRICS_ENABLED=true で体重ジャーニーパネルが出る", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      WORKOUT_LOG_ENABLED: false,
      MEALS_ENABLED: false,
      BODY_METRICS_ENABLED: true,
      MUSCLE_RADAR_ENABLED: false,
      MONTHLY_REPORT_ENABLED: false,
      GAMIFICATION_ENABLED: false,
    }));
    await setup();
    expect(screen.getByTestId("weight-journey")).toBeTruthy();
  });
});

upstreamOnly("ジムボード本体の既定値", () => {
  it("顧客側フラグは既定 true（トレーナー画面でも従来どおり）", async () => {
    const flags = await import("@/lib/featureFlags");
    expect(flags.WORKOUT_LOG_ENABLED).toBe(true);
    expect(flags.MEALS_ENABLED).toBe(true);
    expect(flags.BODY_METRICS_ENABLED).toBe(true);
    expect(flags.MUSCLE_RADAR_ENABLED).toBe(true);
    expect(flags.POSTURE_ENABLED).toBe(true);
    expect(flags.WORKOUT_SHARE_ENABLED).toBe(true);
  });
});
