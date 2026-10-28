/**
 * 予約メニュー（booking_menus・2026-10-28）。
 *
 * 宗本さん（パーソナルピラティスを始める）:
 *   「お客様用にも、筋トレの予約とピラティスの予約で分けて予約できるようにしてほしい」
 *   「お客さんは、ヨガかマシンピラティスのどっちかを選べる」
 * 確認: 1. ピラティスの時間はひとまず専用。先着順にも変えられる  2. 回数は今のプランから1回
 *       3. 1日の上限は曜日ごとの上限をそのまま  4. 時間は同じ  5. 体験はトレーニングだけ
 *
 * 🔴 壊しやすいもの:
 *   1. 担当のいるメニュー（ピラティス）の予約が、自分の専用の時間に塞がれる（画面も DB も）
 *   2. 専用の時間がトレーニング・体験に取られる（画面は「担当つきのブロック」、DB は GB011）
 *   3. シフトの無い担当（＝営業時間どおり）が営業時間をまるごと専用にする
 *   4. 店の代理予約まで止める（先生のお休みの日にトレーニングを入れられなくなる）
 *   5. メニューの担当を当てる前に、担当の検証・シフト（GB002）・担当の重なり（GB001）が動く
 *   6. 日時の変更でメニューが消える（旧行を消して作り直すので、渡さない列は消える）
 *   7. 予約に使われたメニューを消して、過去の予約が UPDATE トリガーをくぐる
 *   8. メニューを使っていない店の動きが変わる
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import i18n from "@/lib/i18n";
import {
  defaultMenu, isMenuReservedError, isMenuUnavailableError, isReservedBlock, menuNameOf,
  overlapsReservedBlock, parseMenus, selectableMenus, type BookingMenu,
} from "@/lib/bookingMenus";
import { isFootprintBlocked } from "@/lib/bookingOptionFit";
import { bookingErrorKey, isAppOutdatedError, proxyBookingErrorKey } from "@/lib/bookingErrors";
import type { BookedSlot } from "@/lib/bookedSlots";
import type { TenantStaff } from "@/lib/tenantStaff";
import BookingStaffMenuPicker from "@/components/booking/BookingStaffMenuPicker";
import ProxyStaffMenuSelect from "@/components/trainer/ProxyStaffMenuSelect";
import TrainerBookingMenus from "@/components/trainer/TrainerBookingMenus";

// ── モック（TrainerBookingMenus 用）────────────────────────────────────────
const db = {
  writes: [] as { table: string; op: string; values?: unknown; filters: Record<string, unknown> }[],
  deleteError: null as { code: string } | null,
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const entry = { table, op: "", values: undefined as unknown, filters: {} as Record<string, unknown> };
      const q: Record<string, unknown> = {
        insert: (v: unknown) => { entry.op = "insert"; entry.values = v; return q; },
        update: (v: unknown) => { entry.op = "update"; entry.values = v; return q; },
        delete: () => { entry.op = "delete"; return q; },
        eq: (k: string, v: unknown) => { entry.filters[k] = v; return q; },
        then: (ok: (r: unknown) => unknown, ng?: (e: unknown) => unknown) => {
          db.writes.push(entry);
          const error = entry.op === "delete" ? db.deleteError : null;
          return Promise.resolve({ data: null, error }).then(ok, ng);
        },
      };
      return q;
    },
  },
}));
const view = {
  tenant: { id: "t1", menu_staff_hours_exclusive: true } as Record<string, unknown>,
  staff: [] as TenantStaff[],
  schedules: [] as { user_id: string; weekday: number; start_time: string; end_time: string }[],
  menus: [] as BookingMenu[],
};
const refetchMenus = vi.fn();
const refetchTenant = vi.fn();
vi.mock("@/hooks/useTenant", () => ({ useTenant: () => ({ tenant: view.tenant, refetch: refetchTenant }) }));
vi.mock("@/hooks/useTenantStaff", () => ({ useTenantStaff: () => ({ staff: view.staff, loading: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useStaffSchedules", () => ({ useStaffSchedules: () => ({ schedules: view.schedules, loading: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useBookingMenus", () => ({ useBookingMenus: () => ({ menus: view.menus, loading: false, refetch: refetchMenus }) }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

const TRAINING: BookingMenu = { id: "m-train", name: "Menu-Training", staff_user_id: null, is_active: true, sort_order: 0 };
const YOGA: BookingMenu = { id: "m-yoga", name: "Menu-Yoga", staff_user_id: "inst", is_active: true, sort_order: 1 };
const PILATES: BookingMenu = { id: "m-pilates", name: "Menu-Pilates", staff_user_id: "inst", is_active: true, sort_order: 2 };
const STAFF: TenantStaff[] = [
  { user_id: "owner", display_name: "Owner", role: "owner", access: "full" },
  { user_id: "inst", display_name: "Hanako", role: "trainer", access: "limited" },
];

beforeAll(async () => {
  await i18n.changeLanguage("ja");
});
beforeEach(() => {
  db.writes = [];
  db.deleteError = null;
  view.tenant = { id: "t1", menu_staff_hours_exclusive: true };
  view.staff = STAFF;
  view.schedules = [{ user_id: "inst", weekday: 2, start_time: "10:00", end_time: "13:00" }];
  view.menus = [TRAINING, YOGA, PILATES];
  refetchMenus.mockClear();
  refetchTenant.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
});
afterEach(cleanup);

const read = (path: string) => readFileSync(path, "utf8");
const sql = (path: string) => read(path).replace(/--[^\n]*/g, "");

