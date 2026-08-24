import { readFileSync, readdirSync } from "fs";
import { describe, expect, it } from "vitest";

// ジム開設を1トランザクションにした（2026-08-24）ことの見張り。
//
// 直した実害（本番で実際に起きていた）:
//   1. 途中失敗で「孤児テナント」が残り、再試行のたびに1件ずつ増える。
//      しかも tenant_members が無いので delete_my_gym の本人確認に落ち、本人にも消せない
//   2. 🔴 部位マスターのシードが**必ず**失敗していた。tenant_muscle_groups の INSERT
//      ポリシーは get_my_tenant_id()（= tenant_members を読む）を要求するのに、
//      シードを tenant_members の INSERT より**前**に置いていたため。
//      エラーは console.error で握りつぶし。2026-07-29 以降に開設された全ジムが部位0件だった
//   3. プラン状態（gymboard_plan / max_customers / status）をクライアントが申告していたので、
//      API を直接叩けば premium・上限999 で開設できた
//
// 逆流を防ぐため、クライアントが個別 INSERT に戻っていないことを形で固定する。

const MIGRATION = "supabase/migrations/20260824010000_create_gym_transaction.sql";

describe("🔴 開設は RPC 1本（クライアントの逐次 INSERT に戻さない）", () => {
  const onboarding = readFileSync("src/pages/Onboarding.tsx", "utf8");
  // handleComplete の中だけを見る（画面の他の部分にはロゴのアップロード等がある）
  const complete = onboarding.slice(
    onboarding.indexOf("const handleComplete"),
    onboarding.indexOf("if (authLoading || checking)"),
  );

  it("create_gym_with_owner を呼んでいる", () => {
    expect(complete).toMatch(/supabase\.rpc\("create_gym_with_owner"/);
  });

  it("開設時にテナント系のテーブルへ直接 INSERT していない", () => {
    // ここが復活する = 途中失敗で孤児が残る作りに逆戻り
    for (const table of ["tenants", "tenant_members", "tenant_plans", "tenant_muscle_groups", "profiles"]) {
      expect(
        complete.includes(`.from("${table}")\n        .insert`) ||
          complete.includes(`.from("${table}").insert`) ||
          complete.includes(`.from("${table}")\n        .upsert`),
        `${table} への直接 INSERT が復活している`,
      ).toBe(false);
    }
  });

  it("🔴 プラン状態をクライアントから送っていない（サーバー側で固定する）", () => {
    // 送ると API 直叩きで premium 開設ができてしまう。
    // ⚠️ コメントには「なぜ送らないか」の説明でこれらの語が出るので、
    //    行コメントを落としてから検査する（説明を書けなくしないため）
    const code = complete
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    for (const field of ["gymboard_plan", "max_customers", "trial_ends_at"]) {
      expect(code, `${field} をクライアントから送っている`).not.toContain(field);
    }
    // status も同様。ただし別語（statusText 等）と紛れないよう代入の形で見る
    expect(code).not.toMatch(/status:\s*["']trial["']/);
  });

  it("部位の既定値を共有定数から渡している（画面に直書きしない）", () => {
    expect(complete).toContain("DEFAULT_TENANT_MUSCLE_GROUPS");
  });
});

describe("🔴 RPC 側が守っていること", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  // CREATE OR REPLACE は最後の定義しか残らないので、関数本体だけを切り出して見る
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.create_gym_with_owner"), sql.indexOf("REVOKE ALL ON FUNCTION"));

  it("SECURITY DEFINER ＋ search_path 固定", () => {
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET search_path TO 'public'/);
  });

  it("未ログイン・非トレーナーを拒否する", () => {
    expect(fn).toMatch(/not_authenticated/);
    expect(fn).toMatch(/not_trainer/);
    expect(fn).toMatch(/has_role\(v_uid, 'trainer'::public\.app_role\)/);
  });

  it("🔴 プラン状態をリテラルで固定している（引数から採らない）", () => {
    // INSERT の VALUES に 'trial' / 'free' / 5 が直書きされていること。
    // _tenant->>'gymboard_plan' のように引数を読む形に変わったら赤にする
    expect(fn).toMatch(/'trial',/);
    expect(fn).toMatch(/'free',/);
    expect(fn).not.toMatch(/_tenant->>'gymboard_plan'/);
    expect(fn).not.toMatch(/_tenant->>'max_customers'/);
    expect(fn).not.toMatch(/_tenant->>'status'/);
  });

  it("🔴 在籍（tenant_members）を部位シードより先に入れる", () => {
    const members = fn.indexOf("INSERT INTO public.tenant_members");
    const muscle = fn.indexOf("INSERT INTO public.tenant_muscle_groups");
    expect(members).toBeGreaterThan(0);
    expect(muscle).toBeGreaterThan(0);
    expect(members, "部位シードが在籍より前に戻っている（元のバグの形）").toBeLessThan(muscle);
  });

  it("オーナーの profiles を作る（トリガーが無いので欠ける）", () => {
    expect(fn).toMatch(/INSERT INTO public\.profiles/);
    expect(fn).toMatch(/ON CONFLICT \(user_id\) DO UPDATE/);
  });

  it("anon から実行できない", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.create_gym_with_owner.*FROM PUBLIC, anon;/s);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_gym_with_owner.*TO authenticated;/s);
  });

  it("部位0件のテナントをバックフィルする（冪等）", () => {
    expect(sql).toMatch(/INSERT INTO public\.tenant_muscle_groups[\s\S]*NOT EXISTS/);
  });
});

describe("migration の連番", () => {
  it("この migration が最新に含まれている", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain("20260824010000_create_gym_transaction.sql");
  });
});
