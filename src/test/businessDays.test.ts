import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_CLOSE_MINUTES,
  DEFAULT_OPEN_MINUTES,
  blockEndMinutes,
  bookingSlotMinutes,
  businessGridMinutes,
  closedWeekdays,
  envelopeFromDays,
  hasPerDayHours,
  isClosedDate,
  isClosedWeekday,
  resolveBusinessMinutes,
  resolveDayBusinessMinutes,
  weekdayOfDateKey,
  type DayHours,
} from "@/lib/businessHours";

// 曜日別の営業時間・定休日（2026-08-20）。
//
// エアリザーブにあってジムボードに無かったもののうち、いちばん実害が大きかった設定。
// `operating_hours` は既に jsonb なので**列は増やさず**、中身に `days` を足した。
//
// このテストが守る不変条件は3つ:
//   1. 曜日別を使っていない店の挙動が**1ミリも変わらない**（後方互換）
//   2. `start`/`end` は常に「開いている曜日を包む包絡線」である
//      （`days` を知らない古いアプリ版が端末に残るため。ここが狭いと枠が消える）
//   3. 曜日は**JSTの暦日**で決まる（CIはUTCなので、素の getDay() だと1日ズレる）
//
// 変異検証（2026-08-20、7件すべて赤を確認）:
//   - envelopeFromDays の Math.min を Math.max に → 「包絡線」2件が赤
//   - weekdayOfDateKey を new Date(key).getDay() に戻す → 「UTCでもJSTでも同じ」が赤
//   - resolveDayBusinessMinutes の「キーが無い曜日」を null 返しに → 後方互換3件が赤
//   - bookingSlotMinutes の定休日 return [] を消す → 「定休日は枠ゼロ」が赤
//   - 保存側の envelope 代入を消す → 「設定画面が包絡線を書く」が赤

const SLOT_FILES = [
  "src/components/customer/CustomerBooking.tsx",
  "src/components/trainer/TrainerSchedule.tsx",
  "src/pages/TrialBooking.tsx",
  "src/pages/DropInBooking.tsx",
];

/** 月〜金 10:00-21:00 / 土 09:00-23:00 / 日 定休 */
const SAMPLE: Record<string, DayHours | null> = {
  "0": null,
  "1": { start: "10:00", end: "21:00" },
  "2": { start: "10:00", end: "21:00" },
  "3": { start: "10:00", end: "21:00" },
  "4": { start: "10:00", end: "21:00" },
  "5": { start: "10:00", end: "21:00" },
  "6": { start: "09:00", end: "23:00" },
};

describe("weekdayOfDateKey（JSTの暦日で曜日を決める）", () => {
  it("実在の曜日と一致する", () => {
    // 2026-08-20 は木曜（=4）。2026-08-16 は日曜（=0）。
    expect(weekdayOfDateKey("2026-08-20")).toBe(4);
    expect(weekdayOfDateKey("2026-08-16")).toBe(0);
    expect(weekdayOfDateKey("2026-08-22")).toBe(6);
  });

  it("🔴 実行環境のタイムゾーンで答えが変わらない", () => {
    // `new Date("2026-08-20T00:00:00+09:00").getDay()` は UTC 環境だと水曜(3)になる。
    // CI は UTC・端末は JST なので、そこがズレると「CIは緑なのに実機で定休日が1日ずれる」。
    // ここでは TZ を切り替えて同じ答えになることを見る。
    const original = process.env.TZ;
    const answers = new Set<number>();
    for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      answers.add(weekdayOfDateKey("2026-08-20")!);
    }
    process.env.TZ = original;
    expect(answers.size, `タイムゾーンで曜日が変わりました: ${[...answers]}`).toBe(1);
    expect([...answers][0]).toBe(4);
  });

  it("壊れた日付は null", () => {
    for (const bad of ["", "2026-8-20", "20260820", "あ", "2026-13-01", "2026-02-31", null, undefined]) {
      expect(weekdayOfDateKey(bad as string), `${JSON.stringify(bad)} が通った`).toBeNull();
    }
  });
});

