import { describe, it, expect } from "vitest";
import { computePlanUsage, resolvePlanUsageInput } from "@/lib/planUsage";
import { toJSTDate } from "@/lib/timezone";

// 「現在」を固定（2026-07-10 12:00 JST）。toJSTDate を通すことで端末TZに依存せず
// JST基準の比較になる（バグ修正の核心）。下の期待値は全タイムゾーンで成立する。
const NOW = toJSTDate("2026-07-10T12:00:00+09:00");
const b = (iso: string, status = "予約済み") => ({ booking_date: iso, status });

describe("computePlanUsage", () => {
  it("月額(subscription)は今サイクル[6/20,7/21)で集計し、月初でリセットされる", () => {
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 6, validityDays: null, startDate: "2026-06-20" },
      [
        b("2026-06-20T00:30:00+09:00"), // 初日早朝（範囲内）
        b("2026-06-22T10:00:00+09:00"),
        b("2026-07-05T09:00:00+09:00"),
        b("2026-07-10T23:00:00+09:00"), // now より後（未実施だが範囲内）
        b("2026-07-21T09:00:00+09:00"), // 次サイクル（範囲外）
        b("2026-07-06T10:00:00+09:00", "キャンセル済み"), // 除外
      ],
      NOW,
    );
    expect(usage.kind).toBe("subscription");
    expect(usage.total).toBe(6);
    expect(usage.used).toBe(4); // 6/20,6/22,7/05,7/10（7/21は次サイクル、キャンセルは除外）
    expect(usage.remaining).toBe(2);
    expect(usage.isUnlimited).toBe(false);
  });

  it("回数券(ticket)は有効期間内の合計で集計し、月をまたいでもリセットしない", () => {
    const usage = computePlanUsage(
      { planType: "ticket", maxSessions: 10, validityDays: 90, startDate: "2026-06-20" },
      [
        b("2026-06-22T10:00:00+09:00"),
        b("2026-07-05T09:00:00+09:00"),
        b("2026-08-15T10:00:00+09:00"), // 翌々月でも有効期間内（90日 = ~9/18まで）
        b("2026-10-01T10:00:00+09:00"), // 有効期間外
      ],
      NOW,
    );
    expect(usage.kind).toBe("ticket");
    expect(usage.total).toBe(10);
    expect(usage.used).toBe(3);
    expect(usage.remaining).toBe(7);
  });

  it("通い放題(max_sessions=null)は無制限扱い", () => {
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: null, validityDays: null, startDate: "2026-06-20" },
      [b("2026-06-22T10:00:00+09:00"), b("2026-07-05T09:00:00+09:00")],
      NOW,
    );
    expect(usage.isUnlimited).toBe(true);
    expect(usage.total).toBeNull();
    expect(usage.remaining).toBeNull();
    expect(usage.used).toBe(2);
  });

  it("期間プラン(period)は期限切れを判定する", () => {
    const usage = computePlanUsage(
      { planType: "period", maxSessions: null, validityDays: 30, startDate: "2026-05-01" },
      [],
      NOW,
    );
    expect(usage.isUnlimited).toBe(true);
    expect(usage.isExpired).toBe(true); // 5/01 + 30日 < 7/10
  });

  it("起算日が無い場合は未設定扱い", () => {
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 4, validityDays: null, startDate: null },
      [],
      NOW,
    );
    expect(usage.isUnconfigured).toBe(true);
  });
});

