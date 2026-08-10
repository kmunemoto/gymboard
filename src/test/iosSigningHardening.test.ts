import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// iOS の署名まわりが「シークレットの中身を信じる」形に戻っていないかを見張る。
//
// ── なぜ要るか（2026-08-10）─────────────────────────────────────────
//
// ストレッチボードが同日、iOS ビルドを3回落とした。原因は
// **GitHub Secrets に入れたプロビジョニングプロファイル名の末尾に改行が入っていた**こと。
//
//   - Secrets の入力欄は textarea。**貼り付けた文字をそのまま保存する**ので、
//     コピー元に末尾の改行があればそれごと入る
//   - ログでは `***` に伏せられる。**目視では絶対に見つからない**
//   - 出るエラーは `No profile for team '***' matching '***' found`。
//     プロファイルが壊れている・期限切れ・証明書違い、と誤診しやすい
//
// ジムボードにも同じ穴が空いていた。`APPLE_TEAM_ID` と `IOS_P12_PASSWORD` を素通しし、
// プロファイル名は署名側と ExportOptions 側の**2箇所にベタ書き**していた。
// 改行が入っていなかったのはたまたまで、仕掛けとしては何も守っていなかった。
//
// ── 直し方（このテストが見張る形）───────────────────────────────────
//
//   1. 署名に使う値（プロファイル名・チームID・bundle ID）は
//      **`.mobileprovision` の現物から読む**。`$( )` は末尾の改行を捨てるので、
//      読み出した時点で汚れようがない。ベタ書きの二重管理も消える
//   2. それでもシークレットで渡すしかない値（キーID等）は、
//      **入ってくる境界で空白を落とす**
//   3. 足りないシークレットは**ビルド前**に落とす（15分待ってから落ちない）
//
// ⚠️ このテストは「iOS のリリース経路が守られているか」だけを見る。
//    識別子が揃っているかは `nativeAppIdentity.test.ts` の担当。

const IOS_YML_PATH = ".github/workflows/ios-build.yml";
const RAW = readFileSync(IOS_YML_PATH, "utf8");

/**
 * YAML と、その中の shell / python の `#` 以降を落とす。
 *
 * 経緯を書いたコメントで検査を満たせてしまうと、**コメントを書いただけで緑になる**。
 * 「あること」も「無いこと」も、実際に走る行だけで判定する。
 */
