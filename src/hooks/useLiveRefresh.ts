import { useEffect, useRef } from "react";

/**
 * 画面を開いている間、一定間隔で読み直す（2026-10-06 残り枠の表示）。
 *
 * お客様の端末は、他のお客様の予約を Realtime で受け取れない（RLS で自分の予約しか
 * 見えない）。そこで「開いている間だけ・見えている間だけ」読み直して、
 * 残り枠をほぼリアルタイムにする。
 *
 * - 画面が隠れている間（他のアプリ・ロック中）は**読まない**（無駄な問い合わせを出さない。
 *   問い合わせはバックエンドの利用量＝クレジットになる）
 * - 戻ってきた瞬間に1回読む（1分待たせない）
 * - `enabled` が false なら何もしない（設定 OFF の店は今まで通り）
 */
export const LIVE_REFRESH_MS = 60_000;

export function useLiveRefresh(refresh: () => void, enabled: boolean, intervalMs: number = LIVE_REFRESH_MS): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const id = setInterval(() => {
      if (visible()) latest.current();
    }, intervalMs);
    const onVisibility = () => {
      if (visible()) latest.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs]);
}
