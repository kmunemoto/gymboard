import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  isNativePush,
  nativePlatform,
  checkNativePermission,
  requestNativePermission,
  attachNativeListeners,
  detachNativeListeners,
  registerCurrentDevice,
  isDeviceSubscribed,
  ensureDefaultPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPermission,
} from "@/lib/pushNotifications";

// VAPID public key (Web Push only)
const VAPID_PUBLIC_KEY = "BKxLbT912uBVUI_0010w-QQWaic5ITY-_SZS1wo9BZdTq6mTyfbBPlmftYG_CKB4cdJYPTSLhiEGADA3Uv_R5_s";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// 後方互換のため型はフックからも再エクスポート（既存の import を壊さない）。
export type { NotificationPreferences } from "@/lib/pushNotifications";
import type { NotificationPreferences } from "@/lib/pushNotifications";

const DEFAULT_PREFS = DEFAULT_NOTIFICATION_PREFERENCES;

export function usePushSubscription() {
  const { user } = useAuth();
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  // ===== Native =====
  const checkNativeSubscription = useCallback(async () => {
    if (!user) return;
    // 端末単位で判定（他端末で登録済みでもこの端末が未登録なら OFF 扱い）。
    const subscribed = await isDeviceSubscribed(user.id);
    setIsSubscribed(subscribed);
    setLoading(false);
  }, [user]);

  // ===== Web =====
  const checkWebSubscription = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch {
      setIsSubscribed(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // ===== Initial detection =====
  useEffect(() => {
    if (isNativePush()) {
      setIsSupported(true);
      (async () => {
        setPermission(await checkNativePermission());
      })();
      if (user) checkNativeSubscription();
      else setLoading(false);
    } else {
      const supported = "serviceWorker" in navigator && "PushManager" in window;
      setIsSupported(supported);
      if (supported && typeof Notification !== "undefined") {
        setPermission(Notification.permission as NotificationPermission);
      }
      if (supported && user) checkWebSubscription();
      else setLoading(false);
    }
  }, [user, checkNativeSubscription, checkWebSubscription]);

  // ===== Subscribe =====
  const subscribeWeb = useCallback(async () => {
    if (!user) return false;
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as NotificationPermission);
      if (perm !== "granted") return false;

      let registration: ServiceWorkerRegistration;
      try {
        registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
      } catch (swErr) {
        console.error("[Push] SW registration failed:", swErr);
        toast.error("Service Workerの登録に失敗しました");
        return false;
      }

      let subscription: PushSubscription;
      try {
        const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as unknown as BufferSource,
        });
      } catch (subErr) {
        console.error("[Push] pushManager.subscribe failed:", subErr);
        toast.error(`プッシュ登録に失敗: ${subErr instanceof Error ? subErr.message : subErr}`);
        return false;
      }

      try {
        const json = subscription.toJSON();
        const { error } = await supabase.from("push_subscriptions").upsert(
          {
            user_id: user.id,
            endpoint: json.endpoint!,
            p256dh: json.keys!.p256dh,
            auth: json.keys!.auth,
          },
          { onConflict: "user_id,endpoint" }
        );
        if (error) throw error;
      } catch (dbErr) {
        console.error("[Push] DB save failed:", dbErr);
        toast.error(`DB保存に失敗: ${dbErr instanceof Error ? dbErr.message : dbErr}`);
        return false;
      }

      await ensureDefaultPreferences(user.id);
      setIsSubscribed(true);
      return true;
    } catch (err) {
      console.error("[Push] Unexpected error:", err);
      return false;
    }
  }, [user]);

  const subscribeNative = useCallback(async () => {
    if (!user) return false;
    try {
      const perm = await requestNativePermission();
      setPermission(perm);
      if (perm !== "granted") return false;

      // リスナー登録 → この端末のトークンを登録（端末ごと）。
      await attachNativeListeners(user.id);
      const ok = await registerCurrentDevice(user.id);
      if (!ok) {
        toast.error("通知トークンの保存に失敗しました");
        return false;
      }
      await ensureDefaultPreferences(user.id);
      setIsSubscribed(true);
      return true;
    } catch (err) {
      console.error("[Push native] subscribe failed:", err);
      toast.error("プッシュ通知の登録に失敗しました");
      return false;
    }
  }, [user]);

  const subscribe = useCallback(async () => {
    return isNativePush() ? subscribeNative() : subscribeWeb();
  }, [subscribeNative, subscribeWeb]);

  // ===== Unsubscribe =====
  const unsubscribeWeb = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      }
      setIsSubscribed(false);
      return true;
    } catch (err) {
      console.error("Push unsubscribe failed:", err);
      return false;
    }
  }, []);

  const unsubscribeNative = useCallback(async () => {
    if (!user) return false;
    try {
      if (nativePlatform() === "ios") {
        const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
        try {
          await FirebaseMessaging.deleteToken();
        } catch {
          /* ignore */
        }
      }
      await detachNativeListeners();
      await supabase.from("push_devices" as any).delete().eq("user_id", user.id);
      setIsSubscribed(false);
      return true;
    } catch (err) {
      console.error("[Push native] unsubscribe failed:", err);
      return false;
    }
  }, [user]);

  const unsubscribe = useCallback(async () => {
    return isNativePush() ? unsubscribeNative() : unsubscribeWeb();
  }, [unsubscribeNative, unsubscribeWeb]);

  // ===== Notification preferences =====
  const getNotificationPreferences = useCallback(async (): Promise<NotificationPreferences> => {
    if (!user) return DEFAULT_PREFS;
    try {
      const { data } = await supabase
        .from("notification_preferences" as any)
        .select("reminder_day_before, reminder_hour_before, reminder_period")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!data) return DEFAULT_PREFS;
      const row = data as unknown as NotificationPreferences;
      return {
        reminder_day_before: row.reminder_day_before ?? true,
        reminder_hour_before: row.reminder_hour_before ?? true,
        reminder_period: row.reminder_period ?? true,
      };
    } catch (e) {
      console.warn("[Push] getNotificationPreferences failed:", e);
      return DEFAULT_PREFS;
    }
  }, [user]);

  const updateNotificationPreference = useCallback(
    async (key: keyof NotificationPreferences, value: boolean): Promise<boolean> => {
      if (!user) return false;
      try {
        const current = await getNotificationPreferences();
        const next = { ...current, [key]: value };
        const { error } = await supabase
          .from("notification_preferences" as any)
          .upsert(
            { user_id: user.id, ...next, updated_at: new Date().toISOString() },
            { onConflict: "user_id" },
          );
        if (error) throw error;
        return true;
      } catch (e) {
        console.error("[Push] updateNotificationPreference failed:", e);
        return false;
      }
    },
    [user, getNotificationPreferences],
  );

  return {
    isSupported,
    isSubscribed,
    loading,
    permission,
    subscribe,
    unsubscribe,
    getNotificationPreferences,
    updateNotificationPreference,
  };
}
