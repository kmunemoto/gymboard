import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// send-push-notification の宛先制限を見張るテスト。
//
// ── 何が起きていたか（2026-08-03 に発見） ──────────────────────────
// 認証済み経路の権限チェックがこう書かれていた:
//
//   const isTrainer = caller.userId ? await hasRole(caller.userId, "trainer") : false;
//   if (!isTrainer) {
//     ...宛先の検証はすべてこの中...
//   }
//
// **trainer なら中身が丸ごとスキップされる。** ところが `has_role` が見る
// `user_roles` に `tenant_id` は無く、trainer はテナント横断のグローバル権限。
// つまり「どのジムのトレーナーでも、他ジムの顧客に、任意の title/body のプッシュを
// 無制限に送れる」状態だった。「店舗からのお知らせ」を騙るフィッシング、
// 本物の通知を押し流す洪水、いずれにも使える。
//
// 同じファイルの waitlist 経路は tenant_id を確認していたので、
// **同一ファイル内で不整合**でもあった。両方を tenant_members ベースに揃えた。
//
// ── なぜ本文を読む形のテストなのか ──────────────────────────────
// `supabase/functions/` は vitest の include（`src/**`）の外で、Deno の
// リモート import を含むためそのままでは実行もできない。
// このリポジトリの既存の流儀（edgeFunctionProjectRef / sameDayCancelWording 等）に
// 合わせて、ソースの形を機械的に見張る。

const PUSH_FN = "supabase/functions/send-push-notification/index.ts";
const FUNCTIONS_DIR = "supabase/functions";

const source = readFileSync(PUSH_FN, "utf8");

/** 説明コメントに書いた語で誤検知しないよう、コメント行を落としてから探す */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const code = stripComments(source);

describe("send-push-notification: 宛先はテナントで絞る", () => {
  it("hasRole（user_roles ベース）を権限判定に使っていない", () => {
    // user_roles にテナントの概念が無いので、ここでの hasRole は
    // 「誰にでも送れる」と同義になる。import ごと消してある。
    expect(code).not.toMatch(/\bhasRole\b/);
  });

  it("trainer を素通しさせる分岐が復活していない", () => {
    // 元のバグそのものの形。`isTrainer` という判定自体をこのファイルから無くした。
    expect(code).not.toMatch(/\bisTrainer\b/);
  });

  it("tenant_members から所属を引くヘルパーがある", () => {
    expect(code).toMatch(/async function loadTenantMemberships\(/);
    expect(code).toMatch(/\.from\("tenant_members"\)/);
    expect(code).toMatch(/\.select\("user_id, tenant_id, status"\)/);
  });

  it("tenant_id が NULL の行を捨てている（null 同士の一致を作らない）", () => {
    // 拾うと「所属テナント未設定の人どうし」が同じテナント扱いになる。
    // 2026-08-01 のフォーク取り込みで踏んだ null === null の再来を防ぐ。
    expect(code).toMatch(/if \(!row\.tenant_id\) continue;/);
  });

  it("呼び出し元の判定は active な所属だけを見る", () => {
    // 退会者に送信権を残さない。宛先側は status を問わない（退会会員の予約を
    // トレーナーがキャンセルしたときの通知を落とさないため）。
    expect(code).toMatch(/function activeTenantIds\(/);
    expect(code).toMatch(/\.filter\(\(m\) => m\.active\)/);
    expect(code).toMatch(/const callerTenants = activeTenantIds\(memberships, callerId\)/);
  });

  it("認証済み経路が loadTenantMemberships を通っている", () => {
    // 「自分自身 or 同じテナント」以外は 403 にする本体。
    expect(code).toMatch(
      /const memberships = await loadTenantMemberships\(adminClient, \[callerId, \.\.\.otherIds\]\)/,
    );
  });

  it("どのテナントにも active 所属が無い呼び出し元は他人に送れない（fail-close）", () => {
    expect(code).toMatch(/if \(callerTenants\.size === 0\)/);
  });

  it("所属が引けない宛先は拒否する（fail-close）", () => {
    expect(code).toMatch(
      /if \(!targetMemberships \|\| targetMemberships\.length === 0\) return true;/,
    );
  });

  it("waitlist 経路もテナント所属を確認している", () => {
    expect(code).toMatch(
      /let allowed = activeTenantIds\(memberships, caller\.userId\)\.has\(tenant_id\);/,
    );
  });

  it("宛先の件数に上限がある", () => {
    expect(code).toMatch(/const MAX_PUSH_TARGETS = \d+;/);
    expect(code).toMatch(/> MAX_PUSH_TARGETS/);
  });

  it("プロトコル相対URL（//evil.example）を通す抜け道が無い", () => {
    // "//evil.example" も "/" 始まりだが、ブラウザは**別オリジン**に解決する。
    // 通知を開いた先が外部サイトになる（AuthCallback で sanitizeAuthNext が
    // 塞いだのと同じ形の穴）。2026-08-03、ピラボードが先に直していた。
    expect(code).toMatch(/u\.startsWith\("\/"\) && !u\.startsWith\("\/\/"\)/);
  });

  it("service_role 以外は userId を必ず持つことを確認している", () => {
    // verifyCaller は service_role のとき { userId: null, isServiceRole: true } を返す。
    // `if (!caller)` だけの判定はこれを通してしまう（signup-trainer は `!caller?.userId`）。
    expect(code).toMatch(/if \(!caller\.userId\) \{/);
  });
});

describe("Edge Function から auth.uid() 依存の RPC を呼ばない", () => {
  // `get_my_tenant_id()` / `shares_tenant_with_me()` は中身が `auth.uid()` 依存。
  // Edge Function の service_role クライアントから呼ぶと **常に NULL / false**
  // （error も出ない）。テナント検証に使うと黙って素通り or 全拒否になる。
  // Edge Function では tenant_members を直接引くこと。
  const AUTH_UID_RPCS = ["get_my_tenant_id", "shares_tenant_with_me"];

  const entries = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_shared")
    .map((e) => `${FUNCTIONS_DIR}/${e.name}/index.ts`);

  it("対象の Edge Function を1つ以上見つけられている", () => {
    // ディレクトリ構成が変わってテストが空振りするのを防ぐ
    expect(entries.length).toBeGreaterThan(5);
  });

  for (const file of entries) {
    it(`${file} が auth.uid() 依存の RPC を呼んでいない`, () => {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        return; // index.ts を持たない関数はスキップ
      }
      const body = stripComments(text);
      for (const rpc of AUTH_UID_RPCS) {
        expect(body).not.toMatch(new RegExp(`rpc\\(\\s*["'\`]${rpc}["'\`]`));
      }
    });
  }
});
