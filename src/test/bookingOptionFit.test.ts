import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  isFootprintBlocked,
  optionFitReason,
  suggestSlotForOption,
  type OptionFitInput,
} from "@/lib/bookingOptionFit";
import type { BookedSlot } from "@/lib/bookedSlots";

// 「この枠にオプションを付けられるか」の判定を見張る。
//
// ── なぜ要るか（2026-09-03・第4段）─────────────────────────────────
// 第2〜3段は、オプションを**時間を選ぶ前**に選ばせていた。宗本さんの指摘:
// 「オプションが分かりづらい、これは気づかない。下にスクロールしてオプションの存在に
//   お客さんが予約する時に気づかない。毎回日にちを予約したときに、確認の時に
//   オプションを付けるか聞くようにしてください」。
//
// 確認カードで聞く形にすると、枠が先に決まっていてオプションが後から乗るので、
// 「その枠に入るか」を枠ごとに見ることになる。
//
// 🔴 いちばん怖いのは、この判定が DB（check_booking_overlap）とずれること。
//    ずれると「空きに見えるのに送信すると断られる」＝何度押しても取れない画面になる。
//    そのため判定の本体は CustomerBooking から**移して**あり、写しは作っていない。

const SLOT = 60;   // 1枠60分（Salute御所南）
const BUFFER = 15; // 次のお客様までの間

const booked = (startTime: string, endTime: string, extra: Partial<BookedSlot> = {}): BookedSlot => ({
  date: "2026-09-19",
  startTime,
  endTime,
  isBlock: false,
  staffUserId: null,
  ...extra,
});

/** 18:00 に予約が1件ある日（占有は 18:00〜19:15＝1枠60＋間15）。 */
const ONE_AT_18: BookedSlot[] = [booked("18:00", "19:15")];

const fit = (over: Partial<OptionFitInput> = {}): OptionFitInput => ({
  bookedSlots: ONE_AT_18,
  date: "2026-09-19",
  weekday: 6,
  time: "16:30",
  slotMinutes: SLOT,
  optionMinutes: 30,
  bufferMinutes: BUFFER,
  capacityWindows: null,
  defaultCapacity: 1,
  staffUserId: null,
  exclude: null,
  businessHours: { start: "10:00", end: "22:00" },
  staffSchedules: null,
  ...over,
});

describe("🔴 後ろが詰まっているとオプションを付けられない", () => {
  it("16:30 はオプション無しなら取れる（16:30〜17:45 で 18:00 に届かない）", () => {
    expect(optionFitReason(fit({ optionMinutes: 0 }))).toBeNull();
  });

  it("🔴 16:30 はオプションを付けると取れない（16:30〜18:15 で食い込む）", () => {
    expect(optionFitReason(fit({ time: "16:30" }))).toBe("occupied");
  });

  it("16:15 はオプションを付けても取れる（16:15〜18:00 でちょうど）", () => {
    expect(optionFitReason(fit({ time: "16:15" }))).toBeNull();
  });

  it("境界は含まない（既存の終わりちょうどから始められる）", () => {
    // 19:15 に始めれば 19:15〜21:00。既存は 19:15 に終わっているので重ならない。
    expect(optionFitReason(fit({ time: "19:15" }))).toBeNull();
  });

  it("長いオプションほど早い時刻から取れなくなる", () => {
    expect(optionFitReason(fit({ time: "16:00", optionMinutes: 30 }))).toBeNull();
    expect(optionFitReason(fit({ time: "16:00", optionMinutes: 60 }))).toBe("occupied");
  });

  it("予約が1件も無い日は、どの枠でも付けられる", () => {
    expect(optionFitReason(fit({ bookedSlots: [] }))).toBeNull();
  });
});

