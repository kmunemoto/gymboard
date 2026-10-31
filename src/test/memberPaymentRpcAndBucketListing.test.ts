/**
 * 外から呼ぶ必要のない関数と、公開の置き場の「一覧」を閉じた（2026-10-31・セキュリティ点検）。
 * `supabase/migrations/20261031030000_close_member_payment_rpc_and_bucket_listing.sql`
 *
 * 🔴 壊しやすいもの:
 *   1. member_first_unpaid_cycle_start を呼ぶ関数が SECURITY INVOKER になる → 外したせいで動かなくなる
 *   2. member_first_unpaid_cycle_start を RLS のポリシーで使う → そのテーブルが読めなくなる（穴8の教訓）
 *   3. 本人の SELECT まで消して、ロゴの upload（upsert）とロゴの削除（一覧して消す）が失敗する
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (src: string) => stripSql(src).replace(/\s+/g, " ").trim();
const MIGRATION = "20261031030000_close_member_payment_rpc_and_bucket_listing.sql";
const SQL = norm(read(`supabase/migrations/${MIGRATION}`));
const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
const all = files.map((f) => ({ f, s: norm(read(`supabase/migrations/${f}`)) }));

/** 最後の定義（CREATE OR REPLACE FUNCTION public.<name>( から $function$/$fn$/$$ の閉じまで） */
const lastDef = (name: string) => {
  const hit = [...all].reverse().find(({ s }) => s.includes(`CREATE OR REPLACE FUNCTION public.${name}(`));
  expect(hit, `${name} の定義が見つからない`).toBeTruthy();
  const s = hit!.s;
  const start = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  return s.slice(start, s.indexOf(" AS ", start));
};

describe("member_first_unpaid_cycle_start（会員の未払いのサイクル）", () => {
  it("外（未ログイン・ログインした人）から呼べない", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.member_first_unpaid_cycle_start(uuid, uuid) FROM PUBLIC, anon, authenticated;");
  });

  it("🔴 呼んでいる関数は SECURITY DEFINER（外しても所有者の権限で呼べる）", () => {
    for (const name of ["get_my_next_cycle_payment_gate", "guard_booking_next_cycle_payment"]) {
      expect(lastDef(name), name).toContain("SECURITY DEFINER");
    }
    // ほかに呼んでいる関数が増えていない（増えたら、その関数も DEFINER か確かめること）
    const callers = new Set<string>();
    for (const { s } of all) {
      for (const m of s.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([^]*?\$(\w*)\$([^]*?)\$\2\$/g)) {
        if (m[1] !== "member_first_unpaid_cycle_start" && m[3].includes("member_first_unpaid_cycle_start(")) callers.add(m[1]);
      }
    }
    expect([...callers].sort()).toEqual(["get_my_next_cycle_payment_gate", "guard_booking_next_cycle_payment"]);
  });

  it("🔴 RLS のポリシーで使っていない・後で外に戻していない", () => {
    for (const { f, s } of all) {
      for (const m of s.matchAll(/CREATE POLICY [^;]*;/g)) {
        expect(m[0], f).not.toContain("member_first_unpaid_cycle_start");
      }
      if (f > MIGRATION) expect(s, f).not.toMatch(/GRANT [^;]*member_first_unpaid_cycle_start/);
    }
  });
});

describe("公開の置き場の一覧", () => {
  it("誰でも一覧できるポリシーを消す", () => {
    expect(SQL).toContain('DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;');
    expect(SQL).toContain('DROP POLICY IF EXISTS "Anyone can view gym assets" ON storage.objects;');
  });

  it("🔴 本人（avatars）と、そのジムのスタッフ（gym-assets の自分のジムのフォルダ）には残す", () => {
    expect(SQL).toContain(
      'CREATE POLICY "Avatar owners can list own files" ON storage.objects FOR SELECT TO authenticated ' +
      "USING (bucket_id = 'avatars' AND owner = auth.uid());",
    );
    expect(SQL).toContain(
      'CREATE POLICY "Gym staff can list own gym assets" ON storage.objects FOR SELECT TO authenticated ' +
      "USING ( bucket_id = 'gym-assets' AND (storage.foldername(name))[1] = (public.get_my_tenant_id())::text " +
      "AND public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer']) );",
    );
  });

  it("画面は公開 URL で表示している（一覧を閉じても表示は変わらない）。一覧は自分のジムのフォルダだけ", () => {
    const settings = read("src/components/trainer/TrainerGymSettings.tsx");
    expect(settings).toContain('supabase.storage.from("gym-assets").getPublicUrl(filePath)');
    expect(settings).toContain("const folder = tenant.id;");
    expect(settings).toContain('supabase.storage.from("gym-assets").list(folder)');
    const onboarding = read("src/pages/Onboarding.tsx");
    expect(onboarding).toContain('supabase.storage.from("avatars").getPublicUrl(path)');
    expect(onboarding).not.toMatch(/from\("avatars"\)\.list\(/);
  });

  it("security/check.sql に検査9（公開の置き場を誰でも一覧できないか）がある", () => {
    const kit = read("security/check.sql");
    expect(kit).toContain("検査9: 公開の置き場（バケット）を、誰でも一覧できないか");
    expect(kit.indexOf("検査9")).toBeLessThan(kit.indexOf("-- 検査7: cron の POST 先"));
  });
});
