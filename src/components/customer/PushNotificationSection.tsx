import { Bell, BellOff, AlertCircle } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

const PushNotificationSection = () => {
  const { isSupported, isSubscribed, loading, permission, subscribe, unsubscribe } = usePushSubscription();
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();


  if (!isSupported) return null;

  const handleToggle = async () => {
    if (isSubscribed) {
      const ok = await unsubscribe();
      if (ok) toast.success("プッシュ通知をオフにしました");
      else toast.error("通知の解除に失敗しました");
    } else {
      const ok = await subscribe();
      if (ok) toast.success("プッシュ通知をオンにしました");
      else toast.error("通知の許可が得られませんでした。ブラウザの設定をご確認ください。");
    }
  };

  return (
    <section>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <Bell className="w-3.5 h-3.5" />
        プッシュ通知
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
              <p className="text-sm font-bold mb-1">アプリのプッシュ通知</p>
              <p className="text-xs text-muted-foreground mb-3 break-all">
                予約確定・キャンセル・トレーナーからのメッセージ等をスマホやPCの通知として受け取れます。
              </p>
              {loading ? (
                <DumbbellLoader className="w-4 h-4 text-muted-foreground" />
              ) : isSubscribed ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-accent">通知ON</span>
                  <Button size="sm" variant="outline" onClick={handleToggle}>
                    通知をOFFにする
                  </Button>
                </div>
              ) : (
                <Button size="sm" onClick={handleToggle} variant="accent">
                  <Bell className="w-4 h-4 mr-1.5" />
                  通知を受け取る
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
};

export default PushNotificationSection;
