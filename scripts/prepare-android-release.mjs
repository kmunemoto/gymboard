#!/usr/bin/env node
/**
 * CI専用。android/app/build.gradle に「リリース署名」と「バージョン番号」を書き込む。
 *
 * scripts/patch-android.mjs とはあえて別スクリプトにしてある。
 * patch-android.mjs は「versionCode / versionName を書き換えない」ことを
 * src/test/patchAndroid.test.ts が明示的に守っている（Windows側の手作業を壊さないため）。
 * ここで両方を混ぜると、その不変条件が読みにくくなる。
 *
 * ローカル（Windows + Android Studio）の手順には一切関与しない。
 * 環境変数が無ければ何もせず終了する（＝ローカルで誤って実行しても無害）。
 *
 * 使い方（.github/workflows/android-build.yml から呼ぶ）:
 *   ANDROID_VERSION_CODE=123 \
 *   ANDROID_VERSION_NAME=1.2.0 \
 *   ANDROID_KEYSTORE_PATH=/path/to/release.keystore \
 *   ANDROID_KEYSTORE_PASSWORD=*** \
 *   ANDROID_KEY_ALIAS=*** \
 *   ANDROID_KEY_PASSWORD=*** \
 *   node scripts/prepare-android-release.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP_GRADLE = path.join(ROOT, "android/app/build.gradle");

const {
  ANDROID_VERSION_CODE,
  ANDROID_VERSION_NAME,
  ANDROID_KEYSTORE_PATH,
  ANDROID_KEYSTORE_PASSWORD,
  ANDROID_KEY_ALIAS,
  ANDROID_KEY_PASSWORD,
} = process.env;

const log = (m) => console.log(`[prepare-android-release] ${m}`);

if (!fs.existsSync(APP_GRADLE)) {
  console.error(`[prepare-android-release] ${path.relative(ROOT, APP_GRADLE)} が見つかりません。npx cap sync android を先に実行してください。`);
  process.exit(1);
}

let src = fs.readFileSync(APP_GRADLE, "utf8");
const before = src;

// --- バージョン番号 -----------------------------------------------------
//
// android/ は .gitignore 済みで CI では毎回 `npx cap add android` から作り直すため、
// Capacitor テンプレートの既定値（versionCode 1 / versionName "1.0"）から出発する。
// ここで「前回から+1」のような相対更新はできない（前回の値がCIから見えないため）。
//
// versionCode は ios-build.yml の CURRENT_PROJECT_VERSION と同じ発想で
// github.run_number（呼び出し側が渡す）を使う。実行のたびに単調増加するので、
// 「android/ を作り直すと versionCode が1に戻る」という手作業時代の地雷が
// 構造的に起きない（mem/features/capacitor-8-upgrade.md「やってはいけないこと」）。
// 置換したかどうかは前後比較ではなく、パターンの有無で判定する。
// （前後比較だと「置換後の値が偶然元の値と同じ文字列」＝冪等時の再実行で
//   "見つからなかった" と誤判定する。実際にこの版で踏んだ）
if (ANDROID_VERSION_CODE) {
  if (!/^\d+$/.test(ANDROID_VERSION_CODE)) {
    console.error(`[prepare-android-release] ANDROID_VERSION_CODE は整数である必要があります: ${ANDROID_VERSION_CODE}`);
    process.exit(1);
  }
  if (!/versionCode\s+\d+/.test(src)) {
    console.error("[prepare-android-release] versionCode の置換箇所が見つかりませんでした（Capacitorのテンプレートが変わった可能性）");
    process.exit(1);
  }
  src = src.replace(/versionCode\s+\d+/, `versionCode ${ANDROID_VERSION_CODE}`);
  log(`versionCode -> ${ANDROID_VERSION_CODE}`);
}

if (ANDROID_VERSION_NAME) {
  if (!/versionName\s+"[^"]*"/.test(src)) {
    console.error("[prepare-android-release] versionName の置換箇所が見つかりませんでした（Capacitorのテンプレートが変わった可能性）");
    process.exit(1);
  }
  src = src.replace(/versionName\s+"[^"]*"/, `versionName "${ANDROID_VERSION_NAME}"`);
  log(`versionName -> ${ANDROID_VERSION_NAME}`);
}

// --- 署名設定 -------------------------------------------------------------
//
// ローカルの Android Studio は「Generate Signed App Bundle」ウィザードでその場限りの
// 署名をするので、android/app/build.gradle に signingConfigs を持つ必要が無い。
// CI（./gradlew bundleRelease）は非対話なので、build.gradle 自体に書く必要がある。
const keystoreVars = [ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD];
const anyKeystoreVar = keystoreVars.some(Boolean);
const allKeystoreVars = keystoreVars.every(Boolean);

if (anyKeystoreVar && !allKeystoreVars) {
  console.error(
    "[prepare-android-release] ANDROID_KEYSTORE_PATH / ANDROID_KEYSTORE_PASSWORD / " +
      "ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD は全部揃えるか、全部省略してください（一部だけ設定されています）。",
  );
  process.exit(1);
}

if (allKeystoreVars) {
  if (src.includes("signingConfigs.release")) {
    log("signingConfigs は既に配線済み（冪等）");
  } else if (!/android\s*\{/.test(src)) {
    console.error("[prepare-android-release] android { ... } ブロックが見つかりません");
    process.exit(1);
  } else {
    const signingBlock =
      `    signingConfigs {\n` +
      `        release {\n` +
      `            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))\n` +
      `            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")\n` +
      `            keyAlias System.getenv("ANDROID_KEY_ALIAS")\n` +
      `            keyPassword System.getenv("ANDROID_KEY_PASSWORD")\n` +
      `        }\n` +
      `    }\n`;
    // signingConfigs は android { の直後、defaultConfig 等より前に置く
    // （Gradle の評価順序上は場所を問わないが、他ブロックとの対称性のため）。
    src = src.replace(/(android\s*\{\n)/, `$1${signingBlock}`);

    if (/buildTypes\s*\{[\s\S]*?release\s*\{/.test(src)) {
      // 既存の release ブロックに signingConfig 行を差し込む
      src = src.replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{\n)/,
        `$1            signingConfig signingConfigs.release\n`,
      );
    } else {
      console.error("[prepare-android-release] buildTypes.release ブロックが見つかりません（Capacitorのテンプレートが変わった可能性）");
      process.exit(1);
    }
    log("signingConfigs.release を配線し、buildTypes.release に適用");
  }
} else {
  log("キーストア関連の環境変数が無いので署名設定はスキップ（ローカル実行時の既定）");
}

if (src !== before) {
  fs.writeFileSync(APP_GRADLE, src);
  log(`書き込み完了: ${path.relative(ROOT, APP_GRADLE)}`);
} else {
  log("変更なし");
}
