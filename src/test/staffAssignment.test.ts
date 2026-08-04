import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { checkSlotBlocked, type BookingWithTime } from "@/hooks/useBookings";
import {
  canSelectStaff,
  isStaffBusy,
  isStaffConflictError,
  staffNameMap,
  STAFF_SELECTION_MIN,
  type TenantStaff,
} from "@/lib/tenantStaff";

// 予約の「担当スタッフ」。トレーナーが複数いるジム向け。
//
// 設計の要は **店全体の同時受入数（tenants.booking_capacity）の意味を変えていない** こと。
// 担当者の制約はその上に重ねる追加の条件で、担当なし（null）の予約は対象外。
// ＝担当を使っていないジムでは、この機能を入れる前と1ミリも挙動が変わらない。
//
// 最終判定はDB側（supabase/migrations/20260804000000_booking_staff_assignment.sql）。
// ここはクライアント側の事前チェックが同じ規則で動くことと、
// マイグレーションが「静かに壊れる形」になっていないことを見張る。

const DATE = "2026-08-10";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const booking = (startTime: string, endTime: string, over: Partial<BookingWithTime> = {}): BookingWithTime => ({
  id: `${startTime}-${endTime}-${over.staff_user_id ?? "none"}`,
  user_id: "u1",
  date: DATE,
  startTime,
  endTime,
  clientName: "テスト",
  status: "予約済み",
  booking_type: "月4回",
  staff_user_id: null,
  ...over,
});

/** 10:00 開始・60分セッション・15分バッファの候補枠を判定する */
const check = (list: BookingWithTime[], capacity: number, staffUserId: string | null = null) =>
  checkSlotBlocked(list, DATE, "10:00", undefined, 15, 60, capacity, staffUserId);

describe("担当スタッフを指名したときの空き枠判定（checkSlotBlocked）", () => {
  it("担当を指名しなければ、担当付きの予約があっても従来どおり件数だけで判定する", () => {
    const withStaff = [booking("10:00", "11:00", { staff_user_id: A })];
    expect(check(withStaff, 2)).toBe(false); // capacity 2 のうち1件 → まだ空き
    expect(check(withStaff, 1)).toBe(true);  // capacity 1 → 満枠（従来と同じ）
  });

  it("店に空きがあっても、指名した担当が埋まっていれば取れない", () => {
    const list = [booking("10:00", "11:00", { staff_user_id: A })];
    expect(check(list, 2, A)).toBe(true);
  });

  it("別の担当を選べば、同じ時間でも取れる", () => {
    const list = [booking("10:00", "11:00", { staff_user_id: A })];
    expect(check(list, 2, B)).toBe(false);
  });

  it("担当が埋まっていても、時間が重ならなければ取れる", () => {
    // 10:00開始の候補は 11:15 まで占有（60分＋15分バッファ）
    expect(check([booking("11:15", "12:15", { staff_user_id: A })], 2, A)).toBe(false);
  });

  it("担当なしの既存予約は、誰を指名しても担当者としては衝突しない", () => {
    const list = [booking("10:00", "11:00", { staff_user_id: null })];
    expect(check(list, 2, A)).toBe(false);
  });

  it("店の同時受入数が先に効く（担当が空いていても店が満枠なら不可）", () => {
    const list = [
      booking("10:00", "11:00", { staff_user_id: A }),
      booking("10:00", "11:00", { staff_user_id: B }),
    ];
    expect(check(list, 2, "33333333-3333-4333-8333-333333333333")).toBe(true);
  });

  it("ブロック枠は担当に関係なく店全体を塞ぐ", () => {
    const blocked = booking("10:00", "11:00", { isBlocked: true, status: "ブロック済み" });
    expect(check([blocked], 5, A)).toBe(true);
  });

  it("キャンセル済みの担当付き予約は衝突しない", () => {
    const list = [booking("10:00", "11:00", { staff_user_id: A, status: "キャンセル済み" })];
    expect(check(list, 2, A)).toBe(false);
  });
});

