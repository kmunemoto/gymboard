import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { VAPID_CONTACT_EMAIL, VAPID_PUBLIC_KEY } from "@/lib/brand";
import { isWellFormedVapidPublicKey } from "@/lib/webPushKey";

// **Web Push（VAPID）の設定が「無言で届かない」形に壊れるのを防ぐ。**
//
// ── 直近の経緯 ──────────────────────────────────────────────────
// 2026-08-05 時点で、remix した兄弟アプリはジムボードの VAPID 鍵と
// 連絡先（`mailto:`）をそのまま引き継いでいた。
// 分離するかどうか以前に、**そもそも鍵を安全に変えられない状態**だったのが問題:
//
//   1. 公開鍵の直書きが2箇所（クライアント / Edge Function）+ Secrets の3点セット。
//      どれか1つだけ変えると 401/403 になる
//   2. 鍵を変えると既存の購読は全部無効になるのに、**クライアントに自己修復が無く**、
//      画面は「通知ON」のまま永久に届かない
//   3. Web Push が購読を消すのは 404/410 だけ。401/403 はログにも出ていなかった
//
// これは FCM の SENDER_ID_MISMATCH とまったく同じ形の事故（`pushConfigGuards.test.ts`）。
// ここでは **(1) の一致** と **(2)(3) の仕組みが消えていないこと** を見張る。
//
// ── 鍵そのものの判定ロジックは webPushKey.test.ts ────────────────
// あちらは本物のユニットテスト。ここはソースの突き合わせ。役割が違う。

const PUSH_FN = "supabase/functions/send-push-notification/index.ts";
const HOOK = "src/hooks/usePushSubscription.ts";
const BRAND = "src/lib/brand.ts";

const pushFnSource = readFileSync(PUSH_FN, "utf8");
const hookSource = readFileSync(HOOK, "utf8");

/** `const NAME = "..."` の値を取り出す */
function literal(source: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*\\n?\\s*["'\`]([^"'\`]+)["'\`]`).exec(source);
  return m ? m[1] : null;
}

