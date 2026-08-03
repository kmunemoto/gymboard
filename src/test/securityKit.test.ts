import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

// `security/` は兄弟アプリへ配るための置き場（`security/README.md`）。
//
// ── なぜテストが要るか ──────────────────────────────────────────
// README は「このファイルをコピーしてください」と**パスを名指し**している。
// 上流でファイルを移動・改名すると、**README は黙って嘘になる。**
// 受け取った側は存在しないパスを探すことになり、しかも上流は気づかない。
//
// 配布物は「上流が忘れても壊れない」形でなければ意味がないので、
// README が指すパスが実在することを CI で見張る。
//
// あわせて `check.sql` が**読み取り専用のまま**であることも見張る。
// 「診断だから安全に実行してよい」と言えることがこのファイルの価値なので、
// 書き込みが1つでも混ざったら、その価値は失われる。

const KIT_DIR = "security";
const README = `${KIT_DIR}/README.md`;
const CHECK_SQL = `${KIT_DIR}/check.sql`;

/** README が「コピーしてください」と名指ししている実体ファイル */
const DISTRIBUTED_FILES = [
  "supabase/migrations/20260803120000_tenant_members_write_scope.sql",
  "supabase/migrations/20260803140000_global_trainer_write_scope.sql",
  "supabase/functions/send-push-notification/index.ts",
  "src/test/helpers/rlsPolicies.ts",
  "src/test/tenantMembershipWrites.test.ts",
  "src/test/globalTrainerRole.test.ts",
  "src/test/pushNotificationTenantScope.test.ts",
  "src/test/edgeFunctionOrigin.test.ts",
];

describe("security/ の配布キット", () => {
  const readme = readFileSync(README, "utf8");

  it("README と check.sql がある", () => {
    expect(existsSync(README)).toBe(true);
    expect(existsSync(CHECK_SQL)).toBe(true);
  });

  for (const file of DISTRIBUTED_FILES) {
    it(`README が指す ${file} が実在する`, () => {
      expect(
        existsSync(file),
        `security/README.md がこのパスを名指ししていますが、ファイルがありません。` +
          `移動・改名したなら README も直してください（受け取った側は気づけません）`,
      ).toBe(true);
    });
  }

  for (const file of DISTRIBUTED_FILES) {
    it(`README が ${file} に言及している`, () => {
      // 逆方向。実体があるのに README から漏れていると、配布されない。
      expect(
        readme.includes(file),
        `${file} が security/README.md に載っていません`,
      ).toBe(true);
    });
  }
});

describe("security/check.sql は読み取り専用", () => {
  const sql = readFileSync(CHECK_SQL, "utf8");

  /**
   * コメントと文字列リテラルを落とす。
   * どちらにも説明目的で INSERT / UPDATE などの語が入るので、
   * 落とさずに検査すると誤検知する（実際に踏んだ）。
   */
  const stripped = sql
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:[^']|'')*'/g, "''");

  const WRITE_KEYWORDS = [
    "insert",
    "update",
    "delete",
    "drop",
    "truncate",
    "alter",
    "grant",
    "revoke",
    "create",
  ];

  for (const kw of WRITE_KEYWORDS) {
    it(`${kw.toUpperCase()} を含まない`, () => {
      expect(
        new RegExp(`\\b${kw}\\b`, "i").test(stripped),
        `check.sql に ${kw.toUpperCase()} が入っています。` +
          `このファイルは「診断だから安全に実行してよい」と言えることが価値なので、` +
          `書き込みを混ぜないでください`,
      ).toBe(false);
    });
  }

  it("空振りしていない（検査が実際に書かれている）", () => {
    // strip しすぎて中身が消えていたら、上の検査は全部通ってしまう
    expect(stripped).toMatch(/\bselect\b/i);
    expect(stripped).toMatch(/pg_policies/);
    expect(stripped).toMatch(/pg_trigger/);
  });
});
