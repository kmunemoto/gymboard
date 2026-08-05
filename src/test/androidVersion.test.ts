import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// **Android の版数をリポジトリ管理下に置く。**
//
// ── なぜ ─────────────────────────────────────────────────────
// `android/` は .gitignore 済みで、Android のリリースは Windows + Android Studio の手作業。
// つまり versionCode / versionName は**リポジトリのどこからも読めない**値だった。
//
//   - 「バージョンを1つ上げて」と言われても上げようがない
//     （Play Console か Windows の build.gradle を見るまで現在値が分からない。実際に困った）
//   - `npx cap add android` で作り直すと Capacitor 既定値（versionCode 1 / "1.0"）に戻る
//   - 上げ忘れも上げたつもりも、Play にアップロードするまで気づけない
//
// `android-version.json` を唯一の記録にし、`scripts/set-android-version.mjs` が
// build.gradle へ書き込む。**このテストは実際にスクリプトを走らせて確かめる。**

const SCRIPT = join(process.cwd(), "scripts/set-android-version.mjs");
const VERSION_FILE = "android-version.json";

/** Capacitor テンプレートの build.gradle（最小） */
const TEMPLATE_GRADLE = `apply plugin: 'com.android.application'

android {
    namespace "app.gymboard.mobile"
    compileSdkVersion rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "app.gymboard.mobile"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
    }
}
`;

let dir: string;

function scaffold(conf: unknown, gradle: string = TEMPLATE_GRADLE) {
  mkdirSync(join(dir, "android/app"), { recursive: true });
  writeFileSync(join(dir, "android/app/build.gradle"), gradle);
  if (conf !== undefined) {
    writeFileSync(
      join(dir, VERSION_FILE),
      typeof conf === "string" ? conf : JSON.stringify(conf, null, 2),
    );
  }
}

/**
 * スクリプトを実行する。**成功時も stderr を返すこと。**
 * `execFileSync` は成功すると stdout しか返さないので、`console.warn` で出す
 * 「versionCode を下げている」警告を検査できない（実際に空振りした）。
 */
