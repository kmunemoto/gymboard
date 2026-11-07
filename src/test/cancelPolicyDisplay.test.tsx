import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { normalizeTenantRow, TENANT_DEFAULT_FALSE_COLS, TENANT_OPTIONAL_COL_GROUPS } from "@/lib/tenantColumns";
import { showCancelPolicyAt, type CancelPolicyPlace } from "@/lib/cancelPolicyDisplay";
import CancelPolicyPlacementSwitch from "@/components/trainer/CancelPolicyPlacementSwitch";

// キャンセルについての案内（tenants.cancel_policy_body）を、お客様の画面のどこに出すか（2026-11-07）。
//
// 宗本さん「予約するページの上のキャンセルについてを出さなくていい。当日キャンセルされる場合にだけ出して。
//          前日より前のキャンセル、つまり通常のキャンセルも出さなくていい。
//          当日のキャンセルと明日以降への日時変更の際だけ表示されるようにして」
//
// ジムごとの設定 tenants.cancel_policy_same_day_only（既定 false＝今まで通り）。決まりは src/lib/cancelPolicyDisplay.ts。
// 案内そのもの（既定文を持たない・空欄なら出さない・消化の警告が優先 等）は cancelPolicy.test.ts。
//
// ── 変異テスト（2026-11-07 実施・どれも赤を確認）──────────────────────────
//   1. ON でも予約画面の上に出す（bookingTop を true に）                 → 赤
//   2. ON でキャンセルの確認を日付を見ずに出す                            → 赤
//   3. ON で当日の予約を明日以降へ変える確認に出さない                      → 赤
//   4. OFF で当日の予約を明日以降へ変える確認にも出す（今まで通りでなくなる） → 赤
//   5. 画面のつなぎ: キャンセルの確認に予約の日付を渡さない                 → 赤
//   6. スイッチが別の列を保存する                                         → 赤

// ── モック（設定のスイッチ） ─────────────────────────────────────────────
const tenantRef = { current: { id: "t1", cancel_policy_same_day_only: false } as Record<string, unknown> | null };
const tenantUpdates: Record<string, unknown>[] = [];
const updateError = { current: null as unknown };
const refetchTenant = vi.fn();
const toasts: string[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (values: Record<string, unknown>) => {
        tenantUpdates.push(values);
        return { eq: () => Promise.resolve({ error: updateError.current }) };
      },
    }),
  },
}));
vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ tenant: tenantRef.current, refetch: refetchTenant }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => toasts.push(`ok:${m}`),
    error: (m: string) => toasts.push(`ng:${m}`),
  },
}));

beforeEach(() => {
  tenantUpdates.length = 0;
  toasts.length = 0;
  updateError.current = null;
  refetchTenant.mockClear();
});
afterEach(cleanup);

const TODAY = "2026-11-07";
const at = (place: CancelPolicyPlace, sameDayOnly: boolean, targetDate?: string | null) =>
  showCancelPolicyAt(place, { sameDayOnly, targetDate, today: TODAY });

// ── 決まり ──────────────────────────────────────────────────────────────
describe("決まり: showCancelPolicyAt", () => {
  it("OFF（既定）: 今まで通り、予約画面の上とキャンセルの確認（日付を問わず）に出し、変更の確認には出さない", () => {
    expect(at("bookingTop", false)).toBe(true);
    expect(at("cancelConfirm", false, "2026-11-08")).toBe(true);
    expect(at("cancelConfirm", false, TODAY)).toBe(true);
    expect(at("rescheduleForfeit", false, TODAY)).toBe(false);
  });

  it("ON: 予約画面の上には出さない", () => {
    expect(at("bookingTop", true)).toBe(false);
    expect(at("bookingTop", true, TODAY)).toBe(false);
  });

  it("ON: キャンセルの確認は当日の予約だけ（前日までの予約＝ふだんのキャンセルには出さない）", () => {
    expect(at("cancelConfirm", true, TODAY)).toBe(true);
    expect(at("cancelConfirm", true, "2026-11-08")).toBe(false);
    expect(at("cancelConfirm", true, "2026-12-07")).toBe(false);
    expect(at("cancelConfirm", true, null)).toBe(false);
    expect(at("cancelConfirm", true, undefined)).toBe(false);
  });

  it("ON: 当日の予約を明日以降へ変える確認（消化）に出す", () => {
    expect(at("rescheduleForfeit", true, TODAY)).toBe(true);
    // 当日の予約でなければ出さない（その確認自体が出ないが、決まりとしても閉じておく）
    expect(at("rescheduleForfeit", true, "2026-11-08")).toBe(false);
  });
});

