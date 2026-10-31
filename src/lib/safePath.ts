// 通知のタップなどで「開く先」として受け取るパスの判定（2026-10-31・send-push-notification-2）。
// サーバー側の写しは supabase/functions/_shared/safeUrl.ts（同じ攻撃の形で両方を src/test/pushUrlSafety.test.ts が見張る）。
//
// ブラウザは URL を解釈するときにタブや改行を取り除き、http(s) ではバックスラッシュを "/" と同じに扱う。
// "/\evil.example" や "/<タブ>/evil.example" は「/ で始まり // で始まらない」を通るのに、開くと
// https://evil.example/ に解決される。"//evil.example"（プロトコル相対）も同じ。
const UNSAFE_URL_CHARS = /[\u0000- \u007f\\]/;

/** 自分のアプリの中のパス（"/" で始まり、解決しても origin が変わらない）か */
export function isSafeInAppPath(url: unknown, origin: string = window.location.origin): url is string {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return false;
  if (UNSAFE_URL_CHARS.test(url)) return false;
  try {
    return new URL(url, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