function run(): { code: number; output: string } {
  const r = spawnSync("node", [SCRIPT], { cwd: dir, encoding: "utf8" });
  return { code: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const gradle = () => readFileSync(join(dir, "android/app/build.gradle"), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "android-version-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("android-version.json（リポジトリの記録）", () => {
  const conf = JSON.parse(readFileSync(VERSION_FILE, "utf8"));

  it("versionCode が1以上の整数", () => {
    expect(Number.isInteger(conf.versionCode)).toBe(true);
    expect(conf.versionCode).toBeGreaterThan(0);
  });

  it("versionName が数字とドットだけ", () => {
    expect(conf.versionName).toMatch(/^\d+(\.\d+)*$/);
  });

  it("手作業の採番が CI の下駄（10000）とぶつからない", () => {
    // CI 側は ANDROID_VERSION_CODE_BASE(10000) + run_number。
    // 手作業側がここに達すると、将来 CI へ移行したとき versionCode が逆行しうる。
    const yml = readFileSync(".github/workflows/android-build.yml", "utf8");
    const base = Number(/ANDROID_VERSION_CODE_BASE:\s*"(\d+)"/.exec(yml)?.[1]);
    expect(base, "android-build.yml から BASE を読めません").toBeGreaterThan(0);
    expect(
      conf.versionCode,
      `手作業の versionCode (${conf.versionCode}) が CI の下駄 (${base}) に達しています`,
    ).toBeLessThan(base);
  });
});

describe("set-android-version.mjs", () => {
  it("テンプレート既定値を android-version.json の値で置き換える", () => {
    scaffold({ versionCode: 82, versionName: "9.1" });
    expect(run().code).toBe(0);
    expect(gradle()).toMatch(/versionCode 82/);
    expect(gradle()).toMatch(/versionName "9\.1"/);
    // 既定値が残っていないこと（片方だけ置換される事故を防ぐ）
    expect(gradle()).not.toMatch(/versionCode 1\b/);
    expect(gradle()).not.toMatch(/versionName "1\.0"/);
  });

  it("2回流しても結果が変わらない（冪等）", () => {
    // 「前後比較で置換を判定」すると、2回目に "見つからなかった" と誤判定する。
    scaffold({ versionCode: 82, versionName: "9.1" });
    expect(run().code).toBe(0);
    const first = gradle();
    expect(run().code, "2回目が失敗した").toBe(0);
    expect(gradle()).toBe(first);
  });

  it("他の設定を壊さない", () => {
    scaffold({ versionCode: 82, versionName: "9.1" });
    run();
    expect(gradle()).toMatch(/applicationId "app\.gymboard\.mobile"/);
    expect(gradle()).toMatch(/minSdkVersion rootProject\.ext\.minSdkVersion/);
  });

  it("android/ が無ければ止まる", () => {
    // `npx cap sync android` の前に叩いたケース。
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, VERSION_FILE), JSON.stringify({ versionCode: 82, versionName: "9.1" }));
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toMatch(/build\.gradle/);
  });

  it("android-version.json が無ければ止まる", () => {
    scaffold(undefined);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toMatch(/android-version\.json/);
  });

  it("JSON が壊れていれば止まる", () => {
    scaffold("{ versionCode: 82,,, }");
    expect(run().code).toBe(1);
  });

  it("versionCode が整数でなければ止まる", () => {
    // "82" のような文字列や 8.2 を黙って通すと、Gradle 側で変な値になる。
    for (const bad of ["82", 8.2, 0, -1, null]) {
      scaffold({ versionCode: bad, versionName: "9.1" });
      const { code, output } = run();
      expect(code, `versionCode=${JSON.stringify(bad)} が通ってしまいました`).toBe(1);
      expect(output).toMatch(/versionCode/);
    }
  });

  it("versionName の形式が違えば止まる", () => {
    for (const bad of ["9.1-beta", "v9.1", 91, ""]) {
      scaffold({ versionCode: 82, versionName: bad });
      const { code } = run();
      expect(code, `versionName=${JSON.stringify(bad)} が通ってしまいました`).toBe(1);
    }
  });

  it("Play の上限を超える versionCode を弾く", () => {
    // 超えると Play に弾かれるうえ、versionCode は二度と下げられない。
    scaffold({ versionCode: 2100000001, versionName: "9.1" });
    expect(run().code).toBe(1);
  });

  it("既存より下げるときは警告する（が書き込みは行う）", () => {
    // `cap add android` 直後は既定値 1 なので、下げ判定で止めてはいけない。
    // 一方、既に大きい値が入っているなら Play に弾かれるので知らせる。
    scaffold(
      { versionCode: 82, versionName: "9.1" },
      TEMPLATE_GRADLE.replace("versionCode 1", "versionCode 90"),
    );
    const { code, output } = run();
    expect(code, "警告で止めてはいけない").toBe(0);
    expect(output).toMatch(/90/);
    expect(gradle()).toMatch(/versionCode 82/);
  });
});

describe("build-android.bat が版数を適用する", () => {
  const bat = readFileSync("scripts/build-android.bat", "utf8");

  it("set-android-version.mjs を呼ぶ", () => {
    // .bat は CI でも vitest でも実行されない。**Windows で人が叩くまで誰も気づけない。**
    expect(bat, "build-android.bat が set-android-version.mjs を呼んでいません").toMatch(
      /node scripts\/set-android-version\.mjs/,
    );
  });

  it("失敗したら止まる", () => {
    const line = bat.split("\n").find((l) => l.includes("set-android-version.mjs")) ?? "";
    expect(line, "エラーで先に進んでしまいます").toMatch(/goto :err/);
  });

  it("patch-android より後に呼ぶ", () => {
    // patch より前だと `cap sync` 後の build.gradle が上書きされる順序になりうる。
    expect(bat.indexOf("set-android-version.mjs")).toBeGreaterThan(
      bat.indexOf("patch-android.mjs"),
    );
  });

  it("『手で build.gradle を書き換えろ』という案内が残っていない", () => {
    // 案内が残っていると、リポジトリの記録と実際の値が二重管理になる。
    expect(bat).not.toMatch(/Bump versionCode/);
  });
});
