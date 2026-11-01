/**
 * 招待（invite-customer）で、本人が使っているアカウントを乗っ取れた／招待リンクが送信履歴に残っていた
 * （2026-11-01・点検の拡大 invite-customer-1 / profiles-claimed-at-1 / invite-link-in-log-1 / invite-customer-2）。
 *
 * 1. オーナーが profiles.claimed_at を API で消して招待し直すと、本人のアカウントのメールを自分のアドレスに替え、
 *    パスワード設定リンクを受け取って乗っ取れた
 *    → DB の門番（claimed_at などを画面から変えられない）＋ invite-customer は auth 側の事実（ログインしたか）で見る
 * 2. 招待リンク（token_hash 入り）が送信履歴（email_send_log）にそのまま残り、インストラクターも読めた
 *    → 履歴に残す値は redactTemplateDataForLog で伏せる。招待は再送しない（新しいリンクで招待し直す）
 * 3. 取り込みのアカウントを宛先だけ替えて、正規の送信元から何通でも招待メールを送れた → 1つのジムで1日の上限
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { redactTemplateDataForLog, REDACTED_FOR_LOG } from "../../supabase/functions/_shared/logSafety";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (s: string) => stripSql(s).replace(/\s+/g, " ").trim();
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");

const MIGRATION = "20261101020000_profile_claim_fields_guard.sql";
const SQL = norm(read(`supabase/migrations/${MIGRATION}`));
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
const lastDefFile = (name: string) =>
  [...migrations].reverse().find((f) => norm(read(`supabase/migrations/${f}`)).includes(`CREATE OR REPLACE FUNCTION public.${name}(`));

describe("DB: 取り込み・招待・本人が来た、の印は画面から変えられない", () => {
  const start = SQL.indexOf("CREATE OR REPLACE FUNCTION public.guard_profile_claim_fields()");
  const fn = SQL.slice(start, SQL.indexOf("$$;", start));

  it("🔴 門番は SECURITY INVOKER で、画面から（authenticated / anon）の変更を拒む（同じ値なら通す）", () => {
    expect(start).toBeGreaterThan(-1);
    expect(fn).not.toContain("SECURITY DEFINER");
    expect(fn).toContain("IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;");
    for (const col of ["imported_at", "claimed_at", "invited_at"]) {
      expect(fn, col).toMatch(new RegExp(`NEW\\.${col} IS DISTINCT FROM OLD\\.${col}`));
    }
    expect(SQL).toContain(
      "CREATE TRIGGER trg_guard_profile_claim_fields BEFORE UPDATE ON public.profiles " +
        "FOR EACH ROW EXECUTE FUNCTION public.guard_profile_claim_fields();",
    );
  });

  it("正規に書く2つの関数は SECURITY DEFINER（門番の対象外）", () => {
    for (const name of ["import_customers", "claim_my_profile"]) {
      const f = lastDefFile(name);
      expect(f, name).toBeTruthy();
      const s = norm(read(`supabase/migrations/${f!}`));
      const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      expect(s.slice(at, at + 400), name).toContain("SECURITY DEFINER");
    }
  });

  it("画面のコードは profiles の3つの印を書いていない（claim は RPC を呼ぶだけ）", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) {
          if (p === join("src", "test") || p === join("src", "dev")) continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(n) && !p.endsWith(join("integrations", "supabase", "types.ts"))) files.push(p);
      }
    };
    walk("src");
    for (const f of files) {
      const s = code(f);
      let at = s.indexOf('.from("profiles")');
      while (at !== -1) {
        const end = s.indexOf(";", at);
        const stmt = s.slice(at, end === -1 ? at + 800 : Math.min(end, at + 800));
        if (/\.(update|upsert|insert)\(/.test(stmt)) {
          expect(stmt, f).not.toMatch(/\b(imported_at|claimed_at|invited_at)\s*:/);
        }
        at = s.indexOf('.from("profiles")', at + 1);
      }
    }
    expect(read("src/hooks/useProfile.ts")).toContain('supabase.rpc("claim_my_profile"');
  });

  it("後のマイグレーションが門番を外していない", () => {
    for (const f of migrations.filter((f) => f > MIGRATION)) {
      expect(norm(read(`supabase/migrations/${f}`)), f).not.toContain("DROP TRIGGER IF EXISTS trg_guard_profile_claim_fields");
    }
  });
});

describe("invite-customer: 本人が来たアカウントは触らない・送りすぎない", () => {
  const src = code("supabase/functions/invite-customer/index.ts");
  const updateAt = src.indexOf("admin.auth.admin.updateUserById(targetUserId");

  it("🔴 auth 側で一度でもログインした・Google/Apple がつながったアカウントは 409（メールを替える前）", () => {
    const checkAt = src.indexOf("if (authUser.user.last_sign_in_at || hasOtherLogin) {");
    expect(src).toContain('const hasOtherLogin = (authUser.user.identities ?? []).some((i) => i.provider !== "email");');
    expect(checkAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(updateAt);
    expect(src.slice(checkAt, checkAt + 200)).toContain('return json({ error: "already_claimed" }, 409);');
  });

  it("1つのジムで24時間の上限（メールを替える前）", () => {
    const rateAt = src.indexOf("if ((sentToday ?? 0) >= INVITE_DAILY_LIMIT) return json({ error: \"too_many_invites\" }, 429);");
    expect(rateAt).toBeGreaterThan(-1);
    expect(rateAt).toBeLessThan(updateAt);
    expect(src).toMatch(/const INVITE_DAILY_LIMIT = \d+;/);
  });

  it("画面は 409・429 の理由を返事の本文から読み、文言を出し分ける", () => {
    const card = read("src/components/trainer/clientDetail/MemberInviteCard.tsx");
    expect(card).toContain('code === "already_claimed" ? "dataImport.invite.errAlreadyClaimed"');
    expect(card).toContain('code === "too_many_invites" ? "dataImport.invite.errTooMany"');
    expect(card).toContain("await ctx.json()");
    for (const loc of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const d = JSON.parse(read(`src/locales/${loc}.json`));
      expect(d.dataImport.invite.errAlreadyClaimed, loc).toBeTruthy();
      expect(d.dataImport.invite.errTooMany, loc).toBeTruthy();
    }
  });
});

describe("送信履歴に、ログインの鍵入りのリンクを残さない", () => {
  it("🔴 招待リンク（token_hash 入り）は伏せる。体験の取り消しリンク（token=）や他の値はそのまま", () => {
    const data = {
      gymName: "Gym",
      customerName: "山田",
      inviteUrl: "https://app.kyoto-salute.com/reset-password?token_hash=abc&type=recovery&flow=invite",
      cancelUrl: "https://x.supabase.co/functions/v1/trial-cancel?token=t1",
      magic: "https://x/#access_token=a&refresh_token=b",
      count: 3,
    };
    const out = redactTemplateDataForLog(data);
    expect(out.inviteUrl).toBe(REDACTED_FOR_LOG);
    expect(out.magic).toBe(REDACTED_FOR_LOG);
    expect(out.cancelUrl).toBe(data.cancelUrl);
    expect(out.gymName).toBe("Gym");
    expect(out.count).toBe(3);
    // 元の値（メールの本文に使う）は変えない
    expect(data.inviteUrl).toContain("token_hash=abc");
  });

  it("send-transactional-email は、履歴に書く template_data を全部伏せた値にしている", () => {
    const src = code("supabase/functions/send-transactional-email/index.ts");
    expect(src).not.toMatch(/template_data: templateData,/);
    expect((src.match(/template_data: redactTemplateDataForLog\(templateData\),/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it("再送（resend-email）は招待を断る（伏せたリンクでは描き直せない）", () => {
    const src = code("supabase/functions/resend-email/index.ts");
    expect(src).toContain('if (row.template_name === "customer-invite") return json({ error: "invite_needs_reissue" }, 409);');
    expect(src.indexOf('row.template_name === "customer-invite"')).toBeLessThan(src.indexOf('invoke(\n      "send-transactional-email"') === -1 ? src.indexOf('"send-transactional-email"') : src.indexOf('invoke(\n      "send-transactional-email"'));
  });
});
