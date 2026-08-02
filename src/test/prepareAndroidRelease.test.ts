import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// scripts/prepare-android-release.mjs の回帰テスト。
//
// android/ は .gitignore 済みで CI からは実物が見えないため、patchAndroid.test.ts と
// 同じ作法でモックを組んで検証する（実機ビルド検証はできないので、せめて生成される
// Gradle の形が正しいことだけは機械的に担保する）。

const SCRIPT = join(process.cwd(), "scripts/prepare-android-release.mjs");

// `npx cap add android` 直後（Capacitor 8 テンプレートの既定値）を模したもの。
const FRESH_APP_GRADLE = `apply plugin: 'com.android.application'

android {
    namespace "app.gymboard.mobile"
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "app.gymboard.mobile"
        minSdk rootProject.ext.minSdkVersion
        targetSdk rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}

dependencies {
    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
}
`;

let dir: string;

function scaffold(appGradle = FRESH_APP_GRADLE) {
  const full = join(dir, "android/app/build.gradle");
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, appGradle);
}

function run(env: Record<string, string> = {}): { code: number; output: string } {
  try {
    const output = execFileSync("node", [SCRIPT], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const read = () => readFileSync(join(dir, "android/app/build.gradle"), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prepare-android-release-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("prepare-android-release.mjs", () => {
  it("環境変数が無ければ何もしない（ローカル実行しても無害）", () => {
    scaffold();
    expect(run().code).toBe(0);
    expect(read()).toBe(FRESH_APP_GRADLE);
  });

  it("versionCode / versionName を書き換える", () => {
    scaffold();
    expect(run({ ANDROID_VERSION_CODE: "123", ANDROID_VERSION_NAME: "1.2.0" }).code).toBe(0);
    const out = read();
    expect(out).toMatch(/versionCode 123/);
    expect(out).toMatch(/versionName "1\.2\.0"/);
  });

  it("ANDROID_VERSION_CODE が数値でなければ失敗する", () => {
    scaffold();
    const { code, output } = run({ ANDROID_VERSION_CODE: "not-a-number" });
    expect(code).toBe(1);
    expect(output).toMatch(/整数/);
  });

  // ここから3件は「初回CIリリースが Version code N has already been used で弾かれる」
  // 問題への回帰テスト。github.run_number は 1 から始まるので、手作業時代の
  // versionCode を超えるための下駄が要る（mem/features/android-ci.md）。
  it("ANDROID_VERSION_CODE_BASE の分だけ versionCode に下駄を履かせる", () => {
    scaffold();
    const { code, output } = run({ ANDROID_VERSION_CODE: "1", ANDROID_VERSION_CODE_BASE: "10000" });
    expect(code).toBe(0);
    // run_number=1（初回実行）でも 1 にはならない
    expect(read()).toMatch(/versionCode 10001\b/);
    expect(read()).not.toMatch(/versionCode 1\n/);
    // 何を足した結果なのかログに出す（CIログだけで追えるように）
    expect(output).toMatch(/10001（base 10000 \+ 1）/);
  });

  it("ANDROID_VERSION_CODE_BASE が数値でなければ失敗する", () => {
    scaffold();
    const { code, output } = run({ ANDROID_VERSION_CODE: "1", ANDROID_VERSION_CODE_BASE: "10,000" });
    expect(code).toBe(1);
    expect(output).toMatch(/ANDROID_VERSION_CODE_BASE は整数/);
  });

  it("versionCode が Google Play の上限を超えたら失敗する", () => {
    scaffold();
    const { code, output } = run({ ANDROID_VERSION_CODE: "1", ANDROID_VERSION_CODE_BASE: "2100000000" });
    expect(code).toBe(1);
    expect(output).toMatch(/上限\(2100000000\)/);
  });

  it("署名設定一式を android ブロックへ配線し、release に signingConfig を足す", () => {
    scaffold();
    const { code } = run({
      ANDROID_KEYSTORE_PATH: "/tmp/release.keystore",
      ANDROID_KEYSTORE_PASSWORD: "storepass",
      ANDROID_KEY_ALIAS: "release",
      ANDROID_KEY_PASSWORD: "keypass",
    });
    expect(code).toBe(0);
    const out = read();
    expect(out).toMatch(/signingConfigs\s*\{[\s\S]*release\s*\{[\s\S]*storeFile file\(System\.getenv\("ANDROID_KEYSTORE_PATH"\)\)/);
    expect(out).toMatch(/storePassword System\.getenv\("ANDROID_KEYSTORE_PASSWORD"\)/);
    expect(out).toMatch(/keyAlias System\.getenv\("ANDROID_KEY_ALIAS"\)/);
    expect(out).toMatch(/keyPassword System\.getenv\("ANDROID_KEY_PASSWORD"\)/);
    // buildTypes.release の中に signingConfig の割り当てがある
    expect(out).toMatch(/release\s*\{\s*\n\s*signingConfig signingConfigs\.release/);
    // 元々あった release ブロックの中身（minifyEnabled 等）を消していない
    expect(out).toMatch(/minifyEnabled false/);
  });

  it("キーストア用の環境変数が一部だけだと失敗する（設定ミスを検知）", () => {
    scaffold();
    const { code, output } = run({ ANDROID_KEYSTORE_PATH: "/tmp/release.keystore" });
    expect(code).toBe(1);
    expect(output).toMatch(/全部揃えるか、全部省略/);
  });

  it("2回流しても壊れない（冪等）", () => {
    scaffold();
    const env = {
      ANDROID_VERSION_CODE: "5",
      ANDROID_VERSION_NAME: "1.0.5",
      ANDROID_KEYSTORE_PATH: "/tmp/release.keystore",
      ANDROID_KEYSTORE_PASSWORD: "storepass",
      ANDROID_KEY_ALIAS: "release",
      ANDROID_KEY_PASSWORD: "keypass",
    };
    expect(run(env).code).toBe(0);
    const after1 = read();
    const second = run(env);
    expect(second.code).toBe(0);
    expect(read()).toBe(after1);
    // signingConfigs のブロックが2重に増えていない
    expect((after1.match(/signingConfigs\s*\{/g) ?? []).length).toBe(1);
  });

  it("android/app/build.gradle が無ければ分かりやすく失敗する", () => {
    // scaffold() を呼ばない＝ npx cap sync android がまだ走っていない状態を模す
    const { code, output } = run({ ANDROID_VERSION_CODE: "1" });
    expect(code).toBe(1);
    expect(output).toMatch(/npx cap sync android/);
  });

  it("versionCode の置換対象が無ければ失敗する（テンプレートの形が変わったことを検知）", () => {
    scaffold(FRESH_APP_GRADLE.replace("versionCode 1", "// no versionCode here"));
    const { code, output } = run({ ANDROID_VERSION_CODE: "1" });
    expect(code).toBe(1);
    expect(output).toMatch(/versionCode の置換箇所/);
  });

  it("versionCode の下駄が無ければ、初回実行の versionCode は 1 になってしまう（下駄が要る理由の実証）", () => {
    scaffold();
    // ANDROID_VERSION_CODE_BASE を渡さない＝下駄が無い状態。
    // github.run_number は初回実行で 1 なので、これがそのまま versionCode 1 になる。
    expect(run({ ANDROID_VERSION_CODE: "1" }).code).toBe(0);
    expect(read()).toMatch(/versionCode 1\b/);
  });

  it("buildTypes.release が無ければ署名配線に失敗する（テンプレートの形が変わったことを検知）", () => {
    scaffold(FRESH_APP_GRADLE.replace(/buildTypes[\s\S]*?\n\}\n\n/, ""));
    const { code, output } = run({
      ANDROID_KEYSTORE_PATH: "/tmp/release.keystore",
      ANDROID_KEYSTORE_PASSWORD: "storepass",
      ANDROID_KEY_ALIAS: "release",
      ANDROID_KEY_PASSWORD: "keypass",
    });
    expect(code).toBe(1);
    expect(output).toMatch(/buildTypes\.release/);
  });
});

// ワークフロー側の配線を見張る。スクリプトが下駄に対応していても、
// android-build.yml が ANDROID_VERSION_CODE_BASE を渡さなければ意味が無く、
// しかもその失敗は「10分ビルドした最後のアップロード段で Play に弾かれる」
// という一番痛い形でしか出ない（CIでは検知できない）。
describe("android-build.yml の versionCode 配線", () => {
  const yml = readFileSync(join(process.cwd(), ".github/workflows/android-build.yml"), "utf8");

  it("ANDROID_VERSION_CODE_BASE を渡している", () => {
    expect(yml).toMatch(/ANDROID_VERSION_CODE_BASE:\s*"?\d+"?/);
  });

  it("下駄は手作業時代の versionCode を確実に上回る大きさにしてある", () => {
    const m = yml.match(/ANDROID_VERSION_CODE_BASE:\s*"?(\d+)"?/);
    expect(m).not.toBeNull();
    // 手で +1 しながら運用してきた番号がここに達することは実質ありえない。
    expect(Number(m![1])).toBeGreaterThanOrEqual(1000);
  });

  it("versionCode の増分には github.run_number を使い続けている（単調増加の担保）", () => {
    expect(yml).toMatch(/ANDROID_VERSION_CODE:\s*\$\{\{\s*github\.run_number\s*\}\}/);
  });
});
