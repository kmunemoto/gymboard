/**
 * analyze-meal: 写真のパスで service_role の Storage API を好きに叩けた（2026-10-31・点検 analyze-meal-1・critical）。
 *
 * 以前はリクエストの imageUrl をそのまま service_role の `storage.from("meal-photos").createSignedUrl(imageUrl)` に
 * 渡していた。storage-js は `${url}/object/sign/meal-photos/${path}` と文字列をつなぐだけで、fetch が URL を読むときに
 * 「..」が畳まれる。`../../../bucket/<バケット>/empty` で「バケットを空にする」API に届き、
 * ログインした誰でも、全部のジムの体の写真・姿勢の写真・チャットの添付・アイコン・ロゴを消せた（戻せない）。
 *
 * 🔴 壊しやすいもの:
 *   1. リクエストの imageUrl を使う → 行を見ても意味がない
 *   2. 行の image_url を確かめずに使う → 行の image_url も本人が書けるので、同じ攻撃が通る
 *   3. 「..」だけ見る → %2e%2e・バックスラッシュ・タブ入りが URL の解析で同じところへ化ける
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { isSafeOwnStoragePath } from "../../supabase/functions/_shared/storagePath";

const UID = "941a39ea-0000-4000-8000-000000000001";
const OTHER = "0758dd30-0000-4000-8000-000000000002";
/** storage-js 2.7.1 の createSignedUrl が組み立てる URL（Edge Function が実際に使う版） */
const signUrl = (path: string) => `https://example.supabase.co/storage/v1/object/sign/meal-photos/${path}`;

const code = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");

describe("isSafeOwnStoragePath: 本人のフォルダの中の普通のファイル名だけ", () => {
  it("アプリが作るパス（<user_id>/<時刻>-<名前>）は通す", () => {
    expect(isSafeOwnStoragePath(`${UID}/1793460000000-photo.jpg`, UID)).toBe(true);
    expect(isSafeOwnStoragePath(`${UID}/1793460000000-IMG 0001.jpg`, UID)).toBe(true);
    expect(isSafeOwnStoragePath(`${UID}/1793460000000-朝ごはん.jpg`, UID)).toBe(true);
  });

  const ATTACKS: Array<[string, string]> = [
    ["バケットを空にする（指摘の手口）", "../../../bucket/meal-photos/empty"],
    ["本人のフォルダから上がる", `${UID}/../../../../bucket/progress-photos/empty`],
    ["エンコードした ..", `${UID}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/bucket/posture-photos/empty`],
    ["バックスラッシュ", `${UID}/..\\..\\..\\..\\bucket/message-attachments/empty`],
    ["タブ入りの ..", `${UID}/.\t./.\t./.\t./.\t./bucket/avatars/empty`],
    ["service_role 専用の関数", `${UID}/../../../../../../functions/v1/diag-ios-push`],
    ["他のバケットの写真に署名させる", `../progress-photos/${OTHER}/1793460000000-front.jpg`],
    ["他人のフォルダ", `${OTHER}/1793460000000-photo.jpg`],
    ["先頭が /", `/${UID}/1793460000000-photo.jpg`],
    ["クエリ", `${UID}/x.jpg?download=1`],
    ["フラグメント", `${UID}/x.jpg#a`],
    ["空の段", `${UID}//x.jpg`],
    [". の段", `${UID}/./x.jpg`],
    ["フォルダだけ", `${UID}/`],
    ["空", ""],
    ["長すぎる", `${UID}/${"a".repeat(600)}.jpg`],
  ];

  for (const [label, path] of ATTACKS) {
    it(`🔴 拒む: ${label}`, () => {
      expect(isSafeOwnStoragePath(path, UID)).toBe(false);
    });
  }

  it("文字列以外・本人の ID が空なら拒む", () => {
    expect(isSafeOwnStoragePath(undefined, UID)).toBe(false);
    expect(isSafeOwnStoragePath(123, UID)).toBe(false);
    expect(isSafeOwnStoragePath(`${UID}/x.jpg`, "")).toBe(false);
  });

  it("（前提の確認）拒んだ手口は、URL の解析で本当に meal-photos の外へ出る", () => {
    // ここが通らないなら、ライブラリか URL の解析が変わった。判定の前提を見直すこと
    for (const path of [
      "../../../bucket/meal-photos/empty",
      `${UID}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/bucket/posture-photos/empty`,
      `${UID}/..\\..\\..\\..\\bucket/message-attachments/empty`,
      `${UID}/.\t./.\t./.\t./.\t./bucket/avatars/empty`,
    ]) {
      expect(new URL(signUrl(path)).pathname, path).toMatch(/^\/storage\/v1\/bucket\//);
    }
  });

  it("通したパスは、URL の解析でも本人のフォルダから出ない", () => {
    for (const path of [`${UID}/1793460000000-photo.jpg`, `${UID}/1793460000000-IMG 0001.jpg`, `${UID}/a/b/c.jpg`]) {
      expect(isSafeOwnStoragePath(path, UID)).toBe(true);
      expect(new URL(signUrl(path)).pathname.startsWith(`/storage/v1/object/sign/meal-photos/${UID}/`), path).toBe(true);
    }
  });
});

describe("analyze-meal: 写真は行から読み、確かめてから署名する", () => {
  const src = code("supabase/functions/analyze-meal/index.ts");

  it("🔴 リクエストの imageUrl を受け取らない", () => {
    expect(src).toMatch(/const \{ mealId, mealTypeHint, quantityNote \} = await req\.json\(\);/);
    expect(src).not.toMatch(/const \{[^}]*\bimageUrl\b[^}]*\} = await req\.json\(\)/);
  });

  it("写真の場所は食事の行（image_url）から読む", () => {
    expect(src).toContain('.from("meals").select("id, user_id, image_url").eq("id", mealId).maybeSingle();');
    expect(src).toContain('const imageUrl = typeof mealRow.image_url === "string" ? mealRow.image_url : "";');
  });

  it("🔴 署名の前に、本人のフォルダの普通のパスかを確かめる", () => {
    const checkAt = src.indexOf("if (!isSafeOwnStoragePath(imageUrl, userId)) {");
    const signAt = src.indexOf('.createSignedUrl(imageUrl, 600)');
    expect(checkAt).toBeGreaterThan(-1);
    expect(signAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(signAt);
    // 持ち主の確認（mealId の行が本人のもの）より後
    expect(src.indexOf("if (mealRow.user_id !== userId) {")).toBeLessThan(checkAt);
  });

  it("アプリは、行の image_url と同じ値を送っている（引数を無視しても動きは変わらない）", () => {
    const app = readFileSync("src/components/customer/CustomerMeals.tsx", "utf8");
    expect(app).toMatch(/\.insert\(withTenant\(\{ image_url: storagePath, user_id: user\?\.id \}/);
    expect(app).toMatch(/imageUrl: storagePath,/);
  });
});

describe("service_role で Storage を触る Edge Function は、確かめた所だけ", () => {
  it("🔴 Storage を触る関数が増えたら、パスの確かめ（isSafeOwnStoragePath）を通してから一覧に足す", () => {
    const dir = "supabase/functions";
    const users = readdirSync(dir)
      .filter((n) => n !== "_shared" && existsSync(`${dir}/${n}/index.ts`))
      .filter((n) => /\.storage\b/.test(code(`${dir}/${n}/index.ts`)))
      .sort();
    expect(users).toEqual(["analyze-meal"]);
  });
});
