import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { checkSlotBlocked, type BookingWithTime } from "@/hooks/useBookings";
import { resolveSlotCapacity, type BookingCapacityWindow } from "@/lib/bookingCapacity";

// 同時に受けられる予約数（tenants.booking_capacity）の判定。
// ベッド2台・施術者2名のような店では、同じ時間に2件まで入れられる必要がある。
// 既定1のときは「1件でも重なれば満枠」＝この機能を入れる前と完全に同じ挙動でなければならない。
//
// 最終判定はDB側の check_booking_overlap（supabase/migrations/20260801000000_booking_capacity.sql）。
// ここはクライアント側の事前チェックが同じ規則で動くことを見張るテスト。

const DATE = "2026-08-10";

const booking = (startTime: string, endTime: string, over: Partial<BookingWithTime> = {}): BookingWithTime => ({
  id: `${startTime}-${Math.random()}`,
  user_id: "u1",
  date: DATE,
  startTime,
  endTime,
  clientName: "テスト",
  status: "予約済み",
  booking_type: "月4回",
  ...over,
});

/** 10:00 開始・60分セッション・15分バッファの候補枠を判定する */
const check = (list: BookingWithTime[], capacity?: number, time = "10:00") =>
  checkSlotBlocked(list, DATE, time, undefined, 15, 60, capacity);

