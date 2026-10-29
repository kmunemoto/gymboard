/**
 * インストラクター（制限付き）はジム共通のマスタ（種目・部位・チャットの定型文）を変えられない（2026-10-29）。
 * `supabase/migrations/20261029030000_limited_staff_master_data.sql`
 *
 * 宗本さん「先生は設定欄を表示させない、触れない様に」。
 *
 * 🔴 壊しやすいもの:
 *   1. 種目の「追加」まで止めて、記録の入力中の「新しい種目を追加」が先生だけ失敗する
 *   2. 定型文の「読み」まで止めて、先生が定型文を使えなくなる
 *   3. オーナーの歯車（定型文の管理）まで消す
 *   4. 後のマイグレーションがポリシーを消す
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import i18n from "@/lib/i18n";
import MessageTemplateChips from "@/components/trainer/MessageTemplateChips";
import type { MessageTemplate } from "@/hooks/useMessageTemplates";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const MIGRATION = "20261029030000_limited_staff_master_data.sql";
const SQL = stripSql(read(`supabase/migrations/${MIGRATION}`));

const policy = (name: string, table: string, cmd: "INSERT" | "UPDATE" | "DELETE") => {
  const clause = cmd === "INSERT" ? "WITH CHECK" : "USING";
  return new RegExp(
    `CREATE POLICY ${name} ON public\\.${table} AS RESTRICTIVE FOR ${cmd} TO authenticated\\s+${clause} \\(NOT public\\.is_limited_staff\\(tenant_id, auth\\.uid\\(\\)\\)\\);`,
  );
};

beforeAll(async () => {
  await i18n.changeLanguage("ja");
});
afterEach(cleanup);

describe("DB: インストラクターはジム共通のマスタを変えられない", () => {
  it("種目は書き換え・削除だけ止める。🔴 追加は止めない（記録の入力中の「新しい種目を追加」）", () => {
    expect(SQL).toMatch(policy("limited_staff_no_update", "exercises", "UPDATE"));
    expect(SQL).toMatch(policy("limited_staff_no_delete", "exercises", "DELETE"));
    expect(SQL).not.toMatch(/ON public\.exercises AS RESTRICTIVE FOR INSERT/);
    // 記録の入力中に種目を足す処理が今もある（ここが消えたら、追加を止めてよいか考え直す）
    expect(read("src/components/trainer/TrainerClientDetail.tsx")).toMatch(/from\("exercises"\)\s*\.insert\(/);
  });

  it.each(["tenant_muscle_groups", "message_templates"])("%s は追加・書き換え・削除を止める", (table) => {
    expect(SQL).toMatch(policy("limited_staff_no_insert", table, "INSERT"));
    expect(SQL).toMatch(policy("limited_staff_no_update", table, "UPDATE"));
    expect(SQL).toMatch(policy("limited_staff_no_delete", table, "DELETE"));
  });

  it("🔴 読みは止めない（先生も定型文・種目を使う）", () => {
    expect(SQL).not.toMatch(/FOR (SELECT|ALL)/);
  });

  it("🔴 後のマイグレーションがこのポリシーを消していない", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    const later = files.filter((f) => f > MIGRATION);
    for (const f of later) {
      const sql = stripSql(read(`supabase/migrations/${f}`));
      for (const table of ["exercises", "tenant_muscle_groups", "message_templates"]) {
        expect(sql, `${f} が ${table} のポリシーを消している`).not.toMatch(
          new RegExp(`DROP POLICY IF EXISTS limited_staff_no_\\w+ ON public\\.${table};(?![\\s\\S]*CREATE POLICY limited_staff_no_\\w+ ON public\\.${table})`),
        );
      }
    }
  });
});

describe("画面: 定型文の歯車（管理）", () => {
  const TEMPLATES = [{ id: "t1", title: "Template-A", body: "Body-A" }] as unknown as MessageTemplate[];

  it("オーナー: 定型文と歯車（管理）が出る", () => {
    const onManage = vi.fn();
    render(<MessageTemplateChips templates={TEMPLATES} onPick={vi.fn()} onManage={onManage} />);
    expect(screen.getByRole("button", { name: "Template-A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("messageTemplates.manageTitle") }));
    expect(onManage).toHaveBeenCalled();
  });

  it("🔴 インストラクター（管理を渡さない）: 定型文は使えるが、歯車は出さない", () => {
    const onPick = vi.fn();
    render(<MessageTemplateChips templates={TEMPLATES} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Template-A" }));
    expect(onPick).toHaveBeenCalledWith(TEMPLATES[0]);
    expect(screen.queryByRole("button", { name: i18n.t("messageTemplates.manageTitle") })).toBeNull();
  });

  it("定型文が無く、管理もできないなら何も出さない（空の行で入力欄を押し上げない）", () => {
    const { container } = render(<MessageTemplateChips templates={[]} onPick={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("メッセージ画面は、インストラクターに管理を渡さない", () => {
    const src = read("src/components/trainer/TrainerMessages.tsx");
    expect(src).toContain("const { isLimitedStaff } = useTenant();");
    expect(src).toContain("onManage={isLimitedStaff ? undefined : () => setTemplateDialogOpen(true)}");
  });
});