// ── 判定（src/lib/bookingMenus.ts）──────────────────────────────────────────
describe("メニューの読み方・選べるメニュー", () => {
  it("壊れた行・名前の無い行は捨てる。並びは sort_order（同じなら読んだ順）", () => {
    const menus = parseMenus([
      { id: "b", name: " Menu-Yoga ", staff_user_id: "inst", is_active: true, sort_order: 1 },
      { id: "a", name: "Menu-Training", staff_user_id: null, sort_order: 0 },
      { id: "c", name: "  ", sort_order: 0 },
      { name: "no-id" },
      null,
      { id: "d", name: "Menu-Pilates", staff_user_id: "inst", is_active: false, sort_order: 1 },
    ]);
    expect(menus.map((m) => [m.id, m.name, m.is_active])).toEqual([
      ["a", "Menu-Training", true], ["b", "Menu-Yoga", true], ["d", "Menu-Pilates", false],
    ]);
    expect(parseMenus(null)).toEqual([]);
  });

  it("お客様が選べるのは、オンのもの・担当が今もスタッフのもの", () => {
    const off = { ...PILATES, id: "off", is_active: false };
    const gone = { ...YOGA, id: "gone", staff_user_id: "left-staff" };
    expect(selectableMenus([TRAINING, YOGA, off, gone], ["owner", "inst"]).map((m) => m.id)).toEqual(["m-train", "m-yoga"]);
  });

  it("既定は担当のいない先頭（DB の既定と同じ）。無ければ先頭", () => {
    expect(defaultMenu([YOGA, TRAINING])?.id).toBe("m-train");
    expect(defaultMenu([YOGA, PILATES])?.id).toBe("m-yoga");
    expect(defaultMenu([])).toBeNull();
  });

  it("予約に添える名前は、メニューが2つ以上ある店だけ", () => {
    expect(menuNameOf([TRAINING, YOGA], "m-yoga")).toBe(YOGA.name);
    expect(menuNameOf([TRAINING], "m-train")).toBeNull();
    expect(menuNameOf([TRAINING, YOGA], null)).toBeNull();
    expect(menuNameOf([TRAINING, YOGA], "unknown")).toBeNull();
  });

  it("GB011（専用の時間）・GB012（選べないメニュー）を見分け、「アプリが古い」にしない", () => {
    expect(isMenuReservedError({ code: "GB011" })).toBe(true);
    expect(isMenuUnavailableError({ code: "GB012" })).toBe(true);
    expect(isMenuReservedError({ code: "GB012" })).toBe(false);
    expect(isAppOutdatedError({ code: "GB011" })).toBe(false);
    expect(isAppOutdatedError({ code: "GB012" })).toBe(false);
    expect(bookingErrorKey({ code: "GB011" })).toBe("bookingMenus.errorReserved");
    expect(bookingErrorKey({ code: "GB012" })).toBe("bookingMenus.errorUnavailable");
    expect(proxyBookingErrorKey({ code: "GB012" })).toBe("bookingMenus.errorUnavailable");
  });
});

