/**
 * 予約メニューの開始日（booking_menus.starts_on・2026-10-29）。
 * `supabase/migrations/20261029020000_booking_menu_starts_on.sql`
 *
 * 宗本さん「（マシンピラティスは）今すぐ（オンに）だが、11/25 以降から予約は可能」。
 * メニューを今オンにして、開始日以降の日付だけを前もって予約できるようにする。
 *
 * 🔴 壊しやすいもの:
 *   1. 始まる前から担当のシフトの時間が専用になり、トレーニング・体験の枠が塞がる
 *      （menu_reserved_overlaps と get_tenant_booked_slots の両方に開始日が要る）
 *   2. 開始日より前に、新しいアプリでそのメニューを選べる（GB012）／古いアプリで先生を指名できる（GB002）
 *   3. 店の代理予約・日時の変更（作り直し）まで止める
 *   4. 関数を作り直すときに、開始日以外のところを変えてしまう（本番の定義を写して1か所足しただけであること）
 *   5. 公開の体験予約ページ（未ログイン）から get_tenant_booked_slots が呼べなくなる
 *   6. 開始日の列が無い環境で、メニューが1つも読めなくなる（＝担当の選択が出る店に戻ってしまう）
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import i18n from "@/lib/i18n";
import { isMenuOpenOn, menuStartLabel, parseMenus, upcomingMenuStart, type BookingMenu } from "@/lib/bookingMenus";
import { dayUnselectableReason, type CalendarDayRules } from "@/lib/bookingCalendarDay";
import type { TenantStaff } from "@/lib/tenantStaff";
import BookingStaffMenuPicker from "@/components/booking/BookingStaffMenuPicker";
import TrainerBookingMenus from "@/components/trainer/TrainerBookingMenus";

// ── モック ────────────────────────────────────────────────────────────────
const db = {
  writes: [] as { table: string; op: string; values?: unknown; filters: Record<string, unknown> }[],
  /** true なら starts_on を含む select を「列が無い」で断る */
  missingStartsOn: false,
  selects: [] as string[],
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const entry = { table, op: "", values: undefined as unknown, filters: {} as Record<string, unknown> };
      const q: Record<string, unknown> = {
        select: (cols: string) => { entry.op = "select"; entry.values = cols; return q; },
        insert: (v: unknown) => { entry.op = "insert"; entry.values = v; return q; },
        update: (v: unknown) => { entry.op = "update"; entry.values = v; return q; },
        delete: () => { entry.op = "delete"; return q; },
        eq: (k: string, v: unknown) => { entry.filters[k] = v; return q; },
        order: () => q,
        then: (ok: (r: unknown) => unknown, ng?: (e: unknown) => unknown) => {
          if (entry.op === "select") {
            const cols = String(entry.values);
            db.selects.push(cols);
            if (db.missingStartsOn && cols.includes("starts_on")) {
              return Promise.resolve({ data: null, error: { code: "42703", message: "column booking_menus.starts_on does not exist" } }).then(ok, ng);
            }
            const row = { id: "m1", name: "Menu-Pilates", staff_user_id: "inst", is_active: true, sort_order: 0 };
            return Promise.resolve({ data: [cols.includes("starts_on") ? { ...row, starts_on: "2099-11-25" } : row], error: null }).then(ok, ng);
          }
          db.writes.push(entry);
          return Promise.resolve({ data: null, error: null }).then(ok, ng);
        },
      };
      return q;
    },
  },
}));
const view = {
  tenant: { id: "t1", menu_staff_hours_exclusive: true } as Record<string, unknown>,
  menus: [] as BookingMenu[],
};
vi.mock("@/hooks/useTenant", () => ({ useTenant: () => ({ tenant: view.tenant, refetch: vi.fn() }) }));
vi.mock("@/hooks/useTenantStaff", () => ({ useTenantStaff: () => ({ staff: STAFF, loading: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useStaffSchedules", () => ({
  useStaffSchedules: () => ({ schedules: [{ user_id: "inst", weekday: 3, start_time: "16:00", end_time: "22:30" }], loading: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useBookingMenus", () => ({ useBookingMenus: () => ({ menus: view.menus, loading: false, refetch: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const STAFF: TenantStaff[] = [
  { user_id: "owner", display_name: "Owner", role: "owner", access: "full" },
  { user_id: "inst", display_name: "Hanako", role: "trainer", access: "limited" },
];
const TRAINING: BookingMenu = { id: "m-train", name: "Menu-Training", staff_user_id: null, is_active: true, sort_order: 0, starts_on: null };
// 実際の日付に左右されないよう、遠い先（まだ始まっていない）と遠い昔（始まっている）を使う
const PILATES_LATER: BookingMenu = { id: "m-pilates", name: "Menu-Pilates", staff_user_id: "inst", is_active: true, sort_order: 1, starts_on: "2099-11-25" };
const PILATES_STARTED: BookingMenu = { ...PILATES_LATER, starts_on: "2000-01-01" };

beforeAll(async () => {
  await i18n.changeLanguage("ja");
});
beforeEach(() => {
  db.writes = [];
  db.selects = [];
  db.missingStartsOn = false;
  view.menus = [TRAINING, PILATES_LATER];
});
afterEach(cleanup);

// ── SQL ───────────────────────────────────────────────────────────────────
const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (src: string) => stripSql(src).replace(/\s+/g, " ").trim();
const MIGRATION = "20261029020000_booking_menu_starts_on.sql";
const NEW_SQL = read(`supabase/migrations/${MIGRATION}`);
const MENUS_SQL = read("supabase/migrations/20261028030000_booking_menus.sql");
const TEACHER_SQL = read("supabase/migrations/20261029010000_guard_booking_menu_teacher.sql");

/** 関数の定義（CREATE OR REPLACE から、本体を閉じる $fn$ / $function$ まで） */
const fnDef = (src: string, name: string) => {
  const s = stripSql(src);
  const start = s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} の定義が見つからない`).toBeGreaterThan(-1);
  const tag = /AS (\$\w*\$)/.exec(s.slice(start))![1];
  const bodyStart = s.indexOf(tag, start) + tag.length;
  return s.slice(start, s.indexOf(tag, bodyStart) + tag.length);
};
/** 足した部分を取り除く（取り除く前に、足した部分が本当にあることも確かめる） */
const without = (def: string, ...added: string[]) =>
  added.reduce((acc, part) => {
    expect(acc, part).toContain(norm(part));
    return norm(acc.replace(norm(part), " "));
  }, norm(def));

const MENU_STARTED_AT_BOOKING = "AND (m.starts_on IS NULL OR m.starts_on <= (p_start AT TIME ZONE 'Asia/Tokyo')::date)";
const MENU_STARTED_ON_DAY = "AND (m.starts_on IS NULL OR m.starts_on <= d.day::date)";
const MENU_STARTED_FOR_NEW = "AND (m.starts_on IS NULL OR m.starts_on <= (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date)";
const APPLY_BEFORE_START = `
    IF v_menu.starts_on IS NOT NULL AND (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date < v_menu.starts_on
       AND v_self AND NEW.created_via IS DISTINCT FROM 'reschedule' THEN
      RAISE EXCEPTION 'このメニューは予約できません' USING ERRCODE = 'GB012';
    END IF;`;

describe("開始日の列", () => {
  it("booking_menus.starts_on（date・NULL はすぐ）", () => {
    expect(NEW_SQL).toMatch(/ALTER TABLE public\.booking_menus\s+ADD COLUMN IF NOT EXISTS starts_on date;/);
    expect(NEW_SQL).toContain("COMMENT ON COLUMN public.booking_menus.starts_on IS");
  });
});

describe("🔴 本番の定義に、開始日の条件を足しただけ（ほかは1文字も変えていない）", () => {
  it("専用の時間に重なるか（menu_reserved_overlaps）: 開始日を過ぎたメニューだけ", () => {
    expect(without(fnDef(NEW_SQL, "menu_reserved_overlaps"), MENU_STARTED_AT_BOOKING))
      .toBe(norm(fnDef(MENUS_SQL, "menu_reserved_overlaps")));
  });

  it("画面の埋まり枠（get_tenant_booked_slots）: 開始日より前の日には「担当つきのブロック」を出さない", () => {
    expect(without(fnDef(NEW_SQL, "get_tenant_booked_slots"), MENU_STARTED_ON_DAY))
      .toBe(norm(fnDef(MENUS_SQL, "get_tenant_booked_slots")));
  });

  it("メニューを当てる（apply_booking_menu）: 開始日より前は、お客様ご自身の新しい予約で選べない（GB012）", () => {
    expect(without(fnDef(NEW_SQL, "apply_booking_menu"), APPLY_BEFORE_START))
      .toBe(norm(fnDef(MENUS_SQL, "apply_booking_menu")));
  });

  it("先生の指名（guard_booking_menu_teacher）: その日に予約できるメニューが無ければ断る（GB002）", () => {
    const fresh = fnDef(NEW_SQL, "guard_booking_menu_teacher").replace("、または開始日より前", "");
    expect(without(fresh, MENU_STARTED_FOR_NEW)).toBe(norm(fnDef(TEACHER_SQL, "guard_booking_menu_teacher")));
  });
});

describe("権限・最後の定義", () => {
  it("🔴 get_tenant_booked_slots は作り直したあとも未ログイン（体験予約ページ）とログインした人が呼べる", () => {
    const s = stripSql(NEW_SQL);
    const def = s.indexOf("CREATE OR REPLACE FUNCTION public.get_tenant_booked_slots(");
    expect(s.indexOf("GRANT EXECUTE ON FUNCTION public.get_tenant_booked_slots(uuid, date, date) TO anon, authenticated;")).toBeGreaterThan(def);
    expect(s).not.toMatch(/DROP FUNCTION[^\n]*get_tenant_booked_slots/);
  });

  it("ほかの3つは直接呼べない", () => {
    for (const sig of ["menu_reserved_overlaps(uuid, timestamptz, integer)", "apply_booking_menu()", "guard_booking_menu_teacher()"]) {
      expect(NEW_SQL, sig).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
    }
  });

  const lastFile = (name: string) =>
    readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => stripSql(read(`supabase/migrations/${f}`)).includes(`CREATE OR REPLACE FUNCTION public.${name}(`)).pop();

  it.each(["menu_reserved_overlaps", "apply_booking_menu", "guard_booking_menu_teacher"])(
    "🔴 %s の最後の定義はこのマイグレーション（後のマイグレーションが開始日を落としていない）",
    (name) => {
      expect(lastFile(name)).toBe(MIGRATION);
    },
  );

  it("🔴 get_tenant_booked_slots は後で作り直した（20261031010000・体験の担当を返す）。最後の定義も開始日を見ている", () => {
    const last = lastFile("get_tenant_booked_slots")!;
    expect(last >= MIGRATION).toBe(true);
    expect(norm(fnDef(read(`supabase/migrations/${last}`), "get_tenant_booked_slots"))).toContain(norm(MENU_STARTED_ON_DAY));
  });
});

// ── 判定（src/lib/bookingMenus.ts・src/lib/bookingCalendarDay.ts）─────────────
describe("メニューの開始日の読み方", () => {
  it("yyyy-MM-dd だけ読む。読めない値は「すぐ」", () => {
    const menus = parseMenus([
      { id: "a", name: "A", starts_on: "2026-11-25" },
      { id: "b", name: "B", starts_on: "2026/11/25" },
      { id: "c", name: "C", starts_on: 20261125 },
      { id: "d", name: "D" },
    ]);
    expect(menus.map((m) => m.starts_on)).toEqual(["2026-11-25", null, null, null]);
  });

  it("開始日の当日から予約できる。メニューが無い・開始日が無いならいつでも", () => {
    const m = { starts_on: "2026-11-25" };
    expect(isMenuOpenOn(m, "2026-11-24")).toBe(false);
    expect(isMenuOpenOn(m, "2026-11-25")).toBe(true);
    expect(isMenuOpenOn({ starts_on: null }, "2000-01-01")).toBe(true);
    expect(isMenuOpenOn(null, "2000-01-01")).toBe(true);
  });

  it("まだ始まっていないメニューだけ開始日を返す（今日が開始日なら返さない）。表示は「11/25」", () => {
    expect(upcomingMenuStart({ starts_on: "2026-11-25" }, "2026-10-29")).toBe("2026-11-25");
    expect(upcomingMenuStart({ starts_on: "2026-11-25" }, "2026-11-25")).toBeNull();
    expect(upcomingMenuStart({ starts_on: null }, "2026-10-29")).toBeNull();
    expect(menuStartLabel("2026-11-25")).toBe("11/25");
    expect(menuStartLabel("2027-01-05")).toBe("1/5");
  });
});

describe("カレンダー: 選んでいるメニューの開始日より前は選べない", () => {
  // 実際の日付に左右されないよう、過去の固定日と広い予約範囲で組む（bookingCalendarDay.test.ts と同じ）
  const rules = (over: Partial<CalendarDayRules> = {}): CalendarDayRules => ({
    today: "2026-09-22",
    businessHours: { start: "10:00", end: "22:30" },
    closedDays: [],
    hasOwnBookingOn: () => false,
    isDayFull: () => false,
    staffSchedules: null,
    staffUserId: null,
    bookingWindowDays: 60,
    nextCyclePaymentGate: null,
    ...over,
  });

  it("開始日の前日までは menuNotStarted、当日からは選べる", () => {
    expect(dayUnselectableReason("2026-09-29", rules({ menuStartsOn: "2026-09-30" }))).toBe("menuNotStarted");
    expect(dayUnselectableReason("2026-09-30", rules({ menuStartsOn: "2026-09-30" }))).toBeNull();
  });

  it("開始日の無いメニュー・メニューを使っていない店は今まで通り", () => {
    expect(dayUnselectableReason("2026-09-29", rules({ menuStartsOn: null }))).toBeNull();
    expect(dayUnselectableReason("2026-09-29", rules())).toBeNull();
  });

  it("過去日は過去日のまま。開始日より前は「満」より先に当たる（残り枠の「満」を出さない）", () => {
    expect(dayUnselectableReason("2026-09-21", rules({ menuStartsOn: "2026-09-30" }))).toBe("past");
    expect(dayUnselectableReason("2026-09-29", rules({ menuStartsOn: "2026-09-30", isDayFull: () => true }))).toBe("menuNotStarted");
  });
});

// ── 画面 ──────────────────────────────────────────────────────────────────
describe("お客様のメニューの選択", () => {
  const renderPicker = (menus: BookingMenu[], selectedMenuId: string | null) =>
    render(
      <BookingStaffMenuPicker
        menus={menus} selectedMenuId={selectedMenuId} onPickMenu={vi.fn()}
        staff={STAFF} staffSelectable selectedStaffId={null} onPickStaff={vi.fn()}
      />,
    );

  it("まだ始まっていないメニューは名前に開始日（「11/25〜」）。選ぶと開始日を案内する", () => {
    renderPicker([TRAINING, PILATES_LATER], "m-pilates");
    expect(screen.getByRole("button", { name: /Menu-Pilates/ }).textContent).toContain(i18n.t("bookingMenus.startsOnChip", { date: "11/25" }));
    expect(screen.getByTestId("booking-menu-starts-on").textContent)
      .toContain(i18n.t("bookingMenus.startsOnNotice", { name: "Menu-Pilates", date: "11/25" }));
  });

  it("選んでいなければ案内は出さない（名前の「11/25〜」は出す）", () => {
    renderPicker([TRAINING, PILATES_LATER], "m-train");
    expect(screen.getByRole("button", { name: /Menu-Pilates/ }).textContent).toContain(i18n.t("bookingMenus.startsOnChip", { date: "11/25" }));
    expect(screen.queryByTestId("booking-menu-starts-on")).toBeNull();
  });

  it("始まっているメニュー・開始日の無いメニューには何も足さない", () => {
    renderPicker([TRAINING, PILATES_STARTED], "m-pilates");
    expect(screen.getByRole("button", { name: /Menu-Pilates/ }).textContent).toBe("Menu-Pilates");
    expect(screen.getByRole("button", { name: /Menu-Training/ }).textContent).toBe("Menu-Training");
    expect(screen.queryByTestId("booking-menu-starts-on")).toBeNull();
  });
});

describe("メニューの設定: 開始日", () => {
  const pilatesInput = () => screen.getAllByTestId("booking-menu-starts-on-input")[1] as HTMLInputElement;

  it("日付を入れて欄を離れると、そのメニューの starts_on を保存する", async () => {
    view.menus = [TRAINING, { ...PILATES_LATER, starts_on: null }];
    render(<TrainerBookingMenus />);
    fireEvent.change(pilatesInput(), { target: { value: "2026-11-25" } });
    fireEvent.blur(pilatesInput());
    await waitFor(() => expect(db.writes).toHaveLength(1));
    expect(db.writes[0]).toEqual({ table: "booking_menus", op: "update", values: { starts_on: "2026-11-25" }, filters: { id: "m-pilates" } });
  });

  it("同じ日付のまま離れても書かない", () => {
    view.menus = [TRAINING, PILATES_LATER];
    render(<TrainerBookingMenus />);
    expect(pilatesInput().value).toBe("2099-11-25");
    fireEvent.blur(pilatesInput());
    expect(db.writes).toHaveLength(0);
  });

  it("「解除」で開始日を消す（すぐ予約できる）。入っている日付の意味も出す", async () => {
    view.menus = [TRAINING, PILATES_LATER];
    render(<TrainerBookingMenus />);
    expect(screen.getByText(i18n.t("bookingMenus.startsOnSetHint", { date: "11/25" }))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("bookingMenus.startsOnClear") }));
    await waitFor(() => expect(db.writes).toHaveLength(1));
    expect(db.writes[0]).toEqual({ table: "booking_menus", op: "update", values: { starts_on: null }, filters: { id: "m-pilates" } });
  });
});

describe("メニューの読み込み（useBookingMenus）", () => {
  const realHook = async () => (await vi.importActual<typeof import("@/hooks/useBookingMenus")>("@/hooks/useBookingMenus")).useBookingMenus;

  it("開始日も読む", async () => {
    const useBookingMenus = await realHook();
    const { result } = renderHook(() => useBookingMenus());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.menus.map((m) => m.starts_on)).toEqual(["2099-11-25"]);
  });

  it("🔴 開始日の列が無い環境では列を外して読み直す（メニューが消えると担当の選択が出る店に戻ってしまう）", async () => {
    db.missingStartsOn = true;
    const useBookingMenus = await realHook();
    const { result } = renderHook(() => useBookingMenus());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.menus.map((m) => [m.id, m.starts_on])).toEqual([["m1", null]]);
    expect(db.selects).toEqual([
      "id, name, staff_user_id, is_active, sort_order, starts_on",
      "id, name, staff_user_id, is_active, sort_order",
    ]);
  });
});
