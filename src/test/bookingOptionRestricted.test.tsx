/**
 * 予約のオプションを、店が指定したお客様だけに出す（2026-10-26）。
 *
 * 宗本さん「オプションをお店が指定した特定のお客様だけがアプリから予約の際に選べる様に
 * できる機能を追加して」。
 *
 * 🔴 壊しやすいもの:
 *   1. 出し分けを画面でやる → 古いアプリには効かない（DB の読み取り権限でやる）
 *   2. 公開ページ用の RPC が限定オプションを返す
 *   3. DB のガードが店の代理予約・日時の変更での引き継ぎまで止める
 *   4. 保存で「選べるお客様」を全部消して入れ直す／新しいオプションの id を取り違える
 *   5. GB010 を知らないまま出荷して、最新のアプリに「更新してください」と出る
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import {
  RESTRICTED_OPTION_SQLSTATE,
  allowedCustomersDiff,
  filterCustomersByName,
  isRestrictedOptionError,
} from "@/lib/bookingOptionAccess";
import { KNOWN_GUARD_CODES, bookingErrorKey, isAppOutdatedError } from "@/lib/bookingErrors";

// ── 偽の DB（テーブルを区別する）──────────────────────────────────────────
type Opt = {
  id: string; tenant_id: string; name: string; duration_minutes: number; price_yen: number;
  description: string | null; enabled: boolean; restricted: boolean; sort_order: number; created_at: number;
};
type Allowed = { option_id: string; user_id: string; tenant_id: string };
const TENANT = "t-1";
const db = { options: [] as Opt[], allowed: [] as Allowed[], seq: 0, clock: 0, writes: [] as string[] };

const makeBuilder = (table: string) => {
  let op: "select" | "insert" | "update" | "delete" = "select";
  let payload: Record<string, unknown>[] = [];
  const eqs: [string, unknown][] = [];
  const ins: [string, unknown[]][] = [];
  let notIn: { col: string; values: string[] } | null = null;
  let wantIds = false;
  const rowsOf = (): Record<string, unknown>[] =>
    (table === "booking_option_customers" ? db.allowed : db.options) as unknown as Record<string, unknown>[];
  const matches = (r: Record<string, unknown>) =>
    eqs.every(([c, v]) => r[c] === v) &&
    ins.every(([c, vs]) => vs.includes(r[c])) &&
    (!notIn || !notIn.values.includes(String(r[notIn.col])));

  const run = () => {
    if (op === "select") {
      if (table !== "booking_options") return { data: rowsOf().filter(matches), error: null };
      const data = db.options.filter((o) => matches(o as unknown as Record<string, unknown>))
        .slice().sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at)
        .map((o) => ({ ...o, booking_option_customers: db.allowed.filter((c) => c.option_id === o.id).map((c) => ({ user_id: c.user_id })) }));
      return { data, error: null };
    }
    if (op === "insert") {
      db.writes.push(`${table}:insert`);
      if (table === "booking_option_customers") {
        db.allowed.push(...(payload as unknown as Allowed[]));
        return { data: null, error: null };
      }
      const created = payload.map((v) => ({ ...(v as unknown as Opt), id: `db-${++db.seq}`, created_at: ++db.clock }));
      db.options.push(...created);
      return { data: wantIds ? created.map((r) => ({ id: r.id })) : null, error: null };
    }
    if (op === "update") {
      db.writes.push(`${table}:update`);
      db.options = db.options.map((r) => (matches(r as unknown as Record<string, unknown>) ? { ...r, ...(payload[0] as Partial<Opt>) } : r));
      return { data: null, error: null };
    }
    db.writes.push(`${table}:delete`);
    if (table === "booking_option_customers") db.allowed = db.allowed.filter((r) => !matches(r as unknown as Record<string, unknown>));
    else db.options = db.options.filter((r) => !matches(r as unknown as Record<string, unknown>));
    return { data: null, error: null };
  };

  const b = {
    select: () => { if (op === "insert") wantIds = true; return b; },
    insert: (v: Record<string, unknown> | Record<string, unknown>[]) => { op = "insert"; payload = Array.isArray(v) ? v : [v]; return b; },
    update: (v: Record<string, unknown>) => { op = "update"; payload = [v]; return b; },
    delete: () => { op = "delete"; return b; },
    eq: (c: string, v: unknown) => { eqs.push([c, v]); return b; },
    in: (c: string, vs: unknown[]) => { ins.push([c, vs]); return b; },
    order: () => b,
    not: (col: string, _op: string, list: string) => {
      notIn = { col, values: list.replace(/^\(/, "").replace(/\)$/, "").split(",").filter(Boolean) };
      return b;
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  };
  return b;
};

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => makeBuilder(table) } }));
vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ tenant: { id: TENANT, name: "テストジム" }, membership: null, role: "owner", plans: [], loading: false, refetch: vi.fn() }),
}));
const PROFILES = [
  { user_id: "u-a", display_name: "会員A", name_kana: "かいいんえー" },
  { user_id: "u-b", display_name: "会員B", name_kana: "かいいんびー" },
  { user_id: "u-c", display_name: null, name_kana: null },
];
vi.mock("@/hooks/useProfile", () => ({ useAllCustomerProfiles: () => ({ profiles: PROFILES, loading: false, refetch: vi.fn() }) }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) } }));

const seedOption = (o: Partial<Opt>) => {
  const row: Opt = {
    id: o.id ?? `seed-${db.options.length + 1}`, tenant_id: TENANT, name: o.name ?? "追加メニューA", duration_minutes: 30,
    price_yen: 3000, description: null, enabled: true, restricted: o.restricted ?? false, sort_order: db.options.length,
    created_at: ++db.clock,
  };
  db.options.push(row);
  return row;
};

const renderCard = async () => {
  const { default: TrainerBookingOptions } = await import("@/components/trainer/TrainerBookingOptions");
  render(<TrainerBookingOptions />);
  await waitFor(() => expect(screen.getByText(i18n.t("bookingOptions.section"))).toBeTruthy());
};
const save = async () => {
  fireEvent.click(screen.getByText(i18n.t("common.save")));
  await waitFor(() => expect(screen.queryByText(i18n.t("common.saving"))).toBeNull());
};

beforeEach(() => {
  db.options = []; db.allowed = []; db.seq = 0; db.clock = 0; db.writes = [];
  toastError.mockClear();
});
afterEach(cleanup);

// ── 仕組み ───────────────────────────────────────────────────────────────
describe("選べるお客様の差分・名前で探す・GB010", () => {
  it("保存は差分だけ（全部消して入れ直さない）", () => {
    expect(allowedCustomersDiff(["a", "b"], ["b", "c"])).toEqual({ add: ["c"], remove: ["a"] });
    expect(allowedCustomersDiff(["a"], ["a"])).toEqual({ add: [], remove: [] });
  });

  it("名前とふりがなで探す。空なら全員", () => {
    expect(filterCustomersByName(PROFILES, "").length).toBe(3);
    expect(filterCustomersByName(PROFILES, "会員a").map((p) => p.user_id)).toEqual(["u-a"]);
    expect(filterCustomersByName(PROFILES, "びー").map((p) => p.user_id)).toEqual(["u-b"]);
  });

  it("🔴 GB010 はこのアプリが知っている規則（「更新してください」にしない）で、専用の文言を出す", () => {
    const err = { code: RESTRICTED_OPTION_SQLSTATE, message: "このオプションは選べません" };
    expect(KNOWN_GUARD_CODES).toContain("GB010");
    expect(isAppOutdatedError(err)).toBe(false);
    expect(isRestrictedOptionError(err)).toBe(true);
    expect(bookingErrorKey(err)).toBe("bookingOptions.errorRestricted");
    expect(isRestrictedOptionError({ code: "GB008" })).toBe(false);
  });
});

// ── 設定画面 ─────────────────────────────────────────────────────────────
describe("設定（予約のルール → 予約のオプション）", () => {
  it("限定のオプションは、選んでいる人数が出る", async () => {
    const o = seedOption({ restricted: true });
    db.allowed.push({ option_id: o.id, user_id: "u-a", tenant_id: TENANT }, { option_id: o.id, user_id: "u-b", tenant_id: TENANT });
    await renderCard();
    await waitFor(() => expect(screen.getByText(i18n.t("bookingOptions.restrictedCount", { count: 2 }))).toBeTruthy());
  });

  it("オンにしただけ（誰も選んでいない）なら、誰にも出ないと分かる表示", async () => {
    seedOption({ restricted: false });
    await renderCard();
    await waitFor(() => expect(screen.getByLabelText(i18n.t("bookingOptions.restrictedLabel"))).toBeTruthy());
    expect(screen.queryByText(i18n.t("bookingOptions.chooseCustomers"))).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: i18n.t("bookingOptions.restrictedLabel") }));
    expect(screen.getByText(i18n.t("bookingOptions.restrictedNone"))).toBeTruthy();
    await save();
    expect(db.options[0].restricted).toBe(true);
    expect(db.writes).not.toContain("booking_option_customers:insert"); // 選んでいないので書かない
  });

  it("🔴 お客様を選んで保存すると、差分だけ書く（足した人だけ入れ、外した人だけ消す）", async () => {
    const o = seedOption({ restricted: true });
    db.allowed.push({ option_id: o.id, user_id: "u-a", tenant_id: TENANT });
    await renderCard();
    fireEvent.click(await screen.findByText(i18n.t("bookingOptions.chooseCustomers")));
    const list = await screen.findByTestId("option-customers-list");
    // A を外して B を足す（名前の無い人は「名前未登録」と出る）
    expect(within(list).getByText(i18n.t("bookingOptions.customerNoName"))).toBeTruthy();
    const box = (name: string) => within(list).getByText(name).closest("label")!.querySelector("button")!;
    fireEvent.click(box("会員A"));
    fireEvent.click(box("会員B"));
    fireEvent.click(screen.getByText(i18n.t("bookingOptions.customersDone")));
    expect(screen.getByText(i18n.t("bookingOptions.restrictedCount", { count: 1 }))).toBeTruthy();
    expect(db.allowed.map((c) => c.user_id)).toEqual(["u-a"]); // 決定しただけでは書かない
    await save();
    expect(db.allowed).toEqual([{ option_id: o.id, user_id: "u-b", tenant_id: TENANT }]);
    expect(db.writes.filter((w) => w.startsWith("booking_option_customers"))).toEqual([
      "booking_option_customers:delete",
      "booking_option_customers:insert",
    ]);
  });

  it("🔴 新しく足したオプションの「選べるお客様」は、採番された id で入る", async () => {
    seedOption({ name: "既存" });
    await renderCard();
    fireEvent.click(screen.getByText(i18n.t("bookingOptions.addOption")));
    const names = screen.getAllByPlaceholderText(i18n.t("bookingOptions.namePlaceholder"));
    fireEvent.change(names[names.length - 1], { target: { value: "追加メニューB" } });
    const switches = screen.getAllByRole("switch", { name: i18n.t("bookingOptions.restrictedLabel") });
    fireEvent.click(switches[switches.length - 1]);
    fireEvent.click(screen.getByText(i18n.t("bookingOptions.chooseCustomers")));
    const list = await screen.findByTestId("option-customers-list");
    fireEvent.click(within(list).getByText("会員B").closest("label")!.querySelector("button")!);
    fireEvent.click(screen.getByText(i18n.t("bookingOptions.customersDone")));
    await save();
    const added = db.options.find((x) => x.name === "追加メニューB")!;
    expect(added.restricted).toBe(true);
    expect(db.allowed).toEqual([{ option_id: added.id, user_id: "u-b", tenant_id: TENANT }]);
  });

  it("キャンセルしたら選び直しは残らない", async () => {
    const o = seedOption({ restricted: true });
    db.allowed.push({ option_id: o.id, user_id: "u-a", tenant_id: TENANT });
    await renderCard();
    fireEvent.click(await screen.findByText(i18n.t("bookingOptions.chooseCustomers")));
    const list = await screen.findByTestId("option-customers-list");
    fireEvent.click(within(list).getByText("会員B").closest("label")!.querySelector("button")!);
    fireEvent.click(screen.getByText(i18n.t("common.cancel")));
    expect(screen.getByText(i18n.t("bookingOptions.restrictedCount", { count: 1 }))).toBeTruthy();
  });
});

// ── 店側の選択欄・読み込み ─────────────────────────────────────────────────
describe("店側の選択欄（代理予約・あとから足す）", () => {
  it("限定のオプションに「限定」と出す", async () => {
    const { default: BookingOptionPicker } = await import("@/components/booking/BookingOptionPicker");
    render(
      <BookingOptionPicker
        options={[{ id: "o1", name: "追加メニューA", duration_minutes: 30, price_yen: 3000, restricted: true }, { id: "o2", name: "追加メニューB", duration_minutes: 0, price_yen: 500 }]}
        selectedIds={[]}
        onToggle={() => {}}
      />,
    );
    expect(screen.getAllByText(i18n.t("bookingOptions.restrictedBadge")).length).toBe(1);
  });

  it("オプションの読み込みは restricted も取る（お客様には DB が指定された分だけ返す）", async () => {
    seedOption({ restricted: true });
    const { useBookingOptions } = await import("@/hooks/useBookingOptions");
    const { result } = renderHook(() => useBookingOptions());
    await waitFor(() => expect(result.current.options.length).toBe(1));
    expect(result.current.options[0].restricted).toBe(true);
    expect(readFileSync("src/hooks/useBookingOptions.ts", "utf8")).toContain("sort_order, restricted\")");
  });
});

// ── DB ──────────────────────────────────────────────────────────────────
const SQL = readFileSync("supabase/migrations/20261026020000_booking_option_customers.sql", "utf8").replace(/--[^\n]*/g, "");
const body = (name: string) => {
  const i = SQL.indexOf(`FUNCTION public.${name}(`);
  return SQL.slice(i, SQL.indexOf("$fn$;", i));
};

