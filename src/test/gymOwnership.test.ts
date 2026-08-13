import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// オーナーの引き継ぎ／ジムを閉じる（2026-08-13）。
//
// ── なぜ要るか ─────────────────────────────────────────────────────
//
// `delete_my_account()` は active な owner を拒否する。**判断は正しい**が、
// 画面が案内する逃げ道が**どちらも実装されていなかった**:
//
//   「先にジムを削除する」    → ジムを削除する機能が無い
//   「別のオーナーに引き継ぐ」 → 引き継ぎ機能も無い
//
// つまり**オーナーはアプリからアカウントを削除できなかった**。
// Apple 5.1.1(v) / Google Play の「アプリ内でアカウントを削除できること」にも触れる。
//
// この検査は「案内した逃げ道が実在する」ことを固定する。

const stripJs = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const stripSql = (src: string): string =>
  src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const readCode = (p: string) => stripJs(readFileSync(p, "utf8"));

const MIGRATION_DIR = "supabase/migrations";
const SQL = stripSql(
  readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(`${MIGRATION_DIR}/${f}`, "utf8"))
    .filter((s) => /transfer_gym_ownership|delete_my_gym/.test(s))
    .join("\n"),
);

describe("🔴 案内した逃げ道が実在する", () => {
  it("走査が空振りしていない", () => {
    expect(SQL.length, "該当のマイグレーションが見つかりません").toBeGreaterThan(200);
  });

  it("引き継ぎとジム削除の RPC が両方ある", () => {
    // どちらかでも欠けると、オーナーはまた行き止まりになる。
    expect(SQL, "引き継ぎの RPC がありません").toMatch(
      /CREATE OR REPLACE FUNCTION public\.transfer_gym_ownership/,
    );
    expect(SQL, "ジムを閉じる RPC がありません").toMatch(
      /CREATE OR REPLACE FUNCTION public\.delete_my_gym/,
    );
  });

  it("オーナーの画面に両方の導線が出る", () => {
    const settings = readCode("src/components/trainer/TrainerGymSettings.tsx");
    expect(settings, "オーナー用の導線がありません").toMatch(/<GymOwnershipActions/);
    // 🔴 owner 以外に出さない（スタッフが勝手にジムを閉じられてはいけない）
    expect(settings, "owner 以外にも出ています").toMatch(/role === "owner" &&/);

    const ui = readCode("src/components/trainer/GymOwnershipActions.tsx");
    expect(ui, "引き継ぎを呼んでいません").toMatch(/rpc\(\s*["']transfer_gym_ownership["']/);
    expect(ui, "ジムを閉じるを呼んでいません").toMatch(/rpc\(\s*["']delete_my_gym["']/);
  });
});

describe("引き継ぎ（transfer_gym_ownership）", () => {
  const fn = SQL.slice(
    SQL.indexOf("FUNCTION public.transfer_gym_ownership"),
    SQL.indexOf("FUNCTION public.delete_my_gym"),
  );

  it("SECURITY DEFINER で、呼び出し元が owner か見ている", () => {
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn, "owner かどうかを見ていません").toMatch(/role = 'owner'[\s\S]{0,60}status = 'active'/);
    expect(fn, "owner でないときに落としていません").toMatch(/not_owner/);
  });

  it("🔴 お客様には引き継げない", () => {
    // 渡せてしまうと、お客様のアカウントがジム全体
    //（他のお客様のカルテ・入金記録）を見られる状態になる。
    //
    // ⚠️ `_to_user_id` から広めに窓を取ると、**後段の `SET role = 'trainer'`**
    //    （元オーナーを降格する UPDATE）に当たって素通りする。変異検証で実際に見逃した。
    //    **引き継ぎ先を探している SELECT だけ**を切り出して見る。
    const lookup = fn.slice(
      fn.indexOf("SELECT * INTO v_target"),
      fn.indexOf("IF NOT FOUND"),
    );
    expect(lookup.length, "引き継ぎ先を探す SELECT が見つかりません").toBeGreaterThan(40);
    expect(lookup, "引き継ぎ先を trainer に限っていません").toMatch(/role = 'trainer'/);
    expect(
      /customer/.test(lookup),
      "引き継ぎ先にお客様が含まれています。お客様がジム全体を見られる状態になります。",
    ).toBe(false);
    expect(fn, "スタッフでない相手を弾いていません").toMatch(/target_not_staff/);
  });

  it("自分自身には引き継げない", () => {
    expect(fn).toMatch(/_to_user_id = v_uid[\s\S]{0,120}same_user/);
  });

  it("🔴 新オーナーにグローバルの trainer ロールを付ける", () => {
    // 付けないと has_role(trainer) を見ている画面が一斉に閉じる。
    expect(fn, "user_roles を足していません").toMatch(
      /INSERT INTO public\.user_roles[\s\S]{0,160}'trainer'::app_role/,
    );
  });

  it("元オーナーを trainer に落とす（owner が2人にならない）", () => {
    expect(fn).toMatch(/SET role = 'trainer'\s*\n\s*WHERE tenant_id = v_tenant_id AND user_id = v_uid/);
  });
});

describe("ジムを閉じる（delete_my_gym）", () => {
  const fn = SQL.slice(SQL.indexOf("FUNCTION public.delete_my_gym"));

  it("owner だけが呼べる", () => {
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/role = 'owner'[\s\S]{0,60}status = 'active'/);
    expect(fn).toMatch(/not_owner/);
  });

  it("🔴 自分以外の在籍者がいたら閉じさせない", () => {
    // お客様が在籍しているジムを、オーナーの都合だけで消せてはいけない
    //（第三者の予約・カルテ・入金記録を巻き添えにする）。
    expect(fn, "他の在籍者を数えていません").toMatch(
      /user_id <> v_uid[\s\S]{0,80}status = 'active'/,
    );
    expect(fn, "在籍者が残っていても閉じられます").toMatch(
      /v_others > 0[\s\S]{0,120}members_remain/,
    );
  });

  it("🔴 profiles を消さない（アカウントは本人のもの）", () => {
    // ジムを閉じても、そこにいた人のアカウントまで消してはいけない。
    expect(
      /DELETE FROM public\.profiles/.test(fn),
      "profiles を削除しています。ジムを閉じただけで他人のアカウントが消えます。",
    ).toBe(false);
    expect(fn, "所属を外していません").toMatch(
      /UPDATE public\.profiles SET tenant_id = NULL/,
    );
  });

  it("🔴 外部キーの向きに沿った順で消している", () => {
    // announcement_reads → announcements の順を逆にすると外部キーで落ちる。
    const iReads = fn.indexOf("announcement_reads");
    const iAnn = fn.indexOf("DELETE FROM public.announcements");
    expect(iReads, "announcement_reads を消していません").toBeGreaterThan(-1);
    expect(iAnn, "announcements を消していません").toBeGreaterThan(-1);
    expect(iReads, "announcement_reads より先に announcements を消しています").toBeLessThan(iAnn);

    // workouts → exercises、member_agreements → messages も同じ
    expect(fn.indexOf("DELETE FROM public.workouts")).toBeLessThan(
      fn.indexOf("DELETE FROM public.exercises"),
    );
    expect(fn.indexOf("DELETE FROM public.member_agreements")).toBeLessThan(
      fn.indexOf("DELETE FROM public.messages"),
    );
  });

  it("テナント配下のテーブルを取りこぼしていない", () => {
    // types.ts で tenant_id を持つテーブルは、profiles を除いて全部消す対象。
    // 増えたのに消し忘れると、閉じたジムの行が残り続ける。
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    const blocks = [...types.matchAll(/\n {6}([a-z_0-9]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g)];
    const tenantScoped = blocks
      .filter(([, , row]) => /^\s+tenant_id\??:/m.test(row))
      .map(([, name]) => name)
      // profiles は所属を外すだけ。tenants 自体は最後に消す
      .filter((n) => n !== "profiles" && n !== "tenants");

    const missing = tenantScoped.filter(
      (t) => !new RegExp(`DELETE FROM public\\.${t}\\b`).test(fn),
    );
    expect(
      missing,
      `テナント配下のテーブルが消し漏れています（閉じたジムの行が残ります）: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("最後にテナント本体を消す", () => {
    const iTenants = fn.indexOf("DELETE FROM public.tenants");
    expect(iTenants).toBeGreaterThan(-1);
    expect(iTenants, "テナントを先に消しています（子が外部キーで残ります）").toBeGreaterThan(
      fn.indexOf("DELETE FROM public.tenant_members"),
    );
  });
});

describe("ジムを閉じるときの確認", () => {
  const ui = readCode("src/components/trainer/GymOwnershipActions.tsx");

  it("🔴 ジム名を打たないと閉じられない", () => {
    // 取り返しがつかないので、ボタン1つでは通さない。
    expect(ui, "ジム名の確認入力がありません").toMatch(/typedName/);
    expect(ui, "入力とジム名の一致を見ていません").toMatch(/typedName\.trim\(\) !== gymName/);
  });

  it("在籍者が残っている理由を出し分ける", () => {
    // 「失敗しました」だけだと、なぜ消せないのか分からず詰む。
    expect(ui).toMatch(/members_remain[\s\S]{0,120}closeBlockedMembers/);
  });

  it("引き継ぎ先がいないときに黙らない", () => {
    expect(ui).toMatch(/noCandidates/);
  });
});
