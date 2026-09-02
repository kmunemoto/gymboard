import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildOptionSnapshot,
  minutesBetween,
  parseOptionSnapshot,
  readOptionMinutes,
  footprintOverlaps,
  sessionFootprintMinutes,
  sessionMinutes,
  type BookingOption,
} from "@/lib/bookingOptions";

// 予約に付けたオプションが「同じ1回のセッション」として占有に入ることを見張る（2026-09-03）。
//
// ── いちばん怖い壊れ方 ─────────────────────────────────────────────
// 占有を計算している場所は**4つ**あり、全部そろって初めて正しい:
//
//   1. check_booking_overlap … これから入れる予約
//   2. check_booking_overlap … 既存の bookings
//   3. guard_booking_staff_reassign … 担当差し替え（BEFORE UPDATE）
//   4. get_tenant_booked_slots … 画面が見る埋まり枠
//
// 1 だけ直すと「Aの後にBは取れるのにBの後にAは取れない」左右非対称になる。
// 2 を忘れると **本物の二重予約**（ストレッチの最中に別のお客様が入る）。
// 4 を忘れると **「空きに見えるのに送信すると断られる」**——しかも再取得しても
// 空きのままなので、お客様は同じ枠を何度も押し続ける。
//
// ── もう1つの罠 ───────────────────────────────────────────────────
// check_booking_overlap は bookings と trial_bookings の**両方**のトリガーから
// 呼ばれる。trial_bookings に option_minutes 列は無いので `NEW.option_minutes` と
// 直接書くと**体験予約の登録だけが実行時に落ちる**。しかもその文言は
// trial-book の「この時間帯」判定に当たらないので、お客様には
// 「サーバーで問題が発生しました」としか出ない。

const stripJs = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const readCode = (p: string) => stripJs(readFileSync(p, "utf8"));
const readSql = (p: string) =>
  readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

const MIGRATION = "supabase/migrations/20260903000000_booking_option_minutes.sql";
const HOOK = "src/hooks/useBookings.ts";
const CUSTOMER = "src/components/customer/CustomerBooking.tsx";
const TRAINER = "src/components/trainer/TrainerSchedule.tsx";

const opt = (o: Partial<BookingOption> & { id: string }): BookingOption => ({
  name: "追加メニューA",
  duration_minutes: 30,
  price_yen: 3000,
  ...o,
});

describe("🔴 占有の計算（間は1回だけ）", () => {
  it("1枠60 + オプション30 + 間15 = 105分", () => {
    expect(sessionFootprintMinutes(60, 30, 15)).toBe(105);
  });

  it("お客様に見せる長さには間を入れない（90分）", () => {
    expect(sessionMinutes(60, 30)).toBe(90);
  });

  it("オプション無しなら従来と1分も変わらない", () => {
    expect(sessionFootprintMinutes(60, 0, 15)).toBe(75);
    expect(sessionMinutes(60, 0)).toBe(60);
  });
});

