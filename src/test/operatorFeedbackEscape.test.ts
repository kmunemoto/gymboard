/**
 * 運営への要望メールに、ジム名・表示名が HTML のまま入っていた穴（2026-11-01・点検の拡大
 * operator-feedback-1 / notify-operator-feedback-1）。
 *   `supabase/migrations/20261101070000_operator_feedback_escape.sql`
 *
 * ジムは誰でも開けて、ジム名も表示名も好きに付けられる。ジム名を `<a href="https://evil.example/">【Stripe】…</a>` にして
 * 要望を1件送るだけで、自社ドメインから運営者の受信箱へ、偽のボタン付きのメールを「Stripe」の名前で届けられた。
 *
 * 本番で、要望を1件入れてキューに積まれたメールを読み（全部取り消し）、適用前は生のタグ・差出人が「Stripe」・件名に改行、
 * 適用後はすべてエスケープ・差出人は固定・改行なし、を確かめた（mem/ops/tenant-boundary.md 穴24）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (s: string) => stripSql(s).replace(/\s+/g, " ").trim();

const MIGRATION = "20261101070000_operator_feedback_escape.sql";
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
const SQL = norm(read(`supabase/migrations/${MIGRATION}`));
const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.notify_operator_feedback()"));
const ESCAPE5 = (v: string) =>
  `replace(replace(replace(replace(replace(${v}, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')`;

describe("notify_operator_feedback（20261101070000）", () => {
  it("これが最新の定義", () => {
    const last = [...migrations].reverse().find((f) => norm(read(`supabase/migrations/${f}`)).includes("CREATE OR REPLACE FUNCTION public.notify_operator_feedback()"));
    expect(last).toBe(MIGRATION);
  });

  it("🔴 HTML に入れる値（本文・ジム名・表示名）は5文字ともエスケープする", () => {
    expect(fn).toContain(`v_body_html := ${ESCAPE5("NEW.body")};`);
    expect(fn).toContain(`v_gym_html := ${ESCAPE5("coalesce(v_gym, '-')")};`);
    expect(fn).toContain(`v_sender_html := ${ESCAPE5("coalesce(v_sender, '-')")};`);
    const html = fn.slice(fn.indexOf("'html',"), fn.indexOf("'text',"));
    expect(html).toContain("v_gym_html");
    expect(html).toContain("v_sender_html");
    expect(html).toContain("v_body_html");
    // 生の値を HTML に入れていない
    expect(html).not.toMatch(/coalesce\(v_gym|coalesce\(v_sender|NEW\.body/);
  });

  it("🔴 差出人の表示名は固定（ジム名で「Stripe」などを名乗らせない）", () => {
    expect(fn).toContain("'from', '運営への要望 <noreply@' || v_domain || '>',");
  });

  it("件名に入れるジム名・表示名は改行を除く（ヘッダーに改行を入れさせない）", () => {
    expect(fn).toContain("regexp_replace(coalesce(v_gym, '(店舗名なし)'), '[\\r\\n]+', ' ', 'g')");
    expect(fn).toContain("regexp_replace(coalesce(v_sender, '(名前未設定)'), '[\\r\\n]+', ' ', 'g')");
  });

  it("今までのもの（宛先・差出ドメイン・配信停止トークン・1時間の上限・保存は止めない）は残っている", () => {
    const brand = read("src/lib/brand.ts");
    const to = fn.match(/v_to CONSTANT TEXT := '([^']+)'/)?.[1];
    expect(to).toBe(brand.match(/SUPPORT_EMAIL = "([^"]+)"/)?.[1]);
    const send = read("supabase/functions/send-transactional-email/index.ts");
    expect(fn.match(/v_domain CONSTANT TEXT := '([^']+)'/)?.[1]).toBe(send.match(/const SENDER_DOMAIN = "([^"]+)"/)?.[1]);
    expect(fn).toContain("'unsubscribe_token', v_unsub,");
    expect(fn).toContain("created_at > now() - interval '1 hour'; IF v_recent > 5 THEN RETURN NEW; END IF;");
    expect(fn).toContain("EXCEPTION WHEN OTHERS THEN RAISE WARNING");
    expect(fn.slice(0, fn.indexOf("AS $function$"))).toContain("SECURITY DEFINER");
  });
});
