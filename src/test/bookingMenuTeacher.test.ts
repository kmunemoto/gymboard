/**
 * メニューの先生（ヨガ・ピラティス等）は、担当のメニューがオンのときだけお客様の指名を受ける（2026-10-29）。
 * `supabase/migrations/20261029010000_guard_booking_menu_teacher.sql`
 *
 * 古いアプリ（予約メニューを知らない版）は、スタッフが2人以上のジムで「担当を選ぶ」を出し、
 * メニューを送らずに担当だけを指名する。先生を迎えてからメニューをオンにするまでの間に、
 * 先生が普通のトレーニングで指名されてしまうのを DB で止める。
 *
 * 🔴 壊しやすいもの:
 *   1. 店の代理予約まで止める（オーナー・先生が先生の予約を入れられなくなる）
 *   2. 日時の変更（旧行を消して作り直す）で、オフにした先生の既存の予約が動かせなくなる
 *   3. オーナーや、メニューを持たないインストラクター（メニューを使っていない店）の指名まで止める
 *   4. メニューがオンなのに止める
 *   5. 新しいコードで断り、古いアプリに「アプリが古い」と出る（このガードは古いアプリのためのもの）
 *   6. 予約メニューを当てるトリガーより先に動く（bookingMenus.test.tsx が名前順で見張っている）
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { bookingErrorKey, KNOWN_GUARD_CODES } from "@/lib/bookingErrors";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const MIGRATION = "20261029010000_guard_booking_menu_teacher.sql";
const SQL = stripSql(read(`supabase/migrations/${MIGRATION}`));

const fnBody = () => {
  const start = SQL.indexOf("CREATE OR REPLACE FUNCTION public.guard_booking_menu_teacher(");
  expect(start).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf("$function$;", start));
};

describe("断る条件", () => {
  it("🔴 お客様ご自身の予約だけ（店の代理予約・サーバーは見ない）", () => {
    const fn = fnBody();
    expect(fn).toContain("v_actor uuid := auth.uid();");
    expect(fn).toContain("IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id THEN\n    RETURN NEW;");
  });

  it("🔴 日時の変更の作り直し・旧システムからの同期・担当なしは見ない", () => {
    const fn = fnBody();
    expect(fn).toMatch(
      /IF NEW\.staff_user_id IS NULL OR NEW\.tenant_id IS NULL\s+OR \(to_jsonb\(NEW\) ->> 'source'\) = 'salute_sync'\s+OR NEW\.created_via IS NOT DISTINCT FROM 'reschedule' THEN\s+RETURN NEW;/,
    );
  });

  it("🔴 インストラクターで、担当のメニューがあり、オンのものが1つも無いときだけ", () => {
    const fn = fnBody();
    // オーナーは止めない
    expect(fn).toContain("AND tm.role = 'trainer' AND tm.staff_access = 'limited'");
    // メニューを持たないインストラクター（メニューを使っていない店）は止めない
    expect(fn).toMatch(/AND EXISTS \(\s+SELECT 1 FROM public\.booking_menus m\s+WHERE m\.tenant_id = NEW\.tenant_id AND m\.staff_user_id = NEW\.staff_user_id\s+\)/);
    // メニューがオンなら止めない
    expect(fn).toMatch(/AND NOT EXISTS \(\s+SELECT 1 FROM public\.booking_menus m\s+WHERE m\.tenant_id = NEW\.tenant_id AND m\.staff_user_id = NEW\.staff_user_id AND m\.is_active\s+\)/);
  });
});

describe("古いアプリへの案内", () => {
  it("🔴 GB002（シフト外）で断る。古いアプリも知っているコードなので「別のトレーナーか別の曜日を」と出る", () => {
    expect(fnBody().match(/ERRCODE = '(GB\d{3})'/g)).toEqual(["ERRCODE = 'GB002'"]);
    expect(KNOWN_GUARD_CODES).toContain("GB002");
    expect(bookingErrorKey({ code: "GB002" })).toBe("staff.errorStaffOffShift");
  });
});

describe("トリガー", () => {
  it("bookings の BEFORE INSERT。関数は直接呼べない", () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_guard_booking_menu_teacher\s+BEFORE INSERT ON public\.bookings\s+FOR EACH ROW EXECUTE FUNCTION public\.guard_booking_menu_teacher\(\);/);
    expect(SQL).toContain("SECURITY DEFINER");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.guard_booking_menu_teacher() FROM PUBLIC, anon, authenticated;");
  });

  it("🔴 後のマイグレーションが戻していない（最後の定義はこのマイグレーション）", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    const last = files.filter((f) => stripSql(read(`supabase/migrations/${f}`)).includes("FUNCTION public.guard_booking_menu_teacher(")).pop();
    expect(last).toBe(MIGRATION);
  });
});