const CODE = RAW.split("\n")
  .map((line) => line.replace(/#.*$/, ""))
  .join("\n");

/** capacitor.config.ts の appId（このリポジトリのネイティブ識別子の唯一の正） */
const APP_ID = (() => {
  const m = readFileSync("capacitor.config.ts", "utf8").match(/appId:\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error("capacitor.config.ts から appId を読めませんでした");
  return m[1];
})();

describe("iOS の署名値はシークレットではなくプロファイルの現物から読む", () => {
  it("コメント除去が空振りしていない（このファイルの他の検査の前提）", () => {
    // CODE が空になっていたら、以降の「含まれる」検査が全部無意味になる。
    expect(CODE.length).toBeGreaterThan(1000);
    expect(CODE).toContain("xcodebuild");
  });

  it("🔴 プロファイル名をベタ書きせず、プロファイルから読んだ値を使う", () => {
    // ベタ書きしていると、Apple 側で名前を変えた瞬間に
    // 「プロファイルが見つからない」だけが出る（どこを直すかは出ない）。
    expect(
      CODE,
      `${IOS_YML_PATH} の PROVISIONING_PROFILE_SPECIFIER がプロファイル由来の値になっていません`,
    ).toMatch(/PROVISIONING_PROFILE_SPECIFIER"\]\s*=\s*ENV\["PROFILE_NAME"\]/);

    // 署名側と ExportOptions 側で別々の値を書けないこと（片方だけ直す事故を作らない）。
    expect(
      CODE,
      "ExportOptions.plist のプロファイル名がプロファイル由来の値になっていません",
    ).toMatch(/<string>\$PROFILE_NAME<\/string>/);

    // 🔴 ヒアドキュメントが**展開される形**であること。
    // `<< 'EOF'`（クォート付き）に戻すと $PROFILE_NAME が**文字列のまま** plist に入る。
    // それでも plutil -lint は通り、archive も通り、**15分後の export で初めて落ちる**。
    // しかも出るのは `No profiles for '$PROFILE_BUNDLE_ID' were found` という、
    // この変更が無くそうとしている「読んでも原因が分からないエラー」そのもの。
    // 変更前がクォート付きだったので、「安全のため」戻される可能性がいちばん高い箇所。
    expect(
      CODE,
      "ExportOptions.plist のヒアドキュメントがクォートされています。変数が展開されず、plist に $PROFILE_NAME という文字列がそのまま入ります。",
    ).toMatch(/cat > ios\/App\/ExportOptions\.plist << EOF/);

    // 生き残ったベタ書きが無いこと。プロファイル名は Apple 側の自由文字列なので、
    // "... App Store" の形をまとめて弾く。
    const hardcoded = [...CODE.matchAll(/"([A-Za-z0-9][^"\n]*\bApp Store\b[^"\n]*)"/g)].map(
      (m) => m[1],
    );
    expect(
      hardcoded,
      `${IOS_YML_PATH} にプロファイル名のベタ書きが残っています`,
    ).toEqual([]);
  });

  it("🔴 チームIDもプロファイルから読む（シークレットは照合用に格下げ）", () => {
    expect(CODE).toMatch(/DEVELOPMENT_TEAM"\]\s*=\s*ENV\["PROFILE_TEAM"\]/);
    expect(CODE, "ExportOptions.plist の teamID がプロファイル由来ではありません").toMatch(
      /<string>\$PROFILE_TEAM<\/string>/,
    );
    // ExportOptions に secrets を直接展開して埋めていないこと
    // （末尾の改行がそのまま plist の中に入る形。plist は壊れずに読めてしまう）。
    expect(
      /<string>\$\{\{\s*secrets\./.test(CODE),
      "ExportOptions.plist に secrets を直接埋めています。改行が混ざっても気づけません。",
    ).toBe(false);
  });

  it("🔴 .mobileprovision を実際に開いて値を取り出している", () => {
    // security が使えない環境に備えて openssl のフォールバックも持つこと。
    expect(CODE, "プロファイルを復号していません").toMatch(/security cms -D -i/);
    expect(CODE, "openssl のフォールバックがありません").toMatch(
      /openssl smime -inform DER -verify -noverify/,
    );
    // Name / UUID / TeamIdentifier / application-identifier の4つを読むこと。
    for (const key of ["Name", "UUID", "TeamIdentifier", "application-identifier"]) {
      expect(CODE, `プロファイルから ${key} を読んでいません`).toContain(key);
    }
  });

  it("🔴 プロファイルの App ID を capacitor.config.ts の appId と突き合わせて落とす", () => {
    // 兄弟アプリが上流のプロファイルを Secrets ごと引き継いだときの唯一の歯止め。
    // 突き合わせが無いと「他人のアプリとして署名されたIPA」がアップロードまで行く。
    expect(CODE, "capacitor.config.ts から appId を読んでいません").toMatch(
      /appId[^\n]*capacitor\.config\.ts|capacitor\.config\.ts/,
    );
    expect(
      CODE,
      "プロファイルの bundle id と appId を比較して落とす検査がありません",
    ).toMatch(/\[\s*"\$PROFILE_BUNDLE_ID"\s*!=\s*"\$APP_ID"\s*\]/);
    // 比較しっぱなしで続行していないこと
    const idx = CODE.indexOf('"$PROFILE_BUNDLE_ID" != "$APP_ID"');
    expect(idx, "比較そのものが見つかりません").toBeGreaterThan(-1);
    expect(
      CODE.slice(idx, idx + 400),
      "App ID が食い違っても exit していません",
    ).toMatch(/exit 1/);
  });

  it("🔴 プロファイルを新旧どちらのディレクトリにも UUID 名で置く", () => {
    // Xcode 16 以降、置き場所が
    //   ~/Library/MobileDevice/Provisioning Profiles → ~/Library/Developer/Xcode/UserData/...
    // に変わった。このワークフローは「一番新しい Xcode」を選ぶので、
    // **コードを1行も変えていなくてもランナーの Xcode が上がった日に落ちうる**。
    expect(CODE, "旧ディレクトリに置いていません").toContain(
      "Library/MobileDevice/Provisioning Profiles",
    );
    expect(CODE, "Xcode 16+ の新ディレクトリに置いていません").toContain(
      "Library/Developer/Xcode/UserData/Provisioning Profiles",
    );
    // 置き方は左右で違う。旧は**動いている経路なので固定名のまま**、
    // 新は Xcode 自身が使う UUID 名（固定名だと拾わないことがある）。
    const copies = Object.fromEntries(
      [...CODE.matchAll(/cp "\$PROFILE" "\$(OLD|NEW)_DIR\/([^"]+)"/g)].map((m) => [m[1], m[2]]),
    );
    expect(Object.keys(copies).sort(), "プロファイルを2箇所に置いていません").toEqual([
      "NEW",
      "OLD",
    ]);
    expect(copies.NEW, "新ディレクトリ側が UUID 名になっていません").toContain("$PROFILE_UUID");
  });
});

describe("シークレットは境界で空白を落とす", () => {
  it("🔴 App Store Connect のキーIDを整形してからファイル名にする", () => {
    // キーIDは **ファイル名になる**。末尾に改行が混ざると AuthKey_XXXXXXXXXX(改行).p8 が
    // 作られ、altool は鍵を見つけられない。ログでは *** なので目視では追えない。
    expect(
      /AuthKey_\$\{?API_KEY_ID\}?\.p8/.test(CODE),
      "キーIDのシークレットを整形せずにファイル名へ使っています",
    ).toBe(false);
    expect(CODE, "整形済みのキーIDでファイル名を作っていません").toMatch(
      /AuthKey_\$\{KEY_ID\}\.p8/,
    );
  });

  it("🔴 空白を落とすヘルパーが実在する（コメントだけになっていない）", () => {
    expect(CODE, "空白を落とす処理がありません").toMatch(/tr -d '\[:space:\]'/);
    // パスワードは空白を含みうるので、改行だけを落とす経路も別に持つこと。
    expect(CODE, "改行だけを落とす経路がありません").toMatch(/tr -d '\\r\\n'/);
  });

  it("🔴 .p12 のパスワードは、整形した方の値で import する", () => {
    // ヘルパーが「定義されているだけ」で、実際には生の値を渡している——という戻り方を塞ぐ。
    // 末尾の改行が入ったパスワードは `security import` を落とし、
    // **証明書が壊れているように見える**（ストレッチボードが最初に疑ったのもそこ）。
    expect(CODE, "パスワードから改行を落としていません").toMatch(
      /P12_PASSWORD_CLEAN="\$\(trim_nl "\$P12_PASSWORD"\)"/,
    );
    expect(CODE, "security import が整形前のパスワードを使っています").toMatch(
      /security import[^\n]*-P "\$P12_PASSWORD_CLEAN"/,
    );
  });

  it("🔴 .p8 を CRLF のまま書き出さない", () => {
    // CRLF が混ざった PEM は読めない。ここで整えないと altool の認証だけが落ちる。
    expect(CODE).toMatch(/tr -d '\\r'[^\n]*AuthKey_/);
  });

  it("🔴 シークレットの中身を1バイトずつログに出す道具を使っていない", () => {
    // od / xxd / `sed -n l` は文字列を分解するので **GitHub のマスクをすり抜ける**。
    // このリポジトリは public。デバッグのつもりが公開になる。
    for (const tool of [/\bod\s+-/, /\bxxd\b/, /sed -n l/, /\bhexdump\b/]) {
      expect(tool.test(CODE), `${tool} でシークレットを覗くコードが入っています`).toBe(false);
    }
  });
});

describe("足りないシークレットはビルド前に落とす", () => {
  it("🔴 Preflight が必要なシークレットを名指しで確認する", () => {
    const steps = RAW.split(/^      - name: /m);
    const preflight = steps.find((s) => s.startsWith("Preflight"));
    expect(preflight, `${IOS_YML_PATH} に Preflight のステップがありません`).toBeTruthy();

    // 🔴 見るのは `run:` の中身だけ。`env:` にシークレット名を並べただけでは
    // **1つも検査していなくても**名前は全部そこに現れる。
    // 実際、検査ループを丸ごと消しても `env:` の名前で緑になってしまっていた。
    const body = preflight!.split(/\n\s+run: \|\n/)[1];
    expect(body, "Preflight の run: を読めません").toBeTruthy();

    expect(body, "Preflight が値を1つずつ検査していません（列挙しているだけ）").toMatch(
      /for n in/,
    );
    for (const name of [
      "IOS_P12_BASE64",
      "IOS_P12_PASSWORD",
      "IOS_PROVISION_PROFILE_BASE64",
      "APP_STORE_CONNECT_API_KEY",
      "APP_STORE_CONNECT_API_KEY_ID",
      "APP_STORE_CONNECT_ISSUER_ID",
    ]) {
      expect(body, `Preflight の検査対象に ${name} が入っていません`).toContain(name);
    }
    expect(body, "Preflight が空値を検出していません").toMatch(/missing/);
    expect(body, "Preflight が足りないときに落ちません").toMatch(/exit 1/);
  });

  it("🔴 Preflight がビルドより先に走る", () => {
    // 後ろに置くと「15分ビルドしてからアップロードで落ちる」に戻る。
    const order = [...RAW.matchAll(/^      - name: (.+)$/gm)].map((m) => m[1]);
    const preflight = order.findIndex((n) => n.startsWith("Preflight"));
    const build = order.findIndex((n) => n === "Build web");
    expect(preflight, "Preflight のステップがありません").toBeGreaterThan(-1);
    expect(build, "Build web のステップがありません").toBeGreaterThan(-1);
    expect(preflight, "Preflight がビルドより後ろにあります").toBeLessThan(build);
  });

  it("🔴 署名値の読み出しが、それを使う2ステップより先にある", () => {
    // $GITHUB_ENV は**次のステップから**しか効かない。順番を入れ替えると
    // PROFILE_NAME が空のまま署名され、`No profile ... matching ''` に戻る。
    const order = [...RAW.matchAll(/^      - name: (.+)$/gm)].map((m) => m[1]);
    const derive = order.findIndex((n) => n.includes("derive signing values"));
    const signing = order.findIndex((n) => n.startsWith("Configure App signing"));
    const exportOptions = order.findIndex((n) => n.startsWith("Create ExportOptions.plist"));
    expect(derive, "署名値を読み出すステップがありません").toBeGreaterThan(-1);
    expect(signing).toBeGreaterThan(derive);
    expect(exportOptions).toBeGreaterThan(derive);
  });

  it("使う側が、値が空のまま進まないようにしている", () => {
    // ステップの順番を入れ替えられたときの二重の歯止め。
    for (const v of ["PROFILE_NAME", "PROFILE_TEAM", "PROFILE_BUNDLE_ID"]) {
      expect(CODE, `${v} が空のまま進めてしまいます`).toMatch(
        new RegExp(`: "\\$\\{${v}:\\?`),
      );
    }
  });
});

describe("appId との整合（このテスト自身が空振りしていないこと）", () => {
  it("appId を読めている", () => {
    expect(APP_ID).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)+$/);
  });
});
