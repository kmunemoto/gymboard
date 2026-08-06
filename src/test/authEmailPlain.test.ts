import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  renderAuthHtml,
  renderAuthText,
  type AuthEmailType,
  type AuthEmailProps,
} from "../../supabase/functions/_shared/email-templates/auth-plain";
import {
  renderRecoveryHtml,
  renderRecoveryText,
} from "../../supabase/functions/_shared/email-templates/recovery-plain";
import { BRAND } from "@/lib/brand";

// 認証メール6種が **React・ストリーミング描画を通っていない**ことの検査。
//
// ── なぜ要るか ──────────────────────────────────────────────────
// Deno のストリーミング HTML 描画が、日本語を UTF-8 のチャンク境界で分割して
// U+FFFD に壊す。**同じ事故が2回起きている。**
//
//   2026-06 ジムボード : 「パスワ???ード」（recovery）
//   2026-08 ピラボード : 「お心当たり」の**「当」が U+FFFD ×3**（signup）→ お客様に届いた
//
// 1回目の対処が **recovery だけ**だったので2回目が起きた。
// **種別ごとに逃がすと必ず取りこぼす**ので、6種別すべてを見張る。
//
// ── この化けは他のどこにも出ない ────────────────────────────
// `email_send_log` は `sent` のまま。ログにも出ない。
// **気づける経路は受信トレイの実物だけ。** だから送る前に構造で止める。
//
// ── 変異テスト（2026-08-06 実施・5件とも赤を確認）────────────
//   1. `enc()` を素通し（生UTF-8）にする                  → 赤 5件
//   2. 末尾のフッター文を落とす                            → 赤 3件
//   3. recovery の委譲をやめて自前描画にする                → 赤 2件（バイト一致が崩れる）
//   4. プレビューだけ別経路に戻す                          → 赤 1件
//   5. **実際に壊れた形**（「当」→ U+FFFD ×3）を注入        → 赤 8件
//
// ⚠️ 5 で分かったこと: **HTMLをそのまま `.not.toContain("\uFFFD")` しても素通りする。**
//    `enc()` が U+FFFD を `&#65533;` に変換してしまうため。
//    **数値文字参照を戻してから見ること。** 気づいたのは、実際に壊れた文字列で
//    試したから。「壊れそうな形」ではなく「実際に壊れた形」で試すこと。

const HOOK = "supabase/functions/auth-email-hook/index.ts";
const TEMPLATE_DIR = "supabase/functions/_shared/email-templates";

const TYPES: AuthEmailType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "reauthentication",
];

const PROPS: AuthEmailProps = {
  siteName: BRAND.ja,
  siteUrl: "https://example.test",
  recipient: "someone@example.test",
  confirmationUrl: "https://example.test/auth/callback?token_hash=abc123&type=signup",
  token: "123456",
  oldEmail: "old@example.test",
  newEmail: "new@example.test",
};

/** 数値文字参照とHTMLコメント改行を戻して、表示される日本語を復元する */
const decode = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

