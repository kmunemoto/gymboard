import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import type { Tenant } from "@/hooks/useTenant";
import { normalizeTenantRow } from "@/lib/tenantColumns";
import {
  DASHBOARD_SECTION_TOGGLES,
  DASHBOARD_STAT_TOGGLES,
  NAV_TAB_TOGGLES,
} from "@/lib/gymDisplaySettings";
import i18n from "@/lib/i18n";

// ジム設定画面の構造テスト。
// gymDisplaySettings.test.ts は「定義」を、TrainerSidebar.test.tsx は「反映先」を見ている。
// ここは間の「設定画面にトグルが出るか」を見る。3つ揃って初めて
// 「定義したのに設定に出てこない」「設定にあるのに効かない」の両方を塞げる。
//
// 併せて、オーナーの明示的な要望である「招待コードはカテゴリーにしまわず最上部」も担保する。

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
vi.mock("@/components/trainer/TrainerPlanManager", () => stub("plan-manager"));
vi.mock("@/components/trainer/TrainerBilling", () => stub("billing"));
vi.mock("@/components/trainer/TrainerHelpGuide", () => stub("help-guide"));
vi.mock("@/components/DeleteAccountButton", () => stub("delete-account"));
vi.mock("@/components/LanguageSwitcher", () => stub("language-switcher"));
vi.mock("@/components/ThemeColorSwitcher", () => stub("theme-color-switcher"));
vi.mock("@/components/BackgroundImagePicker", () => stub("background-image-picker"));

const TrainerGymSettings = (await import("@/components/trainer/TrainerGymSettings")).default;

const ALL_TOGGLES = [...DASHBOARD_STAT_TOGGLES, ...DASHBOARD_SECTION_TOGGLES, ...NAV_TAB_TOGGLES];

const makeTenant = (overrides: Record<string, unknown> = {}): Tenant =>
  normalizeTenantRow({
    id: "t1",
    gym_name: "テストジム",
    operating_hours: { start: "09:00", end: "21:00" },
    slot_duration_minutes: 60,
    ...overrides,
  }) as unknown as Tenant;

/** アコーディオンのカテゴリーを開く */
const openCategory = (title: string) => fireEvent.click(screen.getByRole("button", { name: title }));

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
  it("招待コードはアコーディオンの外・最上部に常時表示される", () => {
    // お客様の招待に日常的に使うため、カテゴリーを開かずに使えること（オーナー要望）
    const { container } = render(<TrainerGymSettings onSignOut={vi.fn()} />);
    const invite = screen.getByTestId("invite-code-card");
    const accordion = container.querySelector("[data-orientation]");
    expect(accordion, "アコーディオンが見つからない").not.toBeNull();
    expect(accordion!.contains(invite), "招待コードがアコーディオンの中に入っている").toBe(false);
    // DOM 上でアコーディオンより前 = 画面上でより上
    expect(invite.compareDocumentPosition(accordion!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("6つのカテゴリーが全て出る", () => {
    render(<TrainerGymSettings onSignOut={vi.fn()} />);
    for (const key of ["catGymInfo", "catBooking", "catGrowth", "catAppearance", "catNotifications", "catAccount"]) {
      const title = i18n.t(`settings.trainer.${key}`);
      expect(screen.getByRole("button", { name: title }), `${title} が無い`).toBeTruthy();
    }
  });

  it("既定では全カテゴリーが閉じていて、中身は出ていない", () => {
    // 項目が増えすぎて探しにくい問題への対処なので、開いた状態で始まってはいけない
    render(<TrainerGymSettings onSignOut={vi.fn()} />);
    expect(screen.queryByText(i18n.t("settings.trainer.displaySection"))).toBeNull();
  });

  it("「表示・デザイン」を開くと、定義済みの表示トグルが全て出る", () => {
    // ここが落ちる = gymDisplaySettings に足したのに設定画面へ出し忘れている
    render(<TrainerGymSettings onSignOut={vi.fn()} />);
    openCategory(i18n.t("settings.trainer.catAppearance"));

    expect(ALL_TOGGLES.length).toBe(17);
    for (const { labelKey } of ALL_TOGGLES) {
      // 同じ文言が画面の別の場所にも出ることがあるため getAllByText で「1つ以上ある」を見る
      expect(screen.getAllByText(i18n.t(labelKey)).length, `${i18n.t(labelKey)} のトグルが無い`).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(ALL_TOGGLES.length);
  });

  it("トグルの初期状態がテナントの設定値どおりになる", () => {
    tenantRef.current = makeTenant({ show_nav_messages: false });
    render(<TrainerGymSettings onSignOut={vi.fn()} />);
    openCategory(i18n.t("settings.trainer.catAppearance"));

    const row = screen.getByText(i18n.t("trainerNav.messages")).closest("div")!;
    expect(within(row).getByRole("switch").getAttribute("aria-checked")).toBe("false");

    const onRow = screen.getByText(i18n.t("trainerNav.exercises")).closest("div")!;
    expect(within(onRow).getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("トグルを切ると、その列だけを tenants に保存して再取得する", async () => {
    // ここが落ちる = スイッチは動くのに保存されない / 別の列を書き換えている
    render(<TrainerGymSettings onSignOut={vi.fn()} />);
    openCategory(i18n.t("settings.trainer.catAppearance"));

    const row = screen.getByText(i18n.t("trainerNav.messages")).closest("div")!;
    fireEvent.click(within(row).getByRole("switch"));

    await waitFor(() => expect(tenantUpdates).toHaveLength(1));
    expect(tenantUpdates[0]).toEqual({ show_nav_messages: false });
    await waitFor(() => expect(refetchTenant).toHaveBeenCalled());
  });
});
