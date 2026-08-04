import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// プッシュ通知が「無言で届かない」形に壊れるのを防ぐ検査。
//
// ── どちらも 2026-08-04 にピラボードの報告で判明した ──────────────
//
// ### 1. 通知アイコンを指定しないと、通知が白い塊になる
//
// `com.google.firebase.messaging.default_notification_icon` を指定しないと、
// 通知にはランチャーアイコン（フルカラー）がそのまま使われる。
// Android 5.0 (API 21) 以降、ステータスバーのアイコンは **OS が RGB を無視し
// アルファチャンネルだけを使って白く塗りつぶして描画する**ため、
// 全面不透明のランチャーアイコンは「白い四角の塊」になって判読できない。
//
// ジムボードの `assets/icon-only.png` は全面不透明。指定が無い間、
// **Android の通知は全部この白い塊だった。**
//
// ### 2. アプリの Firebase と サーバの送信鍵 が別プロジェクトだと無言で失敗する
//
// アプリに焼く `google-services.json` / `GoogleService-Info.plist` の project_id と、
// Supabase Secrets の `FIREBASE_SERVICE_ACCOUNT_JSON` の project_id が違うと、
// **端末にトークンは保存されるのに配信だけ 403 SENDER_ID_MISMATCH で失敗する。**
// しかも `send-push-notification` の `isInvalid` は 403 を無効トークン扱いしないので、
// トークンは消えず、ただ永久に届かない。
//
// ピラボードは実際にこれを踏んだ（`gymboard-59570` の設定が混入。
// **ログには出ていたが、突き合わせが人間任せで誰も見ていなかった**）。
//
// サーバ側の鍵はリポジトリに無いので、**期待値を1ファイルに固定**して
// ビルド時に突き合わせる。`nativeAppIdentity.test.ts` は appId の整合性しか見ないので、
// この不一致は検出できない（別の検査が要る）。

const EXPECTED_FILE = ".github/expected-firebase-project-id";
const PATCH_SCRIPT = "scripts/patch-android.mjs";
const IOS_YML = ".github/workflows/ios-build.yml";
const ANDROID_YML = ".github/workflows/android-build.yml";

const DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"] as const;
/** Android の通知アイコンの規定サイズ（dp 単位で 24dp 相当） */
const EXPECTED_PX: Record<(typeof DENSITIES)[number], number> = {
  mdpi: 24,
  hdpi: 36,
  xhdpi: 48,
  xxhdpi: 72,
  xxxhdpi: 96,
};

describe("Android の通知アイコン", () => {
  it("5密度ぶんの素材がコミットされている", () => {
    // Windows + Android Studio の手作業でもビルドできるよう、画像は事前生成して
    // リポジトリに置く（ImageMagick 等が入っている保証が無いため）。
    for (const d of DENSITIES) {
      const p = `assets/notification-icon/ic_stat_notification-${d}.png`;
      expect(existsSync(p), `${p} がありません`).toBe(true);
    }
  });

  it("素材が正しいサイズで、白＋透過になっている", () => {
    // PNG のヘッダ（IHDR）から幅・高さと色形式を直接読む。
    // 画像ライブラリを増やさずに「中身が期待どおりか」を見る。
    for (const d of DENSITIES) {
      const buf = readFileSync(`assets/notification-icon/ic_stat_notification-${d}.png`);
      expect(buf.subarray(1, 4).toString("ascii"), `${d}: PNG ではありません`).toBe("PNG");
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      const colorType = buf.readUInt8(25);
      expect(width, `${d}: 幅が違います`).toBe(EXPECTED_PX[d]);
      expect(height, `${d}: 高さが違います`).toBe(EXPECTED_PX[d]);
      // colorType 6 = RGBA, 4 = グレースケール+アルファ。いずれもアルファを持つ。
      // アルファが無い（0/2/3）と、OS の描画で全面が白く塗られて塊になる。
      expect(
        [4, 6],
        `${d}: アルファチャンネルがありません（colorType=${colorType}）。` +
          `通知アイコンは白＋透過でなければ、ステータスバーで白い塊になります。`,
      ).toContain(colorType);
    }
  });

  it("patch-android.mjs が素材を配置し、Manifest に既定アイコンを指定する", () => {
    const src = readFileSync(PATCH_SCRIPT, "utf8");
    expect(src).toMatch(/ic_stat_notification/);
    expect(src).toMatch(/com\.google\.firebase\.messaging\.default_notification_icon/);
    expect(src).toMatch(/@mipmap\/\$\{NOTIF_ICON_NAME\}|@mipmap\/ic_stat_notification/);
    // 素材が欠けたまま進めない（欠けたら白い塊に戻るので、黙って続行させない）
    expect(src).toMatch(/missingIcons[\s\S]{0,400}process\.exit\(1\)/);
  });

  it("素材の生成を patch 時に行わない（Windows の手作業ビルドを壊さない）", () => {
    // 画像生成ツールに依存すると、Windows + Android Studio の経路で落ちる。
    // ピラボードは ffmpeg 依存で8連続失敗している
    // （しかも `bash -e` のステップなので、後続のフォールバックに到達しなかった）。
    //
    // 「なぜ依存しないのか」を説明したコメント自体がツール名を含むので、
    // コメントを落としてから実コードだけを見る。
    const raw = readFileSync(PATCH_SCRIPT, "utf8");
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/\b(imagemagick|ffmpeg|sharp|jimp)\b/i);
    expect(code, "画像生成コマンドを呼んでいます").not.toMatch(/execSync|spawnSync/);
  });
});

describe("Firebase プロジェクトの突き合わせ", () => {
  it("期待値が1ファイルに固定されている", () => {
    expect(existsSync(EXPECTED_FILE), `${EXPECTED_FILE} がありません`).toBe(true);
    const v = readFileSync(EXPECTED_FILE, "utf8").trim();
    expect(v, "期待値が空です").not.toBe("");
    expect(v, "改行や空白が混ざっています").toMatch(/^[a-z0-9-]+$/);
  });

  it("iOS のビルドが plist の PROJECT_ID を期待値と突き合わせる", () => {
    const yml = readFileSync(IOS_YML, "utf8");
    expect(yml).toMatch(/expected-firebase-project-id/);
    // 比較式そのものを固定する。`ACTUAL_PROJECT … exit 1` だけを見ると、
    // 条件を `if false; then` に潰されても緑のままになる（実際にすり抜けた）。
    expect(yml).toMatch(
      /\[\s*"\$ACTUAL_PROJECT"\s*!=\s*"\$EXPECTED_PROJECT"\s*\][\s\S]{0,800}exit 1/,
    );
  });

  it("Android のビルドが google-services.json の project_id を期待値と突き合わせる", () => {
    const yml = readFileSync(ANDROID_YML, "utf8");
    expect(yml).toMatch(/expected-firebase-project-id/);
    expect(yml).toMatch(/project_id[\s\S]{0,400}add_bad/);
  });

  it("iOS の inline plist が期待値と一致している", () => {
    // 上流自身がズレていたら意味が無いので、ここでも突き合わせる。
    const expected = readFileSync(EXPECTED_FILE, "utf8").trim();
    const yml = readFileSync(IOS_YML, "utf8");
    const actual = yml.match(/<key>PROJECT_ID<\/key>\s*\n\s*<string>([^<]+)<\/string>/)?.[1];
    expect(actual, `${IOS_YML} から PROJECT_ID を読めません`).toBeTruthy();
    expect(
      actual,
      `inline plist の PROJECT_ID (${actual}) が ${EXPECTED_FILE} (${expected}) と違います`,
    ).toBe(expected);
  });
});
