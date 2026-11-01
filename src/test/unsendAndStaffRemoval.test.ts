/**
 * メッセージの取り消し・インストラクターを外したあと（2026-11-01・点検の拡大）。
 *   `supabase/migrations/20261101030000_unsend_and_staff_removal_fixes.sql`
 *
 * unsend-message-1: unsend_message が `sender_id <> auth.uid()` で送り主を見ていた。未ログイン（anon キーだけ）だと
 *   auth.uid() が NULL で比較も NULL になり、IF が通らず、他人のメッセージを取り消せた（anon が実行できた）。
 * join-staff-rejoin-1: 外したインストラクターが、同じ招待リンクでまた入れた（お客様全員の情報が見える）。
 *
 * 🔴 壊しやすいもの:
 *   1. `<>`／`!=` で auth.uid() と比べる（NULL で素通り）→ 下の走査で、本番にある関数すべてで禁止
 *   2. 外すときの招待コードの作り直しを消す
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (s: string) => stripSql(s).replace(/\s+/g, " ").trim();

const MIGRATION = "20261101030000_unsend_and_staff_removal_fixes.sql";
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
const texts = migrations.map((f) => ({ f, s: stripSql(read(`supabase/migrations/${f}`)) }));

/** 関数ごとの最新の定義（後のマイグレーションで DROP されたものは除く） */
const latestDefs = () => {
  const defs = new Map<string, { f: string; body: string }>();
  const create = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(/gi;
  const drop = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([^;]+);/gi;
  for (const { f, s } of texts) {
    // 同じファイルの中では、DROP と CREATE の順番どおりに当てる
    const events: Array<{ at: number; kind: "create" | "drop"; name: string; body?: string }> = [];
    for (const m of s.matchAll(create)) {
      const rest = s.slice(m.index!);
      const ends = [rest.indexOf("$function$;"), rest.indexOf("$$;")].filter((x) => x !== -1);
      events.push({ at: m.index!, kind: "create", name: m[1], body: rest.slice(0, ends.length ? Math.min(...ends) : rest.length) });
    }
    for (const m of s.matchAll(drop)) {
      for (const n of m[1].matchAll(/public\.(\w+)\s*\(/g)) events.push({ at: m.index!, kind: "drop", name: n[1] });
    }
    for (const e of events.sort((a, b) => a.at - b.at)) {
      if (e.kind === "create") defs.set(e.name, { f, body: e.body! });
      else defs.delete(e.name);
    }
  }
  return defs;
};

describe("unsend_message: 送り主の確かめが NULL で素通りしない", () => {
  const SQL = norm(read(`supabase/migrations/${MIGRATION}`));

  it("🔴 未ログイン（auth.uid() が NULL）も、送り主でない人も not_sender", () => {
    expect(SQL).toContain(
      "IF auth.uid() IS NULL OR v_row.sender_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not_sender'",
    );
    const def = latestDefs().get("unsend_message");
    expect(def?.f).toBe(MIGRATION);
  });

  it("anon からは呼べない（ログインしたアプリだけ）", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.unsend_message(uuid) FROM PUBLIC, anon;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.unsend_message(uuid) TO authenticated, service_role;");
  });

  it("🔴 どの関数も auth.uid() を <> / != で比べない（NULL で素通りする）", () => {
    const bad: string[] = [];
    for (const [name, { f, body }] of latestDefs()) {
      if (/(<>|!=)\s*auth\.uid\(\)|auth\.uid\(\)\s*(<>|!=)/.test(body)) bad.push(`${name}（${f}）`);
    }
    expect(bad, "IS DISTINCT FROM と auth.uid() IS NULL の確かめに置き換えること").toEqual([]);
  });
});

describe("remove_staff_member: 外した人が同じ招待リンクで戻れない", () => {
  it("🔴 在籍を消したあと、インストラクターの招待コードを作り直す", () => {
    const def = latestDefs().get("remove_staff_member");
    expect(def?.f).toBe(MIGRATION);
    const body = norm(def!.body);
    const delAt = body.indexOf("DELETE FROM public.tenant_members WHERE tenant_id = v_tenant_id AND user_id = p_user_id AND role = 'trainer';");
    const rotateAt = body.indexOf(
      "UPDATE public.tenant_staff_invites SET instructor_code = public._gen_staff_invite_code(), updated_at = now() WHERE tenant_id = v_tenant_id AND instructor_code IS NOT NULL;",
    );
    expect(delAt).toBeGreaterThan(-1);
    expect(rotateAt).toBeGreaterThan(delAt);
  });

  it("画面の確認文で、招待リンクが新しくなることを知らせる（5言語）", () => {
    const ja = JSON.parse(read("src/locales/ja.json"));
    expect(ja.staff.removeConfirm).toContain("招待リンクも新しくなります");
    for (const loc of ["en", "ko", "zh-CN", "zh-TW"]) {
      const d = JSON.parse(read(`src/locales/${loc}.json`));
      expect(d.staff.removeConfirm.length, loc).toBeGreaterThan(40);
    }
  });
});
