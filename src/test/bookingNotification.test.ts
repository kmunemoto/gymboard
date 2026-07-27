import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// 定期予約（繰り返し予約）で、2回目以降の予約受付メールが届かなかった件の回帰テスト。
//
// 原因: sendBookingNotification が予約1件しか受け取らず、呼び出し側が
// createRecurringBookings の戻り値の **1件目だけ**（booked[0]）を渡していた。
// 作成自体は全件成功しているのでUI上は正常に見え、メールだけが落ちていた。

const invoke = vi.fn().mockResolvedValue({ data: { success: true }, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/lib/tenantHelper", () => ({
  fetchMyTenantTrainerId: () => Promise.resolve("trainer-1"),
  fetchMyTenantGymName: () => Promise.resolve("テストジム"),
}));
vi.mock("@/lib/nativeBridge", () => ({ getWebOrigin: () => "https://example.test" }));

const { sendBookingNotifications } = await import("@/lib/bookingNotification");

/** invoke に渡された body のうち、テンプレート名が一致するものを取り出す */
const bodiesFor = (templateName: string) =>
  invoke.mock.calls
    .map(([, opts]) => (opts as { body: Record<string, any> }).body)
    .filter((b) => b.templateName === templateName);

const THREE_WEEKS = [
  { id: "b1", date: "2026-08-03" },
  { id: "b2", date: "2026-08-10" },
  { id: "b3", date: "2026-08-17" },
];

beforeEach(() => invoke.mockClear());

describe("予約メール", () => {
  it("定期予約は全件ぶん送る（2回目以降が落ちない）", async () => {
    await sendBookingNotifications(THREE_WEEKS, "山田 太郎", "14:00", "15:00", "月4回プラン", "user-1");

    const toCustomer = bodiesFor("booking-confirmation");
    expect(toCustomer, "顧客への受付メールが予約件数ぶん送られていない").toHaveLength(3);
    const toTrainer = bodiesFor("new-booking-notification");
    expect(toTrainer, "トレーナーへの通知が予約件数ぶん送られていない").toHaveLength(3);
  });

  it("各メールの日付がその回の日付になっている", async () => {
    // 全件送っていても、日付が1件目のまま複製されていたら意味がない。
    await sendBookingNotifications(THREE_WEEKS, "山田 太郎", "14:00", "15:00", "月4回プラン", "user-1");

    const dates = bodiesFor("booking-confirmation").map((b) => b.templateData.bookingDate);
    expect(dates).toEqual(["8月3日（月）", "8月10日（月）", "8月17日（月）"]);
    expect(new Set(dates).size, "同じ日付のメールが複製されている").toBe(3);
  });

  it("冪等キーが予約ごとに違う（重複排除で消えない）", async () => {
    // キーが同じだと、送信側の重複排除で2通目以降が捨てられる。
    await sendBookingNotifications(THREE_WEEKS, "山田 太郎", "14:00", "15:00", "月4回プラン", "user-1");

    const keys = bodiesFor("booking-confirmation").map((b) => b.idempotencyKey);
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual([
      "booking-confirm-customer-b1",
      "booking-confirm-customer-b2",
      "booking-confirm-customer-b3",
    ]);
  });

  it("1件だけの予約はこれまでどおり1通ずつ", async () => {
    await sendBookingNotifications(
      [{ id: "b1", date: "2026-08-03" }], "山田 太郎", "14:00", "15:00", "月4回プラン", "user-1");

    expect(bodiesFor("booking-confirmation")).toHaveLength(1);
    expect(bodiesFor("new-booking-notification")).toHaveLength(1);
  });

  it("0件なら何も送らない", async () => {
    // 定期予約が全週スキップされた場合。呼び出し側は既にエラー表示して抜けるが、
    // ここでも空振りさせない。
    await sendBookingNotifications([], "山田 太郎", "14:00", "15:00", "月4回プラン", "user-1");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("顧客IDが無ければ顧客宛は送らない（トレーナー宛だけ）", async () => {
    await sendBookingNotifications(THREE_WEEKS, "山田 太郎", "14:00", "15:00", "月4回プラン");
    expect(bodiesFor("booking-confirmation")).toHaveLength(0);
    expect(bodiesFor("new-booking-notification")).toHaveLength(3);
  });

  it("呼び出し側が作成した予約を全件渡している", () => {
    // ここが落ちる = また 1件目だけを渡す実装に戻っている。
    // 引数が配列なので型でも守られるが、booked[0] を [] で包めばすり抜けるため文面でも見る。
    for (const file of [
      "src/components/customer/CustomerBooking.tsx",
      "src/components/trainer/TrainerSchedule.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} が sendBookingNotifications を使っていない`)
        .toMatch(/sendBookingNotifications\(\s*createdBookings\b/);
      expect(src, `${file} で1件目だけを渡している`).not.toMatch(/sendBookingNotifications\(\s*\[/);
    }
  });
});
