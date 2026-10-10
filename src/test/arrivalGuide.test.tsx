/**
 * 「ご来店は 13:55 以降にお願いします」（2026-10-10）。
 *
 * 宗本さん「予約を受けた時にお客様にセッション開始の5分前以内にお越しください。
 * のメッセージを伝えたい。10分前とかに来られると困るから」。
 *
 * 🔴 壊しやすいもの:
 *   1. 引き算を間違える／日をまたぐ（0:03 開始が前日の 23:58 になる）
 *   2. 設定していない店にも出る（他のジムのお客様に「13:55 以降に」と出る）
 *   3. 画面のどれかに出し忘れる（予約完了・ホームの次回の予約・体験予約の完了）
 *   4. 設定の範囲が DB の CHECK とズレる（画面で選べるのに保存できない）
 *   5. 体験予約ページ（未ログイン）に設定が届かない（get_tenant_public が返さない）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import {
  ARRIVAL_LEAD_MAX, ARRIVAL_LEAD_MIN, ARRIVAL_LEAD_OPTIONS, arrivalFromTime, normalizeArrivalLead,
} from "@/lib/arrivalGuide";
import ArrivalNotice from "@/components/booking/ArrivalNotice";
import { TENANT_VALUE_DEFAULTS, normalizeTenantRow, tenantOptionalColumnNames } from "@/lib/tenantColumns";

const tenantRef = { current: null as Record<string, unknown> | null };
const updates: unknown[] = [];
const refetch = vi.fn();

vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ tenant: tenantRef.current, refetch }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (v: unknown) => {
        updates.push(v);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  },
}));

beforeEach(() => {
  tenantRef.current = { id: "t1", gym_name: "テストジム", arrival_lead_minutes: 5 };
  updates.length = 0;
  refetch.mockClear();
});
afterEach(cleanup);

describe("arrivalFromTime（開始時刻 − 何分前）", () => {
  it.each([
    ["14:00", 5, "13:55"],
    ["14:00", 10, "13:50"],
    ["10:00", 15, "09:45"],
    ["9:05", 5, "09:00"],
    ["10:00", 60, "09:00"],
    ["22:30", 3, "22:27"],
  ])("%s の %i 分前から → %s", (start, lead, want) => {
    expect(arrivalFromTime(start, lead)).toBe(want);
  });

  it("日をまたがない（0:03 開始・5分前でも前日の 23:58 にしない）", () => {
    expect(arrivalFromTime("00:03", 5)).toBe("00:00");
    expect(arrivalFromTime("00:00", 5)).toBe("00:00");
  });

  it("🔴 設定が無い・範囲外・整数でないときは出さない（null）", () => {
    for (const lead of [null, undefined, 0, -5, 61, 5.5, Number.NaN, "5", true, {}]) {
      expect(arrivalFromTime("14:00", lead), String(lead)).toBeNull();
    }
  });

  it("開始時刻が読めないときも出さない", () => {
    for (const start of [null, undefined, "", "あ", "25:00", "10:70"]) {
      expect(arrivalFromTime(start, 5), String(start)).toBeNull();
    }
  });

  it("画面で選べる値は、すべて保存できる範囲に収まる", () => {
    expect(ARRIVAL_LEAD_OPTIONS.length).toBeGreaterThan(1);
    for (const n of ARRIVAL_LEAD_OPTIONS) {
      expect(normalizeArrivalLead(n), `${n} 分が範囲外`).toBe(n);
    }
    expect([...ARRIVAL_LEAD_OPTIONS]).toEqual([...ARRIVAL_LEAD_OPTIONS].sort((a, b) => a - b));
    // 宗本さんの要望の「5分」が選べる
    expect(ARRIVAL_LEAD_OPTIONS).toContain(5);
  });
});

describe("ArrivalNotice（お客様に出す一文）", () => {
  it("時刻と理由を出す", () => {
    render(<ArrivalNotice startTime="14:00" lead={5} />);
    expect(screen.getByText(i18n.t("booking.arrivalFrom", { time: "13:55" }))).toBeTruthy();
    expect(screen.getByText(i18n.t("booking.arrivalWhy"))).toBeTruthy();
  });

  it("compact は理由の一文を省く（時刻は出す）", () => {
    render(<ArrivalNotice compact startTime="14:00" lead={10} />);
    expect(screen.getByText(i18n.t("booking.arrivalFrom", { time: "13:50" }))).toBeTruthy();
    expect(screen.queryByText(i18n.t("booking.arrivalWhy"))).toBeNull();
  });

  it("🔴 設定していない店（null・未設定）では何も描かない", () => {
    for (const lead of [null, undefined]) {
      const { container, unmount } = render(<ArrivalNotice startTime="14:00" lead={lead} />);
      expect(container.innerHTML, String(lead)).toBe("");
      unmount();
    }
  });

  it("開始時刻が空なら何も描かない（予約完了ダイアログが閉じている間の空の値）", () => {
    const { container } = render(<ArrivalNotice startTime="" lead={5} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("予約完了ダイアログ（会員）", () => {
  const renderDialog = async () => {
    const { default: BookingCompleteDialog } = await import("@/components/customer/BookingCompleteDialog");
    return render(
      <BookingCompleteDialog
        open
        onClose={() => {}}
        date="2026-10-12"
        startTime="14:00"
        endTime="15:00"
        planName="月4回"
        gymName="テストジム"
      />,
    );
  };

  it("設定している店では、開始の5分前の時刻で案内する", async () => {
    await renderDialog();
    expect(screen.getByText(i18n.t("booking.arrivalFrom", { time: "13:55" }))).toBeTruthy();
  });

  it("🔴 設定していない店では出さない（今まで通り）", async () => {
    tenantRef.current = { id: "t1", gym_name: "テストジム", arrival_lead_minutes: null };
    await renderDialog();
    expect(screen.queryByTestId("arrival-notice")).toBeNull();
  });

  it("列が読めない環境（undefined）でも出さない", async () => {
    tenantRef.current = { id: "t1", gym_name: "テストジム" };
    await renderDialog();
    expect(screen.queryByTestId("arrival-notice")).toBeNull();
  });
});

describe("設定カード（予約のルール）", () => {
  const renderCard = async () => {
    const { default: ArrivalLeadCard } = await import("@/components/trainer/ArrivalLeadCard");
    return render(<ArrivalLeadCard />);
  };

  it("いまの設定が選ばれていて、お客様に出る文の見本が出る", async () => {
    await renderCard();
    expect(screen.getByText(i18n.t("settings.trainer.arrivalLeadOption", { count: 5 }))).toBeTruthy();
    expect(screen.getByTestId("arrival-lead-preview").textContent).toBe(
      i18n.t("settings.trainer.arrivalLeadPreview", { time: "13:55" }),
    );
  });

  it("保存すると tenants.arrival_lead_minutes に書く", async () => {
    await renderCard();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }));
    await waitFor(() => expect(updates).toEqual([{ arrival_lead_minutes: 5 }]));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("🔴 未設定の店は『案内しない』が選ばれ、見本は出さず、保存しても null のまま", async () => {
    tenantRef.current = { id: "t1", gym_name: "テストジム", arrival_lead_minutes: null };
    await renderCard();
    expect(screen.getByText(i18n.t("settings.trainer.arrivalLeadNone"))).toBeTruthy();
    expect(screen.queryByTestId("arrival-lead-preview")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }));
    await waitFor(() => expect(updates).toEqual([{ arrival_lead_minutes: null }]));
  });
});

describe("店の設定の読み込み（tenantColumns）", () => {
  it("取得する列に入っている。列が読めない環境の既定は『出さない』（null）", () => {
    expect(tenantOptionalColumnNames()).toContain("arrival_lead_minutes");
    expect(TENANT_VALUE_DEFAULTS.arrival_lead_minutes).toBeNull();
    expect(normalizeTenantRow({ id: "t1" }).arrival_lead_minutes).toBeNull();
    expect(normalizeTenantRow({ id: "t1", arrival_lead_minutes: 5 }).arrival_lead_minutes).toBe(5);
  });
});

describe("配線とDB", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
  const read = (p: string) => strip(readFileSync(p, "utf8"));
  const SQL = readFileSync("supabase/migrations/20261010010000_arrival_lead_minutes.sql", "utf8").replace(/--[^\n]*/g, "");

  it("🔴 出す3画面すべてに入っている", () => {
    expect(read("src/components/customer/BookingCompleteDialog.tsx")).toContain(
      "<ArrivalNotice startTime={startTime} lead={tenant?.arrival_lead_minutes} />",
    );
    expect(read("src/components/customer/CustomerHome.tsx")).toContain(
      "<ArrivalNotice compact startTime={nextBooking.startTime} lead={tenant?.arrival_lead_minutes} />",
    );
    expect(read("src/pages/TrialBooking.tsx")).toContain(
      "<ArrivalNotice startTime={completedInfo.rawStartTime} lead={tenant?.arrival_lead_minutes} />",
    );
  });

  it("設定カードは『予約のルール』のページに置いてある", () => {
    const src = read("src/components/trainer/TrainerGymSettings.tsx");
    const at = src.indexOf("<ArrivalLeadCard />");
    expect(at, "<ArrivalLeadCard /> が置かれていない").toBeGreaterThan(0);
    // 直前のカテゴリーのガードが rules（他のカテゴリーのブロックの中ではない）
    const before = src.slice(0, at);
    expect(before.lastIndexOf('settingsView === "')).toBe(before.lastIndexOf('settingsView === "rules"'));
  });

  it("🔴 DB の範囲が画面と同じ（1〜60）。NULL が既定", () => {
    expect(SQL).toContain(`BETWEEN ${ARRIVAL_LEAD_MIN} AND ${ARRIVAL_LEAD_MAX}`);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS arrival_lead_minutes integer;/);
    expect(SQL).not.toMatch(/arrival_lead_minutes integer\s+(NOT NULL|DEFAULT)/);
  });

  it("🔴 体験予約ページ（未ログイン）へ get_tenant_public が返す。GRANT を貼り直している", () => {
    expect(SQL).toMatch(/DROP FUNCTION IF EXISTS public\.get_tenant_public\(uuid\);/);
    expect(SQL).toMatch(/arrival_lead_minutes integer\s*\)/);
    expect(SQL).toContain("t.arrival_lead_minutes");
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_tenant_public\(uuid\) TO anon, authenticated, service_role;/);
  });

  it("特定のジムの値を migration に書かない（リポジトリは public）", () => {
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(SQL).not.toMatch(/UPDATE\s+public\.tenants/i);
  });
});
