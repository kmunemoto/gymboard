import { useState, useEffect } from "react";
import { Bell, BellOff, BellRing, Settings, Shield, MessageCircle, CheckCircle2, Unlink, Calendar, RefreshCw, AlertCircle, Clock } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { usePushSubscription, type NotificationPreferences } from "@/hooks/usePushSubscription";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

const TrainerNotificationSettings = () => {
  const {
    isSupported,
    isSubscribed,
    loading: pushLoading,
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

  // Load push notification preferences when subscription becomes active
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

  // Handle LINE link result from redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkResult = params.get("line_link");
    if (linkResult === "success") {
      toast.success("LINE連携が完了しました！");
      refetch();
      window.history.replaceState({}, "", window.location.pathname);
    } else if (linkResult === "error") {
      toast.error("LINE連携に失敗しました");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refetch]);

  // Listen for Google Calendar callback
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "google-calendar-result") {
        if (e.data.success) {
          toast.success("Googleカレンダー連携が完了しました！");
          setGcalLinked(true);
        } else {
          toast.error("Googleカレンダー連携に失敗しました");
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleLineLink = async () => {
    if (!user) return;
    const { data, error } = await supabase.functions.invoke("line-auth-url", { body: {} });
    if (error || !data?.url) {
      toast.error("LINE連携の開始に失敗しました");
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
      toast.error("LINE連携の解除に失敗しました");
    } else {
      toast.success("LINE連携を解除しました");
      refetch();
    }
  };

  const handleGcalLink = async () => {
    if (!user) return;
    // Open popup immediately to avoid browser popup blocker
    const popup = window.open("about:blank", "gcal-link", "width=500,height=700");
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-auth-url", {
        body: { user_id: user.id },
      });
      if (error || !data?.url) {
        popup?.close();
        toast.error("Google認証URLの取得に失敗しました");
        return;
      }
      if (popup) {
        popup.location.href = data.url;
      } else {
        // Fallback: redirect in same window
        window.location.href = data.url;
      }
    } catch (e) {
      popup?.close();
      console.error(e);
      toast.error("エラーが発生しました");
    }
  };

  const handleGcalUnlink = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("google_calendar_tokens" as any)
      .delete()
      .eq("user_id", user.id);
    if (error) {
      toast.error("連携解除に失敗しました");
    } else {
      toast.success("Googleカレンダー連携を解除しました");
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
      toast.success(`${data?.synced || 0}件の予約をGoogleカレンダーに同期しました`);
    } catch (e) {
      console.error(e);
      toast.error("同期に失敗しました");
    }
    setSyncing(false);
  };

  const handleTogglePush = async () => {
    if (isSubscribed) {
      const ok = await unsubscribe();
      if (ok) toast.success("プッシュ通知を無効にしました");
      else toast.error("通知の解除に失敗しました");
    } else {
      const ok = await subscribe();
      if (ok) toast.success("プッシュ通知を有効にしました！");
      else toast.error("通知の許可が得られませんでした。ブラウザの設定を確認してください。");
    }
  };

  return (
    <div className="pb-20 md:pb-0">
      <h1 className="text-xl font-bold flex items-center gap-2 mb-6">
        <Settings className="w-5 h-5 text-accent" />
        通知設定
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
        {false && (
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

        {/* Browser push notification */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5 text-accent" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-sm mb-1">プッシュ通知</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  アプリを開いていない時でも、新着メッセージや予約の通知をスマートフォンに届けます。
                </p>
                {!isSupported ? (
                  <p className="text-xs text-muted-foreground">このブラウザはプッシュ通知に対応していません。</p>
                ) : isSubscribed ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-accent">
                      <BellRing className="w-4 h-4" />
                      プッシュ通知は有効です
                    </div>
                    <Button size="sm" variant="outline" onClick={handleTogglePush} disabled={pushLoading}>
                      通知を無効にする
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" onClick={handleTogglePush} disabled={pushLoading}>
                    <Bell className="w-4 h-4 mr-1.5" />
                    プッシュ通知を許可する
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Message notification toggle */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                  <BellRing className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">新着メッセージ通知</h3>
                  <p className="text-xs text-muted-foreground">顧客からメッセージが届いた際に通知</p>
                </div>
              </div>
              <Switch checked={messageNotif} onCheckedChange={setMessageNotif} />
            </div>
          </CardContent>
        </Card>

        {/* Reminder notification toggle */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                  <Bell className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">予約リマインド通知</h3>
                  <p className="text-xs text-muted-foreground">予約24時間前の自動リマインド送信状況</p>
                </div>
              </div>
              <Switch checked={reminderNotif} onCheckedChange={setReminderNotif} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default TrainerNotificationSettings;
