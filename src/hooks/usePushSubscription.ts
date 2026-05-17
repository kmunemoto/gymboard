import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// This must be the FULL 65-byte uncompressed VAPID public key in URL-safe base64
// Generate with: npx web-push generate-vapid-keys
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

export function usePushSubscription() {
  const { user } = useAuth();
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window;
    setIsSupported(supported);
    if (supported && user) {
      checkSubscription();
    } else {
      setLoading(false);
    }
  }, [user]);

  const checkSubscription = useCallback(async () => {
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

  const subscribe = useCallback(async () => {
    if (!user) return false;
    try {
      // 1. Request notification permission FIRST (must be from user gesture)
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.warn("Notification permission denied:", permission);
        return false;
      }

      // 2. Ensure SW is registered and ready
      let registration: ServiceWorkerRegistration;
      try {
        registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        console.log("[Push] SW registered OK");
      } catch (swErr) {
        console.error("[Push] SW registration failed:", swErr);
        toast.error("Service Workerの登録に失敗しました");
        return false;
      }

      // 3. Convert VAPID key and subscribe
      let subscription: PushSubscription;
      try {
        const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as unknown as BufferSource,
        });
        console.log("[Push] pushManager.subscribe OK:", subscription.endpoint);
      } catch (subErr) {
        console.error("[Push] pushManager.subscribe failed:", subErr);
        toast.error(`プッシュ登録に失敗: ${subErr instanceof Error ? subErr.message : subErr}`);
        return false;
      }

      // 4. Store in DB
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
        console.log("[Push] DB save OK");
      } catch (dbErr) {
        console.error("[Push] DB save failed:", dbErr);
        toast.error(`DB保存に失敗: ${dbErr instanceof Error ? dbErr.message : dbErr}`);
        return false;
      }

      setIsSubscribed(true);
      return true;
    } catch (err) {
      console.error("[Push] Unexpected error:", err);
      return false;
    }
  }, [user]);

  const unsubscribe = useCallback(async () => {
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

  return { isSupported, isSubscribed, loading, subscribe, unsubscribe };
}
