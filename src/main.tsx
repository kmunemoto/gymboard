import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { App as CapApp } from "@capacitor/app";
import App from "./App.tsx";
import "./index.css";
import "./lib/i18n";
import { initThemeColor } from "./lib/themeColor";
import { initBackgroundImage } from "./lib/backgroundImage";
import { clearAppBadge } from "./lib/appBadge";

// 保存済みのテーマカラーを起動時に適用（未選択なら既定のまま）
initThemeColor();
// 保存済みの背景画像を起動時に適用（未設定なら何もしない）
initBackgroundImage();

// Initialize native (Capacitor) integrations — no-op on web
if (Capacitor.isNativePlatform()) {
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  StatusBar.setBackgroundColor({ color: "#FFFFFF" }).catch(() => {});
  // 🔴 キーボードが出たときの縮め方は **iOS だけ Native**（2026-09-11）。
  //
  // ## なぜ iOS で Body だと直らないのか（3回目でようやく分かった）
  //
  // `ResizeBody` は `document.body.style.height` を書き換える**だけ**。
  // Capacitor のプラグイン実装（node_modules/@capacitor/keyboard の iOS 側）で、
  // WebView の frame を縮める `setFrame` は **Native の分岐にしかない**。
  // README も Body について "Relative units are not affected, because the
  // viewport does not change" と明言している。
  //
  // ところがチャットの外枠は `position: fixed` で、**包含ブロックは body ではなく
  // レイアウトビューポート**。つまり body をいくら縮めても外枠は1pxも動かない。
  // Body 設定では**構造的に直りようがなかった**（式の問題ではなかった）。
  //
  // ## Android を触らない理由
  //
  // Android は `possiblyResizeChildOfContent` がネイティブの content view ごと
  // 縮めるので、Body のままでも `innerHeight` も `visualViewport` も同時に縮み、
  // 既に正しく動いている。**動いているものは触らない。**
  //
  // ## これで何が変わるか
  //
  // iOS も WebView ごと縮む＝Android と同じ経路に乗る。`100vh` も縮むので、
  // `--kb`（visualViewport 方式）は両プラットフォームで常に 0 になり、
  // 外枠の `bottom: max(--kb, --nav-h)` は `--nav-h` を採る。縮んだビューポートの
  // 下端はキーボードの上端なので、入力欄はボトムナビのすぐ上に出る。
  // `--kb` の計算は Web／PWA のために残す（そちらは WebView が縮まない）。
  //
  // ⚠️ **実機での確認が要る。** この不具合は2回、実機の数値を1度も見ないまま
  //    数式を推測で直して2回とも直っていない。今回は仕組み（fixed は body に
  //    追随しない）まで辿ったが、最終確認は実機でしかできない。
  //    数値は `app.gymboard.mobile://kb?on=1` で出せる（KeyboardMetrics.tsx）。
  Keyboard.setResizeMode({
    mode: Capacitor.getPlatform() === "ios" ? KeyboardResize.Native : KeyboardResize.Body,
  }).catch(() => {});
  CapApp.addListener("backButton", ({ canGoBack }) => {
    if (!canGoBack) {
      CapApp.exitApp();
    } else {
      window.history.back();
    }
  });

  // OAuth / メール確認のディープリンク（app.gymboard.mobile://auth/callback?...）を受け取り、
  // アプリ内ブラウザを閉じて既存の /auth/callback 処理にクエリ・ハッシュを引き継ぐ。
  CapApp.addListener("appUrlOpen", async ({ url }) => {
    if (!url) return;
    try {
      // 🔴 キーボードの「ものさし」のスイッチ（app.gymboard.mobile://kb?on=1）。
      //    実機でしか再現しない不具合の計測に使う。アプリにはアドレスバーが無く、
      //    ?kb=1 を付ける手段が他に無いため、ここで受ける（2026-09-11）。
      //    お客様には一切見えない。詳細は src/components/KeyboardMetrics.tsx。
      if (url.includes("//kb")) {
        const parsed = new URL(url);
        const on = parsed.searchParams.get("on") !== "0";
        try {
          if (on) localStorage.setItem("kb-metrics", "1");
          else localStorage.removeItem("kb-metrics");
        } catch {
          // プライベートブラウズ等で書けなくても、アプリは落とさない
        }
        window.location.href = "/";
        return;
      }
      // 決済からの復帰（app.gymboard.mobile://billing?status=success）。
      // 反映は Stripe の webhook が行うので、ここでは画面を戻して合図を渡すだけ。
      // `?billing=success` は TrainerBilling が拾って toast と再取得を出す。
      if (url.includes("//billing")) {
        const parsed = new URL(url);
        const { Browser } = await import("@capacitor/browser");
        Browser.close().catch(() => {});
        const ok = parsed.searchParams.get("status") === "success";
        window.location.href = `/?tab=billing&billing=${ok ? "success" : "cancel"}`;
        return;
      }
      if (!url.includes("auth/callback")) return;
      const parsed = new URL(url);
      const { Browser } = await import("@capacitor/browser");
      Browser.close().catch(() => {});
      window.location.href = `/auth/callback${parsed.search}${parsed.hash}`;
    } catch (e) {
      console.warn("appUrlOpen handling failed:", e);
    }
  });

  // フォアグラウンドに戻ったらアイコンのバッジ（未読マーク）をクリアする。
  // （capacitor.config の Badge.autoClear と二重で確実に消す）
  CapApp.addListener("appStateChange", ({ isActive }) => {
    if (isActive) clearAppBadge();
  });
}

// 起動時・再表示時にアイコンのバッジをクリア（Web/ネイティブ共通）。
clearAppBadge();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") clearAppBadge();
});

const showAppUpdateBanner = () => {
  if (document.getElementById("app-update-banner")) return;

  const banner = document.createElement("div");
  banner.id = "app-update-banner";
  banner.setAttribute("role", "button");
  banner.setAttribute("tabindex", "0");
  banner.textContent = "アプリが更新されました。タップして更新";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "閉じる");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    banner.remove();
  });

  banner.appendChild(closeButton);
  banner.addEventListener("click", () => window.location.reload());
  banner.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      window.location.reload();
    }
  });

  document.body.appendChild(banner);
};

// Guard: don't register SW in iframe/preview to avoid caching issues
const isInIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

if ("serviceWorker" in navigator && !isInIframe && !isPreviewHost && !Capacitor.isNativePlatform()) {
  navigator.serviceWorker.register("/sw.js").then((registration) => {
    let refreshing = false;

    const watchInstallingWorker = (worker: ServiceWorker) => {
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          // New SW is ready — activate it immediately
          worker.postMessage("SKIP_WAITING");
          showAppUpdateBanner();
        }
      });
    };

    if (registration.waiting) {
      registration.waiting.postMessage("SKIP_WAITING");
      showAppUpdateBanner();
    }

    if (registration.installing) {
      watchInstallingWorker(registration.installing);
    }

    registration.addEventListener("updatefound", () => {
      if (registration.installing) {
        watchInstallingWorker(registration.installing);
      }
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      // New SW took control — reload to pick up fresh assets
      window.location.reload();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        registration.update().catch((err) => console.warn("SW update failed:", err));
      }
    });
  }).catch((err) =>
    console.warn("SW registration failed:", err)
  );
}

createRoot(document.getElementById("root")!).render(<App />);
