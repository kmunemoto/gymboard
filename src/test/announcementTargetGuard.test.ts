/**
 * お知らせの「1人宛て」は、そのジムの人にしか出せない（2026-11-01・点検の拡大 push-announcements-1・high）。
 *   `supabase/migrations/20261101010000_announcement_target_must_be_member.sql`
 *
 * target に他のジムの人の user_id を入れると、push-announcements（service_role）がその人の端末に
 * 公式アプリの「お知らせ」を送っていた。誰でも開けるジムのオーナーから、他のジムや運営を騙ったフィッシングができた。
 *
 * 🔴 壊しやすいもの:
 *   1. 門番を SECURITY DEFINER にする → current_user が常に所有者になり素通り
 *   2. 題名・本文の編集でも宛先を確かめる → 宛先が抜けた古い1人宛ての行が編集できなくなる
 *   3. 送る側の絞り込みを外す → 門番より前に入った行・service_role で書いた行が素通り
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (s: string) => stripSql(s).replace(/\s+/g, " ").trim();
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");

const MIGRATION = "20261101010000_announcement_target_must_be_member.sql";
const SQL = norm(read(`supabase/migrations/${MIGRATION}`));
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();

describe("DB の門番（guard_announcement_target）", () => {
  const start = SQL.indexOf("CREATE OR REPLACE FUNCTION public.guard_announcement_target()");
  const fn = SQL.slice(start, SQL.indexOf("$$;", start));

  it("🔴 SECURITY INVOKER で、画面から（authenticated / anon）の書き込みだけを見る", () => {
    expect(start).toBeGreaterThan(-1);
    expect(fn).not.toContain("SECURITY DEFINER");
    expect(fn).toContain("IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;");
  });

  it("全員・除く・個別（と未設定）はそのまま。それ以外は uuid で、そのジムに所属している人（在籍の状態は問わない）", () => {
    expect(fn).toContain("IF NEW.target IS NULL OR NEW.target IN ('all', 'except', 'only') THEN RETURN NEW; END IF;");
    expect(fn).toContain("v_target := NEW.target::uuid;");
    expect(fn).toContain("EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'お知らせの宛先が正しくありません'");
    expect(fn).toContain(
      "IF NOT public.is_tenant_member_any_status(NEW.tenant_id, v_target) THEN RAISE EXCEPTION 'このジムに所属していない方には送れません' USING ERRCODE = '42501';",
    );
  });

  it("題名・本文だけの編集では宛先を見ない（宛先が抜けた古い行も編集できる）", () => {
    expect(fn).toContain(
      "IF TG_OP = 'UPDATE' AND NEW.target IS NOT DISTINCT FROM OLD.target AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN RETURN NEW; END IF;",
    );
  });

  it("INSERT と、宛先・ジムの付け替えに付いている（push_sent_at のクレームでは動かない）", () => {
    expect(SQL).toContain(
      "CREATE TRIGGER trg_guard_announcement_target BEFORE INSERT OR UPDATE OF target, tenant_id ON public.announcements " +
        "FOR EACH ROW EXECUTE FUNCTION public.guard_announcement_target();",
    );
  });

  it("後のマイグレーションが門番を外していない", () => {
    for (const f of migrations.filter((f) => f > MIGRATION)) {
      expect(norm(read(`supabase/migrations/${f}`)), f).not.toContain("DROP TRIGGER IF EXISTS trg_guard_announcement_target");
    }
  });
});

describe("送る側（push-announcements）でも、1人宛て・個別の宛先をそのジムの人に絞る", () => {
  const src = code("supabase/functions/push-announcements/index.ts");

  it("🔴 全員・除く以外は、tenant_members（そのジム）で確かめてから送る", () => {
    const filterAt = src.indexOf('if (a.target !== "all" && a.target !== "except" && userIds.length > 0) {');
    expect(filterAt).toBeGreaterThan(-1);
    expect(src).toMatch(/\.from\("tenant_members"\)\s*\.select\("user_id"\)\s*\.eq\("tenant_id", a\.tenant_id\)\s*\.in\("user_id", userIds\);/);
    expect(src).toContain("userIds = userIds.filter((id) => members.has(id));");
    // 送るより前
    expect(filterAt).toBeLessThan(src.indexOf('supabase.functions.invoke("send-push-notification"'));
  });

  it("ジムの分からない行には送らない・確かめられなければ送らずにやり直す", () => {
    expect(src).toMatch(/if \(!a\.tenant_id\) \{\s*userIds = \[\];/);
    const errAt = src.indexOf("if (memberErr) {");
    const block = src.slice(errAt, src.indexOf("continue;", errAt));
    expect(block).toContain("push_sent_at: null");
    expect(block).not.toContain("send-push-notification");
  });
});

describe("月次レポートの通知（monthly-report-notification）", () => {
  it("🔴 呼べるのは service_role / cron だけ。認可は無効化の早期 return より前", () => {
    const src = code("supabase/functions/monthly-report-notification/index.ts");
    const authAt = src.indexOf("if (!caller?.isServiceRole && !cronAuthorized) {");
    expect(authAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(src.indexOf("disabled: true"));
  });
});

describe("点検キット", () => {
  it("security/check.sql の検査12 がお知らせも見る", () => {
    const kit = read("security/check.sql");
    expect(kit).toContain("('public.announcements', 'is_tenant_member_any_status\\s*\\(\\s*NEW\\.tenant_id\\s*,\\s*v_target')");
  });
});
