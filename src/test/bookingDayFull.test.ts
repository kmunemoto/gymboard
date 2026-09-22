import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isDayFullyBooked } from "@/lib/bookingDayFull";
import { bookedSlotsOnDate, groupBookedSlotsByDate, toBookedSlots } from "@/lib/bookedSlots";
import { isFootprintBlocked } from "@/lib/bookingOptionFit";
import { staffBookingSlotMinutes } from "@/lib/staffSchedule";
import { sessionFootprintMinutes } from "@/lib/bookingOptions";
import { weekdayOfDateKey } from "@/lib/businessHours";

// ────────────────────────────────────────────────────────────────
// 満枠の日をカレンダーで押せなくする（2026-09-20 宗本さんの要望）
//
// > 撮れる枠が無くなった日にちは薄くして、他みたいにそもそもその日は押せない仕様にして。
// > また枠が空いたら予約が取れる様に数字を黒くして日にちを押せる様にして。
//
// 🔴 この機能で壊しやすいものが2つある。どちらも**画面が静かに使えなくなる**。
//
//   1. 締切を「取れない」に数えると、**当日が押せなくなる**。
//      2026-09-05 に入れた「上限で埋まった当日の空き状況を、その日に予約している
//      人にだけ見せる」が消える（当日は締切済みなので全枠が締切扱いになるため）。
//   2. プランの残り回数を数えると、回数を使い切った人は**カレンダーが全部灰色**になり、
//      空き状況すら見られなくなる。これは日付ではなく「その人」の事情。
// ────────────────────────────────────────────────────────────────

const stripJs = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const CUSTOMER = "src/components/customer/CustomerBooking.tsx";
const code = stripJs(readFileSync(CUSTOMER, "utf8"));

describe("その日が1枠も取れないか", () => {
  const starts = [600, 615, 630];

  it("全部埋まっていれば満枠", () => {
    expect(isDayFullyBooked(starts, () => true)).toBe(true);
  });

  it("🔴 1枠でも空いていれば満枠ではない（空いたら押せる日に戻る）", () => {
    expect(isDayFullyBooked(starts, (m) => m !== 630)).toBe(false);
    expect(isDayFullyBooked(starts, (m) => m !== 600)).toBe(false);
  });

  it("枠が0の日は満枠と見なさない（定休日は別の判定で塞がっている）", () => {
    // ここで true にすると「なぜ押せないか」の理由が二重になり、文言を誤る
    expect(isDayFullyBooked([], () => true)).toBe(false);
    expect(isDayFullyBooked(null, () => true)).toBe(false);
    expect(isDayFullyBooked(undefined, () => true)).toBe(false);
  });

  it("判定は渡された関数だけで決まる（条件を写していない）", () => {
    const seen: number[] = [];
    isDayFullyBooked(starts, (m) => { seen.push(m); return true; });
    expect(seen).toEqual(starts);
  });
});

describe("🔴 カレンダー側の組み込み", () => {
  it("満枠の日を選べなくしている", () => {
    // 2026-09-22 に「その日を選べるか」の規則ごと src/lib/bookingCalendarDay.ts へ移した。
    // CustomerBooking は判定関数を材料として渡すだけになっている。
    expect(code).toContain("isDayFull,");
    expect(code).toContain("isDayUnselectable(format(date, \"yyyy-MM-dd\"), calendarDayRules)");
    expect(stripJs(readFileSync("src/lib/bookingCalendarDay.ts", "utf8")))
      .toMatch(/if \(r\.isDayFull\(dateKey\)\) return true;/);
  });

  it("🔴 当日は対象外（空き状況を見せる仕様を壊さない）", () => {
    expect(code).toMatch(/d !== getJSTToday\(\) && isDayFullyBooked\(/);
  });

  it("🔴 締切とプラン上限を「取れない」に数えていない", () => {
    // isDayFull の本体だけを切り出して見る。ファイル全体だと枠一覧側の
    // isSlotPastCutoff / isSlotOverLimit に当たって必ず空振りする
    const m = /const isDayFull = \(d: string\): boolean =>([\s\S]*?\n\s*\);)/.exec(code);
    expect(m, "isDayFull の定義が読めない").not.toBeNull();
    const body = m![1];
    expect(body, "締切を数えると当日が押せなくなる").not.toContain("isSlotPastCutoff");
    expect(body, "プラン上限を数えるとカレンダーが全部灰色になる").not.toContain("isSlotOverLimit");
  });

  it("枠一覧と同じ関数で判定している（画面同士がズレない）", () => {
    const body = /const isDayFull = \(d: string\): boolean =>([\s\S]*?\n\s*\);)/.exec(code)![1];
    expect(body).toContain("isSlotBlocked");
    expect(body).toContain("isSlotNotAccepting");
    // 営業時間・定休日・担当のシフトを反映した枠だけを見る
    expect(body).toContain("staffBookingSlotMinutes");
  });

  it("満枠の判定を保存していない（空いたら自動で戻る）", () => {
    // useState / useMemo に入れると、空いたのに押せないままになる
    expect(code).not.toMatch(/useState[^;]{0,60}[dD]ayFull/);
    expect(code).not.toMatch(/useMemo\([^;]{0,80}isDayFull/);
  });
});

