import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { App as CapApp } from "@capacitor/app";
import App from "./App.tsx";
import "./index.css";
import "./lib/i18n";

// Initialize native (Capacitor) integrations — no-op on web
if (Capacitor.isNativePlatform()) {
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  StatusBar.setBackgroundColor({ color: "#FFFFFF" }).catch(() => {});
  Keyboard.setResizeMode({ mode: KeyboardResize.Body }).catch(() => {});
  CapApp.addListener("backButton", ({ canGoBack }) => {
    if (!canGoBack) {
      CapApp.exitApp();
    } else {
      window.history.back();
    }
  });
}

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
