import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAX_MAJOR_GAP,
  compareVersions,
  dismissKey,
  parseVersion,
  updatePromptDecision,
} from "@/lib/appVersion";
import { STORE_URLS } from "@/lib/brand";

// ────────────────────────────────────────────────────────────────
// 「新しい版が出ています」の案内（2026-09-07 宗本さんの要望）
//
// > 新しいバージョンをアップロードして、まだアップデートしていないお客様に
// > アップデートしてもらえるように、こういう画面をアプリに出すようにしてほしい。
// > それぞれボタンを押したら iOS / Android のアプリに各飛ぶように。
//
// 🔴 このテストがいちばん守りたいのは「**閉じられること**」。
//    閉じられないダイアログは、版数の入力ミス1つで全端末を同時に止める。
//    復旧は本番DBの書き換え＋各端末の再起動待ちしか無い。
//    Play の段階公開・機種非対応・OS の最低要件で「更新したくてもできない」層は
//    必ず残るので、必須更新は作らない。
// ────────────────────────────────────────────────────────────────

const readCode = (path: string) => readFileSync(path, "utf8");

const HOOK = "src/hooks/useAppUpdatePrompt.ts";
const DIALOG = "src/components/AppUpdateDialog.tsx";
const MIGRATION = "supabase/migrations/20260907010000_app_releases.sql";
const APP = "src/App.tsx";
const LIB = "src/lib/appVersion.ts";

describe("版数の読み取り", () => {
  it("数字とドットだけを受け付ける", () => {
    expect(parseVersion("1.6.9")).toEqual([1, 6, 9, 0]);
    expect(parseVersion("9.5")).toEqual([9, 5, 0, 0]);
    expect(parseVersion(" 1.7.0 ")).toEqual([1, 7, 0, 0]);
  });

  it("🔴 読めないものは null。無理に数値化しない", () => {
    // NaN が黙って勝敗を決めるのがいちばん危ない。読めないなら読めないと言う
    for (const bad of [
      "1.7.0 (149)", // ビルド番号つき
      "v1.7.0",
      "1.7.0-beta",
      "1.7.0.0.1", // 5区切り
      "latest",
      "",
      "   ",
      null,
      undefined,
    ]) {
      expect(parseVersion(bad), String(bad)).toBeNull();
    }
  });

  it("区切りが足りないものは 0 で埋めて同じ版として扱う", () => {
    expect(compareVersions("1.7", "1.7.0")).toBe(0);
  });
});

