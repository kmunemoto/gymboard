import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MARKETING_SITE_URL,
  OWN_WEB_HOSTS,
  PRODUCTION_WEB_ORIGIN,
  STRIPE_LIVE_HOSTS,
} from "@/lib/brand";

// **Edge Function に直書きされたドメインが、この製品のものであることを見張る。**
//
// ── なぜ要るか ──────────────────────────────────────────────────
// Edge Function（Deno）は `src/lib/brand.ts` を import できない。だから本番ドメインは
// 各ファイルに手で書くしかなく、現在10ファイルに散っている。
// **フォークが brand.ts だけ差し替えると、Edge Function 側に上流のドメインが残る。**
//
// 2026-08-03、セッコツボードとゴルフボードが実際にこの状態だった。
// `send-push-notification` の `ALLOWED_URL_HOSTS` がジムボードのままで、
//
//   1. 自分の絶対URLを `url` に渡すと **400 で弾かれてプッシュが飛ばない**
//   2. **他社（ジムボード）のドメインを許可し続ける**
//
// が同時に起きていた。**相対パス "/" は通るので表面化せず、エラーも出ない。**
//
// ── 出どころ ────────────────────────────────────────────────────
// この仕組みは**ストレッチボード（フォーク）が先に作っていた**。
// 向こうは `send-push-notification` の `ALLOWED_URL_HOSTS` だけを見ていたので、
// 上流に取り込むにあたって**全 Edge Function の https:// リテラル**に広げた。
// 鍼灸ボードの `.catch` 検査に続く、逆方向の2件目。

const FUNCTIONS_DIR = "supabase/functions";

/** 自前ではないホスト。ここに無いものが出たら「製品のドメインか？」を疑う */
const THIRD_PARTY_HOSTS = [
  "accounts.google.com",
  "oauth2.googleapis.com",
  "fcm.googleapis.com",
  "www.googleapis.com",
  "api.line.me",
  "notify-api.line.me",
  "access.line.me",
  "api.stripe.com",
  "ai.gateway.lovable.dev", // analyze-meal（Lovable の AI ゲートウェイ）
  "esm.sh",
  "deno.land",
  "jsr.io",
  "raw.githubusercontent.com",
  "www.w3.org",
];

const hostOf = (url: string) => new URL(url).host;

/** supabase/functions 配下の .ts / .tsx を全部集める（_shared も含む） */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collectSources(p));
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * 行コメントを落とす。**`https://` の `//` を壊さないこと。**
 * 素朴に `line.split("//")[0]` と書くと URL が全部消えて、
 * **検査が空振りしたまま緑になる**（実際に一度やった）。
 */
function stripLineComments(line: string): string {
  if (line.trim().startsWith("//")) return "";
  return line.replace(/(?<!:)\/\/.*$/, "");
}

interface HostHit { host: string; file: string; line: number }

/**
 * ホスト名を含む文字列を拾うパターン。
 *
 * ⚠️ **`https://` 付きだけを見ると、2つの抜け道がある。**
 * どちらも 2026-08-05 に兄弟アプリが実際に踏んだ:
 *
 * 1. **裸のホスト名**（相談ボード発見）
 *    ```ts
 *    const SENDER_DOMAIN = "notify.kyoto-salute.com"   // https:// が付かない
 *    ```
 *    上流のドメインのまま残っていても検出できなかった。
 *
 * 2. **テンプレートリテラル**（鍼灸ボード発見）
 *    ```ts
 *    siteUrl: `https://${ROOT_DOMAIN}`,   // ${ で始まるのでマッチしない
 *    ```
 *    `ROOT_DOMAIN` が上流のままだと、登録確認メールが
 *    **「<自分の製品名>にご登録ありがとうございます」と書きながら
 *    リンクだけ上流のサイトへ飛ぶ**状態になっていた。
 *
 * そこで **`https://` の有無を問わず、ホスト名らしい文字列**を拾う。
 * 定数への代入（`= "host"`）も対象に含めるため、クォート内も見る。
 */
