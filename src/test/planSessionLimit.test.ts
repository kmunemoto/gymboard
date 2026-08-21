import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { computePlanUsage } from "@/lib/planUsage";
import { isPlanLimitError, isPlanSessionLimitReached } from "@/lib/planSessionLimit";

// プランの回数上限（tenant_plans.max_sessions × allow_overflow）。
//
// 2026-08-21 まで max_sessions は**表示だけ**で一度も強制されていなかった
// （「残り0回」の赤いバッジが出ても押せば予約できた）。allow_overflow も
// 超過の可否を切り替える意図で作られたまま未実装のデッドカラムだった。
//
// 守るべき不変条件:
//   1. allow_overflow が true / null（＝現在の全プラン）なら**何も変わらない**
//   2. 🔴 超過を許さないときはサイクルの自動ロールも止まる
//      （止めないと「カードは残7回と言うのに拒否される」が既存データで必ず出る）
//   3. 判定に使う数は、カードが出している computePlanUsage の used / total そのもの
//   4. 🔴 店側の代理予約には効かない（DBトリガーが auth.uid() = user_id だけを見る）
//   5. クライアントの規則と DB トリガーの規則が一致している

const bk = (date: string, status = "予約済み") => ({
  booking_date: `${date}T10:00:00+09:00`,
  status,
});

/** 月4回・1ヶ月サイクル・猶予なし。起算日 2026-08-01 */
const monthly4 = (allowOverflow: boolean) => ({
  planType: "subscription",
  maxSessions: 4,
  validityDays: null,
  startDate: "2026-08-01",
  cycleMonths: 1,
  graceDays: 0,
  allowOverflow,
});

const NOW = new Date("2026-08-20T10:00:00+09:00");

