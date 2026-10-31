/**
 * 課金の印と、ジムの課金・契約の列の守り（2026-10-31・Stripe の点検）。
 *   `supabase/migrations/20261031090000_billing_flags_and_tenant_billing_guard.sql`
 *
 * 宗本さんの判断（2026-10-31）:
 *   - テスト決済（Stripe のテストモード）は、運営が指定したテスト用のジムだけ
 *   - コンプ（無償で無制限）は専用の印で見分ける（src/test/stripeWebhookCompGuard.test.ts）
 *
 * 何が起きていたか:
 *   1. どのジムのオーナーでも、テスト用のカード番号（お金が動かない）で Pro にできた
 *      （checkout が environment = 'sandbox' を誰からでも受け付け、webhook がテストのイベントでも本番を書き換えた）
 *   2. オーナーが自分のジムの課金・契約の列（プラン・上限・お試し期間・契約の状態）を API で書き換えられた
 *      （以前の列単位の REVOKE は、テーブル単位の権限が残っていて効いていなかった）
 *
 * 🔴 壊しやすいもの:
 *   1. 印を tenants の列に移す → 2 と同じ形で、オーナーが自分で印を付けられる
 *   2. 門番を SECURITY DEFINER にする → current_user が常に所有者になり素通り
 *   3. 画面の保存で守る列を書く → 保存が「プラン・契約の状態は…」で落ちる（下の走査で止める）
 *   4. 印が読めないときに進む → テスト決済が誰にでも開く・コンプを落とす
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(path, "utf8");
/** コメントを落とす（説明のために関数名や列名を書いているため） */
const stripTs = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
const stripSql = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (s: string) => stripSql(s).replace(/\s+/g, " ").trim();

const MIGRATION = "20261031090000_billing_flags_and_tenant_billing_guard.sql";
const SQL = norm(read(`supabase/migrations/${MIGRATION}`));
const WEBHOOK = stripTs(read("supabase/functions/gymboard-stripe-webhook/index.ts"));
const CHECKOUT = stripTs(read("supabase/functions/gymboard-create-checkout/index.ts"));
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();

/** 画面から書き換えさせない tenants の列（門番の UPDATE の拒否リストと同じ） */
const GUARDED = [
  "status",
  "trial_ends_at",
  "gymboard_plan",
  "gymboard_plan_period",
  "max_customers",
  "max_trainers",
  "subscription_status",
  "current_period_end",
  "stripe_customer_id",
  "stripe_subscription_id",
  "owner_user_id",
];

describe("運営だけが触れる課金の印（tenant_billing_flags）", () => {
  it("🔴 印は tenants の列ではなく別の表。画面（anon / authenticated）は読めない・書けない", () => {
    expect(SQL).toContain("CREATE TABLE IF NOT EXISTS public.tenant_billing_flags (");
    expect(SQL).toContain("tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE");
    expect(SQL).toContain("is_comp boolean NOT NULL DEFAULT false");
    expect(SQL).toContain("stripe_sandbox_allowed boolean NOT NULL DEFAULT false");
    expect(SQL).toContain("ALTER TABLE public.tenant_billing_flags ENABLE ROW LEVEL SECURITY;");
    expect(SQL).toContain("REVOKE ALL ON public.tenant_billing_flags FROM PUBLIC, anon, authenticated;");
    // ポリシーを作らない（作ると authenticated に道ができる）
    expect(SQL).not.toMatch(/CREATE POLICY [^;]* ON public\.tenant_billing_flags/);
    // tenants に印の列を足していない
    expect(SQL).not.toMatch(/ALTER TABLE public\.tenants ADD COLUMN/i);
  });

  it("後のマイグレーションで、印の表を画面に開いていない", () => {
    for (const f of migrations.filter((f) => f > MIGRATION)) {
      const s = norm(read(`supabase/migrations/${f}`));
      expect(s, f).not.toMatch(/GRANT [^;]* ON (TABLE )?public\.tenant_billing_flags TO [^;]*(anon|authenticated)/);
      expect(s, f).not.toMatch(/CREATE POLICY [^;]* ON public\.tenant_billing_flags/);
      expect(s, f).not.toMatch(/tenant_billing_flags DISABLE ROW LEVEL SECURITY/);
    }
  });
});