// ────────────────────────────────────────────────────────────────
// 🔴 2026-09-21: 入れたのに**一度も効いていなかった**
//
// > 全ての営業時間にブロック入れていて予約が取れない 10/2 の日にちが
// > 押せるようになったままですよ
//
// 判定（isDayFullyBooked）は正しかった。**渡すデータが足りていなかった。**
// 埋まり枠を「選んだ日ぶん」しか読んでいなかったので、カレンダーが見る他の日は
// どれも埋まり枠ゼロ＝「まだ空きがある」になり、全枠ブロックの日まで黒いまま残った。
//
// 教訓: 日をまたいで引く判定には、**日をまたいだデータ**が要る。
// ここは実際のライブラリを繋いで、その組み立てごと見張る。
// ────────────────────────────────────────────────────────────────
describe("🔴 満枠判定に渡すデータ（範囲で読めているか）", () => {
  // 10:00〜22:30 営業・75分1枠の店で、その日だけ全営業時間をブロックした状態。
  const HOURS = { start: "10:00", end: "22:30" };
  const SLOT = 75;
  const DAY = "2026-10-02";
  const OTHER = "2026-10-03";
  // get_tenant_booked_slots が返す形そのまま（ブロック枠は status="ブロック済み"）
  const rows = [
    { booking_date: `${DAY}T10:00:00+09:00`, end_booking_date: `${DAY}T22:30:00+09:00`, status: "ブロック済み" },
  ];

  const dayIsFull = (byDate: ReturnType<typeof groupBookedSlotsByDate>, date: string): boolean =>
    isDayFullyBooked(
      staffBookingSlotMinutes(HOURS, SLOT, weekdayOfDateKey(date), null, null),
      (m) => isFootprintBlocked({
        bookedSlots: bookedSlotsOnDate(byDate, date),
        date, weekday: weekdayOfDateKey(date), startMinutes: m,
        footprintMinutes: sessionFootprintMinutes(SLOT, 0, 0),
        capacityWindows: null, defaultCapacity: 1,
        staffUserId: null, exclude: null,
      }),
    );

  it("範囲で読めていれば、全営業時間ブロックの日は満枠", () => {
    const byDate = groupBookedSlotsByDate(toBookedSlots(rows));
    expect(dayIsFull(byDate, DAY)).toBe(true);
  });

  it("🔴 別の日ぶんしか読んでいないと、その日は「空きがある」に化ける（これが不具合の正体）", () => {
    // 「選んだ日は 10/3、判定したいのは 10/2」＝1日ぶん読みのときに必ず起きる形
    const onlyOtherDay = groupBookedSlotsByDate(toBookedSlots(
      rows.filter((r) => r.booking_date.startsWith(OTHER)),
    ));
    expect(dayIsFull(onlyOtherDay, DAY)).toBe(false);
  });

  it("ブロックが1枠ぶん解ければ押せる日に戻る", () => {
    const byDate = groupBookedSlotsByDate(toBookedSlots([
      { ...rows[0], end_booking_date: `${DAY}T21:00:00+09:00` },
    ]));
    expect(dayIsFull(byDate, DAY)).toBe(false);
  });

  it("日付ごとに束ねても、束ねる前と同じ行が読める", () => {
    const slots = toBookedSlots(rows);
    const byDate = groupBookedSlotsByDate(slots);
    expect(bookedSlotsOnDate(byDate, DAY)).toEqual(slots);
    expect(bookedSlotsOnDate(byDate, OTHER)).toEqual([]);
  });
});

describe("🔴 埋まり枠の読み口（CustomerBooking）", () => {
  // RPC の呼び出し1本ぶんを切り出す
  const call = /get_tenant_booked_slots[\s\S]*?\}\);/.exec(code);

  it("呼び出しが読める", () => {
    expect(call, "get_tenant_booked_slots の呼び出しが見つからない").not.toBeNull();
  });

  it("🔴 1日ぶんだけ読んでいない（from と to が同じ値でない）", () => {
    // from_date: x, to_date: x ＝ 選んだ日ぶんしか持たない＝カレンダーが判定できない
    expect(call![0]).not.toMatch(/from_date: (\S+),\s*to_date: \1,/);
  });

  it("予約できる範囲の最後まで読んでいる", () => {
    expect(call![0]).toContain("from_date: getJSTToday()");
    expect(call![0]).toContain("to_date: maxBookableKey");
  });

  it("日付ごとに束ねてから判定に渡している（描画のたびに全部走査しない）", () => {
    expect(code).toContain("groupBookedSlotsByDate(bookedSlots)");
    expect(code).toMatch(/bookedSlots: bookedSlotsOnDate\(bookedSlotsByDate, date\)/);
  });
});
