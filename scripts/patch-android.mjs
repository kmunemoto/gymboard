#!/usr/bin/env node
/**
 * Patches the Capacitor-generated android/ directory for Firebase Cloud Messaging.
 * Run AFTER `npx cap sync android`. Idempotent — safe to re-run.
 *
 * Steps:
 *  1. Add Google Services classpath to android/build.gradle
 *  2. Apply com.google.gms.google-services plugin in android/app/build.gradle
 *     and ensure firebase-messaging dependency is present
 *  3. Ensure POST_NOTIFICATIONS permission in AndroidManifest.xml
 *  4. Copy google-services.json from GOOGLE_SERVICES_JSON env (or default Windows path)
 *     into android/app/google-services.json
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ANDROID = path.join(ROOT, "android");
const APP = path.join(ANDROID, "app");

if (!fs.existsSync(ANDROID)) {
  console.error("[patch-android] android/ not found. Run `npx cap sync android` first.");
  process.exit(1);
}

const log = (m) => console.log(`[patch-android] ${m}`);

function patchFile(file, patcher) {
  const src = fs.readFileSync(file, "utf8");
  const out = patcher(src);
  if (out !== src) {
    fs.writeFileSync(file, out);
    log(`patched ${path.relative(ROOT, file)}`);
  } else {
    log(`already up-to-date: ${path.relative(ROOT, file)}`);
  }
}

// 1) Project-level build.gradle: add Google Services classpath
patchFile(path.join(ANDROID, "build.gradle"), (src) => {
  if (src.includes("com.google.gms:google-services")) return src;
  return src.replace(
    /(dependencies\s*\{)([\s\S]*?)(classpath\s+['"]com\.android\.tools\.build:gradle[^'"]+['"])/,
    `$1$2$3\n        classpath 'com.google.gms:google-services:4.4.2'`
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

log("done.");