describe("resolvePlanUsageInput", () => {
  it("tenant_plans があればそれを正とする", () => {
    const input = resolvePlanUsageInput("回数券10", { plan_type: "ticket", max_sessions: 10, validity_days: 90 }, "2026-06-20");
    expect(input).toEqual({ planType: "ticket", maxSessions: 10, validityDays: 90, startDate: "2026-06-20", cycleMonths: null, graceDays: null });
  });

  it("tenant_plans に無い『月N回』は subscription として解決（旧データ互換）", () => {
    const input = resolvePlanUsageInput("月3回", null, "2026-06-20");
    expect(input).toEqual({ planType: "subscription", maxSessions: 3, validityDays: null, startDate: "2026-06-20" });
  });

  it("『通い放題』は無制限の subscription として解決", () => {
    const input = resolvePlanUsageInput("通い放題", null, "2026-06-20");
    expect(input).toEqual({ planType: "subscription", maxSessions: null, validityDays: null, startDate: "2026-06-20" });
  });

  it("解決できない名称は null", () => {
    expect(resolvePlanUsageInput("プラン未設定", null, "2026-06-20")).toBeNull();
    expect(resolvePlanUsageInput(null, null, "2026-06-20")).toBeNull();
  });
});

describe("periodPending（期限未確定: 1回目の予約待ち）", () => {
  it("サブスクで今サイクルに予約が無ければ true、1件でも入れば false", () => {
    const none = computePlanUsage(
      { planType: "subscription", maxSessions: 6, validityDays: null, startDate: "2026-07-02" },
      [],
      NOW,
    );
    expect(none.periodPending).toBe(true);

    const withBooking = computePlanUsage(
      { planType: "subscription", maxSessions: 6, validityDays: null, startDate: "2026-07-02" },
      [b("2026-07-15T10:00:00+09:00")],
      NOW,
    );
    expect(withBooking.periodPending).toBe(false);
  });

  it("回数券(ticket)・期間(period)は購入日起算のため常に false", () => {
    const ticket = computePlanUsage(
      { planType: "ticket", maxSessions: 10, validityDays: 90, startDate: "2026-07-02" },
      [],
      NOW,
    );
    expect(ticket.periodPending).toBe(false);
  });
});

describe("猶予（grace_days）: 大目に見た消化を前サイクルへ繰り入れる", () => {
  // 現在 = 2026-07-08 12:00 JST（現サイクル[7/3,8/4)の中）
  const GNOW = toJSTDate("2026-07-08T12:00:00+09:00");
  // 起算日 6/2・月6回。前サイクル[6/2,7/3)は5回のみ消化（残り1回）。
  const prev5 = [
    b("2026-06-03T10:00:00+09:00"),
    b("2026-06-08T10:00:00+09:00"),
    b("2026-06-13T10:00:00+09:00"),
    b("2026-06-18T10:00:00+09:00"),
    b("2026-06-24T10:00:00+09:00"),
  ];

  it("猶予帯の予約は前サイクルの残り回数ぶん現サイクルの消化から外れ、期限未確定を維持", () => {
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 6, validityDays: null, startDate: "2026-06-02", graceDays: 7 },
      [...prev5, b("2026-07-05T10:00:00+09:00")], // 7/5 は猶予帯 [7/3,7/10)
      GNOW,
    );
    expect(usage.used).toBe(0); // 7/5 は前サイクル6回目として繰入 → 現サイクルは0
    expect(usage.remaining).toBe(6);
    expect(usage.periodPending).toBe(true);
  });

  it("前サイクルの残りより多い猶予帯の予約は、超過分が現サイクルの消化になる", () => {
    // capacity=1。7/5 が繰入（前サイクル6回目）、7/8 は現サイクル1回目。
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 6, validityDays: null, startDate: "2026-06-02", graceDays: 7 },
      [...prev5, b("2026-07-05T10:00:00+09:00"), b("2026-07-08T10:00:00+09:00")],
      GNOW,
    );
    expect(usage.used).toBe(1);
    expect(usage.periodPending).toBe(false);
  });

  it("graceDays 未設定(0)なら猶予帯でも現サイクルの1回目として消化される（従来挙動）", () => {
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 6, validityDays: null, startDate: "2026-06-02" },
      [...prev5, b("2026-07-05T10:00:00+09:00")],
      GNOW,
    );
    expect(usage.used).toBe(1);
    expect(usage.periodPending).toBe(false);
  });

  it("前サイクルを使い切っていれば猶予帯でも繰り入れない（現サイクルの消化）", () => {
    const prev6 = [...prev5, b("2026-06-28T10:00:00+09:00")]; // 6回消化＝満了
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 6, validityDays: null, startDate: "2026-06-02", graceDays: 7 },
      [...prev6, b("2026-07-05T10:00:00+09:00")],
      GNOW,
    );
    expect(usage.used).toBe(1); // capacity 0 → 繰入なし
    expect(usage.periodPending).toBe(false);
  });

  it("猶予帯を過ぎた予約（graceDays 日以降）は繰り入れない", () => {
    // 7/12 は [7/3,7/10) の外 → 前サイクルが未消化でも現サイクルの1回目
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 6, validityDays: null, startDate: "2026-06-02", graceDays: 7 },
      [...prev5, b("2026-07-12T10:00:00+09:00")],
      toJSTDate("2026-07-12T12:00:00+09:00"),
    );
    expect(usage.used).toBe(1);
    expect(usage.periodPending).toBe(false);
  });
});

