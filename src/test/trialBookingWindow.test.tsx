import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";
import {
  isBeyondBookingWindow, LEGACY_GUEST_WINDOW_DAYS, trialBookingWindowDays,
} from "@/lib/bookingWindow";
import { menuTrialWindowEndKey } from "@/lib/menuTrial";
import { normalizeTenantRow, TENANT_OPTIONAL_COL_GROUPS, TENANT_VALUE_DEFAULTS } from "@/lib/tenantColumns";
import * as server from "../../supabase/functions/_shared/trialRules";
import TrialWindowCard from "@/components/trainer/TrialWindowCard";

// 体験予約だけの「何日先まで受け付けるか」（tenants.trial_booking_window_days・ジムごと・2026-11-08）。
//
// 宗本さん「体験の受付を2週間先までに延ばしたい」。
// 「何日先まで」（booking_window_days）は会員の予約と共通で、未設定なら会員1ヶ月・体験10日。
// 14 にすると会員まで縮むので、体験だけの設定を足した（未設定なら今まで通り）。
//
// ── 変異テスト（2026-11-08 実施・どれも赤を確認）──────────────────────────
//   1. 画面: 体験だけの設定を見ない（booking_window_days だけ）         → 赤
//   2. 画面: 体験だけの設定が不正なとき、予約全体の設定に戻らない         → 赤
//   3. サーバー: 体験だけの設定を見ない（画面と答えがずれる）             → 赤
//   4. 会員の予約カレンダーが体験だけの設定を見る（会員まで変わる）       → 赤
//   5. 設定の欄が「未設定」を null でなく保存する                        → 赤

// ── モック（設定の欄） ───────────────────────────────────────────────────
const tenantRef = { current: { id: "t1", trial_booking_window_days: null } as Record<string, unknown> | null };
const updates: Record<string, unknown>[] = [];
const updateError = { current: null as unknown };
const refetchTenant = vi.fn();
const toasts: string[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (values: Record<string, unknown>) => {
        updates.push(values);
        return { eq: () => Promise.resolve({ error: updateError.current }) };
      },
    }),
  },
}));
vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ tenant: tenantRef.current, refetch: refetchTenant }),
}));
vi.mock("sonner", () => ({
  toast: { success: (m: string) => toasts.push(`ok:${m}`), error: (m: string) => toasts.push(`ng:${m}`) },
}));
// Radix の Select は jsdom で開けないので、ふつうの <select> に置き換えて「選んだら保存する」を見る
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: { value: string; onValueChange: (v: string) => void; disabled?: boolean; children: ReactNode }) => (
    <select aria-label="window" value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));

beforeEach(() => {
  updates.length = 0;
  toasts.length = 0;
  updateError.current = null;
  refetchTenant.mockClear();
});
afterEach(cleanup);

// 2026-11-08 10:00 JST（getJSTNow と同じ「壁時計」の Date）
const NOW = new Date(2026, 10, 8, 10, 0);
const lastDay = (trial: unknown, general: unknown) => {
  // 受け付ける最終日（その日は取れて、翌日は取れない）を探す
  for (let d = 1; d <= 400; d++) {
    const date = new Date(2026, 10, 8 + d);
    const k = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (isBeyondBookingWindow(k, trialBookingWindowDays(trial, general), { days: LEGACY_GUEST_WINDOW_DAYS }, NOW)) return d - 1;
  }
  return -1;
};

// ── 決まり ──────────────────────────────────────────────────────────────
describe("決まり: trialBookingWindowDays（画面）", () => {
  it("体験だけの設定 → 予約全体の設定 → 未設定（null）の順", () => {
    expect(trialBookingWindowDays(14, null)).toBe(14);
    expect(trialBookingWindowDays(14, 30)).toBe(14);
    expect(trialBookingWindowDays(null, 30)).toBe(30);
    expect(trialBookingWindowDays(undefined, undefined)).toBeNull();
  });

  it("体験だけの設定が使えない値なら、予約全体の設定に戻る（0 を「当日のみ」にしない）", () => {
    expect(trialBookingWindowDays(0, 30)).toBe(30);
    expect(trialBookingWindowDays(999, null)).toBeNull();
    expect(trialBookingWindowDays("14", 20)).toBe(20);
  });

  it("体験ページで選べる最終日: 未設定は今まで通り10日先、14日にすると14日先（上限日の当日は取れる）", () => {
    expect(lastDay(null, null)).toBe(10);
    expect(lastDay(14, null)).toBe(14);
    expect(lastDay(null, 30)).toBe(30);
  });

  it("メニューの体験（開始日がまだ先）は開始日の前日から数える: 11/25 開始・14日 → 12/8 まで", () => {
    expect(menuTrialWindowEndKey("2026-11-25", trialBookingWindowDays(14, null), NOW)).toBe("2026-12-08");
    expect(menuTrialWindowEndKey("2026-11-25", trialBookingWindowDays(null, null), NOW)).toBe("2026-12-04");
  });
});