describe("営業時間・担当の勤務時間（理由は hours）", () => {
  it("🔴 オプションを付けると閉店を過ぎる枠は付けられない", () => {
    // 21:00 + 60 = 22:00 でちょうど閉店 → オプション無しなら取れる
    expect(optionFitReason(fit({ time: "21:00", optionMinutes: 0, bookedSlots: [] }))).toBeNull();
    // +30分 で 22:30 → 閉店を過ぎる
    expect(optionFitReason(fit({ time: "21:00", bookedSlots: [] }))).toBe("hours");
  });

  it("閉店ちょうどに終わるなら付けられる（間は閉店の判定に入れない）", () => {
    // 20:30 + 60 + 30 = 22:00。間15分は店の都合の時間なので閉店には食い込ませない
    // （枠グリッドの staffBookingSlotMinutes と同じ長さで判定する）。
    expect(optionFitReason(fit({ time: "20:30", bookedSlots: [] }))).toBeNull();
  });

  it("指名した担当の勤務終わりでも同じ（店は開いていても取れない）", () => {
    const schedules = [{ user_id: "s1", weekday: 6, start_time: "10:00", end_time: "19:00" }];
    const base = { bookedSlots: [], staffUserId: "s1", staffSchedules: schedules };
    // 18:00 + 60 = 19:00 ちょうど → 取れる
    expect(optionFitReason(fit({ ...base, time: "18:00", optionMinutes: 0 }))).toBeNull();
    // +30分 → 19:30 で勤務外
    expect(optionFitReason(fit({ ...base, time: "18:00" }))).toBe("hours");
  });

  it("その曜日が定休日なら hours", () => {
    expect(optionFitReason(fit({
      bookedSlots: [],
      businessHours: { start: "10:00", end: "22:00", days: { "6": null } },
    }))).toBe("hours");
  });

  it("オプションを選んでいなければ、いつでも null（判定そのものをしない）", () => {
    // 閉店を過ぎる時刻でも、オプション 0分 なら「付けられない」とは言わない
    // （枠グリッドの時点で押せないので、カードで二重に言う意味が無い）。
    expect(optionFitReason(fit({ time: "23:00", optionMinutes: 0, bookedSlots: [] }))).toBeNull();
  });
});

describe("同時受入数・ブロック・担当", () => {
  it("同時に2人受けられる店では、後ろに1件あっても付けられる", () => {
    expect(optionFitReason(fit({ time: "16:30", defaultCapacity: 2 }))).toBeNull();
  });

  it("2件そろえば、2人受けられる店でも付けられない", () => {
    expect(optionFitReason(fit({
      time: "16:30", defaultCapacity: 2,
      bookedSlots: [booked("18:00", "19:15"), booked("18:00", "19:15")],
    }))).toBe("occupied");
  });

  it("🔴 店のブロック（休憩・清掃）は受入数に関係なく塞ぐ", () => {
    expect(optionFitReason(fit({
      time: "16:30", defaultCapacity: 5,
      bookedSlots: [booked("18:00", "19:15", { isBlock: true })],
    }))).toBe("occupied");
  });

  it("時間帯の帯が既定値より厳しければ、そちらが勝つ", () => {
    const windows = [{ weekdays: [6], start_time: "16:00", end_time: "20:00", capacity: 1 }];
    expect(optionFitReason(fit({ time: "16:30", defaultCapacity: 3 }))).toBeNull();
    expect(optionFitReason(fit({ time: "16:30", defaultCapacity: 3, capacityWindows: windows })))
      .toBe("occupied");
  });

  it("指名した担当が後ろに入っていれば、店に空きがあっても付けられない", () => {
    const slots = [booked("18:00", "19:15", { staffUserId: "s1" })];
    // 店は2人受けられるので、指名なしなら付けられる
    expect(optionFitReason(fit({ time: "16:30", defaultCapacity: 2, bookedSlots: slots }))).toBeNull();
    // 同じ担当を指名すると付けられない
    expect(optionFitReason(fit({
      time: "16:30", defaultCapacity: 2, bookedSlots: slots, staffUserId: "s1",
    }))).toBe("occupied");
    // 別の担当なら付けられる
    expect(optionFitReason(fit({
      time: "16:30", defaultCapacity: 2, bookedSlots: slots, staffUserId: "s2",
    }))).toBeNull();
  });

  it("予約変更中は、元の枠を占有として数えない", () => {
    const slots = [booked("18:00", "19:15")];
    expect(optionFitReason(fit({ time: "16:30", bookedSlots: slots }))).toBe("occupied");
    expect(optionFitReason(fit({
      time: "16:30", bookedSlots: slots,
      exclude: { date: "2026-09-19", startTime: "18:00" },
    }))).toBeNull();
  });

  it("別の日の予約は関係ない", () => {
    expect(optionFitReason(fit({
      time: "16:30",
      bookedSlots: [booked("18:00", "19:15", { date: "2026-09-20" })],
    }))).toBeNull();
  });

  it("時刻が壊れている行で店を丸ごと塞がない（最終判定は DB）", () => {
    expect(isFootprintBlocked({
      bookedSlots: [booked("こわれた", "ここも")],
      date: "2026-09-19", weekday: 6, startMinutes: 16 * 60 + 30,
      footprintMinutes: 105, capacityWindows: null, defaultCapacity: 1,
      staffUserId: null, exclude: null,
    })).toBe(false);
  });
});

