/**
 * 前日リマインド（push-booking-reminder）は、お客様 × ジム で1通ずつ（2026-11-11・定期点検 booking-reminder-tenant-1）。
 *   `supabase/functions/push-booking-reminder/index.ts`
 *
 * 以前はお客様ごとに全部のジムの予約を1通にまとめ、最初の予約のジムの送信履歴（template_data.bookingTimes）に残していた。
 * 2つのジムに所属の行がある人だと、片方のジムのスタッフが、もう片方のジムでの予約の時刻を読めた
 * （予約を代理で早い時刻に入れておけば、毎日その人の別のジムの予定を追えた）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("supabase/functions/push-booking-reminder/index.ts", "utf8");
const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("push-booking-reminder: お客様 × ジム でまとめる", () => {
  it("🔴 まとめる鍵に、お客様とジムの両方を使う（お客様だけでまとめない）", () => {
    expect(code).toContain("const key = `${b.user_id}|${b.tenant_id ?? \"\"}`;");
    expect(code).toContain("for (const userBookings of byUserTenant.values()) {");
    expect(code).not.toMatch(/byUser\.set\(b\.user_id/);
  });

  it("🔴 送信履歴の載り先・ジム名・ご案内は、その1通のジムのもの", () => {
    expect(code).toContain("const tenantId = sorted[0].tenant_id as string | null;");
    // 1通にまとめる予約は、どれも同じジム（鍵で分けてある）
    const send = code.slice(code.indexOf('invoke("send-transactional-email"'));
    expect(send.slice(0, 600)).toContain("tenantId,");
    expect(send.slice(0, 600)).toContain("bookingTimes: times,");
  });

  it("プラン名は、そのジムの所属のときだけ profiles.plan を使う（別のジムのプラン名を出さない）", () => {
    expect(code).toContain("(profile?.tenant_id === tenantId ? profile?.plan : null) || sorted[0].booking_type");
  });

  it("冪等キー・プッシュのタグにジムを入れる（2つのジムの1通どうしで重ならない・端末で置き換わらない）", () => {
    expect(code).toContain("idempotencyKey: `booking-reminder-${userId}-${tenantId ?? \"none\"}-${tomorrowDateStr}`,");
    expect(code).toContain("tag: `booking-reminder-${tomorrowDateStr}-${tenantId ?? \"none\"}`,");
  });

  it("デプロイの印を付ける", () => {
    expect(code).toMatch(/const BUILD = "\d{4}-\d{2}-\d{2}-[a-z-]+";/);
    expect(code).toContain('"x-gymboard-build": BUILD,');
  });
});
