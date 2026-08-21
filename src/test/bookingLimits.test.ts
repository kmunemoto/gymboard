import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  addDaysToDateKey,
  exceededFrequencyLimit,
  isExemptFromFrequencyLimits,
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
    // 🔴 前週側は**ルール対象の曜日**（金曜）で検査する。日曜（対象外の曜日）だと
    // 週範囲の下限チェックを消しても曜日フィルタだけで除外されてしまい、
    // 「週の下限」を検査したことにならない（変異検証で発覚）。
    const prevFriday = booking({ date: "2026-08-14" });   // 前の週の金曜（対象曜日・対象時間帯）
    const prevSunday = booking({ date: "2026-08-16" });   // 前の週の日曜
    const nextMonday = booking({ date: MON_NEXT_WEEK });  // 翌週の月曜
    expect(exceededFrequencyLimit([PEAK_RULE], candidateFri18, [prevFriday, prevSunday, nextMonday])).toBeNull();
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

describe("免除（exempt）: 特定のお客様を制限から外す", () => {
  // 「平日18-19時は週1回」の全員向けルールがある状態で、常連さんだけ外したい、
  // という需要への対応。制限（締める）しか書けなかった表に、緩める側を足した。
  const exemptRow: BookingFrequencyLimitRow = {
    id: "rule-exempt",
    user_id: "user-a",
    weekdays: [1, 2, 3, 4, 5],
    start_time: "18:00",
    end_time: "19:00",
    period: "week",
    max_bookings: 1,      // 免除行では意味を持たない（列は共有する）
    enabled: true,
    exempt: true,
  };

  it("🔴 免除は制限より強い（当てはまれば制限を一切評価しない）", () => {
    // 全員向けの週1ルールがあり、既に1件取っている＝本来なら拒否される状況
    const hit = exceededFrequencyLimit([PEAK_RULE], candidateFri18, [booking({})]);
    expect(hit?.id).toBe("rule-peak");
    // 免除を足すと通る
    expect(exceededFrequencyLimit([PEAK_RULE, exemptRow], candidateFri18, [booking({})])).toBeNull();
    // 並び順に依らない
    expect(exceededFrequencyLimit([exemptRow, PEAK_RULE], candidateFri18, [booking({})])).toBeNull();
  });

  it("免除は本人にだけ効く（他のお客様は従来どおり制限される）", () => {
    const forB = { ...candidateFri18, userId: "user-b" };
    expect(exceededFrequencyLimit([PEAK_RULE, exemptRow], forB, [booking({})])?.id).toBe("rule-peak");
  });

  it("免除の曜日・時間帯の外では効かない", () => {
    // 土曜（免除の対象曜日ではない）にも効く全曜日ルールを用意して確かめる
    const allWeek = { ...PEAK_RULE, id: "rule-all", weekdays: [0, 1, 2, 3, 4, 5, 6] };
    const sat = { dateKey: "2026-08-22", startMinutes: 18 * 60, userId: "user-a" };   // 土曜
    expect(exceededFrequencyLimit([allWeek, exemptRow], sat, [booking({ date: "2026-08-22" })])?.id)
      .toBe("rule-all");
    // 時間帯の外（19:00 開始）でも免除は効かない
    const fri19 = { ...candidateFri18, startMinutes: 19 * 60 };
    const evening = { ...PEAK_RULE, id: "rule-eve", start_time: "18:00", end_time: "21:00" };
    expect(exceededFrequencyLimit([evening, exemptRow], fri19, [booking({ startTime: "19:00" })])?.id)
      .toBe("rule-eve");
  });

  it("無効（enabled=false）の免除は効かない", () => {
    const off = { ...exemptRow, enabled: false };
    expect(exceededFrequencyLimit([PEAK_RULE, off], candidateFri18, [booking({})])?.id).toBe("rule-peak");
  });

  it("免除行は「制限」としては数えない（免除だけでは誰も止まらない）", () => {
    // max_bookings=1 を持っているが exempt なので制限としては働かない
    expect(exceededFrequencyLimit([exemptRow], candidateFri18, [booking({}), booking({ id: "b-2" })]))
      .toBeNull();
    // 🔴 matchesFrequencyLimit のレベルでも「制限としてはマッチしない」こと。
    //    exceededFrequencyLimit 経由だと、先に免除の早期リターンが効いてしまい
    //    「制限としても働く」変異を検出できない（変異検証で実際に素通りした）。
    expect(matchesFrequencyLimit(exemptRow, 5, 18 * 60, "user-a")).toBe(false);
    // 対照: 同じ形の制限行はマッチする（上の false が「常に false」ではないこと）
    expect(matchesFrequencyLimit({ ...exemptRow, exempt: false }, 5, 18 * 60, "user-a")).toBe(true);
  });

  it("isExemptFromFrequencyLimits: user_id が無い免除行は効かない（全員免除は作らせない）", () => {
    const global = { ...exemptRow, user_id: null };
    expect(isExemptFromFrequencyLimits([global], 5, 18 * 60, "user-a")).toBe(false);
    expect(isExemptFromFrequencyLimits([exemptRow], 5, 18 * 60, "user-a")).toBe(true);
    expect(isExemptFromFrequencyLimits([exemptRow], 5, 18 * 60, "user-b")).toBe(false);
    expect(isExemptFromFrequencyLimits(null, 5, 18 * 60, "user-a")).toBe(false);
  });

  it("exempt を持たない既存の行は従来どおり制限として働く", () => {
    // 列を足す前のデータ（exempt undefined）が「免除」に化けない
    const legacy = { ...PEAK_RULE };
    delete (legacy as { exempt?: boolean }).exempt;
    expect(exceededFrequencyLimit([legacy], candidateFri18, [booking({})])?.id).toBe("rule-peak");
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
// 🔴 検査は「連結全体」ではなく**最後の定義**に対して行う。
// CREATE OR REPLACE は最後の定義しか残らないため、連結全体への肯定形マッチだと
// 初出のファイルが永久に満たし続け、後発マイグレーションによる骨抜き上書きを
// 見逃す（レビューで実証された穴）。delete_my_gym の「1回の定義に全テーブル」
// 事故もこの形でしか捕まえられない。
const migrationsDir = "supabase/migrations";
const limitSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()   // 適用順 = ファイル名順。readdir の順序保証に依存しない
  .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"))
  .filter((sql) =>
    /booking_frequency_limits|guard_booking_frequency_limit|delete_my_gym/.test(sql))
  .join("\n")
  // 行末コメントも落とす（行頭だけだと「コード削除＋行末コメントに旧コードを残す」
  // 変異がコメントにマッチして緑のまま通る。gymOwnership.test.ts の stripSql と同じ手法）
  .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

/** 連結の中の「名前 name の最後の CREATE OR REPLACE FUNCTION」の本文を切り出す */
const lastFunctionDef = (name: string): string => {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const at = limitSql.lastIndexOf(marker);
  expect(at, `${name} の定義が見つからない`).toBeGreaterThanOrEqual(0);
  const rest = limitSql.slice(at);
  const end = rest.search(/\$(function)?\$;/);
  return end >= 0 ? rest.slice(0, end) : rest;
};

describe("🔴 DB 側の規則がクライアントと一致している", () => {
  const guard = lastFunctionDef("guard_booking_frequency_limit");

  it("テーブル・トリガー・関数の結線が定義されている", () => {
    expect(limitSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.booking_frequency_limits/);
    expect(limitSql).toMatch(/BEFORE INSERT OR UPDATE ON public\.bookings/);
    // トリガーがこの関数を呼んでいること（関数だけ在って結線が無い、を防ぐ）
    expect(limitSql).toMatch(/EXECUTE FUNCTION public\.guard_booking_frequency_limit\(\)/);
  });

  it("🔴 代理予約とサービスロールは素通しする（自己予約だけを見る）", () => {
    // v_actor の**代入元**まで固定する（NEW.user_id を代入すると素通し条件が恒偽になり、
    // IF 行はそのままでも代理予約まで制限される）。
    expect(guard).toMatch(/v_actor := auth\.uid\(\);/);
    expect(guard).toMatch(
      /IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW\.user_id THEN\s*\n\s*RETURN NEW;/,
    );
  });

  it("🔴 'キャンセル済み' からの復活は日時が変わらなくても判定する", () => {
    // 「キャンセル行を先に置く → 別の枠を取る → 復活」で上限をすり抜ける
    // バイパスを塞ぐ条件（レビューで発覚し、本番でも実挿入で確認済み）。
    // 正規のロールバック（'同日キャンセル済み' → '予約済み'）はこの例外に当たらない。
    expect(guard).toMatch(
      /AND NOT \(OLD\.status = 'キャンセル済み' AND NEW\.status IS DISTINCT FROM 'キャンセル済み'\)/,
    );
    expect(guard).toMatch(/AND NEW\.booking_date IS NOT DISTINCT FROM OLD\.booking_date/);
  });

  it("同一人物の同時リクエストを直列化する（advisory lock）", () => {
    // 2端末同時 INSERT が両方 count=0 を見て上限をすり抜けるレースの対策。
    // 素通し判定の後に置くこと（代理予約・salute_sync まで直列化しない）。
    expect(guard).toMatch(/pg_advisory_xact_lock\(hashtext\(NEW\.tenant_id::text \|\| NEW\.user_id::text\)\)/);
  });

  it("マッチ条件: enabled・対象・曜日・[start, end) がすべて効いている", () => {
    // どれか1つ消えても他のテストは緑のまま通る（変異検証で実証された穴）ので、
    // FOR ループの WHERE 節を1条件ずつピン留めする。
    expect(guard).toMatch(/AND l\.enabled\b/);
    expect(guard).toMatch(/AND \(l\.user_id IS NULL OR l\.user_id = NEW\.user_id\)/);
    expect(guard).toMatch(/AND v_dow = ANY \(l\.weekdays\)/);
    expect(guard).toMatch(/AND v_min >= \(split_part\(l\.start_time/);
    // 終端は排他（<）。<= に変わるとクライアントの [start, end) とずれて、
    // 画面で押せた 19:00 開始の枠が DB で拒否される。
    expect(guard).toMatch(/AND v_min < {2}\(split_part\(l\.end_time/);
  });

  it("曜日と時刻は JST で数え、週は date_trunc('week') = 月曜始まり", () => {
    expect(guard).toMatch(/AT TIME ZONE 'Asia\/Tokyo'/);
    expect(guard).toMatch(/EXTRACT\(DOW FROM v_jst\)/);
    expect(guard).toMatch(/date_trunc\('week', v_jst\)/);
  });

  it("数えない予約は 'キャンセル済み' だけ（消化は数える）", () => {
    expect(guard).toMatch(/b\.status <> 'キャンセル済み'/);
    expect(guard).not.toMatch(/status\s*<>\s*'同日キャンセル済み'/);
  });

  it("自行を数えない・比較は >= max_bookings", () => {
    expect(guard).toMatch(/b\.id IS DISTINCT FROM NEW\.id/);
    expect(guard).toMatch(/IF v_count >= v_limit\.max_bookings THEN/);
  });

  it("🔴 免除を制限ループの前に評価する（免除が制限より強い）", () => {
    // 免除の EXISTS が制限の FOR ループより**前**にあること。順序が逆だと
    // 制限で先に落ちてしまい、免除を作った意味が無くなる。
    const exemptAt = guard.indexOf("AND l.exempt");
    const loopAt = guard.indexOf("FOR v_limit IN");
    expect(exemptAt, "免除の判定が見つからない").toBeGreaterThan(-1);
    expect(loopAt, "制限のループが見つからない").toBeGreaterThan(-1);
    expect(exemptAt, "免除の判定が制限ループより後にある").toBeLessThan(loopAt);
    // 免除は本人あてのみ（全員免除は作れない）
    expect(guard).toMatch(/AND l\.user_id = NEW\.user_id/);
    // 制限のループは免除行を除く
    expect(guard).toMatch(/AND NOT l\.exempt/);
  });

  it("CHECK: 免除は必ず特定のお客様を伴う", () => {
    expect(limitSql).toMatch(/CHECK \(NOT exempt OR user_id IS NOT NULL\)/);
  });

  it("SQLSTATE は GB003（GB001/GB002 と混ぜない）", () => {
    expect(guard).toMatch(/USING ERRCODE = 'GB003'/);
  });

  it("RLS: RESTRICTIVE のテナント境界と anon の遮断", () => {
    expect(limitSql).toMatch(/CREATE POLICY tenant_isolation ON public\.booking_frequency_limits AS RESTRICTIVE/);
    expect(limitSql).toMatch(/REVOKE ALL ON public\.booking_frequency_limits FROM anon/);
  });

  it("🔴 RLS: お客様には「全員向け」と「自分あて」しか見せない", () => {
    expect(limitSql).toMatch(
      /user_id IS NULL\s*\n\s*OR user_id = auth\.uid\(\)\s*\n\s*OR public\.has_tenant_role\(tenant_id, auth\.uid\(\), ARRAY\['owner','trainer'\]\)/,
    );
  });

  it("書き込みは owner / trainer のみ", () => {
    // ポリシーごとに**最後の定義**を見る（後発の DROP+CREATE で作り直されても、
    // 最新の定義が owner/trainer に絞られていることを確認する）。
    for (const kind of ["write", "update", "delete"]) {
      const defs = [...limitSql.matchAll(
        new RegExp(`CREATE POLICY booking_frequency_limits_${kind}[\\s\\S]*?;`, "g"))];
      expect(defs.length, `${kind} ポリシーが見つからない`).toBeGreaterThanOrEqual(1);
      expect(defs[defs.length - 1][0]).toMatch(
        /has_tenant_role\(tenant_id, auth\.uid\(\), ARRAY\['owner','trainer'\]\)/,
      );
    }
  });

  it("テナント削除（delete_my_gym）の**最後の定義**がこの表も消す", () => {
    // delete_my_gym は「1回の定義に全テーブル」の決まり。次にテーブルを足す人が
    // 古い版から再定義してこの DELETE を落とす、が最も起きやすい事故で、
    // 連結全体へのマッチでは検出できない（初出のファイルが満たし続けるため）。
    const gym = lastFunctionDef("delete_my_gym");
    expect(gym).toMatch(/DELETE FROM public\.booking_frequency_limits WHERE tenant_id = v_tenant_id/);
  });

  it("CHECK: 時刻の形式（実際に正規表現として評価して確かめる）", () => {
    // 文字列に "24:00" が含まれるだけの検査だと、書き方を変えたときに素通りする。
    // SQL からパターンを抜き出して JS の RegExp として評価する。複数定義がありうるので
    // **最後の**定義を使う。
    const startMatches = [...limitSql.matchAll(/start_time ~ '([^']+)'/g)];
    expect(startMatches.length, "start_time の CHECK が見つからない").toBeGreaterThanOrEqual(1);
    const startRe = new RegExp(startMatches[startMatches.length - 1][1]);
    expect(startRe.test("00:00")).toBe(true);
    expect(startRe.test("23:30")).toBe(true);
    expect(startRe.test("24:00"), "開始に 24:00 は許さない").toBe(false);
    expect(startRe.test("25:00")).toBe(false);

    const endMatches = [...limitSql.matchAll(/end_time ~ '([^']+)'/g)];
    expect(endMatches.length, "end_time の CHECK が見つからない").toBeGreaterThanOrEqual(1);
    const endRe = new RegExp(endMatches[endMatches.length - 1][1]);
    expect(endRe.test("24:00"), "終了の 24:00（その日いっぱい）は許す").toBe(true);
    expect(endRe.test("19:00")).toBe(true);
    expect(endRe.test("24:30")).toBe(false);
    expect(endRe.test("25:00")).toBe(false);
  });

  it("CHECK: period・回数・曜日の範囲", () => {
    expect(limitSql).toMatch(/CHECK \(period IN \('week', 'day'\)\)/);
    expect(limitSql).toMatch(/CHECK \(max_bookings >= 1 AND max_bookings <= 99\)/);
    // 🔴 cardinality を使うこと。array_length('{}',1) は NULL で CHECK を素通りする
    expect(limitSql).toMatch(/CHECK \(cardinality\(weekdays\) >= 1 AND weekdays <@ ARRAY\[0,1,2,3,4,5,6\]\)/);
  });
});

// ---------------------------------------------------------------------------
// 画面がこの仕組みを実際に使っていることを見張る
// ---------------------------------------------------------------------------
describe("🔴 画面が予約回数の制限を見ている", () => {
  const customerBooking = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
  const trainerSchedule = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
  const gymSettings = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");

  it("お客様の予約画面は、枠の生成・送信直前・リスケ直前の3箇所で判定する", () => {
    expect(customerBooking).toContain("exceededFrequencyLimit(");
    expect(customerBooking).toContain("isBookingLimitError(");
    expect(customerBooking).toContain("useBookingFrequencyLimits(");
    // 「1出現あればよし」だと handleBook / handleReschedule の直前チェックを
    // 消しても緑のまま（変異検証で実証）。呼び出し箇所数で見張る。
    const calls = (customerBooking.match(/isSlotOverLimit\(/g) ?? []).length;
    expect(calls, "isSlotOverLimit の呼び出しが3箇所より少ない").toBeGreaterThanOrEqual(3);
  });

  it("🔴 リスケ中の除外は消化かどうかで変える（DBと同じ答えになるように）", () => {
    // 消化リスケでは旧行が「同日キャンセル済み」で残り DB はそれを数える。
    // クライアントも除外しない（除外すると「空き」と見せた枠が必ず GB003 で拒否される）。
    expect(customerBooking).toContain(
      "rescheduleTargetForfeits ? null : (rescheduleTarget?.id ?? null)",
    );
  });

  it("復元まで失敗したら「変更に失敗」ではなく専用の文言で知らせる", () => {
    // 復元失敗＝元の予約が消えている。無音や汎用文言で流さない。
    expect(customerBooking).toContain("restoreFailed");
    expect(customerBooking).toContain('t("bookingLimits.errorRestoreFailed")');
    const useBookings = readFileSync("src/hooks/useBookings.ts", "utf8");
    expect(useBookings).toContain("restoreFailed: true");
    // 定期予約のスキップ理由（code）も捨てない（満枠と上限で案内が違う）
    expect(useBookings).toMatch(/skipped\.push\(\{ date: dateKey, code:/);
  });

  it("🔴 店側の代理予約（TrainerSchedule）はクライアント判定を持たない", () => {
    // 制限しないのは仕様（店の裁量で例外を作れる）。ここに判定を足すと仕様が変わる。
    // DB トリガー側の素通し（auth.uid() ≠ user_id）とセットで初めて成立する非対称なので、
    // どちらか片方だけ変えると挙動がねじれる。変えるなら mem を読み直してから。
    expect(trainerSchedule).not.toContain("exceededFrequencyLimit(");
    // GB003 の文言分岐だけは持つ（トレーナーが自分をお客様として選んだときに出る）
    expect(trainerSchedule).toContain("isBookingLimitError(");
  });

  it("設定画面で制限と免除を切り替えられる", () => {
    const limitsUi = readFileSync("src/components/trainer/TrainerBookingLimits.tsx", "utf8");
    expect(limitsUi).toContain('t("bookingLimits.kindExempt")');
    // 全員免除は保存前に文言で弾く（DB の CHECK に当たる前に）
    expect(limitsUi).toContain('t("bookingLimits.exemptNeedsCustomer")');
    expect(limitsUi).toMatch(/r\.exempt && r\.userId === TARGET_ALL/);
    // 免除の行では「全員」を選べない
    expect(limitsUi).toMatch(/\{!rule\.exempt && \(/);
  });

  it("フックが exempt 列も読む（読まないと免除が効かない）", () => {
    const hook = readFileSync("src/hooks/useBookingFrequencyLimits.ts", "utf8");
    expect(hook).toContain("exempt");
  });

  it("設定画面に編集セクションが載っている", () => {
    expect(gymSettings).toContain("<TrainerBookingLimits />");
  });

  it("設定画面の保存はテナントに閉じ、失敗が「全消失」に倒れない", () => {
    const limitsUi = readFileSync("src/components/trainer/TrainerBookingLimits.tsx", "utf8");
    // 入れ替えの削除・挿入はどちらも tenant_id 付き（他店に及ばない）
    expect(limitsUi).toContain('.eq("tenant_id", tenant.id)');
    expect(limitsUi).toContain("tenant_id: tenant.id");
    // 🔴 挿入 → 差分削除の順（逆だと、削除成功後の挿入失敗で制限が全部静かに消える）
    const insertAt = limitsUi.indexOf('.insert(rows as never)');
    const diffDeleteAt = limitsUi.indexOf('.not("id", "in"');
    expect(insertAt).toBeGreaterThan(-1);
    expect(diffDeleteAt).toBeGreaterThan(insertAt);
    // 🔴 読み込み失敗を「0件」と区別して保存を塞ぐ（塞がないと通信断→保存で全削除できる）
    expect(limitsUi).toContain("loadFailed");
    expect(limitsUi).toMatch(/disabled=\{saving \|\| loading \|\| loadFailed\}/);
    // DB の CHECK に当たる前の文言バリデーション
    expect(limitsUi).toContain('t("bookingLimits.invalidWeekdays")');
    expect(limitsUi).toContain('t("bookingLimits.invalidRange")');
  });

  it("読めない環境では空配列＝制限なしに倒す（予約を止めない）", () => {
    const hook = readFileSync("src/hooks/useBookingFrequencyLimits.ts", "utf8");
    // 「setLimits([]) がどこかにある」ではなく、エラー分岐の中にあることを見る
    // （tenantId 無し分岐にも同じ文字列があるため）。
    expect(hook).toMatch(/if \(error \|\| !data\) \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*setLimits\(\[\]\)/);
  });

  it("types.ts に booking_frequency_limits が載っている", () => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    expect(types).toMatch(/\n {6}booking_frequency_limits: \{/);
    expect(types).toMatch(/weekdays: number\[\]/);
  });
});