/** 波括弧の対応を数えてブロックの中身を取り出す（正規表現だと入れ子で切れる） */
function extractBlock(source: string, startPattern: RegExp): string | null {
  const m = startPattern.exec(source);
  if (!m) return null;
  const open = source.indexOf("{", m.index + m[0].length - 1);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

describe("VAPID 公開鍵の宣言がひとつに揃っている", () => {
  it("brand.ts の公開鍵の形が正しい", () => {
    // 65バイト・先頭 0x04 でなければ、そもそも鍵ではない。
    expect(
      isWellFormedVapidPublicKey(VAPID_PUBLIC_KEY),
      "brand.ts の VAPID_PUBLIC_KEY が P-256 の公開鍵になっていません",
    ).toBe(true);
  });

  it("Edge Function の直書きが brand.ts と一致している", () => {
    // Edge Function（Deno）は brand.ts を import できないので写しを持つしかない。
    // **ズレると署名は通っても k= と一致せず 401/403 で無言で失敗する。**
    const actual = literal(pushFnSource, "VAPID_PUBLIC_KEY");
    expect(actual, `${PUSH_FN} から VAPID_PUBLIC_KEY を読めません`).toBeTruthy();
    expect(
      actual,
      `${PUSH_FN} の VAPID_PUBLIC_KEY が ${BRAND} と違います。` +
        `対になる秘密鍵（Supabase Secrets の VAPID_PRIVATE_KEY）も揃っているか確認してください。`,
    ).toBe(VAPID_PUBLIC_KEY);
  });

  it("Edge Function の連絡先が brand.ts と一致している", () => {
    const actual = literal(pushFnSource, "VAPID_CONTACT_EMAIL");
    expect(actual, `${PUSH_FN} から VAPID_CONTACT_EMAIL を読めません`).toBeTruthy();
    expect(
      actual,
      `${PUSH_FN} の VAPID_CONTACT_EMAIL が ${BRAND} と違います`,
    ).toBe(VAPID_CONTACT_EMAIL);
  });

  it("JWT の sub に定数を使っている（アドレス直書きに戻っていない）", () => {
    // ここを直書きに戻されると、上の一致検査が素通りする。
    expect(
      pushFnSource,
      `${PUSH_FN} の sub がメールアドレス直書きに戻っています`,
    ).toMatch(/sub:\s*`mailto:\$\{VAPID_CONTACT_EMAIL\}`/);
  });

  it("クライアント側は brand.ts から読んでいる", () => {
    expect(hookSource, `${HOOK} が brand.ts の VAPID_PUBLIC_KEY を import していません`).toMatch(
      /import\s*\{[^}]*VAPID_PUBLIC_KEY[^}]*\}\s*from\s*["']@\/lib\/brand["']/,
    );
  });

  /** src 配下の .ts / .tsx を全部集める */
  const srcFiles = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(p)) out.push(p);
      }
    };
    walk("src");
    return out;
  })();

  const scan = (files: string[], re: RegExp): string[] => {
    const hits: string[] = [];
    for (const p of files) {
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (re.test(line)) hits.push(`${p}:${i + 1}`);
        });
    }
    return hits;
  };

  it("解析器がソースを拾えている", () => {
    // 0件のまま緑になる（＝何も見ていない）のを防ぐ。
    expect(srcFiles.length).toBeGreaterThan(50);
  });

  it("いま使っている鍵が brand.ts 以外に写っていない", () => {
    // 「brand.ts に足したが古い直書きも残っている」を防ぐ。テストも対象に含める
    // （期待値を焼き付けると、brand.ts を変えてもテストが緑のままになるため）。
    const others = srcFiles.filter((p) => p !== BRAND);
    expect(
      scan(others, new RegExp(VAPID_PUBLIC_KEY.replace(/[-]/g, "\\-"))),
      "VAPID 公開鍵が直書きされています（brand.ts から import してください）",
    ).toEqual([]);
  });

  it("製品コードに鍵らしき文字列が直書きされていない", () => {
    // 別の鍵に差し替えただけ、も検出する。VAPID 公開鍵は base64url 87文字・先頭 B。
    // テストは対象外（意図的な別鍵のダミーを置くため）。
    const product = srcFiles.filter((p) => p !== BRAND && !p.startsWith(join("src", "test")));
    expect(
      scan(product, /["'`]B[A-Za-z0-9_-]{80,}["'`]/),
      "鍵らしき文字列が直書きされています（brand.ts から import してください）",
    ).toEqual([]);
  });
});

