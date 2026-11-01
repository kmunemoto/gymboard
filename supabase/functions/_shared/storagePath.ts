/**
 * Storage のパスを service_role で使う前の確かめ（2026-10-31・analyze-meal の点検）。
 *
 * 🔴 storage-js は `${url}/object/sign/${bucket}/${path}` のように**文字列をつなぐだけ**で、パスを正規化も
 *    エンコードもしない。fetch が URL を読むときに「..」の段が畳まれるので、
 *    `../../../bucket/<バケット>/empty` を渡すと、service_role で「バケットを空にする」API に届いた
 *    （全部のジムの体の写真・チャットの添付が消せた。消えたファイルは DB のバックアップに無く戻せない）。
 *    `%2e%2e`・バックスラッシュ・タブ入りも、URL の解析で同じところへ化ける。
 *
 * 通すのは「本人のフォルダ（`<user_id>/`）の中の、普通のファイル名」だけ:
 *   - `<user_id>/` で始まる
 *   - 段は `/` 区切りで、空の段・`.`・`..` が無い
 *   - `%`（エンコード）・`\`・`?`・`#`・制御文字が無い
 *   - 長すぎない
 *
 * 見張り: src/test/analyzeMealStoragePath.test.ts
 */

const MAX_PATH_LENGTH = 512;
// 制御文字（タブ・改行を含む。URL の解析で黙って消える）・DEL・バックスラッシュ・%・?・#
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\%?#]/;

export function isSafeOwnStoragePath(path: unknown, userId: string): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (!userId || !path.startsWith(`${userId}/`)) return false;
  if (UNSAFE_CHARS.test(path)) return false;
  return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}
