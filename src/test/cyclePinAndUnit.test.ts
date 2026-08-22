import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  getCycleWindow,
  resolveEffectiveCycle,
  shouldRebaseCycleStart,
  resolveCycleUnit,
} from "@/lib/courseProgress";
import { computePlanUsage, resolvePlanUsageInput } from "@/lib/planUsage";
import { toJSTDate } from "@/lib/timezone";

// 起算日の固定（店の設定が最上位）＋利用期間の単位（ヶ月/週/日）（2026-08-22）
//
// 宗本さんの要望:
//   (1) お店側で決める利用期間（起算日）が一番上の権限を持つ。自動ルール
//       （1回目の予約日への合わせ込み・使い切りロール・1回目起点の引き直し表示）は
//       残すが、店が固定した起算日をそれらが動かしてはいけない。
//   (2) 利用期間はヶ月だけでなく週・日でも設定できる。
//
// 単位の規則（互換性のため非対称）:
//   - months … 応当日ベース・**応当日を含む**（従来どおり。既存プランの窓を1日も変えない）
//   - weeks / days … **ちょうど N×7日 / N日** の連続窓 [start, start+span)。
//     翌サイクルは end 当日から（応当日の概念が無いので最終日を共有しない）

const b = (iso: string, status = "予約済み") => ({ booking_date: iso, status });
const d = (ymd: string) => toJSTDate(`${ymd}T12:00:00+09:00`);
const ymd = (x: Date) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

describe("getCycleWindow: 週・日の単位", () => {
  it("weeks: ちょうど N×7日 の連続窓（4週=28日）", () => {
    const w = getCycleWindow("2026-06-05", d("2026-06-05"), 4, "weeks")!;
    expect(ymd(w.start)).toBe("2026-06-05");
    expect(ymd(w.end)).toBe("2026-07-03"); // 6/5 + 28日（排他上限）
    // 窓の最終日（end-1日）はまだ同じ窓
    const last = getCycleWindow("2026-06-05", d("2026-07-02"), 4, "weeks")!;
    expect(ymd(last.start)).toBe("2026-06-05");
    // end 当日は次の窓の開始（月と違い最終日を共有しない）
    const next = getCycleWindow("2026-06-05", d("2026-07-03"), 4, "weeks")!;
    expect(ymd(next.start)).toBe("2026-07-03");
    expect(ymd(next.end)).toBe("2026-07-31");
  });

  it("days: ちょうど N日（30日）", () => {
    const w = getCycleWindow("2026-06-05", d("2026-06-20"), 30, "days")!;
    expect(ymd(w.start)).toBe("2026-06-05");
    expect(ymd(w.end)).toBe("2026-07-05");
    const next = getCycleWindow("2026-06-05", d("2026-07-05"), 30, "days")!;
    expect(ymd(next.start)).toBe("2026-07-05");
  });

  it("起算日より前は最初の窓（架空の前回を作らない）", () => {
    const w = getCycleWindow("2026-06-05", d("2026-06-01"), 2, "weeks")!;
    expect(ymd(w.start)).toBe("2026-06-05");
    expect(ymd(w.end)).toBe("2026-06-19");
  });

  it("months は従来どおり応当日を含む（単位を渡さない/monthsで同一）", () => {
    // 6/5開始・1ヶ月: 応当日 7/5 は現サイクルに含める（end は 7/6 の排他上限）
    for (const unit of [undefined, null, "months", "不明な値"] as const) {
      const w = getCycleWindow("2026-06-05", d("2026-07-05"), 1, unit)!;
      expect(ymd(w.start)).toBe("2026-06-05");
      expect(ymd(w.end)).toBe("2026-07-06");
    }
  });

  it("resolveCycleUnit: プラン定義から解決（未設定・不明は months）", () => {
    const plans = [
      { plan_name: "月4回", cycle_unit: null },
      { plan_name: "4週4回", cycle_unit: "weeks" },
      { plan_name: "30日8回", cycle_unit: "days" },
      { plan_name: "変な値", cycle_unit: "years" },
    ];
    expect(resolveCycleUnit("月4回", plans)).toBe("months");
    expect(resolveCycleUnit("4週4回", plans)).toBe("weeks");
    expect(resolveCycleUnit("30日8回", plans)).toBe("days");
    expect(resolveCycleUnit("変な値", plans)).toBe("months");
    expect(resolveCycleUnit("無いプラン", plans)).toBe("months");
    expect(resolveCycleUnit(null, plans)).toBe("months");
  });
});