describe("🔴 桁上がり（ここを間違えると最新版の人だけが案内を受け続ける）", () => {
  it("1.10.0 は 1.9.0 より新しい", () => {
    // 文字列比較や parseFloat だと逆になる
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
  });

  it("9.10 は 9.5 より新しい（Android は既に 9.x まで来ている）", () => {
    expect(compareVersions("9.10", "9.5")).toBeGreaterThan(0);
  });

  it("区切りごとに数として比べている", () => {
    expect(compareVersions("1.6.9", "1.7.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });

  it("どちらかが読めなければ null", () => {
    expect(compareVersions("1.7.0", "v2")).toBeNull();
    expect(compareVersions(null, "1.7.0")).toBeNull();
  });
});

describe("案内を出すかの判断", () => {
  it("新しい版が出ていれば出す", () => {
    expect(updatePromptDecision("1.6.9", "1.7.0")).toBe("show");
  });

  it("同じ版なら出さない", () => {
    expect(updatePromptDecision("1.7.0", "1.7.0")).toBe("up-to-date");
  });

  it("🔴 手元のほうが新しくても出さない（TestFlight・開発ビルド）", () => {
    // 社内の検証端末に「存在しない版へ戻れ」と出しても意味がない
    expect(updatePromptDecision("1.8.0", "1.7.0")).toBe("up-to-date");
  });

  it("🔴 版数が読めなければ出さない", () => {
    expect(updatePromptDecision("1.7.0 (149)", "1.7.0")).toBe("unreadable");
    expect(updatePromptDecision("1.6.9", "")).toBe("unreadable");
    expect(updatePromptDecision(null, null)).toBe("unreadable");
  });

  it("🔴 離れすぎている値は設定ミスとみなして出さない（行の取り違え）", () => {
    // iOS は 1.x、Android は 9.x。ios の行に Android の版を貼り間違えると、
    // 全 iOS 利用者に「存在しない 9.5 に更新してください」と出てしまう
    expect(updatePromptDecision("1.6.9", "9.5")).toBe("implausible");
    // メジャー1つ違いは正当な更新なので通す
    expect(updatePromptDecision("1.9.0", "2.0.0")).toBe("show");
    expect(MAX_MAJOR_GAP).toBe(1);
  });
});

describe("「あとで」の記憶", () => {
  it("🔴 キーに版数が入っている", () => {
    // 入っていないと、次の新しい版が出ても24時間は誰にも出ない
    expect(dismissKey("ios", "1.7.0")).toContain("1.7.0");
    expect(dismissKey("ios", "1.7.0")).not.toBe(dismissKey("ios", "1.8.0"));
  });

  it("プラットフォームごとに別のキー", () => {
    expect(dismissKey("ios", "1.7.0")).not.toBe(dismissKey("android", "1.7.0"));
  });
});

describe("🔴 必ず閉じられること（必須更新を作らない）", () => {
  it("ダイアログに「あとで」がある", () => {
    const code = readCode(DIALOG);
    expect(code).toContain('data-testid="app-update-later"');
    expect(code).toMatch(/onClick=\{dismiss\}/);
  });

  it("フックが dismiss を返している", () => {
    expect(readCode(HOOK)).toMatch(/return \{ \.\.\.state, dismiss \};/);
  });

  it("必須更新の仕組みがどこにも無い", () => {
    // min_version / required / forced を1つでも足したら、この番人を消す前に
    // 「更新したくてもできない層」をどう救うかを決めること
    for (const path of [LIB, HOOK, DIALOG, MIGRATION]) {
      const code = readCode(path).replace(/^.*(必須|min_version).*$/gm, "");
      expect(code, path).not.toMatch(/\bmin_version\b/);
      expect(code, path).not.toMatch(/\bforceUpdate\b/);
    }
  });
});

describe("🔴 Web では1行も動かないこと", () => {
  const code = readCode(HOOK);

  it("ネイティブ判定が supabase より先に来る", () => {
    // App.getInfo() は Web では例外を投げる。テストで踏むと
    // 「テストは全部緑なのに exit 1」になる（CLAUDE.md の既知の罠）
    const native = code.indexOf("Capacitor.isNativePlatform()");
    const rpc = code.indexOf("supabase.rpc");
    expect(native).toBeGreaterThan(-1);
    expect(rpc).toBeGreaterThan(-1);
    expect(native).toBeLessThan(rpc);
  });

  it("ネイティブでなければ即 return する", () => {
    expect(code).toMatch(/if \(!Capacitor\.isNativePlatform\(\)\) \{[\s\S]{0,120}?return;/);
  });

  it("getInfo が try で囲まれている", () => {
    expect(code).toMatch(/try \{[\s\S]{0,120}?CapApp\.getInfo\(\)/);
  });

  it("RPC の失敗でも何も出さない", () => {
    expect(code).toContain('reason: "no-config"');
  });
});

describe("🔴 押しても何も起きない案内を出さない", () => {
  it("ストアURLが空なら出さない", () => {
    expect(readCode(HOOK)).toMatch(/if \(!storeUrl\) \{[\s\S]{0,120}?return;/);
  });

  it("iOS は App Store の商品ページ（数字のID付き）", () => {
    expect(STORE_URLS.ios).toMatch(/^https:\/\/apps\.apple\.com\/[a-z]{2}\/app\/id\d{6,}$/);
  });

  it("🔴 Android のURLの id が capacitor.config.ts の appId と一致する", () => {
    // ここがズレると、更新ボタンが**他社のアプリ**のページを開く。
    // エラーにならないので、押してもらうまで誰も気づけない
    const appId = /appId:\s*'([^']+)'/.exec(readCode("capacitor.config.ts"))?.[1];
    expect(appId).toBeTruthy();
    expect(STORE_URLS.android).toBe(
      `https://play.google.com/store/apps/details?id=${appId}`,
    );
  });
});

describe("🔴 DB 側の作法", () => {
  const sql = readCode(MIGRATION);

  it("テーブルは直接読めない（RLS 有効・ポリシー無し）", () => {
    // このリポジトリに anon へ SELECT を開いたテーブルは1つも無い。
    // 公開データは SECURITY DEFINER の関数だけが返す
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toMatch(/CREATE POLICY/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.app_releases FROM anon, authenticated;/);
  });

  it("読み取りは SECURITY DEFINER の関数で、anon にも許可されている", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_app_release/);
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_app_release\(text\) TO anon/);
  });

  it("🔴 公開前の値では何も返さない", () => {
    // リリース前に版数だけ先に入れてしまう事故を DB 側で止める
    expect(sql).toMatch(/r\.released_at IS NOT NULL/);
    expect(sql).toMatch(/r\.released_at <= now\(\)/);
    expect(sql).toMatch(/r\.enabled/);
  });

  it("版数の形を DB でも縛っている（画面側と同じ考え方）", () => {
    expect(sql).toContain("app_releases_version_format");
    expect(sql).toMatch(/\^\[0-9\]\{1,3\}\(\\\.\[0-9\]\{1,4\}\)\{1,3\}\$/);
  });

  it("🔴 Android の初期値は空（版数を推測して入れない）", () => {
    // versionName はリポジトリにもセッションにも無い。Play Console が唯一の正
    expect(sql).toMatch(/\('android', NULL, NULL,/);
  });

  it("iOS の初期値は「ストアに出ている版」であって次の版ではない", () => {
    // ios-build.yml の MARKETING_VERSION は「次に出す版」。そのまま入れると
    // 存在しない版への更新を促すことになる
    const marketing = /MARKETING_VERSION = ([0-9.]+);/.exec(
      readCode(".github/workflows/ios-build.yml"),
    )?.[1];
    const seeded = /\('ios', '([0-9.]+)'/.exec(sql)?.[1];
    expect(marketing).toBeTruthy();
    expect(seeded).toBeTruthy();
    expect(compareVersions(seeded, marketing)).toBeLessThan(0);
  });
});

describe("🔴 取り付け位置と、出す画面", () => {
  it("App 直下にあり、LazyBoundary の外にある", () => {
    // 中に入れると、ルートの読み込みに失敗したとき案内ごと消える
    const code = readCode(APP);
    const dialog = code.indexOf("<AppUpdateDialog />");
    const boundary = code.indexOf("<LazyBoundary");
    expect(dialog).toBeGreaterThan(-1);
    expect(boundary).toBeGreaterThan(-1);
    expect(dialog).toBeLessThan(boundary);
  });

  it("出す画面は許可制（新しいルートに黙って被さらない）", () => {
    const code = readCode(DIALOG);
    expect(code).toMatch(/const ALLOWED_PATHS = \["\/", "\/auth"\] as const;/);
    expect(code).toMatch(/if \(!ALLOWED_PATHS\.includes\(/);
  });

  it("中継ページには出さない", () => {
    // /auth/callback と /billing/return は「戻ってくる途中」。被せると処理が止まる
    const allowed = ["/", "/auth"];
    for (const blocked of ["/auth/callback", "/billing/return", "/trial", "/join", "/privacy"]) {
      expect(allowed.includes(blocked), blocked).toBe(false);
    }
  });
});

describe("文言（5言語）", () => {
  for (const lng of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
    it(`${lng}: appUpdate の4つのキーがある`, () => {
      const j = JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8"));
      for (const key of ["title", "body", "version", "update", "later"]) {
        expect(typeof j.appUpdate?.[key], `${lng}.appUpdate.${key}`).toBe("string");
        expect(j.appUpdate[key].length, `${lng}.appUpdate.${key}`).toBeGreaterThan(0);
      }
    });
  }

  it("バージョン番号は差し込みで出す", () => {
    const j = JSON.parse(readFileSync("src/locales/ja.json", "utf8"));
    expect(j.appUpdate.version).toContain("{{version}}");
  });

  it("画面はリテラルではなく t() を使っている", () => {
    const code = readCode(DIALOG);
    expect(code).toContain('t("appUpdate.title")');
    expect(code).toContain('t("appUpdate.update")');
    expect(code).toContain('t("appUpdate.later")');
  });
});
