import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  type QuotableBooking,
  MAX_QUOTE_CHIPS,
  formatBookingQuote,
  formatQuoteChipLabel,
  isQuotableStatus,
  pickQuotableBookings,
  prependQuote,
} from "@/lib/messageQuote";

// 予約の引用。
//
// 「明日の予約の件ですが…」を、**文脈のないテキストで**打っている状態だった。
// どの予約の話か会話からは分からず、あとから読み返しても業務記録にならない。
//
// ── ここで守りたいこと ────────────────────────────────────────────
//
//  1. **キャンセル済みを引用の候補にしないこと。** 「8/13 の件ですが」と言われて
//     見に行ったらキャンセル済み、は混乱にしかならない
//  2. **書きかけを消さないこと**（定型文と同じ）
//  3. **参照ではなく文字列で入れること。** 予約を消したときに会話が壊れないように

const LIB = readFileSync("src/lib/messageQuote.ts", "utf8");
const HOOK = readFileSync("src/hooks/useQuotableBookings.ts", "utf8");
const CUSTOMER = readFileSync("src/components/customer/CustomerChat.tsx", "utf8");
const TRAINER = readFileSync("src/components/trainer/TrainerMessages.tsx", "utf8");

const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
const localeJson = (lng: string) =>
  JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8")) as Record<string, any>;

/** JST の日時から ISO を作る（テストの意図を読みやすくするため） */
const jst = (s: string) => new Date(`${s}+09:00`).toISOString();

const booking = (over: Partial<QuotableBooking> & { booking_date: string }): QuotableBooking => ({
  id: over.booking_date,
  booking_type: "パーソナル60分",
  status: "予約済み",
  ...over,
});

describe("🔴 キャンセル済みは引用させない", () => {
  it("状態の判定", () => {
    expect(isQuotableStatus("予約済み")).toBe(true);
    expect(isQuotableStatus("完了")).toBe(true);
    expect(isQuotableStatus("キャンセル済み")).toBe(false);
    expect(isQuotableStatus("同日キャンセル済み")).toBe(false);
  });

  it("候補から外れる", () => {
    const now = new Date(jst("2026-08-11T12:00:00"));
    const picked = pickQuotableBookings(
      [
        booking({ booking_date: jst("2026-08-13T19:00:00"), status: "キャンセル済み" }),
        booking({ booking_date: jst("2026-08-14T19:00:00") }),
      ],
      now,
    );
    expect(picked.map((b) => b.booking_date)).toEqual([jst("2026-08-14T19:00:00")]);
  });
});

describe("候補の選び方", () => {
  const now = new Date(jst("2026-08-11T12:00:00"));

  it("これから来る予約を先に、近い順で出す", () => {
    const picked = pickQuotableBookings(
      [
        booking({ booking_date: jst("2026-08-20T19:00:00") }),
        booking({ booking_date: jst("2026-08-13T19:00:00") }),
        booking({ booking_date: jst("2026-08-15T19:00:00") }),
      ],
      now,
    );
    expect(picked.map((b) => b.booking_date)).toEqual([
      jst("2026-08-13T19:00:00"),
      jst("2026-08-15T19:00:00"),
      jst("2026-08-20T19:00:00"),
    ]);
  });

  it("未来が足りなければ、直近の過去で埋める（新しい順）", () => {
    const picked = pickQuotableBookings(
      [
        booking({ booking_date: jst("2026-08-01T19:00:00") }),
        booking({ booking_date: jst("2026-08-09T19:00:00") }),
        booking({ booking_date: jst("2026-08-13T19:00:00") }),
      ],
      now,
    );
    expect(picked.map((b) => b.booking_date)).toEqual([
      jst("2026-08-13T19:00:00"), // 未来が先
      jst("2026-08-09T19:00:00"), // 過去は新しい順
      jst("2026-08-01T19:00:00"),
    ]);
  });

  it("出しすぎない", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      booking({ booking_date: jst(`2026-08-${String(13 + i).padStart(2, "0")}T19:00:00`) }),
    );
    expect(pickQuotableBookings(many, now).length).toBe(MAX_QUOTE_CHIPS);
    expect(MAX_QUOTE_CHIPS).toBeLessThanOrEqual(5);
  });

  it("1件も無ければ空", () => {
    expect(pickQuotableBookings([], now)).toEqual([]);
  });
});