describe("tenantStaff のヘルパー", () => {
  const staff: TenantStaff[] = [
    { user_id: A, display_name: "オーナー", role: "owner" },
    { user_id: B, display_name: "山田", role: "trainer" },
  ];

  it("スタッフが1人以下なら担当セレクタを出さない", () => {
    expect(STAFF_SELECTION_MIN).toBe(2);
    expect(canSelectStaff([])).toBe(false);
    expect(canSelectStaff([staff[0]])).toBe(false);
    expect(canSelectStaff(staff)).toBe(true);
  });

  it("staffNameMap は user_id から表示名を引ける", () => {
    expect(staffNameMap(staff)).toEqual({ [A]: "オーナー", [B]: "山田" });
  });

  it("isStaffBusy は指名なし（null）のとき常に false", () => {
    const slots = [{ startMin: 600, endMin: 675, staffUserId: A }];
    expect(isStaffBusy(slots, null, 600, 675)).toBe(false);
    expect(isStaffBusy(slots, A, 600, 675)).toBe(true);
    expect(isStaffBusy(slots, B, 600, 675)).toBe(false);
    // 端が接するだけ（10:00-11:15 の直後に 11:15 開始）は重ならない
    expect(isStaffBusy(slots, A, 675, 750)).toBe(false);
  });

  it("担当が埋まっているエラーは SQLSTATE で見分ける（文言一致にしない）", () => {
    expect(isStaffConflictError({ code: "GB001" })).toBe(true);
    expect(isStaffConflictError({ code: "23514" })).toBe(false);
    expect(isStaffConflictError({ message: "この担当者はその時間帯にすでに予約が入っています" })).toBe(false);
    expect(isStaffConflictError(null)).toBe(false);
    expect(isStaffConflictError(undefined)).toBe(false);
  });
});

const ASSIGN_SQL = readFileSync(
  "supabase/migrations/20260804000000_booking_staff_assignment.sql",
  "utf8",
);
const INVITE_SQL = readFileSync(
  "supabase/migrations/20260804010000_staff_invite_code.sql",
  "utf8",
);