describe("🔴 画面とサーバー（trial-book）が同じ日数を返す", () => {
  it("どの組み合わせでも、サーバーの日数 = 画面の日数（未設定は10日）", () => {
    const values: unknown[] = [null, undefined, 0, 1, 7, 14, 30, 365, 366, -3, 13.7, "14", Number.NaN];
    for (const trial of values) {
      for (const general of values) {
        expect(server.trialWindowDays(trial, general), `trial=${String(trial)} general=${String(general)}`)
          .toBe(trialBookingWindowDays(trial, general) ?? LEGACY_GUEST_WINDOW_DAYS);
      }
    }
    expect(server.LEGACY_GUEST_WINDOW_DAYS).toBe(LEGACY_GUEST_WINDOW_DAYS);
  });
});

// ── つなぎ方 ────────────────────────────────────────────────────────────
describe("つなぎ方", () => {
  it("体験予約ページ: 通常の体験もメニューの体験も、体験だけの設定を見る", () => {
    const src = readFileSync("src/pages/TrialBooking.tsx", "utf8");
    expect(src).toMatch(/const trialWindow = trialBookingWindowDays\(tenant\?\.trial_booking_window_days, tenant\?\.booking_window_days\);/);
    expect(src).toMatch(/menuTrialWindowEndKey\(menu\.startsOn, trialWindow\)/);
    expect(src).toMatch(/isBeyondBookingWindow\(yyyyMMdd, trialWindow, \{ days: LEGACY_GUEST_WINDOW_DAYS \}\)/);
    expect(src).not.toMatch(/menuTrialWindowEndKey\(menu\.startsOn, tenant\?\.booking_window_days/);
  });

  it("trial-book: 列を読み、画面と同じ決め方で日数を出す", () => {
    const src = readFileSync("supabase/functions/trial-book/index.ts", "utf8");
    expect(src).toMatch(/\.select\("[^"]*\bbooking_window_days, trial_booking_window_days[^"]*"\)/);
    expect(src).toContain("const windowDays = trialWindowDays(tenant.trial_booking_window_days, tenant.booking_window_days);");
    expect(src).not.toMatch(/normalizeWindowDays\(tenant\.booking_window_days\)/);
  });

  it("🔴 会員の予約・ドロップインは今まで通り（体験だけの設定を見ない）", () => {
    for (const f of [
      "src/components/customer/CustomerBooking.tsx",
      "src/lib/bookingCalendarDay.ts",
      "src/pages/DropInBooking.tsx",
    ]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/trial_booking_window_days|trialBookingWindowDays/);
    }
  });

  it("ジムの設定の「体験予約」カテゴリーに置いてある", () => {
    const src = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");
    const trialSection = src.indexOf('TRIAL_BOOKING_ENABLED && settingsView === "trial"');
    const card = src.indexOf("<TrialWindowCard />");
    const nextSection = src.indexOf('settingsView === "comms"', trialSection);
    expect(trialSection).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(trialSection);
    expect(card).toBeLessThan(nextSection);
  });
});