describe("予約の同時受入数（booking_capacity）", () => {
  it("既定1では、重なる予約が1件でもあれば満枠（従来の挙動）", () => {
    expect(check([])).toBe(false);
    expect(check([booking("10:00", "11:00")])).toBe(true);
    // capacity を明示的に 1 で渡しても同じ
    expect(check([booking("10:00", "11:00")], 1)).toBe(true);
  });

  it("capacity=2 なら、重なりが1件のうちはまだ予約できる", () => {
    expect(check([booking("10:00", "11:00")], 2)).toBe(false);
    expect(check([booking("10:00", "11:00"), booking("10:30", "11:30")], 2)).toBe(true);
  });

  it("capacity=3 なら3件目までOK、4件目で満枠", () => {
    const two = [booking("10:00", "11:00"), booking("10:00", "11:00")];
    expect(check(two, 3)).toBe(false);
    expect(check([...two, booking("10:00", "11:00")], 3)).toBe(true);
  });

  it("ブロック枠（休憩・臨時休業）は空きがあっても店全体を塞ぐ", () => {
    const blocked = booking("10:00", "11:00", { isBlocked: true, status: "ブロック済み" });
    expect(check([blocked], 5)).toBe(true);
    // 予約1件 + ブロック1件 → capacity に余裕があってもブロックが優先して不可
    expect(check([booking("10:00", "11:00"), blocked], 5)).toBe(true);
  });

  it("時間が重ならない予約は数に入らない", () => {
    // 10:00開始の候補は 11:15 まで占有（60分+15分バッファ）。11:15開始の予約とは重ならない
    expect(check([booking("11:15", "12:15")], 1)).toBe(false);
  });

  it("キャンセル済みは数に入らない", () => {
    const cancelled = booking("10:00", "11:00", { status: "キャンセル済み" });
    expect(check([cancelled], 1)).toBe(false);
    expect(check([cancelled, booking("10:00", "11:00")], 2)).toBe(false);
  });

  it("別の日の予約は数に入らない", () => {
    expect(check([booking("10:00", "11:00", { date: "2026-08-11" })], 1)).toBe(false);
  });

  it("capacity に 0 や負数が来ても 1 として扱う（全予約が入らなくなる事故を防ぐ）", () => {
    expect(check([], 0)).toBe(false);
    expect(check([booking("10:00", "11:00")], 0)).toBe(true);
    expect(check([booking("10:00", "11:00")], -3)).toBe(true);
  });

  it("バッファは既存予約の後ろにも効く（capacity に余裕があっても件数は数える）", () => {
    // 09:00-10:00 の予約は 10:15 まで占有。10:00開始の候補は重なる
    expect(check([booking("09:00", "10:00")], 1)).toBe(true);
    expect(check([booking("09:00", "10:00")], 2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 時間帯別の同時受け入れ数（booking_capacity_windows、2026-08-21）
// ---------------------------------------------------------------------------
// 店の受け入れ数は時間帯で変わる（昼は2人・夜は1人など）。tenants.booking_capacity
// の1つの値では表せないので、曜日×時間帯の帯で上書きできるようにした。
//
// 守るべき不変条件:
//   1. 帯が1つも無ければ tenants.booking_capacity のまま（＝この機能を入れる前と同じ）
//   2. 時間帯は [start, end)（予約回数の制限と同じ半開区間）
//   3. 🔴 複数マッチは**最小値**（厳しいほうが勝つ）。最大値だと絞る設定が効かない
//   4. クライアントの規則と DB（resolve_booking_capacity）の規則が一致している

// 2026-08-21 は金曜（weekday 5）
const FRI = 5;
const SAT = 6;

const win = (over: Partial<BookingCapacityWindow> = {}): BookingCapacityWindow => ({
  weekdays: [1, 2, 3, 4, 5],
  start_time: "18:00",
  end_time: "21:00",
  capacity: 1,
  ...over,
});

describe("時間帯別の同時受け入れ数", () => {
  it("帯が無ければ店の既定値のまま（従来の挙動）", () => {
    expect(resolveSlotCapacity([], FRI, 18 * 60, 2)).toBe(2);
    expect(resolveSlotCapacity(null, FRI, 18 * 60, 3)).toBe(3);
    expect(resolveSlotCapacity(undefined, FRI, 18 * 60, 1)).toBe(1);
  });

  it("当てはまる帯があれば、その値で上書きする", () => {
    // 店の既定は2件だが、平日18-21時の帯は1件
    expect(resolveSlotCapacity([win()], FRI, 18 * 60, 2)).toBe(1);
    // 帯より上げることもできる（土曜午前は応援がいる、など）
    expect(resolveSlotCapacity([win({ weekdays: [6], capacity: 3 })], SAT, 18 * 60, 1)).toBe(3);
  });

  it("時間帯は [start, end) —— 端の扱いを固定する", () => {
    const w = [win()];                       // 18:00-21:00
    expect(resolveSlotCapacity(w, FRI, 18 * 60, 5)).toBe(1);          // 18:00 ちょうどは効く
    expect(resolveSlotCapacity(w, FRI, 20 * 60 + 59, 5)).toBe(1);     // 20:59 も効く
    expect(resolveSlotCapacity(w, FRI, 21 * 60, 5)).toBe(5);          // 21:00 は効かない（終端）
    expect(resolveSlotCapacity(w, FRI, 17 * 60 + 59, 5)).toBe(5);     // 17:59 も効かない
  });

  it("曜日が合わなければ効かない", () => {
    expect(resolveSlotCapacity([win()], SAT, 18 * 60, 4)).toBe(4);
  });

  it("🔴 複数マッチは最小値（厳しいほうが勝つ）", () => {
    // 「平日は2件」と「金曜の夜は1件」が重なったら1件。最大値を採ると、
    // 絞るつもりで足した帯が広い帯に負けて「設定したのに効かない」事故になる。
    const wide = win({ start_time: "09:00", end_time: "24:00", capacity: 2 });
    const narrow = win({ weekdays: [5], start_time: "18:00", end_time: "21:00", capacity: 1 });
    expect(resolveSlotCapacity([wide, narrow], FRI, 19 * 60, 5)).toBe(1);
    expect(resolveSlotCapacity([narrow, wide], FRI, 19 * 60, 5)).toBe(1);   // 並び順に依らない
    // 重なっていない時刻では広いほうだけが効く
    expect(resolveSlotCapacity([wide, narrow], FRI, 22 * 60, 5)).toBe(2);
  });

  it("終了 24:00（その日いっぱい）の帯が解釈できる", () => {
    const allDay = [win({ start_time: "00:00", end_time: "24:00", capacity: 2 })];
    expect(resolveSlotCapacity(allDay, FRI, 23 * 60 + 59, 1)).toBe(2);
  });

  it("壊れた行・0以下の値は効かせない（既定値に倒す）", () => {
    expect(resolveSlotCapacity([win({ start_time: "あ" })], FRI, 18 * 60, 2)).toBe(2);
    expect(resolveSlotCapacity([win({ capacity: 0 })], FRI, 18 * 60, 2)).toBe(2);
    // 既定値側が壊れていても必ず 1 以上
    expect(resolveSlotCapacity([], FRI, 18 * 60, 0)).toBe(1);
    expect(resolveSlotCapacity([], FRI, 18 * 60, null)).toBe(1);
  });

  it("曜日・時刻が読めなければ帯を当てはめない", () => {
    expect(resolveSlotCapacity([win({ capacity: 9 })], null, 18 * 60, 2)).toBe(2);
    expect(resolveSlotCapacity([win({ capacity: 9 })], FRI, null, 2)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// DB 側の規則がクライアントと一致していることを、migrations の SQL から見張る
// ---------------------------------------------------------------------------
// 🔴 検査は「連結全体」ではなく**最後の定義**に対して行う。CREATE OR REPLACE は
// 最後の定義しか残らないため、連結全体への肯定形マッチだと後発マイグレーションによる
// 骨抜き上書きを見逃す（booking_frequency_limits のレビューで実証された穴）。
const capacitySql = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
  .filter((sql) =>
    /booking_capacity_windows|resolve_booking_capacity|check_booking_overlap/.test(sql))
  .join("\n")
  // 行末コメントも落とす（コード削除＋行末コメントに旧コードを残す変異を通さない）
  .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

/** 連結の中の「名前 name の最後の CREATE OR REPLACE FUNCTION」の本文を切り出す */
const lastFn = (name: string): string => {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const at = capacitySql.lastIndexOf(marker);
  expect(at, `${name} の定義が見つからない`).toBeGreaterThanOrEqual(0);
  const rest = capacitySql.slice(at);
  const end = rest.search(/\$(function)?\$;/);
  return end >= 0 ? rest.slice(0, end) : rest;
};

describe("🔴 DB 側の容量の解決がクライアントと一致している", () => {
  const resolver = lastFn("resolve_booking_capacity");
  const overlap = lastFn("check_booking_overlap");

  it("テーブルと解決関数が定義されている", () => {
    expect(capacitySql).toMatch(/CREATE TABLE IF NOT EXISTS public\.booking_capacity_windows/);
    expect(capacitySql).toMatch(/CREATE OR REPLACE FUNCTION public\.resolve_booking_capacity/);
  });

  it("🔴 満枠判定が帯を見て容量を決めている", () => {
    // ここが tenants.booking_capacity の直読みに戻ると、帯を作っても効かなくなる。
    expect(overlap).toMatch(
      /capacity_limit := public\.resolve_booking_capacity\(NEW\.tenant_id, NEW\.booking_date\)/,
    );
    // 直読みが復活していないこと
    expect(overlap).not.toMatch(/INTO buffer_min, tenant_session_min, capacity_limit/);
  });

  it("🔴 複数マッチは最小値を採る", () => {
    // max() や単なる LIMIT 1 に変わると、絞るつもりの帯が効かなくなる。
    expect(resolver).toMatch(/SELECT min\(w\.capacity\) INTO v_window/);
  });

  it("マッチ条件: enabled・曜日・[start, end) が効いている", () => {
    expect(resolver).toMatch(/AND w\.enabled\b/);
    expect(resolver).toMatch(/AND v_dow = ANY \(w\.weekdays\)/);
    expect(resolver).toMatch(/AND v_min >= \(split_part\(w\.start_time/);
    // 終端は排他（<）。<= だとクライアントの [start, end) とずれる
    expect(resolver).toMatch(/AND v_min < {2}\(split_part\(w\.end_time/);
  });

  it("曜日と時刻は JST で数える", () => {
    expect(resolver).toMatch(/AT TIME ZONE 'Asia\/Tokyo'/);
    expect(resolver).toMatch(/EXTRACT\(DOW FROM v_jst\)/);
  });

  it("帯が無ければ tenants.booking_capacity、必ず 1 以上に倒す", () => {
    expect(resolver).toMatch(/SELECT t\.booking_capacity INTO v_fallback/);
    expect(resolver).toMatch(/v_fallback := GREATEST\(COALESCE\(v_fallback, 1\), 1\)/);
    expect(resolver).toMatch(/RETURN GREATEST\(COALESCE\(v_window, v_fallback\), 1\)/);
  });

  it("RLS: RESTRICTIVE のテナント境界と anon の遮断", () => {
    expect(capacitySql).toMatch(
      /CREATE POLICY tenant_isolation ON public\.booking_capacity_windows AS RESTRICTIVE/);
    expect(capacitySql).toMatch(/REVOKE ALL ON public\.booking_capacity_windows FROM anon/);
  });

  it("公開ページ向けの RPC は有効な帯だけ・営業中の店だけを返す", () => {
    const rpc = lastFn("get_tenant_capacity_windows");
    expect(rpc).toMatch(/AND w\.enabled\b/);
    expect(rpc).toMatch(/t\.status IN \('active', 'trial'\)/);
    expect(capacitySql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_tenant_capacity_windows\(UUID\) TO anon, authenticated/);
  });

  it("書き込みは owner / trainer のみ", () => {
    for (const kind of ["write", "update", "delete"]) {
      const defs = [...capacitySql.matchAll(
        new RegExp(`CREATE POLICY booking_capacity_windows_${kind}[\\s\\S]*?;`, "g"))];
      expect(defs.length, `${kind} ポリシーが見つからない`).toBeGreaterThanOrEqual(1);
      expect(defs[defs.length - 1][0]).toMatch(
        /has_tenant_role\(tenant_id, auth\.uid\(\), ARRAY\['owner','trainer'\]\)/);
    }
  });

  it("テナント削除（delete_my_gym）の最後の定義がこの表も消す", () => {
    const gym = lastFn("delete_my_gym");
    expect(gym).toMatch(/DELETE FROM public\.booking_capacity_windows WHERE tenant_id = v_tenant_id/);
  });

  it("CHECK: 時刻・件数・曜日（正規表現は実際に評価して確かめる）", () => {
    const startPattern = [...capacitySql.matchAll(/start_time ~ '([^']+)'/g)];
    const startRe = new RegExp(startPattern[startPattern.length - 1][1]);
    expect(startRe.test("00:00")).toBe(true);
    expect(startRe.test("24:00"), "開始に 24:00 は許さない").toBe(false);

    const endPattern = [...capacitySql.matchAll(/end_time ~ '([^']+)'/g)];
    const endRe = new RegExp(endPattern[endPattern.length - 1][1]);
    expect(endRe.test("24:00"), "終了の 24:00 は許す").toBe(true);
    expect(endRe.test("24:30")).toBe(false);

    expect(capacitySql).toMatch(/CHECK \(capacity >= 1 AND capacity <= 99\)/);
    // 🔴 cardinality を使うこと（array_length('{}',1) は NULL で CHECK を素通りする）
    expect(capacitySql).toMatch(
      /CHECK \(cardinality\(weekdays\) >= 1 AND weekdays <@ ARRAY\[0,1,2,3,4,5,6\]\)/);
  });
});

describe("🔴 画面が時間帯別の容量を見ている", () => {
  it("会員の予約画面・ジムの予定表・公開ページの4画面すべてで解決する", () => {
    for (const f of [
      "src/components/customer/CustomerBooking.tsx",
      "src/components/trainer/TrainerSchedule.tsx",
      "src/pages/TrialBooking.tsx",
      "src/pages/DropInBooking.tsx",
    ]) {
      expect(readFileSync(f, "utf8"), `${f} が帯を見ていない`).toContain("resolveSlotCapacity(");
    }
  });

  it("公開ページは表ではなく RPC から読む（anon に表は開けない）", () => {
    for (const f of ["src/pages/TrialBooking.tsx", "src/pages/DropInBooking.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain('supabase.rpc("get_tenant_capacity_windows"');
      expect(src).not.toContain('from("booking_capacity_windows")');
    }
  });

  it("読めない環境では空配列＝帯なしに倒す（予約を止めない）", () => {
    const hook = readFileSync("src/hooks/useBookingCapacityWindows.ts", "utf8");
    expect(hook).toMatch(/if \(error \|\| !data\) \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*setWindows\(\[\]\)/);
    // 無効な帯は最初から渡さない（解決関数に enabled の判断を持たせない）
    expect(hook).toContain('.eq("enabled", true)');
  });

  it("設定画面に編集セクションが載っている", () => {
    const gymSettings = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");
    expect(gymSettings).toContain("<TrainerCapacityWindows />");
  });

  it("設定画面の保存は挿入→差分削除の順（失敗が全消失に倒れない）", () => {
    const ui = readFileSync("src/components/trainer/TrainerCapacityWindows.tsx", "utf8");
    const insertAt = ui.indexOf(".insert(rows as never)");
    const diffDeleteAt = ui.indexOf('.not("id", "in"');
    expect(insertAt).toBeGreaterThan(-1);
    expect(diffDeleteAt).toBeGreaterThan(insertAt);
    expect(ui).toMatch(/disabled=\{saving \|\| loading \|\| loadFailed\}/);
  });

  it("types.ts に booking_capacity_windows と RPC が載っている", () => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    expect(types).toMatch(/\n {6}booking_capacity_windows: \{/);
    expect(types).toMatch(/\n {6}get_tenant_capacity_windows: \{/);
  });
});
