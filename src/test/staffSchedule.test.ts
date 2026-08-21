import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SHIFT_WEEKDAY_ORDER,
  hasStaffShift,
  isStaffOffShiftError,
  staffBookingSlotMinutes,
  staffDayMinutes,
  staffWorksOnWeekday,
  type StaffScheduleRow,
} from "@/lib/staffSchedule";

// スタッフ別の受付可否（シフト）。
//
// 担当の指名（bookings.staff_user_id、2026-08-04）は入っていたのに、
// **「そのスタッフがいつ働いているか」が無かった**ので、火・木しか出ていない
// トレーナーでも月曜の枠に指名予約が入っていた。
//
// このテストが守る不変条件:
//   1. 🔴 **行が0件のスタッフは営業時間どおり**（既存スタッフには当然0件なので、
//      ここを間違えると適用した瞬間に全店の指名予約が取れなくなる）
//   2. 行があるスタッフは、書いてある曜日だけ働く
//   3. 店の営業時間との**積集合**が実際に取れる範囲（どちらか一方だけでは決まらない）
//   4. クライアントの規則と DB トリガーの規則が一致している
//
// 変異検証（2026-08-20、7件すべて赤を確認）:
//   - hasStaffShift の判定を反転 → 後方互換2件が赤
//   - 積集合の Math.max/Math.min を入れ替え → 「積集合」2件が赤
//   - 「行はあるがこの曜日が無い」を store 返しに → 「休みの曜日は取れない」が赤
//   - 定休日チェック（store が null）を外す → 「定休日は誰も受けられない」が赤
//   - GB002 を GB001 に変える → 「SQLSTATE が別」が赤
//   - DB トリガーの has_shift 早期 return を消す → 「DBも同じ規則」が赤

const HOURS = { start: "10:00", end: "21:00" };
const STAFF = "staff-1";
const OTHER = "staff-2";

/** 火(2)・木(4) 12:00-18:00 のシフト */
const SHIFT: StaffScheduleRow[] = [
  { user_id: STAFF, weekday: 2, start_time: "12:00", end_time: "18:00" },
  { user_id: STAFF, weekday: 4, start_time: "12:00", end_time: "18:00" },
];

describe("🔴 後方互換: 行が1件も無いスタッフは営業時間どおり", () => {
  it("シフト未設定なら、どの曜日も店の営業時間がそのまま出る", () => {
    // ここが「行が無い＝働けない」になると、**適用した瞬間に全店の指名予約が止まる**。
    for (let d = 0; d <= 6; d++) {
      expect(staffDayMinutes(HOURS, d, [], STAFF)).toEqual({ open: 600, close: 1260 });
      expect(staffWorksOnWeekday(HOURS, d, [], STAFF)).toBe(true);
    }
    expect(hasStaffShift([], STAFF)).toBe(false);
    expect(hasStaffShift(null, STAFF)).toBe(false);
  });

  it("他人のシフトがあっても、自分に行が無ければ営業時間どおり", () => {
    expect(hasStaffShift(SHIFT, OTHER)).toBe(false);
    expect(staffDayMinutes(HOURS, 1, SHIFT, OTHER)).toEqual({ open: 600, close: 1260 });
    expect(staffWorksOnWeekday(HOURS, 1, SHIFT, OTHER)).toBe(true);
  });

  it("指名なし（null）はシフトの制約を受けない", () => {
    expect(staffDayMinutes(HOURS, 1, SHIFT, null)).toEqual({ open: 600, close: 1260 });
    expect(staffWorksOnWeekday(HOURS, 1, SHIFT, null)).toBe(true);
    expect(staffWorksOnWeekday(HOURS, 1, SHIFT, undefined)).toBe(true);
  });

  it("行が全部壊れていても店を止めない（営業時間に倒す）", () => {
    const broken: StaffScheduleRow[] = [
      { user_id: STAFF, weekday: 1, start_time: "あ", end_time: "い" },
    ];
    expect(staffDayMinutes(HOURS, 1, broken, STAFF)).toEqual({ open: 600, close: 1260 });
  });
});

