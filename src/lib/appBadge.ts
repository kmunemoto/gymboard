import { Capacitor } from "@capacitor/core";

/**
 * アプリアイコンのバッジ（未読を示す赤い数字）をクリアする。
 *
 * 背景:
 * - プッシュ通知は送信時に APNs/FCM 側で badge=1 を付与するが、iOS は
 *   アプリ自身が 0 に戻さない限りアイコンのバッジが自動では消えない。
 * - そのため「未読が無いのにバッジ(1)が残り続ける」状態になっていた。
 *
 * 方針（多重で確実にクリア）:
 * - ネイティブ(iOS/Android): @capawesome/capacitor-badge でバッジを 0 に。
 *   capacitor.config の Badge.autoClear=true により復帰時にも自動クリアされるが、
 *   コールド起動・通知タップ起動などの取りこぼしを防ぐため明示的にも呼ぶ。
 * - あわせて通知センターに残った配信済み通知も掃除する。
 * - Web(PWA): プラグインの Web 実装（Badging API: navigator.clearAppBadge）でクリア。
 *
 * バッジ非対応端末・権限未付与でも安全に no-op する（例外は握りつぶす）。
 */
export async function clearAppBadge(): Promise<void> {
  try {
    const { Badge } = await import("@capawesome/capacitor-badge");
    await Badge.clear();
  } catch {
    // バッジ非対応 / 権限なし等は無視
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      await PushNotifications.removeAllDeliveredNotifications();
    } catch {
      // 通知センターの掃除に失敗しても致命的ではない
    }
  }
}
