/**
 * 招待コードを知らない人が、お客様として好きなジムに入れない（2026-10-31・穴12）。
 * `supabase/migrations/20261031050000_customer_join_requires_invite_code.sql`
 *
 * tenant_members の INSERT ポリシーは「自分の行で role = 'customer'」ならどのジムにでも通していた。
 * 参加の画面（JoinGym）はどの版も「lookup_tenant_by_invite_code → 自分を upsert」の順なので、
 * コードの確認が当たったときに本人へ「参加券」を出し、画面からの直接の参加は券が無ければ断る。
 *
 * 🔴 壊しやすいもの:
 *   1. 門番（guard_customer_self_join）を SECURITY DEFINER にする → current_user が常に所有者になり素通り
 *   2. lookup を STABLE / sql に戻す → 参加券が出ず、正しいコードでも参加できなくなる
 *   3. 参加券を「ジムの id」で持つ → コードを作り直しても古い券が使える／ジムを閉じる処理に消し込みが要る
 *   4. 画面が lookup を飛ばして tenant_members に直接入れる → 参加できなくなる（券が無い）
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (src: string) => stripSql(src).replace(/\s+/g, " ").trim();
const MIGRATION = "20261031050000_customer_join_requires_invite_code.sql";
const SQL = norm(read(`supabase/migrations/${MIGRATION}`));
const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
const all = files.map((f) => ({ f, s: norm(read(`supabase/migrations/${f}`)) }));

/** 関数の最後の定義（ヘッダから本文の終わりまで） */
const lastDef = (name: string) => {
  const hit = [...all].reverse().find(({ s }) => s.includes(`CREATE OR REPLACE FUNCTION public.${name}(`));
  expect(hit, `${name} の定義が見つからない`).toBeTruthy();
  const s = hit!.s;
  const start = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = /AS (\$\w*\$)/.exec(s.slice(start))![1];
  const bodyStart = s.indexOf(tag, start) + tag.length;
  return { file: hit!.f, text: s.slice(start, s.indexOf(tag, bodyStart) + tag.length) };
};

describe("DB: 参加券", () => {
  it("本人 × 招待コード × 時刻で持つ（ジムの id は持たない）", () => {
    expect(SQL).toContain(
      "CREATE TABLE IF NOT EXISTS public.tenant_join_tickets ( user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, " +
        "invite_code text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, invite_code) );",
    );
    // tenant_id を持たせると、コードを作り直しても古い券が使えるうえ、delete_my_gym に消し込みが要る
    const table = SQL.slice(SQL.indexOf("CREATE TABLE IF NOT EXISTS public.tenant_join_tickets"));
    expect(table.slice(0, table.indexOf(");"))).not.toContain("tenant_id");
  });

  it("誰も直接は読み書きできない（RLS を有効にしてポリシーを作らない・権限を外す）", () => {
    expect(SQL).toContain("ALTER TABLE public.tenant_join_tickets ENABLE ROW LEVEL SECURITY;");
    expect(SQL).toContain("REVOKE ALL ON public.tenant_join_tickets FROM anon, authenticated;");
    for (const { f, s } of all) {
      expect(s, f).not.toMatch(/CREATE POLICY [^;]* ON public\.tenant_join_tickets/);
      if (f > MIGRATION) expect(s, f).not.toMatch(/GRANT [^;]* ON (TABLE )?public\.tenant_join_tickets/);
    }
  });
});

