import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Tenant } from "@/hooks/useTenant";
import { normalizeTenantRow } from "@/lib/tenantColumns";
import TrainerSidebar from "@/components/trainer/TrainerSidebar";
import i18n from "@/lib/i18n";
import { TRIAL_BOOKING_ENABLED } from "@/lib/featureFlags";

// ジム側の表示ON/OFFは gymDisplaySettings.test.ts で純粋関数として検証済みだが、
// 「設定どおりに実際のメニューが描画されるか」は誰も検証していなかった。
// 特に **ホーム・顧客・予約・設定は絶対に消えてはいけない**（設定が消えると
// 設定画面に戻れず、ジム自身が元に戻せなくなる）。この不変条件を描画レベルで担保する。
//
// jsdom は CSS を評価しないため、デスクトップ用サイドバーとモバイル用下部ナビの
// 両方が同時にDOMに出る。ラベルが異なるので、それぞれのラベルで確認する。

const tenantRef = { current: null as Tenant | null };
vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({
    tenant: tenantRef.current,
    membership: null,
    role: "owner",
    plans: [],
    loading: false,
    refetch: vi.fn(),
  }),
}));

/** 隠せないタブ（デスクトップ表記 / モバイル表記） */
const CORE_TABS = [
  [i18n.t("trainerNav.dashboard"), i18n.t("trainerNav.mDashboard")],
  [i18n.t("trainerNav.clients"), i18n.t("trainerNav.mClients")],
  [i18n.t("trainerNav.schedule"), i18n.t("trainerNav.mSchedule")],
  [i18n.t("trainerNav.gymSettings"), i18n.t("trainerNav.mGymSettings")],
];

/** ジム設定でOFFにできるタブ（モバイル下部ナビに無いものは null） */
const OPTIONAL_TABS: { column: string; desktop: string; mobile: string | null }[] = [
  { column: "show_nav_messages", desktop: i18n.t("trainerNav.messages"), mobile: null },
  { column: "show_nav_exercises", desktop: i18n.t("trainerNav.exercises"), mobile: i18n.t("trainerNav.mExercises") },
  { column: "show_nav_counseling", desktop: i18n.t("trainerNav.counseling"), mobile: null },
  { column: "show_nav_announcements", desktop: i18n.t("trainerNav.announcements"), mobile: i18n.t("trainerNav.mAnnouncements") },
  { column: "show_nav_notifications", desktop: i18n.t("trainerNav.notifications"), mobile: i18n.t("trainerNav.mNotifications") },
  { column: "show_nav_trial_followups", desktop: i18n.t("trainerNav.trialFollowUps"), mobile: null },
];

/** raw な列値からテナントを作る（既定値の穴埋めは本番と同じ normalizeTenantRow を通す） */
const makeTenant = (overrides: Record<string, unknown> = {}): Tenant =>
  normalizeTenantRow({ id: "t1", gym_name: "テストジム", ...overrides }) as unknown as Tenant;

/** メニューに出ているタブ名の集合（デスクトップ+モバイル） */
const visibleTabLabels = () =>
  new Set(screen.getAllByRole("button").map((b) => b.textContent?.trim() ?? ""));

// 実行順によっては前のテストが残した言語設定(localStorage)や jsdom の
// navigator.language(en-US) で英語に解決される。ラベルを直接書いているので日本語に固定する。
beforeAll(async () => {
  await i18n.changeLanguage("ja");
});

beforeEach(() => {
  cleanup();
  tenantRef.current = null;
});