describe("超過を許すか（allow_overflow）", () => {
  it("既定（true）では、上限を超えてもサイクルがロールして予約を止めない", () => {
    // 4回使ったあとの5回目 → 従来どおり「新ルーティンの1回目」として窓が引き直される
    const bookings = ["2026-08-02", "2026-08-05", "2026-08-08", "2026-08-11", "2026-08-14"].map((d) => bk(d));
    const usage = computePlanUsage(monthly4(true), bookings, NOW);
    expect(usage.total).toBe(4);
    expect(usage.used).toBe(1);                    // ロール後の新サイクルの1回目
    expect(isPlanSessionLimitReached(usage, true)).toBe(false);
  });

  it("🔴 false ではロールしない（既存の超過データでも表示と判定が食い違わない）", () => {
    const bookings = ["2026-08-02", "2026-08-05", "2026-08-08", "2026-08-11", "2026-08-14"].map((d) => bk(d));
    const usage = computePlanUsage(monthly4(false), bookings, NOW);
    // ロールしないので、暦サイクルの中の5件がそのまま消化として見える
    expect(usage.used).toBe(5);
    expect(usage.remaining).toBe(0);
    expect(isPlanSessionLimitReached(usage, false)).toBe(true);
  });

  it("false でも、上限に達していなければ止めない", () => {
    const bookings = ["2026-08-02", "2026-08-05", "2026-08-08"].map((d) => bk(d));
    const usage = computePlanUsage(monthly4(false), bookings, NOW);
    expect(usage.used).toBe(3);
    expect(isPlanSessionLimitReached(usage, false)).toBe(false);
  });

  it("ちょうど上限に達したら止める（4回目まで取れて5回目が止まる）", () => {
    const four = ["2026-08-02", "2026-08-05", "2026-08-08", "2026-08-11"].map((d) => bk(d));
    const usage = computePlanUsage(monthly4(false), four, NOW);
    expect(usage.used).toBe(4);
    expect(usage.remaining).toBe(0);
    expect(isPlanSessionLimitReached(usage, false)).toBe(true);
  });

  it("キャンセル済みは数えない", () => {
    const bookings = [
      bk("2026-08-02"), bk("2026-08-05"), bk("2026-08-08"),
      bk("2026-08-11", "キャンセル済み"),
    ];
    const usage = computePlanUsage(monthly4(false), bookings, NOW);
    expect(usage.used).toBe(3);
    expect(isPlanSessionLimitReached(usage, false)).toBe(false);
  });

  it("同日キャンセル済み（消化）は数える", () => {
    const bookings = [
      bk("2026-08-02"), bk("2026-08-05"), bk("2026-08-08"),
      bk("2026-08-11", "同日キャンセル済み"),
    ];
    const usage = computePlanUsage(monthly4(false), bookings, NOW);
    expect(usage.used).toBe(4);
    expect(isPlanSessionLimitReached(usage, false)).toBe(true);
  });

  it("次のサイクルに入れば取れる（暦の応当日でリセット）", () => {
    const bookings = ["2026-08-02", "2026-08-05", "2026-08-08", "2026-08-11"].map((d) => bk(d));
    // 応当日 9/1 は前サイクルの最終日。9/2 以降が次サイクル
    const next = computePlanUsage(monthly4(false), bookings, new Date("2026-09-05T10:00:00+09:00"));
    expect(next.used).toBe(0);
    expect(isPlanSessionLimitReached(next, false)).toBe(false);
  });

  it("通い放題（maxSessions null）は止めない", () => {
    const unlimited = { ...monthly4(false), maxSessions: null };
    const usage = computePlanUsage(unlimited, ["2026-08-02", "2026-08-05"].map((d) => bk(d)), NOW);
    expect(usage.isUnlimited).toBe(true);
    expect(isPlanSessionLimitReached(usage, false)).toBe(false);
  });

  it("プラン未確定（起算日なし）は止めない", () => {
    const usage = computePlanUsage({ ...monthly4(false), startDate: null }, [], NOW);
    expect(usage.isUnconfigured).toBe(true);
    expect(isPlanSessionLimitReached(usage, false)).toBe(false);
  });

  it("allow_overflow が null/undefined（未設定）なら既定の true と同じ", () => {
    const four = ["2026-08-02", "2026-08-05", "2026-08-08", "2026-08-11"].map((d) => bk(d));
    const usage = computePlanUsage(monthly4(false), four, NOW);
    // usage 側が上限に達していても、設定が null なら止めない
    expect(isPlanSessionLimitReached(usage, null)).toBe(false);
    expect(isPlanSessionLimitReached(usage, undefined)).toBe(false);
  });

  it("usage が無ければ止めない", () => {
    expect(isPlanSessionLimitReached(null, false)).toBe(false);
  });
});

describe("猶予（grace_days）は超過を許さないプランでも効く", () => {
  it("猶予帯の予約は前サイクルへ繰り入れられ、今サイクルの消化に数えない", () => {
    // 起算日 8/1・1ヶ月・猶予7日。前サイクル(8/1〜9/1)に2件だけ＝残り2回。
    // 次サイクル(9/2〜)の先頭7日に入った2件は前サイクルへ繰り入れられる。
    const input = { ...monthly4(false), graceDays: 7 };
    const bookings = [
      bk("2026-08-02"), bk("2026-08-05"),          // 前サイクル 2件
      bk("2026-09-03"), bk("2026-09-04"),          // 猶予帯（9/2〜9/8）2件 → 繰入
      bk("2026-09-20"),                             // 今サイクルの実消化 1件
    ];
    const usage = computePlanUsage(input, bookings, new Date("2026-09-25T10:00:00+09:00"));
    expect(usage.used).toBe(1);
    expect(isPlanSessionLimitReached(usage, false)).toBe(false);
  });
});

