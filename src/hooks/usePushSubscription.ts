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

// VAPID 公開鍵は brand.ts が唯一の宣言（Edge Function 側の直書きとは
// src/test/pushVapidConfig.test.ts が突き合わせる）。
import { VAPID_PUBLIC_KEY } from "@/lib/brand";
import { isSameVapidKey, urlBase64ToUint8Array } from "@/lib/webPushKey";

/**
 * 現在の公開鍵でブラウザに購読を作る（DB保存はしない）。
 *
 * ⚠️ **別の公開鍵の購読が残っていると `subscribe()` は `InvalidStateError` で失敗する。**
 * 残ったままだと利用者は二度と購読できない（ONに戻す操作も失敗し続ける）ので、
 * そのときは解除して**1回だけ**やり直す。
 */
async function createWebSubscription(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription> {
  const subscribe = () =>
    registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
    });
  try {
    return await subscribe();
  } catch (err) {
    const existing = await registration.pushManager.getSubscription();
    // 残骸が原因でないなら、元のエラーをそのまま返す（握りつぶさない）。
    if (!existing) throw err;
    await existing.unsubscribe();
    return await subscribe();
  }
}

/** 購読を push_subscriptions に保存する */
async function saveWebSubscription(userId: string, subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint!,
      p256dh: json.keys!.p256dh,
      auth: json.keys!.auth,
    },
    { onConflict: "user_id,endpoint" }
  );
  if (error) throw error;
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
  //
  // ⚠️ 「購読が存在するか」だけでは足りない。
  //
  // VAPID 公開鍵を変えると、**古い購読はブラウザ側に残ったまま二度と届かなくなる**。
  // `getSubscription()` は古い購読をそのまま返すので、画面は「通知ON」に見える。
  // サーバは新しい鍵で署名して送り、プッシュサービスは 401/403 を返すが、
  // 購読が消えるのは 404/410 のときだけなので**永久に直らない**。
  // FCM の SENDER_ID_MISMATCH とまったく同じ、無言の失敗。
  //
  // そこで**鍵が変わっていたら購読を作り直す**。これが無いと鍵を変更できない
  // （＝万一漏れても安全に交換する手段が無い）状態になる。
  const checkWebSubscription = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setIsSubscribed(false);
        return;
      }
      if (isSameVapidKey(subscription.options?.applicationServerKey, VAPID_PUBLIC_KEY)) {
        setIsSubscribed(true);
        return;
      }

      // ---- 自己修復 ----
      console.warn("[Push] VAPID 公開鍵が変わっています。購読を作り直します。");
      const staleEndpoint = subscription.endpoint;
      try {
        await subscription.unsubscribe();
      } catch (unsubErr) {
        // 解除に失敗しても、古い購読はどのみち届かない。作り直しを試みる。
        console.warn("[Push] 旧購読の解除に失敗:", unsubErr);
      }
      // 届かない endpoint を残すと、サーバが毎回 401/403 を叩き続ける。
      await supabase.from("push_subscriptions").delete().eq("endpoint", staleEndpoint);

      // 権限が granted でないときに subscribe() すると**許可ダイアログが突然出る**。
      // 画面を開いただけで出すのは筋が悪いので、そのときは OFF として扱う。
      if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
        setIsSubscribed(false);
        return;
      }
      if (!user) {
        setIsSubscribed(false);
        return;
      }
      const renewed = await createWebSubscription(registration);
      await saveWebSubscription(user.id, renewed);
      setIsSubscribed(true);
    } catch (err) {
      console.error("[Push] 購読の確認に失敗:", err);
      setIsSubscribed(false);
    } finally {
      setLoading(false);
    }
  }, [user]);

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
        subscription = await createWebSubscription(registration);
      } catch (subErr) {
        console.error("[Push] pushManager.subscribe failed:", subErr);
        toast.error(`プッシュ登録に失敗: ${subErr instanceof Error ? subErr.message : subErr}`);
        return false;
      }

      try {
        await saveWebSubscription(user.id, subscription);
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
      await supabase.from("push_devices").delete().eq("user_id", user.id);
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
        .from("notification_preferences")
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
          .from("notification_preferences")
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
