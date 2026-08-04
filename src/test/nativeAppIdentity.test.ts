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

// ── plist の入れ方は2通りある（2026-08-04 追記）────────────────────────
//
// ここは GoogleService-Info.plist を **ワークフローに inline** する前提で書かれていたが、
// ストレッチボードは **GitHub Secrets（GOOGLE_SERVICE_INFO_PLIST_BASE64）から
// 流し込む**方式に移行済みで、そのままでは2件が「対象が存在しない」で落ちていた。
// どちらの設計でも同じ事故を捕まえられるように直した。
//
//   1. コメントの中の識別子を拾ってしまう
//      移行した ios-build.yml には「以前は app.gymboard.mobile のままだった」という
//      経緯コメントが残る。設定値ではないので、走査前にコメントを落とす。
//
//   2. inline plist が無い場合の代替検査
//      Secrets 方式では plist がリポジトリに入らないので「inline plist の中で
//      辻褄が合うか」は検査対象そのものが無い。代わりに **ビルド中の照合が
//      appId を基準にしているか** を見る。plist を毎ビルド実物で照合するぶん、
//      検出力はむしろ上がる（inline 版は「コミットした plist が正しいか」しか見られない）。
//
// 移行していないリポジトリ（このリポジトリを含む）では、従来どおり inline 版の
// 検査がそのまま走る。

/**
 * YAML と、その中の shell の `#` 以降を落とす。
 * 経緯を書いたコメントの中の識別子を「設定値」と誤認しないため。
 */
const stripComments = (yml: string): string =>
  yml
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");

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
    const yml = stripComments(readFileSync(IOS_YML, "utf8"));
    // Secrets から流し込む plist の照合値 / pbxproj の
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

  it("ios-build.yml が GoogleService-Info.plist を Secrets から入れ、appId で照合している", () => {
    // 上流は plist をワークフローに **inline** している。このリポジトリは
    // GitHub Secrets から流し込む方式に変えてあるので、inline 版の検査は空振りする
    // （検査対象がリポジトリに存在しない）。同じ事故を、実行時の照合で捕まえる。
    const yml = readFileSync(IOS_YML, "utf8");

    // plist が inline のままなら、上流と同じ検査に落とす（設計を戻したときの保険）。
    const hasInlinePlist = /<key>GCM_SENDER_ID<\/key>/.test(yml);
    if (hasInlinePlist) {
      const val = (key: string) =>
        yml.match(new RegExp(`<key>${key}</key>\\s*\\n\\s*<string>([^<]+)</string>`))?.[1];
      const sender = val("GCM_SENDER_ID");
      const appIdField = val("GOOGLE_APP_ID");
      expect(val("BUNDLE_ID"), "inline plist の BUNDLE_ID が appId と違います").toBe(APP_ID);
      expect(appIdField).toMatch(new RegExp(`^1:${esc(sender!)}:ios:`));
      return;
    }

    // Secrets 方式であること（plist をリポジトリに置かない）。
    expect(
      yml,
      `${IOS_YML} が GoogleService-Info.plist を Secrets から入れていません`,
    ).toMatch(/GOOGLE_SERVICE_INFO_PLIST_BASE64/);

    // **ここが本体。** ビルド中に plist の BUNDLE_ID を appId と突き合わせて落とすこと。
    // これが無いと、上流の Secrets をそのまま引き継いだ兄弟アプリが
    // 「ビルドは通るがプッシュだけ永久に届かない」状態で出荷される。
    const checksBundleId =
      /PlistBuddy -c "Print :BUNDLE_ID"/.test(yml) &&
      new RegExp(`!=\\s*"${esc(APP_ID)}"`).test(yml);
    expect(
      checksBundleId,
      `${IOS_YML} に「plist の BUNDLE_ID が ${APP_ID} でなければ落とす」検査がありません。` +
        `Secrets 方式では、これが唯一の歯止めになります。`,
    ).toBe(true);
  });

  it("ios-build.yml の inline plist が中で辻褄の合った1組になっている（inline のときだけ）", () => {
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
    // このリポジトリは Secrets 方式なので inline plist は無い。設計を戻したときだけ効く。
    if (sender === undefined && appIdField === undefined && bundle === undefined) return;

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