describe("webhook: テストモードのイベントはテスト用のジムだけ", () => {
  it("本番のイベントかは署名を確かめたあとの event.livemode で見る（無い・壊れているときは本番扱いにしない）", () => {
    expect(WEBHOOK).toContain("const livemode = event.livemode === true;");
    expect(WEBHOOK.indexOf("const event = await verifyAnySecret(req, body);")).toBeLessThan(
      WEBHOOK.indexOf("const livemode = event.livemode === true;"),
    );
  });

  it("🔴 テスト用の印が無いジムには、テストモードのイベントを反映しない", () => {
    expect(WEBHOOK).toContain(
      'if (!livemode && !flags.sandboxAllowed) return "test-mode event for a tenant that is not a test tenant";',
    );
    expect(WEBHOOK).toContain("sandboxAllowed: row?.stripe_sandbox_allowed === true");
  });

  it("プランの適用は全部 livemode を渡している（渡し忘れると型で落ちるが、呼び出しも数で見る）", () => {
    const calls = WEBHOOK.match(/await applySubscriptionToTenant\(/g) ?? [];
    const withLive = WEBHOOK.match(/await applySubscriptionToTenant\([^)]*, livemode\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(withLive.length).toBe(calls.length);
  });
});

describe("checkout: テスト決済はテスト用のジムだけ・コンプは購入させない", () => {
  it("🔴 Stripe を呼ぶ前に、運営の印を読む（読めなければ進めない）", () => {
    const flagsAt = CHECKOUT.indexOf('.from("tenant_billing_flags")');
    expect(flagsAt).toBeGreaterThan(-1);
    expect(flagsAt).toBeLessThan(CHECKOUT.indexOf("createStripeClient(environment)"));
    expect(CHECKOUT).toContain("if (flagsErr) throw flagsErr;");
    // 印は service_role のクライアント（admin）で読む。画面の権限では読めない
    expect(CHECKOUT).toMatch(/await admin\s*\.from\("tenant_billing_flags"\)/);
  });

  it("テスト決済（sandbox）は印のあるジムだけ", () => {
    expect(CHECKOUT).toContain('if (environment === "sandbox" && billingFlags?.stripe_sandbox_allowed !== true) {');
    expect(CHECKOUT).toContain('return bad("このジムではテスト決済は使えません", 403);');
  });

  it("コンプのジムは購入できない（払っても webhook が反映しないため）", () => {
    expect(CHECKOUT).toContain("if (billingFlags?.is_comp === true) {");
  });

  it("オーナーの確認は今まで通り（印の確認より先）", () => {
    const ownerAt = CHECKOUT.indexOf('(member as any).role !== "owner"');
    expect(ownerAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeLessThan(CHECKOUT.indexOf('.from("tenant_billing_flags")'));
  });
});

describe("ジムの課金・契約の列は、画面から書き換えられない", () => {
  const fnStart = SQL.indexOf("CREATE OR REPLACE FUNCTION public.guard_tenant_billing_columns()");
  const fn = SQL.slice(fnStart, SQL.indexOf("$$;", fnStart));

  it("🔴 門番は SECURITY INVOKER で、画面から（authenticated / anon）の書き込みだけを見る", () => {
    expect(fnStart).toBeGreaterThan(-1);
    expect(fn).not.toContain("SECURITY DEFINER");
    expect(fn).toContain("IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;");
  });

  it("INSERT と UPDATE の両方に付いている", () => {
    expect(SQL).toContain(
      "CREATE TRIGGER trg_guard_tenant_billing_columns BEFORE INSERT OR UPDATE ON public.tenants " +
        "FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_billing_columns();",
    );
  });

  it("UPDATE: 守る列が変わるなら拒む（同じ値なら通す）", () => {
    for (const col of GUARDED) {
      expect(fn, col).toMatch(new RegExp(`NEW\\.${col} IS DISTINCT FROM OLD\\.${col}`));
    }
    expect(fn).toContain("RAISE EXCEPTION 'プラン・契約の状態は、この画面からは変えられません' USING ERRCODE = '42501';");
  });

  it("🔴 INSERT: 拒まずに、create_gym_with_owner と同じ値へ上書きする（古いアプリの開設を落とさない）", () => {
    // 開設の RPC が固定している値（最新の定義）を読み、門番の上書きと突き合わせる
    const rpcFile = [...migrations].reverse().find((f) =>
      norm(read(`supabase/migrations/${f}`)).includes("CREATE OR REPLACE FUNCTION public.create_gym_with_owner("),
    );
    expect(rpcFile).toBeTruthy();
    const rpc = norm(read(`supabase/migrations/${rpcFile!}`));
    expect(rpc).toContain("v_uid, 'trial', now() + interval '60 days', 'free', 5 )");

    expect(fn).toContain("NEW.status := 'trial';");
    expect(fn).toContain("NEW.trial_ends_at := now() + interval '60 days';");
    expect(fn).toContain("NEW.gymboard_plan := 'free';");
    expect(fn).toContain("NEW.max_customers := 5;");
    for (const col of ["gymboard_plan_period", "max_trainers", "subscription_status", "current_period_end", "stripe_customer_id", "stripe_subscription_id"]) {
      expect(fn, col).toContain(`NEW.${col} := NULL;`);
    }
    // INSERT では例外にしない（上書きして通す）
    const insertBlock = fn.slice(fn.indexOf("IF TG_OP = 'INSERT' THEN"), fn.indexOf("RETURN NEW; END IF;", fn.indexOf("IF TG_OP = 'INSERT' THEN")));
    expect(insertBlock).not.toContain("RAISE EXCEPTION");
  });

  it("後のマイグレーションが門番を外していない", () => {
    for (const f of migrations.filter((f) => f > MIGRATION)) {
      const s = norm(read(`supabase/migrations/${f}`));
      expect(s, f).not.toContain("DROP TRIGGER IF EXISTS trg_guard_tenant_billing_columns");
      expect(s, f).not.toMatch(/ALTER TABLE public\.tenants DISABLE TRIGGER/);
    }
  });

  it("🔴 画面のコードは、守る列を tenants に書いていない（書くと保存が落ちる）", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (p === join("src", "test") || p === join("src", "dev")) continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(name) && !p.endsWith(join("integrations", "supabase", "types.ts"))) {
          files.push(p);
        }
      }
    };
    walk("src");
    const keyRe = new RegExp(`\\b(${GUARDED.join("|")})\\s*:`);
    let writes = 0;
    for (const f of files) {
      const s = stripTs(read(f));
      let at = s.indexOf('.from("tenants")');
      while (at !== -1) {
        // その文の終わりまで（次の ; か 800 文字）
        const end = s.indexOf(";", at);
        const stmt = s.slice(at, end === -1 ? at + 800 : Math.min(end, at + 800));
        if (/\.(update|insert|upsert)\(/.test(stmt)) {
          writes++;
          expect(stmt, `${f} が tenants の守る列を書いている`).not.toMatch(keyRe);
        }
        at = s.indexOf('.from("tenants")', at + 1);
      }
    }
    // 走査が空振りしていない（画面にはジムの設定の保存がたくさんある）
    expect(writes).toBeGreaterThan(10);
  });
});

describe("点検キット", () => {
  it("security/check.sql に検査13がある（検査7 より前）", () => {
    const kit = read("security/check.sql");
    expect(kit).toContain("検査13: ジムの課金・契約の列を、画面から書き換えられないか");
    expect(kit.indexOf("検査13")).toBeLessThan(kit.indexOf("-- 検査7: cron の POST 先"));
  });
});