describe("🔴 「オプションの時間分、予約を早める」相手を探す", () => {
  // 15分刻み。18:00 に予約がある日。オプション30分（占有105分）だと 16:15 までが上限。
  const grid = [
    { time: "15:45", available: true },
    { time: "16:00", available: true },
    { time: "16:15", available: true },
    { time: "16:30", available: true },
    { time: "19:15", available: true },
  ];
  const fits = (time: string) => optionFitReason(fit({ time })) === null;

  it("いちばん近い早い枠を出す（16:30 を選んでいるなら 16:15）", () => {
    expect(suggestSlotForOption(grid, "16:30", fits)).toBe("16:15");
  });

  it("🔴 「30分前」を機械的に返さない（後ろの予約の位置で必要な差は変わる）", () => {
    // 16:30 の30分前は 16:00 だが、実際に付けられる直近は 16:15。
    // 機械的にずらすと、押した先でまた断られる／余計に早い時間を案内する。
    expect(suggestSlotForOption(grid, "16:30", fits)).not.toBe("16:00");
  });

  it("前に付けられる枠が無ければ、後ろのいちばん近い枠を出す", () => {
    const onlyLater = [
      { time: "16:30", available: true },
      { time: "19:15", available: true },
      { time: "19:30", available: true },
    ];
    expect(suggestSlotForOption(onlyLater, "16:30", fits)).toBe("19:15");
  });

  it("🔴 素の枠として押せない枠は提案しない（押した瞬間 DB に断られるため）", () => {
    // 締切・回数上限・受付しない帯で available:false になっている枠は候補にしない
    const blockedGrid = grid.map((s) => (s.time === "16:15" ? { ...s, available: false } : s));
    expect(suggestSlotForOption(blockedGrid, "16:30", fits)).toBe("16:00");
  });

  it("付けられる枠が1つも無ければ null", () => {
    const noneFit = [{ time: "16:30", available: true }, { time: "16:45", available: true }];
    expect(suggestSlotForOption(noneFit, "16:30", fits)).toBeNull();
  });

  it("選んでいる枠そのものは提案しない", () => {
    expect(suggestSlotForOption([{ time: "16:15", available: true }], "16:15", fits)).toBeNull();
  });
});

describe("判定の本体が2箇所に増えていない", () => {
  it("🔴 お客様の予約画面は lib を呼ぶだけ（写しを持たない）", () => {
    // 本体が2箇所にあると必ず片方だけ直され、画面と DB の判定がずれる。
    // ずれた側が「空き」と見せると、お客様には何度押しても取れない画面になる。
    const src = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
    expect(src).toContain("isFootprintBlocked({");
    expect(src).not.toContain("footprintOverlaps(");
    expect(src).not.toContain("resolveSlotCapacity(");
  });
});