// ── お客様の画面のつなぎ方 ──────────────────────────────────────────────
describe("お客様の画面: CustomerBooking のつなぎ方", () => {
  const src = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");

  it("ジムの設定は `=== true` で読み、今日は JST で渡している", () => {
    expect(src).toMatch(/sameDayOnly: tenant\?\.cancel_policy_same_day_only === true/);
    expect(src).toMatch(/showCancelPolicyAt\(place, \{[^}]*today: getJSTToday\(\)/);
  });

  it("予約画面の上: bookingTop で決める", () => {
    expect(src).toMatch(/\{cancelPolicy && policyShownAt\("bookingTop"\) && \(/);
  });

  it("キャンセルの確認: キャンセルする予約の日付で決める。消化の警告が出ている間はそちらが優先（今まで通り）", () => {
    expect(src).toMatch(/\{!forfeitPending && cancelPolicy && policyShownAt\("cancelConfirm", cancelTarget\.date\) && \(/);
  });

  it("当日の予約を明日以降へ変える確認（消化）のダイアログの中に出す", () => {
    const start = src.indexOf("{rescheduleForfeitPending && (");
    const end = src.indexOf("{waitlistTarget && (", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const dialog = src.slice(start, end);
    expect(dialog).toMatch(/\{cancelPolicy && policyShownAt\("rescheduleForfeit", rescheduleTarget\?\.date\) && \(/);
    expect(dialog).toContain("{cancelPolicy}");
  });

  it("3か所とも、決まりを通してから出す（直書きで出したり隠したりしない）・改行を保持する", () => {
    expect(src.match(/policyShownAt\(/g)?.length).toBe(3);
    const idxs = [...src.matchAll(/\{cancelPolicy\}/g)].map((m) => m.index ?? -1);
    expect(idxs.length).toBe(3);
    for (const i of idxs) expect(src.slice(Math.max(0, i - 300), i)).toContain("whitespace-pre-line");
  });
});

// ── 設定のスイッチ ───────────────────────────────────────────────────────
describe("設定: CancelPolicyPlacementSwitch", () => {
  const sw = () => screen.getByRole("switch", { name: i18n.t("settings.trainer.cancelPolicySameDayOnlyTitle") });

  it("押すと自分の列だけを保存して、ジムの設定を読み直す", async () => {
    tenantRef.current = { id: "t1", cancel_policy_same_day_only: false };
    render(<CancelPolicyPlacementSwitch />);
    expect(sw()).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw());
    await waitFor(() => expect(tenantUpdates).toEqual([{ cancel_policy_same_day_only: true }]));
    await waitFor(() => expect(refetchTenant).toHaveBeenCalled());
    expect(toasts).toEqual([`ok:${i18n.t("settings.trainer.cancelPolicySaved")}`]);
  });

  it("オンのジムではオンに見え、押すとオフで保存する", async () => {
    tenantRef.current = { id: "t1", cancel_policy_same_day_only: true };
    render(<CancelPolicyPlacementSwitch />);
    expect(sw()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw());
    await waitFor(() => expect(tenantUpdates).toEqual([{ cancel_policy_same_day_only: false }]));
  });

  it("保存に失敗したら失敗を出し、読み直さない", async () => {
    tenantRef.current = { id: "t1", cancel_policy_same_day_only: false };
    updateError.current = { message: "denied" };
    render(<CancelPolicyPlacementSwitch />);
    fireEvent.click(sw());
    await waitFor(() => expect(toasts).toEqual([`ng:${i18n.t("settings.trainer.cancelPolicySaveFailed")}`]));
    expect(refetchTenant).not.toHaveBeenCalled();
    await waitFor(() => expect(sw()).not.toBeDisabled());
  });

  it("列が読めない環境（undefined）ではオフに見える", () => {
    tenantRef.current = { id: "t1" };
    render(<CancelPolicyPlacementSwitch />);
    expect(sw()).toHaveAttribute("aria-checked", "false");
  });

  it("ジムの設定の、キャンセルについての案内の入力欄と同じカードに置いてある", () => {
    const settings = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");
    const input = settings.indexOf('id="cancel-policy"');
    const placed = settings.indexOf("<CancelPolicyPlacementSwitch />");
    expect(input).toBeGreaterThan(-1);
    expect(placed).toBeGreaterThan(input);
    expect(settings.slice(input, placed)).not.toContain("</Card>");
  });
});

// ── DB・テナントの列・文言 ───────────────────────────────────────────────
describe("DB とテナントの列", () => {
  const sql = readFileSync("supabase/migrations/20261107030000_cancel_policy_same_day_only.sql", "utf8");
  const body = sql.replace(/--[^\n]*/g, "");

  it("既定 false（今まで通り）・NOT NULL で足す", () => {
    expect(body).toMatch(/ADD COLUMN IF NOT EXISTS cancel_policy_same_day_only boolean NOT NULL DEFAULT false/);
  });

  it("🔴 特定のジムを ON にしていない（公開リポジトリ。値は本番で個別に入れる）", () => {
    expect(body).not.toMatch(/UPDATE\s+public\.tenants/i);
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("表示だけの設定で、予約・キャンセルの見張り（関数・トリガー・ポリシー）を触っていない", () => {
    expect(body).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION|CREATE\s+TRIGGER|(CREATE|ALTER|DROP)\s+POLICY/i);
  });

  it("テナントの列: 後から足した列に入っていて、読めないときは OFF（今まで通り）", () => {
    expect(TENANT_OPTIONAL_COL_GROUPS).toContain("cancel_policy_same_day_only");
    expect(TENANT_DEFAULT_FALSE_COLS).toContain("cancel_policy_same_day_only");
    expect(normalizeTenantRow({}).cancel_policy_same_day_only).toBe(false);
    expect(normalizeTenantRow({ cancel_policy_same_day_only: true }).cancel_policy_same_day_only).toBe(true);
  });

  it("5言語すべてにスイッチの文言がある", () => {
    for (const loc of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const d = JSON.parse(readFileSync(`src/locales/${loc}.json`, "utf8"));
      expect(d.settings?.trainer?.cancelPolicySameDayOnlyTitle, `${loc}: title`).toBeTruthy();
      expect(d.settings?.trainer?.cancelPolicySameDayOnlyDesc, `${loc}: desc`).toBeTruthy();
    }
  });
});
