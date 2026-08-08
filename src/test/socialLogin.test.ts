import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ソーシャルログイン（Apple / Google）の検査（2026-08-08）。
//
// ── 前提 ─────────────────────────────────────────────────────
// 画面・OAuth・コールバックの実装は**もとから入っていた**。
// 足りていなかったのは Supabase 側のプロバイダー設定と、
// 「プロバイダーが入れてくる表示名を拾えていない」ことの2つ。
// ここで見張るのは後者（コード側）。
//
// ── 🔴 いちばん守りたいこと ───────────────────────────────────
//   1. ロールを OAuth のメタデータから読まない（必ず 'customer' 固定）
//   2. Apple の @privaterelay.appleid.com を表示名にしない
//   3. リダイレクト先をハードコードしない（フォークが上流へ飛ばされる）
//
// ── 変異テスト（2026-08-08 実施・7件とも赤を確認）─────────────
//   1. COALESCE から full_name を落とす                       → 赤
//   2. privaterelay の除外を消す                              → 赤
//   3. display_name より full_name を先に見る                 → 赤
//   4. handle_new_user_role が metadata の role を読むようにする → 赤
//   5. ON CONFLICT DO NOTHING を消す                          → 赤
//   6. oauth.ts のリダイレクト先を直書きURLにする              → 赤
//   7. ネイティブで skipBrowserRedirect を外す                → 赤

const MIGRATION = "supabase/migrations/20260808020000_oauth_display_name.sql";
const OAUTH = "src/lib/oauth.ts";
const BUTTONS = "src/components/SocialAuthButtons.tsx";
const CALLBACK = "src/pages/AuthCallback.tsx";
const AUTH_PAGE = "src/pages/Auth.tsx";

const read = (p: string) => readFileSync(p, "utf8");

/** SQLコメントを落とす。経緯コメントの中の識別子を「実装」と誤認しないため。 */
const sqlBody = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "");

describe("新規ユーザーの表示名の解決", () => {
  const sql = sqlBody(MIGRATION);

  it("handle_new_user を差し替えている", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)/);
  });

  it("プロバイダーが入れてくる氏名のキーを見ている", () => {
    // Google は full_name / name、Apple は full_name（初回のみ）。
    // display_name しか見ていないと、ソーシャル登録は必ずメールに落ちる。
    expect(sql, "full_name を見ていません（Google/Apple の氏名が拾えない）").toContain("'full_name'");
    expect(sql, "name を見ていません（Google の氏名が拾えない）").toMatch(/->>\s*'name'/);
  });

  it("🔴 自前フォームの display_name を最優先にしている", () => {
    // ここが逆転すると、フォームで名乗った名前をプロバイダー側の氏名が上書きする。
    const iDisplay = sql.indexOf("'display_name'");
    const iFull = sql.indexOf("'full_name'");
    const iName = sql.search(/->>\s*'name'/);
    expect(iDisplay).toBeGreaterThan(-1);
    expect(iDisplay, "display_name が full_name より後に評価されています").toBeLessThan(iFull);
    expect(iFull, "full_name が name より後に評価されています").toBeLessThan(iName);
  });

  it("🔴 Apple の転送用アドレスを表示名にしない", () => {
    // abc123@privaterelay.appleid.com がそのまま顧客一覧に並ぶのを防ぐ。
    // 「名前が入っている」ように見えて未設定チェックをすり抜けるのが厄介。
    expect(
      sql,
      "privaterelay.appleid.com の除外がありません",
    ).toMatch(/privaterelay\.appleid\.com/);
    // 大文字混じりのアドレスでも弾けること
    expect(sql, "メールの比較が小文字化されていません").toMatch(/lower\(\s*NEW\.email\s*\)/i);
  });

  it("名前が無いときは NULL のままにする（別の文字列で埋めない）", () => {
    // NULL は UI が想定済みの状態（common.nameUnset にフォールバックし、
    // TrainerClientList の isUnnamed が拾って一覧で目立たせる）。
    // ここで "ゲスト" のような固定文字列を入れると、その導線が死ぬ。
    expect(
      sql,
      "表示名に固定文字列のフォールバックが入っています",
    ).not.toMatch(/resolved\s*:=\s*'[^']+'/);
  });

  it("既存プロフィールを壊さない", () => {
    expect(sql).toMatch(/ON CONFLICT \(user_id\) DO NOTHING/);
  });

  it("SECURITY DEFINER と search_path を保っている", () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
  });

  it("🔴 ロール付与のトリガーには触っていない", () => {
    // handle_new_user_role は metadata に関係なく 'customer' 固定。
    // OAuth のメタデータは攻撃者が細工しうるので、ここから role を読んではいけない。
    expect(
      sql,
      "このマイグレーションが handle_new_user_role を書き換えています",
    ).not.toMatch(/FUNCTION public\.handle_new_user_role/);
  });
});

