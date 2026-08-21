import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  addDaysToDateKey,
  exceededFrequencyLimit,
  isBookingLimitError,
  limitPeriodRange,
  matchesFrequencyLimit,
  type BookingFrequencyLimitRow,
  type LimitCheckBooking,
} from "@/lib/bookingLimits";

// 予約回数の制限（「平日18-19時は週1回まで」等）の規則を見張る。
//
// 守るべき不変条件:
//   1. 時間帯は [start, end) —— 18:00-19:00 のルールは 19:00 開始には効かない
//   2. 週は月曜始まり（このアプリの週は全箇所 weekStartsOn: 1。DBも date_trunc('week')）
//   3. 数えない予約は 'キャンセル済み' **だけ**。'同日キャンセル済み'（消化）は数える
//   4. 個別ルールはそのお客様だけに効き、他のお客様には効かない
//   5. 🔴 店側の代理予約には効かない（DBトリガーが auth.uid() = user_id だけを見る）
//   6. クライアントの規則と DB トリガーの規則が一致している

// 2026-08-17(月)〜2026-08-23(日) が1つの週。2026-08-21 は金曜。
const FRI = "2026-08-21";
const MON_SAME_WEEK = "2026-08-17";
const SUN_SAME_WEEK = "2026-08-23";
const MON_NEXT_WEEK = "2026-08-24";

/** 平日 18:00-19:00 は週1回まで（実店舗の典型例） */
const PEAK_RULE: BookingFrequencyLimitRow = {
  id: "rule-peak",
  user_id: null,
  weekdays: [1, 2, 3, 4, 5],
  start_time: "18:00",
  end_time: "19:00",
  period: "week",
  max_bookings: 1,
  enabled: true,
};

const booking = (over: Partial<LimitCheckBooking>): LimitCheckBooking => ({
  id: "b-1",
  date: MON_SAME_WEEK,
  startTime: "18:00",
  status: "予約済み",
  ...over,
});

const candidateFri18 = { dateKey: FRI, startMinutes: 18 * 60, userId: "user-a" };

