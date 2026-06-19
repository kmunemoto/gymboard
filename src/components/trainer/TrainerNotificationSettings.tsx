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
        {/*
          App Store審査のため一時的に非表示。LINE/Googleカレンダー連携の外部設定が整い次第、false を true に戻して再有効化する。
          連携済みユーザーのデータ・通知ロジックには影響しない。
        */}
        {false && (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Calendar className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-sm mb-1">Googleカレンダー連携</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    予約が入ると自動的にGoogleカレンダーに登録されます。キャンセル時は自動削除されます。
                  </p>
                  {gcalLoading ? (
                    <DumbbellLoader className="w-4 h-4 text-muted-foreground" />
                  ) : gcalLinked ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-blue-500">
                        <CheckCircle2 className="w-4 h-4" />
                        Googleカレンダー連携済み
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button size="sm" variant="outline" onClick={handleSyncAll} disabled={syncing}>
                          {syncing ? <DumbbellLoader className="w-3.5 h-3.5 mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                          既存予約を一括同期
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleGcalUnlink}>
                          <Unlink className="w-3.5 h-3.5 mr-1.5" />
                          連携を解除
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
                      Googleカレンダーと連携する
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/*
          App Store審査のため一時的に非表示。LINE/Googleカレンダー連携の外部設定が整い次第、false を true に戻して再有効化する。
          連携済みユーザーのデータ・通知ロジックには影響しない。
        */}
        {true && (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-[#06C755]/10 flex items-center justify-center shrink-0">
                  <MessageCircle className="w-5 h-5 text-[#06C755]" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-sm mb-1">LINE連携</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    LINEと連携すると、新規予約・キャンセルなどの通知をLINEで受け取れます。
                  </p>
                  {isLineLinked ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#06C755]">
                        <CheckCircle2 className="w-4 h-4" />
                        LINE連携済み
                      </div>
                      <Button size="sm" variant="outline" onClick={handleLineUnlink}>
                        <Unlink className="w-3.5 h-3.5 mr-1.5" />
                        連携を解除
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={handleLineLink}
                      className="bg-[#06C755] hover:bg-[#05b34c] text-white"
                    >
                      <MessageCircle className="w-4 h-4 mr-1.5" />
                      LINEと連携する
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
                <h3 className="font-bold text-sm mb-1">プッシュ通知</h3>
                <p className="text-xs text-muted-foreground mb-3 break-all">
                  アプリを開いていない時でも、予約・キャンセル・体験予約・メッセージの通知をスマートフォンに届けます。
                </p>
                {!isSupported ? (
                  <p className="text-xs text-muted-foreground">このデバイスはプッシュ通知に対応していません。</p>
                ) : pushLoading ? (
                  <DumbbellLoader className="w-4 h-4 text-muted-foreground" />
                ) : isSubscribed ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-accent flex items-center gap-1">
                      <BellRing className="w-3.5 h-3.5" />
                      プッシュ通知は有効です
                    </span>
                    <Button size="sm" variant="outline" onClick={handleTogglePush}>
                      通知を無効にする
                    </Button>
                  </div>
                ) : permission === "denied" ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <div className="text-xs text-muted-foreground break-all">
                      {isNative ? (
                        <>
                          通知が拒否されています。{platform === "ios" ? "iPhoneの「設定」→「ジムボード」→「通知」" : "端末の「設定」→「アプリ」→「ジムボード」→「通知」"}から許可してください。
                        </>
                      ) : (
                        <>通知が拒否されています。ブラウザのサイト設定から通知を許可してください。</>
                      )}
                    </div>
                  </div>
                ) : (
                  <Button size="sm" onClick={handleTogglePush}>
                    <Bell className="w-4 h-4 mr-1.5" />
                    プッシュ通知を許可する
                  </Button>
                )}
              </div>
            </div>

            {isSubscribed && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-bold mb-2">受け取る通知</p>
                <ul className="space-y-1.5">
                  <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                    新しい予約
                  </li>
                  <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                    予約キャンセル
                  </li>
                  <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                    新しい体験予約
                  </li>
                  <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                    お客様からのメッセージ
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
