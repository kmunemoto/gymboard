/**
 * インストラクターも種目を触れるように（2026-11-24）／🔴 記録に使われている種目は消せないように。
 * `supabase/migrations/20261124010000_instructor_exercises_and_keep_workouts.sql`
 *
 * 宗本さん「ジムのオーナーじゃなくて…もう1人のトレーナーさん（マシンピラティス担当）。
 * その立場の人でも種目は触れるように追加して」。
 *
 * 作業中に見つけた不具合: workouts.exercise_id が ON DELETE CASCADE だったので、種目を1つ消すと
 * その種目を使った全員のトレーニング記録が一緒に消えていた（確認には「過去のトレーニング記録には影響しません」）。
 *
 * 🔴 壊しやすいもの:
 *   1. 種目の書き換え・削除を開けたついでに、部位・定型文まで開ける（オーナーだけのまま）
 *   2. 記録に使われている種目を消すと記録ごと消える（RESTRICT に戻す・CASCADE に戻さない）
 *   3. ジムの削除が、記録より先に種目を消して止まる
 *   4. 先生の画面に「部位を編集」を出して、押すと DB に断られる
 *   5. 消せなかったときに「削除に失敗しました」としか出ず、理由が分からない
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import i18n from "@/lib/i18n";

// ── モック ────────────────────────────────────────────────────────────────
const view = { limited: false };
const db = {
  exercises: [
    { id: "ex-1", name: "Ex-A", muscle_group: "Grp-1", category: "Grp-1", default_weight: null, default_reps: null, default_sets: null, notes: null },
  ] as Record<string, unknown>[],
  deleteError: null as { code?: string; message?: string } | null,
  deleted: [] as string[],
};
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/hooks/useTenant", () => ({ useTenant: () => ({ isLimitedStaff: view.limited, tenant: { id: "t1" } }) }));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));
vi.mock("@/lib/tenantMuscleGroups", () => ({
  getTenantMuscleGroups: () => [{ id: "g1", name: "Grp-1", sort_order: 0 }],
  loadTenantMuscleGroups: () => Promise.resolve([]),
  subscribeTenantMuscleGroups: () => () => {},
}));
vi.mock("@/lib/muscleGroup", () => ({ loadMuscleGroupMap: () => Promise.resolve() }));
vi.mock("@/components/trainer/TrainerMuscleGroupManager", () => ({
  default: () => <div data-testid="muscle-group-manager" />,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "exercises") throw new Error(`unexpected table ${table}`);
      const list = { order: () => list, then: (r: (v: unknown) => unknown) => r({ data: db.exercises, error: null }) };
      return {
        select: () => list,
        delete: () => ({
          eq: (_col: string, id: string) => {
            if (!db.deleteError) db.deleted.push(id);
            return Promise.resolve({ error: db.deleteError });
          },
        }),
      };
    },
  },
}));

import TrainerExerciseManager from "@/components/trainer/TrainerExerciseManager";

beforeAll(async () => {
  await i18n.changeLanguage("ja");
});
beforeEach(() => {
  view.limited = false;
  db.deleteError = null;
  db.deleted = [];
  toastError.mockClear();
  toastSuccess.mockClear();
});
afterEach(cleanup);

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const MIGRATION = "20261124010000_instructor_exercises_and_keep_workouts.sql";
const SQL = stripSql(read(`supabase/migrations/${MIGRATION}`));
const laterMigrations = () =>
  readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql") && f > MIGRATION).sort();

// ── DB ──────────────────────────────────────────────────────────────────

describe("🔴 DB: 先生も種目を書き換え・削除できる。部位・定型文はオーナーだけのまま", () => {
  it("exercises の先生向けの RESTRICTIVE（書き換え・削除）を外す", () => {
    expect(SQL).toMatch(/DROP POLICY IF EXISTS limited_staff_no_update ON public\.exercises;/);
    expect(SQL).toMatch(/DROP POLICY IF EXISTS limited_staff_no_delete ON public\.exercises;/);
    expect(SQL).not.toMatch(/CREATE POLICY[^;]*ON public\.exercises/);
  });

  it("部位（tenant_muscle_groups）・定型文（message_templates）には触れない", () => {
    expect(SQL).not.toMatch(/tenant_muscle_groups/);
    expect(SQL).not.toMatch(/message_templates/);
  });
});

describe("🔴 DB: 記録に使われている種目は消せない（消すと記録ごと消えていた）", () => {
  it("workouts.exercise_id を ON DELETE RESTRICT に付け直す（NOT VALID のあと VALIDATE）", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.workouts DROP CONSTRAINT IF EXISTS workouts_exercise_id_fkey;/);
    expect(SQL).toMatch(
      /ADD CONSTRAINT workouts_exercise_id_fkey\s+FOREIGN KEY \(exercise_id\) REFERENCES public\.exercises\(id\) ON DELETE RESTRICT NOT VALID;/,
    );
    expect(SQL).toMatch(/ALTER TABLE public\.workouts VALIDATE CONSTRAINT workouts_exercise_id_fkey;/);
    expect(SQL).not.toMatch(/CASCADE/);
  });

  it("🔴 後のマイグレーションが CASCADE に戻していない", () => {
    for (const f of laterMigrations()) {
      const sql = stripSql(read(`supabase/migrations/${f}`));
      expect(sql, f).not.toMatch(/workouts[\s\S]{0,200}REFERENCES public\.exercises\(id\) ON DELETE CASCADE/);
    }
  });

  it("ジムの削除（delete_my_gym の今の定義）は記録を種目より先に消す＝RESTRICT でも止まらない", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    const latest = files.filter((f) => /CREATE OR REPLACE FUNCTION public\.delete_my_gym/.test(read(`supabase/migrations/${f}`))).pop()!;
    const sql = stripSql(read(`supabase/migrations/${latest}`));
    const workouts = sql.indexOf("DELETE FROM public.workouts");
    const exercises = sql.indexOf("DELETE FROM public.exercises");
    expect(workouts, latest).toBeGreaterThan(-1);
    expect(exercises, latest).toBeGreaterThan(workouts);
  });
});

// ── 画面 ────────────────────────────────────────────────────────────────

const editMuscleGroupsBtn = () => screen.queryByRole("button", { name: i18n.t("muscleGroupManage.editBtn") });

describe("🔴 種目管理の画面", () => {
  it("オーナー: 「部位を編集」と部位の管理が出る", async () => {
    render(<TrainerExerciseManager />);
    await screen.findByText("Ex-A");
    expect(editMuscleGroupsBtn()).toBeInTheDocument();
    expect(screen.getByTestId("muscle-group-manager")).toBeInTheDocument();
  });

  it("先生: 種目は使える（追加・編集・削除のボタン）が、「部位を編集」と部位の管理は出さない", async () => {
    view.limited = true;
    render(<TrainerExerciseManager />);
    await screen.findByText("Ex-A");
    expect(screen.getByRole("button", { name: i18n.t("exercise.editAria") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("exercise.deleteAria") })).toBeInTheDocument();
    expect(editMuscleGroupsBtn()).toBeNull();
    expect(screen.queryByTestId("muscle-group-manager")).toBeNull();
  });

  const deleteEx = async () => {
    render(<TrainerExerciseManager />);
    await screen.findByText("Ex-A");
    fireEvent.click(screen.getByRole("button", { name: i18n.t("exercise.deleteAria") }));
    // 確認の「削除」（ダイアログの中の2つ目のボタン）
    const confirm = screen.getAllByRole("button", { name: i18n.t("common.delete") }).pop()!;
    fireEvent.click(confirm);
  };

  it("🔴 記録に使われている種目（23503）: 理由の分かるメッセージを出し、一覧から消さない", async () => {
    db.deleteError = { code: "23503", message: "violates foreign key constraint" };
    await deleteEx();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(i18n.t("exercise.deleteInUse", { name: "Ex-A" })));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText("Ex-A")).toBeInTheDocument();
  });

  it("ほかの失敗は今まで通り「削除に失敗しました」", async () => {
    db.deleteError = { code: "42501", message: "permission denied" };
    await deleteEx();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(i18n.t("exercise.deleteFailed")));
  });

  it("記録に使われていない種目は今まで通り消せる", async () => {
    await deleteEx();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(i18n.t("exercise.deletedToast", { name: "Ex-A" })));
    expect(db.deleted).toEqual(["ex-1"]);
    expect(screen.queryByText("Ex-A")).toBeNull();
  });
});

describe("文言（5言語）", () => {
  const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"];
  it.each(LOCALES)("%s: 消せないときのメッセージに種目名が入る", (lng) => {
    const d = JSON.parse(read(`src/locales/${lng}.json`));
    expect(d.exercise.deleteInUse).toContain("{{name}}");
  });

  it("🔴 確認の文が「記録には影響しません」と言わない（記録に使われている種目は消せない、が正しい）", () => {
    const ja = JSON.parse(read("src/locales/ja.json"));
    expect(ja.exercise.deleteSubDesc).not.toMatch(/影響しません/);
    expect(ja.exercise.deleteSubDesc).toBe(i18n.t("exercise.deleteSubDesc"));
  });
});
