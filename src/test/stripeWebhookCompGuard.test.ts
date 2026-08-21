import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// コンプ（運営が無償で無制限にしているテナント。max_customers IS NULL）を
// Stripe のイベントが書き換えないことを見張る。
//
// 2026-08-21 に実際に起きた: 運営自身のジム（コンプ）に課金テストのサブスクが
// 紐づいたまま Stripe 側で削除され、customer.subscription.deleted がコンプ状態を
// free（上限5名）へ上書き。顧客37名のジムが「上限超過」で新規予約・記録を
// 作れなくなった（プッシュもメールも無しで、店がある日突然ロックされる形）。
const src = readFileSync("supabase/functions/gymboard-stripe-webhook/index.ts", "utf8");

describe("🔴 Stripe webhook はコンプのテナントを書き換えない", () => {
  it("コンプ判定は max_customers IS NULL（コンプの定義そのもの）", () => {
    expect(src).toMatch(/async function isCompTenant\(/);
    expect(src).toMatch(/\.select\("max_customers"\)/);
    expect(src).toMatch(/max_customers: number \| null \}\)\.max_customers === null/);
  });

  it("プラン適用（作成・更新・checkout 完了）はガードが先", () => {
    // applySubscriptionToTenant の冒頭に isCompTenant の早期 return があること。
    // ガードが update の後ろに落ちたり消えたりすると、コンプが課金プランに上書きされる。
    const fn = src.slice(src.indexOf("async function applySubscriptionToTenant"));
    const guardAt = fn.indexOf("await isCompTenant(tenantId)");
    const updateAt = fn.indexOf('from("tenants").update(');
    expect(guardAt, "適用側にコンプのガードが無い").toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(-1);
    expect(guardAt, "ガードが update より後にある").toBeLessThan(updateAt);
  });

  it("subscription.deleted（free への格下げ）もガードが先", () => {
    const handler = src.slice(src.indexOf('type === "customer.subscription.deleted"'));
    const guardAt = handler.indexOf("await isCompTenant(tenantId)");
    const updateAt = handler.indexOf('from("tenants").update(');
    expect(guardAt, "削除側にコンプのガードが無い").toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(-1);
    expect(guardAt, "ガードが update より後にある").toBeLessThan(updateAt);
  });
});