const HOST_PATTERNS: RegExp[] = [
  // https://example.com / http://example.com
  /https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi,
  //
  // 定数への代入だけを見る: `= "notify.kyoto-salute.com"`
  //
  // **`=` に限るのが要点。** 任意のクォート文字列まで広げると、
  // Stripe のイベント名（`checkout.session.completed` 等）を
  // ホスト名として誤検出する。フォークが踏むのは
  // 「ドメイン定数が上流のまま残る」形なので、代入だけで十分。
  //
  // テンプレートリテラル（`https://${ROOT_DOMAIN}`）はここでは拾えないが、
  // **その元になる `const ROOT_DOMAIN = "..."` を拾うので同じことになる。**
  //
  // `(?<![=!<>])` は比較を除くため。これが無いと
  // `type === "checkout.session.completed"` の `===` の末尾に当たってしまう。
  /(?<![=!<>])=\s*["'`]([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*\.[a-z]{2,})["'`]/gi,
];

/**
 * ホスト名として扱わない誤検出。
 * ファイル名・パッケージ名がドット区切りとして拾われる。
 */
const NOT_A_HOST = /\.(ts|tsx|js|mjs|json|sql|png|jpg|svg|css|html|md|lock|yml|yaml|ics|csv|txt|pdf)$/i;

function collectHosts(): HostHit[] {
  const hits: HostHit[] = [];
  for (const file of collectSources(FUNCTIONS_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((raw, i) => {
      const code = stripLineComments(raw);
      for (const pattern of HOST_PATTERNS) {
        for (const m of code.matchAll(pattern)) {
          const host = m[1].toLowerCase();
          if (NOT_A_HOST.test(host)) continue;
          hits.push({ host, file, line: i + 1 });
        }
      }
    });
  }
  return hits;
}

const own = new Set(OWN_WEB_HOSTS);
const thirdParty = new Set(THIRD_PARTY_HOSTS);
const hits = collectHosts();

describe("brand.ts の OWN_WEB_HOSTS が矛盾していない", () => {
  it("PRODUCTION_WEB_ORIGIN のホストが含まれている", () => {
    expect(own.has(hostOf(PRODUCTION_WEB_ORIGIN))).toBe(true);
  });

  it("MARKETING_SITE_URL のホストが含まれている", () => {
    expect(own.has(hostOf(MARKETING_SITE_URL))).toBe(true);
  });

  it("STRIPE_LIVE_HOSTS が全部含まれている", () => {
    // Stripe を live で動かすホストは、当然この製品のホストであるはず。
    // 片方だけ足して片方を忘れる、を防ぐ。
    const missing = STRIPE_LIVE_HOSTS.filter((h) => !own.has(h));
    expect(missing, "STRIPE_LIVE_HOSTS にあって OWN_WEB_HOSTS に無いホスト").toEqual([]);
  });
});

describe("Edge Function に他社のドメインが直書きされていない", () => {
  it("解析器が https:// リテラルを拾えている", () => {
    // 0件のまま緑になる（＝何も見ていない）事故を防ぐ。
    // `//` のコメント除去で URL ごと消す実装ミスは、これが無いと気づけない。
    expect(hits.length).toBeGreaterThan(5);
  });

  it("すべて OWN_WEB_HOSTS か既知の外部サービス", () => {
    const offenders = hits
      .filter((h) => !own.has(h.host) && !thirdParty.has(h.host))
      .map((h) => `${h.host}  (${h.file}:${h.line})`);

    expect(
      [...new Set(offenders)],
      offenders.length
        ? "Edge Function にこの製品のものでないドメインが直書きされています:\n" +
          [...new Set(offenders)].map((o) => `  - ${o}`).join("\n") +
          "\n\n対処:\n" +
          "  この製品のドメインなら … src/lib/brand.ts の OWN_WEB_HOSTS に足す\n" +
          "  上流から残ったドメインなら … そのファイルを自分のドメインに直す\n" +
          "  外部サービスなら … このテストの THIRD_PARTY_HOSTS に足す"
        : undefined,
    ).toEqual([]);
  });
});

describe("send-push-notification の ALLOWED_URL_HOSTS", () => {
  const PUSH_FN = `${FUNCTIONS_DIR}/send-push-notification/index.ts`;
  const source = readFileSync(PUSH_FN, "utf8");

  /** `const ALLOWED_URL_HOSTS = new Set([...])` の中身を取り出す */
  const allowed = (() => {
    const block = /ALLOWED_URL_HOSTS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(source);
    if (!block) return null;
    return [...block[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1].toLowerCase());
  })();

  it("定義を取り出せている", () => {
    // 書き方を変えたときに、パーサが空振りして緑のままになるのを防ぐ
    expect(allowed, "ALLOWED_URL_HOSTS の定義を見つけられません").not.toBeNull();
    expect(allowed!.length).toBeGreaterThan(0);
  });

  it("自分の本番ドメインが許可されている", () => {
    // ここが上流のままだと、自分の絶対URLを渡したプッシュが 400 で弾かれる。
    // 相対パス "/" は通るので、実機で試すまで気づけない。
    expect(
      allowed!.includes(hostOf(PRODUCTION_WEB_ORIGIN)),
      `ALLOWED_URL_HOSTS に ${hostOf(PRODUCTION_WEB_ORIGIN)}（PRODUCTION_WEB_ORIGIN）がありません`,
    ).toBe(true);
  });

  it("他社のドメインを許可していない", () => {
    const foreign = allowed!.filter((h) => !own.has(h));
    expect(
      foreign,
      "ALLOWED_URL_HOSTS に OWN_WEB_HOSTS 以外のホストがあります（上流のドメインが残っていませんか）",
    ).toEqual([]);
  });
});