describe("エラーの見分け", () => {
  it("GB004 だけをプランの回数上限と判定する", () => {
    expect(isPlanLimitError({ code: "GB004" })).toBe(true);
    expect(isPlanLimitError({ code: "GB003" })).toBe(false);   // 時間帯の回数上限
    expect(isPlanLimitError({ code: "GB001" })).toBe(false);
    expect(isPlanLimitError({ message: "GB004" })).toBe(false); // 文言一致では判定しない
    expect(isPlanLimitError(null)).toBe(false);
    expect(isPlanLimitError("GB004")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB 側の規則がクライアントと一致していることを、migrations の SQL から見張る
// ---------------------------------------------------------------------------
// 🔴 検査は「連結全体」ではなく**最後の定義**に対して行う（CREATE OR REPLACE は
// 最後の定義しか残らないため。booking_frequency_limits のレビューで実証された穴）。
const planSql = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
  .filter((sql) => /guard_booking_plan_limit|plan_cycle_window/.test(sql))
  .join("\n")
  // 行末コメントも落とす（コード削除＋行末コメントに旧コードを残す変異を通さない）
  .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const lastFn = (name: string): string => {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const at = planSql.lastIndexOf(marker);
  expect(at, `${name} の定義が見つからない`).toBeGreaterThanOrEqual(0);
  const rest = planSql.slice(at);
  const end = rest.search(/\$(function)?\$;/);
  return end >= 0 ? rest.slice(0, end) : rest;
};

describe("🔴 DB 側の規則がクライアントと一致している", () => {
  const guard = lastFn("guard_booking_plan_limit");
  const cycle = lastFn("plan_cycle_window");

  it("トリガーが bookings に結線されている", () => {
    expect(planSql).toMatch(/BEFORE INSERT OR UPDATE ON public\.bookings/);
    expect(planSql).toMatch(/EXECUTE FUNCTION public\.guard_booking_plan_limit\(\)/);
  });

  it("🔴 代理予約とサービスロールは素通しする（自己予約だけを見る）", () => {
    expect(guard).toMatch(/v_actor := auth\.uid\(\);/);
    expect(guard).toMatch(
      /IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW\.user_id THEN\s*\n\s*RETURN NEW;/,
    );
  });

  it("🔴 allow_overflow が false のときだけ効く（既定は何もしない）", () => {
    // `IS DISTINCT FROM false` なので true も NULL も素通し＝既存の全プランは今までどおり
    expect(guard).toMatch(/IF v_allow IS DISTINCT FROM false THEN\s*\n\s*RETURN NEW;/);
  });

  it("通い放題（max_sessions NULL / 0以下）は止めない", () => {
    expect(guard).toMatch(/IF v_max IS NULL OR v_max <= 0 THEN\s*\n\s*RETURN NEW;/);
  });

  it("プラン未確定（起算日なし）は判定しない", () => {
    expect(guard).toMatch(/IF v_plan IS NULL OR v_cycle_start IS NULL THEN\s*\n\s*RETURN NEW;/);
  });

  it("サイクル窓は応当日ベースで、応当日そのものは前サイクルに含む", () => {
    // end は「応当日の翌日」＝排他的上限。ここが +1 でないと窓が1日短くなり、
    // 応当日ちょうどの予約が次サイクル扱いになって数がずれる。
    //
    // ⚠️ `::date + 1` を全体から探すだけでは足りない（WHILE ループの中の
    //    `v_start := (...)::date + 1` にマッチして、RETURN 側を消しても緑になる。
    //    変異検証で実際に素通りした）。**RETURN QUERY の行だけ**を取り出して見る。
    const returns = cycle.split("\n").filter((l) => l.includes("RETURN QUERY"));
    expect(returns.length, "RETURN QUERY が2本（起算日前・通常）あるはず").toBe(2);
    for (const line of returns) {
      expect(line, `窓の終端が応当日の翌日になっていない: ${line.trim()}`)
        .toMatch(/make_interval\(months => v_m\)\)::date \+ 1;?\s*$/);
    }
    // 応当日が target より厳密に前のときだけ進む
    expect(cycle).toMatch(/WHILE \(v_start \+ make_interval\(months => v_m\)\)::date < p_target LOOP/);
    // 起算日より前は最初のサイクル
    expect(cycle).toMatch(/IF p_target < p_cycle_start THEN/);
  });

  it("猶予の繰入がクライアントと同じ式（min(前サイクルの残り, 猶予帯の件数)）", () => {
    expect(guard).toMatch(/v_capacity := v_max - v_prev_count;/);
    expect(guard).toMatch(/v_tail_end := LEAST\(v_ws \+ v_grace, v_we\);/);
    expect(guard).toMatch(/v_lent := LEAST\(v_capacity, v_tail\);/);
    // 猶予OFFのお客様には猶予を適用しない（PlanUsageCard の graceEnabled === false と同じ）
    expect(guard).toMatch(/IF v_grace_on IS false THEN\s*\n\s*v_grace := 0;/);
  });

  it("数えない予約は 'キャンセル済み' だけ（消化は数える）", () => {
    expect(guard).toMatch(/b\.status <> 'キャンセル済み'/);
    expect(guard).not.toMatch(/status\s*<>\s*'同日キャンセル済み'/);
  });

  it("自行を数えない・比較は used >= max", () => {
    expect(guard).toMatch(/b\.id IS DISTINCT FROM NEW\.id/);
    expect(guard).toMatch(/IF v_used >= v_max THEN/);
  });

  it("同一人物の同時リクエストを直列化する", () => {
    expect(guard).toMatch(/pg_advisory_xact_lock/);
  });

  it("SQLSTATE は GB004（GB001〜GB003 と混ぜない）", () => {
    expect(guard).toMatch(/USING ERRCODE = 'GB004'/);
  });

  it("'キャンセル済み' からの復活は日時が変わらなくても判定する", () => {
    expect(guard).toMatch(
      /AND NOT \(OLD\.status = 'キャンセル済み' AND NEW\.status IS DISTINCT FROM 'キャンセル済み'\)/,
    );
  });
});

describe("🔴 画面がプランの回数上限を見ている", () => {
  const customerBooking = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
  const trainerSchedule = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
  const planManager = readFileSync("src/components/trainer/TrainerPlanManager.tsx", "utf8");

  it("お客様の予約画面は、カードと同じ数で判定して送信前に止める", () => {
    expect(customerBooking).toContain("isPlanSessionLimitReached(");
    expect(customerBooking).toContain("isPlanLimitError(");
    // 別に数え直さず computePlanUsage の結果を使う（表示と判定を食い違わせない）
    expect(customerBooking).toContain("computePlanUsage(");
  });

  it("🔴 店側の代理予約はクライアント判定を持たない（GB004 の文言だけ持つ）", () => {
    // 制限しないのは仕様。DB 側の素通しとセットで成立する非対称なので、
    // どちらか片方だけ変えると挙動がねじれる。
    expect(trainerSchedule).not.toContain("isPlanSessionLimitReached(");
    expect(trainerSchedule).toContain("isPlanLimitError(");
  });

  it("プラン設定に「上限を超えた予約を許さない」が出る", () => {
    expect(planManager).toContain("allow_overflow");
    expect(planManager).toContain('t("settings.plans.blockOverflow")');
    // 期間プラン（回数無制限）では出さない・常に true で保存する
    expect(planManager).toMatch(/form\.plan_type === "period" \? true : form\.allow_overflow/);
  });

  it("超過を許さないプランは表示側でもロールしない（allowOverflow を通している）", () => {
    const usage = readFileSync("src/lib/planUsage.ts", "utf8");
    expect(usage).toContain("allowOverflow: input.allowOverflow");
    expect(usage).toContain("allowOverflow: tenantPlan.allow_overflow ?? true");
    const course = readFileSync("src/lib/courseProgress.ts", "utf8");
    expect(course).toMatch(/if \(allowOverflow && maxSessions != null/);
  });
});