describe("TrainerSidebar（メニューの表示ON/OFF）", () => {
  it("設定を読み込む前（tenant=null）は全タブを表示する", () => {
    // 読込中に一瞬メニューが減るのを防ぐ。既定は「表示」。
    render(<TrainerSidebar activeTab="dashboard" onTabChange={vi.fn()} />);
    const labels = visibleTabLabels();
    for (const [desktop, mobile] of CORE_TABS) {
      expect(labels, `${desktop} が出ていない`).toContain(desktop);
      expect(labels, `${mobile} が出ていない`).toContain(mobile);
    }
    for (const tab of OPTIONAL_TABS) {
      // trial-followups だけは TRIAL_BOOKING_ENABLED（ビルド時フラグ）とのANDなので、
      // フラグがOFFのフォークではジムのトグルに関わらず最初から出ない。
      const shouldShow = tab.column === "show_nav_trial_followups" ? TRIAL_BOOKING_ENABLED : true;
      if (shouldShow) {
        expect(labels, `${tab.desktop} が出ていない`).toContain(tab.desktop);
      } else {
        expect(labels, `${tab.desktop} が出ている（TRIAL_BOOKING_ENABLED=false のはず）`).not.toContain(tab.desktop);
      }
    }
  });

  it("全トグルをOFFにしても、ホーム・顧客・予約・設定は必ず残る", () => {
    // ここが落ちる = ジムが自分でアプリを操作不能にできてしまう（設定に戻れない）
    tenantRef.current = makeTenant(
      Object.fromEntries(OPTIONAL_TABS.map((t) => [t.column, false])),
    );
    render(<TrainerSidebar activeTab="dashboard" onTabChange={vi.fn()} />);
    const labels = visibleTabLabels();
    for (const [desktop, mobile] of CORE_TABS) {
      expect(labels, `${desktop} が消えた`).toContain(desktop);
      expect(labels, `${mobile} が消えた`).toContain(mobile);
    }
    for (const tab of OPTIONAL_TABS) {
      expect(labels, `${tab.desktop} が消えていない`).not.toContain(tab.desktop);
      if (tab.mobile) expect(labels, `${tab.mobile} が消えていない`).not.toContain(tab.mobile);
    }
  });

  it("トグルは1つずつ独立して効く", () => {
    for (const target of OPTIONAL_TABS) {
      cleanup();
      tenantRef.current = makeTenant({ [target.column]: false });
      render(<TrainerSidebar activeTab="dashboard" onTabChange={vi.fn()} />);
      const labels = visibleTabLabels();
      expect(labels, `${target.desktop} をOFFにしたのに残っている`).not.toContain(target.desktop);
      for (const other of OPTIONAL_TABS) {
        if (other.column === target.column) continue;
        // trial-followups は TRIAL_BOOKING_ENABLED が false のフォークでは、
        // 他のトグルの状態に関わらずそもそも出ない（上と同じ理由）。
        const otherShouldShow = other.column === "show_nav_trial_followups" ? TRIAL_BOOKING_ENABLED : true;
        if (otherShouldShow) {
          expect(labels, `${target.desktop} のOFFで ${other.desktop} まで消えた`).toContain(other.desktop);
        } else {
          expect(labels, `${other.desktop} が出ている（TRIAL_BOOKING_ENABLED=false のはず）`).not.toContain(other.desktop);
        }
      }
    }
  });

  it("OFFにしたタブを開いている間は、そのタブだけメニューに残る", () => {
    // 他画面から遷移してきた場合に、今いる場所がメニューから消えて迷子になるのを防ぐ
    tenantRef.current = makeTenant({ show_nav_messages: false });
    render(<TrainerSidebar activeTab="messages" onTabChange={vi.fn()} />);
    expect(visibleTabLabels()).toContain(i18n.t("trainerNav.messages"));
  });

  it("タブを押すと onTabChange にそのタブIDが渡る", () => {
    const onTabChange = vi.fn();
    tenantRef.current = makeTenant();
    render(<TrainerSidebar activeTab="dashboard" onTabChange={onTabChange} />);
    fireEvent.click(screen.getAllByRole("button", { name: i18n.t("trainerNav.clients") })[0]);
    expect(onTabChange).toHaveBeenCalledWith("clients");
  });

  it("未読件数はバッジとして出る（0件のタブには出ない）", () => {
    tenantRef.current = makeTenant();
    render(
      <TrainerSidebar activeTab="dashboard" onTabChange={vi.fn()} unreadMessages={3} unreadCounseling={0} />,
    );
    const messages = i18n.t("trainerNav.messages");
    const counseling = i18n.t("trainerNav.counseling");
    expect(screen.getByRole("button", { name: new RegExp(messages) }).textContent).toContain("3");
    expect(screen.getByRole("button", { name: new RegExp(counseling) }).textContent).toBe(counseling);
  });
});
