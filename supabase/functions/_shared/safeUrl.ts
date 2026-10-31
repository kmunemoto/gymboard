// 通知などで「開く先」として受け取る URL の判定（2026-10-31・send-push-notification-2）。
// Deno（Edge Function）からも vitest からも import できるよう、import を持たない純粋な関数だけを置く。
// 画面側の写しは src/lib/safePath.ts（同じ攻撃の形で両方を src/test/pushUrlSafety.test.ts が見張る）。

/**
 * 空白・制御文字・バックスラッシュ。ブラウザは URL を解釈するときにタブや改行を取り除き、
 * http(s) ではバックスラッシュを "/" と同じに扱うので、"/\evil.example" や "/<タブ>/evil.example" は
 * 「/ で始まり // で始まらない」を通るのに、開くと https://evil.example/ に解決される。
 */
const UNSAFE_URL_CHARS = /[\u0000- \u007f\\]/;

/** 自分のアプリの中のパス（"/" で始まり、解決しても origin が変わらない）か */
export function isSafeInAppPath(url: unknown, origin: string): url is string {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return false;
  if (UNSAFE_URL_CHARS.test(url)) return false;
  try {
    return new URL(url, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * プッシュの url として送ってよいか。空なら既定（"/"）を使うので可。
 * 自分のアプリの中のパスか、許した https のホストだけ。
 */
export function isAllowedPushUrl(u: unknown, appOrigin: string, allowedHosts: ReadonlySet<string>): boolean {
  if (u === undefined || u === null || u === "") return true;
  if (typeof u !== "string") return false;
  if (UNSAFE_URL_CHARS.test(u)) return false;
  if (u.startsWith("/")) return isSafeInAppPath(u, appOrigin);
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" && allowedHosts.has(parsed.host);
  } catch {
    return false;
  }
}
