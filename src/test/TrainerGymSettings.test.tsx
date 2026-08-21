import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import type { Tenant } from "@/hooks/useTenant";
import { normalizeTenantRow } from "@/lib/tenantColumns";
import {
  DASHBOARD_SECTION_TOGGLES,
  DASHBOARD_STAT_TOGGLES,
  GYM_DISPLAY_PRESETS,
  NAV_TAB_TOGGLES,
  detectPreset,
  presetToValues,
} from "@/lib/gymDisplaySettings";
import i18n from "@/lib/i18n";
import { TRIAL_BOOKING_ENABLED } from "@/lib/featureFlags";

// ジム設定画面の構造テスト。
// gymDisplaySettings.test.ts は「定義」を、TrainerSidebar.test.tsx は「反映先」を見ている。
// ここは間の「設定画面にトグルが出るか」を見る。3つ揃って初めて
// 「定義したのに設定に出てこない」「設定にあるのに効かない」の両方を塞げる。
//
// カテゴリー別アコーディオンは一度導入したが、オーナーの意向で撤回し
// 1本の縦並びリストに戻した（2026-07-26）。招待コードが最上部にあることは
// 引き続き担保する。

const tenantRef = { current: null as Tenant | null };
const refetchTenant = vi.fn();
const tenantUpdates: Record<string, unknown>[] = [];

vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({
    tenant: tenantRef.current,
    membership: null,
    role: "owner",
    plans: [],
    loading: false,
    refetch: refetchTenant,
  }),
}));
vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ profile: { user_id: "u1", display_name: "テストトレーナー" }, loading: false, refetch: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: null, loading: false }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const update = (values: Record<string, unknown>) => {
    tenantUpdates.push(values);
    return { eq: () => Promise.resolve({ error: null }) };
  };
  return {
    supabase: {
      from: () => ({
        update,
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
      storage: { from: () => ({ list: () => Promise.resolve({ data: [] }), remove: () => Promise.resolve({}) }) },
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    },
  };
});

// 画面構造の検証が目的なので、Supabase を叩く重い子コンポーネントは差し替える。
// 招待コードは「どこに置かれているか」が検証対象なので、位置が分かる目印にする。
vi.mock("@/components/trainer/InviteCodeCard", () => ({
  default: () => <div data-testid="invite-code-card">招待コード</div>,
}));
const stub = (name: string) => ({ default: () => <div data-testid={name} /> });
vi.mock("@/components/trainer/TrialLinkCard", () => stub("trial-link-card"));
vi.mock("@/components/trainer/TrainerStaffManager", () => stub("staff-manager"));
vi.mock("@/components/trainer/TrainerPlanManager", () => stub("plan-manager"));
vi.mock("@/components/trainer/TrainerBilling", () => stub("billing"));
vi.mock("@/components/trainer/TrainerHelpGuide", () => stub("help-guide"));
vi.mock("@/components/DeleteAccountButton", () => stub("delete-account"));
// オーナー用の引き継ぎ／閉店は useTenantStaff を引く（.in を使う）。
// stub しないと **effect の中で TypeError が投げられ**、vitest は
//「Tests は全部 passed、Errors N件」で exit 1 になる（CLAUDE.md 参照）。
vi.mock("@/components/trainer/GymOwnershipActions", () => stub("gym-ownership"));
// 運営への要望はマウント時に operator_feedback を読む（.order/.limit を使う）。
// stub しないと同じ形で Errors N件 / exit 1 になる。
vi.mock("@/components/trainer/OperatorFeedback", () => stub("operator-feedback"));
// スタッフのシフトは useTenantStaff（.in を使う）と staff_schedules を読む。
// 事前アンケートは booking_questions を読む（.order を使う）。どちらも stub しないと
// 同じ形で「Tests は全部 passed、Errors N件」→ exit 1 になる。
vi.mock("@/components/trainer/TrainerStaffSchedule", () => stub("staff-schedule"));
vi.mock("@/components/trainer/TrainerBookingQuestions", () => stub("booking-questions"));
vi.mock("@/components/trainer/TrainerBookingLimits", () => stub("booking-limits"));
vi.mock("@/components/trainer/TrainerCapacityWindows", () => stub("capacity-windows"));
vi.mock("@/components/trainer/TrainerBlockedWindows", () => stub("blocked-windows"));
vi.mock("@/components/LanguageSwitcher", () => stub("language-switcher"));
vi.mock("@/components/ThemeColorSwitcher", () => stub("theme-color-switcher"));
vi.mock("@/components/BackgroundImagePicker", () => stub("background-image-picker"));

const TrainerGymSettings = (await import("@/components/trainer/TrainerGymSettings")).default;

const ALL_TOGGLES = [...DASHBOARD_STAT_TOGGLES, ...DASHBOARD_SECTION_TOGGLES, ...NAV_TAB_TOGGLES];
// TRIAL_BOOKING_ENABLED=false のフォークでは、体験フォロー関連の2行は
// ジムのトグル値に関わらず設定画面ごと出ない（TrainerGymSettings.tsx側でフィルタ済み）。
// 画面に「実際に出る」件数を見るテストはこちらを使う。
const VISIBLE_TOGGLES = ALL_TOGGLES.filter(
  ({ column }) => TRIAL_BOOKING_ENABLED || (column !== "show_trial_followup_alert" && column !== "show_nav_trial_followups"),
);