describe("差し込む文字列", () => {
  it("日時と種別が入る", () => {
    const q = formatBookingQuote(
      booking({ booking_date: jst("2026-08-13T19:00:00"), booking_type: "パーソナル60分" }),
    );
    expect(q).toContain("8/13");
    expect(q).toContain("19:00");
    expect(q).toContain("パーソナル60分");
    expect(q.startsWith("【")).toBe(true);
    expect(q.endsWith("】")).toBe(true);
  });

  it("種別が無ければ日時だけ", () => {
    const q = formatBookingQuote(
      booking({ booking_date: jst("2026-08-13T19:00:00"), booking_type: null }),
    );
    expect(q).toBe("【8/13(木) 19:00】");
  });

  it("空白だけの種別は無いものとして扱う", () => {
    const q = formatBookingQuote(
      booking({ booking_date: jst("2026-08-13T19:00:00"), booking_type: "  " }),
    );
    expect(q).toBe("【8/13(木) 19:00】");
  });

  it("チップの見出しは短い", () => {
    expect(formatQuoteChipLabel(booking({ booking_date: jst("2026-08-13T19:00:00") }))).toBe(
      "8/13(木) 19:00",
    );
  });
});

describe("🔴 書きかけを消さない", () => {
  it("空なら引用だけ入れて改行しておく", () => {
    expect(prependQuote("", "【8/13】")).toBe("【8/13】\n");
  });

  it("書きかけがあれば引用を先頭に、本文はその下へ", () => {
    expect(prependQuote("遅れそうです", "【8/13】")).toBe("【8/13】\n遅れそうです");
  });

  it("連打しても増えない", () => {
    const once = prependQuote("遅れそうです", "【8/13】");
    expect(prependQuote(once, "【8/13】")).toBe(once);
  });

  it("別の予約なら追加できる", () => {
    const once = prependQuote("", "【8/13】");
    expect(prependQuote(once, "【8/15】")).toContain("【8/15】");
    expect(prependQuote(once, "【8/15】")).toContain("【8/13】");
  });
});

describe("実装上の約束", () => {
  it("🔴 引用は文字列で入れる（予約への参照を持たせない）", () => {
    // 参照を持たせると、予約を消したときに「削除された予約」の吹き出しが残る。
    // 文字列なら、あとで予約を消しても会話はそのまま読める。
    expect(
      /booking_id|quoted_booking/.test(LIB),
      "引用が予約への参照になっています。文字列で入れてください。",
    ).toBe(false);
  });

  it("取得を日付で絞っている", () => {
    // 会話を開くたびに全予約を引くと、続いているお客様ほど重くなる。
    expect(HOOK).toMatch(/gte\("booking_date"/);
    expect(HOOK).toMatch(/lte\("booking_date"/);
  });

  it("両方の画面に出ている", () => {
    for (const [label, code] of [
      ["CustomerChat", CUSTOMER],
      ["TrainerMessages", TRAINER],
    ] as const) {
      expect(code, `${label} に引用チップがありません`).toMatch(/<BookingQuoteChips/);
      expect(code, `${label} が prependQuote を使っていません`).toMatch(/prependQuote/);
    }
  });

  it("🔴 お客様側は自分の予約を引く", () => {
    // 相手（ジムのスタッフ）の user_id で引くと、**他のお客様の予約**が候補に出る。
    const idx = CUSTOMER.indexOf("useQuotableBookings(");
    expect(idx).toBeGreaterThan(-1);
    expect(CUSTOMER.slice(idx, idx + 60)).toMatch(/useQuotableBookings\(user\?\.id/);
  });

  it("ジム側は選んでいるお客様の予約を引く", () => {
    const idx = TRAINER.indexOf("useQuotableBookings(");
    expect(idx).toBeGreaterThan(-1);
    expect(TRAINER.slice(idx, idx + 60)).toMatch(/useQuotableBookings\(selectedCustomerId\)/);
  });
});

describe("5言語", () => {
  it("messageQuote.label が全言語にある", () => {
    for (const lng of LOCALES) {
      const v = localeJson(lng).messageQuote?.label;
      expect(typeof v === "string" && v.length > 0, `${lng}.json に messageQuote.label がありません`).toBe(
        true,
      );
    }
  });
});
