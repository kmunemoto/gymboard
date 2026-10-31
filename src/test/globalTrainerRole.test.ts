import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  MIGRATIONS_DIR,
  OWN_ROW,
  TENANT_SCOPED,
  effectivePolicies,
  extractClauses,
  splitTopLevelOr,
  stripSqlComments,
  type Policy,
} from "./helpers/rlsPolicies";

// **`has_role(auth.uid(), 'trainer')` だけで書き込めるポリシーを作らせない。**
//
// 🔴 2026-10-31（穴11）: **読み取りも含めて、PERMISSIVE で `has_role(trainer)` を使わない。**
//    下の「RESTRICTIVE なテナント絞りがあれば対象外」は**別のジムから**の話でしかなかった。
//    同じジムのお客様が自分に印を付けると、RESTRICTIVE（tenant_id = get_my_tenant_id()）も
//    通ってしまい、そのジムの全員のプロフィール・予約・チャットが読めた（本番で演じて確認）。
//    → 20261031040000_staff_checks_tenant_scoped.sql で全部「そのジムのスタッフか」に差し替えた。
//    見張りはこのファイルの末尾の describe（穴11）。
//
// ── なぜ ──────────────────────────────────────────────────────
// `has_role` が見る `public.user_roles` に `tenant_id` は無い。
// つまり trainer は**テナント横断のグローバル権限**であり、
// `signup-trainer` は自己サービス（誰でも登録できる。これは仕様として維持する）。
//
// したがって
//
//   USING (has_role(auth.uid(), 'trainer'::app_role))
//
// とだけ書かれた書き込みポリシーは、実質「インターネットの誰でも書ける」と同義になる。
// 2026-08-03 時点で、全テナント共通のマスタ（raid_bosses / season_events /
// season_pass_config など8テーブル）がこの状態だった。
//
// ── 判定 ──────────────────────────────────────────────────────
// 書き込み（SELECT 以外）の PERMISSIVE ポリシーが `has_role(...'trainer')` を含むなら、
// **同じ枝に**テナント絞りか本人限定が AND されていなければならない。
// OR で並んでいる場合は「全ての枝」が絞られていること（緩い枝が1つでもあれば通る）。
//
// RESTRICTIVE なテナント絞りが張られているテーブルは対象外（AND で潰れるため）。
// この考え方は tenantIsolation.test.ts と同じで、パーサも共有している
// （src/test/helpers/rlsPolicies.ts）。違いは「対象テーブルを列挙しない」こと。
// **列挙するとテーブルが増えたときに漏れる。** ここは全ポリシーを走査する。

const { policies, loopCovered } = effectivePolicies();

const hasRestrictiveTenantScope = (table: string) =>
  loopCovered.has(table) ||
  policies.some((p) => p.table === table && p.restrictive && TENANT_SCOPED.test(p.body));