describe("🔴 専用の時間（担当つきのブロック）と空き枠", () => {
  const reserved: BookedSlot = { date: "2026-12-15", startTime: "10:00", endTime: "13:00", isBlock: true, staffUserId: "inst" };
  const block: BookedSlot = { date: "2026-12-15", startTime: "15:00", endTime: "16:00", isBlock: true, staffUserId: null };
  const booking: BookedSlot = { date: "2026-12-15", startTime: "11:00", endTime: "12:15", isBlock: false, staffUserId: "inst" };
  const at = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const blocked = (time: string, staffUserId: string | null, slots: BookedSlot[] = [reserved, block], capacity = 1) =>
    isFootprintBlocked({
      bookedSlots: slots, date: "2026-12-15", weekday: 2, startMinutes: at(time), footprintMinutes: 75,
      capacityWindows: [], defaultCapacity: capacity, staffUserId, exclude: null,
    });

  it("担当つきのブロックだけが専用の時間", () => {
    expect(isReservedBlock(reserved)).toBe(true);
    expect(isReservedBlock(block)).toBe(false);
    expect(isReservedBlock(booking)).toBe(false);
  });

  it("担当のいないメニュー（トレーニング）: 占有（1枠＋間）が重なれば取れない。DB と同じ数え方", () => {
    expect(blocked("10:00", null)).toBe(true);
    expect(blocked("09:00", null)).toBe(true); // 9:00〜10:15 が 10:00 に食い込む
    expect(blocked("08:45", null)).toBe(false); // 8:45〜10:00 はちょうど手前
    expect(blocked("13:00", null)).toBe(false);
    expect(overlapsReservedBlock([reserved, block], at("09:00"), 75)).toBe(true);
    expect(overlapsReservedBlock([reserved, block], at("08:45"), 75)).toBe(false);
    expect(overlapsReservedBlock([reserved, block], at("15:00"), 75)).toBe(false); // 普通のブロックは「専用」ではない
  });

  it("🔴 担当のいるメニュー（ピラティス）: 自分の専用の時間に塞がれない・数えない（同時に1人の店でも取れる）", () => {
    expect(blocked("10:00", "inst")).toBe(false);
    expect(blocked("12:00", "inst")).toBe(false);
    // 普通のブロック・本物の予約は今まで通り塞ぐ
    expect(blocked("15:00", "inst")).toBe(true);
    expect(blocked("10:30", "inst", [reserved, booking])).toBe(true);
  });

  it("その日の終わりまでの専用の時間（終わりが 00:00）", () => {
    const night: BookedSlot = { date: "2026-12-15", startTime: "20:00", endTime: "00:00", isBlock: true, staffUserId: "inst" };
    expect(overlapsReservedBlock([night], at("21:00"), 75)).toBe(true);
    expect(overlapsReservedBlock([night], at("18:45"), 75)).toBe(false);
  });
});

