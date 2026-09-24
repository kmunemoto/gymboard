import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import {
  parseSavedScreen, serializeScreen, urlHasNavigationIntent,
} from "@/lib/screenRestore";

/**
 * 開いていた画面を覚えておき、アプリが起動し直しても戻す。規則は `src/lib/screenRestore.ts`。
 *
 * 🔴 **端末の保存（localStorage）への読み書きは必ず try で包む。**
 *    プライベートブラウズ・容量切れ・テストの環境では投げることがある。
 *    ここで投げると画面ごと落ちる（effect の中なら、テストは緑のまま vitest が exit 1 する）。
 *    読めなければ「ホームから始める」＝今まで通りに倒す。
 */

/** 保存してあった画面を**最初の1回だけ**読む。戻してよくなければ null。 */
export function useRestoredScreen<T>(
  key: string | null,
  isValid: (s: unknown) => s is T,
): T | null {
  const [restored] = useState<T | null>(() => {
    if (!key) return null;
    try {
      if (urlHasNavigationIntent(window.location.search)) return null;
      return parseSavedScreen(window.localStorage.getItem(key), Date.now(), isValid);
    } catch {
      return null;
    }
  });
  return restored;
}

/**
 * いまの画面を覚えておく。
 *
 * 書くのは2つのとき:
 *   1. 画面が変わったとき
 *   2. **アプリが裏に回ったとき**（「離れた時刻」を書き直す）
 *
 * 2 が無いと、予約画面を1時間開いたまま他のアプリに行った人は、戻ってきたとき
 * 「1時間前の記録＝古すぎる」と判定されてホームに戻ってしまう。
 */
export function useRememberScreen<T>(key: string | null, state: T): void {
  const latest = useRef(state);
  latest.current = state;

  const write = useCallback(() => {
    if (!key) return;
    try {
      window.localStorage.setItem(key, serializeScreen(latest.current, Date.now()));
    } catch {
      // 書けなくても画面は壊さない（戻せないだけ＝今まで通り）
    }
  }, [key]);

  // 1. 画面が変わったとき。中身で比べる（オブジェクトを毎回作り直しても余計に書かない）
  const snapshot = JSON.stringify(state);
  useEffect(() => {
    write();
  }, [write, snapshot]);

  // 2. 裏に回ったとき。ブラウザは visibilitychange / pagehide、アプリは Capacitor の pause
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") write();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", write);

    let handle: Promise<{ remove: () => Promise<void> }> | null = null;
    try {
      if (Capacitor.isNativePlatform()) handle = CapApp.addListener("pause", write);
    } catch {
      handle = null;
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", write);
      if (handle) void handle.then((h) => h.remove()).catch(() => {});
    };
  }, [write]);
}