const GLOBAL_TRAINER_ROLE = /has_role\s*\(\s*auth\.uid\(\)\s*,\s*'trainer'/;

/** 書き込み（既存行に触れる or 新規作成）で、PERMISSIVE なもの */
const isWritePolicy = (p: Policy) => !p.restrictive && p.cmd !== "SELECT";

/** その枝が「テナント絞り」か「本人限定」で閉じているか */
const branchIsScoped = (branch: string) => TENANT_SCOPED.test(branch) || OWN_ROW.test(branch);

/**
 * `has_role(trainer)` に頼っているのに、どこにも絞りが無いポリシーを洗い出す。
 * USING / WITH CHECK のいずれかに緩い枝があれば違反とする。
 *
 * `storage.objects` は対象外。絞りの書き方が `bucket_id` /
 * `storage.foldername(name)` / `auth.uid()::text` と public スキーマのテーブルと
 * まったく違い、この判定では正しく評価できない（パーサもテーブル名を "storage" と
 * 拾ってしまう）。代わりに下で名指しの断言を1つ置いている。
 */
function offendingPolicies(): Policy[] {
  return policies.filter((p) => {
    if (p.table === "storage") return false;
    if (!isWritePolicy(p)) return false;
    if (!GLOBAL_TRAINER_ROLE.test(p.body)) return false;
    if (hasRestrictiveTenantScope(p.table)) return false;
    const clauses = extractClauses(p.body);
    if (clauses.length === 0) return true;
    return clauses.some((clause) => splitTopLevelOr(clause).some((b) => !branchIsScoped(b)));
  });
}

describe("グローバルな trainer ロールだけで書けるポリシーが無いこと", () => {
  it("解析器がポリシーを拾えている", () => {
    // 0件のまま緑になる（＝何も見ていない）事故を防ぐ
    expect(policies.length).toBeGreaterThan(50);
    expect(policies.some((p) => GLOBAL_TRAINER_ROLE.test(p.body))).toBe(true);
  });

  it("書き込みポリシーは必ずテナント絞りか本人限定と AND されている", () => {
    const offenders = offendingPolicies().map(
      (p) => `${p.table} / ${p.name} (${p.cmd}): ${p.body.slice(0, 110)}`,
    );

    expect(
      offenders,
      offenders.length
        ? "trainer ロールだけで書けるポリシーがあります。\n" +
          "trainer は誰でも取れるグローバル権限なので、これは「誰でも書ける」と同義です:\n" +
          offenders.map((o) => `  - ${o}`).join("\n") +
          "\n\n対処:\n" +
          "  そのテナントのデータ … AND tenant_id = public.get_my_tenant_id() を足す\n" +
          "  本人のデータ         … AND auth.uid() = user_id を足す\n" +
          "  全テナント共通のマスタ … 書き込みポリシーを置かない（service_role 専用にする）"
        : undefined,
    ).toEqual([]);
  });

  it("全テナント共通のマスタに書き込みポリシーが無い", () => {
    // 上のテストは「絞られているか」を見るので、書き込みポリシーを1つも持たない
    // 正しい状態も緑になる。ここでは「本当に0件か」を名指しで確認する。
    const SERVICE_ROLE_ONLY = [
      "raid_bosses",
      "raid_reward_items",
      "season_events",
      "season_event_tasks",
      "season_pass_config",
      "season_pass_levels",
      "avatar_customization_items",
      "gym_settings",
    ];
    for (const table of SERVICE_ROLE_ONLY) {
      const writes = policies.filter((p) => p.table === table && isWritePolicy(p));
      expect(
        writes.map((p) => `${p.name} (${p.cmd})`),
        `${table} は全テナント共通のマスタです。書き込みは service_role のみにしてください`,
      ).toEqual([]);
    }
  });

  it("avatars/tenant-logos/ へのアップロードが自分の user_id 始まりに限られている", () => {
    // `foldername[1] = 'tenant-logos' AND has_role(trainer)` だけだと、
    // trainer になれば任意のファイル名で置ける。実際に書くのは Onboarding の
    // `tenant-logos/{user.id}-{timestamp}.{ext}` 1箇所だけ（Onboarding.tsx:115）。
    // オンボーディング時点ではテナントが未作成なので get_my_tenant_id() は使えない。
    const p = policies.find(
      (x) => x.name === "Authenticated avatar uploads scoped to user folder",
    );
    expect(p, "ポリシーを見つけられていない").toBeTruthy();
    expect(p!.body).toMatch(/name LIKE 'tenant-logos\/' \|\| auth\.uid\(\)::text \|\| '-%'/);
  });
});

// ── 穴11（2026-10-31）──────────────────────────────────────────────
// 印（グローバルな trainer ロール）は誰でも取れる。同じジムのお客様が取ると RESTRICTIVE の
// テナント絞りも通るので、PERMISSIVE で印を見た時点で「そのジムの全員」に届く。
// 印の代わりに「そのジムのスタッフか」を見る:
//   tenant_id がある表 … has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])
//   人ごとの表         … is_staff_of_user(user_id)
const STAFF_CHECK_MIGRATION = "20261031040000_staff_checks_tenant_scoped.sql";

/** 印を見てよいのは、ジムを開く前のロゴのアップロードだけ（まだどのジムのスタッフでもない） */
const ALLOWED_GLOBAL_ROLE_POLICIES = ["storage::Authenticated avatar uploads scoped to user folder"];

/**
 * マイグレーションを順に畳み込んで、関数ごとの最後の定義（本文）を返す。DROP FUNCTION で消す。
 * `DROP FUNCTION IF EXISTS a(uuid), b(text);` のまとめ書きもある（20260905020000）。
 */
function latestFunctionBodies(): Map<string, { file: string; body: string; header: string }> {
  const out = new Map<string, { file: string; body: string; header: string }>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = stripSqlComments(readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8"));
    for (const m of sql.matchAll(/DROP FUNCTION\s+(?:IF EXISTS\s+)?([^;]+);/gi)) {
      for (const n of m[1].matchAll(/(?:public\.)?(\w+)\s*\(/g)) out.delete(n[1]);
    }
    for (const m of sql.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)AS\s+\$(\w*)\$([\s\S]*?)\$\3\$/gi,
    )) {
      out.set(m[1], { file, header: m[2], body: m[4] });
    }
  }
  return out;
}

