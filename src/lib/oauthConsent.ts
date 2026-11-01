/**
 * AI 連携（OAuth）の同意画面で使う判定（2026-11-01・点検の拡大 oauth-consent-1）。
 *
 * 本番の OAuth サーバーは動的なクライアント登録が開いている（誰でも「ジムボード」という名前のアプリを登録できる）。
 * 偽の連携リンクを踏ませて「許可する」を押させると、そのアプリにあなたとして読み書きできるトークンが渡る。
 * 同意画面では、名前ではなく**戻り先のドメイン**を見せ、戻り先が https（または手元の PC）でなければ進まない。
 * 見張り: src/test/oauthConsent.test.ts
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** 連携のあとに戻ってよい先か（https、または手元の PC の http://localhost）。javascript: などは不可 */
export function isAllowedOAuthReturn(url: unknown): url is string {
  if (typeof url !== "string" || url === "") return false;
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return u.hostname !== "";
    return u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** 画面に出す連携先（戻り先のホスト名）。戻ってよい先でなければ null */
export function oauthReturnHost(url: unknown): string | null {
  return isAllowedOAuthReturn(url) ? new URL(url).host : null;
}

/** オーナー・インストラクター（ジムのお客様全員の情報に届く人）か */
export const isStaffRole = (role: string | null | undefined): boolean => role === "owner" || role === "trainer";
