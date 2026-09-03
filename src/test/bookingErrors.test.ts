import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  GENERIC_BOOKING_ERROR_KEY,
  KNOWN_GUARD_CODES,
  bookingErrorKey,
  bookingErrorKeyForAll,
  isAppOutdatedError,
  proxyBookingErrorKey,
} from "@/lib/bookingErrors";

// 予約が断られたときの案内を見張る。
//
// ── なぜ要るか（2026-09-03）─────────────────────────────────────────
// お客様から店のチャットにこう届いた:
//   「9/13 13:45 から予約しようとしてるんですが、『予約に失敗しました』と表示され
//     予約できず… ちなみに他の日時は予約できたので、この部分だけの不具合かも」
//
// 不具合ではなく、そのお客様のアプリが古かった。9/1 に入れた「1日の上限人数」（GB007）を
// 古いアプリは知らないので、上限に達した日の枠を「空き」と見せ、送信して初めて断られる。
// 案内が「予約に失敗しました」だけなので、お客様には打つ手が分からない。
//
// 🔴 予約のガードは全部 GB0xx を持つ。既知のどれでもない GB0xx ＝ サーバーの規則のほうが
//    新しい ＝ アプリが古い。**これはコードそのものが証拠**なので、言い当てられる。

const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;

/** migrations が実際に投げる SQLSTATE（`USING ERRCODE = 'GBxxx'`）。 */
const migrationCodes = (): string[] => {
  const dir = "supabase/migrations";
  const found = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
    const sql = readFileSync(`${dir}/${f}`, "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    for (const m of sql.matchAll(/ERRCODE\s*=\s*'(GB\d{3})'/g)) found.add(m[1]);
  }
  return [...found].sort();
};

