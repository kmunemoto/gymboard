import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// コンプ（運営が無償で無制限にしているテナント）を Stripe のイベントが書き換えないことを見張る。
//
// 2026-08-21 に実際に起きた: 運営自身のジム（コンプ）に課金テストのサブスクが
// 紐づいたまま Stripe 側で削除され、customer.subscription.deleted がコンプ状態を
// free（上限5名）へ上書き。顧客37名のジムが「上限超過」で新規予約・記録を
// 作れなくなった（プッシュもメールも無しで、店がある日突然ロックされる形）。
//
// 2026-10-31: コンプの見分け方を max_customers IS NULL から、運営だけが触れる印
// （tenant_billing_flags.is_comp）に変えた。Pro（上限なし）も max_customers が NULL なので、
// Pro になったジムが以後のイベント（解約・プラン変更）を全部無視され、解約しても Pro のまま残っていた。
// テストモードの印（stripe_sandbox_allowed）は src/test/stripeBillingFlags.test.ts。
const src = readFileSync("supabase/functions/gymboard-stripe-webhook/index.ts", "utf8");
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
  .join("\n");

describe("🔴 Stripe webhook はコンプのテナントを書き換えない", () => {
  it("コンプは運営の印（tenant_billing_flags.is_comp）で見分ける。上限なし（max_customers）では見分けない", () => {
    expect(code).toContain('.from("tenant_billing_flags")');
    expect(code).toContain('.select("is_comp, stripe_sandbox_allowed")');
    expect(code).toContain("comp: row?.is_comp === true");
    // 以前の判定（Pro も当てはまる）に戻っていない
    expect(code).not.toMatch(/isCompTenant/);
    expect(code).not.toMatch(/\.select\("max_customers"\)/);
    expect(code).not.toMatch(/max_customers === null/);
  });

  it("🔴 印が読めなかったら例外（500 → Stripe が送り直す）。読めないまま進んでコンプを落とさない", () => {
    expect(code).toMatch(/if \(error\) throw new Error\(`tenant_billing_flags read failed/);
  });

  it("コンプなら反映しない理由を返す（テストモードの判定より先）", () => {
    const fn = code.slice(code.indexOf("async function skipReason"));
    expect(fn.indexOf('if (flags.comp) return "comp tenant";')).toBeGreaterThan(-1);
    expect(fn.indexOf("if (flags.comp)")).toBeLessThan(fn.indexOf("if (!livemode && !flags.sandboxAllowed)"));
  });

  const guardBeforeUpdate = (slice: string, label: string) => {
    const guardAt = slice.indexOf("await skipReason(");
    const updateAt = slice.indexOf('from("tenants")');
    expect(guardAt, `${label}: ガードが無い`).toBeGreaterThan(-1);
    expect(updateAt, `${label}: 書き込みが見つからない`).toBeGreaterThan(-1);
    expect(guardAt, `${label}: ガードが書き込みより後にある`).toBeLessThan(updateAt);
  };

  it("プラン適用（作成・更新・checkout 完了）はガードが先", () => {
    // applySubscriptionToTenant の冒頭に skipReason の早期 return があること。
    // ガードが update の後ろに落ちたり消えたりすると、コンプが課金プランに上書きされる。
    const fn = code.slice(code.indexOf("async function applySubscriptionToTenant"), code.indexOf("async function resolveTenantId"));
    guardBeforeUpdate(fn, "applySubscriptionToTenant");
  });

  it("subscription.deleted（free への格下げ）もガードが先", () => {
    const handler = code.slice(code.indexOf('type === "customer.subscription.deleted"'), code.indexOf('type === "invoice.payment_failed"'));
    guardBeforeUpdate(handler, "subscription.deleted");
  });

  it("invoice.payment_failed（past_due にする）もガードが先", () => {
    const handler = code.slice(code.indexOf('type === "invoice.payment_failed"'));
    const guardAt = handler.indexOf("await skipReason(");
    const pastDueAt = handler.indexOf('update({ subscription_status: "past_due" })');
    expect(guardAt, "支払いの失敗にガードが無い").toBeGreaterThan(-1);
    expect(pastDueAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(pastDueAt);
  });

  it("checkout.session.completed は Stripe へ問い合わせる前に止める", () => {
    const handler = code.slice(code.indexOf('type === "checkout.session.completed"'), code.indexOf('type === "customer.subscription.updated"'));
    const guardAt = handler.indexOf("await skipReason(tenantId, livemode)");
    const retrieveAt = handler.indexOf("stripe.subscriptions.retrieve(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(retrieveAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(retrieveAt);
  });
});
