import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { MEMBER_PAYMENTS_ENABLED } from "@/lib/featureFlags";

// お客様の決済（Stripe Connect）の番人。
//
// この機能は**クラウドセッションから一度も実行して確かめられない**（Connect の接続・
// 実決済・webhook の到達）。だから「コードの形」で守れるところだけでも機械的に見張る。
//
// 守りたいのは3点:
//   1. **Direct charges であること**（Stripe-Account を付ける）。付け忘れると
//      お客様のお金がジムではなくプラットフォームに入る。
//   2. **認可を DB のフラグに頼らないこと**。tenants.stripe_charges_enabled は
//      オーナーが書き換えられるので、実ゲートは Stripe への問い合わせ。
//   3. **webhook の署名検証を通らないものは何も書かない**。緩めると誰でも
//      「払った」を作れる（＝回数券がタダで手に入る）。

const CHECKOUT = "supabase/functions/member-create-checkout/index.ts";
const WEBHOOK = "supabase/functions/member-payments-webhook/index.ts";
const ONBOARD = "supabase/functions/member-connect-onboard/index.ts";
const MIGRATION = "supabase/migrations/20260814160000_member_payments.sql";

describe("member payments", () => {
  it("ships disabled by default", () => {
    // 実決済を1度も確かめられない環境で作ったので、既定はOFF。
    expect(MEMBER_PAYMENTS_ENABLED).toBe(false);
  });

  it("all three functions exist", () => {
    for (const f of [CHECKOUT, WEBHOOK, ONBOARD]) {
      expect(existsSync(f), `${f} is missing`).toBe(true);
    }
  });

  it("charges on the connected account, not the platform", () => {
    const src = readFileSync(CHECKOUT, "utf8");
    expect(
      src,
      "stripeAccount を渡していません。お客様のお金がジムではなくプラットフォームに入ります。",
    ).toMatch(/stripeAccount:\s*accountId/);
  });

  it("derives the buyer from the JWT, never from the request body", () => {
    const src = readFileSync(CHECKOUT, "utf8");
    expect(src).toMatch(/verifyCaller\(req\)/);
    // body から user_id を読んでいたら他人名義の支払いを作れる
    expect(src).not.toMatch(/const\s*\{[^}]*\buser_?[Ii]d\b[^}]*\}\s*=\s*await req\.json\(\)/);
  });

  it("asks Stripe directly instead of trusting the tenant flag", () => {
    const src = readFileSync(CHECKOUT, "utf8");
    // stripe_charges_enabled はオーナーが書き換えられるので認可の根拠にしない
    expect(src).toMatch(/accounts\.retrieve\(accountId\)/);
    expect(src).toMatch(/account\.charges_enabled/);
  });

  it("refuses to sell without the seller's legal terms", () => {
    // 売主は各ジム。特商法の表記が無いまま売らない。
    expect(readFileSync(CHECKOUT, "utf8")).toMatch(/payment_terms_url/);
  });

  it("verifies the webhook signature before writing anything", () => {
    const src = readFileSync(WEBHOOK, "utf8");
    const verifyIdx = src.indexOf("verifyWebhook");
    const insertIdx = src.indexOf(".insert(");
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(verifyIdx, "署名検証より前に書き込んでいます").toBeLessThan(insertIdx);
  });

  it("is idempotent on webhook replays", () => {
    // Stripe は同じイベントを何度も送る。DB の UNIQUE で弾く。
    expect(readFileSync(MIGRATION, "utf8")).toMatch(/uq_member_payments_session/);
    expect(readFileSync(WEBHOOK, "utf8"), "23505 を握らないと再送で 500 を返し続けます").toMatch(/23505/);
  });

  it("never lets the client write payment rows", () => {
    const sql = readFileSync(MIGRATION, "utf8").replace(/--[^\n]*/g, "");
    const policies = sql.match(/CREATE POLICY[^;]*ON public\.member_payments[\s\S]*?;/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      expect(p, "member_payments に書き込みポリシーがあります（払ったことにできます）").toMatch(
        /FOR\s+SELECT/i,
      );
    }
  });

  it("keeps the dead platform-account scaffolding unused", () => {
    // create-checkout はテナントの概念が無くプラットフォームに課金する。
    // 配線されていないことを固定する。
    const callers = readFileSync("src/components/trainer/TrainerBilling.tsx", "utf8");
    expect(callers).not.toMatch(/invoke\(\s*["']create-checkout["']/);
  });
});
