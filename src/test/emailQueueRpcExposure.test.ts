import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// メールキューの RPC が未ログインから叩けない状態を保つ番人。
//
// ## なぜ要るか（2026-08-14、業種フォークが本番で再現させて報告）
//
// フォーク側の本番DBで anon を演じて実際に呼んだところ
//   SELECT public.enqueue_email('transactional_emails','{}'::jsonb);  → 成功
//   SELECT public.read_email_batch('transactional_emails', 10, 30);   → 成功
//   SELECT public.email_queue_dispatch();                              → 成功
// anon キーはアプリに埋め込まれている（＝公開情報）ので、メール配送を有効化した瞬間に
//   1. 認証済みの送信ドメインから任意の宛先・本文のメールを送れる
//   2. キュー内の申込者の氏名・メールアドレスを読める
//   3. 配送前の確認メールを削除できる
// が全部ログイン不要になる。
//
// ## なぜ既存の検査で見つからなかったか
//
// (a) `anonRpcExposure.test.ts` は**逆方向**の検査。「ポリシーが使う関数を
//     revoke しすぎてテーブルが読めなくなる」ことだけを見ており、
//     「剥がし足りない」は対象外だった。
// (b) 元のマイグレーション（20260612061340_email_infra.sql）は
//     `REVOKE EXECUTE ... FROM PUBLIC` **しか書いていない**。このスキーマには
//     関数へ `anon` / `authenticated` へ EXECUTE を自動付与する default ACL があり、
//     PostgreSQL の ACL は「PUBLIC への付与」と「ロールへの直接付与」の**和集合**なので、
//     PUBLIC だけ剥がしても直接付与が残る。
//     ⚠️ **`REVOKE ... FROM PUBLIC` は `anon` を締め出さない。** ここが誤解の芯。
// (c) `email_queue_wake` / `email_queue_dispatch` はそもそも**マイグレーションに存在しない**
//     （Lovable が Management API で作った）。ファイルを畳み込む検査では永久に見つからない。
//
// この検査は (b)(c) の両方に対応するため、**修復マイグレーションが6関数すべてを
// 3ロール（PUBLIC / anon / authenticated）から明示的に剥がしていること**を直接見る。
//
// ⚠️ ジムボード本体はメール配送が稼働中なので、フォークより切実。
// ⚠️ **これはリポジトリ側の検査でしかない。** 本番の実態は保証できない
// （DROP を伴う再作成で default ACL に戻る）。merge やスキーマ変更のたびに
// 本番の proacl を見て、anon を演じて実際に呼ぶこと。それが唯一確実な確認方法。

const DIR = "supabase/migrations";
const REPAIR = "20260814110000_email_queue_execute_drift_repair.sql";

/** service_role だけが呼べるべき関数（引数は問わず名前で見る） */
const QUEUE_FUNCTIONS = [
  "enqueue_email",
  "read_email_batch",
  "delete_email",
  "move_to_dlq",
  "email_queue_wake",
  "email_queue_dispatch",
];

const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");

describe("email queue RPCs stay out of reach of anon", () => {
  it("the repair migration is still in the tree", () => {
    expect(readdirSync(DIR)).toContain(REPAIR);
  });

  const sql = stripComments(readFileSync(`${DIR}/${REPAIR}`, "utf8"));

  it("lists every queue function", () => {
    for (const fn of QUEUE_FUNCTIONS) {
      expect(sql, `${fn} is missing from the repair migration`).toContain(`public.${fn}(`);
    }
  });

  // 3ロール全部を剥がしていること。1つでも欠けると和集合で通ってしまう。
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    it(`revokes from ${role}`, () => {
      expect(
        sql,
        `REVOKE ... FROM ${role} が見当たりません。` +
          `PostgreSQL の ACL は PUBLIC への付与とロールへの直接付与の和集合なので、` +
          `3つ全部剥がさないと実行できてしまいます。`,
      ).toMatch(new RegExp(`REVOKE ALL ON FUNCTION %s FROM ${role}`));
    });
  }

  it("grants them back to service_role so delivery keeps working", () => {
    // 塞ぎすぎて配送が止まると、今度は「1通も届かないのに誰も気づけない」になる。
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION %s TO service_role/);
  });

  it("does not swallow a missing function silently", () => {
    // 20260612061340 がキュー作成を EXCEPTION WHEN OTHERS THEN NULL で握りつぶし、
    // 「成功したのにキューが無い」を作った前例がある。握りつぶすなら必ず声を出す。
    expect(sql).not.toMatch(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN\s+NULL/i);
    expect(sql).toMatch(/RAISE NOTICE/);
  });

  it("the original migration only revoked from PUBLIC (the reason this repair exists)", () => {
    // この前提が変わったら（上流が元のマイグレーションを直したら）、
    // この修復と説明を見直すこと。
    const original = readdirSync(DIR).find((f) => f.endsWith("_email_infra.sql") && f.startsWith("20260612"));
    expect(original).toBeDefined();
    const body = stripComments(readFileSync(`${DIR}/${original}`, "utf8"));
    const revokes = body.match(/REVOKE EXECUTE ON FUNCTION public\.enqueue_email[^;]+;/g) ?? [];
    expect(revokes.length).toBeGreaterThan(0);
    expect(revokes.join(" ")).not.toMatch(/\banon\b/);
  });
});
