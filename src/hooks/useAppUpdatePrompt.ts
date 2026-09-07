import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { supabase } from "@/integrations/supabase/client";
import { STORE_URLS } from "@/lib/brand";
import {
  DISMISS_WINDOW_MS,
  dismissKey,
  updatePromptDecision,
  type UpdatePromptDecision,
} from "@/lib/appVersion";

/**
 * 「新しい版が出ています」を出すかどうかを決めるフック。
 *
 * ## 🔴 ネイティブでしか動かない
 *
 * Web では**1行も実行しない**。理由は2つある:
 *
 *  1. Web に「ストアへ行って更新」は無い（更新は再読み込み。それは
 *     `src/main.tsx` の `#app-update-banner` が Service Worker 側で既にやっている）
 *  2. `App.getInfo()` は Web では **例外を投げる**。テストや jsdom で踏むと
 *     「テストは全部緑なのに exit 1」になる（CLAUDE.md の既知の罠）
 *
 * `Capacitor.isNativePlatform()` が false のときは supabase も叩かない。
 * したがって vitest / Playwright（どちらも Web）ではこのフックは**何もしない**。
 *
 * ## いつ調べ直すか
 *
 * 起動時と、バックグラウンドから戻ってきたとき（`appStateChange` の `isActive`）。
 * ストアで更新してアプリに戻ってきた直後に、案内が消えていてほしいため。
 *
 * ## フェイルセーフ
 *
 * 迷ったら**出さない**。次のどれでも出さない:
 *   - Web
 *   - そのプラットフォームのストアURLが空（押しても何も起きない案内を出さない）
 *   - `App.getInfo()` が失敗した／版数が読めない
 *   - RPC が失敗した／0行（未設定・未公開・停止中）
 *   - 版が離れすぎている（行の取り違えとみなす。`appVersion.ts` の MAX_MAJOR_GAP）
 *   - 24時間以内に同じ版で「あとで」を押している
 */
export interface AppUpdatePrompt {
  /** ダイアログを出すか */
  show: boolean;
  /** ストアに出ている版（案内文に出す） */
  latestVersion: string;
  /** いま動いている版（案内文に出す） */
  runningVersion: string;
  /** ボタンの飛び先 */
  storeUrl: string;
  /** なぜその判断になったか（調査用。画面には出さない） */
  reason: UpdatePromptDecision | "not-native" | "no-store-url" | "no-config" | "dismissed";
  /** 「あとで」。24時間、同じ版については出さなくなる */
  dismiss: () => void;
}

const EMPTY: Omit<AppUpdatePrompt, "dismiss"> = {
  show: false,
  latestVersion: "",
  runningVersion: "",
  storeUrl: "",
  reason: "not-native",
};

/** 「あとで」を押した記録が生きているか。localStorage が使えない環境でも落ちない */
const isDismissed = (platform: string, latestVersion: string): boolean => {
  try {
    const at = localStorage.getItem(dismissKey(platform, latestVersion));
    if (!at) return false;
    return Date.now() - Number(at) < DISMISS_WINDOW_MS;
  } catch {
    return false;
  }
};

export const useAppUpdatePrompt = (): AppUpdatePrompt => {
  const [state, setState] = useState(EMPTY);
  // 復帰のたびに RPC を投げ直さないための、直前の結果の控え
  const latestRef = useRef<{ version: string; platform: string } | null>(null);

  const evaluate = useCallback(async () => {
    // 🔴 ここより先はネイティブでしか動かさない（Web は getInfo が投げる）
    if (!Capacitor.isNativePlatform()) {
      setState({ ...EMPTY, reason: "not-native" });
      return;
    }

    const platform = Capacitor.getPlatform();
    const storeUrl =
      platform === "ios" ? STORE_URLS.ios : platform === "android" ? STORE_URLS.android : "";
    if (!storeUrl) {
      setState({ ...EMPTY, reason: "no-store-url" });
      return;
    }

    let runningVersion = "";
    try {
      runningVersion = (await CapApp.getInfo()).version ?? "";
    } catch {
      setState({ ...EMPTY, reason: "unreadable" });
      return;
    }

    let latestVersion = latestRef.current?.platform === platform ? latestRef.current.version : "";
    if (!latestVersion) {
      try {
        const { data, error } = await supabase.rpc("get_app_release", { p_platform: platform });
        if (error) throw error;
        latestVersion = data?.[0]?.latest_version ?? "";
      } catch {
        // 通信できない・関数が無い（アプリのほうが新しい）→ 何も出さない
        setState({ ...EMPTY, reason: "no-config" });
        return;
      }
      if (!latestVersion) {
        setState({ ...EMPTY, reason: "no-config" });
        return;
      }
      latestRef.current = { version: latestVersion, platform };
    }

    const decision = updatePromptDecision(runningVersion, latestVersion);
    if (decision !== "show") {
      setState({ show: false, latestVersion, runningVersion, storeUrl, reason: decision });
      return;
    }
    if (isDismissed(platform, latestVersion)) {
      setState({ show: false, latestVersion, runningVersion, storeUrl, reason: "dismissed" });
      return;
    }
    setState({ show: true, latestVersion, runningVersion, storeUrl, reason: "show" });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) void evaluate();
    };
    run();

    if (!Capacitor.isNativePlatform()) return;
    // Capacitor 6 以降 addListener は Promise を返す。解除できるように控えておく
    const handle = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) run();
    });
    return () => {
      cancelled = true;
      void handle.then((h) => h.remove()).catch(() => {});
    };
  }, [evaluate]);

  const dismiss = useCallback(() => {
    const platform = Capacitor.getPlatform();
    setState((prev) => {
      try {
        if (prev.latestVersion) {
          localStorage.setItem(dismissKey(platform, prev.latestVersion), String(Date.now()));
        }
      } catch {
        // プライベートブラウズ等で書けなくても、その場で閉じるだけは効かせる
      }
      return { ...prev, show: false, reason: "dismissed" };
    });
  }, []);

  return { ...state, dismiss };
};
