import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { MIGRATIONS_DIR, stripSqlComments } from "./helpers/rlsPolicies";

// メールキューのRPC（pgmq のラッパー）が anon / authenticated から叩けないこと。
//
// ── なぜこの検査が要るか ────────────────────────────────────────
// 2026-08-05、相談ボード（兄弟アプリ）が `pg_proc.proacl` を実際に見て、
// **anon キーだけで `enqueue_email` が叩ける**ことを発見した。上流も同じ状態だった。
//
// マイグレーションはこう書いてあり、一見すると塞がって見える:
//
//   REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
//   GRANT  EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;
//
// **`REVOKE ... FROM PUBLIC` は名前付きロールへの明示 GRANT を消さない。**
// Supabase は `ALTER DEFAULT PRIVILEGES` で anon / authenticated に明示の EXECUTE を
// 付けるので、ACL 上は別エントリとして残り続ける。
//
// 4関数はすべて SECURITY DEFINER で**関数内に認可チェックが無い**（GRANT だけが防御）。
// しかも anon キーは全クライアントに埋め込まれている＝ログインすら要らない。
// 詳細は supabase/migrations/20260805000000_email_queue_revoke_roles.sql の冒頭。
//
// ── 何を見張るか ────────────────────────────────────────────────
// 「REVOKE を書いたか」ではなく、**関数の最後の定義よりも後ろで REVOKE されているか**。
// あとから `DROP` → `CREATE` や引数変更で作り直すと既定権限がまた付くので、
// 順序を見ないと「昔 REVOKE したから安全」を通してしまう。
//
// ── 対象の見つけ方 ──────────────────────────────────────────────
// 関数名をベタ書きせず、**本体が `pgmq.` を触る関数**を対象にする。
// キューRPCを新しく足したら、名前を知らなくても自動で検査対象になる。
//
// ── 変異テスト（2026-08-05 実施・4件とも赤になることを確認済み）────
//   1. 20260805000000 のマイグレーションごと削除          → 4件赤
//   2. `FROM PUBLIC, anon, authenticated` → `FROM PUBLIC`  → 4件赤（＝元の穴の再現）
//   3. REVOKE より後ろで enqueue_email を作り直す          → 1件赤（順序を見ている証明）
//   4. REVOKE 無しでキューRPCを1本足す                     → 1件赤（discovery の証明）

/** 既知のキューRPC。discovery が壊れても最低限ここは見る（下限） */
const KNOWN_QUEUE_FUNCTIONS = ["enqueue_email", "read_email_batch", "delete_email", "move_to_dlq"];

/** service_role 以外に開けてはいけないロール */
const FORBIDDEN_ROLES = ["anon", "authenticated"];

/** `CREATE [OR REPLACE] FUNCTION public.<名前>(...) ... AS $tag$ <本体> $tag$` */
const CREATE_FUNCTION =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\([\s\S]*?AS\s+\$(\w*)\$([\s\S]*?)\$\2\$/gi;

/** `REVOKE EXECUTE ON FUNCTION public.<名前>(...) FROM <ロール列>` */
const LITERAL_REVOKE =
  /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?(\w+)\s*\([^)]*\)\s+FROM\s+([^;]*)/gi;

/** DOブロック（動的に REVOKE を組み立てる形） */
const DO_BLOCK = /DO\s+\$(\w*)\$([\s\S]*?)\$\1\$/gi;

/** ロール列に anon と authenticated が両方あるか */
const revokesForbiddenRoles = (roles: string) => {
  const list = roles.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return FORBIDDEN_ROLES.every((r) => list.includes(r));
};

interface Scan {
  /** 関数名 → 最後に定義された位置 */
  defined: Map<string, number>;
  /** 関数名 → anon/authenticated を剥がした最後の位置 */
  revoked: Map<string, number>;
  /** 本体が pgmq. を触る関数 */
  queueFunctions: Set<string>;
}

function scanMigrations(): Scan {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const defined = new Map<string, number>();
  const revoked = new Map<string, number>();
  const queueFunctions = new Set<string>(KNOWN_QUEUE_FUNCTIONS);

  files.forEach((file, fileIndex) => {
    const sql = stripSqlComments(readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8"));
    // ファイル順 → ファイル内順、で一意に並ぶ位置
    const at = (offset: number) => fileIndex * 1_000_000 + offset;

    for (const m of sql.matchAll(CREATE_FUNCTION)) {
      const [, name, , body] = m;
      if (/\bpgmq\./i.test(body)) queueFunctions.add(name);
      // キューRPC以外もいったん記録しておく（判定時に queueFunctions で絞る）
      defined.set(name, at(m.index ?? 0));
    }

    for (const m of sql.matchAll(LITERAL_REVOKE)) {
      if (revokesForbiddenRoles(m[2])) revoked.set(m[1], at(m.index ?? 0));
    }

    // `EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig)`
    // のように、対象をブロック内の文字列リテラルで列挙する形。
    for (const block of sql.matchAll(DO_BLOCK)) {
      const body = block[2];
      const revoke = /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+\S+\s+FROM\s+([^;')]*)/i.exec(body);
      if (!revoke || !revokesForbiddenRoles(revoke[1])) continue;
      for (const target of body.matchAll(/public\.(\w+)\s*\(/gi)) {
        revoked.set(target[1], at(block.index ?? 0));
      }
    }
  });

  return { defined, revoked, queueFunctions };
}

describe("メールキューRPCの実行権限", () => {
  const { defined, revoked, queueFunctions } = scanMigrations();

  it("既知の4関数を取りこぼしていない（discovery が動いていることの確認）", () => {
    // ベタ書きの下限ではなく、pgmq. 本体から実際に見つかっていること。
    // ここが壊れると「対象0件で全部緑」になり、検査が消えたことに気づけない。
    for (const name of KNOWN_QUEUE_FUNCTIONS) {
      expect(defined.has(name), `${name} がマイグレーションから見つかりません`).toBe(true);
    }
    expect(queueFunctions.size).toBeGreaterThanOrEqual(KNOWN_QUEUE_FUNCTIONS.length);
  });

  for (const name of [...queueFunctions].sort()) {
    it(`${name} は anon / authenticated から剥がされている`, () => {
      const revokedAt = revoked.get(name);
      expect(
        revokedAt,
        `${name} に \`REVOKE EXECUTE ... FROM ... anon, authenticated\` がありません。` +
          ` FROM PUBLIC だけでは Supabase の既定権限（明示 GRANT）が残ります`,
      ).toBeDefined();

      const definedAt = defined.get(name);
      if (definedAt !== undefined) {
        expect(
          revokedAt!,
          `${name} は REVOKE より後ろで定義し直されています。` +
            ` DROP→CREATE や引数変更で作り直すと既定権限がまた付くので、定義の直後に REVOKE すること`,
        ).toBeGreaterThan(definedAt);
      }
    });
  }
});