describe("実効サイクル（回数使い切り後の期限内スタートで自動ロール）", () => {
  // 起算日 6/5・月8回。8回を 6/25 までに消化。現在 = 2026-07-03 12:00 JST。
  const NOW3 = toJSTDate("2026-07-03T12:00:00+09:00");
  const eight = [
    "2026-06-06", "2026-06-08", "2026-06-10", "2026-06-12",
    "2026-06-15", "2026-06-18", "2026-06-21", "2026-06-25",
  ].map((d) => b(`${d}T10:00:00+09:00`));

  it("10件（9件目=6/28）→ 期限の終わりを待たず 6/28 起点の新ルーティン 2/8 になる", () => {
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 8, validityDays: null, startDate: "2026-06-05" },
      [...eight, b("2026-06-28T10:00:00+09:00"), b("2026-07-02T10:00:00+09:00")],
      NOW3,
    );
    expect(usage.used).toBe(2);
    expect(usage.remaining).toBe(6);
    expect(usage.windowStart!.getMonth()).toBe(5); // June
    expect(usage.windowStart!.getDate()).toBe(28);
    expect(usage.windowEnd!.getMonth()).toBe(6); // July（最終利用日 7/28 の翌日 = 7/29 が排他上限）
    expect(usage.windowEnd!.getDate()).toBe(29);
    expect(usage.periodPending).toBe(false);
  });

  it("ちょうど 8/8 ならロールしない（窓は1回目の予約日6/6起点）", () => {
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 8, validityDays: null, startDate: "2026-06-05" },
      eight,
      NOW3,
    );
    expect(usage.used).toBe(8);
    expect(usage.remaining).toBe(0);
    // 表示は「実際の1回目のトレーニング日（6/6）から1ヶ月」。起算日6/5そのままではない。
    expect(usage.windowStart!.getDate()).toBe(6);
  });

  it("9件目が未来日（7/4）なら、その日が来るまでは現在の期間のまま（消化は上限で頭打ち）", () => {
    // 9件目はまだ未来なので先回りしない。現在の窓（1回目6/6起点）を表示し、
    // 超過分（未来の9件目）は消化数に数えない（8/8のまま）。
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 8, validityDays: null, startDate: "2026-06-05" },
      [...eight, b("2026-07-04T10:00:00+09:00")],
      NOW3, // 7/3
    );
    expect(usage.used).toBe(8);
    expect(usage.remaining).toBe(0);
    expect(usage.windowStart!.getMonth()).toBe(5); // June
    expect(usage.windowStart!.getDate()).toBe(6); // 1回目の予約日 6/6 起点
  });

  it("9件目の日（7/4）が来たら新ルーティンへロールする", () => {
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 8, validityDays: null, startDate: "2026-06-05" },
      [...eight, b("2026-07-04T10:00:00+09:00")],
      toJSTDate("2026-07-04T12:00:00+09:00"),
    );
    expect(usage.used).toBe(1);
    expect(usage.windowStart!.getMonth()).toBe(6); // July
    expect(usage.windowStart!.getDate()).toBe(4);
  });

  it("ジム設定の利用期間を維持: 月4回・起算日6/18・期間内に6件（5件目=未来の7/17）→ 今日は 6/18〜7/18 のまま 4/4", () => {
    // 実際に報告されたケース: 起算日 6/18 なのにカードが未来の期間 7/17〜8/17 を表示していた
    const four = ["2026-06-18", "2026-06-25", "2026-07-02", "2026-07-09"].map((d) => b(`${d}T10:00:00+09:00`));
    const nextRoutine = ["2026-07-17", "2026-07-18"].map((d) => b(`${d}T10:00:00+09:00`));
    const now = toJSTDate("2026-07-04T13:00:00+09:00");
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 4, validityDays: null, startDate: "2026-06-18" },
      [...four, ...nextRoutine],
      now,
    );
    // ジムが設定した期間のまま（6/18〜7/18）。未来の次ルーティン2件は数えない
    expect(usage.windowStart!.getMonth()).toBe(5); // June
    expect(usage.windowStart!.getDate()).toBe(18);
    expect(usage.used).toBe(4);
    expect(usage.remaining).toBe(0);

    // 7/17 が来たら新ルーティンの期間 7/17〜8/17 に切り替わる
    const usageAfter = computePlanUsage(
      { planType: "subscription", maxSessions: 4, validityDays: null, startDate: "2026-06-18" },
      [...four, ...nextRoutine],
      toJSTDate("2026-07-17T12:00:00+09:00"),
    );
    expect(usageAfter.windowStart!.getMonth()).toBe(6); // July
    expect(usageAfter.windowStart!.getDate()).toBe(17);
    expect(usageAfter.used).toBe(2);
  });

  it("期間開始前（1回目の予約が未来日）は notStarted=true（「残り◯日」を出さず「◯/◯から開始」表示にする）", () => {
    // デモさんのケース: 今日7/5、1回目の予約が7/12 → 期間 7/12〜8/12 はまだ始まっていない。
    // 「残り38日」と出すと1ヶ月プランなのに意味不明なので、notStarted で表示を切り替える。
    const july = ["2026-07-12", "2026-07-19"].map((d) => b(`${d}T21:00:00+09:00`));
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 4, validityDays: null, startDate: "2026-06-12" },
      july,
      toJSTDate("2026-07-05T12:00:00+09:00"),
    );
    expect(usage.windowStart!.getMonth()).toBe(6); // July
    expect(usage.windowStart!.getDate()).toBe(12);
    expect(usage.notStarted).toBe(true);
    expect(usage.isExpired).toBe(false);

    // 期間が始まったら notStarted=false（通常の「残り◯日」に戻る）
    const started = computePlanUsage(
      { planType: "subscription", maxSessions: 4, validityDays: null, startDate: "2026-06-12" },
      july,
      toJSTDate("2026-07-12T22:30:00+09:00"),
    );
    expect(started.notStarted).toBe(false);
  });

  it("利用期間は『実際の1回目のトレーニング日』起点で表示（林山さんのケース）", () => {
    // 起算日が過去(5/30)でも、実際の予約は7/5開始。応当日境界の7/1ではなく、
    // 1回目の予約日 7/5 起点＝7/5〜8/5 で表示する（ジムの運用「1回目から1ヶ月」）。
    const july = ["2026-07-05", "2026-07-12", "2026-07-19", "2026-07-26"].map((d) => b(`${d}T10:00:00+09:00`));
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 4, validityDays: null, startDate: "2026-05-30" },
      july,
      toJSTDate("2026-07-05T13:00:00+09:00"),
    );
    expect(usage.windowStart!.getMonth()).toBe(6); // July
    expect(usage.windowStart!.getDate()).toBe(5); // 応当日境界の 7/1 ではなく 1回目の 7/5
    expect(usage.windowEnd!.getMonth()).toBe(7); // August（最終利用日 8/5 の翌日 8/6）
    expect(usage.windowEnd!.getDate()).toBe(6);
    expect(usage.used).toBe(4);
    expect(usage.periodPending).toBe(false);
  });
});