describe("シフトを設定したスタッフ", () => {
  it("書いてある曜日は、その時間だけ取れる", () => {
    expect(hasStaffShift(SHIFT, STAFF)).toBe(true);
    expect(staffDayMinutes(HOURS, 2, SHIFT, STAFF)).toEqual({ open: 720, close: 1080 });
    expect(staffDayMinutes(HOURS, 4, SHIFT, STAFF)).toEqual({ open: 720, close: 1080 });
  });

  it("🔴 書いていない曜日は休み", () => {
    for (const d of [0, 1, 3, 5, 6]) {
      expect(staffDayMinutes(HOURS, d, SHIFT, STAFF), `曜日${d}が休みになっていません`).toBeNull();
      expect(staffWorksOnWeekday(HOURS, d, SHIFT, STAFF)).toBe(false);
    }
  });

  it("🔴 店の営業時間との積集合になる（どちらか一方では決まらない）", () => {
    // スタッフが 08:00-23:00 と書いても、店が 10:00-21:00 ならそこまで。
    const wide: StaffScheduleRow[] = [{ user_id: STAFF, weekday: 1, start_time: "08:00", end_time: "23:00" }];
    expect(staffDayMinutes(HOURS, 1, wide, STAFF)).toEqual({ open: 600, close: 1260 });

    // 逆に、店が広くてもスタッフが狭ければスタッフに合わせる。
    const narrow: StaffScheduleRow[] = [{ user_id: STAFF, weekday: 1, start_time: "13:00", end_time: "15:00" }];
    expect(staffDayMinutes({ start: "09:00", end: "23:00" }, 1, narrow, STAFF)).toEqual({ open: 780, close: 900 });
  });

  it("重ならなければ、その日は取れない", () => {
    const early: StaffScheduleRow[] = [{ user_id: STAFF, weekday: 1, start_time: "06:00", end_time: "09:00" }];
    expect(staffDayMinutes(HOURS, 1, early, STAFF)).toBeNull();
  });

  it("🔴 店の定休日はシフトに関係なく取れない", () => {
    const closedSunday = { ...HOURS, days: { "0": null } };
    expect(staffDayMinutes(closedSunday, 0, SHIFT, STAFF)).toBeNull();
    // 指名なしでも取れない（店が閉まっているので当然）
    expect(staffDayMinutes(closedSunday, 0, SHIFT, null)).toBeNull();
    expect(staffDayMinutes(closedSunday, 0, [], STAFF)).toBeNull();
  });

  it("曜日が決まっていない場面では狭めない（包絡線のまま）", () => {
    // 週表示の行のように「日付が1つに決まっていない」場所でシフトを掛けると、
    // 他の曜日の枠が描けなくなる。
    expect(staffDayMinutes(HOURS, null, SHIFT, STAFF)).toEqual({ open: 600, close: 1260 });
  });

  it("同じ曜日に複数行があれば、いちばん広い範囲を採る", () => {
    const split: StaffScheduleRow[] = [
      { user_id: STAFF, weekday: 1, start_time: "10:00", end_time: "12:00" },
      { user_id: STAFF, weekday: 1, start_time: "15:00", end_time: "19:00" },
    ];
    expect(staffDayMinutes(HOURS, 1, split, STAFF)).toEqual({ open: 600, close: 1140 });
  });
});