describe("DB", () => {
  it("限定かどうかの列は既定 false（今まで通り全員に出る）。特定のジムの値は書かない", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false/);
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("選べるお客様の表: オプションを消したら一緒に消える・未ログインは読めない・読み書きは店のスタッフだけ", () => {
    expect(SQL).toMatch(/option_id\s+uuid NOT NULL REFERENCES public\.booking_options\(id\) ON DELETE CASCADE/);
    expect(SQL).toContain("PRIMARY KEY (option_id, user_id)");
    expect(SQL).toContain("ALTER TABLE public.booking_option_customers ENABLE ROW LEVEL SECURITY;");
    expect(SQL).toContain("REVOKE ALL ON public.booking_option_customers FROM anon;");
    for (const p of ["booking_option_customers_select", "booking_option_customers_insert", "booking_option_customers_delete"]) {
      const i = SQL.indexOf(`CREATE POLICY ${p}`);
      expect(SQL.slice(i, SQL.indexOf(";", i)), p).toContain("has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])");
    }
    // 入れられるのは同じジムのオプションと、そのジムの在籍者だけ
    const ins = SQL.slice(SQL.indexOf("CREATE POLICY booking_option_customers_insert"));
    expect(ins).toContain("o.tenant_id = booking_option_customers.tenant_id");
    expect(ins).toContain("public.is_tenant_member(tenant_id, user_id)");
    expect(SQL).toMatch(/CREATE POLICY tenant_isolation ON public\.booking_option_customers AS RESTRICTIVE/);
  });

  it("🔴 出し分けは読み取り権限で（古いアプリにも効く）: 限定は店のスタッフと指定されたお客様だけ", () => {
    const i = SQL.indexOf("CREATE POLICY booking_options_select");
    const pol = SQL.slice(i, SQL.indexOf(";", i));
    expect(pol).toContain("public.is_tenant_member(tenant_id, auth.uid())");
    expect(pol).toContain("NOT restricted");
    expect(pol).toContain("has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])");
    expect(pol).toContain("public.booking_option_allowed(id, auth.uid())");
    expect(SQL).toContain("DROP POLICY IF EXISTS booking_options_select ON public.booking_options;");
  });

  it("🔴 公開ページ用（未ログイン）は限定のものを返さない", () => {
    expect(body("get_tenant_booking_options")).toContain("AND NOT o.restricted");
  });

  it("🔴 DB のガード（GB010）: お客様の自己予約だけ。取り込み・店の代理予約・日時の変更での引き継ぎは通す", () => {
    const g = body("guard_booking_restricted_options");
    const at = (s: string) => g.indexOf(s);
    expect(at("salute_sync")).toBeGreaterThan(0);
    expect(at("v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id")).toBeGreaterThan(at("salute_sync"));
    expect(at("'reschedule'")).toBeGreaterThan(at("v_actor IS NULL"));
    expect(at("ERRCODE = 'GB010'")).toBeGreaterThan(at("'reschedule'"));
    expect(g).toContain("o.restricted");
    expect(g).toContain("c.user_id = NEW.user_id");
    // trial_bookings にこの列は無いので NEW を直接読まない（予約の控えは to_jsonb で読む）
    expect(g).toContain("to_jsonb(NEW) -> 'booking_options'");
    expect(SQL).toMatch(/CREATE TRIGGER trg_guard_booking_restricted_options\s+BEFORE INSERT ON public\.bookings/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.guard_booking_restricted_options\(\) FROM PUBLIC, anon, authenticated;/);
  });
});

describe("文言（5言語）", () => {
  const KEYS = [
    "restrictedLabel", "restrictedHelp", "restrictedCount", "restrictedNone", "chooseCustomers", "customersDialogTitle",
    "customersDialogDesc", "customersSearch", "customersEmpty", "customersDone", "customerNoName", "untitled",
    "restrictedBadge", "errorRestricted",
  ];
  it("14のキーが5言語そろっている", () => {
    for (const l of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const o = JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8")).bookingOptions;
      for (const k of KEYS) expect(o[k], `${l} ${k}`).toBeTruthy();
      expect(o.restrictedCount, l).toContain("{{count}}");
      expect(o.customersDialogTitle, l).toContain("{{name}}");
    }
  });
});