describe("🔴 後方互換: 曜日別を使っていない店は今までどおり", () => {
  const plain = { start: "10:00", end: "22:00" };

  it("days が無ければ、どの曜日も同じ営業時間", () => {
    for (let d = 0; d <= 6; d++) {
      expect(resolveDayBusinessMinutes(plain, d)).toEqual({ open: 600, close: 1320 });
      expect(isClosedWeekday(plain, d)).toBe(false);
    }
    expect(hasPerDayHours(plain)).toBe(false);
    expect(closedWeekdays(plain)).toEqual([]);
  });

  it("days が空オブジェクトでも同じ", () => {
    const empty = { ...plain, days: {} };
    expect(hasPerDayHours(empty)).toBe(false);
    for (let d = 0; d <= 6; d++) expect(resolveDayBusinessMinutes(empty, d)).toEqual({ open: 600, close: 1320 });
  });

  it("曜日を渡さない呼び出しは包絡線のまま（週表示の行が狭まらない）", () => {
    const hours = { start: "09:00", end: "23:00", days: SAMPLE };
    expect(resolveDayBusinessMinutes(hours, null)).toEqual({ open: 540, close: 1380 });
    expect(resolveDayBusinessMinutes(hours, undefined)).toEqual({ open: 540, close: 1380 });
    // 曜日を渡さない businessGridMinutes は、どの曜日の枠も収まる幅になる
    const grid = businessGridMinutes(hours);
    expect(grid[0]).toBe(540);
    expect(grid[grid.length - 1]).toBe(1380 - 15);
  });

  it("設定が壊れていても、その曜日は定休日にはならない（店が丸ごと止まらない）", () => {
    const broken = {
      start: "10:00",
      end: "21:00",
      days: { "3": { start: "21:00", end: "10:00" }, "4": { start: "あ", end: "い" } },
    };
    // 逆転・解釈不能はどちらも包絡線に倒す。null（定休日）にはしない。
    expect(resolveDayBusinessMinutes(broken, 3)).toEqual({ open: 600, close: 1260 });
    expect(resolveDayBusinessMinutes(broken, 4)).toEqual({ open: 600, close: 1260 });
    expect(isClosedWeekday(broken, 3)).toBe(false);
  });
});

describe("曜日別の営業時間と定休日", () => {
  const hours = { start: "09:00", end: "23:00", days: SAMPLE };

  it("曜日ごとに違う時間が出る", () => {
    expect(resolveDayBusinessMinutes(hours, 1)).toEqual({ open: 600, close: 1260 }); // 月 10:00-21:00
    expect(resolveDayBusinessMinutes(hours, 6)).toEqual({ open: 540, close: 1380 }); // 土 09:00-23:00
  });

  it("定休日は null（＝その日は何も置けない）", () => {
    expect(resolveDayBusinessMinutes(hours, 0)).toBeNull();
    expect(isClosedWeekday(hours, 0)).toBe(true);
    expect(closedWeekdays(hours)).toEqual([0]);
    expect(hasPerDayHours(hours)).toBe(true);
  });

  it("🔴 定休日は予約枠が1つも出ない", () => {
    expect(bookingSlotMinutes(hours, 60, 0)).toEqual([]);
    expect(businessGridMinutes(hours, 0)).toEqual([]);
    expect(blockEndMinutes(hours, 600, 0)).toEqual([]);
  });

  it("営業している曜日は、その曜日の終業に合わせて枠が伸びる", () => {
    // 月曜（21:00 まで）は最後が 20:00、土曜（23:00 まで）は最後が 22:00。
    const mon = bookingSlotMinutes(hours, 60, 1);
    const sat = bookingSlotMinutes(hours, 60, 6);
    expect(mon[mon.length - 1]).toBe(20 * 60);
    expect(sat[sat.length - 1]).toBe(22 * 60);
    expect(sat[0]).toBe(9 * 60);
    expect(mon[0]).toBe(10 * 60);
  });

  it("isClosedDate は日付キーから定休日を判定する", () => {
    expect(isClosedDate(hours, "2026-08-16")).toBe(true); // 日曜
    expect(isClosedDate(hours, "2026-08-17")).toBe(false); // 月曜
    // 壊れた日付では閉めない（カレンダーが全部グレーアウトするより安全）
    expect(isClosedDate(hours, "あ")).toBe(false);
    expect(isClosedDate(hours, null)).toBe(false);
  });
});

