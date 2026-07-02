import { lazy, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, Bell } from "lucide-react";
import { toast } from "sonner";

import BottomNav from "./BottomNav";
import CustomerHome from "./CustomerHome";
import CustomerBooking from "./CustomerBooking";
import CustomerMeals from "./CustomerMeals";
import CustomerChat from "./CustomerChat";
import CustomerSettings from "./CustomerSettings";
import PwaInstallBanner from "./PwaInstallBanner";
import { Button } from "@/components/ui/button";
import LazyBoundary from "@/components/LazyBoundary";

// 重いタブ（グラフ recharts / 姿勢分析）は開いたときに読み込む（バンドル最適化）
const CustomerTraining = lazy(() => import("./CustomerTraining"));
const CustomerPosture = lazy(() => import("./CustomerPosture"));
const CustomerMonthlyReport = lazy(() => import("./CustomerMonthlyReport"));

import { useUnreadCount } from "@/hooks/useMessages";
import { useAnnouncementUnreadCount } from "@/hooks/useAnnouncements";
import AnnouncementsDialog from "./AnnouncementsDialog";
import PlanLimitBanner from "@/components/PlanLimitBanner";
import { useTenant } from "@/hooks/useTenant";

export type CustomerTab = "home" | "booking" | "training" | "meals" | "chat" | "settings" | "posture" | "report";

const CustomerView = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<CustomerTab>("home");
  const { count: unreadChat, refetch: refetchUnread } = useUnreadCount();
  const { count: unreadAnnouncements, refetch: refetchAnnouncements } = useAnnouncementUnreadCount();
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const { tenant } = useTenant();

  useEffect(() => {
    if (tenant?.primary_color) {
      document.documentElement.style.setProperty("--tenant-color", tenant.primary_color);
    }
  }, [tenant?.primary_color]);

  // Refetch unread when leaving chat
  useEffect(() => {
    if (tab !== "chat") {
      refetchUnread();
    }
  }, [tab]);

  // Detect Stripe checkout return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success" && params.get("session_id")) {
      toast.success(t("customerView.purchaseComplete"));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  return (
    <div className="min-h-screen bg-background pb-20 w-full max-w-md mx-auto overflow-x-hidden fade-in" translate="no">
      {/* Header */}
      <div
        className="fixed top-0 left-0 right-0 z-50 glass border-b border-border"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="max-w-md mx-auto flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2 min-w-0">
            {tenant?.logo_url && (
              <img src={tenant.logo_url} alt="" className="w-6 h-6 rounded object-cover" />
            )}
            <span className="text-sm font-bold truncate">{tenant?.gym_name_short || tenant?.gym_name || t("common.brand")}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAnnouncementsOpen(true)}
              className="text-muted-foreground relative"
              aria-label={t("announcementsDialog.title")}
            >
              <Bell className="w-4 h-4" />
              {unreadAnnouncements > 0 && (
                <span className="absolute top-0 right-0 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
                  {unreadAnnouncements > 9 ? "9+" : unreadAnnouncements}
                </span>
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setTab("chat")} className="text-muted-foreground relative" aria-label={t("common.chat")}>
              <MessageCircle className="w-4 h-4" />
              {unreadChat > 0 && (
                <span className="absolute top-0 right-0 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
                  {unreadChat > 9 ? "9+" : unreadChat}
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>
      <div className="pt-14" style={{ marginTop: "env(safe-area-inset-top, 0px)" }} key={tab}>

        <PlanLimitBanner />
        <LazyBoundary>
          {tab === "home" && <CustomerHome onNavigate={setTab} />}
          {tab === "booking" && <CustomerBooking />}
          {tab === "training" && <CustomerTraining />}
          {tab === "meals" && <CustomerMeals />}
          {tab === "chat" && <CustomerChat />}
          {tab === "settings" && <CustomerSettings />}
          {tab === "posture" && <CustomerPosture />}
          {tab === "report" && <CustomerMonthlyReport onBack={() => setTab("home")} />}
        </LazyBoundary>
      </div>
      <BottomNav activeTab={tab} onTabChange={setTab} unreadChat={unreadChat} />
      <PwaInstallBanner />
      <AnnouncementsDialog
        open={announcementsOpen}
        onClose={() => {
          setAnnouncementsOpen(false);
          refetchAnnouncements();
        }}
      />
    </div>
  );
};

export default CustomerView;
