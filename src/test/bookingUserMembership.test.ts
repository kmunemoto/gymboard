/**
 * 予約・チャットの相手は、そのジムの人に限る（2026-10-31・穴13）。
 *   `supabase/migrations/20261031060000_booking_user_must_be_member.sql`
 *   `supabase/migrations/20261031070000_message_receiver_must_be_member.sql`
 *
 * ジムは誰でも開ける。自分のジムの予約・チャットの行に、他のジムの人の user_id を入れると、
 * service_role の通知（notify-new-booking / notify-new-message）がその人の氏名・メールアドレス・端末へ届いていた
 * （送信記録から氏名とアドレスも抜けた）。行を作る時点で「そのジムの人か」を確かめる。
 *
 * 🔴 壊しやすいもの:
 *   1. 門番を SECURITY DEFINER にする → current_user が常に所有者になり素通り
 *   2. 「在籍中だけ」に絞る → 退会したお客様への連絡・過去の予約の扱いが止まる
 *   3. 後のマイグレーションでトリガーを外す
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (src: string) => stripSql(src).replace(/\s+/g, " ").trim();
const BOOKING = "20261031060000_booking_user_must_be_member.sql";
const MESSAGE = "20261031070000_message_receiver_must_be_member.sql";
const BOOKING_SQL = norm(read(`supabase/migrations/${BOOKING}`));
const MESSAGE_SQL = norm(read(`supabase/migrations/${MESSAGE}`));
const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
const all = files.map((f) => ({ f, s: norm(read(`supabase/migrations/${f}`)) }));

/** 関数の最後の定義（ヘッダから本文の終わりまで） */
const lastDef = (name: string) => {
  const hit = [...all].reverse().find(({ s }) => s.includes(`CREATE OR REPLACE FUNCTION public.${name}(`));
  expect(hit, `${name} の定義が見つからない`).toBeTruthy();
  const s = hit!.s;
  const start = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = /AS (\$\w*\$)/.exec(s.slice(start))![1];
  const bodyStart = s.indexOf(tag, start) + tag.length;
  return { file: hit!.f, text: s.slice(start, s.indexOf(tag, bodyStart) + tag.length) };
};

describe("所属の判定（is_tenant_member_any_status）", () => {
  const def = lastDef("is_tenant_member_any_status");

  it("在籍の状態は問わない（退会したお客様への連絡・過去の予約を止めない）", () => {
    expect(def.text).toContain("m.tenant_id = p_tenant_id AND m.user_id = p_user_id");
    const body = def.text.slice(def.text.indexOf(" AS "));
    expect(body).not.toMatch(/\bstatus\b/);
    expect(def.text).toMatch(/STABLE SECURITY DEFINER/);
  });

  it("トリガーは呼んだ人の権限で動くので、authenticated から呼べる", () => {
    expect(BOOKING_SQL).toContain("REVOKE ALL ON FUNCTION public.is_tenant_member_any_status(uuid, uuid) FROM PUBLIC, anon;");
    expect(BOOKING_SQL).toContain(
      "GRANT EXECUTE ON FUNCTION public.is_tenant_member_any_status(uuid, uuid) TO authenticated, service_role;",
    );
  });
});

describe("予約: user_id はそのジムの人", () => {
  it("🔴 門番は SECURITY INVOKER で、画面から（authenticated）の書き込みだけを見る", () => {
    const def = lastDef("guard_booking_user_is_member");
    expect(def.file).toBe(BOOKING);
    expect(def.text).not.toContain("SECURITY DEFINER");
    expect(def.text).toContain(
      "IF current_user = 'authenticated' AND NOT public.is_tenant_member_any_status(NEW.tenant_id, NEW.user_id) THEN",
    );
  });

  it("INSERT と、user_id / tenant_id の付け替えに付いている（状態の更新では動かない）", () => {
    expect(BOOKING_SQL).toContain(
      "CREATE TRIGGER trg_guard_booking_user_is_member BEFORE INSERT OR UPDATE OF user_id, tenant_id ON public.bookings " +
        "FOR EACH ROW EXECUTE FUNCTION public.guard_booking_user_is_member();",
    );
  });

  it("画面の予約は、本人か代理予約のお客様の user_id で作る（所属している人）", () => {
    const src = read("src/hooks/useBookings.ts");
    expect(src).toMatch(/const basePayload = \{\s*user_id: userId,/);
  });
});

describe("チャット: 宛先はそのジムの人、お客様からはスタッフだけ", () => {
  it("🔴 門番は SECURITY INVOKER で、宛先の所属とお客様→スタッフを見る", () => {
    const def = lastDef("guard_message_receiver_is_member");
    expect(def.file).toBe(MESSAGE);
    expect(def.text).not.toContain("SECURITY DEFINER");
    expect(def.text).toContain("IF current_user = 'authenticated' THEN");
    expect(def.text).toContain("IF NOT public.is_tenant_member_any_status(NEW.tenant_id, NEW.receiver_id) THEN");
    expect(def.text).toContain(
      "IF NOT public.has_tenant_role(NEW.tenant_id, auth.uid(), ARRAY['owner', 'trainer']) " +
        "AND NOT public.has_tenant_role(NEW.tenant_id, NEW.receiver_id, ARRAY['owner', 'trainer']) THEN",
    );
  });

  it("INSERT と、宛先 / tenant_id の付け替えに付いている（既読では動かない）", () => {
    expect(MESSAGE_SQL).toContain(
      "CREATE TRIGGER trg_guard_message_receiver_is_member BEFORE INSERT OR UPDATE OF receiver_id, tenant_id ON public.messages " +
        "FOR EACH ROW EXECUTE FUNCTION public.guard_message_receiver_is_member();",
    );
  });

  it("お客様の画面は、スタッフ（trainerId）に送っている", () => {
    expect(read("src/components/customer/CustomerChat.tsx")).toMatch(/useMessages\(trainerId,/);
  });
});

describe("後から外していない・点検キット", () => {
  it("後のマイグレーションがトリガーを外していない", () => {
    for (const { f, s } of all.filter(({ f }) => f > MESSAGE)) {
      expect(s, f).not.toContain("DROP TRIGGER IF EXISTS trg_guard_booking_user_is_member");
      expect(s, f).not.toContain("DROP TRIGGER IF EXISTS trg_guard_message_receiver_is_member");
    }
  });

  it("security/check.sql に検査12がある", () => {
    const kit = read("security/check.sql");
    expect(kit).toContain("検査12: 予約・チャットの相手が、そのジムの人に限られているか");
    expect(kit.indexOf("検査12")).toBeLessThan(kit.indexOf("-- 検査7: cron の POST 先"));
  });
});
