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
import {
  CANCELLED_BOOKING_STATUSES,
  EVENT_CLAIM_TTL_MS,
  eventClaimStartedAt,
  eventSlotOf,
  isGoogleEventId,
  makeEventClaim,
} from "../../supabase/functions/_shared/calendarEventSlot";

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
    expect(src).toContain("const slot = eventSlotOf(booking.google_event_id, Date.now());");
    expect(src).toMatch(/if \(slot\.kind === "check"\) \{\s*const checkRes = await fetch\(`\$\{baseUrl\}\/\$\{encodeURIComponent\(slot\.eventId\)\}`/);
    expect(src).toContain("return json({ success: true, event_id: slot.eventId, already_present: true });");
  });

  it("🔴 予定を作る前に、条件付きの UPDATE で作る権利（印）を取る（同時に呼ばれても1件・google-calendar-sync-3）", () => {
    const create = src.slice(src.indexOf('if (action === "create") {'), src.indexOf('} else if (action === "delete") {'));
    const claim = create.indexOf("const marker = await claimEventSlot(supabase, table, booking.id, expected);");
    expect(claim).toBeGreaterThan(-1);
    expect(create).toMatch(/if \(!marker\) \{[^}]*return json\(\{ success: true, in_progress: true \}\);/);
    // 印を取るのは Google に予定を作るより前、書き戻すのは後
    expect(claim).toBeLessThan(create.indexOf("const createRes = await fetch(baseUrl, {"));
    expect(create.indexOf("await settleEventSlot(supabase, table, booking.id, marker, newEventId)")).toBeGreaterThan(
      create.indexOf("const createRes = await fetch(baseUrl, {"),
    );
    // 書き戻せなかった（その間に取り消された）ら、作った予定を消す
    expect(create).toMatch(/if \(!\(await settleEventSlot\(supabase, table, booking\.id, marker, newEventId\)\)\) \{\s*await fetch\(`\$\{baseUrl\}\/\$\{encodeURIComponent\(newEventId\)\}`, \{\s*method: "DELETE",/);
    // 作れなかったら印を外す
    expect(create).toMatch(/if \(!createOk \|\| !isGoogleEventId\(newEventId\)\) \{\s*await settleEventSlot\(supabase, table, booking\.id, marker, null\);/);
  });

  it("作る権利は「読んだときの値のままなら」の条件付きで取る・書き戻しも印のままのときだけ", () => {
    expect(src).toMatch(/expected === null\s*\? update\.is\("google_event_id", null\)\s*: update\.eq\("google_event_id", expected\)\s*\)\.select\("id"\);/);
    expect(src).toContain('return (data?.length ?? 0) === 1 ? marker : null;');
    expect(src).toMatch(/\.update\(\{ google_event_id: eventId \}\)\s*\.eq\("id", bookingId\)\s*\.eq\("google_event_id", marker\)\s*\.select\("id"\);/);
  });

  it("予定があるかの確認が 404・410 以外で失敗したら作らない（2件にしない）", () => {
    const create = src.slice(src.indexOf('if (action === "create") {'), src.indexOf('} else if (action === "delete") {'));
    expect(create).toMatch(
      /if \(checkRes\.status !== 404 && checkRes\.status !== 410\) \{\s*console\.error\([^;]*\);\s*return json\(\{ error: "Failed to check event" \}, 502\);\s*\}\s*expected = slot\.eventId;/,
    );
    const sync = src.slice(src.indexOf('} else if (action === "sync_all") {'));
    expect(sync).toContain("if (checkRes.status !== 404 && checkRes.status !== 410) { failed++; continue; }\n          expected = slot.eventId;");
  });

  it("取り消した予約（当日の取り消しで消化も）の予定は作らない", () => {
    expect(src).toContain('if (CANCELLED_BOOKING_STATUSES.has(booking.status ?? "")) {');
    expect(src).toContain('const bookings = (bookingRows || []).filter((b) => !CANCELLED_BOOKING_STATUSES.has(b.status ?? ""));');
  });

  it("sync_all も同じ決まり（印を取ってから作る）", () => {
    const sync = src.slice(src.indexOf('} else if (action === "sync_all") {'));
    expect(sync).toContain("const slot = eventSlotOf(item.google_event_id, Date.now());");
    const claim = sync.indexOf("const marker = await claimEventSlot(supabase, item.source, item.id, expected);");
    expect(claim).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(sync.indexOf("const createRes = await fetch(baseUrl, {"));
    expect(sync).toContain("} else if (await settleEventSlot(supabase, item.source, item.id, marker, newEventId)) {");
  });

  it("どの版が動いているかを応答の見出しで確かめられる", () => {
    expect(src).toMatch(/const BUILD = "2026-11-11-one-event-per-booking";/);
    expect(src).toContain('"x-gymboard-build": BUILD,');
  });

  it("🔴 予定 ID の形でない値（作っている最中の印・壊れた値）は Google に送らない", () => {
    const del = src.slice(src.indexOf('} else if (action === "delete") {'), src.indexOf('} else if (action === "sync_all") {'));
    const guard = del.indexOf("if (!isGoogleEventId(eventId)) {");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(del.indexOf("await fetch(`${baseUrl}/${encodeURIComponent(eventId)}`, {"));
    // 列を空に戻すのは、読んだ値のままのときだけ（その間に作り直された予定の ID を消さない）
    expect(del.match(/\.update\(\{ google_event_id: null \}\)\.eq\("id", booking\.id\)\.eq\("google_event_id", eventId\);/g)?.length).toBe(2);
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

describe("1予約1件の決まり（_shared/calendarEventSlot.ts）", () => {
  const NOW = 1_800_000_000_000;

  it("Google の予定 ID の形だけを通す", () => {
    expect(isGoogleEventId("abc12def34ghij5678klmnopqr")).toBe(true);
    expect(isGoogleEventId("a1b2c")).toBe(true);
    for (const bad of ["abcd", "ABCDEF", "abc_def", "abc/def", "../x1", "creating:1:x", "wxyz12", "a".repeat(1025), "", null, 12345]) {
      expect(isGoogleEventId(bad), String(bad)).toBe(false);
    }
  });

  it("印は本物の予定 ID と取り違えない", () => {
    const claim = makeEventClaim(NOW, "nonce");
    expect(isGoogleEventId(claim)).toBe(false);
    expect(eventClaimStartedAt(claim)).toBe(NOW);
    expect(eventClaimStartedAt("abc12def34")).toBeNull();
    expect(eventClaimStartedAt("creating:abc")).toBe(0);
  });

  it("列の値から、することを決める", () => {
    expect(eventSlotOf(null, NOW)).toEqual({ kind: "empty" });
    expect(eventSlotOf("", NOW)).toEqual({ kind: "empty" });
    expect(eventSlotOf("abc12def34", NOW)).toEqual({ kind: "check", eventId: "abc12def34" });
    // 作っている最中（新しい印）は何もしない。時計の少しのずれも同じ
    expect(eventSlotOf(makeEventClaim(NOW - 1000, "x"), NOW)).toEqual({ kind: "in_progress" });
    expect(eventSlotOf(makeEventClaim(NOW + 1000, "x"), NOW)).toEqual({ kind: "in_progress" });
    // 古い印・壊れた印・遠い未来の印・形の合わない値は、その値を条件に取り直す
    const old = makeEventClaim(NOW - EVENT_CLAIM_TTL_MS, "x");
    expect(eventSlotOf(old, NOW)).toEqual({ kind: "reclaim", expected: old });
    expect(eventSlotOf("creating:abc", NOW)).toEqual({ kind: "reclaim", expected: "creating:abc" });
    const future = makeEventClaim(NOW + EVENT_CLAIM_TTL_MS, "x");
    expect(eventSlotOf(future, NOW)).toEqual({ kind: "reclaim", expected: future });
    expect(eventSlotOf("Bad/Value", NOW)).toEqual({ kind: "reclaim", expected: "Bad/Value" });
  });

  it("取り消し・当日の取り消し（消化）の予約には予定を作らない", () => {
    expect([...CANCELLED_BOOKING_STATUSES].sort()).toEqual(["キャンセル済み", "同日キャンセル済み"].sort());
    expect(CANCELLED_BOOKING_STATUSES.has("予約済み")).toBe(false);
    expect(CANCELLED_BOOKING_STATUSES.has("完了")).toBe(false);
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