describe("マイグレーション: 4つの占有すべてにオプションが入っている", () => {
  const sql = readSql(MIGRATION);

  it("bookings に列が足されている（既定0＝古いアプリでも従来どおり）", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS option_minutes INTEGER NOT NULL DEFAULT 0/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS booking_options JSONB/);
    expect(sql).toContain("option_minutes >= 0 AND option_minutes <= 480");
  });

  it("🔴 check_booking_overlap は NEW.option_minutes を直接参照しない（体験予約が落ちる）", () => {
    const fn = sql.slice(
      sql.indexOf("FUNCTION public.check_booking_overlap"),
      sql.indexOf("FUNCTION public.guard_booking_staff_reassign"),
    );
    expect(fn.length).toBeGreaterThan(500);
    expect(fn).not.toMatch(/NEW\.option_minutes/);
    expect(fn).toMatch(/to_jsonb\(NEW\)\s*->>\s*'option_minutes'/);
  });

  it("1) これから入れる予約に足している", () => {
    expect(sql).toContain("new_session_min + new_option_min + COALESCE(buffer_min, 15)");
  });

  it("2) 既存の bookings にも足している（忘れると本物の二重予約）", () => {
    const fn = sql.slice(
      sql.indexOf("FUNCTION public.check_booking_overlap"),
      sql.indexOf("FUNCTION public.guard_booking_staff_reassign"),
    );
    expect(fn).toContain("COALESCE(b.option_minutes, 0)");
  });

  it("3) 既存の trial_bookings には**足していない**（列が無い）", () => {
    const fn = sql.slice(
      sql.indexOf("FUNCTION public.check_booking_overlap"),
      sql.indexOf("FUNCTION public.guard_booking_staff_reassign"),
    );
    // 体験の枝の make_interval にオプションが混ざっていないこと
    const trialInterval = fn.slice(fn.indexOf("tb.booking_date + make_interval"));
    expect(trialInterval.slice(0, 160)).not.toContain("option_minutes");
    expect(fn).not.toMatch(/tb\.option_minutes/);
  });

  it("4) 担当の差し替え（guard_booking_staff_reassign）も両側に足している", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.guard_booking_staff_reassign"));
    expect(fn).toContain("COALESCE(NEW.option_minutes, 0)");
    expect(fn).toContain("COALESCE(b.option_minutes, 0)");
  });

  it("5) 画面が見る埋まり枠（get_tenant_booked_slots）にも足している", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.get_tenant_booked_slots"));
    expect(fn).toContain("COALESCE(b.option_minutes, 0)");
    // 体験の枝には足さない（オプションを足しているのは bookings 側の1箇所だけ）
    const trialInterval = fn.slice(fn.indexOf("tb.booking_date + make_interval"));
    expect(trialInterval.slice(0, 160)).not.toContain("option_minutes");
    expect(fn.match(/option_minutes/g)?.length ?? 0).toBe(1);
  });

  it("戻りの列を変えていない＝DROP せずに差し替えられる（貼り替え中に予約ページを落とさない）", () => {
    expect(readFileSync(MIGRATION, "utf8")).not.toMatch(/DROP FUNCTION[^\n]*get_tenant_booked_slots/);
    expect(readSql(MIGRATION)).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_tenant_booked_slots\(uuid, date, date\) TO anon, authenticated/,
    );
  });
});

describe("🔴 後ろが詰まっているとオプションを付けられない（宗本さん 2026-09-03）", () => {
  // 実店舗の指示:「お客さんが予約する時にオプションを付けて予約するときは
  //               後ろが詰まってたらオプションはつけれないようにね」
  //
  // これは専用の判定を足して実現しているのではなく、**占有が伸びる**ことから
  // 自動的にそうなる。だから「伸びること」と「半開区間で比べること」の2つを固定する。
  //
  // 1枠60分・間15分・18:00 に予約がある日（18:00〜19:15 を占有）で確認した。
  // fixtures モードの実画面でも 16:30 / 16:45 が満枠に変わることを確かめている。
  const existing = { startMin: 18 * 60, endMin: 18 * 60 + 75 };
  const canBook = (startMin: number, optionMin: number) =>
    !footprintOverlaps(startMin, sessionFootprintMinutes(60, optionMin, 15), existing);

  it("16:30 は普通なら取れる（16:30〜17:45 で 18:00 に届かない）", () => {
    expect(canBook(16 * 60 + 30, 0)).toBe(true);
  });

  it("🔴 16:30 はオプションを付けると取れない（16:30〜18:15 で食い込む）", () => {
    expect(canBook(16 * 60 + 30, 30)).toBe(false);
  });

  it("16:15 はオプションを付けても取れる（16:15〜18:00 でちょうど）", () => {
    expect(canBook(16 * 60 + 15, 30)).toBe(true);
  });

  it("境界は含まない（終了ちょうどから次を取れる）", () => {
    expect(canBook(19 * 60 + 15, 0)).toBe(true);
    expect(canBook(19 * 60, 0)).toBe(false);
  });

  it("長いオプションほど早い時刻から取れなくなる", () => {
    expect(canBook(15 * 60, 90)).toBe(true);   // 15:00〜17:45
    expect(canBook(15 * 60, 120)).toBe(false); // 15:00〜18:15
  });

  it("お客様の予約画面がこの式を使っている", () => {
    const src = readCode(CUSTOMER);
    expect(src).toContain("footprintOverlaps(newMin, footprint, { startMin: bMin, endMin: bEnd })");
    expect(src).toContain("sessionFootprintMinutes(slotMinutes, optionMinutes, bookingBufferMinutes)");
  });

  it("🔴 開発用フィクスチャが埋まり枠を返す（返さないと空き枠の判定を画面で確認できない）", () => {
    // 2026-09-03 まで `get_tenant_booked_slots: () => []` だったため、dev:fixtures では
    // どの枠もいつも「空き」に見えていた。ここへ戻るのを止める。
    const shim = readCode("src/dev/fixtureClient.ts");
    expect(shim).not.toMatch(/get_tenant_booked_slots:\s*\(\)\s*=>\s*\[\]/);
    expect(shim).toContain("option_minutes");
    expect(shim).toContain('rowsOf("blocked_slots")');
  });
});