describe("認証メール（素の文字列テンプレート）", () => {
  for (const type of TYPES) {
    describe(type, () => {
      it("HTMLに置換文字(U+FFFD)が無い", () => {
        const html = renderAuthHtml(type, PROPS);
        expect(html).not.toContain("�");
        // ⚠️ 上の1行だけでは足りない。**enc() が U+FFFD を `&#65533;` に変換する**ので、
        //    素のまま見ると素通りする。実際に壊れた形を注入して確認済み。
        //    数値文字参照を戻してから見ること。
        expect(decode(html), `${type} のHTMLに置換文字が含まれています`).not.toContain("�");
        expect(html).not.toContain("&#65533;");
      });

      it("プレーンテキストに置換文字(U+FFFD)が無い", () => {
        // ⚠️ HTML版だけ見ないこと。2026-06 の事故は**両方**で起きた
        expect(renderAuthText(type, PROPS)).not.toContain("�");
      });

      it("HTMLの表示テキストがASCII安全（数値文字参照）", () => {
        const html = renderAuthHtml(type, PROPS);
        // 生の日本語が本文に残っていたら、送信経路のQP折り返しで割れる余地が残る
        const withoutTags = html.replace(/<[^>]*>/g, "");
        expect(
          /[ぁ-んァ-ヶ一-龠]/.test(withoutTags),
          `${type} のHTML本文に生の日本語が残っています（数値文字参照にしてください）`,
        ).toBe(false);
      });

      it("末尾のフッター文が欠けていない（壊れるのは文書の後ろから）", () => {
        // 実際に壊れたのは文書の一番後ろにあるフッター文だった
        const decoded = decode(renderAuthHtml(type, PROPS));
        expect(decoded).toMatch(/お心当たり|アカウントの安全/);
        expect(renderAuthText(type, PROPS)).toMatch(/お心当たり|アカウントの安全/);
      });

      it("リンクURLが壊れていない（& が &amp; になっている）", () => {
        const html = renderAuthHtml(type, PROPS);
        if (!html.includes("href=")) return; // reauthentication はリンク無し
        expect(html).not.toMatch(/href="[^"]*[^m]&(?!amp;|#)/);
      });
    });
  }

  it("6種別すべてが描画できる（分岐の取りこぼしが無い）", () => {
    for (const type of TYPES) {
      expect(renderAuthHtml(type, PROPS).length, `${type} のHTMLが空`).toBeGreaterThan(200);
      expect(renderAuthText(type, PROPS).length, `${type} のテキストが空`).toBeGreaterThan(20);
    }
  });

  it("recovery は recovery-plain.ts の出力とバイト一致する", () => {
    // 実機で検証済みのパスワード再設定メールを1バイトも変えないため、委譲している
    expect(renderAuthHtml("recovery", PROPS)).toBe(renderRecoveryHtml(PROPS.confirmationUrl));
    expect(renderAuthText("recovery", PROPS)).toBe(renderRecoveryText(PROPS.confirmationUrl));
  });

  it("ブランド名が brand.ts と一致する（Edge Function は import できないため）", () => {
    const decoded = decode(renderAuthHtml("signup", { ...PROPS, siteName: BRAND.ja }));
    expect(decoded).toContain(BRAND.ja);
  });
});

describe("auth-email-hook が React を通していない", () => {
  const hook = readFileSync(HOOK, "utf8");

  it("renderAsync を使っていない（本番・プレビューとも）", () => {
    const code = hook.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(
      code,
      "auth-email-hook に renderAsync が復活しています。" +
        "Deno のストリーミング描画は日本語を U+FFFD に壊します（2026-06 / 2026-08 に発生）",
    ).not.toMatch(/renderAsync/);
  });

  it("react を import していない", () => {
    const code = hook.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/from 'npm:react/);
    expect(code).not.toMatch(/@react-email/);
  });

  it("プレビューと本番が同じ描画を通る", () => {
    // 別経路だと「プレビューは綺麗なのに届くメールだけ壊れている」になり、
    // **一番気づけない**。以前はプレビューだけ renderAsync だった。
    const calls = [...hook.matchAll(/renderAuthHtml\(/g)].length;
    expect(calls, "renderAuthHtml の呼び出しが2箇所（本番＋プレビュー）ありません").toBe(2);
  });

  it("描画を種別ごとに分岐していない（recovery だけ逃がす形に戻していない）", () => {
    // ⚠️ `emailType === 'recovery'` そのものを禁止しないこと。
    //    **URL の組み立てには正しい分岐がある**（recovery だけ /reset-password へ直接飛ばし、
    //    token_hash + verifyOtp で処理する。PKCE を避けるための設計で、
    //    これがあるおかげで「アプリで開いてもブラウザで開いても動く」）。
    //    見張るべきは**描画側**なので、recovery 専用レンダラの直接呼び出しだけを禁じる。
    const code = hook.replace(/\/\/[^\n]*/g, "");
    expect(
      code,
      "recovery だけ別のレンダラで描く形に戻っています。" +
        "1回目の対処を recovery だけにしたことが2回目（signup）を招きました",
    ).not.toMatch(/renderRecovery(Html|Text)\s*\(/);
  });

  it("react-email のテンプレート(.tsx)が残っていない", () => {
    // 「編集しても何も変わらないファイル」が残るのは罠
    const orphans = ["signup", "invite", "magic-link", "recovery", "email-change", "reauthentication"];
    for (const name of orphans) {
      let exists = true;
      try {
        readFileSync(`${TEMPLATE_DIR}/${name}.tsx`, "utf8");
      } catch {
        exists = false;
      }
      expect(exists, `${TEMPLATE_DIR}/${name}.tsx が残っています（誰も読まないファイル）`).toBe(false);
    }
  });
});
