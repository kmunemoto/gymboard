import { readFileSync, readdirSync } from "fs";
import { describe, expect, it } from "vitest";

// 顧客の一括登録（CSV）の見張り。
//
// 取り込むと**その人の auth アカウントが作られる**。素直に
// 「profiles.user_id を NULL 許容にする」でも作れそうに見えるが、本番を実測した結果:
//   1. 顧客一覧の起点は tenant_members（user_id NOT NULL・FK → auth.users）なので
//      アカウントの無い顧客は一覧に1件も出ない
//   2. 予約の BEFORE INSERT トリガ ensure_customer_on_booking が profiles と
//      user_roles に INSERT する。どちらも FK → auth.users なので実体の無い uuid では落ちる
//   3. 人数上限は tenant_members を数えるので、上限が素通りになる
// そのため「裏でアカウントを作る」形にしてある。ここが逆流すると全部再発する。

const MIGRATION = "supabase/migrations/20260825010000_customer_import.sql";
const FUNCTION = "supabase/functions/import-customers/index.ts";

describe("migration の連番", () => {
  it("この migration が最新に含まれている", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain("20260825010000_customer_import.sql");
  });
});

describe("🔴 取り込み RPC が守っていること", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const fn = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.import_customers"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.import_customers"),
  );

  it("SECURITY DEFINER ＋ search_path 固定", () => {
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET search_path TO 'public'/);
  });

  it("🔴 authenticated / anon から実行できない", () => {
    // 呼べると、他人の user_id を自分のテナントに引き込めてしまう
    // （この関数は user_id を引数で受け取り、本人確認をしない）
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.import_customers\(UUID, JSONB\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.import_customers/);
  });

  it("🔴 在籍（tenant_members）を作る", () => {
    // ここが無いと、取り込みは成功するのに顧客一覧に1件も出ない
    expect(fn).toMatch(/INSERT INTO public\.tenant_members/);
    expect(fn).toMatch(/'customer'/);
  });

  it("🔴 profiles に tenant_id を入れる", () => {
    // 空だと書き出しの顧客CSVが空欄になる（2026-08-25 に本番で踏んだ）
    const insert = fn.slice(fn.indexOf("INSERT INTO public.profiles"), fn.indexOf("INSERT INTO public.tenant_members"));
    expect(insert).toContain("tenant_id");
    expect(insert).toContain("_tenant_id");
  });

  it("取り込んだ跡を残す（未招待バッジの根拠）", () => {
    expect(fn).toMatch(/imported_at/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS imported_at timestamptz/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS claimed_at\s+timestamptz/);
  });

  it("user_roles も先に作る（予約時のトリガと同じ行）", () => {
    expect(fn).toMatch(/INSERT INTO public\.user_roles/);
    expect(fn).toMatch(/ON CONFLICT \(user_id, role\) DO NOTHING/);
  });

  it("user_id の無い行を黙って捨てない", () => {
    expect(fn).toMatch(/user_id_required/);
  });
});

describe("🔴 本人が来たことの記録（claim_my_profile）", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.claim_my_profile"));

  it("引数を取らない（他人の行を触れない）", () => {
    expect(fn).toMatch(/claim_my_profile\(\)/);
    expect(fn).toMatch(/auth\.uid\(\)/);
  });

  it("自分の行だけ・取り込まれた行だけを更新する", () => {
    const update = fn.slice(fn.indexOf("UPDATE public.profiles"), fn.indexOf("RETURN FOUND"));
    expect(update).toMatch(/WHERE user_id = v_uid/);
    expect(update).toMatch(/imported_at IS NOT NULL/);
    expect(update).toMatch(/claimed_at IS NULL/);
  });

  it("authenticated から呼べる（anon は不可）", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.claim_my_profile\(\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_my_profile\(\) TO authenticated;/);
  });
});

describe("🔴 Edge Function の権限判定", () => {
  const src = readFileSync(FUNCTION, "utf8");

  it("tenant_members で「そのジムのオーナー」を確かめる", () => {
    expect(src).toContain('.from("tenant_members")');
    expect(src).toContain('.eq("tenant_id", tenantId)');
    expect(src).toContain('.eq("user_id", caller.userId)');
    expect(src).toContain('.eq("role", "owner")');
    expect(src).toContain('.eq("status", "active")');
  });

  it("🔴 グローバルな trainer ロールで判定しない", () => {
    // trainer は自由登録で誰でも取れる。これを根拠にすると他ジムに顧客を作れる。
    // ⚠️ 「なぜ使わないか」の説明でこの語が出るので、行コメントを落としてから検査する
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/hasRole\s*\(/);
  });

  it("呼び出し元の JWT を必ず検証する", () => {
    expect(src).toContain("verifyCaller(req)");
    expect(src).toMatch(/if \(!caller\?\.userId\) return json\(\{ error: "Unauthorized" \}, 401\)/);
  });
});

