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

  it("ios-build.yml の inline plist が中で辻褄の合った1組になっている", () => {
    // ⚠️ ここで PROJECT_ID を appId と突き合わせては**いけない**。
    // Firebase は「1プロジェクトに複数アプリ」が正規の構成で、
    // 兄弟アプリを同じプロジェクトに登録するのは**正しい運用**（2026-08-04 に確認）。
    // その場合 PROJECT_ID は全アプリで同じになるので、appId と一致するはずがない。
    // 実際に一度そう書いてしまい、正しく設定した兄弟アプリを誤って赤にしていた。
    //
    // アプリごとに違わなければならないのは **プロジェクト**ではなく **アプリ登録**:
    //   BUNDLE_ID     … 上の「上流の bundle id が残っていない」で見ている
    //   GOOGLE_APP_ID … `1:<GCM_SENDER_ID>:ios:<hash>` の形。アプリごとに hash が違う
    //
    // ここでは「plist の一部だけ貼り替えた」を捕まえる。
    // GOOGLE_APP_ID に埋まっている sender と GCM_SENDER_ID が食い違っていたら、
    // 別プロジェクトの値が混ざっている。
    const yml = readFileSync(IOS_YML, "utf8");
    const val = (key: string) =>
      yml.match(new RegExp(`<key>${key}</key>\\s*\\n\\s*<string>([^<]+)</string>`))?.[1];

    const sender = val("GCM_SENDER_ID");
    const appIdField = val("GOOGLE_APP_ID");
    const bundle = val("BUNDLE_ID");
    expect(sender, `${IOS_YML} の inline plist から GCM_SENDER_ID を読めません`).toBeTruthy();
    expect(appIdField, `${IOS_YML} の inline plist から GOOGLE_APP_ID を読めません`).toBeTruthy();

    expect(bundle, `inline plist の BUNDLE_ID が appId と違います`).toBe(APP_ID);
    expect(
      appIdField,
      `GOOGLE_APP_ID (${appIdField}) の sender が GCM_SENDER_ID (${sender}) と一致しません。` +
        `plist を一部だけ貼り替えた可能性があります。GoogleService-Info.plist は**丸ごと**` +
        `自分のアプリ登録のものに差し替えてください。`,
    ).toMatch(new RegExp(`^1:${esc(sender!)}:ios:`));
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
