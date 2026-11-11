/**
 * 通知の「開く先」の URL で、外部サイトへ飛ばせないこと（2026-10-31・send-push-notification-2）。
 *
 * "/" で始まり "//" で始まらない、だけでは足りなかった。ブラウザは URL を解釈するときにタブや改行を取り除き、
 * http(s) ではバックスラッシュを "/" と同じに扱うので、"/\evil.example" や "/<タブ>/evil.example" は
 * 開くと https://evil.example/ に解決される。送る側（send-push-notification）・開く側（アプリ・Service Worker）の
 * 3か所で同じ判定を使う。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isAllowedPushUrl, isSafeInAppPath as serverSafePath } from "../../supabase/functions/_shared/safeUrl";
import { isSafeInAppPath as clientSafePath } from "@/lib/safePath";

const APP = "https://app.kyoto-salute.com";
const HOSTS = new Set(["app.kyoto-salute.com", "gymboard.lovable.app"]);

/** 外へ飛ばせてしまう形（どれも「/ で始まり // で始まらない」を通るものを含む） */
const ATTACKS = [
  "//evil.example",
  "//evil.example/path",
  "/\\evil.example",
  "/\\/evil.example",
  "/\t/evil.example",
  "/\n/evil.example",
  "/\r/evil.example",
  "/ /evil.example",
  "\t//evil.example",
  "javascript:alert(1)",
  "https://evil.example/",
  "http://app.kyoto-salute.com/",
  "https://app.kyoto-salute.com.evil.example/",
  "data:text/html,<script>alert(1)</script>",
];

/** 今のアプリが実際に送っている形 */
const SAFE_PATHS = ["/", "/booking", "/trainer?tab=schedule", "/trial/abc/menu/def"];

describe("送る側（_shared/safeUrl.ts の isAllowedPushUrl）", () => {
  it.each(ATTACKS)("%j は送らない", (u) => {
    expect(isAllowedPushUrl(u, APP, HOSTS)).toBe(false);
  });

  it.each(SAFE_PATHS)("%j は送る", (u) => {
    expect(isAllowedPushUrl(u, APP, HOSTS)).toBe(true);
  });

  it("空なら既定（/）を使うので可・許したホストの https は可", () => {
    expect(isAllowedPushUrl(undefined, APP, HOSTS)).toBe(true);
    expect(isAllowedPushUrl("", APP, HOSTS)).toBe(true);
    expect(isAllowedPushUrl("https://app.kyoto-salute.com/booking", APP, HOSTS)).toBe(true);
    expect(isAllowedPushUrl(123, APP, HOSTS)).toBe(false);
  });

  it("自分のアプリの中のパスの判定も同じ", () => {
    for (const u of ATTACKS) expect(serverSafePath(u, APP), u).toBe(false);
    for (const u of SAFE_PATHS) expect(serverSafePath(u, APP), u).toBe(true);
  });
});

describe("開く側（アプリ: src/lib/safePath.ts の isSafeInAppPath）", () => {
  it.each(ATTACKS)("%j は開かない", (u) => {
    expect(clientSafePath(u, APP)).toBe(false);
  });

  it.each(SAFE_PATHS)("%j は開く", (u) => {
    expect(clientSafePath(u, APP)).toBe(true);
  });
});

describe("開く側（Service Worker: public/sw.js）", () => {
  const sw = readFileSync("public/sw.js", "utf8");

  it("通知のタップで開くのは safeNotificationPath を通した先だけ", () => {
    expect(sw).toContain("const url = safeNotificationPath(event.notification.data?.url);");
    expect(sw).not.toMatch(/const url = event\.notification\.data\?\.url \|\| '\/';/);
  });

  it("判定はアプリ側と同じ（空白・制御文字・バックスラッシュ・// を弾き、origin を比べる）", () => {
    const body = sw.slice(sw.indexOf("function safeNotificationPath"), sw.indexOf("self.addEventListener('notificationclick'"));
    expect(body).toContain("raw.startsWith('//')");
    expect(body).toContain("/[\\u0000-\\u0020\\u007f\\\\]/.test(raw)");
    expect(body).toContain("new URL(raw, self.location.origin).origin === self.location.origin");
    // 同じ関数を実際に動かして、攻撃の形がすべて "/" に倒れることを見る
    const fn = new Function("self", `${body}; return safeNotificationPath;`)({ location: { origin: APP } }) as (u: unknown) => string;
    for (const u of ATTACKS) expect(fn(u), u).toBe("/");
    for (const u of SAFE_PATHS) expect(fn(u), u).toBe(u);
  });
});