describe("ロールは OAuth のメタデータから読まない", () => {
  it("どのマイグレーションも metadata から role を組み立てていない", () => {
    // 「Google が渡してくる role を読めば楽」に将来倒れないための歯止め。
    const sql = sqlBody(MIGRATION);
    expect(sql).not.toMatch(/raw_user_meta_data\s*->>\s*'role'/);
    expect(sql).not.toMatch(/raw_app_meta_data\s*->>\s*'role'/);
  });

  it("トレーナー昇格はサーバー側の関数を通している", () => {
    // クライアントが user_roles を直接 insert する形にしないこと。
    const src = read(CALLBACK);
    expect(src).toMatch(/functions\.invoke\("signup-trainer"/);
    expect(src, "AuthCallback が user_roles を直接触っています").not.toMatch(/from\("user_roles"\)/);
  });
});

describe("OAuth の開始", () => {
  const src = read(OAUTH);

  it("Apple と Google の両方を扱える", () => {
    expect(src).toMatch(/OAuthProvider\s*=\s*"apple"\s*\|\s*"google"/);
  });

  it("🔴 リダイレクト先を直書きしていない", () => {
    // 直書きすると、フォーク（兄弟アプリ）のログインが上流へ飛ぶ。
    expect(src).toContain("getAuthCallbackUrl()");
    expect(src, "oauth.ts に URL が直書きされています").not.toMatch(/https?:\/\//);
  });

  it("ネイティブはシステムブラウザで開く", () => {
    // Google は埋め込み WebView での OAuth を弾く（disallowed_useragent）。
    // @capacitor/browser は SFSafariViewController / Chrome Custom Tabs なので通る。
    // skipBrowserRedirect を外すと WebView 内で遷移してしまう。
    expect(src).toMatch(/skipBrowserRedirect:\s*true/);
    expect(src).toMatch(/Browser\.open\(/);
  });
});

describe("🔴 profiles の行はトリガーが作ってくれない", () => {
  // 2026-08-08 の実測: 本番の auth.users に**ユーザートリガーが0件**。
  // リポジトリの 20260507051932 が作るはずの on_auth_user_created_profile が無い。
  // （権限で見えないのではない。内部トリガー30件・DB全体のユーザートリガー36件は見えている）
  //
  // つまり **profiles の行は誰も自動では作らない。**
  // 「行はもう在るはず」と思って `update` を書くと、
  // **エラーも出さずに0行更新で成功する**ので気づけない。
  //
  // 実際に Onboarding.tsx がこれを踏み、開設したオーナー14人ぶんの profiles が
  // 丸ごと欠けて、ジム側ホームの挨拶が既定文言のままになっていた
  // （2026-08-08 に tenant_members.display_name から16件バックフィル済み）。

  const NEW_ROW_PATHS = [
    ["src/pages/Onboarding.tsx", "ジム開設（オーナー）"],
    ["src/pages/JoinGym.tsx", "招待コードでの参加（お客様）"],
  ] as const;

  for (const [path, label] of NEW_ROW_PATHS) {
    it(`${label} は profiles を upsert している`, () => {
      const src = read(path);
      const i = src.indexOf('.from("profiles")');
      expect(i, `${path} に profiles への書き込みがありません`).toBeGreaterThan(-1);
      const stmt = src.slice(i, i + 400);
      expect(
        stmt,
        `${path} が profiles を update しています。行が無いと**黙って0行更新で成功**します。` +
          `本番に auth.users のトリガーは無いので、行が既に在る保証はありません`,
      ).not.toMatch(/\.from\("profiles"\)\s*\n?\s*\.update\(/);
      expect(stmt).toMatch(/\.upsert\(/);
    });
  }

  it("upsert の衝突キーが user_id になっている", () => {
    // onConflict を間違えると重複行か 23505 になる。
    for (const [path] of NEW_ROW_PATHS) {
      const src = read(path);
      const i = src.indexOf('.from("profiles")');
      expect(src.slice(i, i + 400), `${path}`).toMatch(/onConflict:\s*"user_id"/);
    }
  });
});

describe("画面まわり", () => {
  it("ボタンは Apple と Google の2つ", () => {
    const src = read(BUTTONS);
    expect(src).toMatch(/handleSignIn\("apple"\)/);
    expect(src).toMatch(/handleSignIn\("google"\)/);
  });

  it("ログイン画面はフラグで出し分けている", () => {
    // プロバイダー未設定のまま出すと、押した瞬間 Supabase の生のエラー画面に飛ぶ。
    const src = read(AUTH_PAGE);
    expect(src).toContain("SOCIAL_LOGIN_ENABLED");
  });

  it("文言が5言語そろっている", () => {
    const missing: string[] = [];
    for (const loc of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const d = JSON.parse(read(`src/locales/${loc}.json`));
      for (const k of ["socialDivider", "socialApple", "socialGoogle", "socialError"]) {
        if (!d.auth?.[k]) missing.push(`${loc}: auth.${k}`);
      }
    }
    expect(missing, "翻訳の取りこぼし:\n  " + missing.join("\n  ")).toEqual([]);
  });
});
