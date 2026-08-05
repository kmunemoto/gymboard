/**
 * Web Push（VAPID）の公開鍵まわりの純粋ロジック。
 *
 * フックから切り出しているのは、**ここだけは本物のユニットテストを書けるようにする**ため。
 * 判定を間違えると「既存の購読を全部解除する」か「壊れた購読を放置する」のどちらかになり、
 * どちらも**画面には何も出ない**。ソースの正規表現検査では守れない種類の場所。
 */

/** VAPID 公開鍵（P-256 の非圧縮点）のバイト長 */
const VAPID_PUBLIC_KEY_BYTES = 65;
/** 非圧縮点の先頭バイト */
const UNCOMPRESSED_POINT_TAG = 0x04;

/**
 * base64url 文字列を `Uint8Array` にする。
 * `pushManager.subscribe()` の `applicationServerKey` はバイト列で渡す必要がある。
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** VAPID 公開鍵として形が正しいか（65バイト・先頭 0x04） */
export function isWellFormedVapidPublicKey(base64String: string): boolean {
  try {
    const bytes = urlBase64ToUint8Array(base64String);
    return bytes.length === VAPID_PUBLIC_KEY_BYTES && bytes[0] === UNCOMPRESSED_POINT_TAG;
  } catch {
    return false;
  }
}

/**
 * ブラウザが持っている購読が、**いま使っている公開鍵**で作られたものか。
 *
 * ⚠️ **判定できないときは `true`（＝作り直さない）を返す。**
 *
 * `PushSubscriptionOptions.applicationServerKey` を返さないブラウザがある。
 * そこで「取れない＝不一致」と扱うと、**正常に動いている購読を毎回作り直す**ことになり、
 * 端末によっては通知が止まる。**分からないときは触らない**のが唯一安全な既定。
 *
 * （`nativeAppIdentity` / `pushConfigGuards` で2度やらかした「検査できない構成を
 *   不合格にする」誤検出と同じ形。ここでも同じ判断をする。）
 */
export function isSameVapidKey(
  raw: ArrayBuffer | ArrayBufferView | null | undefined,
  publicKeyBase64Url: string,
): boolean {
  if (raw == null) return true; // 取得できない環境 → 触らない

  const actual =
    raw instanceof ArrayBuffer
      ? new Uint8Array(raw)
      : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);

  if (actual.length === 0) return true; // 空 → 判定材料が無い → 触らない

  let expected: Uint8Array;
  try {
    expected = urlBase64ToUint8Array(publicKeyBase64Url);
  } catch {
    return true; // 期待値が読めない → 触らない（購読を壊す方向に倒さない）
  }

  if (actual.length !== expected.length) return false;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) return false;
  }
  return true;
}
