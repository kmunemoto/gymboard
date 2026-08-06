import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { MIGRATIONS_DIR, stripSqlComments } from "./helpers/rlsPolicies";

// user_id を引数で受け取る RPC が、呼び出し元を照合しているかの検査（穴8の段階2）。
//
// ── 背景 ────────────────────────────────────────────────────────
// 穴8の段階1で anon の EXECUTE は剥がした。**が、関数の形は直っていなかった。**
// 2026-08-06 に本番を総ざらいしたところ、段階1の検査（prosrc に auth.uid() が
// 書いてあれば「照合済み」とみなす）が**3種類の形を見逃していた**。
//
//   形1 NULL で素通りする比較（三値論理）★これが一番危なかった
//       IF NOT has_role(auth.uid(),'trainer') AND auth.uid() != _customer_id THEN RAISE ...
//       未ログインだと auth.uid() は NULL → `NULL != x` は NULL → `true AND NULL` は NULL
//       → **IF が通らない ＝ 例外が出ず本体が走る。**
//       delete_customer_cascade がこの形で、**未ログインで誰の会員データも消せた。**
//
//   形2 引数を優先して照合が無い
//       v_user := COALESCE(p_user_id, auth.uid());
//       IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;
//       → 引数を渡した時点で auth.uid() は見ない。
//
//   形3 そもそも照合が無い
//
// ── この検査で見るもの ──────────────────────────────────────────
// 実際の ACL と関数本体は DB にしか無いので CI からは見えない。
// ここで見るのは「**クライアントが user_id 付きで呼ぶ RPC**が、
// マイグレーションで照合されているか」。**呼び出し側から逆に辿るので、
// 新しい RPC を足したら自動で対象に入る**（名指しのリストにしない）。
//
// 実DBの確認は security/check.sql の検査5-c。
//
// ── 変異テスト（2026-08-06 実施・5件とも赤を確認）────────────────
//   1. マイグレーションから check_weight_milestones の包みを消す   → 赤
//   2. 包みの引数名を p_user_id → _user_id に変える                → 赤（呼び出し側が404になる）
//   3. assert_can_act_for を「本人のみ」にする                      → 赤（トレーナーが操作できなくなる）
//   4. delete_customer_cascade を壊れた IF に戻す                   → 赤
//   5. _unchecked から authenticated を剥がす節を消す               → 赤

const MIGRATION = "20260806160000_rpc_caller_check.sql";

/**
 * 包まないが**自前で照合している**関数。理由を書くこと。
 * ⚠️ 「たぶん大丈夫」で足さない。実際にそのロールを演じて確かめてから足す。
 */
const SELF_GUARDED: Record<string, string> = {
  remove_staff_member:
    "自前で auth.uid() IS NULL を弾く。2026-08-06 に anon で実行して" +
    "「ログインが必要です」(42501) で落ちることを確認済み",
};

const migrationSql = () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f === MIGRATION);
  expect(files.length, `${MIGRATION} がありません`).toBe(1);
  return readFileSync(`${MIGRATIONS_DIR}/${MIGRATION}`, "utf8");
};

/** src/ を走査して「supabase.rpc(name, { ... })」を集める */
function clientRpcCalls(): Map<string, { args: Set<string>; file: string }> {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = `${dir}/${f}`;
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  const files = walk("src").filter(
    (f) => /\.(ts|tsx)$/.test(f) && !f.includes("/test/") && !f.endsWith("types.ts"),
  );

  const out = new Map<string, { args: Set<string>; file: string }>();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // supabase.rpc("name" as any, { key: value, ... })
    for (const m of src.matchAll(/supabase\.rpc\(\s*"(\w+)"(?:\s+as\s+any)?\s*,\s*\{([^}]*)\}/g)) {
      const keys = [...m[2].matchAll(/(\w+)\s*:/g)].map((k) => k[1]);
      const entry = out.get(m[1]) ?? { args: new Set<string>(), file };
      keys.forEach((k) => entry.args.add(k));
      out.set(m[1], entry);
    }
  }
  return out;
}

/** 引数名が「他人を指せる id」かどうか */
const isActorArg = (name: string) => /^(p_|_)?(target_)?(user|customer)_id$/.test(name);

