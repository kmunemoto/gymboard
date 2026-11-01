/**
 * 体験予約・ドロップイン（未ログインの入力）の守り（2026-11-01・点検 trial-book-1 / trial-book-2 / drop-in-book-1）。
 *   `supabase/functions/_shared/guestBooking.ts`・`supabase/functions/trial-book/index.ts`・`supabase/functions/drop-in-book/index.ts`
 *
 * お名前は、お客様宛ての確認メール・店宛てのメール・公式 LINE・Google カレンダー・当日のサマリーにそのまま入る。
 * 未ログインで誰でも入れられたので、URL・メールアドレス・改行で、正規のドメイン・公式アカウントから偽の案内を送れた。
 * 確認メールの回数の上限も「同じジム」の中だけで、ジムを替えれば同じ人に何通でも送れた。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  GUEST_NAME_MAX, RATE_LIMIT_PER_CONTACT_ALL_TENANTS_24H, RATE_LIMIT_PER_TENANT_24H, guestNameProblem,
} from "../../supabase/functions/_shared/guestBooking";

describe("guestNameProblem: お名前として受け付けるもの", () => {
  it.each(["佐藤 一郎", "やまだ たろう", "Taro Yamada", "Jean-Luc O'Neil", "J. Smith", "李 小龍", "김민준", "Ana María", "😀 さくら", "👨‍👩‍👧 家族"])(
    "%s は受け付ける",
    (name) => {
      expect(guestNameProblem(name)).toBeNull();
    },
  );

  it("空・長すぎるものは受け付けない", () => {
    expect(guestNameProblem("")).toBe("empty");
    expect(guestNameProblem("あ".repeat(GUEST_NAME_MAX))).toBeNull();
    expect(guestNameProblem("あ".repeat(GUEST_NAME_MAX + 1))).toBe("too_long");
  });

  it.each([
    ["改行", "山田\n下記から手続きを"],
    ["復帰", "山田\r太郎"],
    ["タブ", "山田\t太郎"],
    ["行区切り", `山田${String.fromCharCode(0x2028)}太郎`],
    ["段落区切り", `山田${String.fromCharCode(0x2029)}太郎`],
    ["ゼロ幅", `山田${String.fromCharCode(0x200b)}太郎`],
    ["向きの上書き", `山田${String.fromCharCode(0x202e)}太郎`],
    ["向きの分離", `山田${String.fromCharCode(0x2066)}太郎`],
  ])("🔴 %s（通知の行・見た目を偽れる）は受け付けない", (_label, name) => {
    expect(guestNameProblem(name)).toBe("control");
  });

  it.each([
    "山田 https://evil.example/login",
    "山田 http://x",
    "山田 www.evil-example.com",
    "山田 evil.com",
    "山田 evil-example.jp",
    "山田 bit.ly/abc",
    "山田 → evil.xyz",
    "連絡は taro@example.com まで",
    "LINE @evil_id",
    "山田 ｗｗｗ．ｅｖｉｌ．ｃｏｍ", // 全角
    "山田 ｅｖｉｌ．ｃｏｍ",
    "山田 hxxps://evil", // :// を含む
  ])("🔴 URL・メールアドレスらしいもの（%s）は受け付けない", (name) => {
    expect(guestNameProblem(name)).toBe("link");
  });
});

describe("回数の上限", () => {
  it("同じアドレスは全部のジムで24時間5件・1つのジムは24時間60件", () => {
    expect(RATE_LIMIT_PER_CONTACT_ALL_TENANTS_24H).toBe(5);
    expect(RATE_LIMIT_PER_TENANT_24H).toBe(60);
  });

  it("🔴 正規表現に、行区切りなどの文字そのものを書いていない（JavaScript では改行になり、関数ごと動かなくなる）", () => {
    const src = readFileSync("supabase/functions/_shared/guestBooking.ts", "utf8");
    for (const cp of [0x2028, 0x2029, 0x200b, 0x200c, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069]) {
      expect(src.includes(String.fromCharCode(cp)), `U+${cp.toString(16)}`).toBe(false);
    }
  });
});

describe.each([
  ["trial-book", "お名前に URL・メールアドレス・改行は使えません。"],
  ["drop-in-book", "without links, email addresses or line breaks"],
])("%s: 受け付ける前に確かめる", (fn, message) => {
  const src = readFileSync(`supabase/functions/${fn}/index.ts`, "utf8");

  it("🔴 お名前は guestNameProblem を通す（予約を作る前）", () => {
    const checkAt = src.indexOf("const nameProblem = guestNameProblem(guestName);");
    expect(checkAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(src.indexOf('.from("trial_bookings")\n      .insert('));
    expect(src).toContain(message);
  });

  it("🔴 同じアドレスは全部のジムを合わせて数える（tenant_id で絞らない）・1つのジムの24時間の上限もある", () => {
    const all = src.slice(src.indexOf("const { count: contactAllCount"), src.indexOf("if (caErr)"));
    expect(all).toContain('.eq("guest_contact", guestContact)');
    expect(all).not.toContain("tenant_id");
    expect(src).toContain("(contactAllCount ?? 0) >= RATE_LIMIT_PER_CONTACT_ALL_TENANTS_24H");
    const day = src.slice(src.indexOf("const { count: tenantDayCount"), src.indexOf("if (tdErr)"));
    expect(day).toContain('.eq("tenant_id", tenantId)');
    expect(src).toContain("(tenantDayCount ?? 0) >= RATE_LIMIT_PER_TENANT_24H");
    // どちらも予約を作る前
    const insertAt = src.indexOf('.from("trial_bookings")\n      .insert(');
    expect(src.indexOf("const { count: contactAllCount")).toBeLessThan(insertAt);
    expect(src.indexOf("const { count: tenantDayCount")).toBeLessThan(insertAt);
  });
});

describe("当日のサマリー: 長いお名前で丸ごと届かなくならない（daily-trainer-summary-1）", () => {
  it("名前は20字まで・本文は send-push-notification の上限（500）以内", async () => {
    const { clipSummaryName, clipPushBody } = await import("../../supabase/functions/_shared/guestBooking");
    expect(clipSummaryName("佐藤 一郎")).toBe("佐藤 一郎");
    expect(clipSummaryName("あ".repeat(100))).toBe(`${"あ".repeat(20)}…`);
    // 絵文字を割らない
    expect(clipSummaryName("😀".repeat(30))).toBe(`${"😀".repeat(20)}…`);
    const lines = Array.from({ length: 8 }, () => `10:00 🆕 ${clipSummaryName("あ".repeat(100))}`).concat("他3件");
    const body = clipPushBody(lines.join("\n"));
    expect(body.length).toBeLessThanOrEqual(500);
    const long = clipPushBody("🆕".repeat(400));
    expect(long.length).toBeLessThanOrEqual(500);
    expect(long.endsWith("…")).toBe(true);
    expect(long.slice(0, -1)).toBe("🆕".repeat((long.length - 1) / 2)); // サロゲートの片割れが残らない
    expect(clipPushBody("短い本文")).toBe("短い本文");
  });

  it("daily-trainer-summary は名前と本文を切ってから送る（店宛て・インストラクター宛ての両方）", () => {
    const src = readFileSync("supabase/functions/daily-trainer-summary/index.ts", "utf8");
    expect(src).toContain('label: `🆕 ${clipSummaryName(tb.guest_name || "体験ゲスト")}`');
    expect(src).toContain('withMenu(clipSummaryName(nameMap[b.user_id] || "顧客")');
    expect(src).toContain('const body = clipPushBody(bodyLines.join("\\n"));');
    expect(src).toContain('body: clipPushBody(lines.join("\\n")), url: "/", tag: instKey');
    const push = readFileSync("supabase/functions/send-push-notification/index.ts", "utf8");
    expect(push).toContain('if (typeof body === "string" && body.length > 500) {');
  });
});