// ── 設定の欄 ────────────────────────────────────────────────────────────
describe("設定: TrialWindowCard", () => {
  const select = () => screen.getByRole("combobox") as HTMLSelectElement;

  it("未設定なら「未設定」を選んだ状態。14 を選ぶと、その列だけを保存して読み直す", async () => {
    tenantRef.current = { id: "t1", trial_booking_window_days: null };
    render(<TrialWindowCard />);
    expect(select().value).toBe("unset");
    expect(screen.getByText(i18n.t("settings.trainer.trialWindowUnset"))).toBeInTheDocument();
    fireEvent.change(select(), { target: { value: "14" } });
    await waitFor(() => expect(updates).toEqual([{ trial_booking_window_days: 14 }]));
    await waitFor(() => expect(refetchTenant).toHaveBeenCalled());
    expect(toasts).toEqual([`ok:${i18n.t("settings.trainer.trialWindowSaved")}`]);
  });

  it("「未設定」に戻すと null で保存する（0 などを入れない）", async () => {
    tenantRef.current = { id: "t1", trial_booking_window_days: 14 };
    render(<TrialWindowCard />);
    expect(select().value).toBe("14");
    fireEvent.change(select(), { target: { value: "unset" } });
    await waitFor(() => expect(updates).toEqual([{ trial_booking_window_days: null }]));
  });

  it("選択肢に無い値（SQL で入れた 21 等）でも今の値として見せる", () => {
    tenantRef.current = { id: "t1", trial_booking_window_days: 21 };
    render(<TrialWindowCard />);
    expect(select().value).toBe("21");
  });

  it("保存に失敗したら失敗を出し、読み直さない", async () => {
    tenantRef.current = { id: "t1", trial_booking_window_days: null };
    updateError.current = { message: "denied" };
    render(<TrialWindowCard />);
    fireEvent.change(select(), { target: { value: "14" } });
    await waitFor(() => expect(toasts).toEqual([`ng:${i18n.t("settings.trainer.trialWindowSaveFailed")}`]));
    expect(refetchTenant).not.toHaveBeenCalled();
  });
});

// ── DB・テナントの列・文言 ───────────────────────────────────────────────
describe("DB とテナントの列", () => {
  const sql = readFileSync("supabase/migrations/20261108010000_trial_booking_window_days.sql", "utf8");
  const body = sql.replace(/--[^\n]*/g, "");

  it("列は既定なし（NULL＝今まで通り）。範囲は 1〜365（booking_window_days と同じ）", () => {
    expect(body).toMatch(/ADD COLUMN IF NOT EXISTS trial_booking_window_days integer;/);
    expect(body).toMatch(/CHECK \(trial_booking_window_days IS NULL OR trial_booking_window_days BETWEEN 1 AND 365\)/);
  });

  it("get_tenant_public が新しい列を返し、DROP のあとに GRANT を貼り直している（体験予約ページが開けなくならない）", () => {
    const create = body.slice(body.indexOf("CREATE OR REPLACE FUNCTION public.get_tenant_public"));
    expect(create).toMatch(/pre_visit_note text, trial_booking_window_days integer\s*\)/);
    expect(create).toMatch(/t\.pre_visit_note, t\.trial_booking_window_days/);
    expect(create).toMatch(/SECURITY DEFINER/);
    expect(create).toMatch(/WHERE t\.id = p_id AND t\.status IN \('active', 'trial'\)/);
    expect(body.indexOf("DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);")).toBeLessThan(body.indexOf("CREATE OR REPLACE FUNCTION public.get_tenant_public"));
    expect(body).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_tenant_public\(uuid\) TO anon, authenticated, service_role;/);
  });

  it("🔴 特定のジムの値を入れていない（公開リポジトリ。値は本番で個別に入れる）", () => {
    expect(body).not.toMatch(/UPDATE\s+public\.tenants/i);
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("テナントの列: 後から足した列に入っていて、読めないときは null（今まで通り）", () => {
    expect(TENANT_OPTIONAL_COL_GROUPS).toContain("trial_booking_window_days");
    expect(TENANT_VALUE_DEFAULTS.trial_booking_window_days).toBeNull();
    expect(normalizeTenantRow({}).trial_booking_window_days).toBeNull();
    expect(normalizeTenantRow({ trial_booking_window_days: 14 }).trial_booking_window_days).toBe(14);
  });

  it("5言語すべてに設定の文言がある", () => {
    const keys = ["trialWindowSection", "trialWindowLabel", "trialWindowDesc", "trialWindowUnset", "trialWindowSaved", "trialWindowSaveFailed"];
    const missing: string[] = [];
    for (const loc of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const d = JSON.parse(readFileSync(`src/locales/${loc}.json`, "utf8"));
      for (const k of keys) if (!d.settings?.trainer?.[k]) missing.push(`${loc}: settings.trainer.${k}`);
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });
});
