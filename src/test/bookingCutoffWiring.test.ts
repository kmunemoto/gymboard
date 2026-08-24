import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 「設定はあるのに誰も読んでいない」を二度と起こさないための番人。
//
// tenants.booking_cutoff_type / booking_cutoff_hours は 2026-08-03 まで
// オンボーディングで保存されるだけで、予約ロジックが一度も読んでいなかった。
// 結果として **どの店も当日予約を一切受けられなかった**。
// 型もテストもビルドも全部通るので、実際に予約しようとするまで気づけない種類のバグ。
//
// ロジック自体の検証は bookingCutoff.test.ts。ここは「配線されているか」だけを見る。

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** 予約できる画面（お客様・体験・ドロップイン）。全部が締切を読む必要がある。 */
const BOOKING_SCREENS = [
  "src/components/customer/CustomerBooking.tsx",
  "src/pages/TrialBooking.tsx",
  "src/pages/DropInBooking.tsx",
];

describe("予約締切の配線", () => {
  it.each(BOOKING_SCREENS)("%s が締切設定を読んでいる", (path) => {
    const src = read(path);
    expect(src).toMatch(/booking_cutoff_type/);
    expect(src).toMatch(/booking_cutoff_hours/);
    expect(src).toMatch(/isSlotPastCutoff/);
  });

  it.each(BOOKING_SCREENS)("%s に締切のベタ書きが復活していない", (path) => {
    const src = read(path);
    // 直していた実装:
    //   const bookingDayStart = new Date(`${date}T00:00:00+09:00`).getTime();
    //   return Date.now() >= bookingDayStart;
    expect(src).not.toMatch(/isBookingDayClosed/);
    expect(src).not.toMatch(/bookingDayStart/);
  });

  it("枠の生成ループが、その枠の時刻で判定している", () => {
    // hours_before は「枠の開始時刻」が基準なので、ループ変数 time を渡さないと成立しない。
    // 定数や "00:00" を渡すと日単位判定に戻り、「同じ日の遅い枠も一律で締切」という
    // 元のバグが再発する。
    //
    // ファイル内に1つでも該当があればOK、という緩い検査では駄目だった:
    // CustomerBooking には handleBook / handleReschedule の slot.time 版も
    // あるため、ループ側だけ壊しても素通りしてしまった（実際にすり抜けた）。
    // ここは「枠を push する直前の tooSoon 代入」そのものを見る。
    for (const path of BOOKING_SCREENS) {
      const src = read(path);
      expect(src, `${path}: 枠ごとの判定が time を使っていない`)
        .toMatch(/const tooSoon = isSlotPastCutoff\(dateKey, time, cutoff\);/);
    }
  });

  it("選択済みの枠を確定するときも、その枠の時刻で判定している", () => {
    // handleBook / handleReschedule。ここが日単位のままだと、
    // 画面上は選べるのに確定時だけ弾かれる。
    const src = read("src/components/customer/CustomerBooking.tsx");
    const hits = src.match(/isSlotPastCutoff\(dateKey, slot\.time, cutoff\)/g) ?? [];
    expect(hits.length, "handleBook と handleReschedule の2箇所を期待").toBe(2);
  });

  it("オンボーディングが保存する type が、ロジックが解釈する type と一致している", () => {
    // 保存側と解釈側で綴りがずれると、また「保存されるだけで効かない」に戻る
    const onboarding = read("src/pages/Onboarding.tsx");
    const lib = read("src/lib/bookingCutoff.ts");
    for (const type of ["prev_day", "hours_before"]) {
      expect(onboarding, `Onboarding が ${type} を保存しない`).toContain(type);
      expect(lib, `bookingCutoff が ${type} を解釈しない`).toContain(type);
    }
  });

  it("公開ページ用の RPC が締切列を返す", () => {
    // get_tenant_public が返さないと、未ログインの体験予約・ドロップインだけ
    // prev_day 固定のままになる（安全側だが、店の設定が効かない）
    const sql = read("supabase/migrations/20260803000000_booking_cutoff_and_capacity_prompt.sql");
    expect(sql).toMatch(/get_tenant_public/);
    expect(sql).toMatch(/booking_cutoff_type text/);
    expect(sql).toMatch(/booking_cutoff_hours integer/);
  });
});

describe("同時受入数を店に確認する導線", () => {
  const dashboard = read("src/components/trainer/TrainerDashboard.tsx");

  it("未確認（null）のときだけ出す。列が読めない（undefined）ときは出さない", () => {
    // === null であること。truthy 判定にすると、列が無い環境でも出てしまい、
    // 保存もできないのに聞き続けることになる。
    expect(dashboard).toMatch(/booking_capacity_confirmed_at === null/);
  });

  it("答えたら値と確認日時を同時に保存する", () => {
    expect(dashboard).toMatch(/booking_capacity: capacityAnswer/);
    expect(dashboard).toMatch(/booking_capacity_confirmed_at: new Date\(\)\.toISOString\(\)/);
  });

  it("オンボーディングを通った店は確認済みとして記録される", () => {
    // ⚠️ 2026-08-24 に開設は RPC（create_gym_with_owner）へ畳んだので、
    //    記録するのは SQL 側。ダッシュボードで二度聞かないための不変条件は変わらない
    const sql = read("supabase/migrations/20260824010000_create_gym_transaction.sql");
    const fn = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.create_gym_with_owner"),
      sql.indexOf("REVOKE ALL ON FUNCTION"),
    );
    expect(fn, "開設時に確認済みとして記録していません").toMatch(/booking_capacity_confirmed_at/);
  });

  it("選択肢が設定画面・オンボーディングと揃っている", () => {
    // ズレると「ダッシュボードで選べる値が設定画面に無い」ことが起きる
    const grab = (src: string, name: string) =>
      src.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`))?.[1].replace(/\s/g, "");
    const dash = grab(dashboard, "CONFIRM_CAPACITY_OPTIONS");
    const settings = grab(read("src/components/trainer/TrainerGymSettings.tsx"), "BUSINESS_CAPACITY_OPTIONS");
    const onboarding = grab(read("src/pages/Onboarding.tsx"), "CAPACITY_OPTIONS");
    expect(dash).toBeTruthy();
    expect(dash).toBe(settings);
    expect(dash).toBe(onboarding);
  });

  it("値を推測して書き換えていない", () => {
    // 「分からないから2にしておく」は、本当に1対1の店で二重予約を通してしまう。
    // 既定値は1のままで、聞くだけにすること。
    const sql = read("supabase/migrations/20260803000000_booking_cutoff_and_capacity_prompt.sql");
    expect(sql).not.toMatch(/UPDATE\s+public\.tenants\s+SET\s+booking_capacity/i);
    expect(sql).not.toMatch(/booking_capacity\s+integer\s+.*DEFAULT\s+[2-9]/i);
  });
});