describe("マイグレーション: 予約の担当スタッフ", () => {
  it("check_booking_overlap は NEW.staff_user_id を直接参照しない", () => {
    // この関数は bookings と trial_bookings の両方のトリガーから呼ばれる。
    // trial_bookings に staff_user_id 列は無いので、直接参照すると
    // **体験予約の登録だけが実行時に落ちる**（テストもビルドも緑のまま）。
    const fn = ASSIGN_SQL.slice(ASSIGN_SQL.indexOf("FUNCTION public.check_booking_overlap"));
    expect(fn).not.toMatch(/NEW\.staff_user_id/);
    expect(fn).toMatch(/to_jsonb\(NEW\)\s*->>\s*'staff_user_id'/);
  });

  it("担当なし（NULL）の予約は担当者単位の判定に入らない", () => {
    expect(ASSIGN_SQL).toMatch(/new_staff IS NOT NULL[\s\S]*?existing\.staff_user_id = new_staff/);
  });

  it("体験予約とブロック枠は担当を持たない（NULL::uuid）", () => {
    expect(ASSIGN_SQL.match(/NULL::uuid AS staff_user_id/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("店全体の判定（capacity・ブロック）は従来のまま残っている", () => {
    expect(ASSIGN_SQL).toMatch(/blocked_count > 0 OR overlap_count >= capacity_limit/);
    expect(ASSIGN_SQL).toMatch(/この時間帯はすでに予約が入っています/);
  });

  it("担当者が埋まっているときは専用の SQLSTATE 'GB001' で拒否する", () => {
    // 「店が満枠」と同じエラーにすると、別の担当なら取れることに気づけない。
    expect(ASSIGN_SQL.match(/ERRCODE = 'GB001'/g)?.length).toBe(2);
  });

  it("担当スタッフは「そのテナントの現役スタッフ」でなければ書き込めない", () => {
    const guard = ASSIGN_SQL.slice(ASSIGN_SQL.indexOf("guard_booking_staff_assignment"));
    expect(guard).toMatch(/tm\.tenant_id = NEW\.tenant_id/);
    expect(guard).toMatch(/tm\.role IN \('owner', 'trainer'\)/);
    expect(guard).toMatch(/tm\.status = 'active'/);
    expect(guard).toMatch(/BEFORE INSERT OR UPDATE ON public\.bookings/);
  });

  it("担当が変わっていない UPDATE は検証しない（辞めたスタッフの予約が触れなくなるのを防ぐ）", () => {
    // tenant_members.status は owner/trainer が変更でき、行そのものもオーナーが
    // DELETE できる。担当が変わらない UPDATE まで検証すると、スタッフが辞けた瞬間に
    // その人が担当だった予約が**キャンセルすらできなくなる**。
    const guard = ASSIGN_SQL.slice(
      ASSIGN_SQL.indexOf("FUNCTION public.guard_booking_staff_assignment"),
      ASSIGN_SQL.indexOf("guard_booking_staff_reassign"),
    );
    expect(guard).toMatch(/TG_OP = 'UPDATE'/);
    expect(guard).toMatch(/v_staff IS NOT DISTINCT FROM v_old_staff[\s\S]{0,80}RETURN NEW;/);
  });

  it("担当だけを差し替える UPDATE でも二重予約を作らせない", () => {
    expect(ASSIGN_SQL).toMatch(/guard_booking_staff_reassign/);
    expect(ASSIGN_SQL).toMatch(/BEFORE UPDATE ON public\.bookings\s*\n\s*FOR EACH ROW\s*\n\s*EXECUTE FUNCTION public\.guard_booking_staff_reassign/);
  });

  it("get_tenant_booked_slots は staff_user_id を返し、DROP してから作り直して GRANT し直す", () => {
    // RETURNS TABLE の列を増やすので CREATE OR REPLACE だけでは適用できない。
    // DROP を忘れると本番適用が失敗し、GRANT を忘れると公開ページが読めなくなる。
    expect(ASSIGN_SQL).toMatch(/DROP FUNCTION IF EXISTS public\.get_tenant_booked_slots\(uuid, date, date\)/);
    expect(ASSIGN_SQL).toMatch(/RETURNS TABLE\([\s\S]*?staff_user_id uuid\s*\n\)/);
    expect(ASSIGN_SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_tenant_booked_slots\(uuid, date, date\) TO anon, authenticated/);
  });
});

describe("マイグレーション: スタッフ招待", () => {
  it("スタッフ用の招待コードはお客様用（invite_code）と別の列", () => {
    expect(INVITE_SQL).toMatch(/ADD COLUMN IF NOT EXISTS staff_invite_code text/);
    // お客様用のコードを流用していない（流用するとお客様向けリンクからスタッフになれる）
    expect(INVITE_SQL).not.toMatch(/t\.invite_code\s*=/);
  });

  it("スタッフ用コードはテーブル直読みでは見えない", () => {
    expect(INVITE_SQL).toMatch(/REVOKE SELECT \(staff_invite_code\) ON public\.tenants FROM authenticated/);
    expect(INVITE_SQL).toMatch(/REVOKE SELECT \(staff_invite_code\) ON public\.tenants FROM anon/);
  });

  it("コードの参照・再発行はオーナーだけ", () => {
    for (const fn of ["get_my_staff_invite_code", "regenerate_staff_invite_code"]) {
      const body = INVITE_SQL.slice(INVITE_SQL.indexOf(`FUNCTION public.${fn}`));
      expect(body.slice(0, 1200), fn).toMatch(/owner_user_id = auth\.uid\(\)/);
    }
  });

  it("加入 RPC は自分の行だけを作り、role は 'trainer' 固定", () => {
    const join = INVITE_SQL.slice(INVITE_SQL.indexOf("FUNCTION public.join_tenant_as_staff_with_invite_code"));
    // 引数に user_id / role を取らない（取ると他人の行の作成・owner への昇格に使える）
    expect(join.slice(0, 400)).not.toMatch(/p_user_id|p_role/);
    expect(join).toMatch(/VALUES \(v_tenant_id, v_uid, 'trainer', v_name, 'active'\)/);
    expect(join).toMatch(/SECURITY DEFINER/);
  });

  it("スタッフ削除はオーナーのみ・自分自身と trainer 以外は消せない", () => {
    const rm = INVITE_SQL.slice(INVITE_SQL.indexOf("FUNCTION public.remove_staff_member"));
    expect(rm).toMatch(/owner_user_id = v_uid/);
    expect(rm).toMatch(/p_user_id = v_uid/);
    expect(rm).toMatch(/v_target_role <> 'trainer'/);
    // 予約は消さず「担当なし」に戻す
    expect(rm).toMatch(/UPDATE public\.bookings\s*\n\s*SET staff_user_id = NULL/);
  });
});

describe("マイグレーション適用前のDBでも従来どおり動くこと", () => {
  // リポジトリにコミット済み＝本番DBに適用済み、ではない（mem/ops/schema-drift.md）。
  // PostgREST は**存在しない列を名指しした瞬間にリクエストごと拒否する**ので、
  // 新しい列を無条件に payload / select へ入れると、適用までの間
  // 「担当を使っていない店の、ごく普通の予約」まで全部落ちる。
  const hooks = readFileSync("src/hooks/useBookings.ts", "utf8");

  it("担当を指名しないときは insert の payload に staff_user_id を入れない", () => {
    // 無条件に入れると PGRST204 で **すべての予約作成** が拒否される。
    expect(hooks).toMatch(/\.\.\.\(staffUserId \? \{ staff_user_id: staffUserId \} : \{\}\)/);
    expect(hooks).not.toMatch(/^\s*staff_user_id: (opts\.)?staffUserId( \?\? null)?,\s*$/m);
  });

  it("列を明示列挙する select に staff_user_id を混ぜない", () => {
    // 列挙に混ぜると 42703 で **すべての予約変更** が失敗する。`*` なら
    // その時点でDBにある列がそのまま返る（無ければ undefined になるだけ）。
    const files = [
      "src/hooks/useBookings.ts",
      "src/components/customer/CustomerBooking.tsx",
      "src/components/trainer/TrainerSchedule.tsx",
      "src/lib/tenantStaff.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\.select\(\s*"([^"]*)"/g)) {
        expect(m[1], `${f}: select("${m[1]}") が staff_user_id を名指ししている`).not.toMatch(/staff_user_id/);
      }
    }
  });
});

describe("types.ts（コードが期待するスキーマ）", () => {
  const types = readFileSync("src/integrations/supabase/types.ts", "utf8");

  /** `Tables:` 配下の指定テーブルの Row ブロックだけを切り出す */
  const rowBlockOf = (table: string): string => {
    const head = types.indexOf(`\n      ${table}: {\n        Row: {\n`);
    expect(head, `types.ts に ${table} の Row が無い`).toBeGreaterThan(-1);
    const start = types.indexOf("Row: {", head) + "Row: {".length;
    return types.slice(start, types.indexOf("\n        }", start));
  };

  it("bookings.staff_user_id と tenants.staff_invite_code が入っている", () => {
    // ここが欠けると scripts/check-schema-applied.mjs が本番の適用漏れを検出できない。
    // 「ファイル全体に文字列があるか」で見ると、get_tenant_booked_slots の
    // Returns 側にある staff_user_id を拾って**列が消えても緑のまま**になる。
    // 該当テーブルの Row ブロックに絞って確認する。
    expect(rowBlockOf("bookings")).toMatch(/\n {10}staff_user_id: string \| null\n/);
    expect(rowBlockOf("tenants")).toMatch(/\n {10}staff_invite_code: string \| null\n/);
  });

  it("新しい RPC が Functions に載っている", () => {
    for (const fn of [
      "get_my_staff_invite_code",
      "regenerate_staff_invite_code",
      "lookup_tenant_by_staff_invite_code",
      "join_tenant_as_staff_with_invite_code",
      "remove_staff_member",
    ]) {
      expect(types, fn).toMatch(new RegExp(`^ {6}${fn}: `, "m"));
    }
  });
});

describe("文言（5言語）", () => {
  const langs = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
  const staffOf = (l: string) =>
    JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8")).staff as Record<string, string>;

  it("staff の全キーが5言語に揃っている", () => {
    const base = Object.keys(staffOf("ja")).sort();
    expect(base.length).toBeGreaterThan(20);
    for (const l of langs.slice(1)) {
      const keys = Object.keys(staffOf(l)).sort();
      const missing = base.filter((k) => !keys.includes(k));
      expect(missing, `${l}.json に足りない staff キー: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("業種語彙は i18n キー経由なので、フォークは vertical.ja.json だけで言い換えられる", () => {
    // src/lib/tenantStaff.ts に「トレーナー」等の業種語が直書きされていないこと。
    // 直書きすると兄弟アプリ（施術者・コーチ・担当者…）が毎回このファイルを
    // 書き換えることになり、上流マージのたびに衝突する。
    const lib = readFileSync("src/lib/tenantStaff.ts", "utf8");
    const code = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/トレーナー|施術者|コーチ/);
  });
});
