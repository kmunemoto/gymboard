#!/usr/bin/env node
/**
 * Patches the Capacitor-generated android/ directory.
 * Run AFTER `npx cap sync android`. Idempotent — safe to re-run.
 *
 * Steps:
 *  0. Upgrade the android/ platform files to the Capacitor 8 baseline
 *     (variables.gradle / gradle-wrapper.properties / build.gradle / AndroidManifest.xml)
 *  1. Add Google Services classpath to android/build.gradle
 *  2. Apply com.google.gms.google-services plugin in android/app/build.gradle
 *     and ensure firebase-messaging dependency is present
 *  3. Ensure POST_NOTIFICATIONS permission in AndroidManifest.xml
 *  4. Copy google-services.json from GOOGLE_SERVICES_JSON env (or default Windows path)
 *     into android/app/google-services.json
 *
 * Why step 0 exists:
 *   `npx cap sync android` deliberately does NOT overwrite variables.gradle,
 *   build.gradle or gradle-wrapper.properties, so bumping @capacitor/* in
 *   package.json leaves the existing android/ folder on the OLD toolchain.
 *   A Capacitor 7 era android/ (AGP 8.7.2 / compileSdk 35) then fails the
 *   Gradle build with, for example:
 *     Dependency 'androidx.browser:browser:1.9.0' requires
 *     Android Gradle plugin 8.9.1 or higher.
 *     This build currently uses Android Gradle plugin 8.7.2.
 *   Step 0 brings those files up to the values shipped in the Capacitor 8
 *   android-template so the build matches what the plugins expect.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ANDROID = path.join(ROOT, "android");
const APP = path.join(ANDROID, "app");

// Values taken from the Capacitor 8 android-template (identical across 8.0.0 - 8.4.2).
// Keep these in sync when upgrading @capacitor/* in package.json.
const CAP8 = {
  agp: "8.13.0",
  googleServices: "4.4.4",
  gradle: "8.14.3",
  // Written into android/variables.gradle. Values are literal Gradle expressions.
  variables: {
    minSdkVersion: "24",
    compileSdkVersion: "36",
    targetSdkVersion: "36",
    androidxActivityVersion: "'1.11.0'",
    androidxAppCompatVersion: "'1.7.1'",
    androidxCoordinatorLayoutVersion: "'1.3.0'",
    androidxCoreVersion: "'1.17.0'",
    androidxFragmentVersion: "'1.8.9'",
    coreSplashScreenVersion: "'1.2.0'",
    androidxWebkitVersion: "'1.14.0'",
    junitVersion: "'4.13.2'",
    androidxJunitVersion: "'1.3.0'",
    androidxEspressoCoreVersion: "'3.7.0'",
    cordovaAndroidVersion: "'14.0.1'",
  },
  // Only rewritten when the key already exists — @capacitor/browser defaults to
  // 1.9.0 on its own, and an inherited older pin would break the AAR metadata check.
  androidxBrowserVersion: "'1.9.0'",
  // Capacitor 8 added navigation|density; without them the Activity is recreated
  // (and the WebView state is lost) on density / navigation-mode changes.
  configChanges: [
    "orientation",
    "keyboardHidden",
    "keyboard",
    "screenSize",
    "locale",
    "smallestScreenSize",
    "screenLayout",
    "uiMode",
    "navigation",
    "density",
  ],
};

if (!fs.existsSync(ANDROID)) {
  console.error("[patch-android] android/ not found. Run `npx cap sync android` first.");
  process.exit(1);
}

const log = (m) => console.log(`[patch-android] ${m}`);

function patchFile(file, patcher) {
  if (!fs.existsSync(file)) {
    log(`skipped (not found): ${path.relative(ROOT, file)}`);
    return;
  }
  const src = fs.readFileSync(file, "utf8");
  const out = patcher(src);
  if (out !== src) {
    fs.writeFileSync(file, out);
    log(`patched ${path.relative(ROOT, file)}`);
  } else {
    log(`already up-to-date: ${path.relative(ROOT, file)}`);
  }
}

/** Set `key = literal` inside the ext { } block, preserving unrelated keys. */
function setExtValue(src, key, literal) {
  const assign = new RegExp(`^([ \\t]*)${key}([ \\t]*=[ \\t]*).*$`, "m");
  if (assign.test(src)) return src.replace(assign, `$1${key}$2${literal}`);
  // Key absent — insert it at the top of the ext block.
  const extOpen = /(\bext\s*\{[ \t]*\r?\n)/;
  if (!extOpen.test(src)) return src;
  return src.replace(extOpen, `$1    ${key} = ${literal}\n`);
}

// 0a) variables.gradle: SDK levels + AndroidX versions
patchFile(path.join(ANDROID, "variables.gradle"), (src) => {
  let out = src;
  for (const [key, literal] of Object.entries(CAP8.variables)) {
    out = setExtValue(out, key, literal);
  }
  // Never introduced by us, but an inherited pin must not stay below 1.9.0.
  if (/^[ \t]*androidxBrowserVersion[ \t]*=/m.test(out)) {
    out = setExtValue(out, "androidxBrowserVersion", CAP8.androidxBrowserVersion);
  }
  return out;
});

// 0b) gradle-wrapper.properties: Gradle distribution required by AGP 8.13
patchFile(path.join(ANDROID, "gradle/wrapper/gradle-wrapper.properties"), (src) =>
  src.replace(
    /^distributionUrl=.*$/m,
    `distributionUrl=https\\://services.gradle.org/distributions/gradle-${CAP8.gradle}-all.zip`,
  ),
);

// 0c) Project-level build.gradle: bump AGP + Google Services if already pinned
patchFile(path.join(ANDROID, "build.gradle"), (src) =>
  src
    .replace(
      /(classpath\s+['"]com\.android\.tools\.build:gradle:)[^'"]+(['"])/,
      `$1${CAP8.agp}$2`,
    )
    .replace(
      /(classpath\s+['"]com\.google\.gms:google-services:)[^'"]+(['"])/,
      `$1${CAP8.googleServices}$2`,
    ),
);

// 0d) AndroidManifest.xml: add the configChanges values Capacitor 8 expects
patchFile(path.join(APP, "src/main/AndroidManifest.xml"), (src) =>
  src.replace(/android:configChanges="([^"]*)"/g, (_m, value) => {
    const parts = value.split("|").map((s) => s.trim()).filter(Boolean);
    for (const needed of CAP8.configChanges) {
      if (!parts.includes(needed)) parts.push(needed);
    }
    return `android:configChanges="${parts.join("|")}"`;
  }),
);