describe("🔴 途中で失敗したときに幽霊アカウントを残さない", () => {
  const src = readFileSync(FUNCTION, "utf8");

  it("作ったアカウントを覚えていて、失敗時に消す", () => {
    expect(src).toMatch(/const created: string\[\] = \[\]/);
    expect(src).toMatch(/created\.push\(/);
    expect(src).toMatch(/deleteUser\(/);
    // RPC が失敗した経路と、想定外の例外の経路の両方で片付ける
    const cleanups = src.match(/await cleanUp\(admin, created\)/g) ?? [];
    expect(cleanups.length, "片付けの呼び出しが足りない").toBeGreaterThanOrEqual(2);
  });

  it("作るアカウントは配達できないアドレスで、確認メールも送らない", () => {
    expect(src).toMatch(/@gymboard\.invalid/);
    expect(src).toMatch(/email_confirm: false/);
    // 招待メールを送る API をここでは使わない（取り込みでは何も飛ばさない）
    expect(src).not.toMatch(/inviteUserByEmail|generateLink/);
  });
});

describe("送信の分割", () => {
  const src = readFileSync(FUNCTION, "utf8");
  const client = readFileSync("src/lib/gymDataImport.ts", "utf8");

  it("1回の上限が Edge Function とクライアントで揃っている", () => {
    const server = Number(src.match(/const MAX_ROWS = (\d+);/)?.[1]);
    const chunk = Number(client.match(/export const IMPORT_CHUNK = (\d+);/)?.[1]);
    expect(server).toBeGreaterThan(0);
    expect(chunk, "分割の単位が Edge Function の上限を超えている").toBeLessThanOrEqual(server);
  });

  it("上限を超えた送信は弾く", () => {
    expect(src).toMatch(/rows\.length > MAX_ROWS/);
  });
});

describe("🔴 突き合わせの取得を tenant_id で絞らない", () => {
  const src = readFileSync("src/lib/gymDataImport.ts", "utf8");

  it("profiles は在籍行から出た顧客IDで引く", () => {
    // profiles.tenant_id は埋まっていない列（mem/features/data-export-csv.md）。
    // ここで絞ると既存顧客が0件に見え、重複チェックが素通りして顧客が倍になる
    const profileQueries = src.split(/\.from\("profiles"\)/).slice(1);
    expect(profileQueries.length).toBeGreaterThan(0);
    for (const q of profileQueries) {
      expect(q.slice(0, 300), "profiles を tenant_id で絞っている").not.toContain('.eq("tenant_id"');
      expect(q.slice(0, 300)).toContain('.in("user_id"');
    }
  });

  it("退会した顧客も突き合わせの対象にする", () => {
    // 退会した人を取り込み直すと、同じ人のカルテが2つに分かれる
    const members = src.slice(src.indexOf('.from("tenant_members")'), src.indexOf("const ids ="));
    expect(members).not.toContain('.eq("status"');
    expect(members).not.toContain('.in("status"');
  });
});

describe("画面への配線", () => {
  const settings = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");
  const list = readFileSync("src/components/trainer/TrainerClientList.tsx", "utf8");

  it("取り込みがデータのカテゴリーに載っている", () => {
    expect(settings).toContain("TrainerCustomerImport");
    const page = settings.slice(settings.indexOf('settingsView === "dataExport"'));
    expect(page.slice(0, 900)).toContain("<TrainerCustomerImport />");
  });

  it("🔴 データのカテゴリーはオーナー限定のまま", () => {
    // ここが緩むと、スタッフが顧客の連絡先も入金も丸ごと持ち出せる
    expect(settings).toMatch(/\{ key: "dataExport", icon: FileSpreadsheet, enabled: role === "owner" \}/);
  });

  it("未招待の顧客が一覧で見分けられる", () => {
    expect(list).toContain("c.imported_at && !c.claimed_at");
    expect(list).toContain("dataImport.unclaimedBadge");
  });
});
