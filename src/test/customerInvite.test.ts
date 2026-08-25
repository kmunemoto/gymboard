import { readFileSync, readdirSync } from "fs";
import { describe, expect, it } from "vitest";

// 取り込んだ顧客への招待（2026-08-25）の見張り。
//
// 招待＝**アカウントの引き渡し**。招待メールのリンクを開いてパスワードを設定した人が
// そのままそのアカウントの本人になる。氏名の照合をしないので同姓同名の事故は
// 原理的に起きないが、裏返すと**店が入力した宛先がそのまま鍵**。
// ここが緩むと「他ジムの顧客のメールを差し替えて乗っ取る」が可能になるので、
// 判定の形を固定する。

const FUNCTION = "supabase/functions/invite-customer/index.ts";
const MIGRATION = "supabase/migrations/20260825020000_customer_invite.sql";
const SEND_FN = "supabase/functions/send-transactional-email/index.ts";
const REGISTRY = "supabase/functions/_shared/transactional-email-templates/registry.ts";
const TEMPLATE = "supabase/functions/_shared/transactional-email-templates/customer-invite.tsx";

const stripLineComments = (src: string) =>
  src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("migration", () => {
  it("invited_at 列を足す migration が最新に含まれている", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain("20260825020000_customer_invite.sql");
    expect(readFileSync(MIGRATION, "utf8")).toMatch(/ADD COLUMN IF NOT EXISTS invited_at timestamptz/);
  });
});

describe("🔴 invite-customer の権限判定", () => {
  const src = readFileSync(FUNCTION, "utf8");

  it("そのテナントの owner として在籍していることを tenant_members で確かめる", () => {
    expect(src).toContain("verifyCaller(req)");
    expect(src).toContain('.eq("tenant_id", tenantId)');
    expect(src).toContain('.eq("user_id", caller.userId)');
    expect(src).toContain('.eq("role", "owner")');
    expect(src).toContain('.eq("status", "active")');
  });

  it("🔴 グローバルな trainer ロールで判定しない", () => {
    expect(stripLineComments(src)).not.toMatch(/hasRole\s*\(/);
  });
});

describe("🔴 触ってよい相手の三重の帯", () => {
  const src = readFileSync(FUNCTION, "utf8");

  it("① 自テナントの customer 在籍であること", () => {
    // 対象の在籍確認（呼び出し元の owner 確認とは別のクエリ）
    expect(src).toContain('.eq("user_id", targetUserId)');
    expect(src).toContain('.eq("role", "customer")');
  });

  it("② 取り込まれた・未ログインの行であること", () => {
    expect(src).toMatch(/imported_at/);
    expect(src).toMatch(/not_imported/);
    expect(src).toMatch(/claimed_at/);
    expect(src).toMatch(/already_claimed/);
  });

  it("③ アカウント側にも取り込み印があること（metadata.imported）", () => {
    // profiles の行だけ見て判定すると、profiles を偽装できた場合に
    // 普通の顧客のメールを差し替えられる。auth 側の印でも確かめる
    expect(src).toMatch(/user_metadata\?\.imported !== true/);
  });
});

describe("メールの差し替えとリンク", () => {
  const src = readFileSync(FUNCTION, "utf8");

  it("プレースホルダのドメインには送れない", () => {
    expect(src).toMatch(/@gymboard\.invalid/);
  });

  it("既に使われているアドレスは email_taken として返す（マージしない）", () => {
    expect(src).toMatch(/email_taken/);
  });

  it("リンクは既存の /reset-password（token_hash + recovery）に合流する", () => {
    expect(src).toMatch(/generateLink\(\{\s*\n?\s*type: "recovery"/);
    expect(src).toMatch(/\/reset-password\?token_hash=/);
    expect(src).toMatch(/flow=invite/);
  });

  it("🔴 招待済み（invited_at）は送信成功のあとにだけ記録する", () => {
    // 失敗時に埋めると「招待済みなのにメールが届いていない」状態を作る
    const sendAt = src.indexOf('"send-transactional-email"');
    const markAt = src.indexOf("invited_at");
    expect(sendAt).toBeGreaterThan(0);
    expect(markAt).toBeGreaterThan(0);
    expect(markAt, "invited_at の記録が送信より前にある").toBeGreaterThan(sendAt);
  });

  it("配信停止リスト（送れない宛先）を成功扱いにしない", () => {
    expect(src).toMatch(/success === false/);
  });
});

describe("🔴 招待テンプレートはクライアントから呼べない", () => {
  it("registry に登録されている", () => {
    expect(readFileSync(REGISTRY, "utf8")).toContain("'customer-invite'");
  });

  it("CLIENT_ALLOWED_TEMPLATES に入っていない", () => {
    // 宛先が自由入力（店が打ったアドレス）。クライアントから呼べると
    // 任意の宛先にジム名入りのメールを撒ける口になる
    const send = readFileSync(SEND_FN, "utf8");
    const allowed = send.slice(
      send.indexOf("CLIENT_ALLOWED_TEMPLATES = new Set"),
      send.indexOf("])", send.indexOf("CLIENT_ALLOWED_TEMPLATES = new Set")),
    );
    expect(allowed).not.toContain("customer-invite");
  });

  it("本文に「心当たりが無い場合は破棄」がある（宛先間違いの防波堤）", () => {
    expect(readFileSync(TEMPLATE, "utf8")).toMatch(/心当たりが無い場合/);
  });

  it("期限切れでも本人がやり直せる案内がある", () => {
    expect(readFileSync(TEMPLATE, "utf8")).toMatch(/パスワードをお忘れの方/);
  });
});

describe("画面への配線", () => {
  const detail = readFileSync("src/components/trainer/TrainerClientDetail.tsx", "utf8");
  const card = readFileSync("src/components/trainer/clientDetail/MemberInviteCard.tsx", "utf8");
  const list = readFileSync("src/components/trainer/TrainerClientList.tsx", "utf8");
  const reset = readFileSync("src/pages/ResetPassword.tsx", "utf8");

  it("カルテに招待カードが載る（取り込み済み・未ログインの人だけ）", () => {
    expect(detail).toContain("MemberInviteCard");
    expect(detail).toMatch(/profile\?\.imported_at && !profile\?\.claimed_at/);
  });

  it("カードはオーナー限定（Edge Function 側と同じ判定の写し）", () => {
    expect(card).toMatch(/role !== "owner"/);
  });

  it("送る前に宛先を読み上げて確認する", () => {
    // 宛先の打ち間違い＝別人にアカウントが渡る。黙って送らない
    expect(card).toMatch(/window\.confirm/);
    expect(card).toMatch(/dataImport\.invite\.confirm/);
  });

  it("一覧のバッジが 未招待 と 招待済み を区別する", () => {
    expect(list).toContain("dataImport.invitedBadge");
    expect(list).toContain("dataImport.unclaimedBadge");
  });

  it("招待リンクで開いた /reset-password は招待用の文面になる", () => {
    expect(reset).toMatch(/flow.*invite|invite.*flow/);
    expect(reset).toContain("resetPassword.inviteTitle");
  });
});
