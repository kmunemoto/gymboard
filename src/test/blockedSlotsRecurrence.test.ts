import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// くり返しブロック（毎週×N週の一括ブロック＋まとめて解除）を見張る（2026-08-22）。
//
// 守るべき不変条件:
//   1. 🔴 方式は「毎週×N週ぶんの実体行」（定期予約と同じ）。恒久ルールの表にしない。
//      ブロックの判定は blocked_slots の実体行を読む箇所に散っており（checkSlotBlocked /
//      get_tenant_booked_slots 等）、ルール表だと公開済みの旧クライアントがその帯を
//      「空き」と誤表示して予約を通す（DB にブロックの重なりを拒否するトリガーは無い）
//   2. 🔴 recurrence_group は繰り返しのときだけ積む（未適用のDBに常に積むと
//      PGRST204 で単発ブロックまで作れなくなる。staff_user_id と同じ作法）
//   3. 🔴 まとめて解除は「この日以降」だけ（過去の行は実績として残す）
//   4. 予約が入っている週はスキップして作成し、結果を知らせる

const src = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
const hooks = readFileSync("src/hooks/useBookings.ts", "utf8");
const types = readFileSync("src/integrations/supabase/types.ts", "utf8");

const migrationsDir = "supabase/migrations";
const recurrenceSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"))
  .filter((sql) => /recurrence_group/.test(sql))
  .join("\n")
  .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

describe("DB: blocked_slots.recurrence_group", () => {
  it("列と部分インデックスが定義されている（新テーブルは作らない）", () => {
    expect(recurrenceSql).toMatch(
      /ALTER TABLE public\.blocked_slots\s*\n\s*ADD COLUMN IF NOT EXISTS recurrence_group UUID/,
    );
    expect(recurrenceSql).toMatch(/WHERE recurrence_group IS NOT NULL/);
    // 🔴 恒久ルールの表を作っていない（実体行方式の根拠はファイル冒頭のコメント参照）
    expect(recurrenceSql).not.toMatch(/CREATE TABLE/);
  });
});

describe("一括ブロックの作成", () => {
  it("毎週×N週のセレクタがあり、最大12週（約3ヶ月）まで", () => {
    expect(src).toContain("const [blockRepeatWeeks, setBlockRepeatWeeks] = useState(1)");
    expect(src).toContain("[1, 2, 3, 4, 6, 8, 10, 12].map((n) =>");
  });

  it("🔴 recurrence_group は繰り返しのときだけ行に積む（PGRST204 対策）", () => {
    expect(src).toMatch(/const recurrenceGroup = blockRepeatWeeks > 1 \? crypto\.randomUUID\(\) : null;/);
    expect(src).toMatch(/\.\.\.\(recurrenceGroup \? \{ recurrence_group: recurrenceGroup \} : \{\}\)/);
  });

  it("週ごとに予約との重なりを確認し、重なる週はスキップして日付を知らせる", () => {
    // ループの中で checkSlotBlocked → skippedDates に積む構造
    expect(src).toMatch(
      /for \(let i = 0; i < blockRepeatWeeks; i\+\+\) \{[\s\S]*?checkSlotBlocked\(bookings, dateStr, blockStartTime, blockEndTime[\s\S]*?skippedDates\.push/,
    );
    expect(src).toContain('t("schedule.blockRepeatSkipped", { count: skippedDates.length, dates: skippedDates.join("、") })');
    // 全週スキップなら作成せずエラー表示
    expect(src).toMatch(/if \(rows\.length === 0\) \{\s*\n\s*toast\.error\(t\("schedule\.blockOverlap"\)\)/);
  });

  it("日付は +7日のローカル日付演算（TZずれ無し。定期予約と同じ）", () => {
    expect(src).toContain("new Date(by, bm - 1, bd + i * 7)");
  });
});

describe("まとめて解除", () => {
  it("🔴 同じグループの「この日以降」だけを消す（過去の行は実績として残す）", () => {
    expect(src).toMatch(
      /\.eq\("recurrence_group", target\.recurrenceGroup\)\s*\n\s*\.gte\("blocked_date", `\$\{target\.date\}T00:00:00\+09:00`\)/,
    );
  });

  it("チェックボックスは、くり返しブロックの解除のときだけ出る", () => {
    expect(src).toContain("deleteTarget?.isBlocked && deleteTarget.recurrenceGroup && (");
    // 開くたびに必ず false へ戻す（前回の選択が残ると単発解除のつもりで一括解除される）
    const sites = src.match(/setReleaseSeriesChecked\(false\)/g) ?? [];
    expect(sites.length, "解除ダイアログを開く3箇所すべてでリセットする").toBeGreaterThanOrEqual(3);
  });

  it("解除の対象グループは表示行から引き継ぐ（3つの導線すべて）", () => {
    const passes = src.match(/recurrenceGroup: (b|session|booking)\.recurrenceGroup \?\? null/g) ?? [];
    expect(passes.length).toBe(3);
  });
});

describe("配線", () => {
  it("useBookings がブロック行の recurrence_group を読み出す（未適用DBでは null に倒す）", () => {
    expect(hooks).toMatch(/recurrenceGroup: \(bs as \{ recurrence_group\?: string \| null \}\)\.recurrence_group \?\? null/);
  });

  it("types.ts に recurrence_group が入っている", () => {
    const m = types.match(/blocked_slots: \{[\s\S]*?Relationships/);
    expect(m?.[0]).toContain("recurrence_group: string | null");
  });

  it("5言語すべてに新しいキーがある", () => {
    for (const lang of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const d = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      for (const key of [
        "blockRepeatTitle", "blockRepeatWeeks", "blockRepeatWeeklyDesc", "blockRepeatBtn",
        "blockRepeatResult", "blockRepeatSkipped", "blockSeriesRelease",
        "blockSeriesReleaseDesc", "releasedSeriesToast",
      ]) {
        expect(d.schedule?.[key], `${lang}: schedule.${key}`).toBeTruthy();
      }
    }
  });
});
