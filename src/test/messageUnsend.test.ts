import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { canUnsend, isUnsent, UNSEND_WINDOW_MS } from "@/lib/messageUnsend";

// 送信取り消し（B3）と、その過程で見つかった **既存の穴** を見張る。

const stripJs = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const stripSql = (src: string): string =>
  src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const readCode = (p: string) => stripJs(readFileSync(p, "utf8"));

const MIGRATION_DIR = "supabase/migrations";
/** 取り消しを入れたマイグレーション。ファイル名を直書きせず中身で探す。 */
const UNSEND_SQL = stripSql(
  readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(`${MIGRATION_DIR}/${f}`, "utf8"))
    .filter((s) => /FUNCTION public\.unsend_message/.test(s))
    .join("\n"),
);

describe("取り消せる条件（クライアント側の出し分け）", () => {
  const base = {
    sender_id: "me",
    created_at: "2026-08-12T00:00:00Z",
    unsent_at: null as string | null,
  };
  const now = new Date("2026-08-12T01:00:00Z");

  it("自分が1時間前に送ったものは取り消せる", () => {
    expect(canUnsend(base, "me", now)).toBe(true);
  });

  it("🔴 他人の発言は取り消せない（共有受信箱でも）", () => {
    // 誰が消したのか分からなくなるほうが困る。
    expect(canUnsend({ ...base, sender_id: "other" }, "me", now)).toBe(false);
  });

  it("🔴 24時間を過ぎたら取り消せない", () => {
    const old = { ...base, created_at: "2026-08-10T00:00:00Z" };
    expect(canUnsend(old, "me", now)).toBe(false);
    // 境界のすぐ内側は出す
    const edge = { ...base, created_at: new Date(now.getTime() - UNSEND_WINDOW_MS + 1000).toISOString() };
    expect(canUnsend(edge, "me", now)).toBe(true);
  });

  it("取り消し済みには出さない", () => {
    expect(canUnsend({ ...base, unsent_at: "2026-08-12T00:30:00Z" }, "me", now)).toBe(false);
  });

  it("未ログインでは出さない", () => {
    expect(canUnsend(base, null, now)).toBe(false);
    expect(canUnsend(base, undefined, now)).toBe(false);
  });

  it("isUnsent の判定", () => {
    expect(isUnsent({ unsent_at: null })).toBe(false);
    expect(isUnsent({ unsent_at: "2026-08-12T00:00:00Z" })).toBe(true);
  });
});