describe("鍵を変えても復帰できる（クライアントの自己修復）", () => {
  const check = extractBlock(hookSource, /const checkWebSubscription\s*=\s*useCallback\(async \(\)\s*=>/);

  it("checkWebSubscription を取り出せている", () => {
    // パーサが空振りしたまま緑になるのを防ぐ。
    expect(check, `${HOOK} の checkWebSubscription を見つけられません`).toBeTruthy();
    expect(check!.length).toBeGreaterThan(200);
  });

  it("購読の公開鍵を現在の値と突き合わせている", () => {
    // `getSubscription()` の有無だけを見ると、鍵を変えたあとも「ON」に見えてしまう。
    expect(
      check,
      "購読の applicationServerKey を現在の鍵と比べていません",
    ).toMatch(/isSameVapidKey\([\s\S]{0,120}applicationServerKey[\s\S]{0,80}VAPID_PUBLIC_KEY/);
  });

  it("食い違っていたら購読を作り直す", () => {
    // 解除 → DBから削除 → 作り直し の3つが揃って初めて復帰する。
    expect(check, "旧購読を解除していません").toMatch(/\.unsubscribe\(\)/);
    expect(check, "届かない endpoint を DB から消していません").toMatch(
      /from\("push_subscriptions"\)[\s\S]{0,120}\.delete\(\)/,
    );
    expect(check, "購読を作り直していません").toMatch(/createWebSubscription\(/);
    expect(check, "作り直した購読を保存していません").toMatch(/saveWebSubscription\(/);
  });

  it("許可されていないのに subscribe しない（勝手にダイアログを出さない）", () => {
    // 画面を開いただけで許可ダイアログが出るのは筋が悪い。
    expect(check, "Notification.permission を確認していません").toMatch(
      /Notification\.permission\s*!==\s*["']granted["']/,
    );
  });

  it("古い購読が残っていても購読し直せる", () => {
    // 別の公開鍵の購読が残っていると subscribe() は InvalidStateError で失敗する。
    // 解除してやり直さないと、利用者は**ONに戻す操作も含めて二度と購読できない**。
    const create = extractBlock(hookSource, /async function createWebSubscription\(/);
    expect(create, "createWebSubscription を見つけられません").toBeTruthy();
    expect(create, "失敗時に残っている購読を解除していません").toMatch(
      /catch[\s\S]{0,400}getSubscription\(\)[\s\S]{0,300}\.unsubscribe\(\)/,
    );
    expect(create, "解除したあとにやり直していません").toMatch(
      /\.unsubscribe\(\);[\s\S]{0,120}subscribe\(\)/,
    );
  });
});

describe("設定ミスで弾かれたときに気づける（サーバ側）", () => {
  const webBlock = extractBlock(pushFnSource, /webResults\.forEach\(/);
  const fcmBlock = extractBlock(pushFnSource, /fcmResults\.forEach\(/);

  it("集計ブロックを取り出せている", () => {
    expect(webBlock, "webResults.forEach を見つけられません").toBeTruthy();
    expect(fcmBlock, "fcmResults.forEach を見つけられません").toBeTruthy();
  });

  /** `} else if (...)` / `} else {` で分岐に割る */
  const branches = (block: string) => block.split(/\}\s*else(?:\s+if)?\s*/);

  it("Web Push の 401/403 を error として出す", () => {
    const branch = branches(webBlock!).find((b) => /status === 401/.test(b));
    expect(branch, "401/403 を扱う分岐がありません（無言で失敗します）").toBeTruthy();
    expect(branch, "401/403 が console.error で出ていません").toMatch(/console\.error/);
  });

  it("Web Push の 401/403 で購読を消さない", () => {
    // 401/403 は「購読が無効」ではなく「こちらの鍵が違う」。
    // 消すと、鍵を直したときに戻ってくるはずの購読者まで失う。
    const branch = branches(webBlock!).find((b) => /status === 401/.test(b));
    expect(
      branch,
      "401/403 の分岐で購読を削除しています。設定ミスで有効な購読を捨てないでください。",
    ).not.toMatch(/expiredEndpoints\.push/);
  });

  it("購読を消すのは 404/410 の分岐だけ", () => {
    const purging = branches(webBlock!).filter((b) => /expiredEndpoints\.push/.test(b));
    expect(purging.length, "購読を削除している分岐が1つではありません").toBe(1);
    expect(purging[0], "購読の削除が 404/410 以外で起きています").toMatch(/404|410/);
  });

  it("FCM の 403 / SENDER_ID_MISMATCH を error として出す", () => {
    expect(fcmBlock, "SENDER_ID_MISMATCH を扱っていません").toMatch(/SENDER_ID_MISMATCH/);
    expect(fcmBlock, "設定ミスが console.error で出ていません").toMatch(
      /isConfigError[\s\S]{0,400}console\.error/,
    );
  });

  it("FCM の 403 / SENDER_ID_MISMATCH でトークンを消さない", () => {
    // ここに 403 を入れると、プロジェクトを直したあと誰も戻ってこない。
    const expr = /const isInvalid\s*=([\s\S]*?);/.exec(fcmBlock!)?.[1];
    expect(expr, "isInvalid の定義を見つけられません").toBeTruthy();
    expect(expr, "isInvalid が 403 を無効トークン扱いしています").not.toMatch(/403/);
    expect(expr, "isInvalid が SENDER_ID_MISMATCH を無効トークン扱いしています").not.toMatch(
      /SENDER_ID_MISMATCH/,
    );
  });
});