describe("send-push-notification の他の守り（2026-10-31）", () => {
  const src = readFileSync("supabase/functions/send-push-notification/index.ts", "utf8");

  it("🔴 体験予約の通知（purpose = trial_booking）は service_role だけ・url を受け取らない", () => {
    const i = src.indexOf('if (purpose === "trial_booking") {');
    const block = src.slice(i, i + 1600);
    expect(block).toContain("const trialCaller = await verifyCaller(req);");
    expect(block).toMatch(/if \(!trialCaller\?\.isServiceRole\) \{\s*return new Response\(JSON\.stringify\(\{ error: "Forbidden" \}\), \{\s*status: 403/);
    expect(block).toContain("url = undefined;");
  });

  it("担当の判定は、インストラクターのジムの予約・記録だけで行う", () => {
    const i = src.indexOf("async function dropUnassignedInstructors(");
    const fn = src.slice(i, src.indexOf("\n}\n", i));
    expect(fn).toContain(".select(\"user_id, tenant_id\")");
    expect((fn.match(/\.in\("tenant_id", instructorTenants\)/g) ?? []).length).toBe(3);
  });

  it("宛先が全員外れたときも、理由を応答に出さない", () => {
    expect(src).not.toContain('skipped: "no_recipients"');
  });

  // 2026-11-10 定期点検 send-push-notification-routing-oracle-1: お客様がタグに他のお客様の user_id を入れて先生宛てに送ると、
  // 先生が外れたか（＝その人のその日の予約の担当）が応答の形で分かった
  it("🔴 先生のジムのスタッフでない呼び出しは、本人の予約のタグのときだけ振り分ける", () => {
    const i = src.indexOf("async function dropUnassignedInstructors(");
    const fn = src.slice(i, src.indexOf("\n}\n", i));
    expect(fn).toContain("const restrictTo = scope && !instructorTenants.every((t) => scope.staffTenants.has(t)) ? scope.callerId : null;");
    expect(fn).toContain('if (restrictTo && parsed.kind !== "booking" && parsed.customerId !== restrictTo) return userIds;');
    expect(fn).toContain('if (restrictTo) q = q.eq("user_id", restrictTo);');
    // 予約・記録を読む前に決める
    expect(fn.indexOf("const restrictTo")).toBeLessThan(fn.indexOf('.from("bookings")'));
    // 画面からの呼び出しでは範囲を必ず渡す（自分宛てだけでも）
    expect((src.match(/routingScope = \{\n\s+callerId,/g) ?? []).length).toBe(2);
  });

  it("🔴 画面からの呼び出しには件数を返さない（外れた・届いた・端末の数で見分けさせない）", () => {
    expect(src).toContain("return new Response(JSON.stringify(quietResponse ? { ok: true } : { sent: 0, total: 0 }), {");
    const final = src.slice(src.indexOf("const totalTargets = subscriptions.length + devices.length;"));
    const quietAt = final.indexOf("if (quietResponse) {\n      return new Response(JSON.stringify({ ok: true })");
    expect(quietAt).toBeGreaterThan(-1);
    expect(quietAt).toBeLessThan(final.indexOf("sent: totalSent,"));
    // 画面の通常の経路・キャンセル待ちの経路の両方で付ける
    expect((src.match(/quietResponse = true;/g) ?? []).length).toBe(2);
  });

  it("今のアプリは送信の応答の件数を読んでいない（{ ok: true } にしても変わらない）", () => {
    for (const f of ["src/hooks/useBookings.ts", "src/hooks/bookingOptionEdit.ts", "src/lib/staffNotify.ts"]) {
      const app = readFileSync(f, "utf8");
      expect(app, f).not.toMatch(/\.(sent|total|vapidRejected|configRejected)\b/);
    }
  });
});

describe("キャンセル待ちの空き通知の開く先（2026-11-11・定期点検 send-push-notification-waitlist-url-1）", () => {
  const src = readFileSync("supabase/functions/send-push-notification/index.ts", "utf8");

  it("🔴 呼んだ人の url を受け取らない（他のお客様に届く通知の開く先を決めさせない）", () => {
    const block = src.slice(src.indexOf('} else if (purpose === "waitlist_slot_freed") {'), src.indexOf("} else {\n      // ---- Authenticated path ----"));
    expect(block.length).toBeGreaterThan(100);
    // 認証の確かめより前に捨てる（どの分岐でも残らない）
    expect(block.indexOf("url = undefined;")).toBeGreaterThan(-1);
    expect(block.indexOf("url = undefined;")).toBeLessThan(block.indexOf("const caller = await verifyCaller(req);"));
  });

  it("アプリはこの経路で url を送っていない（固定しても変わらない）", () => {
    const app = readFileSync("src/hooks/useBookings.ts", "utf8");
    const call = app.slice(app.indexOf('purpose: "waitlist_slot_freed"'));
    expect(call.slice(0, 200)).not.toContain("url");
  });
});