describe("クライアント: 表示と判定が DB と同じ規則になっている", () => {
  const hook = readCode(HOOK);

  it("parseBooking の endTime に 1枠＋オプション が入っている", () => {
    expect(hook).toContain("readOptionMinutes(row.option_minutes)");
    expect(hook).toContain("sessionMinutes(slotMinutes, optionMinutes)");
    expect(hook).toContain("const endMin = h * 60 + m + totalMinutes;");
  });

  it("checkSlotBlocked（店側の予定表）が候補側にオプションを足している", () => {
    expect(hook).toContain("sessionFootprintMinutes(sessionMinutes, optionMinutes, BUFFER_MINUTES)");
  });

  it("🔴 列がまだ無いDBでも予約できる（値があるときだけ payload に入れる）", () => {
    expect(hook).toContain("...(optionMinutes > 0 ? { option_minutes: optionMinutes } : {})");
    expect(hook).toContain("...(bookingOptions ? { booking_options: bookingOptions } : {})");
  });

  it("🔴 予約変更でオプションが消えない（3つの createBooking すべてに引き継ぐ）", () => {
    expect(hook).toContain("const carryOver = {");
    expect(hook).toContain("optionMinutes: oldOptionMinutes");
    // 旧枠の復元（ロールバック）も含めて3箇所
    expect(hook.match(/false, carryOver,/g)?.length ?? 0).toBe(3);
  });

  it("キャンセルメールの時間帯にもオプションが入る", () => {
    expect(hook).toContain("sessionMinutes(slotMinutes, readOptionMinutes(booking.option_minutes))");
  });

  it("トレーナーのGoogleカレンダーにもオプションぶんを渡す", () => {
    expect(hook).toContain("option_minutes: optionMinutes");
  });
});

describe("お客様の予約画面", () => {
  const src = readCode(CUSTOMER);

  it("空き枠・締切・表示のすべてが 1枠＋オプション を見ている", () => {
    expect(src).toContain("sessionFootprintMinutes(slotMinutes, optionMinutes, bookingBufferMinutes)");
    expect(src).toContain("return day.close - totalMinutes;");
    expect(src).toContain("businessHours, totalMinutes, weekday, staffSchedules, selectedStaffId,");
    expect(src).toContain('t("booking.slotMinutes", { count: totalMinutes })');
  });

  it("🔴 オプションを選び直したら選択中の枠を外す（占有が変わるため）", () => {
    expect(src).toContain("useBookingOptionSelection({ onChange: () => setSelectedSlot(null) })");
  });

  it("🔴 予約変更中は元の予約のオプション分数で判定する（0にすると必ず拒否される）", () => {
    expect(src).toContain("rescheduleTarget ? (rescheduleTarget.optionMinutes ?? 0) : bookingOpts.minutes");
  });

  it("予約が終わったらオプションの選択を消す（次の予約に引き継がない）", () => {
    expect(src).toContain("bookingOpts.reset()");
  });
});

describe("店側の代理予約", () => {
  const src = readCode(TRAINER);

  it("代理予約にもオプションを付けられる（付けないと店側の予約だけ占有が短くなる）", () => {
    expect(src).toContain("useBookingOptionSelection({ onChange: () => setProxyTime(\"\") })");
    expect(src).toContain("optionMinutes: proxyOpts.minutes, bookingOptions: proxyOpts.snapshot");
    expect(src).toContain("withOptions(proxySlotMinutes, proxyOpts.minutes)");
  });

  it("枠の一覧もオプション込みの長さで作る（終業ぎりぎりの枠がはみ出さない）", () => {
    expect(src).toContain("tenant?.operating_hours, proxySessionMinutes, weekdayOfDateKey(proxyDateKey),");
  });
});

