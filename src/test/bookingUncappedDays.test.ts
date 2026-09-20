import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ────────────────────────────────────────────────────────────────
// その日だけ「1日の上限人数」を適用しない（2026-09-20 宗本さんの要望）
//
// > ベースは1日4人。特定の日はそのルールを適応しない様にしたい。
// > 日にちを2回目のタップを押したらルールを外せるとかの仕様を追加してほしい。
//
// 決定: 予定表のオレンジ「上限に達しました」をタップ → その日だけ上限なし。
//       もう一度タップで戻る。外した日は**無制限**。
//
// 🔴 静かに壊れるのが2つある。
//
//   1. **順番。** 手で止めた日より先に「上限なし」を見てしまうと、
//      店が「今日はもう受けない」と決めた日が**勝手に開く**。
//   2. **範囲。** 上限以外（営業時間・締切・同時受入数・時間ブロック・シフト・
//      プラン上限）まで外すと、物理的に入らない枠まで売ってしまう。
// ────────────────────────────────────────────────────────────────

const readSql = (p: string) =>
  readFileSync(p, "utf8").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

const stripJs = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const read = (p: string) => stripJs(readFileSync(p, "utf8"));

const MIGRATION = "supabase/migrations/20260920010000_booking_uncapped_days.sql";
const TOGGLE = "src/components/trainer/DayReceptionToggle.tsx";
const HOOK = "src/hooks/useDayReception.ts";
const sql = readSql(MIGRATION);

describe("🔴 手で止めた日のほうが強い（順番）", () => {
  it("tenant_day_closed が手動を先に見てから上限なしを見る", () => {
    // 逆にすると「今日はもう受けない」と決めた日が上限なしの指定で勝手に開く
    const manual = sql.indexOf("FROM public.booking_closed_days d");
    const uncapped = sql.indexOf("FROM public.booking_uncapped_days u");
    expect(manual).toBeGreaterThan(-1);
    expect(uncapped).toBeGreaterThan(-1);
    expect(manual).toBeLessThan(uncapped);
  });

  it("手動の分岐は true を返して即抜けている", () => {
    expect(sql).toMatch(/booking_closed_days d[\s\S]{0,140}RETURN true;/);
  });

  it("上限なしの分岐は false を返して件数を数えない", () => {
    expect(sql).toMatch(/booking_uncapped_days u[\s\S]{0,140}RETURN false;/);
  });

  it("画面側も手で閉めた日を先に見ている", () => {
    const code = read(TOGGLE);
    const closed = code.indexOf("if (closed && !closed.manual)");
    const uncapped = code.indexOf("if (uncapped)");
    expect(closed).toBeGreaterThan(-1);
    expect(uncapped).toBeGreaterThan(closed);
  });
});

describe("🔴 外すのは1日の上限だけ", () => {
  it("件数の数え方を変えていない", () => {
    // tenant_day_booking_count を書き換えると「n/4人」の表示までずれる
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION public.tenant_day_booking_count");
  });

  it("他のガードに触れていない", () => {
    for (const fn of [
      "guard_booking_blocked_window", "guard_booking_frequency_limit",
      "guard_booking_plan_limit", "guard_booking_staff_shift", "check_booking_overlap",
    ]) {
      expect(sql, fn).not.toContain(`FUNCTION public.${fn}`);
    }
  });

  it("公開RPC は手で閉めた日をそのまま返す（上限なしは上限にしか効かない）", () => {
    // ここで manual まで外すと、店が閉めた日がお客様に開いて見える
    expect(sql).toMatch(/WHERE m\.day IS NOT NULL\s*\n\s*OR \(v_limit IS NOT NULL AND COALESCE\(tt\.n, 0\) >= v_limit AND u\.day IS NULL\)/);
  });
});

describe("テーブルと RLS", () => {
  it("同じ日を二重に登録できない（連打しても行が増えない）", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS booking_uncapped_days_tenant_date\s*\n\s*ON public\.booking_uncapped_days\(tenant_id, uncapped_date\)/);
  });

  it("日付は date で持つ（timestamptz にしない）", () => {
    expect(sql).toMatch(/uncapped_date date NOT NULL/);
  });

  it("🔴 テナント境界が RESTRICTIVE で掛かっている", () => {
    expect(sql).toMatch(/CREATE POLICY tenant_isolation ON public\.booking_uncapped_days AS RESTRICTIVE/);
  });

  it("🔴 読み書きはジム側だけ（お客様には見せない）", () => {
    for (const op of ["select", "write", "delete"]) {
      expect(sql, op).toMatch(new RegExp(`booking_uncapped_days_${op}[\\s\\S]{0,200}has_role\\(auth\\.uid\\(\\), 'trainer'::app_role\\)`));
    }
  });
});

describe("予定表の操作", () => {
  it("🔴 オレンジが押せるようになっている", () => {
    const code = read(TOGGLE);
    expect(code).toMatch(/if \(closed && !closed\.manual\)[\s\S]{0,400}onClick=\{\(\) => onLiftCap\(dateKey\)\}/);
  });

  it("「上限なし」を押すと戻せる（詰まない）", () => {
    expect(read(TOGGLE)).toMatch(/if \(uncapped\)[\s\S]{0,400}onClick=\{\(\) => onRestoreCap\(dateKey\)\}/);
  });

  it("🔴 外したあと閉店日の一覧も取り直している", () => {
    // 取り直さないと、外したのにオレンジのままに見える
    const code = read(HOOK);
    expect(code).toMatch(/liftCap[\s\S]{0,400}Promise\.all\(\[refetchUncapped\(\), refetch\(\)\]\)/);
    expect(code).toMatch(/restoreCap[\s\S]{0,400}Promise\.all\(\[refetchUncapped\(\), refetch\(\)\]\)/);
  });

  it("読めなかったら上限は効いたまま（安全側）", () => {
    const code = read("src/hooks/useBookingClosedDays.ts");
    expect(code).toMatch(/setUncappedDays\(error \|\| !data \? \[\] : data\.map/);
  });

  for (const lng of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
    it(`${lng}: 文言がそろっている`, () => {
      const d = JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8")).closedDays;
      for (const k of [
        "uncapped", "uncappedHelp", "uncapAria", "recapAria",
        "uncappedToast", "recappedToast", "uncapFailed", "recapFailed",
      ]) {
        expect(typeof d[k], `${lng}.${k}`).toBe("string");
        expect(d[k].length, `${lng}.${k}`).toBeGreaterThan(0);
      }
    });
  }
});