describe("DB 側が最終判断になっている", () => {
  it("🔴 取り消しは RPC 経由（クライアントの直接 UPDATE ではない）", () => {
    // クライアントの canUnsend は**メニューを出すかどうか**でしかない。
    // 端末の時計はずれるし、直接叩かれれば素通りする。
    const hook = readCode("src/hooks/useMessages.ts");
    expect(hook, "unsend_message の RPC を呼んでいません").toMatch(
      /rpc\(\s*["']unsend_message["']/,
    );
    expect(
      /update\(\{[^}]*unsent_at/.test(hook),
      "クライアントから unsent_at を直接 UPDATE しています。RPC を通してください。",
    ).toBe(false);
  });

  it("🔴 RPC が送信者・24時間・二重呼び出しを見ている", () => {
    expect(UNSEND_SQL, "unsend_message が見つかりません").toMatch(
      /CREATE OR REPLACE FUNCTION public\.unsend_message/,
    );
    expect(UNSEND_SQL, "SECURITY DEFINER でありません").toMatch(/SECURITY DEFINER/);
    expect(UNSEND_SQL, "送信者本人か見ていません").toMatch(/sender_id\s*<>\s*auth\.uid\(\)/);
    expect(UNSEND_SQL, "24時間の判定がありません").toMatch(/INTERVAL\s+'24 hours'/);
    expect(UNSEND_SQL, "取り消し済みを弾いていません").toMatch(/unsent_at IS NOT NULL/);
  });

  it("🔴 取り消しで本文と添付を必ず落とす", () => {
    // unsent_at を立てるだけだと、**本文が DB に残る**。
    // 表示で隠すだけでは「取り消した」ことにならない。
    const idx = UNSEND_SQL.indexOf("UPDATE public.messages");
    expect(idx).toBeGreaterThan(-1);
    const body = UNSEND_SQL.slice(idx, idx + 400);
    expect(body, "本文を空にしていません").toMatch(/content\s*=\s*''/);
    expect(body, "添付パスを外していません").toMatch(/attachment_path\s*=\s*NULL/);
    expect(body, "添付種別を外していません").toMatch(/attachment_type\s*=\s*NULL/);
  });

  it("取り消した行の CHECK 制約を逃がしている", () => {
    // content も添付も無くなるので、既存の CHECK に引っかかる。
    expect(UNSEND_SQL).toMatch(/messages_content_or_attachment[\s\S]{0,400}unsent_at IS NOT NULL/);
  });

  it("添付はストレージからも消す", () => {
    const hook = readCode("src/hooks/useMessages.ts");
    expect(hook, "ストレージから消していません").toMatch(/discardAttachment/);
  });
});

describe("🔴 受信者が本文を書き換えられた穴（2026-08-12 に発見）", () => {
  // 本番で再現した:
  //   オーナー →「キャンセル料は3,000円いただきます」
  //   お客様が UPDATE →「キャンセル料は無料です」が通り、送った側にもそう見える
  //
  // 原因は「authenticated が全列に UPDATE 権」＋「ポリシーに WITH CHECK が無い」。

  it("直接 UPDATE できる列を read だけに絞っている", () => {
    expect(UNSEND_SQL, "全列の UPDATE 権を落としていません").toMatch(
      /REVOKE UPDATE ON public\.messages FROM authenticated/,
    );
    expect(UNSEND_SQL, "read だけを許可していません").toMatch(
      /GRANT\s+UPDATE\s*\(\s*read\s*\)\s+ON public\.messages TO authenticated/,
    );
  });

  it("anon には UPDATE を残さない", () => {
    expect(UNSEND_SQL).toMatch(/REVOKE UPDATE ON public\.messages FROM anon/);
  });

  it("UPDATE ポリシーに WITH CHECK がある", () => {
    const idx = UNSEND_SQL.indexOf('CREATE POLICY "Receiver can mark read"');
    expect(idx, "UPDATE ポリシーを貼り直していません").toBeGreaterThan(-1);
    expect(UNSEND_SQL.slice(idx, idx + 400), "WITH CHECK がありません").toMatch(/WITH CHECK/);
  });

  it("🔴 content への UPDATE 権を戻していない", () => {
    // ここを GRANT UPDATE (read, content) 等に広げると穴が開き直る。
    expect(
      /GRANT\s+UPDATE\s*\([^)]*content[^)]*\)\s+ON public\.messages/.test(UNSEND_SQL),
      "content の UPDATE 権を渡しています。受信者が届いた本文を書き換えられます。",
    ).toBe(false);
  });
});

describe("表示", () => {
  it("取り消した行を消さず「取り消しました」を残す", () => {
    for (const f of [
      "src/components/trainer/TrainerMessages.tsx",
      "src/components/customer/CustomerChat.tsx",
    ]) {
      const src = readCode(f);
      expect(src, `${f} に取り消しの表示がありません`).toMatch(/<UnsentNotice/);
      // ⚠️ `!unsent && ` を探すだけでは足りない。既読表示の
      //    `isMe && !unsent && msg.read` に当たって素通りする（変異検証で見逃した）。
      //    **隠すべき3つそれぞれ**が塞がれているかを見る。
      expect(src, `${f}: 取り消し済みでも引用を出しています`).toMatch(
        /\{!unsent && quote && <ReplyQuote/,
      );
      expect(src, `${f}: 取り消し済みでも添付を出しています`).toMatch(
        /\{!unsent && msg\.attachment_type &&/,
      );
      expect(src, `${f}: 取り消し済みでも本文を出しています`).toMatch(
        /\{!unsent && body\.trim\(\) &&/,
      );
    }
  });

  it("会話一覧のプレビューが空欄にならない", () => {
    const src = readCode("src/components/trainer/TrainerMessages.tsx");
    expect(src, "取り消し済みのプレビューが空欄になります").toMatch(
      /row\.unsent_at[\s\S]{0,80}chat\.unsentNotice/,
    );
  });
});