// 1) Project-level build.gradle: add Google Services classpath
patchFile(path.join(ANDROID, "build.gradle"), (src) => {
  if (src.includes("com.google.gms:google-services")) return src;
  return src.replace(
    /(dependencies\s*\{)([\s\S]*?)(classpath\s+['"]com\.android\.tools\.build:gradle[^'"]+['"])/,
    `$1$2$3\n        classpath 'com.google.gms:google-services:${CAP8.googleServices}'`
  );
});

// 2) App-level build.gradle: apply plugin + add firebase-messaging dep
patchFile(path.join(APP, "build.gradle"), (src) => {
  let out = src;
  if (!out.includes("com.google.gms.google-services")) {
    out = out.trimEnd() + `\n\napply plugin: 'com.google.gms.google-services'\n`;
  }
  if (!out.includes("com.google.firebase:firebase-messaging")) {
    out = out.replace(
      /dependencies\s*\{/,
      `dependencies {\n    implementation 'com.google.firebase:firebase-messaging:24.0.3'`
    );
  }
  return out;
});

// 3) AndroidManifest.xml: ensure POST_NOTIFICATIONS permission
patchFile(path.join(APP, "src/main/AndroidManifest.xml"), (src) => {
  if (src.includes("android.permission.POST_NOTIFICATIONS")) return src;
  return src.replace(
    /(<\/manifest>)/,
    `    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>\n$1`
  );
});

// 3b) 通知アイコン（白＋透過）を配置し、AndroidManifest.xml で既定に指定する
//
// ⚠️ 指定しないと、通知にはランチャーアイコン（フルカラー）がそのまま使われる。
// Android 5.0 (API 21) 以降、ステータスバーのアイコンは **OS が RGB を無視し
// アルファチャンネルだけを使って白く塗りつぶして描画する**ため、
// 全面不透明のランチャーアイコンは「白い四角の塊」になって判読できなくなる。
//
// ジムボードの assets/icon-only.png は全面不透明なので、この指定が無い間は
// **Android の通知が全部この白い塊だった**（2026-08-04 にピラボードの報告で発覚）。
//
// PNG は事前生成して assets/notification-icon/ にコミットしてある。
// ここで画像を生成しないのは、Android のリリースが Windows + Android Studio の
// 手作業（mem/features/android-ci.md）で、ImageMagick 等が入っている保証が無いため。
// **ファイルコピーだけで完結させる。**
//
// 置き場所が mipmap-* なのは `npx @capacitor/assets generate --android` が
// ic_launcher* という決まった名前にしか書き込まないため、ic_stat_notification が
// 上書きされる心配が無いから。
const NOTIF_ICON_NAME = "ic_stat_notification";
const NOTIF_ICON_SRC = path.join(ROOT, "assets/notification-icon");
const NOTIF_DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];

const missingIcons = NOTIF_DENSITIES.filter(
  (d) => !fs.existsSync(path.join(NOTIF_ICON_SRC, `${NOTIF_ICON_NAME}-${d}.png`)),
);
if (missingIcons.length) {
  console.error(
    `[patch-android] 通知アイコンが足りません: ${missingIcons.join(", ")}\n` +
      `  ${path.relative(ROOT, NOTIF_ICON_SRC)}/${NOTIF_ICON_NAME}-<density>.png を用意してください。\n` +
      `  無いまま進めると、Android の通知アイコンが白い塊になります。`,
  );
  process.exit(1);
}
for (const d of NOTIF_DENSITIES) {
  const destDir = path.join(APP, "src/main/res", `mipmap-${d}`);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(
    path.join(NOTIF_ICON_SRC, `${NOTIF_ICON_NAME}-${d}.png`),
    path.join(destDir, `${NOTIF_ICON_NAME}.png`),
  );
}
log(`copied notification icons (${NOTIF_DENSITIES.length} densities)`);

patchFile(path.join(APP, "src/main/AndroidManifest.xml"), (src) => {
  if (src.includes("com.google.firebase.messaging.default_notification_icon")) return src;
  // meta-data は **<application> の中**に置く必要がある（外に置くと効かない）。
  // インデントだけを捕まえる（`\s*` だと改行まで拾って空行が入る）。
  return src.replace(
    /^([ \t]*)<\/application>/m,
    (_m, indent) =>
      `${indent}    <meta-data\n` +
      `${indent}        android:name="com.google.firebase.messaging.default_notification_icon"\n` +
      `${indent}        android:resource="@mipmap/${NOTIF_ICON_NAME}" />\n` +
      `${indent}</application>`,
  );
});

// 4) Copy google-services.json
const gsSrc =
  process.env.GOOGLE_SERVICES_JSON ||
  "C:\\dev\\gymboard-keys\\google-services.json";
const gsDest = path.join(APP, "google-services.json");
if (!fs.existsSync(gsSrc)) {
  console.error(
    `[patch-android] google-services.json not found at: ${gsSrc}\n` +
      `Set GOOGLE_SERVICES_JSON env var or place the file at the default path.`
  );
  process.exit(1);
}
fs.copyFileSync(gsSrc, gsDest);
log(`copied google-services.json -> ${path.relative(ROOT, gsDest)}`);

// 5) Verify step 0 actually landed.
// Without this the mistake only surfaces ~10 minutes later as a Gradle failure,
// so fail loudly here instead.
const problems = [];
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

const vars = readIf(path.join(ANDROID, "variables.gradle"));
if (vars === null) {
  problems.push("android/variables.gradle が見つかりません");
} else {
  for (const key of ["minSdkVersion", "compileSdkVersion", "targetSdkVersion"]) {
    const want = CAP8.variables[key];
    const found = vars.match(new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(\\S+)`, "m"));
    if (!found) problems.push(`variables.gradle に ${key} がありません（期待値 ${want}）`);
    else if (found[1] !== want) {
      problems.push(`variables.gradle の ${key} が ${found[1]} のままです（期待値 ${want}）`);
    }
  }
}

const wrapper = readIf(path.join(ANDROID, "gradle/wrapper/gradle-wrapper.properties"));
if (wrapper === null) problems.push("gradle-wrapper.properties が見つかりません");
else if (!wrapper.includes(`gradle-${CAP8.gradle}-all.zip`)) {
  problems.push(`gradle-wrapper.properties が gradle-${CAP8.gradle}-all.zip になっていません`);
}

const rootGradle = readIf(path.join(ANDROID, "build.gradle"));
if (rootGradle === null) problems.push("android/build.gradle が見つかりません");
else if (!rootGradle.includes(`com.android.tools.build:gradle:${CAP8.agp}`)) {
  const cur = rootGradle.match(/com\.android\.tools\.build:gradle:([^'"]+)/);
  problems.push(
    `android/build.gradle の Android Gradle Plugin が ${cur ? cur[1] : "不明"} のままです` +
      `（期待値 ${CAP8.agp}）`,
  );
}

if (problems.length) {
  console.error(
    `\n[patch-android] 自動修正できなかった項目があります。手で直してください:\n` +
      problems.map((p) => `  - ${p}`).join("\n") +
      `\n`,
  );
  process.exit(1);
}

log(
  `Capacitor 8 baseline OK ` +
    `(AGP ${CAP8.agp} / Gradle ${CAP8.gradle} / compileSdk ${CAP8.variables.compileSdkVersion})`,
);
log("done.");
