#!/usr/bin/env node
/**
 * `android-version.json` の値を android/app/build.gradle に書き込む。
 *
 * ## なぜ要るか
 *
 * `android/` は .gitignore 済みで、Android のリリースは Windows + Android Studio の
 * 手作業。つまり versionCode / versionName は**リポジトリのどこからも読めない**値だった。
 *
 * これが実際に困った:
 *   - 「バージョンを1つ上げて」と言われても、上げようがない
 *     （Play Console か Windows の build.gradle を見るまで現在値が分からない）
 *   - `npx cap add android` で作り直すと Capacitor 既定値（versionCode 1 / "1.0"）に戻る
 *   - 「上げ忘れ」も「上げたつもり」も、Play にアップロードするまで気づけない
 *
 * そこで**版数だけをリポジトリに持つ**。手作業経路（build-android.bat）から呼ぶ。
 *
 * ## 他の2つのスクリプトとの棲み分け
 *
 * - `patch-android.mjs` … Gradle/Manifest/google-services.json。
 *   **versionCode / versionName は書き換えない**（`src/test/patchAndroid.test.ts` が固定）
 * - `prepare-android-release.mjs` … CI専用。環境変数から版数と署名設定を書く。
 *   CI は `android/` を毎回作り直すため run_number ベースの採番を使う（別の線）
 * - このスクリプト … 手作業経路専用。リポジトリの `android-version.json` を書く
 *
 * ## 採番が CI とぶつからないこと
 *
 * CI 側は `ANDROID_VERSION_CODE_BASE = 10000` + run_number。
 * 手作業側は 82 から1ずつ。**手作業が 10000 に達することは実質ありえない**ので、
 * 将来 CI に移行しても versionCode は単調増加のまま。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION_FILE = path.join(ROOT, "android-version.json");
const APP_GRADLE = path.join(ROOT, "android/app/build.gradle");

const log = (m) => console.log(`[set-android-version] ${m}`);
const die = (m) => {
  console.error(`[set-android-version] ${m}`);
  process.exit(1);
};

if (!fs.existsSync(VERSION_FILE)) {
  die(`android-version.json が見つかりません。リポジトリの直下に置いてください。`);
}
if (!fs.existsSync(APP_GRADLE)) {
  die(
    `android/app/build.gradle が見つかりません。` +
      `\n  npx cap sync android を先に実行してください。`,
  );
}

let conf;
try {
  conf = JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
} catch (e) {
  die(`android-version.json が JSON として読めません: ${e.message}`);
}

const { versionCode, versionName } = conf;

// 型が違うと Gradle 側で静かに変な値になるので、ここで止める。
if (!Number.isInteger(versionCode) || versionCode < 1) {
  die(`versionCode は1以上の整数である必要があります: ${JSON.stringify(versionCode)}`);
}
// Google Play の上限。超えると弾かれるうえ、versionCode は二度と下げられない。
if (versionCode > 2100000000) {
  die(`versionCode が上限(2100000000)を超えています: ${versionCode}`);
}
if (typeof versionName !== "string" || !/^\d+(\.\d+)*$/.test(versionName)) {
  die(`versionName は "9.1" のような形式である必要があります: ${JSON.stringify(versionName)}`);
}

let src = fs.readFileSync(APP_GRADLE, "utf8");

// 置換できたかは前後比較ではなく**パターンの有無**で判定する。
// 前後比較だと「既に同じ値」＝冪等な再実行を「見つからなかった」と誤判定する
// （prepare-android-release.mjs で実際に踏んだ）。
if (!/versionCode\s+\d+/.test(src)) {
  die("versionCode の置換箇所が見つかりませんでした（Capacitor のテンプレートが変わった可能性）");
}
if (!/versionName\s+"[^"]*"/.test(src)) {
  die("versionName の置換箇所が見つかりませんでした（Capacitor のテンプレートが変わった可能性）");
}

const currentCode = Number(/versionCode\s+(\d+)/.exec(src)[1]);
// ⚠️ 下げると Play が `Version code N has already been used` で弾く。
// ただし `cap add android` 直後はテンプレート既定値の 1 なので、そこからは必ず上がる。
if (currentCode > versionCode) {
  console.warn(
    `[set-android-version] ⚠️ build.gradle の versionCode (${currentCode}) が ` +
      `android-version.json (${versionCode}) より大きいです。\n` +
      `  Play に ${currentCode} 以上が既に上がっているなら、このままでは弾かれます。\n` +
      `  android-version.json を ${currentCode + 1} 以上に上げてください。`,
  );
}

src = src
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);

fs.writeFileSync(APP_GRADLE, src);
log(`versionCode ${versionCode} / versionName "${versionName}" を書き込みました`);
log(`⚠️ アップロード前に Play Console の最新 versionCode を確認してください。`);