/** マイグレーションの中で、その関数を定義している節を切り出す */
function definitionOf(sql: string, fn: string): { params: string; body: string } | null {
  const re = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\(([^)]*)\\)`);
  const m = re.exec(sql);
  if (!m) return null;
  return { params: m[1], body: sql.slice(m.index, m.index + 900) };
}

describe("user_id を引数で受け取る RPC は呼び出し元を照合する", () => {
  const sql = migrationSql();
  const calls = clientRpcCalls();
  const withActorArg = [...calls.entries()].filter(([, v]) => [...v.args].some(isActorArg));

  it("走査が空振りしていない", () => {
    expect(calls.size, "supabase.rpc の呼び出しを1つも読めていません").toBeGreaterThan(5);
    expect(
      withActorArg.length,
      "user_id を渡している RPC を1つも読めていません",
    ).toBeGreaterThan(3);
  });

  it("クライアントが user_id 付きで呼ぶ RPC がすべて照合されている", () => {
    const unguarded = withActorArg
      .filter(([name]) => !(name in SELF_GUARDED))
      .filter(([name]) => {
        const def = definitionOf(sql, name);
        return !def || !def.body.includes("assert_can_act_for");
      })
      .map(([name, v]) => `${name}（${v.file}）`);

    expect(
      unguarded,
      "ログインさえすれば他人の user_id を渡せます。" +
        `${MIGRATION} で assert_can_act_for を通すか、SELF_GUARDED に理由付きで足してください:\n  ` +
        unguarded.join("\n  "),
    ).toEqual([]);
  });

  it("包んだ関数の引数名が、呼び出し側のキーと一致している", () => {
    // PostgREST の RPC は名前付き引数。揃えたくなって _user_id に統一すると
    // p_user_id で呼んでいる画面が **404 になる**（エラーは出るが原因が見えない）
    const mismatched: string[] = [];
    for (const [name, v] of withActorArg) {
      const def = definitionOf(sql, name);
      if (!def) continue;
      const declared = [...def.params.matchAll(/(\w+)\s+\w+/g)].map((m) => m[1]);
      for (const key of v.args) {
        if (!isActorArg(key)) continue;
        if (!declared.includes(key)) {
          mismatched.push(`${name}: 呼び出し側は "${key}"、マイグレーションは "${declared.join(", ")}"`);
        }
      }
    }
    expect(mismatched, `引数名が食い違っています。RPC が 404 になります:\n  ${mismatched.join("\n  ")}`).toEqual([]);
  });
});

describe("assert_can_act_for の条件", () => {
  const sql = stripSqlComments(migrationSql());
  const fn = sql.slice(sql.indexOf("FUNCTION public.assert_can_act_for"));
  const body = fn.slice(0, fn.indexOf("COMMENT ON"));

  it("本人を通す", () => {
    expect(body).toMatch(/_target_user_id\s*=\s*auth\.uid\(\)/);
  });

  it("🔴 同じテナントのスタッフも通す（本人限定にしない）", () => {
    // トレーナーが会員の user_id を渡す経路が本物としてある。
    // 本人限定にすると、体重ジャーニーの設定と会員のトレーニング記録が保存できなくなる
    expect(body, "tenant_members を見ていません").toContain("tenant_members");
    expect(body, "owner / trainer を通していません").toMatch(/'owner'[\s\S]{0,20}'trainer'/);
  });

  it("service_role（auth.uid() が NULL）は素通しする", () => {
    // Edge Function・cron・トリガーからの内部呼び出しが落ちないようにするため
    expect(body).toMatch(/auth\.uid\(\)\s+IS NULL[\s\S]{0,40}RETURN;/);
  });

  it("それ以外は 42501 で落とす", () => {
    expect(body).toMatch(/RAISE EXCEPTION[\s\S]{0,120}42501/);
  });
});

describe("包んだ本体（_unchecked）は直接呼べない", () => {
  const sql = stripSqlComments(migrationSql());

  it("RENAME した関数から authenticated / anon を剥がしている", () => {
    const renamed = [...sql.matchAll(/RENAME TO (\w+_unchecked)/g)].map((m) => m[1]);
    expect(renamed.length, "包んでいる関数が1つもありません").toBeGreaterThan(5);

    const missing = renamed.filter((fn) => {
      const re = new RegExp(
        `REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*FROM PUBLIC, anon, authenticated`,
      );
      return !re.test(sql);
    });
    expect(
      missing,
      "照合していない本体が呼べる状態で残っています（包んだ意味がありません）: " + missing.join(", "),
    ).toEqual([]);
  });
});

describe("delete_customer_cascade（未ログインで会員データを消せた関数）", () => {
  const sql = stripSqlComments(migrationSql());
  const def = definitionOf(sql, "delete_customer_cascade");

  it("assert_can_act_for を通している", () => {
    expect(def, "定義がありません").toBeTruthy();
    expect(def!.body).toContain("assert_can_act_for");
  });

  it("🔴 NULL で素通りする比較が復活していない", () => {
    // `auth.uid() != _customer_id` は未ログイン時に NULL になり、
    // AND で繋ぐと IF 全体が NULL ＝ 通らない ＝ 例外が出ない
    expect(
      def!.body,
      "auth.uid() を <> / != で比べています。未ログインだと NULL になり、RAISE を素通りします",
    ).not.toMatch(/auth\.uid\(\)\s*(<>|!=)|(<>|!=)\s*auth\.uid\(\)/);
  });

  it("消す対象が元のまま（消し漏れ・消しすぎを検知する）", () => {
    for (const t of [
      "workouts",
      "bookings",
      "meals",
      "messages",
      "notification_settings",
      "profiles",
      "user_roles",
    ]) {
      expect(def!.body, `${t} の DELETE が消えています`).toContain(`DELETE FROM public.${t}`);
    }
  });
});