const makeTenant = (overrides: Record<string, unknown> = {}): Tenant =>
  normalizeTenantRow({
    id: "t1",
    gym_name: "テストジム",
    operating_hours: { start: "09:00", end: "21:00" },
    slot_duration_minutes: 60,
    ...overrides,
  }) as unknown as Tenant;

// 実行順で言語がぶれないよう固定する（期待値は i18n.t で引くので言語非依存だが、
// 失敗時のメッセージが読めるように日本語にしておく）
beforeAll(async () => {
  await i18n.changeLanguage("ja");
});

beforeEach(() => {
  cleanup();
  tenantUpdates.length = 0;
  refetchTenant.mockClear();
  tenantRef.current = makeTenant();
});

describe("TrainerGymSettings（設定画面の構造）", () => {
  it("招待コードが最上部（他のカードより前）に表示される", () => {
    // お客様の招待に日常的に使うため、画面を開いてすぐ使えること（オーナー要望）
    render(<TrainerGymSettings onSignOut={vi.fn()} />);
    const invite = screen.getByTestId("invite-code-card");
    if (!TRIAL_BOOKING_ENABLED) {
      // フォークでフラグがOFFなら体験予約リンクカード自体が無いので、比較対象を持たない
      expect(screen.queryByTestId("trial-link-card")).toBeNull();
      return;
    }
    const trialLink = screen.getByTestId("trial-link-card");
    // DOM 上で招待コードが先 = 画面上でより上
    expect(invite.compareDocumentPosition(trialLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("カテゴリーのアコーディオンで折りたたまれず、全項目が最初から見えている", () => {
    // カテゴリー別アコーディオンは一度導入したが撤回した。開閉操作なしで
    // 表示設定のトグルが見えることを担保する。
    render(<TrainerGymSettings onSignOut={vi.fn()} />);
    expect(screen.getByText(i18n.t("settings.trainer.displaySection"))).toBeTruthy();
    expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(VISIBLE_TOGGLES.length);
  });

  it("定義済みの表示トグルが全て出る（体験予約関連はTRIAL_BOOKING_ENABLEDに従う）", () => {
    // ここが落ちる = gymDisplaySettings に足したのに設定画面へ出し忘れている
    render(<TrainerGymSettings onSignOut={vi.fn()} />);

    expect(ALL_TOGGLES.length).toBe(17);
    for (const { column, labelKey } of ALL_TOGGLES) {
      const isTrialRow = column === "show_trial_followup_alert" || column === "show_nav_trial_followups";
      if (isTrialRow && !TRIAL_BOOKING_ENABLED) {
        expect(screen.queryByText(i18n.t(labelKey)), `${i18n.t(labelKey)} が出ている（TRIAL_BOOKING_ENABLED=false のはず）`).toBeNull();
        continue;
      }
      // 同じ文言が画面の別の場所にも出ることがあるため getAllByText で「1つ以上ある」を見る
      expect(screen.getAllByText(i18n.t(labelKey)).length, `${i18n.t(labelKey)} のトグルが無い`).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(VISIBLE_TOGGLES.length);
  });

  it("トグルの初期状態がテナントの設定値どおりになる", () => {
    tenantRef.current = makeTenant({ show_nav_messages: false });
    render(<TrainerGymSettings onSignOut={vi.fn()} />);

    const row = screen.getByText(i18n.t("trainerNav.messages")).closest("div")!;
    expect(within(row).getByRole("switch").getAttribute("aria-checked")).toBe("false");

    const onRow = screen.getByText(i18n.t("trainerNav.exercises")).closest("div")!;
    expect(within(onRow).getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("表示量プリセットの3ボタンが出て、今の設定に一致するものが選択状態になる", () => {
    render(<TrainerGymSettings onSignOut={vi.fn()} />);
    for (const preset of GYM_DISPLAY_PRESETS) {
      expect(
        screen.getByText(i18n.t(`settings.trainer.displayPreset.${preset}`)),
        `${preset} のボタンが無い`,
      ).toBeTruthy();
    }
    // makeTenant は全項目 true（＝DBの既定と同じ）なので full が選ばれている
    expect(detectPreset(tenantRef.current)).toBe("full");
  });

  it("プリセットを押すと17項目をまとめて保存する", async () => {
    // 1項目ずつ17回 update する実装だと、途中で失敗したとき中途半端な状態が残る
    render(<TrainerGymSettings onSignOut={vi.fn()} />);

    fireEvent.click(screen.getByText(i18n.t("settings.trainer.displayPreset.simple")));

    await waitFor(() => expect(tenantUpdates).toHaveLength(1));
    expect(tenantUpdates[0]).toEqual(presetToValues("simple"));
    expect(Object.keys(tenantUpdates[0])).toHaveLength(ALL_TOGGLES.length);
    await waitFor(() => expect(refetchTenant).toHaveBeenCalled());
  });

  it("トグルを切ると、その列だけを tenants に保存して再取得する", async () => {
    // ここが落ちる = スイッチは動くのに保存されない / 別の列を書き換えている
    render(<TrainerGymSettings onSignOut={vi.fn()} />);

    const row = screen.getByText(i18n.t("trainerNav.messages")).closest("div")!;
    fireEvent.click(within(row).getByRole("switch"));

    await waitFor(() => expect(tenantUpdates).toHaveLength(1));
    expect(tenantUpdates[0]).toEqual({ show_nav_messages: false });
    await waitFor(() => expect(refetchTenant).toHaveBeenCalled());
  });
});
