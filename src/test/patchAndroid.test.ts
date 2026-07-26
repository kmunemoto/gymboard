import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// scripts/patch-android.mjs が、Capacitor 7 世代のまま残っている android/ を
// Capacitor 8 のビルド構成へ引き上げられることを担保する。
//
// なぜ必要か: `npx cap sync android` は variables.gradle / build.gradle /
// gradle-wrapper.properties を**上書きしない**。そのため package.json の
// @capacitor/* だけ 8 に上げても android/ は 7 のまま取り残され、
//   Dependency 'androidx.browser:browser:1.9.0' requires
//   Android Gradle plugin 8.9.1 or higher.
//   This build currently uses Android Gradle plugin 8.7.2.
// で Gradle ビルドが落ちる（実際に2026-07に発生）。
// android/ は .gitignore 済みでCIから見えないため、モックを組んで検証する。

const SCRIPT = join(process.cwd(), "scripts/patch-android.mjs");

// Capacitor 7 が生成していた値。ここが「直っていない状態」の出発点。
const CAP7_VARIABLES = `ext {
    minSdkVersion = 23
    compileSdkVersion = 35
    targetSdkVersion = 35
    androidxActivityVersion = '1.9.2'
    androidxCoreVersion = '1.15.0'
    androidxWebkitVersion = '1.12.1'
    cordovaAndroidVersion = '10.1.1'
    firebaseMessagingVersion = '24.0.3'
}
`;

const CAP7_ROOT_GRADLE = `apply from: "variables.gradle"

buildscript {
    dependencies {
        classpath 'com.android.tools.build:gradle:8.7.2'
        classpath 'com.google.gms:google-services:4.4.2'
    }
}
`;

const CAP7_WRAPPER = `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.11.1-all.zip
zipStoreBase=GRADLE_USER_HOME
`;

const CAP7_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application>
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:name=".MainActivity" />
    </application>
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
</manifest>
`;

// versionCode / versionName はリリースの生命線なので、絶対に触られてはいけない。
const APP_GRADLE = `apply plugin: 'com.android.application'

android {
    defaultConfig {
        versionCode 74
        versionName "8.3"
    }
}

dependencies {
    implementation 'com.google.firebase:firebase-messaging:24.0.3'
}

apply plugin: 'com.google.gms.google-services'
`;

let dir: string;

function scaffold(overrides: Record<string, string> = {}) {
  const files: Record<string, string> = {
    "android/variables.gradle": CAP7_VARIABLES,
    "android/build.gradle": CAP7_ROOT_GRADLE,
    "android/gradle/wrapper/gradle-wrapper.properties": CAP7_WRAPPER,
    "android/app/src/main/AndroidManifest.xml": CAP7_MANIFEST,
    "android/app/build.gradle": APP_GRADLE,
    "keys/google-services.json": '{"mock":true}',
    ...overrides,
  };
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
}

/** スクリプトを実行し、終了コードと出力を返す。 */
function run(): { code: number; output: string } {
  try {
    const output = execFileSync("node", [SCRIPT], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GOOGLE_SERVICES_JSON: join(dir, "keys/google-services.json") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const read = (rel: string) => readFileSync(join(dir, rel), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "patch-android-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("patch-android.mjs（Capacitor 8 への引き上げ）", () => {
  it("Capacitor 7 の android/ を Capacitor 8 の構成に直す", () => {
    scaffold();
    expect(run().code, "パッチが失敗した").toBe(0);

    const vars = read("android/variables.gradle");
    expect(vars, "minSdk 23 のままだと :capacitor-android が要求する 24 に届かない").toMatch(
      /minSdkVersion = 24/,
    );
    // compileSdk 36 は androidx.browser:1.9.0 の AAR metadata 要件。
    expect(vars).toMatch(/compileSdkVersion = 36/);
    // targetSdk 36 は Google Play の 2026-08-31 要件。
    expect(vars).toMatch(/targetSdkVersion = 36/);

    // AGP 8.7.2 のままだと "requires Android Gradle plugin 8.9.1 or higher" で落ちる。
    const root = read("android/build.gradle");
    expect(root).toMatch(/com\.android\.tools\.build:gradle:8\.13\.0/);
    expect(root).toMatch(/com\.google\.gms:google-services:4\.4\.4/);

    // AGP 8.13 は Gradle 8.13 以上を要求する。
    expect(read("android/gradle/wrapper/gradle-wrapper.properties")).toMatch(
      /gradle-8\.14\.3-all\.zip/,
    );

    // Capacitor 8 が追加した configChanges。無いと密度変更で WebView の状態が飛ぶ。
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toMatch(/navigation/);
    expect(manifest).toMatch(/density/);
  });

  it("versionCode / versionName を書き換えない", () => {
    // ここが変わると Play Console が弾く（あるいは誤ったバージョンで公開される）。
    scaffold();
    expect(run().code).toBe(0);
    const app = read("android/app/build.gradle");
    expect(app).toMatch(/versionCode 74/);
    expect(app).toMatch(/versionName "8\.3"/);
  });

  it("variables.gradle の知らないキーを消さない", () => {
    scaffold();
    expect(run().code).toBe(0);
    expect(read("android/variables.gradle")).toMatch(/firebaseMessagingVersion = '24\.0\.3'/);
  });

  it("2回流しても結果が変わらない（冪等）", () => {
    scaffold();
    expect(run().code).toBe(0);
    const after1 = read("android/variables.gradle") + read("android/build.gradle");
    const second = run();
    expect(second.code).toBe(0);
    expect(read("android/variables.gradle") + read("android/build.gradle")).toBe(after1);
    expect(second.output).toMatch(/already up-to-date/);
  });

  it("引き継いだ androidxBrowserVersion が古ければ 1.9.0 に上げる", () => {
    scaffold({
      "android/variables.gradle": CAP7_VARIABLES.replace(
        "}",
        "    androidxBrowserVersion = '1.8.0'\n}",
      ),
    });
    expect(run().code).toBe(0);
    expect(read("android/variables.gradle")).toMatch(/androidxBrowserVersion = '1\.9\.0'/);
  });

  it("androidxBrowserVersion が無ければ足さない", () => {
    // 無ければ @capacitor/browser 側の既定値 1.9.0 が使われるので、書く必要がない。
    scaffold();
    expect(run().code).toBe(0);
    expect(read("android/variables.gradle")).not.toMatch(/androidxBrowserVersion/);
  });

  it("自動修正できなかったら成功扱いにせず、何が残ったかを言う", () => {
    // これが効かないと、10分待ってから Gradle のエラーで気づくことになる。
    scaffold({ "android/variables.gradle": "ext { minSdkVersion = 23\n}\n" });
    const { code, output } = run();
    expect(code, "直せていないのに成功扱いになっている").toBe(1);
    expect(output).toMatch(/minSdkVersion/);
  });

  it("AGP を置換できなかった場合も検知する", () => {
    scaffold({
      "android/build.gradle": CAP7_ROOT_GRADLE.replace(
        "classpath 'com.android.tools.build:gradle:8.7.2'",
        "alias(libs.plugins.android.application)",
      ),
    });
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toMatch(/Android Gradle Plugin/);
  });
});