describe("🔴 「アプリが古い」を言い当てる", () => {
  it("知らない GB0xx は「アプリが古い」", () => {
    expect(isAppOutdatedError({ code: "GB009" })).toBe(true);
    expect(isAppOutdatedError({ code: "GB042" })).toBe(true);
  });

  it("知っている GB0xx は「アプリが古い」ではない", () => {
    for (const code of KNOWN_GUARD_CODES) {
      expect(isAppOutdatedError({ code }), `${code} を古いアプリ扱いしている`).toBe(false);
    }
  });

  it("🔴 満枠（SQLSTATE を持たない）は「アプリが古い」ではない", () => {
    // ここを取り違えると、直前に枠を取られただけの人に「更新してください」と出る。
    // 更新しても直らない案内になり、かえって迷わせる。
    expect(isAppOutdatedError({ code: "P0001", message: "..." })).toBe(false);
    expect(isAppOutdatedError({ message: "network error" })).toBe(false);
  });

  it("形が違うものは静かに false（画面を落とさない）", () => {
    expect(isAppOutdatedError(null)).toBe(false);
    expect(isAppOutdatedError(undefined)).toBe(false);
    expect(isAppOutdatedError("GB009")).toBe(false);
    expect(isAppOutdatedError({ code: 9 })).toBe(false);
    expect(isAppOutdatedError({ code: "GB01" })).toBe(false);   // 桁が足りない
    expect(isAppOutdatedError({ code: "XX009" })).toBe(false);  // 別の体系
  });

  it("🔴 DB が投げる SQLSTATE は全部このアプリが知っている", () => {
    // ここが破れると、**正しく動いている最新版のアプリに「更新してください」と出る**。
    // 新しいガードを足したら KNOWN_GUARD_CODES にも足すこと。
    const unknown = migrationCodes().filter(
      (c) => !(KNOWN_GUARD_CODES as readonly string[]).includes(c),
    );
    expect(
      unknown,
      `migrations にあるのに KNOWN_GUARD_CODES に無い: ${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("KNOWN_GUARD_CODES に架空の番号を並べていない", () => {
    // 逆向き。使っていない番号を「知っている」ことにすると、その番号で
    // 新しいガードを足したときに古いアプリが黙って汎用の文言に落ちる。
    const inMigrations = migrationCodes();
    for (const code of KNOWN_GUARD_CODES) {
      expect(inMigrations, `${code} は migrations のどこにも無い`).toContain(code);
    }
  });
});

describe("理由ごとの案内", () => {
  const cases: [string, string][] = [
    ["GB001", "staff.errorStaffBusy"],
    ["GB002", "staff.errorStaffOffShift"],
    ["GB003", "bookingLimits.errorOverLimit"],
    ["GB004", "planSessions.errorReached"],
    ["GB006", "blockedWindows.errorNotAccepting"],
    ["GB007", "closedDays.errorClosed"],
    ["GB009", "booking.errorAppOutdated"],
  ];

  for (const [code, key] of cases) {
    it(`${code} → ${key}`, () => {
      expect(bookingErrorKey({ code })).toBe(key);
    });
  }

  it("当てはまらないものは汎用（満枠・通信エラー）", () => {
    expect(bookingErrorKey({ code: "P0001" })).toBe(GENERIC_BOOKING_ERROR_KEY);
    expect(bookingErrorKey(null)).toBe(GENERIC_BOOKING_ERROR_KEY);
  });
});

describe("🔴 くり返し予約が全滅したとき", () => {
  it("全部が同じ理由なら、その理由を出す", () => {
    expect(bookingErrorKeyForAll([{ code: "GB004" }, { code: "GB004" }]))
      .toBe("planSessions.errorReached");
    // 2026-09-03 以前はここが3種類しか見ておらず、受付終了（GB007）で全滅しても
    // 「予約に失敗しました」としか出なかった。
    expect(bookingErrorKeyForAll([{ code: "GB007" }, { code: "GB007" }]))
      .toBe("closedDays.errorClosed");
    expect(bookingErrorKeyForAll([{ code: "GB009" }, { code: "GB009" }]))
      .toBe("booking.errorAppOutdated");
  });

  it("🔴 理由が混ざっていたら汎用に倒す", () => {
    // 「4回とも回数上限」と「1回だけ回数上限で残りは満枠」では、お客様が取るべき手が違う。
    expect(bookingErrorKeyForAll([{ code: "GB004" }, { code: "P0001" }]))
      .toBe(GENERIC_BOOKING_ERROR_KEY);
  });

  it("空なら汎用", () => {
    expect(bookingErrorKeyForAll([])).toBe(GENERIC_BOOKING_ERROR_KEY);
  });
});

describe("画面が共通の判定を通っている", () => {
  const customer = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");

  it("🔴 お客様の予約画面が自前の分岐を書き直していない", () => {
    // 判定が2箇所に分かれていたせいで、片方（くり返し予約）だけ3種類しか
    // 見ていない状態が続いていた。分かれている限り同じ事故が起きる。
    expect(customer).toContain("bookingErrorKey(error)");
    expect(customer).toContain("bookingErrorKeyForAll(");
  });

  it("🔴 予約変更も「アプリが古い」を出す（文言が違うので共通化していない箇所）", () => {
    expect(customer).toContain("isAppOutdatedError(error)");
  });

  it("🔴 店側の代理予約も共通の判定を通る", () => {
    // 店側の端末も更新されていないことがある（お客様側と同じ理屈）。
    expect(readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8"))
      .toContain("proxyBookingErrorKey(error)");
    expect(proxyBookingErrorKey({ code: "GB009" })).toBe("booking.errorAppOutdated");
    // 🔴 受付終了（GB007）は代理予約に効かないので、ここでは拾わない
    expect(proxyBookingErrorKey({ code: "GB007" })).toBe("schedule.errorAddFailed");
  });
});

describe("文言（5言語）", () => {
  for (const lang of LOCALES) {
    it(`${lang} に booking.errorAppOutdated がある`, () => {
      const json = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      expect(json.booking?.errorAppOutdated, `${lang}.json booking.errorAppOutdated`).toBeTruthy();
    });
  }
});
