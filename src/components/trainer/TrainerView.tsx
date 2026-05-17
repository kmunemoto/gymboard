import { useState, useEffect } from "react";
import { MessageSquare } from "lucide-react";

import TrainerSidebar from "./TrainerSidebar";
import TrainerDashboard from "./TrainerDashboard";
import TrainerClientList from "./TrainerClientList";
import TrainerClientDetail from "./TrainerClientDetail";
import TrainerSchedule from "./TrainerSchedule";
import TrainerMessages from "./TrainerMessages";
import TrainerExerciseManager from "./TrainerExerciseManager";
import TrainerGymSettings from "./TrainerGymSettings";
import TrainerRaidManager from "./TrainerRaidManager";
import TrainerEventManager from "./TrainerEventManager";
import TrainerRivalBattleManager from "./TrainerRivalBattleManager";
import TrainerQuestManager from "./TrainerQuestManager";
import TrainerAnnouncementManager from "./TrainerAnnouncementManager";
import CounselingResponseList from "./CounselingResponseList";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import GymLogo from "@/components/GymLogo";
import { useUnreadCount } from "@/hooks/useMessages";
import { useCounselingResponses } from "@/hooks/useCounselingResponses";
import { supabase } from "@/integrations/supabase/client";

export type TrainerTab = "dashboard" | "clients" | "schedule" | "messages" | "exercises" | "counseling" | "raid" | "events" | "rival" | "quest" | "announcements" | "gym-settings";

const TrainerView = () => {
  const [tab, setTab] = useState<TrainerTab>("dashboard");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const { signOut } = useAuth();
  const { user } = useAuth();
  const { count: unreadMessages, refetch: refetchUnread } = useUnreadCount();
  const { unreadCount: unreadCounseling } = useCounselingResponses();

  const handleSelectClient = (clientId: string) => {
    setSelectedClientId(clientId);
    setTab("clients");
  };

  const handleBackToList = () => {
    setSelectedClientId(null);
  };

  // Realtime toast for incoming messages
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("trainer-msg-toast")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const msg = payload.new as { sender_id: string; receiver_id: string; content: string };
          if (msg.receiver_id === user.id) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("display_name")
              .eq("user_id", msg.sender_id)
              .single();
            const name = profile?.display_name || "顧客";
            toast(`${name} 様から新着メッセージがあります`, {
              description: `「${msg.content.substring(0, 30)}${msg.content.length > 30 ? "…" : ""}」`,
              action: {
                label: "確認する",
                onClick: () => setTab("messages"),
              },
            });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Refetch unread when leaving messages tab
  useEffect(() => {
    if (tab !== "messages") {
      refetchUnread();
    }
  }, [tab]);

  return (
    <div className="min-h-screen bg-background fade-in overflow-x-hidden">
      {/* Header — アプリ名は「パーソナルジムSalute御所南」で固定。絶対にカタカナに変更しないこと！ */}
      <div className="fixed top-0 left-0 right-0 z-50 glass border-b border-border">
        <div className="flex items-center justify-between px-3 sm:px-4 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <GymLogo size="sm" />
            <span className="text-xs sm:text-sm font-bold truncate">パーソナルジムSalute御所南 <span className="hidden sm:inline">管理画面</span></span>
          </div>
          <button
            onClick={() => { setTab("messages"); setSelectedClientId(null); }}
            className="relative p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="チャット"
          >
            <MessageSquare className="w-5 h-5" />
            {unreadMessages > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1">
                {unreadMessages > 99 ? "99+" : unreadMessages}
              </span>
            )}
          </button>
        </div>
      </div>
      <div className="pt-12">
        <div className="flex">
          <TrainerSidebar
            activeTab={tab}
            onTabChange={(t) => { setTab(t); setSelectedClientId(null); }}
            unreadMessages={unreadMessages}
            unreadCounseling={unreadCounseling}
          />
          <main className="flex-1 ml-0 md:ml-60 p-3 sm:p-4 md:p-8 max-w-6xl" key={`${tab}-${selectedClientId}`}>
              {tab === "dashboard" && <TrainerDashboard onSelectClient={handleSelectClient} />}
              {tab === "clients" && !selectedClientId && <TrainerClientList onSelectClient={handleSelectClient} />}
              {tab === "clients" && selectedClientId && <TrainerClientDetail clientId={selectedClientId} onBack={handleBackToList} />}
              {tab === "schedule" && <TrainerSchedule />}
              {tab === "messages" && <TrainerMessages />}
              {tab === "exercises" && <TrainerExerciseManager />}
              {tab === "counseling" && <CounselingResponseList />}
              {tab === "raid" && <TrainerRaidManager />}
              {tab === "events" && <TrainerEventManager />}
              {tab === "rival" && <TrainerRivalBattleManager />}
              {tab === "quest" && <TrainerQuestManager />}
              {tab === "announcements" && <TrainerAnnouncementManager />}
              {tab === "gym-settings" && <TrainerGymSettings onSignOut={signOut} />}
            </main>
        </div>
      </div>
    </div>
  );
};

export default TrainerView;
