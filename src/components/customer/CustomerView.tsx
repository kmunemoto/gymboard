import { useState, useEffect } from "react";
import { MessageCircle, Bell } from "lucide-react";
import { toast } from "sonner";

import BottomNav from "./BottomNav";
import CustomerHome from "./CustomerHome";
import CustomerBooking from "./CustomerBooking";
import CustomerMeals from "./CustomerMeals";
import CustomerChat from "./CustomerChat";
import CustomerTraining from "./CustomerTraining";
import CustomerSettings from "./CustomerSettings";
import CustomerPosture from "./CustomerPosture";
import CustomerMonthlyReport from "./CustomerMonthlyReport";
import CustomerQuest from "./CustomerQuest";
import LuminasChronicle from "./luminas/LuminasChronicle";
import CustomerDungeon from "./CustomerDungeon";
import QuestBattleResultDialog from "./QuestBattleResultDialog";
import PwaInstallBanner from "./PwaInstallBanner";
import { Button } from "@/components/ui/button";
import GymLogo from "@/components/GymLogo";
import { useUnreadCount } from "@/hooks/useMessages";
import { useAnnouncementUnreadCount } from "@/hooks/useAnnouncements";
import { useProfile } from "@/hooks/useProfile";
import AnnouncementsDialog from "./AnnouncementsDialog";

export type CustomerTab = "home" | "booking" | "training" | "meals" | "chat" | "settings" | "posture" | "report" | "quest" | "dungeon" | "chronicle";

const CustomerView = () => {
  const [tab, setTab] = useState<CustomerTab>("home");
  const { count: unreadChat, refetch: refetchUnread } = useUnreadCount();
  const { count: unreadAnnouncements, refetch: refetchAnnouncements } = useAnnouncementUnreadCount();
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const { profile } = useProfile();
  const gameMode = profile?.game_mode_enabled ?? true;

  // Bounce away from gamification tabs if game mode is OFF
  useEffect(() => {
    if (!gameMode && (tab === "quest" || tab === "dungeon" || tab === "chronicle")) {
      setTab("home");
    }
  }, [gameMode, tab]);

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
      toast.success("購入が完了しました！コインが反映されるまで数秒お待ちください");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  return (
    <div className="min-h-screen bg-background pb-20 w-full max-w-md mx-auto overflow-x-hidden fade-in" translate="no">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 z-50 glass border-b border-border">
        <div className="max-w-md mx-auto flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <GymLogo size="sm" />
            {/* ⚠️ DO NOT change this app name. Keep exactly as-is: "パーソナルジムSalute御所南" — never convert "Salute" to katakana */}
            <span className="text-sm font-bold">パーソナルジムSalute御所南</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAnnouncementsOpen(true)}
              className="text-muted-foreground relative"
              aria-label="お知らせ"
            >
              <Bell className="w-4 h-4" />
              {unreadAnnouncements > 0 && (
                <span className="absolute top-0 right-0 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
                  {unreadAnnouncements > 9 ? "9+" : unreadAnnouncements}
                </span>
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setTab("chat")} className="text-muted-foreground relative" aria-label="チャット">
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
      <div className="pt-12" key={tab}>
        {tab === "home" && <CustomerHome onNavigate={setTab} />}
        {tab === "booking" && <CustomerBooking />}
        {tab === "training" && <CustomerTraining />}
        {tab === "meals" && <CustomerMeals />}
        {tab === "chat" && <CustomerChat />}
        {tab === "settings" && <CustomerSettings />}
        {tab === "posture" && <CustomerPosture />}
        {tab === "report" && <CustomerMonthlyReport onBack={() => setTab("home")} />}
        {gameMode && tab === "quest" && <CustomerQuest onBack={() => setTab("home")} />}
        {gameMode && tab === "dungeon" && <CustomerDungeon onBack={() => setTab("home")} />}
        {gameMode && tab === "chronicle" && <LuminasChronicle onBack={() => setTab("home")} />}
      </div>
      <BottomNav activeTab={tab} onTabChange={setTab} unreadChat={unreadChat} />
      <PwaInstallBanner />
      <QuestBattleResultDialog />
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
