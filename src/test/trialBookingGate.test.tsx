import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import { upstreamOnly } from "./helpers/upstream";
import type { Tenant } from "@/hooks/useTenant";

// TRIAL_BOOKING_ENABLED（src/lib/featureFlags.ts）の回帰テスト。
//
// 体験予約はジム特有の集客手法で、他業種の兄弟アプリでは丸ごと落とせるようにしてある。
// フラグを false にしても trial_bookings のデータ・Edge Function（trial-book /
// trial-cancel / send-trial-reminders）・DBは一切削除しない。ここで見るのは
// 「フロント側の表示・導線・RPC呼び出しが実際に消えるか」だけ。

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("@/lib/featureFlags");
});

describe("フラグが公開されている", () => {
  it("boolean として公開されている", async () => {
    const flags = (await import("@/lib/featureFlags")) as unknown as Record<string, unknown>;
    expect(typeof flags.TRIAL_BOOKING_ENABLED).toBe("boolean");
  });
});

upstreamOnly("ジムボード本体の既定値", () => {
  it("既定 true（従来どおりの挙動）", async () => {
    const flags = await import("@/lib/featureFlags");
    expect(flags.TRIAL_BOOKING_ENABLED).toBe(true);
  });
});

describe("isNavTabVisible: trial-followups タブはフラグとジムごとのトグルのANDで決まる", () => {
  const tenantWith = (patch: Record<string, boolean>) => ({ id: "t1", ...patch }) as unknown as Tenant;

  it("TRIAL_BOOKING_ENABLED=false なら、ジム側の表示トグルが true でも消える", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      TRIAL_BOOKING_ENABLED: false,
    }));
    const { isNavTabVisible } = await import("@/lib/gymDisplaySettings");
    expect(isNavTabVisible(tenantWith({ show_nav_trial_followups: true }), "trial-followups")).toBe(false);
  });

  it("TRIAL_BOOKING_ENABLED=true なら、ジム側の表示トグルどおりに従う（既存の挙動）", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      TRIAL_BOOKING_ENABLED: true,
    }));
    const { isNavTabVisible } = await import("@/lib/gymDisplaySettings");
    expect(isNavTabVisible(tenantWith({ show_nav_trial_followups: true }), "trial-followups")).toBe(true);
    expect(isNavTabVisible(tenantWith({ show_nav_trial_followups: false }), "trial-followups")).toBe(false);
  });

  it("他のタブは巻き添えにならない", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      TRIAL_BOOKING_ENABLED: false,
    }));
    const { isNavTabVisible } = await import("@/lib/gymDisplaySettings");
    expect(isNavTabVisible(tenantWith({}), "messages")).toBe(true);
    expect(isNavTabVisible(tenantWith({}), "exercises")).toBe(true);
  });
});

describe("TrainerGymSettings: 体験予約関連セクション", () => {
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

  it("TRIAL_BOOKING_ENABLED=true でリンクカード・案内文セクションが出る", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      TRIAL_BOOKING_ENABLED: true,
    }));
    await setup();
    expect(screen.getByTestId("trial-link-card")).toBeTruthy();
    expect(screen.getByText(i18n.t("settings.trainer.trialPageSection"))).toBeTruthy();
  });

  it("TRIAL_BOOKING_ENABLED=false でリンクカード・案内文セクションが消える", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      TRIAL_BOOKING_ENABLED: false,
    }));
    await setup();
    expect(screen.queryByTestId("trial-link-card")).toBeNull();
    expect(screen.queryByText(i18n.t("settings.trainer.trialPageSection"))).toBeNull();
  });

  it("TRIAL_BOOKING_ENABLED=false で表示設定の体験フォロー関連トグル行も消える", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      TRIAL_BOOKING_ENABLED: false,
    }));
    await setup();
    expect(screen.queryByText(i18n.t("settings.trainer.displayTrialFollowUp"))).toBeNull();
    expect(screen.queryByText(i18n.t("trainerNav.trialFollowUps"))).toBeNull();
  });
});

describe("TrialBooking ページ: フラグ経由で公開フォームの代わりに案内を出す", () => {
  const setupTrialBooking = async (enabled: boolean) => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      TRIAL_BOOKING_ENABLED: enabled,
    }));
    const rpcSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    const invokeSpy = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { rpc: rpcSpy, functions: { invoke: invokeSpy } },
    }));
    const { default: TrialBooking } = await import("@/pages/TrialBooking");
    render(
      <MemoryRouter initialEntries={["/trial/t1"]}>
        <Routes>
          <Route path="/trial/:tenantId" element={<TrialBooking />} />
        </Routes>
      </MemoryRouter>,
    );
    return { rpcSpy, invokeSpy };
  };

  it("false: 案内メッセージを表示し、テナント取得RPCを呼ばない", async () => {
    const { rpcSpy } = await setupTrialBooking(false);
    expect(screen.getByText(i18n.t("trialBooking.notAvailableTitle"))).toBeTruthy();
    expect(screen.getByText(i18n.t("trialBooking.notAvailableBody"))).toBeTruthy();
    // 予約フォームの入力欄が出ていない
    expect(screen.queryByLabelText(i18n.t("trialBooking.labelName"))).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("true: 従来どおりテナント取得RPCを呼ぶ（フォームを表示する経路のまま）", async () => {
    const { rpcSpy } = await setupTrialBooking(true);
    expect(screen.queryByText(i18n.t("trialBooking.notAvailableTitle"))).toBeNull();
    await waitFor(() => expect(rpcSpy).toHaveBeenCalled());
  });
});

describe("TrialCancel ページ: フラグ経由で公開フォームの代わりに案内を出す", () => {
  it("false: 案内メッセージを表示し、キャンセル情報取得を呼ばない", async () => {
    vi.doMock("@/lib/featureFlags", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      TRIAL_BOOKING_ENABLED: false,
    }));
    const invokeSpy = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { functions: { invoke: invokeSpy } },
    }));
    const { default: TrialCancel } = await import("@/pages/TrialCancel");
    render(
      <MemoryRouter initialEntries={["/trial-cancel/tok123"]}>
        <Routes>
          <Route path="/trial-cancel/:token" element={<TrialCancel />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(i18n.t("trialBooking.notAvailableTitle"))).toBeTruthy();
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});

describe("notAvailableTitle/notAvailableBody の5言語そろい", () => {
  const LANGS = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
  const trialBookingOf = (l: string) =>
    JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8")).trialBooking as Record<string, string>;

  it("5言語全てにキーがあり、日本語のままコピーされていない", () => {
    const ja = trialBookingOf("ja");
    for (const key of ["notAvailableTitle", "notAvailableBody"]) {
      expect(ja[key], `ja.json に trialBooking.${key} が無い`).toBeTruthy();
      for (const l of LANGS.filter((x) => x !== "ja")) {
        const val = trialBookingOf(l)[key];
        expect(val, `${l}.json に trialBooking.${key} が無い`).toBeTruthy();
        expect(val, `${l}.json の trialBooking.${key} が未翻訳`).not.toBe(ja[key]);
      }
    }
  });
});