describe("DB: 招待コードの確認（lookup_tenant_by_invite_code）", () => {
  const def = lastDef("lookup_tenant_by_invite_code");

  it("最後の定義はこのマイグレーション（戻すと正しいコードでも参加できなくなる）", () => {
    expect(def.file).toBe(MIGRATION);
  });

  it("呼び方・戻り値は今まで通り（古いアプリも同じ呼び方）", () => {
    expect(def.text).toContain(
      "lookup_tenant_by_invite_code(p_code text) RETURNS TABLE(id uuid, gym_name text, address text, logo_url text, primary_color text)",
    );
    expect(def.text).toContain("v_code text := lower(replace(p_code, '-', ''));");
    expect(def.text).toContain("t.status IN ('active', 'trial')");
  });

  it("🔴 VOLATILE（参加券を書く）・SECURITY DEFINER", () => {
    expect(def.text).toMatch(/LANGUAGE plpgsql VOLATILE SECURITY DEFINER/);
  });

  it("参加券はログインしている本人にだけ出す（未ログインの検索では出さない）", () => {
    expect(def.text).toMatch(
      /IF auth\.uid\(\) IS NOT NULL THEN BEGIN INSERT INTO public\.tenant_join_tickets \(user_id, invite_code, created_at\) VALUES \(auth\.uid\(\), v_code, now\(\)\)/,
    );
  });

  it("読み取り専用のトランザクションで呼ばれても、検索の結果は返す", () => {
    expect(def.text).toContain("EXCEPTION WHEN read_only_sql_transaction THEN NULL;");
  });
});

describe("DB: 参加の門番", () => {
  it("券は「そのジムの今の招待コード」で24時間以内のものだけ有効", () => {
    const def = lastDef("has_tenant_join_ticket");
    expect(def.text).toContain("JOIN public.tenant_join_tickets k ON k.invite_code = t.invite_code");
    expect(def.text).toContain("k.user_id = auth.uid()");
    expect(def.text).toContain("k.created_at > now() - interval '24 hours'");
    expect(def.text).toContain("t.status IN ('active', 'trial')");
    expect(def.text).toMatch(/STABLE SECURITY DEFINER/);
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.has_tenant_join_ticket(uuid) FROM PUBLIC, anon;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.has_tenant_join_ticket(uuid) TO authenticated, service_role;");
  });

  it("🔴 門番は SECURITY INVOKER（DEFINER だと current_user が所有者になり素通り）", () => {
    const def = lastDef("guard_customer_self_join");
    expect(def.text).not.toContain("SECURITY DEFINER");
    expect(def.text).toContain(
      "IF current_user = 'authenticated' AND NEW.role = 'customer' AND NOT public.has_tenant_join_ticket(NEW.tenant_id) THEN",
    );
  });

  it("tenant_members の BEFORE INSERT に付いている", () => {
    expect(SQL).toContain(
      "CREATE TRIGGER trg_guard_customer_self_join BEFORE INSERT ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.guard_customer_self_join();",
    );
    for (const { f, s } of all.filter(({ f }) => f > MIGRATION)) {
      expect(s, f).not.toContain("DROP TRIGGER IF EXISTS trg_guard_customer_self_join");
    }
  });
});

describe("画面: お客様の参加は「コードを確かめる → 参加」の順", () => {
  const join = read("src/pages/JoinGym.tsx");

  it("JoinGym はコードを lookup_tenant_by_invite_code で確かめ、当たったジムにだけ入る", () => {
    expect(join).toContain('supabase.rpc("lookup_tenant_by_invite_code", { p_code: cleaned })');
    expect(join).toMatch(/const handleJoin = async \(\) => \{\s*if \(!user \|\| !tenant\) return;/);
    expect(join).toMatch(/\.from\("tenant_members"\)\s*\.upsert\(\s*\{\s*tenant_id: tenant\.id,/);
  });

  it("画面からお客様の所属を直接入れているのは JoinGym だけ（ほかは券が無いので断られる）", () => {
    const writers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (p === "src/test" || p === "src/integrations") continue;
          walk(p);
        } else if (/\.tsx?$/.test(e.name)) {
          const src = read(p);
          for (const m of src.matchAll(/\.from\("tenant_members"\)/g)) {
            if (/^\s*\.(insert|upsert)\(/.test(src.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40))) {
              writers.push(p);
            }
          }
        }
      }
    };
    walk("src");
    expect([...new Set(writers)]).toEqual(["src/pages/JoinGym.tsx"]);
  });
});

describe("security/check.sql", () => {
  it("検査11（招待コード無しでお客様として入れないか）がある", () => {
    const kit = read("security/check.sql");
    expect(kit).toContain("検査11: 招待コードを知らない人が、お客様として好きなジムに入れないか");
    expect(kit.indexOf("検査11")).toBeLessThan(kit.indexOf("-- 検査7: cron の POST 先"));
  });
});
