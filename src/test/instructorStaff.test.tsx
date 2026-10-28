/**
 * インストラクター（制限付きスタッフ・tenant_members.staff_access = 'limited'・2026-10-28）。
 *
 * 宗本さん（パーソナルピラティスの先生に来てもらう）:
 *   「お店の設定とか触らせたくないので、お店にログインできるということだけにさせたい。
 *    お知らせ・動画・設定は触らせないようにして、オーナーとは完全に分けてほしい。
 *    お客さんの削除もできないようにしてほしい。これはオーナーだけができるように」
 *
 * 🔴 壊しやすいもの:
 *   1. 店宛ての通知の「代表」がインストラクターに移る
 *      → オーナーに届いていたメール・お客様のチャットが先生に行ってしまう
 *      （代表はオーナーが先頭。2026-10-28 に trainer 優先から改めた・notifiableStaffOrder）
 *   2. 画面だけ隠して DB が通す（隠すのは使い勝手のため。止めているのは DB）
 *   3. 制限を読むために「読む」側まで止める（予約・顧客・記録が見えなくなる）
 *   4. 権限を今まで通りのスタッフが自分で戻せる（オーナーだけが変えられること）
 *   5. スタッフの招待コードがお客様から読める（2026-10-28 に本番で見つけて塞いだ）
 *   6. 列の無い環境で、スタッフ一覧・通知の宛先の読み込みごと落ちる
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import type { Tenant } from "@/hooks/useTenant";
import { normalizeTenantRow } from "@/lib/tenantColumns";
import {
  LIMITED_HIDDEN_TABS, canOpenTab, isLimitedStaffRole, notifiableStaff, parseStaffAccess, withAssignedStaff,
} from "@/lib/staffAccess";
import { fetchTenantStaff, type TenantStaff } from "@/lib/tenantStaff";
import type { BookingMenu } from "@/lib/bookingMenus";
import { fetchMyTenantStaffIds } from "@/lib/tenantHelper";
import TrainerSidebar from "@/components/trainer/TrainerSidebar";
import StaffAccountSettings from "@/components/trainer/StaffAccountSettings";
import TrainerStaffManager from "@/components/trainer/TrainerStaffManager";
import DayReceptionToggle from "@/components/trainer/DayReceptionToggle";
import MemberInfoCard from "@/components/trainer/clientDetail/MemberInfoCard";

// ── モック ─────────────────────────────────────────────────────────────
const db = {
  rpc: {} as Record<string, { data: unknown; error: unknown }>,
  rpcCalls: [] as string[],
  /** tenant_members の SELECT が返す行（並びは DB の joined_at 昇順のつもりで書く） */
  members: [] as Record<string, unknown>[],
  /** staff_access 列がまだ無い環境 */
  noStaffAccessColumn: false,
  selects: [] as string[],
  updates: [] as { values: unknown; filters: Record<string, unknown> }[],
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "me" } } } }) },
    rpc: (name: string) => {
      db.rpcCalls.push(name);
      return Promise.resolve(db.rpc[name] ?? { data: null, error: null });
    },
    from: () => {
      let cols = "";
      let values: unknown;
      const filters: Record<string, unknown> = {};
      const result = () => {
        if (values !== undefined) {
          db.updates.push({ values, filters: { ...filters } });
          return { data: null, error: null };
        }
        db.selects.push(cols);
        if (cols === "tenant_id") return { data: { tenant_id: "t1" }, error: null };
        const wantsAccess = cols.includes("staff_access");
        if (db.noStaffAccessColumn && wantsAccess) {
          return { data: null, error: { code: "42703", message: "column tenant_members.staff_access does not exist" } };
        }
        const rows = wantsAccess
          ? db.members
          : db.members.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "staff_access")));
        return { data: rows, error: null };
      };
      const q: Record<string, unknown> = {
        select: (c: string) => { cols = c; return q; },
        update: (v: unknown) => { values = v; return q; },
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: () => Promise.resolve(result()),
        then: (ok: (r: unknown) => unknown, ng?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ng),
      };
      return q;
    },
  },
}));

const view = {
  tenant: null as Tenant | null,
  isLimitedStaff: false,
  staff: [] as TenantStaff[],
  menus: [] as BookingMenu[],
  user: { id: "owner-1", email: "owner@example.com" } as { id: string; email: string },
};

vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({
    tenant: view.tenant,
    membership: null,
    role: view.isLimitedStaff ? "trainer" : "owner",
    isLimitedStaff: view.isLimitedStaff,
    plans: [],
    loading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useTenantStaff", () => ({
  useTenantStaff: () => ({ staff: view.staff, loading: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useBookingMenus", () => ({
  useBookingMenus: () => ({ menus: view.menus, loading: false, refetch: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: view.user }) }));
vi.mock("@/components/DeleteAccountButton", () => ({ default: () => <div data-testid="delete-account" /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const makeTenant = (overrides: Record<string, unknown> = {}): Tenant =>
  normalizeTenantRow({ id: "t1", gym_name: "テストジム", ...overrides }) as unknown as Tenant;

beforeAll(async () => {
  await i18n.changeLanguage("ja");
});

beforeEach(() => {
  db.rpc = {};
  db.rpcCalls = [];
  db.members = [];
  db.noStaffAccessColumn = false;
  db.selects = [];
  db.updates = [];
  view.tenant = makeTenant();
  view.isLimitedStaff = false;
  view.staff = [];
  view.menus = [];
  view.user = { id: "owner-1", email: "owner@example.com" };
});
afterEach(cleanup);

const read = (path: string) => readFileSync(path, "utf8");
const sql = (path: string) => read(path).replace(/--[^\n]*/g, "");

// ── 判定（src/lib/staffAccess.ts）──────────────────────────────────────────
describe("インストラクターかどうかの判定", () => {
  it("staff_access は limited だけがインストラクター。分からない値は今まで通り（full）", () => {
    expect(parseStaffAccess("limited")).toBe("limited");
    for (const v of ["full", null, undefined, "", "LIMITED", 1]) expect(parseStaffAccess(v)).toBe("full");
  });

  it("インストラクターになるのはスタッフ（trainer）だけ。オーナー・お客様は limited でも違う", () => {
    expect(isLimitedStaffRole("trainer", "limited")).toBe(true);
    expect(isLimitedStaffRole("trainer", "full")).toBe(false);
    expect(isLimitedStaffRole("owner", "limited")).toBe(false);
    expect(isLimitedStaffRole("customer", "limited")).toBe(false);
    expect(isLimitedStaffRole(null, null)).toBe(false);
  });

  it("開けないのはお知らせ・動画だけ。ホーム・顧客・予約・設定（アカウント）は開ける", () => {
    expect([...LIMITED_HIDDEN_TABS].sort()).toEqual(["announcements", "videos"]);
    for (const tab of ["dashboard", "clients", "schedule", "messages", "exercises", "gym-settings"] as const) {
      expect(canOpenTab(tab, true), tab).toBe(true);
    }
    expect(canOpenTab("announcements", true)).toBe(false);
    expect(canOpenTab("videos", true)).toBe(false);
    // オーナー・今まで通りのスタッフは全部開ける
    expect(canOpenTab("announcements", false)).toBe(true);
    expect(canOpenTab("videos", false)).toBe(true);
  });

  it("店宛ての通知からインストラクターを外す。担当の予約だけは届ける", () => {
    const rows = [
      { user_id: "inst", staff_access: "limited" },
      { user_id: "staff", staff_access: "full" },
      { user_id: "old", staff_access: undefined },
    ];
    expect(notifiableStaff(rows).map((r) => r.user_id)).toEqual(["staff", "old"]);
    expect(withAssignedStaff(["owner", "cust"], "inst")).toEqual(["owner", "cust", "inst"]);
    expect(withAssignedStaff(["owner", "inst"], "inst")).toEqual(["owner", "inst"]);
    expect(withAssignedStaff(["owner"], null)).toEqual(["owner"]);
  });
});

// ── 通知の宛先・スタッフ一覧 ─────────────────────────────────────────────
describe("通知の宛先（fetchMyTenantStaffIds）", () => {
  it("🔴 先に参加したインストラクターがいても、代表（先頭）はオーナーのまま", () => {
    // インストラクターは宛先（ids）に入れない。自分が担当の予約の通知だけ別に届ける
    db.members = [
      { user_id: "inst", role: "trainer", joined_at: "2026-10-28", staff_access: "limited" },
      { user_id: "owner", role: "owner", joined_at: "2025-01-01", staff_access: "full" },
    ];
    return expect(fetchMyTenantStaffIds()).resolves.toEqual(["owner"]);
  });

  it("🔴 代表（先頭）はオーナー。今まで通りのスタッフはその後ろ（2026-10-28 に trainer 優先から改めた）", async () => {
    db.members = [
      { user_id: "staff", role: "trainer", joined_at: "2026-01-01", staff_access: "full" },
      { user_id: "inst", role: "trainer", joined_at: "2026-10-28", staff_access: "limited" },
      { user_id: "owner", role: "owner", joined_at: "2025-01-01", staff_access: "full" },
    ];
    expect(await fetchMyTenantStaffIds()).toEqual(["owner", "staff"]);
  });

  it("列の無い環境では列を外して読み直す（全員が宛先＝今まで通り）", async () => {
    db.noStaffAccessColumn = true;
    db.members = [
      { user_id: "staff", role: "trainer", joined_at: "2026-01-01" },
      { user_id: "owner", role: "owner", joined_at: "2025-01-01" },
    ];
    expect(await fetchMyTenantStaffIds()).toEqual(["owner", "staff"]);
    expect(db.selects).toContain("user_id, role, joined_at, display_name, staff_access");
    expect(db.selects).toContain("user_id, role, joined_at, display_name");
  });
});

describe("スタッフ一覧（fetchTenantStaff）", () => {
  it("権限を読む。オーナーは常に full", async () => {
    db.members = [
      { user_id: "owner", role: "owner", display_name: "O", joined_at: "2025-01-01", staff_access: "limited" },
      { user_id: "staff", role: "trainer", display_name: "S", joined_at: "2026-01-01", staff_access: "full" },
      { user_id: "inst", role: "trainer", display_name: "I", joined_at: "2026-10-28", staff_access: "limited" },
    ];
    const staff = await fetchTenantStaff("t1");
    expect(staff.map((s) => [s.user_id, s.access])).toEqual([["owner", "full"], ["staff", "full"], ["inst", "limited"]]);
  });

  it("列の無い環境でも一覧は出る（全員 full）", async () => {
    db.noStaffAccessColumn = true;
    db.members = [
      { user_id: "owner", role: "owner", display_name: "O", joined_at: "2025-01-01" },
      { user_id: "staff", role: "trainer", display_name: "S", joined_at: "2026-01-01" },
    ];
    const staff = await fetchTenantStaff("t1");
    expect(staff.map((s) => [s.user_id, s.access])).toEqual([["owner", "full"], ["staff", "full"]]);
  });
});

// ── 画面 ──────────────────────────────────────────────────────────────
const visibleTabLabels = () => new Set(screen.getAllByRole("button").map((b) => b.textContent?.trim() ?? ""));

describe("メニュー（TrainerSidebar）", () => {
  it("インストラクターにはお知らせ・動画を出さない（今開いていても出さない）。設定は「アカウント」", () => {
    view.isLimitedStaff = true;
    render(<TrainerSidebar activeTab="announcements" onTabChange={vi.fn()} />);
    const labels = visibleTabLabels();
    for (const key of ["announcements", "mAnnouncements", "videos", "mVideos", "gymSettings", "mGymSettings"]) {
      expect(labels, key).not.toContain(i18n.t(`trainerNav.${key}`));
    }
    for (const key of ["dashboard", "clients", "schedule", "account", "mAccount"]) {
      expect(labels, key).toContain(i18n.t(`trainerNav.${key}`));
    }
  });

  it("オーナー・今まで通りのスタッフは今まで通り", () => {
    render(<TrainerSidebar activeTab="dashboard" onTabChange={vi.fn()} />);
    const labels = visibleTabLabels();
    for (const key of ["announcements", "videos", "gymSettings", "mGymSettings"]) {
      expect(labels, key).toContain(i18n.t(`trainerNav.${key}`));
    }
    expect(labels).not.toContain(i18n.t("trainerNav.account"));
  });
});

// 予約メニュー（同じ先生がヨガとマシンピラティスの両方を担当する形・宗本さんのジム）
const MENU_TRAINING: BookingMenu = { id: "m-train", name: "Menu-Training", staff_user_id: null, is_active: true, sort_order: 0 };
const MENU_YOGA: BookingMenu = { id: "m-yoga", name: "Menu-Yoga", staff_user_id: "inst", is_active: true, sort_order: 1 };
const MENU_PILATES: BookingMenu = { id: "m-pilates", name: "Menu-Pilates", staff_user_id: "inst", is_active: true, sort_order: 2 };
const MENU_STRETCH: BookingMenu = { id: "m-stretch", name: "Menu-Stretch", staff_user_id: null, is_active: true, sort_order: 3 };

describe("インストラクターの「アカウント」画面", () => {
  it("ジム名・メール・役割・ログアウト・アカウントの削除だけ", () => {
    view.isLimitedStaff = true;
    view.user = { id: "inst", email: "inst@example.com" };
    const onSignOut = vi.fn();
    render(<StaffAccountSettings onSignOut={onSignOut} />);
    const page = screen.getByTestId("staff-account-settings");
    expect(within(page).getByText(view.tenant!.gym_name)).toBeInTheDocument();
    expect(within(page).getByText("inst@example.com")).toBeInTheDocument();
    expect(within(page).getByText(i18n.t("staff.roleInstructor"))).toBeInTheDocument();
    expect(within(page).getByText(i18n.t("staffAccount.ownerOnly"))).toBeInTheDocument();
    expect(within(page).getByTestId("delete-account")).toBeInTheDocument();
    fireEvent.click(within(page).getByRole("button", { name: i18n.t("settings.logout") }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    // 担当しているメニューが無ければ、その行は出さない
    expect(within(page).queryByTestId("my-menus")).toBeNull();
  });

  it("自分が担当している予約メニューを出す（同じ先生が2つのメニューを持つ組み合わせ・オフのものは出さない）", () => {
    view.isLimitedStaff = true;
    view.user = { id: "inst", email: "inst@example.com" };
    view.menus = [MENU_TRAINING, MENU_YOGA, MENU_PILATES, { ...MENU_STRETCH, staff_user_id: "inst", is_active: false }];
    render(<StaffAccountSettings onSignOut={vi.fn()} />);
    expect(screen.getByTestId("my-menus")).toHaveTextContent(
      i18n.t("staff.menusLabel", { names: [MENU_YOGA.name, MENU_PILATES.name].join("・") }),
    );
  });
});

describe("スタッフ管理（TrainerStaffManager・オーナー）", () => {
  // 「スタッフ」は 2026-10-28 になくした（宗本さん「スタッフいらない」・全部のジム）。
  // ジム側の人はオーナーとインストラクターだけ（trainer は必ず limited）
  const STAFF: TenantStaff[] = [
    { user_id: "owner-1", display_name: "Owner", role: "owner", access: "full" },
    { user_id: "t-1", display_name: "Taro", role: "trainer", access: "limited" },
    { user_id: "i-1", display_name: "Hanako", role: "trainer", access: "limited" },
  ];

  beforeEach(() => {
    view.staff = STAFF;
    db.rpc.get_my_instructor_invite_code = { data: "instcode99", error: null };
    db.rpc.regenerate_instructor_invite_code = { data: "instcode42", error: null };
  });

  it("🔴 招待はインストラクター用だけ。スタッフ用のカードも、スタッフ用のコードの読み込みも無い", async () => {
    render(<TrainerStaffManager />);
    const card = await screen.findByTestId("staff-invite-instructor");
    expect(within(card).getByText("instcode99")).toBeInTheDocument();
    expect(screen.queryByTestId("staff-invite-staff")).toBeNull();
    expect(db.rpcCalls).toEqual(["get_my_instructor_invite_code"]);
  });

  it("🔴 スタッフ⇄インストラクターの切り替えは無い。役割はオーナーとインストラクターだけ", async () => {
    render(<TrainerStaffManager />);
    await screen.findByTestId("staff-invite-instructor");
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.getAllByText(i18n.t("staff.roleInstructor"))).toHaveLength(2);
    expect(screen.getAllByText(i18n.t("staff.roleOwner"))).toHaveLength(1);
    expect(db.updates).toEqual([]);
  });

  it("インストラクターの招待コードを作り直せる（確かめてから）", async () => {
    render(<TrainerStaffManager />);
    await screen.findByTestId("staff-invite-instructor");
    const regenerateButtons = screen.getAllByRole("button", { name: i18n.t("staff.regenerate") });
    fireEvent.click(regenerateButtons[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: i18n.t("staff.regenerate") }));
    await waitFor(() => expect(db.rpcCalls).toContain("regenerate_instructor_invite_code"));
    expect(await screen.findByText("instcode42")).toBeInTheDocument();
  });

  it("スタッフごとに担当している予約メニューを出す（1人が2つのメニューを持つ組み合わせが一目で分かる）", async () => {
    view.menus = [
      MENU_TRAINING,
      { ...MENU_YOGA, staff_user_id: "i-1" },
      { ...MENU_PILATES, staff_user_id: "i-1" },
      { ...MENU_STRETCH, staff_user_id: "t-1", is_active: false },
    ];
    render(<TrainerStaffManager />);
    await screen.findByTestId("staff-invite-instructor");
    // オフのメニュー（Stretch）は数えない＝Taro には出ない。担当のいないメニュー（Training）は誰にも出ない
    const lines = screen.getAllByTestId("staff-menus");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent(i18n.t("staff.menusLabel", { names: "Menu-Yoga・Menu-Pilates" }));
    expect(screen.getByText("Hanako").closest("li")).toContainElement(lines[0]);
  });

  it("オーナーでなければ（コードが返らない）・RPC が無ければ、何も出さない", async () => {
    db.rpc.get_my_instructor_invite_code = { data: null, error: null };
    const { container, unmount } = render(<TrainerStaffManager />);
    await waitFor(() => expect(db.rpcCalls).toHaveLength(1));
    expect(container.innerHTML).toBe("");
    unmount();
    db.rpcCalls = [];
    db.rpc.get_my_instructor_invite_code = { data: null, error: { message: "function not found" } };
    const second = render(<TrainerStaffManager />);
    await waitFor(() => expect(db.rpcCalls).toHaveLength(1));
    expect(second.container.innerHTML).toBe("");
  });
});

describe("インストラクターに押させないボタン", () => {
  it("予定表の「受付を止める・上限を外す」は見せるだけ（DB も断る）", () => {
    const onClose = vi.fn();
    const onLiftCap = vi.fn();
    const props = {
      dateKey: "2026-11-02", bookedCount: 3, dailyLimit: 4, uncapped: false, saving: false,
      onClose, onReopen: vi.fn(), onLiftCap, onRestoreCap: vi.fn(), readOnly: true,
    };
    const { rerender } = render(<DayReceptionToggle {...props} closed={null} />);
    const open = screen.getByRole("button");
    expect(open).toBeDisabled();
    fireEvent.click(open);
    expect(onClose).not.toHaveBeenCalled();

    rerender(<DayReceptionToggle {...props} closed={{ date: "2026-11-02", reason: null, manual: false } as never} />);
    expect(screen.getByRole("button")).toBeDisabled();

    rerender(<DayReceptionToggle {...props} readOnly={false} closed={null} />);
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("カルテの休会・退会はインストラクターに出さない。連絡先の保存は使える", () => {
    const base = {
      clientId: "c1", phone: null, nameKana: null, status: "active",
      suspendedFrom: null, suspendedUntil: null, onChanged: vi.fn(),
    };
    const { rerender } = render(<MemberInfoCard {...base} canManageStatus={false} />);
    expect(screen.queryByText(i18n.t("member.suspend"))).toBeNull();
    expect(screen.queryByText(i18n.t("member.withdraw"))).toBeNull();
    expect(screen.getByText(i18n.t("member.saveContact"))).toBeInTheDocument();

    rerender(<MemberInfoCard {...base} />);
    expect(screen.getByText(i18n.t("member.suspend"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("member.withdraw"))).toBeInTheDocument();
  });
});

describe("画面のつなぎ込み（ソース）", () => {
  it("開けないタブはホームとして出す。設定タブはアカウント画面に替える", () => {
    const src = read("src/components/trainer/TrainerView.tsx");
    expect(src).toContain('const shownTab: TrainerTab = canOpenTab(tab, isLimitedStaff) ? tab : "dashboard";');
    expect(src).toMatch(/shownTab === "gym-settings" && \(isLimitedStaff\s*\?\s*<StaffAccountSettings/);
    // 描画の分岐は全部 shownTab で見る（tab のままのものが残ると、隠したタブが開けてしまう）
    expect(src).not.toMatch(/\{tab === "/);
    expect(src).toMatch(/activeTab=\{shownTab\}/);
  });

  it("お客様の削除ボタンはインストラクターに出さない", () => {
    const src = read("src/components/trainer/TrainerClientList.tsx");
    expect(src).toMatch(/\{!isLimitedStaff && \(\s*<button[\s\S]{0,400}setDeleteTarget\(c\.user_id\)/);
  });

  it("カルテ: 休会・退会・入金・プランと契約の中身はインストラクターに触らせない", () => {
    const src = read("src/components/trainer/TrainerClientDetail.tsx");
    expect(src).toContain("canManageStatus={!isLimitedStaff}");
    expect(src).toMatch(/\{!isLimitedStaff && \(\s*<MemberPaymentsSection/);
    // プラン・起算日（日付・今日に戻す）・猶予は DB（GB005）が断るので、先に押せなくしておく
    expect(src.match(/disabled=\{isLimitedStaff\}/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(src).toContain("disabled={!cycleStartDate || isLimitedStaff}");
  });

  it("ホーム: 売上・更新・入金・受付人数の確認はインストラクターに出さない", () => {
    const src = read("src/components/trainer/TrainerDashboard.tsx");
    for (const flag of ["show_stat_month_revenue", "show_renewal_alerts", "show_revenue_chart"]) {
      expect(src, flag).toContain(`tenant?.${flag} !== false && !isLimitedStaff`);
    }
    expect(src).toContain("booking_capacity_confirmed_at === null && !isLimitedStaff");
    expect(src).toContain("unrecordedThisMonth.length > 0 && !isLimitedStaff");
  });

  it("予定表の受付スイッチはインストラクターには見せるだけ", () => {
    expect(read("src/components/trainer/TrainerSchedule.tsx")).toContain("readOnly={isLimitedStaff}");
  });

  it("useTenant は自分のジムの行の権限を読む（別のジムの行を拾わない）", () => {
    const src = read("src/hooks/useTenant.ts");
    expect(src).toContain("isLimitedStaff: isLimitedStaffRole(membership?.role, membership?.staff_access)");
    expect(src).toMatch(/\.select\("staff_access"\)\s*\.eq\("tenant_id", tenant\.id\)/);
  });

  it("予約の変更・キャンセルの通知は、担当のインストラクターにも届く", () => {
    const src = read("src/hooks/useBookings.ts");
    expect(src).toContain("withAssignedStaff([...trainers, userId], staffUserId)");
    expect(src).toContain("withAssignedStaff(trainers, booking.staff_user_id)");
    expect(src.match(/oldStaffUserId\)\.catch/g)).toHaveLength(2);
  });
});

// ── DB ───────────────────────────────────────────────────────────────
describe("DB（20261028020000_instructor_staff.sql）", () => {
  const SQL = sql("supabase/migrations/20261028020000_instructor_staff.sql");

  it("staff_access 列（既定 full・full/limited だけ）", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS staff_access text NOT NULL DEFAULT 'full'/);
    expect(SQL).toMatch(/CHECK \(staff_access IN \('full', 'limited'\)\)/);
  });

  it("🔴 is_limited_staff は authenticated が実行できる（ポリシーから呼ぶ。外すと全画面が落ちる）", () => {
    expect(SQL).toMatch(/FUNCTION public\.is_limited_staff\(p_tenant_id uuid, p_user_id uuid\)[\s\S]{0,200}SECURITY DEFINER/);
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.is_limited_staff(uuid, uuid) FROM PUBLIC, anon;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.is_limited_staff(uuid, uuid) TO authenticated, service_role;");
  });

  it("権限を変えられるのはオーナーだけ（今まで通りのスタッフが自分で戻せない）", () => {
    expect(SQL).toMatch(/BEFORE UPDATE OF staff_access ON public\.tenant_members/);
    expect(SQL).toContain("current_user = 'authenticated'");
    expect(SQL).toContain("NOT public.has_tenant_role(NEW.tenant_id, auth.uid(), ARRAY['owner'])");
  });

  it("書き込みを止めるのは RESTRICTIVE で足す（41本）。読むのは止めない", () => {
    const policies = [...SQL.matchAll(/CREATE POLICY limited_staff_no_(insert|update|delete) ON public\.(\w+) AS RESTRICTIVE FOR (\w+) TO authenticated\s+(USING|WITH CHECK) \(NOT public\.is_limited_staff\(tenant_id, auth\.uid\(\)\)\)/g)];
    expect(policies).toHaveLength(41);
    for (const [, op, , forOp, clause] of policies) {
      expect(forOp.toLowerCase()).toBe(op);
      expect(clause).toBe(op === "insert" ? "WITH CHECK" : "USING");
    }
    const tables = new Set(policies.map((p) => p[2]));
    for (const t of [
      "announcements", "announcement_audience", "gym_videos", "booking_options", "booking_option_customers",
      "booking_questions", "booking_frequency_limits", "booking_capacity_windows", "booking_blocked_windows",
      "booking_closed_days", "booking_uncapped_days", "staff_schedules", "member_payments", "tenant_members",
    ]) {
      expect(tables, t).toContain(t);
    }
    // 予約・記録・メッセージ・お客様の基本情報はインストラクターの仕事なので止めない
    for (const t of ["bookings", "workouts", "messages", "profiles", "blocked_slots"]) {
      expect(tables, t).not.toContain(t);
    }
    expect(SQL).not.toMatch(/AS RESTRICTIVE FOR SELECT/);
    // ポリシーを書くのは全部 CREATE POLICY limited_staff_no_*（ほかのポリシーは変えない）
    expect(SQL.match(/CREATE POLICY/g)).toHaveLength(41);
  });

  it("お客様の削除: インストラクターは断る（比較は IS DISTINCT FROM）", () => {
    const fn = SQL.slice(SQL.indexOf("FUNCTION public.delete_customer_cascade"), SQL.indexOf("FUNCTION public.guard_profile_plan_fields"));
    expect(fn.indexOf("PERFORM public.assert_can_act_for(_customer_id)")).toBeGreaterThan(0);
    expect(fn).toContain("auth.uid() IS DISTINCT FROM _customer_id");
    expect(fn).toContain("me.staff_access = 'limited'");
    expect(fn).toContain("ERRCODE = '42501'");
    expect(fn.indexOf("ERRCODE = '42501'")).toBeLessThan(fn.indexOf("DELETE FROM public.workouts"));
    expect(SQL).toContain("REVOKE EXECUTE ON FUNCTION public.delete_customer_cascade(uuid) FROM PUBLIC, anon;");
  });

  it("お客様の契約の中身: インストラクターはお客様本人と同じ扱い（GB005）", () => {
    const fn = SQL.slice(SQL.indexOf("FUNCTION public.guard_profile_plan_fields"));
    expect(fn).toContain("IF v_actor IS NULL THEN");
    expect(fn).toMatch(/v_limited := v_actor IS DISTINCT FROM NEW\.user_id AND EXISTS/);
    expect(fn).toContain("me.staff_access = 'limited'");
    expect(fn).toMatch(/IF NOT v_limited THEN\s+IF v_actor IS DISTINCT FROM NEW\.user_id THEN\s+RETURN NEW;/);
    expect(fn).toContain("ERRCODE = 'GB005'");
  });

  it("🔴 招待コードはお客様から読めない表に置く（tenants の列は常に NULL）", () => {
    expect(SQL).toContain("ALTER TABLE public.tenant_staff_invites ENABLE ROW LEVEL SECURITY;");
    expect(SQL).toContain("REVOKE ALL ON public.tenant_staff_invites FROM anon, authenticated;");
    expect(SQL).not.toMatch(/CREATE POLICY[^;]*ON public\.tenant_staff_invites/);
    expect(SQL).toContain("UPDATE public.tenants SET staff_invite_code = NULL WHERE staff_invite_code IS NOT NULL;");
    expect(SQL).toContain("CHECK (staff_invite_code IS NULL)");
    // 関数はもう tenants の列を読み書きしない
    const fns = SQL.slice(SQL.indexOf("FUNCTION public._owner_staff_invite_code"));
    expect(fns).not.toMatch(/\.staff_invite_code\b/);
    expect(fns).not.toMatch(/SET staff_invite_code/);
  });

  it("コードの関数: 中身はオーナーだけ。参加・照会は anon から呼べない", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public._owner_staff_invite_code(text, boolean) FROM PUBLIC, anon, authenticated;");
    expect(SQL).toMatch(/WHERE t\.owner_user_id = auth\.uid\(\)/);
    for (const fn of [
      "get_my_instructor_invite_code()", "regenerate_instructor_invite_code()",
      "lookup_tenant_by_staff_invite_code(text)", "join_tenant_as_staff_with_invite_code(text, text)",
    ]) {
      expect(SQL, fn).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`);
      expect(SQL, fn).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`);
    }
  });

  it("インストラクター用のコードで参加した人は最初から limited（参加し直しも同じ）", () => {
    const join = SQL.slice(SQL.indexOf("FUNCTION public.join_tenant_as_staff_with_invite_code"));
    expect(join).toContain("CASE WHEN i.instructor_code = v_code THEN 'limited' ELSE 'full' END");
    expect(join).toContain("staff_access = v_access");
    expect(join).toMatch(/INSERT INTO public\.tenant_members \(tenant_id, user_id, role, display_name, status, staff_access\)/);
    expect(join).toContain("v_code IN (i.staff_code, i.instructor_code)");
  });

  it("ジムを消すときは招待コードの表も消す", () => {
    const dmg = read("supabase/migrations/20261028020100_delete_gym_staff_invites.sql");
    expect(dmg).toContain("DELETE FROM public.tenant_staff_invites WHERE tenant_id = v_tenant_id;");
  });

  it("types.ts に列・表・関数がある", () => {
    const types = read("src/integrations/supabase/types.ts");
    const block = (name: string) => types.slice(types.indexOf(`      ${name}: {\n        Row: {`));
    expect(block("tenant_members").slice(0, 3000)).toMatch(/Row: \{[\s\S]*?staff_access: string\n/);
    expect(types).toContain("      tenant_staff_invites: {\n        Row: {");
    for (const fn of ["get_my_instructor_invite_code", "regenerate_instructor_invite_code", "is_limited_staff"]) {
      expect(types, fn).toMatch(new RegExp(`\\n      ${fn}: \\{`));
    }
  });
});

describe("Edge Function（店宛ての通知）", () => {
  it.each([
    "notify-new-booking", "trial-book", "drop-in-book", "trial-cancel", "send-push-notification", "daily-trainer-summary",
  ])("%s はインストラクターを店宛ての宛先から外す", (name) => {
    expect(read(`supabase/functions/${name}/index.ts`)).toContain('.neq("staff_access", "limited")');
  });

  it("新しい予約のプッシュは、担当のインストラクターにも届く", () => {
    const src = read("supabase/functions/notify-new-booking/index.ts");
    expect(src).toMatch(/\.select\("[^"]*\bstaff_user_id\b[^"]*"\)/);
    expect(src).toContain("...(booking.staff_user_id ? [booking.staff_user_id as string] : [])");
  });
});

describe("文言（5言語）", () => {
  it.each(["ja", "en", "ko", "zh-CN", "zh-TW"])("%s に必要なキーがある", (lng) => {
    const j = JSON.parse(read(`src/locales/${lng}.json`));
    for (const key of ["account", "mAccount"]) expect(j.trainerNav?.[key], key).toBeTruthy();
    for (const key of ["title", "ownerOnly"]) expect(j.staffAccount?.[key], key).toBeTruthy();
    for (const key of ["roleInstructor", "instructorInviteTitle", "instructorInviteDesc"]) {
      expect(j.staff?.[key], key).toBeTruthy();
    }
    // 「スタッフ」（full）をなくしたので、スタッフ用の招待・切り替えの文言は無い（2026-10-28）
    for (const key of [
      "roleStaff", "inviteTitle", "inviteDesc", "instructorSwitch", "instructorSwitchAria",
      "accessLimitedToast", "accessFullToast", "errorAccess",
    ]) {
      expect(j.staff?.[key], key).toBeUndefined();
    }
  });
});
