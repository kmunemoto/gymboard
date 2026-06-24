import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, BellOff, AlertCircle, Clock } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { usePushSubscription, type NotificationPreferences } from "@/hooks/usePushSubscription";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

const PushNotificationSection = () => {
  const { t } = useTranslation();
  const {
    isSupported,
    isSubscribed,
    loading,
    permission,
    subscribe,
    unsubscribe,
    getNotificationPreferences,
    updateNotificationPreference,
  } = usePushSubscription();
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();

  const [prefs, setPrefs] = useState<NotificationPreferences>({
    reminder_day_before: true,
    reminder_hour_before: true,
  });
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Load preferences whenever the subscription becomes active.
  useEffect(() => {
    let cancelled = false;
    if (!isSubscribed) {
      setPrefsLoaded(false);
      return;
    }
    (async () => {
      const p = await getNotificationPreferences();
      if (!cancelled) {
        setPrefs(p);
        setPrefsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSubscribed, getNotificationPreferences]);

  if (!isSupported) return null;

  const handleToggle = async () => {
    if (isSubscribed) {
      const ok = await unsubscribe();
      if (ok) toast.success(t("pushSection.offToast"));
      else toast.error(t("pushSection.unsubFailToast"));
    } else {
      const ok = await subscribe();
      if (ok) toast.success(t("pushSection.onToast"));
      else toast.error(t("pushSection.permissionFailToast"));
    }
  };

  const handlePrefToggle = async (key: keyof NotificationPreferences, value: boolean) => {
    // Optimistic update
    const prev = prefs;
    setPrefs({ ...prefs, [key]: value });
    const ok = await updateNotificationPreference(key, value);
    if (!ok) {
      setPrefs(prev);
      toast.error(t("pushSection.prefUpdateFailToast"));
    }
  };

  return (
    <section>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <Bell className="w-3.5 h-3.5" />
        {t("pushSection.header")}
      </h2>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${isSubscribed ? "bg-accent/10" : "bg-muted"}`}>
              {isSubscribed ? (
                <Bell className="w-4 h-4 text-accent" />
              ) : (
                <BellOff className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold mb-1">{t("pushSection.title")}</p>
              <p className="text-xs text-muted-foreground mb-3 break-all">
                {t("pushSection.desc")}
              </p>
              {loading ? (
                <DumbbellLoader className="w-4 h-4 text-muted-foreground" />
              ) : isSubscribed ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-accent">{t("pushSection.on")}</span>
                  <Button size="sm" variant="outline" onClick={handleToggle}>
                    {t("pushSection.turnOff")}
                  </Button>
                </div>
              ) : permission === "denied" ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <div className="text-xs text-muted-foreground break-all">
                    {isNative
                      ? platform === "ios"
                        ? t("pushSection.deniedIos")
                        : t("pushSection.deniedAndroid")
                      : t("pushSection.deniedWeb")}
                  </div>
                </div>
              ) : (
                <Button size="sm" onClick={handleToggle} variant="accent">
                  <Bell className="w-4 h-4 mr-1.5" />
                  {t("pushSection.receive")}
                </Button>
              )}
            </div>
          </div>

          {isSubscribed && (
            <div className="mt-4 pt-4 border-t border-border space-y-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {t("pushSection.reminderInfo")}
              </p>

              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{t("pushSection.dayBefore")}</p>
                  <p className="text-xs text-muted-foreground break-all">{t("pushSection.dayBeforeDesc")}</p>
                </div>
                <Switch
                  checked={prefs.reminder_day_before}
                  disabled={!prefsLoaded}
                  onCheckedChange={(v) => handlePrefToggle("reminder_day_before", v)}
                />
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{t("pushSection.hourBefore")}</p>
                  <p className="text-xs text-muted-foreground break-all">{t("pushSection.hourBeforeDesc")}</p>
                </div>
                <Switch
                  checked={prefs.reminder_hour_before}
                  disabled={!prefsLoaded}
                  onCheckedChange={(v) => handlePrefToggle("reminder_hour_before", v)}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
};

export default PushNotificationSection;