describe("staffBookingSlotMinutes（枠の並び）", () => {
  it("シフトの中だけに枠が出る", () => {
    const slots = staffBookingSlotMinutes(HOURS, 60, 2, SHIFT, STAFF);
    expect(slots[0]).toBe(12 * 60);
    expect(slots[slots.length - 1]).toBe(17 * 60); // 17:00開始で18:00終わり
  });

  it("休みの曜日は枠ゼロ", () => {
    expect(staffBookingSlotMinutes(HOURS, 60, 1, SHIFT, STAFF)).toEqual([]);
  });

  it("シフト未設定・指名なしなら、店の営業時間そのもの", () => {
    const unset = staffBookingSlotMinutes(HOURS, 60, 1, [], STAFF);
    const anyone = staffBookingSlotMinutes(HOURS, 60, 1, SHIFT, null);
    expect(unset[0]).toBe(600);
    expect(unset[unset.length - 1]).toBe(1260 - 60);
    expect(anyone).toEqual(unset);
  });
});

describe("エラーの見分け", () => {
  it("🔴 シフト外(GB002)は満枠(GB001)と別物として扱う", () => {
    // お客様への案内が変わる（満枠＝別の時間 / シフト外＝別の担当か別の曜日）。
    expect(isStaffOffShiftError({ code: "GB002" })).toBe(true);
    expect(isStaffOffShiftError({ code: "GB001" })).toBe(false);
    expect(isStaffOffShiftError({ message: "この担当者はその時間帯のシフトに入っていません" })).toBe(false);
    expect(isStaffOffShiftError(null)).toBe(false);
    expect(isStaffOffShiftError("GB002")).toBe(false);
  });
});

describe("週の並び", () => {
  it("月曜始まりで7日ぶんある", () => {
    expect([...SHIFT_WEEKDAY_ORDER]).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe("🔴 DB 側の規則がクライアントと一致している", () => {
  const dir = "supabase/migrations";
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .filter((s) => /staff_schedules/.test(s))
    .join("\n")
    // SQL コメントを落として、説明文でのマッチを避ける
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("マイグレーションが実在する（空振りしていない）", () => {
    expect(sql.length).toBeGreaterThan(500);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.staff_schedules/);
  });

  it("シフトが0件のスタッフはトリガーが素通しする（後方互換の要）", () => {
    // ここが無いと、適用した瞬間に既存の指名予約が全部 GB002 で落ちる。
    expect(sql).toMatch(/SELECT EXISTS \(\s*SELECT 1 FROM public\.staff_schedules[\s\S]{0,200}?\) INTO v_has_shift/);
    expect(sql).toMatch(/IF NOT v_has_shift THEN\s*RETURN NEW;/);
  });

  it("指名なしはトリガーが素通しする", () => {
    expect(sql).toMatch(/IF v_staff IS NULL THEN\s*RETURN NEW;/);
  });

  it("曜日は JST の暦日で数える", () => {
    // timestamptz をそのまま extract(dow) すると UTC の曜日になり、23:00 の予約が前日扱いになる。
    expect(sql).toMatch(/AT TIME ZONE 'Asia\/Tokyo'/);
    expect(sql).toMatch(/EXTRACT\(DOW FROM v_jst\)/);
  });

  it("拒否は GB002（満枠の GB001 と混ぜない）", () => {
    expect(sql).toMatch(/USING ERRCODE = 'GB002'/);
  });

  it("テナント境界が RESTRICTIVE で張られている", () => {
    expect(sql).toMatch(/CREATE POLICY tenant_isolation ON public\.staff_schedules AS RESTRICTIVE/);
    expect(sql).toMatch(/REVOKE ALL ON public\.staff_schedules FROM anon/);
  });

  it("書けるのは店側だけ（お客様が自分のシフトを作れない）", () => {
    expect(sql).toMatch(/CREATE POLICY staff_schedules_write[\s\S]{0,200}?has_tenant_role\(tenant_id, auth\.uid\(\), ARRAY\['owner','trainer'\]\)/);
  });

  it("🔴 終了に 24:00 を許す（24時間営業の「20:00〜24:00 のスタッフ」）", () => {
    // 営業時間の選択肢を1日の全域に広げたとき、シフトだけ 23:30 のまま
    // 取り残されていた（2026-08-21 に是正）。営業時間で選べる終業が
    // シフトで選べないのは単純に不整合。
    const endCheck = /end_time ~ '([^']+)'/.exec(sql);
    expect(endCheck, "end_time の CHECK が見つかりません").toBeTruthy();
    expect(endCheck![1], "終了に 24:00 を許していません").toContain("24:00");

    // 実際に正規表現として評価して、通す値・弾く値を確かめる
    // （文字列に "24:00" が含まれるだけの検査だと、書き方を変えたときに素通りする）
    const re = new RegExp(endCheck![1]);
    for (const ok of ["24:00", "23:30", "00:30", "09:00"]) {
      expect(re.test(ok), `${ok} が弾かれました`).toBe(true);
    }
    for (const ng of ["24:30", "25:00", "24:01", "2400", "あ"]) {
      expect(re.test(ng), `${ng} が通ってしまいました`).toBe(false);
    }
  });

  it("開始側には 24:00 を許さない（出勤開始が 24:00 の人は居ない）", () => {
    const startCheck = /start_time ~ '([^']+)'/.exec(sql);
    expect(startCheck).toBeTruthy();
    expect(new RegExp(startCheck![1]).test("24:00"), "開始に 24:00 が入ります").toBe(false);
  });

  it("1人1曜日1行（UNIQUE）で、終わりが始まりより後", () => {
    expect(sql).toMatch(/UNIQUE \(tenant_id, user_id, weekday\)/);
    expect(sql).toMatch(/CHECK \(end_time > start_time\)/);
  });

  it("ジムを閉じるときに消える", () => {
    const all = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    expect(all).toMatch(/DELETE FROM public\.staff_schedules\s+WHERE tenant_id = v_tenant_id/);
  });

  it("types.ts に載っている", () => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    expect(types).toMatch(/\n {6}staff_schedules: \{/);
  });
});