// ── 画面 ──────────────────────────────────────────────────────────────
describe("お客様の予約画面のメニュー・担当の選択（BookingStaffMenuPicker）", () => {
  const base = {
    selectedMenuId: "m-train", onPickMenu: vi.fn(), staff: STAFF, staffSelectable: true,
    selectedStaffId: null, onPickStaff: vi.fn(),
  };

  it("メニューが2つ以上ならメニューを選ぶ。担当の選択は出さない", () => {
    const onPickMenu = vi.fn();
    render(<BookingStaffMenuPicker {...base} menus={[TRAINING, YOGA, PILATES]} onPickMenu={onPickMenu} />);
    const picker = screen.getByTestId("booking-menu-picker");
    expect(within(picker).getByText(i18n.t("bookingMenus.pickerLabel"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("staff.selectLabel"))).toBeNull();
    expect(screen.getByRole("button", { name: TRAINING.name })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: YOGA.name }));
    expect(onPickMenu).toHaveBeenCalledWith(YOGA);
  });

  it("担当のいるメニューを選んでいれば、担当の名前を添える", () => {
    render(<BookingStaffMenuPicker {...base} menus={[TRAINING, YOGA]} selectedMenuId="m-yoga" />);
    expect(screen.getByText(i18n.t("bookingMenus.pickerStaffHint", { name: "Hanako" }))).toBeInTheDocument();
  });

  it("メニューが1つだけなら何も出さない（選ぶものが無い）", () => {
    const { container } = render(<BookingStaffMenuPicker {...base} menus={[TRAINING]} />);
    expect(container.innerHTML).toBe("");
  });

  it("メニューを使っていない店は今まで通り担当を選ぶ", () => {
    const onPickStaff = vi.fn();
    render(<BookingStaffMenuPicker {...base} menus={[]} onPickStaff={onPickStaff} />);
    expect(screen.getByText(i18n.t("staff.selectLabel"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hanako" }));
    expect(onPickStaff).toHaveBeenCalledWith("inst");
    fireEvent.click(screen.getByRole("button", { name: i18n.t("staff.anyone") }));
    expect(onPickStaff).toHaveBeenLastCalledWith(null);
  });

  it("担当を選べない店（1人）でメニューも無ければ何も出さない", () => {
    const { container } = render(<BookingStaffMenuPicker {...base} menus={[]} staffSelectable={false} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("店の代理予約のメニュー・担当（ProxyStaffMenuSelect）", () => {
  it("メニューを選ぶと、担当をそのメニューの担当に合わせる（担当のいないメニューなら「誰でも」）", () => {
    const onChange = vi.fn();
    render(<ProxyStaffMenuSelect menus={[TRAINING, YOGA]} menuId="" staff={STAFF} staffSelectable staffId="" onChange={onChange} />);
    const menuSelect = screen.getByRole("combobox", { name: i18n.t("bookingMenus.pickerLabel") }) as HTMLSelectElement;
    expect(menuSelect.value).toBe("m-train"); // 何も選んでいなければ既定のメニュー
    fireEvent.change(menuSelect, { target: { value: "m-yoga" } });
    expect(onChange).toHaveBeenLastCalledWith({ menuId: "m-yoga", staffId: "inst" });
    fireEvent.change(menuSelect, { target: { value: "m-train" } });
    expect(onChange).toHaveBeenLastCalledWith({ menuId: "m-train", staffId: "" });
  });

  it("担当は店が替えてもよい（メニューはそのまま）", () => {
    const onChange = vi.fn();
    render(<ProxyStaffMenuSelect menus={[TRAINING, YOGA]} menuId="m-yoga" staff={STAFF} staffSelectable staffId="inst" onChange={onChange} />);
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    fireEvent.change(selects[1], { target: { value: "owner" } });
    expect(onChange).toHaveBeenLastCalledWith({ menuId: "m-yoga", staffId: "owner" });
  });

  it("メニューが1つ以下なら、メニューの欄は出さない", () => {
    render(<ProxyStaffMenuSelect menus={[TRAINING]} menuId="" staff={STAFF} staffSelectable={false} staffId="" onChange={vi.fn()} />);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });
});

describe("設定の「予約メニュー」カード（TrainerBookingMenus）", () => {
  it("メニューを足す（名前・担当なし・並びは最後）", async () => {
    render(<TrainerBookingMenus />);
    const card = screen.getByTestId("booking-menus-card");
    expect(within(card).getAllByTestId("booking-menu-row")).toHaveLength(3);
    fireEvent.change(within(card).getByPlaceholderText(i18n.t("bookingMenus.namePlaceholder")), { target: { value: " Menu-Stretch " } });
    fireEvent.click(within(card).getByRole("button", { name: new RegExp(i18n.t("bookingMenus.add")) }));
    await waitFor(() => expect(db.writes).toHaveLength(1));
    expect(db.writes[0]).toEqual({
      table: "booking_menus", op: "insert", filters: {},
      values: { tenant_id: "t1", name: "Menu-Stretch", staff_user_id: null, sort_order: 3 },
    });
    expect(refetchMenus).toHaveBeenCalled();
  });

  it("オン/オフはそのメニューの行だけを書く", async () => {
    render(<TrainerBookingMenus />);
    fireEvent.click(screen.getByRole("switch", { name: i18n.t("bookingMenus.activeAria", { name: YOGA.name }) }));
    await waitFor(() => expect(db.writes).toHaveLength(1));
    expect(db.writes[0]).toEqual({ table: "booking_menus", op: "update", values: { is_active: false }, filters: { id: "m-yoga" } });
  });

  it("並べ替えは 0,1,2… に振り直す", async () => {
    render(<TrainerBookingMenus />);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("bookingMenus.moveUp", { name: PILATES.name }) }));
    await waitFor(() => expect(db.writes).toHaveLength(2));
    expect(db.writes).toEqual(expect.arrayContaining([
      { table: "booking_menus", op: "update", values: { sort_order: 1 }, filters: { id: "m-pilates" } },
      { table: "booking_menus", op: "update", values: { sort_order: 2 }, filters: { id: "m-yoga" } },
    ]));
  });

  it("🔴 予約に使われたメニューは消せない（DB の外部キー）。オフにするよう案内する", async () => {
    db.deleteError = { code: "23503" };
    render(<TrainerBookingMenus />);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("bookingMenus.deleteAria", { name: TRAINING.name }) }));
    fireEvent.click(await screen.findByRole("button", { name: i18n.t("common.delete") }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(i18n.t("bookingMenus.errorInUse")));
    expect(db.writes[0]).toEqual(expect.objectContaining({ op: "delete", filters: { id: "m-train" } }));
  });

  it("専用／先着順の切り替えは、担当のいるメニューがあるときだけ出す。店の設定を書く", async () => {
    render(<TrainerBookingMenus />);
    const sw = screen.getByRole("switch", { name: i18n.t("bookingMenus.exclusiveTitle") });
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(i18n.t("bookingMenus.exclusiveOn"))).toBeInTheDocument();
    fireEvent.click(sw);
    await waitFor(() => expect(db.writes).toHaveLength(1));
    expect(db.writes[0]).toEqual({ table: "tenants", op: "update", values: { menu_staff_hours_exclusive: false }, filters: { id: "t1" } });
    expect(refetchTenant).toHaveBeenCalled();
    cleanup();
    view.menus = [TRAINING];
    render(<TrainerBookingMenus />);
    expect(screen.queryByRole("switch", { name: i18n.t("bookingMenus.exclusiveTitle") })).toBeNull();
  });

  it("担当のシフトが未設定なら知らせる（営業時間中いつでも取れ、専用の時間も無い）", () => {
    view.schedules = [];
    render(<TrainerBookingMenus />);
    const warnings = screen.getAllByTestId("booking-menu-no-shift");
    expect(warnings).toHaveLength(2); // Yoga・Pilates（担当のいる2つ）
    expect(warnings[0]).toHaveTextContent(i18n.t("bookingMenus.noShiftWarning", { name: "Hanako" }));
  });
});

describe("画面のつなぎ込み（ソース）", () => {
  const BOOKING = read("src/components/customer/CustomerBooking.tsx");
  const SCHEDULE = read("src/components/trainer/TrainerSchedule.tsx");
  const HOOK = read("src/hooks/useBookings.ts");

  it("お客様: 担当はメニューで決まる（メニューの無い店は今まで通り選んだ担当）", () => {
    expect(BOOKING).toContain("const menus = selectableMenus(allMenus, staff.map((s) => s.user_id));");
    expect(BOOKING).toContain("const activeMenu = menus.find((m) => m.id === selectedMenuId) ?? defaultMenu(menus);");
    expect(BOOKING).toContain("const selectedStaffId = menus.length > 0 ? (activeMenu?.staff_user_id ?? null) : pickedStaffId;");
  });

  it("お客様: メニューを送る（単発・くり返し）。予約の変更中は選ばせない（元のメニューのまま）", () => {
    expect(BOOKING).toContain("optionMinutes, bookingOptions: optionSnapshot, menuId: activeMenu?.id ?? null,");
    expect(BOOKING).toContain("optionMinutes, optionSnapshot, false, activeMenu?.id ?? null,");
    expect(BOOKING).toMatch(/\{!rescheduleTarget && \(\s*<BookingStaffMenuPicker/);
    expect(BOOKING).toContain("setSelectedMenuId(b.menuId ?? menus.find((m) => m.staff_user_id && m.staff_user_id === b.staff_user_id)?.id ?? null);");
  });

  it("🔴 お客様: 担当のいないメニューでは専用の時間の枠を出さない（キャンセル待ちが付かないように）", () => {
    expect(BOOKING).toContain("if (isReservedForMenu(dateKey, totalMin)) continue;");
    expect(BOOKING).toMatch(/const isReservedForMenu = \(date: string, startMin: number\): boolean =>\s+!selectedStaffId && overlapsReservedBlock\(/);
  });

  it("お客様: 予約一覧・完了のダイアログにメニュー名", () => {
    expect(BOOKING).toContain("{menuNameOf(allMenus, b.menuId) && <Badge");
    expect(BOOKING).toContain("[menuNameOf(allMenus, lastBooked.menuId), planLabel(lastBooked.booking_type)].filter(Boolean).join(\"・\")");
  });

  it("店: 代理予約でメニューを送る。予定のカードにメニュー名", () => {
    expect(SCHEDULE).toContain("<ProxyStaffMenuSelect");
    expect(SCHEDULE).toContain("menuId: proxyMenu?.id ?? null }");
    expect(SCHEDULE).toContain("proxyOutside, proxyMenu?.id ?? null);");
    expect(SCHEDULE.match(/\{typeLabel\((session|booking)\)\}/g)).toHaveLength(2);
  });

  it("🔴 予約の作成・変更: メニューは選んだときだけ送り、日時の変更では引き継ぐ", () => {
    expect(HOOK).toContain("...(opts.menuId ? { menu_id: opts.menuId } : {}),");
    expect(HOOK).toContain("menuId: (old as { menu_id?: string | null }).menu_id ?? null,");
    expect(HOOK).toContain("menuId: row.menu_id ?? null,");
    expect(HOOK).toContain("staffUserId, customAnswers, optionMinutes, bookingOptions, outsideHours, menuId,");
  });

  it("設定画面に「予約メニュー」カードを置く（スタッフのシフトの下）", () => {
    expect(read("src/components/trainer/TrainerGymSettings.tsx")).toMatch(/<TrainerStaffSchedule \/>\s*\n\s*<TrainerBookingMenus \/>/);
  });
});

// ── DB ───────────────────────────────────────────────────────────────
describe("DB（20261028030000_booking_menus.sql）", () => {
  const SQL = sql("supabase/migrations/20261028030000_booking_menus.sql");
  const fnBody = (name: string) => {
    const start = SQL.indexOf(`FUNCTION public.${name}(`);
    return SQL.slice(start, SQL.indexOf("$fn$;", start) > 0 ? SQL.indexOf("$fn$;", start) : SQL.indexOf("$function$;", start));
  };

  it("表: 読むのは同じジムの人、書くのはオーナー・スタッフ。インストラクターと anon は書けない", () => {
    expect(SQL).toMatch(/CREATE POLICY tenant_isolation ON public\.booking_menus AS RESTRICTIVE/);
    expect(SQL).toMatch(/booking_menus_select ON public\.booking_menus\s+FOR SELECT TO authenticated\s+USING \(public\.is_tenant_member\(tenant_id, auth\.uid\(\)\)\)/);
    for (const op of ["insert", "update", "delete"]) {
      expect(SQL, op).toMatch(new RegExp(`booking_menus_${op} ON public\\.booking_menus[\\s\\S]{0,120}has_tenant_role\\(tenant_id, auth\\.uid\\(\\), ARRAY\\['owner','trainer'\\]\\)`));
      expect(SQL, op).toMatch(new RegExp(`CREATE POLICY limited_staff_no_${op} ON public\\.booking_menus AS RESTRICTIVE`));
    }
    expect(SQL).toContain("REVOKE ALL ON public.booking_menus FROM anon;");
    expect(SQL).toContain("CHECK (btrim(name) <> '' AND char_length(name) <= 30)");
  });

  it("🔴 予約からの参照は ON DELETE を付けない（使われたメニューは消せない・過去の予約に UPDATE を走らせない）", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS menu_id uuid REFERENCES public\.booking_menus\(id\);/);
    expect(SQL).not.toMatch(/booking_menus\(id\)\s+ON DELETE/);
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS menu_staff_hours_exclusive boolean NOT NULL DEFAULT true");
  });

  it("🔴 メニューを当てるトリガーは、bookings の BEFORE トリガーの中でいちばん先に動く", () => {
    const all = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).map((f) => read(`supabase/migrations/${f}`)).join("\n");
    const names = [...all.matchAll(/CREATE TRIGGER (\w+)\s+BEFORE [A-Z ,]+(?:OF \w+ )?ON public\.bookings/g)].map((m) => m[1]);
    expect(names).toContain("apply_booking_menu");
    for (const n of names) expect(n >= "apply_booking_menu", n).toBe(true);
    expect(SQL).toMatch(/CREATE TRIGGER apply_booking_menu\s+BEFORE INSERT OR UPDATE OF menu_id ON public\.bookings/);
  });

  it("担当を当てる: 別のジム・外したメニューは GB012（日時の変更の作り直しは通す）", () => {
    const fn = fnBody("apply_booking_menu");
    expect(fn).toContain("v_menu.tenant_id IS DISTINCT FROM NEW.tenant_id");
    expect(fn).toContain("IF NOT v_menu.is_active AND v_self AND NEW.created_via IS DISTINCT FROM 'reschedule' THEN");
    expect(fn.match(/ERRCODE = 'GB012'/g)).toHaveLength(2);
    // お客様の予約は必ずメニューの担当。代理予約は、担当を選んでいなければメニューの担当
    expect(fn).toContain("IF v_menu.staff_user_id IS NOT NULL AND (v_self OR NEW.staff_user_id IS NULL) THEN");
    // メニューを送らない予約（古いアプリ）は担当のいない先頭のメニュー
    expect(fn).toMatch(/ELSIF TG_OP = 'INSERT' AND NEW\.staff_user_id IS NULL THEN\s+SELECT m\.id INTO NEW\.menu_id[\s\S]*?m\.staff_user_id IS NULL\s+ORDER BY m\.sort_order, m\.created_at/);
  });

  it("🔴 専用の時間（GB011）: お客様ご自身の新しい予約だけ。担当のいるメニューの担当の予約は通す", () => {
    const fn = fnBody("apply_booking_menu");
    expect(fn).toContain("v_self := v_actor IS NOT NULL AND v_actor = NEW.user_id;");
    expect(fn).toContain("IF TG_OP <> 'INSERT' OR NOT v_self THEN");
    expect(fn).toMatch(/IF NEW\.staff_user_id IS NOT NULL AND EXISTS \(\s+SELECT 1 FROM public\.booking_menus m\s+WHERE m\.tenant_id = NEW\.tenant_id AND m\.is_active AND m\.staff_user_id = NEW\.staff_user_id/);
    // 占有は check_booking_overlap と同じ（プランの長さ＋オプション＋間）
    expect(fn).toContain("v_session_min + GREATEST(COALESCE(NEW.option_minutes, 0), 0) + COALESCE(v_buffer_min, 15)");
    expect(fn).toContain("ERRCODE = 'GB011'");
  });

  it("🔴 専用の時間は、シフトを持つ現役の担当・オンのメニュー・専用にしている店だけ", () => {
    const fn = fnBody("menu_reserved_overlaps");
    expect(fn).toContain("COALESCE((SELECT t.menu_staff_hours_exclusive FROM public.tenants t WHERE t.id = p_tenant_id), false)");
    expect(fn).toContain("FROM public.staff_schedules s"); // 行の無い担当（営業時間どおり）は専用にならない
    expect(fn).toContain("m.is_active AND m.staff_user_id = s.user_id");
    expect(fn).toContain("tm.status = 'active' AND tm.role IN ('owner', 'trainer')");
    expect(fn).toContain("EXTRACT(DOW FROM (p_start AT TIME ZONE 'Asia/Tokyo'))");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.menu_reserved_overlaps(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;");
  });

  it("体験・ドロップインも専用の時間に入れない。文言は満枠と同じ（Edge Function が満枠の案内に振り分ける）", () => {
    const fn = fnBody("guard_trial_menu_reserved");
    expect(fn).toContain("RAISE EXCEPTION 'この時間帯はすでに予約が入っています';");
    expect(SQL).toMatch(/CREATE TRIGGER trg_guard_trial_menu_reserved\s+BEFORE INSERT ON public\.trial_bookings/);
    for (const name of ["trial-book", "drop-in-book"]) {
      expect(read(`supabase/functions/${name}/index.ts`), name).toContain('msg.includes("この時間帯")');
    }
  });

  it("🔴 埋まり枠の RPC: 今までの3つはそのまま。専用の時間を「担当つきのブロック」で足す（未ログインには担当を返さない）", () => {
    const prev = sql("supabase/migrations/20260903000000_booking_option_minutes.sql");
    const prevFn = prev.slice(prev.indexOf("FUNCTION public.get_tenant_booked_slots"));
    const nowFn = SQL.slice(SQL.indexOf("FUNCTION public.get_tenant_booked_slots"));
    for (const part of [
      "FROM public.trial_bookings tb",
      "COALESCE(tp.slot_duration_minutes, tenant_session_min, 60)\n           + COALESCE(b.option_minutes, 0)\n           + COALESCE(buffer_min, 15)",
      "FROM public.blocked_slots bs",
    ]) {
      expect(prevFn, part).toContain(part);
      expect(nowFn, part).toContain(part);
    }
    expect(nowFn).toContain("CASE WHEN auth.uid() IS NULL THEN NULL::uuid ELSE s.user_id END AS staff_user_id");
    expect(nowFn).toMatch(/'ブロック済み' AS status,\s+CASE WHEN auth\.uid\(\)/);
    expect(nowFn).toContain("WHERE v_exclusive");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.get_tenant_booked_slots(uuid, date, date) TO anon, authenticated;");
  });

  it("ジムを消すときはメニューも消す（予約より後）", () => {
    const dmg = read("supabase/migrations/20261028030100_delete_gym_booking_menus.sql");
    const tables = [...dmg.matchAll(/DELETE FROM public\.(\w+)/g)].map((m) => m[1]);
    expect(tables.indexOf("booking_menus")).toBeGreaterThan(tables.indexOf("bookings"));
    expect(tables.indexOf("booking_menus")).toBe(tables.indexOf("booking_options") + 1);
  });

  it("types.ts に表・列・関数がある", () => {
    const types = read("src/integrations/supabase/types.ts");
    expect(types).toContain("      booking_menus: {\n        Row: {");
    expect(types).toContain("          menu_id: string | null\n");
    expect(types).toContain("          menu_staff_hours_exclusive: boolean\n");
    expect(types).toContain('            referencedRelation: "booking_menus"');
    expect(types).toMatch(/\n {6}menu_reserved_overlaps: \{/);
  });
});

describe("Edge Function（新しい予約の通知）", () => {
  const src = read("supabase/functions/notify-new-booking/index.ts");

  it("メニューが2つ以上ある店だけ、メール・プッシュにメニュー名を添える", () => {
    expect(src).toMatch(/\.select\("[^"]*\bmenu_id\b[^"]*"\)/);
    expect(src).toContain('supabase.from("booking_menus").select("id, name").eq("tenant_id", booking.tenant_id)');
    expect(src).toContain("const menuName = menus.length >= 2 ? (menus.find((m) => m.id === booking.menu_id)?.name ?? null) : null;");
    expect(src).toContain("${menuName ? `の${menuName}` : \"\"}を予約しました");
  });
});

describe("文言（5言語）", () => {
  it.each(["ja", "en", "ko", "zh-CN", "zh-TW"])("%s に予約メニューの文言がそろっている", (lng) => {
    const ja = JSON.parse(read("src/locales/ja.json")).bookingMenus as Record<string, string>;
    const j = JSON.parse(read(`src/locales/${lng}.json`)).bookingMenus as Record<string, string>;
    expect(Object.keys(j).sort()).toEqual(Object.keys(ja).sort());
    for (const [key, value] of Object.entries(j)) {
      expect(value, key).toBeTruthy();
      for (const v of ja[key].match(/\{\{\w+\}\}/g) ?? []) expect(value, `${key} ${v}`).toContain(v);
    }
  });
});