describe("期間の計算", () => {
  it("週は月曜始まりで [月, 翌月) を返す", () => {
    // 金曜から遡って同じ週の月曜へ。終端は翌週の月曜（半開区間）。
    expect(limitPeriodRange("week", FRI)).toEqual({ fromKey: MON_SAME_WEEK, toKey: MON_NEXT_WEEK });
    // 日曜は「その週の最終日」= 前の月曜に属する（日曜始まりだと翌週扱いになり答えが変わる）
    expect(limitPeriodRange("week", SUN_SAME_WEEK)).toEqual({ fromKey: MON_SAME_WEEK, toKey: MON_NEXT_WEEK });
    // 月曜自身はその週の先頭
    expect(limitPeriodRange("week", MON_SAME_WEEK)).toEqual({ fromKey: MON_SAME_WEEK, toKey: MON_NEXT_WEEK });
  });

  it("日は [その日, 翌日)", () => {
    expect(limitPeriodRange("day", FRI)).toEqual({ fromKey: FRI, toKey: "2026-08-22" });
  });

  it("addDaysToDateKey は月末・年末をまたげる", () => {
    expect(addDaysToDateKey("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("壊れた日付キーには null を返す", () => {
    expect(limitPeriodRange("week", "")).toBeNull();
    expect(limitPeriodRange("week", "2026-02-31")).toBeNull();
  });
});

describe("ルールのマッチング", () => {
  it("時間帯は [start, end) —— 端の扱いを固定する", () => {
    // 18:00 ちょうどは効く（含む）
    expect(matchesFrequencyLimit(PEAK_RULE, 5, 18 * 60, "user-a")).toBe(true);
    // 18:59 も効く
    expect(matchesFrequencyLimit(PEAK_RULE, 5, 18 * 60 + 59, "user-a")).toBe(true);
    // 19:00 ちょうどは効かない（半開区間の終端）
    expect(matchesFrequencyLimit(PEAK_RULE, 5, 19 * 60, "user-a")).toBe(false);
    // 17:59 も効かない
    expect(matchesFrequencyLimit(PEAK_RULE, 5, 17 * 60 + 59, "user-a")).toBe(false);
  });

  it("曜日が合わなければ効かない（土曜=6 は平日ルールの対象外）", () => {
    expect(matchesFrequencyLimit(PEAK_RULE, 6, 18 * 60, "user-a")).toBe(false);
    expect(matchesFrequencyLimit(PEAK_RULE, 0, 18 * 60, "user-a")).toBe(false);
  });

  it("無効(enabled=false)のルールは効かない", () => {
    expect(matchesFrequencyLimit({ ...PEAK_RULE, enabled: false }, 5, 18 * 60, "user-a")).toBe(false);
  });

  it("個別ルールはそのお客様にだけ効く", () => {
    const personal = { ...PEAK_RULE, user_id: "user-a" };
    expect(matchesFrequencyLimit(personal, 5, 18 * 60, "user-a")).toBe(true);
    expect(matchesFrequencyLimit(personal, 5, 18 * 60, "user-b")).toBe(false);
  });

  it("終了 24:00（その日いっぱい）のルールが解釈できる", () => {
    const allDay = { ...PEAK_RULE, start_time: "00:00", end_time: "24:00" };
    expect(matchesFrequencyLimit(allDay, 5, 23 * 60 + 59, "user-a")).toBe(true);
  });
});

describe("超過の判定", () => {
  it("同じ週のピーク帯に1件あれば、2件目は拒否される", () => {
    const hit = exceededFrequencyLimit([PEAK_RULE], candidateFri18, [booking({})]);
    expect(hit?.id).toBe("rule-peak");
  });

  it("同じ週でもピーク帯の外の予約は数えない", () => {
    // 月曜 17:00 開始（枠の終わりが 18時台に食い込んでも、判定は開始時刻）
    const outside = booking({ startTime: "17:00" });
    expect(exceededFrequencyLimit([PEAK_RULE], candidateFri18, [outside])).toBeNull();
  });

  it("先週・翌週の予約は数えない（週の境界）", () => {
    const prevSunday = booking({ date: "2026-08-16" });   // 前の週の日曜
    const nextMonday = booking({ date: MON_NEXT_WEEK });  // 翌週の月曜
    expect(exceededFrequencyLimit([PEAK_RULE], candidateFri18, [prevSunday, nextMonday])).toBeNull();
  });

  it("🔴 'キャンセル済み' は数えず、'同日キャンセル済み'（消化）は数える", () => {
    const cancelled = booking({ status: "キャンセル済み" });
    expect(exceededFrequencyLimit([PEAK_RULE], candidateFri18, [cancelled])).toBeNull();
    // 消化はセッションを使った扱い。その週のピーク帯の権利も使ったと数える（満枠判定と同じ除外規則）
    const forfeited = booking({ status: "同日キャンセル済み" });
    expect(exceededFrequencyLimit([PEAK_RULE], candidateFri18, [forfeited])?.id).toBe("rule-peak");
  });

  it("リスケ中は動かしている予約自体を数えない（同じ週内の移動は超過にならない）", () => {
    const moving = booking({ id: "b-move" });
    expect(exceededFrequencyLimit([PEAK_RULE], candidateFri18, [moving], "b-move")).toBeNull();
    // 別の予約が既にあれば、除外があっても超過
    const other = booking({ id: "b-other", date: "2026-08-19" });
    expect(exceededFrequencyLimit([PEAK_RULE], candidateFri18, [moving, other], "b-move")?.id).toBe("rule-peak");
  });

  it("全体ルールと個別ルールは両方評価される（AND。個別は追加の締め付け）", () => {
    // 全体: 週2回まで / user-a 個別: 週1回まで → user-a は1件で頭打ち
    const loose = { ...PEAK_RULE, id: "rule-loose", max_bookings: 2 };
    const strict = { ...PEAK_RULE, id: "rule-strict", user_id: "user-a", max_bookings: 1 };
    expect(exceededFrequencyLimit([loose, strict], candidateFri18, [booking({})])?.id).toBe("rule-strict");
    // user-b には個別ルールが効かないので、1件では止まらない
    const forB = { ...candidateFri18, userId: "user-b" };
    expect(exceededFrequencyLimit([loose, strict], forB, [booking({})])).toBeNull();
  });

  it("period='day' は同じ日だけを数える", () => {
    const daily: BookingFrequencyLimitRow = {
      ...PEAK_RULE, id: "rule-daily", weekdays: [0, 1, 2, 3, 4, 5, 6],
      start_time: "00:00", end_time: "24:00", period: "day",
    };
    const sameDay = booking({ date: FRI, startTime: "10:00" });
    const otherDay = booking({ date: MON_SAME_WEEK, startTime: "10:00" });
    expect(exceededFrequencyLimit([daily], candidateFri18, [sameDay])?.id).toBe("rule-daily");
    expect(exceededFrequencyLimit([daily], candidateFri18, [otherDay])).toBeNull();
  });

  it("ルールが無ければ何も起きない", () => {
    expect(exceededFrequencyLimit([], candidateFri18, [booking({})])).toBeNull();
  });
});

describe("エラーの見分け", () => {
  it("GB003 だけを予約回数の上限と判定する", () => {
    expect(isBookingLimitError({ code: "GB003", message: "x" })).toBe(true);
    expect(isBookingLimitError({ code: "GB001" })).toBe(false);
    expect(isBookingLimitError({ code: "GB002" })).toBe(false);
    expect(isBookingLimitError({ message: "GB003" })).toBe(false);   // 文言一致では判定しない
    expect(isBookingLimitError(null)).toBe(false);
    expect(isBookingLimitError("GB003")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB 側の規則がクライアントと一致していることを、migrations の SQL から見張る
// ---------------------------------------------------------------------------
const migrationsDir = "supabase/migrations";
const limitSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"))
  .filter((s) => s.includes("booking_frequency_limits"))
  .join("\n")
  // 行コメントを落とす（コメント内の文言にマッチして緑になる事故を防ぐ）
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("🔴 DB 側の規則がクライアントと一致している", () => {
  it("テーブルとトリガーが定義されている", () => {
    expect(limitSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.booking_frequency_limits/);
    expect(limitSql).toMatch(/CREATE OR REPLACE FUNCTION public\.guard_booking_frequency_limit\(\)/);
    expect(limitSql).toMatch(/BEFORE INSERT OR UPDATE ON public\.bookings/);
  });

  it("🔴 代理予約とサービスロールは素通しする（自己予約だけを見る）", () => {
    // auth.uid() が NULL（サービスロール）か user_id と違う（代理）なら RETURN NEW。
    // この行が消えると、店の代理予約まで制限で止まる。
    expect(limitSql).toMatch(
      /IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW\.user_id THEN\s*\n\s*RETURN NEW;/,
    );
  });

  it("曜日と時刻は JST で数える", () => {
    expect(limitSql).toMatch(/AT TIME ZONE 'Asia\/Tokyo'/);
    expect(limitSql).toMatch(/EXTRACT\(DOW FROM v_jst\)/);
  });

  it("週は date_trunc('week') = 月曜始まり", () => {
    expect(limitSql).toMatch(/date_trunc\('week', v_jst\)/);
  });

  it("数えない予約は 'キャンセル済み' だけ（消化は数える）", () => {
    expect(limitSql).toMatch(/b\.status <> 'キャンセル済み'/);
    // '同日キャンセル済み' を除外していないこと
    expect(limitSql).not.toMatch(/status\s*<>\s*'同日キャンセル済み'/);
  });

  it("リスケ中の行の旧日時を数えない", () => {
    expect(limitSql).toMatch(/b\.id IS DISTINCT FROM NEW\.id/);
  });

  it("日時が変わらない UPDATE は見ない（キャンセルを止めない）", () => {
    expect(limitSql).toMatch(
      /IF TG_OP = 'UPDATE' AND NEW\.booking_date IS NOT DISTINCT FROM OLD\.booking_date THEN\s*\n\s*RETURN NEW;/,
    );
  });

  it("SQLSTATE は GB003（GB001/GB002 と混ぜない）", () => {
    expect(limitSql).toMatch(/USING ERRCODE = 'GB003'/);
  });

  it("RLS: RESTRICTIVE のテナント境界と anon の遮断", () => {
    expect(limitSql).toMatch(/CREATE POLICY tenant_isolation ON public\.booking_frequency_limits AS RESTRICTIVE/);
    expect(limitSql).toMatch(/REVOKE ALL ON public\.booking_frequency_limits FROM anon/);
  });

  it("🔴 RLS: お客様には「全員向け」と「自分あて」しか見せない", () => {
    // 他のお客様の個別ルールが見えると「あの人は制限されている」が漏れる
    expect(limitSql).toMatch(
      /user_id IS NULL\s*\n\s*OR user_id = auth\.uid\(\)\s*\n\s*OR public\.has_tenant_role\(tenant_id, auth\.uid\(\), ARRAY\['owner','trainer'\]\)/,
    );
  });

  it("書き込みは owner / trainer のみ", () => {
    const writes = limitSql.match(
      /CREATE POLICY booking_frequency_limits_(write|update|delete)[\s\S]*?;/g,
    ) ?? [];
    expect(writes.length).toBe(3);
    for (const p of writes) {
      expect(p).toMatch(/has_tenant_role\(tenant_id, auth\.uid\(\), ARRAY\['owner','trainer'\]\)/);
    }
  });

  it("テナント削除（delete_my_gym）がこの表も消す", () => {
    expect(limitSql).toMatch(/DELETE FROM public\.booking_frequency_limits WHERE tenant_id = v_tenant_id/);
  });

  it("CHECK: 時刻の形式（実際に正規表現として評価して確かめる）", () => {
    // 文字列に "24:00" が含まれるだけの検査だと、書き方を変えたときに素通りする。
    // SQL からパターンを抜き出して JS の RegExp として評価する（staffSchedule.test.ts と同じ手法）。
    const startPattern = /start_time ~ '([^']+)'/.exec(limitSql)?.[1];
    expect(startPattern, "start_time の CHECK が見つからない").toBeTruthy();
    const startRe = new RegExp(startPattern!);
    expect(startRe.test("00:00")).toBe(true);
    expect(startRe.test("23:30")).toBe(true);
    expect(startRe.test("24:00"), "開始に 24:00 は許さない").toBe(false);
    expect(startRe.test("25:00")).toBe(false);

    const endPattern = /end_time ~ '([^']+)'/.exec(limitSql)?.[1];
    expect(endPattern, "end_time の CHECK が見つからない").toBeTruthy();
    const endRe = new RegExp(endPattern!);
    expect(endRe.test("24:00"), "終了の 24:00（その日いっぱい）は許す").toBe(true);
    expect(endRe.test("19:00")).toBe(true);
    expect(endRe.test("24:30")).toBe(false);
    expect(endRe.test("25:00")).toBe(false);
  });

  it("CHECK: period・回数・曜日の範囲", () => {
    expect(limitSql).toMatch(/CHECK \(period IN \('week', 'day'\)\)/);
    expect(limitSql).toMatch(/CHECK \(max_bookings >= 1 AND max_bookings <= 99\)/);
    expect(limitSql).toMatch(/weekdays <@ ARRAY\[0,1,2,3,4,5,6\]/);
  });
});

// ---------------------------------------------------------------------------
// 画面がこの仕組みを実際に使っていることを見張る
// ---------------------------------------------------------------------------
describe("🔴 画面が予約回数の制限を見ている", () => {
  const customerBooking = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
  const trainerSchedule = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
  const gymSettings = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");

  it("お客様の予約画面は枠の生成と送信直前の両方で判定する", () => {
    expect(customerBooking).toContain("exceededFrequencyLimit(");
    expect(customerBooking).toContain("isBookingLimitError(");
    expect(customerBooking).toContain("useBookingFrequencyLimits(");
  });

  it("🔴 店側の代理予約（TrainerSchedule）はクライアント判定を持たない", () => {
    // 制限しないのは仕様（店の裁量で例外を作れる）。ここに判定を足すと仕様が変わる。
    // DB トリガー側の素通し（auth.uid() ≠ user_id）とセットで初めて成立する非対称なので、
    // どちらか片方だけ変えると挙動がねじれる。変えるなら mem を読み直してから。
    expect(trainerSchedule).not.toContain("exceededFrequencyLimit(");
    // GB003 の文言分岐だけは持つ（トレーナーが自分をお客様として選んだときに出る）
    expect(trainerSchedule).toContain("isBookingLimitError(");
  });

  it("設定画面に編集セクションが載っている", () => {
    expect(gymSettings).toContain("<TrainerBookingLimits />");
  });

  it("読めない環境では空配列＝制限なしに倒す（予約を止めない）", () => {
    const hook = readFileSync("src/hooks/useBookingFrequencyLimits.ts", "utf8");
    expect(hook).toContain("setLimits([])");
  });

  it("types.ts に booking_frequency_limits が載っている", () => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    expect(types).toMatch(/\n {6}booking_frequency_limits: \{/);
    expect(types).toMatch(/weekdays: number\[\]/);
  });
});
