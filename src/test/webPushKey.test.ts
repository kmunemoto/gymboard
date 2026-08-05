import { describe, it, expect } from "vitest";
import {
  isSameVapidKey,
  isWellFormedVapidPublicKey,
  urlBase64ToUint8Array,
} from "@/lib/webPushKey";
import { VAPID_PUBLIC_KEY } from "@/lib/brand";

// この判定を間違えると、どちらに転んでも**画面には何も出ない**:
//   - 誤って「不一致」と判定 → 正常な購読を毎回作り直す
//   - 誤って「一致」と判定   → 届かない購読を放置する
// ソースの正規表現検査では守れないので、本物のユニットテストを置く。

/** 別の鍵ペアの公開鍵（形は正しいが中身が違う） */
const OTHER_KEY =
  "BM3Qk9vJ0hZ8pLxYqN2sT7wR4uV6aX1cD5eF8gH0iJ3kL6mN9oP2qR5sT8uV1wX4yZ7aB0cD3eF6gH9iJ2kL5m";

describe("urlBase64ToUint8Array", () => {
  it("VAPID 公開鍵を 65 バイトに戻す", () => {
    // P-256 の非圧縮点は 1 + 32 + 32 = 65 バイト。
    const bytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04); // 非圧縮点のタグ
  });

  it("base64url の - と _ を戻す", () => {
    // "-" → "+", "_" → "/" の置換を落とすと別のバイト列になる。
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([0xfb, 0xff]);
  });

  it("パディングが無くても復元できる", () => {
    // VAPID 公開鍵は 87 文字でパディングが付かない。ここを落とすと atob が投げる。
    expect(() => urlBase64ToUint8Array(VAPID_PUBLIC_KEY)).not.toThrow();
  });
});

describe("isWellFormedVapidPublicKey", () => {
  it("本物の鍵を通す", () => {
    expect(isWellFormedVapidPublicKey(VAPID_PUBLIC_KEY)).toBe(true);
  });

  it("長さが違う鍵を弾く", () => {
    expect(isWellFormedVapidPublicKey("BKxLbT912uBVUI")).toBe(false);
  });

  it("base64 として壊れていても投げずに false を返す", () => {
    expect(isWellFormedVapidPublicKey("!!!not-base64!!!")).toBe(false);
  });
});

describe("isSameVapidKey", () => {
  const current = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

  it("同じ鍵なら true", () => {
    // ArrayBuffer を渡す（ブラウザが返す形）
    const buf = current.buffer.slice(0) as ArrayBuffer;
    expect(isSameVapidKey(buf, VAPID_PUBLIC_KEY)).toBe(true);
  });

  it("違う鍵なら false", () => {
    const other = urlBase64ToUint8Array(OTHER_KEY);
    expect(isSameVapidKey(other.buffer.slice(0) as ArrayBuffer, VAPID_PUBLIC_KEY)).toBe(false);
  });

  it("1バイトでも違えば false", () => {
    // 全体の長さが同じでも見逃さないこと（先頭だけ比べる実装を防ぐ）。
    const tampered = new Uint8Array(current);
    tampered[tampered.length - 1] ^= 0xff;
    expect(isSameVapidKey(tampered.buffer.slice(0) as ArrayBuffer, VAPID_PUBLIC_KEY)).toBe(false);
  });

  it("長さが違えば false", () => {
    const truncated = current.slice(0, 32);
    expect(isSameVapidKey(truncated.buffer.slice(0) as ArrayBuffer, VAPID_PUBLIC_KEY)).toBe(false);
  });

  it("Uint8Array（ビュー）で渡しても正しく比べる", () => {
    // ArrayBuffer だけを想定して new Uint8Array(view) と書くと、
    // ビューの中身ではなく長さを解釈してゼロ埋めになる。
    expect(isSameVapidKey(current, VAPID_PUBLIC_KEY)).toBe(true);
  });

  it("オフセット付きのビューでも正しく比べる", () => {
    const padded = new Uint8Array(current.length + 8);
    padded.set(current, 8);
    const view = new Uint8Array(padded.buffer, 8, current.length);
    expect(isSameVapidKey(view, VAPID_PUBLIC_KEY)).toBe(true);
  });

  // ---- 「判定できないときは触らない」 ----
  // ここを false 側に倒すと、applicationServerKey を返さないブラウザで
  // **正常な購読を毎回解除して作り直す**ことになる。

  it("null なら true（判定できない → 触らない）", () => {
    expect(isSameVapidKey(null, VAPID_PUBLIC_KEY)).toBe(true);
  });

  it("undefined なら true", () => {
    expect(isSameVapidKey(undefined, VAPID_PUBLIC_KEY)).toBe(true);
  });

  it("空のバッファなら true", () => {
    expect(isSameVapidKey(new ArrayBuffer(0), VAPID_PUBLIC_KEY)).toBe(true);
  });

  it("期待値の側が壊れていても true（購読を壊す方向に倒さない）", () => {
    expect(isSameVapidKey(current.buffer.slice(0) as ArrayBuffer, "!!!broken!!!")).toBe(true);
  });
});