describe("🔴 画面が担当のシフトを見ている", () => {
  it("お客様の予約が、指名した担当のシフトで枠を絞る", () => {
    const src = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
    expect(src).toMatch(/staffBookingSlotMinutes\(/);
    expect(src).toMatch(/staffWorksOnWeekday\(/);
    // シフト外は満枠と別の文言で案内する
    expect(src).toMatch(/isStaffOffShiftError\(error\)/);
  });

  it("店側の代理予約も同じ判定をしている", () => {
    const src = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
    expect(src).toMatch(/staffBookingSlotMinutes\(/);
    expect(src).toMatch(/staffWorksOnWeekday\(/);
    expect(src).toMatch(/isStaffOffShiftError\(error\)/);
  });

  it("設定画面の選択肢が営業時間と同じ範囲になっている", () => {
    // 開始 00:00〜23:30（48個）／終了 00:30〜24:00（48個）。
    // ここだけ狭いままだと、営業時間で選べる終業がシフトで選べない。
    const src = readFileSync("src/components/trainer/TrainerStaffSchedule.tsx", "utf8");
    expect(src).toMatch(/SHIFT_START_OPTIONS = Array\.from\(\{ length: 48 \}, \(_, i\) => shiftTime\(i\)\)/);
    expect(src).toMatch(/SHIFT_END_OPTIONS = Array\.from\(\{ length: 48 \}, \(_, i\) => shiftTime\(i \+ 1\)\)/);
    // 開始と終了で同じ配列を使い回していないこと（終了だけ 24:00 まで伸びる）
    expect(src, "開始と終了が同じ配列のままです").not.toMatch(/\{TIME_OPTIONS\.map/);
  });

  it("シフトが読めないときは空配列＝営業時間どおりに倒す", () => {
    const hook = readFileSync("src/hooks/useStaffSchedules.ts", "utf8");
    expect(hook).toMatch(/if \(error \|\| !data\) \{[\s\S]{0,200}?setSchedules\(\[\]\)/);
  });
});
