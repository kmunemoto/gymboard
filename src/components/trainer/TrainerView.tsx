import { lazy, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";

import TrainerSidebar from "./TrainerSidebar";
import TrainerClientList from "./TrainerClientList";
import TrainerSchedule from "./TrainerSchedule";
import LazyBoundary from "@/components/LazyBoundary";

// グラフ(recharts)を含む重い画面は開いたときに読み込む（バンドル最適化）
const TrainerDashboard = lazy(() => import("./TrainerDashboard"));
const TrainerClientDetail = lazy(() => import("./TrainerClientDetail"));
import TrainerMessages from "./TrainerMessages";
import TrainerExerciseManager from "./TrainerExerciseManager";
import TrainerGymSettings from "./TrainerGymSettings";
import TrainerAnnouncementManager from "./TrainerAnnouncementManager";
import TrainerVideoManager from "./TrainerVideoManager";
import TrainerNotificationSettings from "./TrainerNotificationSettings";
import CounselingResponseList from "./CounselingResponseList";
import TrainerTrialFollowUps from "./TrainerTrialFollowUps";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import GymLogo from "@/components/GymLogo";
import PlanLimitBanner from "@/components/PlanLimitBanner";
import SubscriptionBlockedBanner from "@/components/SubscriptionBlockedBanner";
import { useUnreadCount } from "@/hooks/useMessages";
import { useMeasuredHeightVar, APP_HEADER_VAR } from "@/hooks/useMeasuredHeightVar";
import { useStaffDirectory } from "@/hooks/useStaffDirectory";
import { useCounselingResponses } from "@/hooks/useCounselingResponses";
import { supabase } from "@/integrations/supabase/client";
import { uniqueChannelName } from "@/lib/realtimeChannel";
import { useTenant } from "@/hooks/useTenant";
import { isNavTabVisible } from "@/lib/gymDisplaySettings";

// 定義は src/lib/trainerTabs.ts に移した（lib がコンポーネントを import しないため）。
// ここから使っている箇所を壊さないよう再エクスポートする。
export type { TrainerTab } from "@/lib/trainerTabs";
import type { TrainerTab } from "@/lib/trainerTabs";

const TrainerView = () => {
  // ヘッダーの実測の高さを --app-header-h へ。チャットの上端がこれを避ける。
  const headerRef = useRef<HTMLDivElement>(null);
  useMeasuredHeightVar(headerRef, APP_HEADER_VAR);
  const { t } = useTranslation();
  const [tab, setTab] = useState<TrainerTab>("dashboard");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  // 離脱アラートの「声かけ」等からメッセージ画面を開くときの宛先（開いたら選択済みにする）
  const [messageClientId, setMessageClientId] = useState<string | null>(null);
  const { signOut } = useAuth();
  const { user } = useAuth();
  // 共有受信箱: 別のスタッフ宛ての未読もバッジに出す（誰も気づかない会話を作らない）
  const staff = useStaffDirectory();
  const { count: unreadMessages, refetch: refetchUnread } = useUnreadCount(staff.ids);
  const { unreadCount: unreadCounseling } = useCounselingResponses();
  const { tenant } = useTenant();

  useEffect(() => {
    if (tenant?.primary_color) {
      document.documentElement.style.setProperty("--tenant-color", tenant.primary_color);
    }
  }, [tenant?.primary_color]);

  const handleSelectClient = (clientId: string) => {
    setSelectedClientId(clientId);
    setTab("clients");
  };

  // 指定顧客との会話を開いた状態でメッセージタブへ移動（ワンタップ声かけ）
  const handleMessageClient = (clientId: string) => {
    setMessageClientId(clientId);
    setSelectedClientId(null);
    setTab("messages");
  };

  // ダッシュボードの「体験フォロー待ち」バナーから体験フォロー管理タブへ移動
  const handleNavigateFollowUps = () => {
    setSelectedClientId(null);
    setTab("trial-followups");
  };

  const handleBackToList = () => {
    setSelectedClientId(null);
  };

  // Realtime toast for incoming messages
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(uniqueChannelName("trainer-msg-toast"))
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
            const name = profile?.display_name || t("common.customer");
            toast(t("trainerView.newMessageFrom", { name }), {
              description: t("trainerView.messagePreview", { text: `${msg.content.substring(0, 30)}${msg.content.length > 30 ? "…" : ""}` }),
              action: {
                label: t("trainerView.check"),
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
      setMessageClientId(null); // 声かけの宛先指定は一度使ったらリセット
    }
  }, [tab]);

  return (
    <div className="min-h-screen bg-background fade-in overflow-x-hidden">
      {/* Header */}
      {/* 🔴 高さを --app-header-h に流す。チャットの上端がこれを避ける。
          ノッチ・文字サイズで変わるので直書きしない（ナビ側と同じ理由）。 */}
      <div
        ref={headerRef}
        className="fixed top-0 left-0 right-0 z-50 glass border-b border-border"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex items-center justify-between px-3 sm:px-4 py-2">
          <div className="flex items-center gap-2 min-w-0">
            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt="" className="w-6 h-6 rounded object-cover" />
            ) : (
              <GymLogo size="sm" />
            )}
            <span className="text-xs sm:text-sm font-bold truncate">{tenant?.gym_name || t("common.brand")} <span className="hidden sm:inline">{t("trainerView.adminSuffix")}</span></span>
          </div>
          {/* メッセージをメニューから隠しているジムでは、ヘッダーの導線も併せて隠す
              （メニューに無いのにヘッダーからだけ入れる、というちぐはぐを防ぐ） */}
          {isNavTabVisible(tenant, "messages") && (
            <button
              onClick={() => { setTab("messages"); setSelectedClientId(null); }}
              className="relative p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label={t("common.chat")}
            >
              <MessageSquare className="w-5 h-5" />
              {unreadMessages > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1">
                  {unreadMessages > 99 ? "99+" : unreadMessages}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
      <div style={{ paddingTop: "calc(3rem + env(safe-area-inset-top, 0px))" }}>
        <SubscriptionBlockedBanner
          onManage={() => { setTab("gym-settings"); setSelectedClientId(null); }}
        />
        <PlanLimitBanner
          onUpgrade={() => { setTab("gym-settings"); setSelectedClientId(null); }}
          onManageCustomers={() => { setTab("clients"); setSelectedClientId(null); }}
        />
        <div className="flex">
          <TrainerSidebar
            activeTab={tab}
            onTabChange={(nextTab) => { setTab(nextTab); setSelectedClientId(null); }}
            unreadMessages={unreadMessages}
            unreadCounseling={unreadCounseling}
          />
          {/* min-w-0: フレックス子の既定 min-width:auto を解除。これが無いと中身（日付入力等）の
              intrinsic 幅に引っ張られて main が画面幅を超え、右端要素が見切れる（Android で顕著）。 */}
          <main className="flex-1 min-w-0 ml-0 md:ml-60 p-3 sm:p-4 md:p-8 max-w-6xl" key={`${tab}-${selectedClientId}`}>
            <LazyBoundary>
              {tab === "dashboard" && <TrainerDashboard onSelectClient={handleSelectClient} onMessageClient={handleMessageClient} onNavigateFollowUps={handleNavigateFollowUps} />}
              {tab === "clients" && !selectedClientId && <TrainerClientList onSelectClient={handleSelectClient} />}
              {tab === "clients" && selectedClientId && <TrainerClientDetail clientId={selectedClientId} onBack={handleBackToList} />}
              {tab === "schedule" && <TrainerSchedule />}
              {tab === "messages" && <TrainerMessages initialCustomerId={messageClientId} />}
              {tab === "exercises" && <TrainerExerciseManager />}
              {tab === "counseling" && <CounselingResponseList />}
              {tab === "announcements" && <TrainerAnnouncementManager />}
              {tab === "videos" && <TrainerVideoManager />}
              {tab === "notifications" && <TrainerNotificationSettings />}
              {tab === "trial-followups" && <TrainerTrialFollowUps />}
              {tab === "gym-settings" && <TrainerGymSettings onSignOut={signOut} />}
            </LazyBoundary>
          </main>
        </div>
      </div>
    </div>
  );
};

export default TrainerView;
