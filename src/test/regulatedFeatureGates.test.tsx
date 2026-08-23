import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import { upstreamOnly } from "./helpers/upstream";
import TrainingRecommendationCard from "@/components/customer/posture/TrainingRecommendationCard";
import type { PostureFeedback } from "@/components/customer/posture/types";

// 業種によって法令の射程が変わる機能（src/lib/featureFlags.ts の
// 「業種によって法令・広告規制の射程が変わる機能」節）の回帰テスト。
//
// SKELETAL_DIAGNOSIS_ENABLED / GOOGLE_REVIEW_ENABLED / LANGUAGE_SWITCHER_ENABLED は
// どれも「フラグを false にしたら本当に消えるか」に加えて、
// 骨格診断だけは「診断部分を消しても、独立しているはずの姿勢フィードバック提案が
// 道連れで消えないか」を見る必要がある（同じコンポーネントの中で結合していたため）。

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("@/lib/featureFlags");
});

// ⚠️ **`as PostureFeedback` のキャストを付けないこと。**
// 以前はキャストで欠けたフィールドを黙らせており、型を変えても気づけなかった。
const feedbacks: PostureFeedback[] = [
  { type: "warning", severity: "warning", categoryKey: "roundedBack", messageKey: "roundedBackWarning" },
];

describe("骨格診断（TrainingRecommendationCard の疎結合）", () => {
  it("skeletalType があれば、タイプ別推奨セクションが出る", () => {
    render(<TrainingRecommendationCard skeletalType="straight" feedbacks={[]} />);
    expect(screen.getByText(i18n.t("posture.recommendation.title"))).toBeTruthy();
  });

  it("skeletalType が null でも、姿勢フィードバックに基づく提案は独立して出る", () => {
    // SKELETAL_DIAGNOSIS_ENABLED=false のフォークでは、CustomerPosture.tsx が
    // skeletalType に常に null を渡す。この状態でも postureTips は消えないこと。
    render(<TrainingRecommendationCard skeletalType={null} feedbacks={feedbacks} />);
    expect(screen.getByText(i18n.t("posture.recommendation.postureExerciseTitle"))).toBeTruthy();
  });

  it("skeletalType が null かつ提案する feedback も無ければ、何も描画しない", () => {
    const { container } = render(<TrainingRecommendationCard skeletalType={null} feedbacks={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("CustomerPosture.tsx は SKELETAL_DIAGNOSIS_ENABLED を経由してのみ骨格診断を呼ぶ", () => {
    // 実際にレンダーして確認するには TensorFlow.js の重い依存が要るため、
    // ここではフラグ経由の呼び出しになっていることをソースで検査するに留める
    // （mem/ops/schema-drift.md や verticalPresets.test.ts と同じ「番人」の作法）。
    const src = readFileSync("src/components/customer/CustomerPosture.tsx", "utf8");
    expect(src).toContain("SKELETAL_DIAGNOSIS_ENABLED");
    expect(src).toMatch(/SKELETAL_DIAGNOSIS_ENABLED\s*&&\s*keypoints\.length > 0/);
  });
});

describe("フラグが公開されている", () => {
  // 値（true/false）は業種ごとに変わるので、ここでは存在と型だけを見る。
  // 値を断言するとフォークで必ず赤くなる（helpers/upstream.ts のコメント参照）。
  it("3つのフラグが boolean として公開されている", async () => {
    const flags = (await import("@/lib/featureFlags")) as unknown as Record<string, unknown>;
    for (const k of ["SKELETAL_DIAGNOSIS_ENABLED", "GOOGLE_REVIEW_ENABLED", "LANGUAGE_SWITCHER_ENABLED"]) {
      expect(typeof flags[k], `${k} が未定義、または boolean でない`).toBe("boolean");
    }
  });
});

upstreamOnly("ジムボード本体の既定値", () => {
  it("3つのフラグは既定 true（従来どおりの挙動）", async () => {
    const flags = await import("@/lib/featureFlags");
    expect(flags.SKELETAL_DIAGNOSIS_ENABLED).toBe(true);
    expect(flags.GOOGLE_REVIEW_ENABLED).toBe(true);
    expect(flags.LANGUAGE_SWITCHER_ENABLED).toBe(true);
  });
});

describe("Google口コミ依頼セクション（TrainerGymSettings）", () => {
  const tenantRef = { current: null as unknown };

  const setup = async () => {
    vi.doMock("@/hooks/useTenant", () => ({
      useTenant: () => ({ tenant: tenantRef.current, membership: null, role: "owner", plans: [], loading: false, refetch: vi.fn() }),
    }));
    vi.doMock("@/hooks/useProfile", () => ({
      useProfile: () => ({ profile: { user_id: "u1", display_name: "テストトレーナー" }, loading: false, refetch: vi.fn() }),
    }));
    vi.doMock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: null, loading: false }) }));
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: {
        from: () => ({
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        }),
        storage: { from: () => ({ list: () => Promise.resolve({ data: [] }), remove: () => Promise.resolve({}) }) },
        auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
      },
    }));
    const stub = (name: string) => ({ default: () => <div data-testid={name} /> });
    vi.doMock("@/components/trainer/InviteCodeCard", () => stub("invite-code-card"));
    vi.doMock("@/components/trainer/TrialLinkCard", () => stub("trial-link-card"));
    vi.doMock("@/components/trainer/TrainerStaffManager", () => stub("staff-manager"));
    vi.doMock("@/components/trainer/TrainerPlanManager", () => stub("plan-manager"));
    vi.doMock("@/components/trainer/TrainerBilling", () => stub("billing"));
    vi.doMock("@/components/trainer/TrainerHelpGuide", () => stub("help-guide"));
    vi.doMock("@/components/DeleteAccountButton", () => stub("delete-account"));
    // 同上（useTenantStaff の .in がモックに無いと effect で投げる）
    vi.doMock("@/components/trainer/GymOwnershipActions", () => stub("gym-ownership"));
    // 同上（operator_feedback の .order/.limit がモックに無いと effect で投げる）
    vi.doMock("@/components/trainer/OperatorFeedback", () => stub("operator-feedback"));
    // シフト（useTenantStaff の .in）とアンケート（booking_questions の .order）も
    // マウント時に Supabase を叩く。stub しないと effect 内の TypeError が
    //「Tests は全部 passed、Errors N件」→ exit 1 になる。
    vi.doMock("@/components/trainer/TrainerStaffSchedule", () => stub("staff-schedule"));
    vi.doMock("@/components/trainer/TrainerBookingQuestions", () => stub("booking-questions"));
    vi.doMock("@/components/trainer/TrainerBookingLimits", () => stub("booking-limits"));
    vi.doMock("@/components/trainer/TrainerCapacityWindows", () => stub("capacity-windows"));
    vi.doMock("@/components/trainer/TrainerBlockedWindows", () => stub("blocked-windows"));
    vi.doMock("@/components/LanguageSwitcher", () => stub("language-switcher"));
    vi.doMock("@/components/ThemeColorSwitcher", () => stub("theme-color-switcher"));
    vi.doMock("@/components/BackgroundImagePicker", () => stub("background-image-picker"));
    const { normalizeTenantRow } = await import("@/lib/tenantColumns");
    tenantRef.current = normalizeTenantRow({
      id: "t1",
      gym_name: "テストジム",
      operating_hours: { start: "09:00", end: "21:00" },
      slot_duration_minutes: 60,
    });
    const { default: TrainerGymSettings } = await import("@/components/trainer/TrainerGymSettings");
    render(<TrainerGymSettings onSignOut={() => {}} />);
  };

  it("GOOGLE_REVIEW_ENABLED=true でセクションが出る", async () => {
    // 実フラグに依存させない。フォークが false にしていてもこのテストは意味を保つ。
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      GOOGLE_REVIEW_ENABLED: true,
    }));
    await setup();
    // 2026-08-23 のカテゴリー分けで「基本情報」の下に移動した
    fireEvent.click(screen.getByText(i18n.t("settings.trainer.cat.profile")));
    expect(screen.getByText(i18n.t("settings.trainer.googleReviewSection"))).toBeTruthy();
  });

  it("GOOGLE_REVIEW_ENABLED=false でセクションが消える", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      GOOGLE_REVIEW_ENABLED: false,
    }));
    await setup();
    fireEvent.click(screen.getByText(i18n.t("settings.trainer.cat.profile")));
    expect(screen.queryByText(i18n.t("settings.trainer.googleReviewSection"))).toBeNull();
  });

  it("LANGUAGE_SWITCHER_ENABLED=true で言語切替が出る", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      LANGUAGE_SWITCHER_ENABLED: true,
    }));
    await setup();
    // 2026-08-23 のカテゴリー分けで「表示・テーマ」の下に移動した
    fireEvent.click(screen.getByText(i18n.t("settings.trainer.cat.display")));
    expect(screen.getByTestId("language-switcher")).toBeTruthy();
  });

  it("LANGUAGE_SWITCHER_ENABLED=false で言語切替が消える", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      LANGUAGE_SWITCHER_ENABLED: false,
    }));
    await setup();
    fireEvent.click(screen.getByText(i18n.t("settings.trainer.cat.display")));
    expect(screen.queryByTestId("language-switcher")).toBeNull();
  });
});
