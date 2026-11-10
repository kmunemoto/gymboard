/**
 * Edge Function のログに、秘密（ログイン用のリンク）と個人情報（メールアドレス）を出さない（2026-10-31）。
 *
 * - auth-email-hook-1: 確認用のリンク（payload.data.url。token_hash 入り）を毎回ログに出していた。
 *   ログを読める人が有効期限内に開けば、その人としてログインしてパスワードを変えられた
 * - auth-email-hook-2 / send-transactional-email: 宛先のメールアドレスを平文でログに出していた
 *
 * Edge Function のログは関係者・Lovable のエージェントが見られ、貼り付けやスクリーンショットで外にも出る。
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { maskEmail } from "../../supabase/functions/_shared/logSafety";

/** console.* の呼び出しの引数を、括弧の対応を見て取り出す */
function consoleCalls(src: string): string[] {
  const out: string[] = [];
  const re = /console\.(?:log|info|warn|error|debug)\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

/** 文字列リテラル（ログの文言）を落とす。文言の中の語（"payload.data.url" など）で誤検知しないように */
const stripStrings = (call: string) =>
  call.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\$]|\\.)*`/g, "''");

/** 伏せ字にせずに出している所 */
function leaks(call: string, names: string[]): string[] {
  const found: string[] = [];
  for (const name of names) {
    const re = new RegExp(`(?<!maskEmail\\()\\b${name.replace(/[.()]/g, (c) => `\\${c}`)}\\b`, "g");
    for (const m of call.matchAll(re)) {
      // maskEmail(…) の中にあるものは許す
      const before = call.slice(0, m.index);
      if (/maskEmail\(\s*$/.test(before)) continue;
      found.push(name);
    }
  }
  return found;
}

describe("maskEmail", () => {
  it("先頭の1文字とドメインだけ残す", () => {
    expect(maskEmail("taro@example.com")).toBe("t***@example.com");
    expect(maskEmail("a@b.jp")).toBe("a***@b.jp");
  });

  it("メールアドレスでなければ伏せる", () => {
    expect(maskEmail(undefined)).toBe("***");
    expect(maskEmail("")).toBe("***");
    expect(maskEmail("no-at-mark")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
  });
});

describe("auth-email-hook のログ", () => {
  const src = readFileSync("supabase/functions/auth-email-hook/index.ts", "utf8");
  const calls = consoleCalls(src).map(stripStrings);

  it("解析器が console の呼び出しを拾えている", () => {
    expect(calls.length).toBeGreaterThan(5);
  });

  it("🔴 確認用のリンク（token_hash 入りの URL）を出していない", () => {
    for (const c of calls) {
      // 有無（!!url）だけは出してよい
      const withoutPresence = c.replace(/!!\s*\(payload\.data as any\)\.url/g, "");
      expect(withoutPresence, c.slice(0, 120)).not.toMatch(/\(payload\.data as any\)\.url|payload\.data\.url\b/);
      expect(c, c.slice(0, 120)).not.toMatch(/\btokenHash\b|\bconfirmationUrl\b|\btoken_hash\s*[,}]/);
    }
  });

  it("メールアドレスは伏せ字にしてから出す", () => {
    for (const c of calls) {
      expect(leaks(c, ["payload.data.email"]), c.slice(0, 120)).toEqual([]);
    }
    expect(src).toContain("recipient: maskEmail(payload.data.email)");
  });
});

describe("send-transactional-email のログ", () => {
  const src = readFileSync("supabase/functions/send-transactional-email/index.ts", "utf8");
  const calls = consoleCalls(src).map(stripStrings);

  it("宛先のメールアドレスは伏せ字にしてから出す", () => {
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) {
      expect(leaks(c, ["effectiveRecipient", "normalizedEmail", "recipientEmail"]), c.slice(0, 120)).toEqual([]);
    }
    expect(src).toContain("recipient: maskEmail(effectiveRecipient)");
  });
});

// ---------------------------------------------------------------------------
// 全部の Edge Function（2026-11-10 定期点検 send-trial-reminders-log-1）。
// それまでは auth-email-hook と send-transactional-email の2本だけを見ていて、send-trial-reminders が体験のお客様の
// アドレスを平文で出していた（handle-email-unsubscribe も）。宛先らしい変数・.email はどの関数でも maskEmail を通す。
// ---------------------------------------------------------------------------
describe("全部の Edge Function のログ", () => {
  const root = "supabase/functions";
  const files = readdirSync(root)
    .filter((d) => d !== "mcp" && !d.startsWith("_"))
    .map((d) => `${root}/${d}/index.ts`)
    .filter((f) => existsSync(f));

  /** 文字列は落とし、テンプレート文字列は ${…} の式だけ残す（文言の中の "email" で誤検知しない） */
  const exprsOnly = (call: string) =>
    call
      // 手で伏せている書き方（先頭の1文字＋***@＋ドメイン。handle-email-suppression）は伏せたものとして扱う
      .replace(/(\w+)\[0\]\s*\+\s*'\*\*\*@'\s*\+\s*\1\.split\('@'\)\[1\]/g, "masked")
      .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, (lit) => [...lit.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).join(" , "));

  /** maskEmail(…) の中身を消す（括弧の対応を見る） */
  const withoutMasked = (s: string) => {
    let out = "";
    for (let i = 0; i < s.length; ) {
      if (s.startsWith("maskEmail(", i)) {
        let depth = 1;
        let j = i + "maskEmail(".length;
        while (j < s.length && depth > 0) {
          if (s[j] === "(") depth++;
          else if (s[j] === ")") depth--;
          j++;
        }
        out += "masked";
        i = j;
      } else {
        out += s[i++];
      }
    }
    return out;
  };

  const LEAK = /\b(?:contact|guestContact|guest_contact|recipientEmail|recipient_email|effectiveRecipient|normalizedEmail)\b|\.email\b/;

  it("走査の対象が見つかっている", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain("supabase/functions/send-trial-reminders/index.ts");
  });

  it.each(files)("🔴 %s はメールアドレス・連絡先を伏せずにログへ出さない", (f) => {
    const src = readFileSync(f, "utf8");
    for (const c of consoleCalls(src)) {
      const exprs = withoutMasked(exprsOnly(c));
      expect(exprs, c.slice(0, 160)).not.toMatch(LEAK);
    }
  });

  it("走査が当たることの確認（伏せていない書き方は見つける・伏せた書き方は通す）", () => {
    const bad = withoutMasked(exprsOnly("console.error(`Failed to send reminder to ${contact}:`, e)"));
    expect(bad).toMatch(LEAK);
    const bad2 = withoutMasked(exprsOnly("console.log('Email unsubscribed', { email: tokenRecord.email })"));
    expect(bad2).toMatch(LEAK);
    const ok = withoutMasked(exprsOnly("console.error(`Failed (booking ${booking.id}, to ${maskEmail(contact)})`)"));
    expect(ok).not.toMatch(LEAK);
    const ok2 = withoutMasked(exprsOnly("console.log('Skip non-email contact (booking ' + booking.id + ')')"));
    expect(ok2).not.toMatch(LEAK);
  });
});
