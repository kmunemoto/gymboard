/**
 * お客様が自分の契約の列（プラン・起算日など）を書き換えて、回数の上限や入金の確認をすり抜けられた穴
 * （2026-11-01・点検の拡大 profiles-plan-guard-1）。
 *   `supabase/migrations/20261101040000_profile_plan_guard_scope.sql`
 *
 * 契約の列は profiles にあって、人ごとに1行・全部のジムで共通。
 *   A) 本人の行は「どこかのスタッフなら素通し」だった → 自分でジムを作ればお客様のまま書き換えられた
 *   B) 2つ目のアカウントのジムに1つ目を入れれば、そのオーナーとして1つ目の契約を書き換えられた
 *   C) 起算日を消す・戻す・予約の無い日にする、ができた（入金の確認が効かない・上限の窓がずれる）
 *
 * 本番で、適用前は C の4通り・B・A がすべて通り、適用後はすべて GB005 になること、
 * アプリの自動設定（予約の日付へ前に進める）と店の変更は今までどおり通ることを確かめた（mem/ops/tenant-boundary.md 穴21）。
 *
 * 🔴 壊しやすいもの:
 *   1. 本人の素通しを「どこかのスタッフ」だけに戻す
 *   2. 起算日の本人の変更の規則（消さない・戻さない・過去にしない・予約がある日）を緩める
 *   3. アプリの自動設定を「予約の日付以外」にする（そうすると DB が断り、起算日が入らなくなる）
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (s: string) => stripSql(s).replace(/\s+/g, " ").trim();

const MIGRATION = "20261101040000_profile_plan_guard_scope.sql";
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
const lastDefFile = (name: string) =>
  [...migrations].reverse().find((f) => norm(read(`supabase/migrations/${f}`)).includes(`CREATE OR REPLACE FUNCTION public.${name}(`));

const SQL = norm(read(`supabase/migrations/${MIGRATION}`));
const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.guard_profile_plan_fields()"));

describe("guard_profile_plan_fields（20261101040000）", () => {
  it("これが最新の定義（後のマイグレーションで上書きされていない）", () => {
    expect(lastDefFile("guard_profile_plan_fields")).toBe(MIGRATION);
    for (const f of migrations.filter((f) => f > MIGRATION)) {
      expect(norm(read(`supabase/migrations/${f}`)), f).not.toContain("DROP TRIGGER IF EXISTS trg_guard_profile_plan_fields");
    }
  });

  it("サービスロール（auth.uid() が無い）は素通しのまま", () => {
    expect(fn).toContain("v_actor := auth.uid(); IF v_actor IS NULL THEN RETURN NEW; END IF;");
  });

  it("🔴 他人の行: そのお客様が自分がスタッフでないジムにも在籍していれば、契約の列は変えさせない", () => {
    const at = fn.indexOf("IF v_actor IS DISTINCT FROM NEW.user_id AND (NEW.plan IS DISTINCT FROM OLD.plan");
    expect(at).toBeGreaterThan(-1);
    const block = fn.slice(at, fn.indexOf("END IF;", at));
    for (const col of ["plan", "grace_enabled", "cycle_start_pinned", "cycle_start_date"]) {
      expect(block, col).toContain(`NEW.${col} IS DISTINCT FROM OLD.${col}`);
    }
    expect(block).toContain("c.user_id = NEW.user_id AND c.role = 'customer' AND c.status = 'active'");
    expect(block).toContain(
      "NOT EXISTS ( SELECT 1 FROM public.tenant_members s WHERE s.user_id = v_actor AND s.tenant_id = c.tenant_id AND s.status = 'active' AND s.role IN ('owner', 'trainer')",
    );
    expect(block).toContain("USING ERRCODE = 'GB005'");
    // 店（インストラクター以外）の素通しより前にある（後ろだと素通りする）
    expect(at).toBeLessThan(fn.indexOf("IF NOT v_limited THEN IF v_actor IS DISTINCT FROM NEW.user_id THEN RETURN NEW;"));
  });

  it("🔴 本人の素通しは、スタッフで、お客様としての所属がどこにも無い人だけ", () => {
    expect(fn).toContain(
      "IF EXISTS ( SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = v_actor AND tm.status = 'active' AND tm.role IN ('owner', 'trainer') ) " +
        "AND NOT EXISTS ( SELECT 1 FROM public.tenant_members c WHERE c.user_id = v_actor AND c.role = 'customer' ) THEN RETURN NEW;",
    );
  });

  it("🔴 本人の起算日の変更: 消さない・戻さない・今日より前にしない・自分の予約がある日だけ", () => {
    const at = fn.indexOf("IF v_actor = NEW.user_id AND NEW.cycle_start_date IS DISTINCT FROM OLD.cycle_start_date");
    expect(at).toBeGreaterThan(-1);
    const block = fn.slice(at, fn.indexOf("END IF;", at));
    expect(block).toContain("NEW.cycle_start_date IS NULL");
    expect(block).toContain("OR NEW.cycle_start_date < OLD.cycle_start_date");
    expect(block).toContain("OR NEW.cycle_start_date < (now() AT TIME ZONE 'Asia/Tokyo')::date");
    expect(block).toContain(
      "OR NOT EXISTS ( SELECT 1 FROM public.bookings b WHERE b.user_id = NEW.user_id AND b.status <> 'キャンセル済み' " +
        "AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date = NEW.cycle_start_date )",
    );
    expect(block).toContain("USING ERRCODE = 'GB005'");
  });

  it("今までの規則（プラン・猶予・固定は本人不可、固定と上限を強制するプランは起算日も不可）は残っている", () => {
    expect(fn).toContain(
      "IF NEW.plan IS DISTINCT FROM OLD.plan OR NEW.grace_enabled IS DISTINCT FROM OLD.grace_enabled OR NEW.cycle_start_pinned IS DISTINCT FROM OLD.cycle_start_pinned THEN",
    );
    expect(fn).toContain("AND OLD.cycle_start_date IS NOT NULL AND ( OLD.cycle_start_pinned OR EXISTS");
    expect(fn).toContain("tp.allow_overflow = false");
    // インストラクター（limited）の扱いも変えていない
    expect(fn).toContain("me.status = 'active' AND me.role = 'trainer' AND me.staff_access = 'limited'");
  });
});

describe("アプリの起算日の自動設定は、DB の規則の中に収まっている", () => {
  const hooks = read("src/hooks/useBookings.ts");
  const course = read("src/lib/courseProgress.ts");

  it("🔴 予約を入れた直後に、その予約の日付（JST）を入れる（消さない）", () => {
    // 予約の日時は `${date}T${時刻}:00+09:00` で、起算日にはその date を渡す
    expect(hooks).toContain("const bookingDate = `${date}T${startTime}:00+09:00`;");
    expect(hooks).toContain("await rebaseCycleStartIfNeeded(userId, date, data.id, bookingType);");
    expect(hooks.indexOf("booking_date: bookingDate")).toBeLessThan(hooks.indexOf("await rebaseCycleStartIfNeeded(userId, date, data.id, bookingType);"));
    expect(hooks).toContain('await supabase.from("profiles").update({ cycle_start_date: dateKey }).eq("user_id", userId);');
    // DB に断られても予約は成立させる（古いアプリも同じ）
    expect(hooks).toContain('console.warn("rebaseCycleStartIfNeeded failed:", e);');
  });

  it("前へしか動かさない（起算日より前の予約では動かさない）", () => {
    expect(course).toContain("if (bookingDateKey < cycleStartDate) return false;");
    expect(course).toContain("if (bookingDateKey < effStartKey) return false;");
  });
});
