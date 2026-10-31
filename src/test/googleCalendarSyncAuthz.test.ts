/**
 * Google カレンダーの同期・連携と、通知の Edge Function の守り（2026-10-31・Edge Function の点検）。
 *
 * - google-calendar-sync-1: 印（hasRole(trainer)）だけで認可を素通りし、他のジムのオーナーのカレンダーに書けた
 * - google-calendar-sync-2: 予定の中身・消す予定の ID をリクエストから取っていた（お客様が店のカレンダーに任意の予定）
 * - google-calendar-callback-1: 本人がトークン（access_token・refresh_token）を API で読めた
 * - notify-new-booking / notify-new-message: 相手がそのジムの人かを確かめずに service_role で送っていた（穴13 の多層防御）
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
/** コメントを落とす（説明のために hasRole などの語を書いているため） */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");

describe("google-calendar-sync", () => {
  const FN = "supabase/functions/google-calendar-sync/index.ts";
  const src = code(FN);

  it("🔴 印（hasRole）を import も使用もしていない", () => {
    expect(src).not.toMatch(/\bhasRole\b/);
  });

  it("その予約のジムの有効なスタッフか、お客様本人の予約（体験は除く）だけ通す", () => {
    expect(src).toContain('.eq("status", "active")\n    .in("role", ["owner", "trainer"])');
    expect(src).toContain("const isStaff = !!tenantId && !!caller.userId && await isActiveStaffOf(supabase, tenantId, caller.userId);");
    expect(src).toContain("const isOwnBooking = !is_trial && !!booking && booking.user_id === caller.userId;");
    expect(src).toMatch(/if \(!isStaff && !isOwnBooking\) \{\s*return json\(\{ error: "Forbidden" \}, 403\);/);
  });

  it("sync_all は、呼んだ人が有効なスタッフのジムだけ", () => {
    expect(src).toMatch(/if \(!caller\.isServiceRole && !tenantId\) \{\s*return json\(\{ error: "Forbidden" \}, 403\);/);
  });

  it("🔴 予定の中身は予約行から作る（service_role の呼び出し元だけ表示用のラベルを渡せる）", () => {
    expect(src).toContain("const trusted = caller.isServiceRole;");
    expect(src).toContain('const eventType = trusted && typeof booking_type === "string" && booking_type ? booking_type : booking.booking_type;');
    expect(src).toContain('const eventDate = trusted && typeof booking_date === "string" && booking_date ? booking_date : booking.booking_date;');
    expect(src).toMatch(/displayName = \(prof as \{ display_name\?: string \| null \} \| null\)\?\.display_name \|\| "顧客";/);
  });

  it("1予約につき予定は1件（今のカレンダーに実在するなら作らない）", () => {
    expect(src).toMatch(/if \(booking\.google_event_id\) \{\s*const checkRes = await fetch\(`\$\{baseUrl\}\/\$\{encodeURIComponent\(booking\.google_event_id\)\}`/);
  });

  it("🔴 消す予定は予約行の ID だけ・エンコードしてから URL に入れる", () => {
    expect(src).toContain("const eventId = booking?.google_event_id ?? null;");
    expect(src).toContain("await fetch(`${baseUrl}/${encodeURIComponent(eventId)}`, {");
    expect(src).not.toMatch(/\$\{baseUrl\}\/\$\{google_event_id\}/);
    // リクエストの google_event_id を受け取っていない
    expect(src).not.toMatch(/const \{[^}]*\bgoogle_event_id\b[^}]*\} = /);
  });

  it("オプションぶんの長さ・インストラクターの連携を使わない（既存の約束を保つ）", () => {
    expect(src).toContain("createOptionMinutes");
    expect(src).toContain('.neq("staff_access", "limited")');
  });
});

describe("google_calendar_tokens（連携のトークン）", () => {
  const SQL = read("supabase/migrations/20261031080000_calendar_tokens_column_grants.sql");

  it("🔴 トークンの列は画面から読めない・書けない（連携の有無を見る列と解除だけ残す）", () => {
    expect(SQL).toContain("REVOKE SELECT, INSERT, UPDATE ON public.google_calendar_tokens FROM anon, authenticated;");
    const grant = /GRANT SELECT \(([^)]*)\) ON public\.google_calendar_tokens TO authenticated;/.exec(SQL);
    expect(grant).toBeTruthy();
    expect(grant![1]).not.toMatch(/access_token|refresh_token/);
    expect(grant![1]).toMatch(/\bid\b/);
    expect(grant![1]).toMatch(/\buser_id\b/);
  });

  it("画面はトークンの表から id しか読まない", () => {
    for (const f of ["src/components/trainer/TrainerNotificationSettings.tsx", "src/components/customer/CustomerSettings.tsx"]) {
      const s = read(f);
      for (const m of s.matchAll(/\.from\("google_calendar_tokens"\)\s*\.select\("([^"]*)"\)/g)) {
        expect(m[1], f).toBe("id");
      }
    }
  });
});

describe("通知の Edge Function: 相手がそのジムの人かを送る前に確かめる（穴13 の多層防御）", () => {
  it("notify-new-booking は、氏名を読む前に予約の人の所属を確かめる", () => {
    const src = code("supabase/functions/notify-new-booking/index.ts");
    const check = src.indexOf('await patchLog({ skip_reason: "user_not_member" });');
    expect(check).toBeGreaterThan(-1);
    expect(src).toMatch(/\.from\("tenant_members"\)\s*\.select\("id"\)\s*\.eq\("tenant_id", booking\.tenant_id\)\s*\.eq\("user_id", booking\.user_id\)/);
    // 氏名（profiles）を読むより前
    expect(check).toBeLessThan(src.indexOf('.from("profiles")'));
  });

  it("notify-new-message は、送り主と宛先の所属を確かめてからプッシュを中継する", () => {
    const src = code("supabase/functions/notify-new-message/index.ts");
    const check = src.indexOf('return json({ skipped: "party_not_member" });');
    expect(check).toBeGreaterThan(-1);
    expect(src).toContain('.in("user_id", [message.sender_id, message.receiver_id]);');
    expect(check).toBeLessThan(src.indexOf('supabase.functions.invoke("send-push-notification"'));
  });
});
