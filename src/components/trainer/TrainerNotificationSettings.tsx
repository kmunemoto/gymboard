import { useState, useEffect } from "react";
import { Bell, BellOff, BellRing, Settings, Shield, MessageCircle, CheckCircle2, Unlink, Calendar, RefreshCw, AlertCircle, Check } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { useTranslation } from "react-i18next";
import { LINE_INTEGRATION_ENABLED, GOOGLE_CALENDAR_TRAINER_ENABLED } from "@/lib/featureFlags";

const TrainerNotificationSettings = () => {
  const { t } = useTranslation();
  const {
    isSupported,
    isSubscribed,
    loading: pushLoading,
    permission,
    subscribe,
    unsubscribe,
  } = usePushSubscription();
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();

  const { profile, loading: profileLoading, refetch } = useProfile();
  const { user } = useAuth();

  const isLineLinked = !!profile?.line_user_id;

  // Google Calendar state
  const [gcalLinked, setGcalLinked] = useState(false);
  const [gcalLoading, setGcalLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const checkGcalStatus = async () => {
    if (!user) return;
    setGcalLoading(true);
    const { data } = await supabase
      .from("google_calendar_tokens" as any)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    setGcalLinked(!!data);
    setGcalLoading(false);
  };

  useEffect(() => {
    checkGcalStatus();
  }, [user]);


  // Handle LINE link result from redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkResult = params.get("line_link");
    if (linkResult === "success") {
      toast.success(t("settings.line.linkSuccess"));
      refetch();
      window.history.replaceState({}, "", window.location.pathname);
    } else if (linkResult === "error") {
      toast.error(t("settings.line.linkFailed"));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refetch, t]);

  // Listen for Google Calendar callback
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "google-calendar-result") {
        if (e.data.success) {
          toast.success(t("settings.gcal.linkSuccess"));
          setGcalLinked(true);
        } else {
          toast.error(t("settings.gcal.linkFailed"));
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [t]);

  const handleLineLink = async () => {
    if (!user) return;
    const { data, error } = await supabase.functions.invoke("line-auth-url", { body: {} });
    if (error || !data?.url) {
      toast.error(t("settings.line.startFailed"));
      return;
    }
    window.location.href = data.url;
  };


  const handleLineUnlink = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("profiles")
      .update({ line_user_id: null })
      .eq("user_id", user.id);
    if (error) {
      toast.error(t("settings.line.unlinkFailed"));
    } else {
      toast.success(t("settings.line.unlinked"));
      refetch();
    }
  };

  const handleGcalLink = async () => {
    if (!user) return;
    const popup = window.open("about:blank", "gcal-link", "width=500,height=700");
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-auth-url", {
        body: { user_id: user.id },
      });
      if (error || !data?.url) {
        popup?.close();
        toast.error(t("settings.gcal.authUrlFailed"));
        return;
      }
      if (popup) {
        popup.location.href = data.url;
      } else {
        window.location.href = data.url;
      }
    } catch (e) {
      popup?.close();
      console.error(e);
      toast.error(t("common.errorGeneric"));
    }
  };

  const handleGcalUnlink = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("google_calendar_tokens" as any)
      .delete()
      .eq("user_id", user.id);
    if (error) {
      toast.error(t("settings.gcal.unlinkFailed"));
    } else {
      toast.success(t("settings.gcal.unlinked"));
      setGcalLinked(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-sync", {
        body: { action: "sync_all" },
      });
      if (error) throw error;
      toast.success(t("settings.gcal.syncDone", { count: data?.synced || 0 }));
    } catch (e) {
      console.error(e);
      toast.error(t("settings.gcal.syncFailed"));
    }
    setSyncing(false);
  };

  const handleTogglePush = async () => {
    if (isSubscribed) {
      const ok = await unsubscribe();
      if (ok) toast.success(t("settings.notification.disabledToast"));
      else toast.error(t("settings.notification.unsubFailed"));
    } else {
      const ok = await subscribe();
      if (ok) toast.success(t("settings.notification.enabledToast"));
      else toast.error(t("settings.notification.permissionFailed"));
    }
  };


  return (
    <div className="pb-20 md:pb-0">
      <h1 className="text-xl font-bold flex items-center gap-2 mb-6">
        <Settings className="w-5 h-5 text-accent" />
        {t("settings.notification.title")}
      </h1>

      <div className="space-y-4 max-w-lg">
        {/* Googleカレンダー連携セクション。表示可否は featureFlags.ts で一元管理。 */}
        {GOOGLE_CALENDAR_TRAINER_ENABLED && (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Calendar className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-sm mb-1">{t("settings.gcal.section")}</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    {t("settings.gcal.description")}
                  </p>
                  {gcalLoading ? (
                    <DumbbellLoader className="w-4 h-4 text-muted-foreground" />
                  ) : gcalLinked ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-blue-500">
                        <CheckCircle2 className="w-4 h-4" />
                        {t("settings.gcal.linked")}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button size="sm" variant="outline" onClick={handleSyncAll} disabled={syncing}>
                          {syncing ? <DumbbellLoader className="w-3.5 h-3.5 mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                          {t("settings.gcal.syncAll")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleGcalUnlink}>
                          <Unlink className="w-3.5 h-3.5 mr-1.5" />
                          {t("settings.gcal.unlink")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={handleGcalLink}
                      className="bg-blue-500 hover:bg-blue-600 text-white"
                    >
                      <Calendar className="w-4 h-4 mr-1.5" />
                      {t("settings.gcal.link")}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* LINE連携セクション。表示可否は featureFlags.ts で一元管理。 */}
        {LINE_INTEGRATION_ENABLED && (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-[#06C755]/10 flex items-center justify-center shrink-0">
                  <MessageCircle className="w-5 h-5 text-[#06C755]" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-sm mb-1">{t("settings.line.section")}</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    {t("settings.line.trainerDescription")}
                  </p>
                  {isLineLinked ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#06C755]">
                        <CheckCircle2 className="w-4 h-4" />
                        {t("settings.line.linked")}
                      </div>
                      <Button size="sm" variant="outline" onClick={handleLineUnlink}>
                        <Unlink className="w-3.5 h-3.5 mr-1.5" />
                        {t("settings.line.unlink")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={handleLineLink}
                      className="bg-[#06C755] hover:bg-[#05b34c] text-white"
                    >
                      <MessageCircle className="w-4 h-4 mr-1.5" />
                      {t("settings.line.link")}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Push notification */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isSubscribed ? "bg-accent/10" : "bg-muted"}`}>
                {isSubscribed ? (
                  <Bell className="w-5 h-5 text-accent" />
                ) : (
                  <BellOff className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-sm mb-1">{t("settings.notification.push")}</h3>
                <p className="text-xs text-muted-foreground mb-3 break-all">
                  {t("settings.notification.pushDesc")}
                </p>
                {!isSupported ? (
                  <p className="text-xs text-muted-foreground">{t("settings.notification.notSupported")}</p>
                ) : pushLoading ? (
                  <DumbbellLoader className="w-4 h-4 text-muted-foreground" />
                ) : isSubscribed ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-accent flex items-center gap-1">
                      <BellRing className="w-3.5 h-3.5" />
                      {t("settings.notification.enabled")}
                    </span>
                    <Button size="sm" variant="outline" onClick={handleTogglePush}>
                      {t("settings.notification.disable")}
                    </Button>
                  </div>
                ) : permission === "denied" ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <div className="text-xs text-muted-foreground break-all">
                      {isNative
                        ? (platform === "ios"
                            ? t("settings.notification.deniedIos")
                            : t("settings.notification.deniedAndroid"))
                        : t("settings.notification.deniedWeb")}
                    </div>
                  </div>
                ) : (
                  <Button size="sm" onClick={handleTogglePush}>
                    <Bell className="w-4 h-4 mr-1.5" />
                    {t("settings.notification.allow")}
                  </Button>
                )}
              </div>
            </div>

            {isSubscribed && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-bold mb-2">{t("settings.notification.receiveTitle")}</p>
                <ul className="space-y-1.5">
                  <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                    {t("settings.notification.receiveBooking")}
                  </li>
                  <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                    {t("settings.notification.receiveCancel")}
                  </li>
                  <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                    {t("settings.notification.receiveTrial")}
                  </li>
                  <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                    {t("settings.notification.receiveMessage")}
                  </li>
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default TrainerNotificationSettings;