describe("起算日の固定（pinned）: 自動ルールより店の設定が上", () => {
  // 月2回・6/5起算。窓内に3件（上限超過）→ 未固定なら 6/10 へロールする形
  const rollBookings = [b("2026-06-06T10:00:00+09:00"), b("2026-06-08T10:00:00+09:00"), b("2026-06-10T10:00:00+09:00")];

  it("resolveEffectiveCycle: 固定中は使い切りロールをしない", () => {
    const base = {
      cycleStartDate: "2026-06-05",
      maxSessions: 2,
      bookings: rollBookings,
      referenceDate: d("2026-06-28"),
    };
    const unpinned = resolveEffectiveCycle(base)!;
    expect(unpinned.cycleStartDate).toBe("2026-06-10"); // (上限+1)回目の予約日へロール
    const pinned = resolveEffectiveCycle({ ...base, pinned: true })!;
    expect(pinned.cycleStartDate).toBe("2026-06-05"); // 店が決めた起算日のまま
    expect(ymd(pinned.window.start)).toBe("2026-06-05");
    expect(ymd(pinned.window.end)).toBe("2026-07-06");
  });

  it("resolveEffectiveCycle: 固定中は anchorToFirstBooking の引き直しもしない", () => {
    const base = {
      cycleStartDate: "2026-06-05",
      maxSessions: 8,
      bookings: [b("2026-06-10T10:00:00+09:00")],
      referenceDate: d("2026-06-28"),
      anchorToFirstBooking: true,
    };
    const unpinned = resolveEffectiveCycle(base)!;
    expect(ymd(unpinned.window.start)).toBe("2026-06-10"); // 1回目の予約日起点に引き直し
    const pinned = resolveEffectiveCycle({ ...base, pinned: true })!;
    expect(ymd(pinned.window.start)).toBe("2026-06-05"); // 固定した起算日のまま
  });

  it("shouldRebaseCycleStart: 固定中は一切動かさない（使い切りでも・未使用でも）", () => {
    // 使い切り後の期限内予約（未固定なら true になる形）
    const usedUp = {
      cycleStartDate: "2026-06-05",
      maxSessions: 2,
      bookingDateKey: "2026-06-15",
      existingBookings: [
        { id: "1", booking_date: "2026-06-06T10:00:00+09:00", status: "予約済み" },
        { id: "2", booking_date: "2026-06-08T10:00:00+09:00", status: "予約済み" },
      ],
    };
    expect(shouldRebaseCycleStart(usedUp)).toBe(true);
    expect(shouldRebaseCycleStart({ ...usedUp, pinned: true })).toBe(false);

    // 未使用の起算日への1回目（未固定なら予約日に合わせる形）
    const fresh = {
      cycleStartDate: "2026-06-05",
      maxSessions: 8,
      bookingDateKey: "2026-06-10",
      existingBookings: [],
    };
    expect(shouldRebaseCycleStart(fresh)).toBe(true);
    expect(shouldRebaseCycleStart({ ...fresh, pinned: true })).toBe(false);
  });

  it("shouldRebaseCycleStart: 起算日が未設定なら固定でも初回設定は許す", () => {
    // 固定は日付が無いと意味を持たない（UI も日付なしでは ON にできない）。
    // 直接 DB でこの状態になっても、初回の自動設定だけは通す。
    expect(
      shouldRebaseCycleStart({
        cycleStartDate: null,
        maxSessions: 8,
        bookingDateKey: "2026-06-10",
        existingBookings: [],
        pinned: true,
      }),
    ).toBe(true);
  });

  it("computePlanUsage: 固定中は予約0件でも期限を出す（periodPending にしない）", () => {
    const base = {
      planType: "subscription",
      maxSessions: 8,
      validityDays: null,
      startDate: "2026-06-05",
    };
    const now = d("2026-06-10");
    const unpinned = computePlanUsage(base, [], now);
    expect(unpinned.periodPending).toBe(true); // 従来: 1回目の予約待ち
    const pinned = computePlanUsage({ ...base, cycleStartPinned: true }, [], now);
    expect(pinned.periodPending).toBe(false); // 期間は店の設定で確定している
    expect(ymd(pinned.windowStart!)).toBe("2026-06-05");
    expect(ymd(pinned.windowEnd!)).toBe("2026-07-06");
  });

  it("computePlanUsage: 週単位＋固定の組み合わせ（4週窓・消化数）", () => {
    const usage = computePlanUsage(
      {
        planType: "subscription",
        maxSessions: 4,
        validityDays: null,
        startDate: "2026-06-05",
        cycleMonths: 4,
        cycleUnit: "weeks",
        cycleStartPinned: true,
      },
      [b("2026-06-06T10:00:00+09:00"), b("2026-06-20T10:00:00+09:00"), b("2026-07-04T10:00:00+09:00")],
      d("2026-06-28"),
    );
    expect(ymd(usage.windowStart!)).toBe("2026-06-05");
    expect(ymd(usage.windowEnd!)).toBe("2026-07-03"); // 6/5+28日
    expect(usage.used).toBe(2); // 7/4 は次の窓（[7/3, 7/31)）の分
    expect(usage.remaining).toBe(2);
  });

  it("resolvePlanUsageInput: cycle_unit と固定フラグを拾う", () => {
    const input = resolvePlanUsageInput(
      "4週4回",
      { plan_type: "subscription", max_sessions: 4, validity_days: null, cycle_months: 4, cycle_unit: "weeks", grace_days: null, allow_overflow: true },
      "2026-06-05",
      true,
    )!;
    expect(input.cycleUnit).toBe("weeks");
    expect(input.cycleStartPinned).toBe(true);
    // 旧データ互換（tenant_plans に無い名称）でも固定フラグは通す
    const legacy = resolvePlanUsageInput("月4回", null, "2026-06-05", true)!;
    expect(legacy.cycleStartPinned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 配線の固定（ソース/マイグレーションの読み取り検査）
// ロジックのテストだけだと「呼び出し元が渡し忘れる」退行を検出できないため、
// 判定の根拠となる列の取得と受け渡しをソースで固定する（staff_user_id 等と同じ作法）。
// ---------------------------------------------------------------------------

describe("配線: DBマイグレーション（20260822020000）", () => {
  const sql = readFileSync("supabase/migrations/20260822020000_cycle_pin_and_unit.sql", "utf8");

  it("列の追加（profiles.cycle_start_pinned / tenant_plans.cycle_unit）", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS cycle_start_pinned BOOLEAN NOT NULL DEFAULT false/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS cycle_unit TEXT/);
    expect(sql).toMatch(/CHECK \(cycle_unit IN \('months', 'weeks', 'days'\)\)/);
  });

  it("plan_cycle_window の4引数オーバーロード（週・日は連続窓、months は3引数版へ委譲）", () => {
    expect(sql).toMatch(/p_cycle_unit TEXT/);
    // 週は N×7日
    expect(sql).toMatch(/WHEN p_cycle_unit = 'weeks' THEN v_len \* 7/);
    // 連続窓の直接計算（整数除算）
    expect(sql).toMatch(/\(\(p_target - p_cycle_start\) \/ v_span\) \* v_span/);
    // months は従来の3引数版に委譲（応当日を含む規則を変えない）
    expect(sql).toMatch(/FROM public\.plan_cycle_window\(p_cycle_start, p_target, v_len\)/);
  });

  it("guard_booking_plan_limit が cycle_unit を読んで4引数版で窓を引く", () => {
    expect(sql).toMatch(/tp\.cycle_unit/);
    expect(sql).toMatch(/plan_cycle_window\(v_cycle_start, v_target, v_months, v_unit\)/);
    expect(sql).toMatch(/plan_cycle_window\(v_cycle_start, v_ws - 1, v_months, v_unit\)/);
  });

  it("GB005: 本人は cycle_start_pinned を変更不可・固定中は cycle_start_date も変更不可", () => {
    expect(sql).toMatch(/NEW\.cycle_start_pinned IS DISTINCT FROM OLD\.cycle_start_pinned/);
    // 固定中の起算日変更の拒否（allow_overflow=false 条件との OR）
    expect(sql).toMatch(/OLD\.cycle_start_pinned\s*\n\s*OR EXISTS/);
  });
});

describe("配線: クライアント・エッジ関数", () => {
  it("useBookings: 固定フラグと単位を取得して shouldRebaseCycleStart に渡す", () => {
    const src = readFileSync("src/hooks/useBookings.ts", "utf8");
    expect(src).toMatch(/select\("plan, cycle_start_date, cycle_start_pinned, tenant_id, grace_enabled"\)/);
    expect(src).toMatch(/select\("plan_type, max_sessions, cycle_months, cycle_unit, grace_days, allow_overflow"\)/);
    expect(src).toMatch(/pinned: \(prof as \{ cycle_start_pinned\?: boolean \| null \}\)\.cycle_start_pinned === true/);
    expect(src).toMatch(/cycleUnit,/);
  });

  it("push-period-reminder: 固定フラグと単位を取得して computeSubscriptionUsage に渡す", () => {
    const src = readFileSync("supabase/functions/push-period-reminder/index.ts", "utf8");
    expect(src).toMatch(/cycle_start_pinned/);
    expect(src).toMatch(/cycle_months, cycle_unit, grace_days/);
    expect(src).toMatch(/cycleUnit: tp\.cycle_unit/);
    expect(src).toMatch(/pinned: p\.cycle_start_pinned === true/);
  });

  it("Deno 移植（_shared/cycle.ts）: pinned でロール・引き直し・periodPending を止める", () => {
    const src = readFileSync("supabase/functions/_shared/cycle.ts", "utf8");
    expect(src).toMatch(/anchorToFirstBooking === true && !pinned/);
    expect(src).toMatch(/if \(!pinned && maxSessions != null/);
    expect(src).toMatch(/used === 0 && !pinned/);
    // 週・日の連続窓
    expect(src).toMatch(/unit === "weeks" \? m \* 7 : m/);
  });

  it("TrainerPlanManager: cycle_unit を常に payload に含める（months は null で保存）", () => {
    const src = readFileSync("src/components/trainer/TrainerPlanManager.tsx", "utf8");
    expect(src).toMatch(/cycle_unit:\s*\n\s*form\.plan_type === "subscription" && form\.cycle_unit !== "months"/);
  });

  it("TrainerClientDetail: 固定スイッチは日付なしでは操作できない", () => {
    const src = readFileSync("src/components/trainer/TrainerClientDetail.tsx", "utf8");
    expect(src).toMatch(/checked=\{cycleStartPinned\}/);
    expect(src).toMatch(/disabled=\{!cycleStartDate\}/);
    // 日付を消したら固定も解除（日付なしの固定を残さない）
    expect(src).toMatch(/const clearPin = !newDate && cycleStartPinned;/);
  });
});