describe("Edge Function（Deno なので src/ を import できない＝写し忘れが起きる場所）", () => {
  it("新規予約メール／プッシュがオプションぶんを足している", () => {
    const fn = readCode("supabase/functions/notify-new-booking/index.ts");
    expect(fn).toContain("option_minutes");
    expect(fn).toContain("const sessionMinutes = slotMinutes + optionMinutes;");
  });

  it("お客様のカレンダー購読（ICS）がオプションぶんを足している", () => {
    const fn = readCode("supabase/functions/calendar-feed/index.ts");
    expect(fn).toContain("option_minutes");
    expect(fn).toContain("slotMinutes + optionMinutes + bufferMinutes");
  });

  it("トレーナーのGoogleカレンダーがオプションぶんを足している（作成と一括同期の両方）", () => {
    const fn = readCode("supabase/functions/google-calendar-sync/index.ts");
    expect(fn).toContain("createOptionMinutes");
    expect(fn).toMatch(/item as \{ option_minutes\?: number \| null \}/);
  });
});

describe("控え（スナップショット）", () => {
  const options = [
    opt({ id: "a", name: "ストレッチ相当", duration_minutes: 30, price_yen: 3000, sort_order: 1 }),
    opt({ id: "b", name: "追加メニューB", duration_minutes: 0, price_yen: 500, sort_order: 0 }),
  ];

  it("選んだものだけを、一覧の並び順で控える", () => {
    expect(buildOptionSnapshot(options, ["a", "b"]).map((o) => o.id)).toEqual(["a", "b"]);
    expect(buildOptionSnapshot(options, ["b"]).map((o) => o.id)).toEqual(["b"]);
    expect(buildOptionSnapshot(options, [])).toEqual([]);
  });

  it("控えには名前と金額も残す（あとで booking_options を直しても過去の予約が変わらない）", () => {
    const snap = buildOptionSnapshot(options, ["a"]);
    expect(snap[0]).toEqual({ id: "a", name: "ストレッチ相当", duration_minutes: 30, price_yen: 3000 });
  });

  it("🔴 DB に何が入っていても画面を落とさない", () => {
    expect(parseOptionSnapshot(null)).toEqual([]);
    expect(parseOptionSnapshot("こわれた値")).toEqual([]);
    expect(parseOptionSnapshot([{ name: "" }, null, 3])).toEqual([]);
    expect(parseOptionSnapshot([{ name: "X", duration_minutes: "30" }])).toEqual([
      { id: "", name: "X", duration_minutes: 0, price_yen: 0 },
    ]);
  });

  it("option_minutes が読めない環境（列が無い）は 0 に倒れる", () => {
    expect(readOptionMinutes(undefined)).toBe(0);
    expect(readOptionMinutes(null)).toBe(0);
    expect(readOptionMinutes("30")).toBe(0);
    expect(readOptionMinutes(-5)).toBe(0);
    expect(readOptionMinutes(30)).toBe(30);
    expect(readOptionMinutes(30.7)).toBe(30);
  });
});

describe("🔴 「60分」の直書きをやめた（オプション以前から嘘だった）", () => {
  it("ダッシュボードの今日の予定が予約行の実際の長さを出す", () => {
    const src = readCode("src/components/trainer/TrainerDashboard.tsx");
    expect(src).not.toContain('t("dashboard.minutes60")');
    expect(src).toContain("minutesBetween(b.startTime, b.endTime)");
  });

  it("minutesBetween が開始と終了から分数を出す", () => {
    expect(minutesBetween("09:00", "10:30")).toBe(90);
    expect(minutesBetween("09:00", "09:50")).toBe(50);
    // 壊れた値でも負や NaN を返さない（画面に「-1分」を出さない）
    expect(minutesBetween("10:00", "09:00")).toBe(0);
    expect(minutesBetween("", "10:00")).toBe(0);
  });

  it("カルテの予約一覧も parseBooking と同じ規則になっている", () => {
    const src = readCode("src/components/trainer/TrainerClientDetail.tsx");
    expect(src).toContain("withOptions(rowSlotMinutes, readOptionMinutes(");
  });
});

describe("文言（5言語）", () => {
  const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
  for (const lang of LOCALES) {
    it(`${lang} にオプション選択欄の文言がある`, () => {
      const json = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      for (const k of ["pickerTitle", "pickerHint", "pickerPlusMinutes", "pickerPrice"]) {
        expect(json.bookingOptions[k], `${lang} bookingOptions.${k}`).toBeTruthy();
      }
      expect(json.common.minutesCount, `${lang} common.minutesCount`).toContain("{{count}}");
    });
  }
});