describe("🔴 envelopeFromDays（古いアプリ版が読む start/end）", () => {
  it("開いている曜日を全部包む", () => {
    // 土曜が 09:00-23:00 なので、包絡線は 09:00-23:00 でなければならない。
    // ここが月曜の 10:00-21:00 になると、days を知らない版から土曜の朝夕の枠が消える。
    expect(envelopeFromDays(SAMPLE)).toEqual({ start: "09:00", end: "23:00" });
  });

  it("定休日は包絡線に影響しない", () => {
    const onlySat: Record<string, DayHours | null> = {
      "0": null, "1": null, "2": null, "3": null, "4": null, "5": null,
      "6": { start: "08:00", end: "12:00" },
    };
    expect(envelopeFromDays(onlySat)).toEqual({ start: "08:00", end: "12:00" });
  });

  it("全曜日が定休日／壊れているときは既定値（start > end を書かない）", () => {
    const allClosed: Record<string, DayHours | null> = {
      "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null,
    };
    const expected = {
      start: `${String(Math.floor(DEFAULT_OPEN_MINUTES / 60)).padStart(2, "0")}:00`,
      end: `${String(Math.floor(DEFAULT_CLOSE_MINUTES / 60)).padStart(2, "0")}:00`,
    };
    expect(envelopeFromDays(allClosed)).toEqual(expected);
    expect(envelopeFromDays({ "1": { start: "21:00", end: "10:00" } })).toEqual(expected);
    expect(envelopeFromDays(null)).toEqual(expected);
  });

  it("包絡線をそのまま resolveBusinessMinutes に渡すと、全曜日を含む範囲になる", () => {
    const env = envelopeFromDays(SAMPLE);
    const { open, close } = resolveBusinessMinutes(env);
    for (let d = 0; d <= 6; d++) {
      const day = resolveDayBusinessMinutes({ ...env, days: SAMPLE }, d);
      if (!day) continue;
      expect(day.open, `曜日${d}の開店が包絡線の外`).toBeGreaterThanOrEqual(open);
      expect(day.close, `曜日${d}の閉店が包絡線の外`).toBeLessThanOrEqual(close);
    }
  });
});

describe("🔴 画面が曜日を渡している（渡し忘れると定休日に予約が取れる）", () => {
  it("お客様の予約が曜日つきで枠を作っている", () => {
    const src = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
    expect(src).toMatch(/staffBookingSlotMinutes\(\s*[\s\S]{0,200}?weekday/);
    expect(src, "定休日をカレンダーで塞いでいません").toMatch(/isClosedDate\(businessHours,/);
  });

  it("体験予約・ドロップインが曜日つきで枠を作っている", () => {
    for (const f of ["src/pages/TrialBooking.tsx", "src/pages/DropInBooking.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} が曜日を渡していません`).toMatch(
        /bookingSlotMinutes\(tenant\?\.operating_hours, sessionMinutes, weekdayOfDateKey\(dateKey\)\)/,
      );
      expect(src, `${f} が定休日を塞いでいません`).toMatch(/isClosedDate\(tenant\?\.operating_hours,/);
    }
  });

  it("店側の代理予約が曜日つきで枠を作っている", () => {
    const src = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
    expect(src).toMatch(/staffBookingSlotMinutes\(\s*[\s\S]{0,200}?weekdayOfDateKey\(proxyDateKey\)/);
    expect(src, "代理予約のカレンダーが定休日を塞いでいません").toMatch(/isClosedDate\(tenant\?\.operating_hours,/);
  });

  it("走査対象が実在する（空振りしていない）", () => {
    for (const f of SLOT_FILES) expect(readFileSync(f, "utf8").length).toBeGreaterThan(1000);
  });
});

describe("🔴 設定画面が包絡線を書いている", () => {
  const src = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");

  it("曜日別を保存するとき envelopeFromDays を通す", () => {
    // ここを通さずに businessStart/End をそのまま書くと、days を知らない
    // 古いアプリ版から枠が消える（このファイルで一番壊れやすい点）。
    expect(src).toMatch(/const envelope = envelopeFromDays\(days\);/);
    expect(src).toMatch(/operatingHours = \{ \.\.\.envelope, days \}/);
  });

  it("曜日別を使わない店は days を書かない（保存内容が従来と同じ）", () => {
    expect(src).toMatch(/operatingHours = \{ start: businessStart, end: businessEnd \};/);
  });

  it("全曜日を定休日にはできない", () => {
    expect(src).toMatch(/businessDaysAllClosed/);
  });
});

describe("営業時間の設定が公開ページまで届く", () => {
  it("get_tenant_public は operating_hours を jsonb で丸ごと返す（days も届く）", () => {
    // 列を増やしていないので、曜日別のためのマイグレーションは要らない。
    // 逆に「jsonb ではなく個別の列で返す」形に変えられると days が落ちるので固定する。
    const dir = "supabase/migrations";
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((s) => /FUNCTION public\.get_tenant_public/.test(s))
      .join("\n");
    const last = sql.slice(sql.lastIndexOf("DROP FUNCTION IF EXISTS public.get_tenant_public"));
    expect(last).toMatch(/operating_hours jsonb/);
    expect(last).toMatch(/t\.operating_hours/);
  });
});