const GLOBAL_ROLE_IN_FUNCTION = /has_role\s*\([^;]{0,60}'trainer'/i;

describe("穴11: 印（グローバルな trainer ロール）でスタッフ扱いしない", () => {
  it("PERMISSIVE のポリシーは、読み取りも含めて印を見ない（開設前のロゴだけ例外）", () => {
    const offenders = policies
      .filter((p) => !p.restrictive && GLOBAL_TRAINER_ROLE.test(p.body))
      .map((p) => `${p.table}::${p.name}`)
      .filter((key) => !ALLOWED_GLOBAL_ROLE_POLICIES.includes(key));
    expect(
      offenders,
      "印（has_role(auth.uid(), 'trainer')）でスタッフ扱いしているポリシーがあります。\n" +
        "同じジムのお客様が印を付けると、そのジムの全員の行に届きます:\n" +
        offenders.map((o) => `  - ${o}`).join("\n") +
        "\n\n対処: tenant_id がある表は has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])、" +
        "人ごとの表は is_staff_of_user(user_id) に差し替える",
    ).toEqual([]);
  });

  it("例外のロゴのアップロードは、自分の user_id で始まる名前だけ（印だけでは置けない）", () => {
    const p = policies.find((x) => `${x.table}::${x.name}` === ALLOWED_GLOBAL_ROLE_POLICIES[0]);
    expect(p, "ポリシーを見つけられていない").toBeTruthy();
    expect(p!.cmd).toBe("INSERT");
    expect(p!.body).toMatch(/'tenant-logos\/' \|\| auth\.uid\(\)::text \|\| '-%'/);
  });

  it("解析器が本番と同じ数だけ差し替えを拾えている（91本＋例外1本）", () => {
    const sql = stripSqlComments(readFileSync(`${MIGRATIONS_DIR}/${STAFF_CHECK_MIGRATION}`, "utf8"));
    const created = [...sql.matchAll(/CREATE POLICY\s+("[^"]+"|\w+)\s+ON\s+(\S+)/g)];
    const dropped = [...sql.matchAll(/DROP POLICY IF EXISTS\s+("[^"]+"|\w+)\s+ON\s+(\S+);/g)];
    expect(created.length).toBe(91);
    expect(dropped.length).toBe(91);
    // 作り直したものは全部、同じ名前で先に消している（名前違いで2本並ぶと、古い方が残って穴が開いたまま）
    const key = (m: RegExpMatchArray) => `${m[2]}::${m[1].replace(/"/g, "")}`;
    expect(new Set(created.map(key))).toEqual(new Set(dropped.map(key)));
    expect(sql).not.toMatch(/has_role\s*\(/);
  });

  it("関数も印で素通りさせない（ジムを開く create_gym_with_owner だけ例外）", () => {
    const fns = latestFunctionBodies();
    expect(fns.size).toBeGreaterThan(100); // 空振り防止
    const offenders = [...fns.entries()]
      .filter(([, f]) => GLOBAL_ROLE_IN_FUNCTION.test(f.body))
      .map(([name, f]) => `${name}（${f.file}）`);
    expect(offenders.map((o) => o.split("（")[0])).toEqual(["create_gym_with_owner"]);
  });

  it("予約の削除・変更の制限（トリガー）と招待コードは、その予約・ジムのスタッフかで見る", () => {
    const fns = latestFunctionBodies();
    for (const name of ["enforce_booking_same_day_delete", "enforce_booking_update_guard"]) {
      const f = fns.get(name);
      expect(f?.file, name).toBe(STAFF_CHECK_MIGRATION);
      expect(f!.body, name).toContain("public.has_tenant_role(OLD.tenant_id, auth.uid(), ARRAY['owner', 'trainer'])");
    }
    const invite = fns.get("get_my_tenant_invite_code");
    expect(invite?.file).toBe(STAFF_CHECK_MIGRATION);
    expect(invite!.body).toContain("public.has_tenant_role(t.id, auth.uid(), ARRAY['owner', 'trainer'])");
  });

  it("廃止したゲーム機能の関数の残り（印で判定していた）を消している", () => {
    const fns = latestFunctionBodies();
    for (const name of ["equip_item", "equip_item_unchecked", "initialize_starter_equipment", "initialize_starter_equipment_for_user"]) {
      expect(fns.has(name), name).toBe(false);
    }
  });

  it("is_staff_of_user: 呼んだ人は有効なスタッフ、相手は在籍の状態を問わない", () => {
    const f = latestFunctionBodies().get("is_staff_of_user");
    expect(f?.file).toBe(STAFF_CHECK_MIGRATION);
    expect(f!.header).toMatch(/SECURITY DEFINER/);
    const body = f!.body.replace(/\s+/g, " ");
    expect(body).toContain("me.user_id = auth.uid()");
    expect(body).toContain("me.status = 'active'");
    expect(body).toContain("me.role IN ('owner', 'trainer')");
    expect(body).toContain("them.user_id = p_user_id");
    // 🔴 相手の status で絞らない。退会したお客様の詳細画面は、user_roles が読めるかでチャット欄を開く
    //    （TrainerClientDetail の isRegistered）。profiles などは RESTRICTIVE が在籍中に絞っている
    expect(body).not.toContain("them.status");
    expect(readFileSync("src/components/trainer/TrainerClientDetail.tsx", "utf8")).toMatch(
      /\.from\("user_roles"\)\s*\.select\("user_id"\)\s*\.eq\("user_id", clientId\)/,
    );
  });

  it("判定の関数は authenticated から呼べる（ポリシーは呼んだ人の権限で評価される。穴8）", () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${STAFF_CHECK_MIGRATION}`, "utf8");
    for (const sig of ["public.is_staff_of_user(uuid)", "public.is_staff_somewhere()"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated, service_role;`);
    }
  });

  it("security/check.sql に検査10（ポリシー）と10-b（関数）がある", () => {
    const kit = readFileSync("security/check.sql", "utf8");
    expect(kit).toContain("検査10: お客様が「trainer の印」を付けると、同じジムの全員のデータが読めないか");
    expect(kit).toContain("検査10-b: 関数の中で「印」を素通りの根拠にしていないか");
    expect(kit.indexOf("検査10")).toBeLessThan(kit.indexOf("-- 検査7: cron の POST 先"));
  });
});
