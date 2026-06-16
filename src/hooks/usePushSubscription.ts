import { useState, useEffect, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

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

const isNative = () => Capacitor.isNativePlatform();
const nativePlatform = (): "ios" | "android" =>
  Capacitor.getPlatform() === "ios" ? "ios" : "android";

export type NotificationPreferences = {
  reminder_day_before: boolean;
  reminder_hour_before: boolean;
};

const DEFAULT_PREFS: NotificationPreferences = {
  reminder_day_before: true,
  reminder_hour_before: true,
};

async function ensureDefaultPreferences(userId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from("notification_preferences" as any)
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) {
      await supabase
        .from("notification_preferences" as any)
        .insert({ user_id: userId, ...DEFAULT_PREFS });
    }
  } catch (e) {
    console.warn("[Push] ensureDefaultPreferences failed:", e);
  }
}

export function usePushSubscription() {
  const { user } = useAuth();
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState<"default" | "granted" | "denied">("default");
  const listenersAttached = useRef(false);

  // ===== Initial detection =====
  useEffect(() => {
    if (isNative()) {
      setIsSupported(true);
      (async () => {
        try {
          if (nativePlatform() === "ios") {
            const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
            const p = await FirebaseMessaging.checkPermissions();
            setPermission(p.receive === "granted" ? "granted" : p.receive === "denied" ? "denied" : "default");
          } else {
            const { PushNotifications } = await import("@capacitor/push-notifications");
            const p = await PushNotifications.checkPermissions();
            setPermission(p.receive === "granted" ? "granted" : p.receive === "denied" ? "denied" : "default");
          }
        } catch {
          /* ignore */
        }
      })();
      if (user) checkNativeSubscription();
      else setLoading(false);
    } else {
      const supported = "serviceWorker" in navigator && "PushManager" in window;
      setIsSupported(supported);
      if (supported && typeof Notification !== "undefined") {
        setPermission(Notification.permission as "default" | "granted" | "denied");
      }
      if (supported && user) checkWebSubscription();
      else setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ===== Native =====
  const checkNativeSubscription = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("push_devices" as any)
        .select("id")
        .eq("user_id", user.id)
        .limit(1);
      setIsSubscribed(!!(data && data.length > 0));
    } catch {
      setIsSubscribed(false);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const attachNativeListeners = useCallback(async () => {
    if (listenersAttached.current) return;
    const { PushNotifications } = await import("@capacitor/push-notifications");
    listenersAttached.current = true;

    await PushNotifications.addListener("registration", async (token) => {
      console.log("[Push native] FCM token:", token.value);
      if (!user) return;
      try {
        const { error } = await supabase.from("push_devices" as any).upsert(
          {
            user_id: user.id,
            fcm_token: token.value,
            platform: nativePlatform(),
            device_info: {
              ua: navigator.userAgent,
              capacitor_platform: Capacitor.getPlatform(),
            },
          },
          { onConflict: "user_id,fcm_token" }
        );
        if (error) {
          console.error("[Push native] DB save failed:", error);
          toast.error(`通知トークン保存に失敗: ${error.message}`);
        } else {
          await ensureDefaultPreferences(user.id);
          setIsSubscribed(true);
        }
      } catch (e) {
        console.error("[Push native] save error:", e);
      }
    });


    await PushNotifications.addListener("registrationError", (err) => {
      console.error("[Push native] registrationError:", err);
      toast.error("プッシュ通知の登録に失敗しました");
    });

    await PushNotifications.addListener("pushNotificationReceived", (notification) => {
      console.log("[Push native] received foreground:", notification);
      const title = notification.title || "お知らせ";
      const body = notification.body || "";
      toast(title, { description: body });
    });

    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      console.log("[Push native] tapped:", action);
      const data = (action.notification?.data || {}) as Record<string, unknown>;
      const url = typeof data.url === "string" ? data.url : undefined;
      if (url && url.startsWith("/")) {
        window.location.assign(url);
      }
    });
  }, [user]);


  // ===== Subscribe =====
  const subscribeWeb = useCallback(async () => {
    if (!user) return false;
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as "default" | "granted" | "denied");
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
      if (nativePlatform() === "ios") {
        // === iOS: @capacitor-firebase/messaging で FCM トークンを取得 ===
        const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");

        const perm = await FirebaseMessaging.requestPermissions();
        setPermission(
          perm.receive === "granted"
            ? "granted"
            : perm.receive === "denied"
            ? "denied"
            : "default"
        );
        if (perm.receive !== "granted") return false;

        const { token } = await FirebaseMessaging.getToken();
        console.log("[Push iOS] FCM token:", token);

        const { error } = await supabase.from("push_devices" as any).upsert(
          {
            user_id: user.id,
            fcm_token: token,
            platform: "ios",
            device_info: {
              ua: navigator.userAgent,
              capacitor_platform: Capacitor.getPlatform(),
            },
          },
          { onConflict: "user_id,fcm_token" }
        );

        if (error) {
          console.error("[Push iOS] DB save failed:", error);
          toast.error("通知トークン保存に失敗しました");
          return false;
        }

        await ensureDefaultPreferences(user.id);

        await FirebaseMessaging.addListener("tokenReceived", async (event) => {
          console.log("[Push iOS] token refreshed:", event.token);
          await supabase.from("push_devices" as any).upsert(
            {
              user_id: user.id,
              fcm_token: event.token,
              platform: "ios",
              device_info: {
                ua: navigator.userAgent,
                capacitor_platform: Capacitor.getPlatform(),
              },
            },
            { onConflict: "user_id,fcm_token" }
          );
        });

        await FirebaseMessaging.addListener("notificationReceived", (event) => {
          console.log("[Push iOS] foreground notification:", event);
          const title = event.notification?.title || "お知らせ";
          const body = event.notification?.body || "";
          toast(title, { description: body });
        });

        await FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
          console.log("[Push iOS] notification tapped:", event);
          const data = (event.notification?.data || {}) as Record<string, unknown>;
          const url = typeof data.url === "string" ? data.url : undefined;
          if (url && url.startsWith("/")) {
            window.location.assign(url);
          }
        });

        setIsSubscribed(true);
        return true;
      } else {
        // === Android: 既存の @capacitor/push-notifications をそのまま使用 ===
        const { PushNotifications } = await import("@capacitor/push-notifications");

        const perm = await PushNotifications.requestPermissions();
        setPermission(
          perm.receive === "granted"
            ? "granted"
            : perm.receive === "denied"
            ? "denied"
            : "default"
        );
        if (perm.receive !== "granted") return false;

        await attachNativeListeners();
        await PushNotifications.register();
        return true;
      }
    } catch (err) {
      console.error("[Push native] subscribe failed:", err);
      toast.error("プッシュ通知の登録に失敗しました");
      return false;
    }
  }, [user, attachNativeListeners]);


  const subscribe = useCallback(async () => {
    return isNative() ? subscribeNative() : subscribeWeb();
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
      const { PushNotifications } = await import("@capacitor/push-notifications");
      try {
        await PushNotifications.removeAllListeners();
      } catch {
        /* ignore */
      }
      listenersAttached.current = false;
      await supabase.from("push_devices" as any).delete().eq("user_id", user.id);
      setIsSubscribed(false);
      return true;
    } catch (err) {
      console.error("[Push native] unsubscribe failed:", err);
      return false;
    }
  }, [user]);

  const unsubscribe = useCallback(async () => {
    return isNative() ? unsubscribeNative() : unsubscribeWeb();
  }, [unsubscribeNative, unsubscribeWeb]);

  // ===== Notification preferences =====
  const getNotificationPreferences = useCallback(async (): Promise<NotificationPreferences> => {
    if (!user) return DEFAULT_PREFS;
    try {
      const { data } = await supabase
        .from("notification_preferences" as any)
        .select("reminder_day_before, reminder_hour_before")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!data) return DEFAULT_PREFS;
      const row = data as unknown as NotificationPreferences;
      return {
        reminder_day_before: row.reminder_day_before ?? true,
        reminder_hour_before: row.reminder_hour_before ?? true,
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
