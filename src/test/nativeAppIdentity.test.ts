import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ネイティブアプリの識別子が、リポジトリ全体で1つに揃っていることを見張る。
//
// ── なぜ要るか（2026-08-04、兄弟アプリを全てネイティブで出す方針になった） ──
//
// ネイティブの識別子は **ワークフローファイルに直書きするしかない**。
// `.github/workflows/*.yml` は TypeScript を import できないので、`brand.ts` のような
// 「1箇所に集める」やり方が使えない。そして **Lovable の remix はワークフローを直さない。**
//
// つまりフォークが `capacitor.config.ts` の appId だけ変えると、
// **iOS/Android のビルド定義には上流（ジムボード）の値が残る。**
//
// 実害:
//   - `ios-build.yml` には **GoogleService-Info.plist が丸ごと inline** されている。
//     直し忘れると、フォークの iOS アプリが**ジムボードの Firebase プロジェクトに登録される**。
//     発行されるトークンはジムボードの sender のものになり、フォーク自身の
//     `FIREBASE_SERVICE_ACCOUNT_JSON` で送ると **SENDER_ID_MISMATCH（403）**。
//     しかも `send-push-notification` の `isInvalid` はこれを無効トークン扱いしないので、
//     **トークンは消えず、ただ永久に届かない。**
//   - `android-build.yml` の `packageName` は **Play Console のアップロード先**。
//     直し忘れると他人のアプリ枠に上げようとする。
//
// どちらも「エラーが出ないまま通知だけ来ない」形になりうる。
// **メールを全廃する兄弟アプリでは、これがそのまま「連絡手段ゼロ」になる。**
//
// ── このテストの効き方 ────────────────────────────────────────
// `capacitor.config.ts` の `appId` を**唯一の正**とし、他の直書きが一致するかを見る。
// 上流はすべて `app.gymboard.mobile` なので緑。
// フォークが appId だけ変えた瞬間に**赤くなる**（上流の値が残っている箇所が名指しで出る）。

const CAPACITOR = readFileSync("capacitor.config.ts", "utf8");
const IOS_YML = ".github/workflows/ios-build.yml";
const ANDROID_YML = ".github/workflows/android-build.yml";

/** このリポジトリのネイティブ識別子（唯一の正） */
const APP_ID = (() => {
  const m = CAPACITOR.match(/appId:\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error("capacitor.config.ts から appId を読めませんでした");
  return m[1];
})();

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("ネイティブ識別子は capacitor.config.ts の appId に揃える", () => {
  it("appId を読めている（テストが空振りしていない）", () => {
    expect(APP_ID).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)+$/);
  });

  it("brand.ts の NATIVE_APP_SCHEME が appId と一致する", () => {
    // 不一致でもビルドもテストも通り、**実機でだけ認証から戻ってこられなくなる**。
    const brand = readFileSync("src/lib/brand.ts", "utf8");
    const m = brand.match(/NATIVE_APP_SCHEME\s*=\s*"([^"]+)"/);
    expect(m, "brand.ts から NATIVE_APP_SCHEME を読めません").toBeTruthy();
    expect(m![1]).toBe(`${APP_ID}:`);
  });

  it("ios-build.yml に上流の bundle id が残っていない", () => {
    const yml = readFileSync(IOS_YML, "utf8");
    // inline された GoogleService-Info.plist の BUNDLE_ID / pbxproj の
    // PRODUCT_BUNDLE_IDENTIFIER / entitlements のキー、すべてが対象。
    const ids = [...yml.matchAll(/([a-z0-9]+(?:\.[a-z0-9]+){2,})/g)]
      .map((x) => x[1])
      .filter((s) => /\.mobile$/.test(s));
    expect(ids.length, `${IOS_YML} に bundle id らしき文字列が見つかりません`).toBeGreaterThan(0);
    const wrong = [...new Set(ids)].filter((s) => s !== APP_ID);
    expect(
      wrong,
      `${IOS_YML} に appId(${APP_ID}) と違う識別子が残っています。` +
        `inline された GoogleService-Info.plist ごと自分のものに差し替えてください。`,
    ).toEqual([]);
  });

  it("ios-build.yml の Firebase プロジェクトが appId と辻褄が合っている", () => {
    // inline plist を差し替え忘れると、フォークのアプリが**上流の Firebase**に登録される。
    // PROJECT_ID の素性を機械的に断定はできないので、
    // 「appId のベンダー部分と PROJECT_ID が全く無関係」なときだけ疑う。
    const yml = readFileSync(IOS_YML, "utf8");
    const proj = yml.match(/<key>PROJECT_ID<\/key>\s*\n\s*<string>([^<]+)<\/string>/);
    expect(proj, `${IOS_YML} の inline plist から PROJECT_ID を読めません`).toBeTruthy();
    // appId "app.gymboard.mobile" → vendor "gymboard"
    const vendor = APP_ID.split(".").filter((p) => p !== "app" && p !== "mobile")[0] ?? "";
    expect(vendor.length, "appId からベンダー名を取り出せません").toBeGreaterThan(0);
    expect(
      proj![1],
      `${IOS_YML} の Firebase PROJECT_ID (${proj![1]}) が appId (${APP_ID}) と無関係です。` +
        `上流の GoogleService-Info.plist が残っている可能性があります。` +
        `残っていると、このアプリのiOS版が**他社の Firebase に登録され**、` +
        `プッシュが SENDER_ID_MISMATCH で永久に届きません（エラーは表に出ません）。`,
    ).toContain(vendor);
  });

  it("android-build.yml のアップロード先 packageName が appId と一致する", () => {
    // ここは **Play Console のアップロード先**。取り違えると他人のアプリ枠に上げにいく。
    const yml = readFileSync(ANDROID_YML, "utf8");
    const m = yml.match(/packageName:\s*([\w.]+)/);
    expect(m, `${ANDROID_YML} から packageName を読めません`).toBeTruthy();
    expect(m![1]).toBe(APP_ID);
  });

  it("android-build.yml のプリフライトが appId で google-services.json を検査する", () => {
    // 「別アプリの google-services.json を貼ってしまった」を10分ビルドする前に止める検査。
    // ここの期待値が上流のままだと、**自分の正しい設定を弾く**ようになる。
    const yml = readFileSync(ANDROID_YML, "utf8");
    expect(yml).toMatch(new RegExp(`"package_name"[^\\n]*${esc(APP_ID)}`));
  });
});
