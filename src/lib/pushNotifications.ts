// ネイティブ（iOS/Android）プッシュ通知の共通ロジック。
// 設定画面のフック（usePushSubscription）と、アプリ起動時のブートストラップ
// （PushBootstrap）の両方から使う。リスナー登録やトークン保存の実装を一本化し、
// 「設定画面でしか初期化されない／端末ごとに登録されない」問題を防ぐ。
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type NotificationPermission = "default" | "granted" | "denied";

export type NotificationPreferences = {
  reminder_day_before: boolean;
  reminder_hour_before: boolean;
  /** 利用期間リマインド（期限が近く残り回数があるときに期限7日前・3日前に通知） */
  reminder_period: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  reminder_day_before: true,
  reminder_hour_before: true,
  reminder_period: true,
};

export const isNativePush = (): boolean => Capacitor.isNativePlatform();

export const nativePlatform = (): "ios" | "android" =>
  Capacitor.getPlatform() === "ios" ? "ios" : "android";

const toPermission = (receive: string): NotificationPermission =>
  receive === "granted" ? "granted" : receive === "denied" ? "denied" : "default";

function deviceInfo() {
  return {
    ua: navigator.userAgent,
    capacitor_platform: Capacitor.getPlatform(),
  };
}

/** 現在の通知許可状態を返す（ネイティブのみ。Web は呼ばない）。 */
export async function checkNativePermission(): Promise<NotificationPermission> {
  try {
    if (nativePlatform() === "ios") {
      const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
      const p = await FirebaseMessaging.checkPermissions();
      return toPermission(p.receive);
    }
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const p = await PushNotifications.checkPermissions();
    return toPermission(p.receive);
  } catch {
    return "default";
  }
}

/** 許可をリクエストして結果を返す（ユーザー操作起点でのみ呼ぶ）。 */
export async function requestNativePermission(): Promise<NotificationPermission> {
  if (nativePlatform() === "ios") {
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
    const p = await FirebaseMessaging.requestPermissions();
    return toPermission(p.receive);
  }
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const p = await PushNotifications.requestPermissions();
  return toPermission(p.receive);
}

/** この端末のトークンを push_devices に保存（端末ごとに upsert）。 */
async function upsertDevice(
  userId: string,
  token: string,
  platform: "ios" | "android",
): Promise<{ error: unknown }> {
  const { error } = await supabase.from("push_devices" as any).upsert(
    {
      user_id: userId,
      fcm_token: token,
      platform,
      device_info: deviceInfo(),
    },
    { onConflict: "user_id,fcm_token" },
  );
  return { error };
}

/** 通知設定の既定行を用意（無ければ作成）。 */
export async function ensureDefaultPreferences(userId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from("notification_preferences" as any)
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) {
      await supabase
        .from("notification_preferences" as any)
        .insert({ user_id: userId, ...DEFAULT_NOTIFICATION_PREFERENCES });
    }
  } catch (e) {
    console.warn("[Push] ensureDefaultPreferences failed:", e);
  }
}

// ===== 受信時の共通ハンドラ =====
function showForegroundToast(title?: string | null, body?: string | null): void {
  toast(title || "お知らせ", { description: body || "" });
}

function navigateFromData(data: Record<string, unknown> | undefined): void {
  const url = data && typeof data.url === "string" ? data.url : undefined;
  if (url && url.startsWith("/")) window.location.assign(url);
}

// 同一ユーザーに対してリスナーを二重登録しないためのガード。
let listenersUserId: string | null = null;

async function attachIosListeners(userId: string): Promise<void> {
  const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
  await FirebaseMessaging.removeAllListeners();
  // トークン更新（rotation）時に保存し直す。これが無いと古いトークンのまま
  // 送信失敗→自動削除され、ユーザーは再設定するまで通知が来なくなる。
  await FirebaseMessaging.addListener("tokenReceived", async (event) => {
    if (event?.token) {
      const { error } = await upsertDevice(userId, event.token, "ios");
      if (error) console.error("[Push iOS] token refresh save failed:", error);
    }
  });
  await FirebaseMessaging.addListener("notificationReceived", (event) => {
    showForegroundToast(event.notification?.title, event.notification?.body);
  });
  await FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
    navigateFromData((event.notification?.data || {}) as Record<string, unknown>);
  });
}

async function attachAndroidListeners(userId: string): Promise<void> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.removeAllListeners();
  await PushNotifications.addListener("registration", async (token) => {
    const { error } = await upsertDevice(userId, token.value, "android");
    if (error) console.error("[Push Android] token save failed:", error);
  });
  await PushNotifications.addListener("registrationError", (err) => {
    console.error("[Push Android] registrationError:", err);
  });
  await PushNotifications.addListener("pushNotificationReceived", (notification) => {
    showForegroundToast(notification.title, notification.body);
  });
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    navigateFromData((action.notification?.data || {}) as Record<string, unknown>);
  });
}

/** 受信・タップ・トークン更新のリスナーを登録（同一ユーザーなら再登録しない）。 */
export async function attachNativeListeners(userId: string): Promise<void> {
  if (listenersUserId === userId) return;
  listenersUserId = userId;
  if (nativePlatform() === "ios") await attachIosListeners(userId);
  else await attachAndroidListeners(userId);
}

/** リスナーを解除（ログアウト・購読解除時）。 */
export async function detachNativeListeners(): Promise<void> {
  try {
    if (nativePlatform() === "ios") {
      const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
      await FirebaseMessaging.removeAllListeners();
    } else {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      await PushNotifications.removeAllListeners();
    }
  } catch {
    /* ignore */
  }
  listenersUserId = null;
}

/**
 * この端末の現在のトークンを登録する（端末ごとの登録・トークン更新の要）。
 * 事前に許可が granted であること。iOS は getToken→upsert、Android は
 * register()（登録結果は registration リスナーが保存）。
 */
export async function registerCurrentDevice(userId: string): Promise<boolean> {
  try {
    if (nativePlatform() === "ios") {
      const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
      const { token } = await FirebaseMessaging.getToken();
      const { error } = await upsertDevice(userId, token, "ios");
      if (error) {
        console.error("[Push iOS] device register save failed:", error);
        return false;
      }
      return true;
    }
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.register();
    return true;
  } catch (e) {
    console.error("[Push] registerCurrentDevice failed:", e);
    return false;
  }
}

/**
 * この端末でプッシュが有効か（許可 granted かつ自分のトークン行が存在）。
 * 「他端末で登録済みなのにこの端末は未登録」を ON 表示しないための端末単位判定。
 */
export async function isDeviceSubscribed(userId: string): Promise<boolean> {
  const perm = await checkNativePermission();
  if (perm !== "granted") return false;
  try {
    const { data } = await supabase
      .from("push_devices" as any)
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    return !!(data && data.length > 0);
  } catch {
    return false;
  }
}

/**
 * アプリ起動時のブートストラップ。すでに許可済みのユーザーについて、
 * リスナー登録＋この端末のトークン更新を行う（許可は決して自動要求しない）。
 */
export async function initPushForUser(userId: string): Promise<void> {
  if (!isNativePush()) return;
  try {
    const perm = await checkNativePermission();
    if (perm !== "granted") return; // 未許可なら何もしない（勝手にダイアログを出さない）
    await attachNativeListeners(userId);
    await registerCurrentDevice(userId);
    await ensureDefaultPreferences(userId);
  } catch (e) {
    console.warn("[Push] initPushForUser failed:", e);
  }
}
