import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isDayFullyBooked } from "@/lib/bookingDayFull";

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
    expect(code).toMatch(/if \(isDayFull\(yyyyMMdd\)\) return true;/);
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
