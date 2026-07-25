import { LayoutDashboard, Users, CalendarDays, MessageCircle, Dumbbell, Settings2, ClipboardList, Megaphone, Bell, UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TrainerTab } from "./TrainerView";
import { useTenant } from "@/hooks/useTenant";
import { isNavTabVisible } from "@/lib/gymDisplaySettings";

interface TrainerSidebarProps {
  activeTab: TrainerTab;
  onTabChange: (tab: TrainerTab) => void;
  unreadMessages?: number;
  unreadCounseling?: number;
}

const desktopTabs: { id: TrainerTab; labelKey: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", labelKey: "trainerNav.dashboard", icon: LayoutDashboard },
  { id: "clients", labelKey: "trainerNav.clients", icon: Users },
  { id: "schedule", labelKey: "trainerNav.schedule", icon: CalendarDays },
  { id: "messages", labelKey: "trainerNav.messages", icon: MessageCircle },
  { id: "exercises", labelKey: "trainerNav.exercises", icon: Dumbbell },
  { id: "counseling", labelKey: "trainerNav.counseling", icon: ClipboardList },
  { id: "announcements", labelKey: "trainerNav.announcements", icon: Megaphone },
  { id: "notifications", labelKey: "trainerNav.notifications", icon: Bell },
  { id: "trial-followups", labelKey: "trainerNav.trialFollowUps", icon: UserCheck },
  { id: "gym-settings", labelKey: "trainerNav.gymSettings", icon: Settings2 },
];

const mobileTabs: { id: TrainerTab; labelKey: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", labelKey: "trainerNav.mDashboard", icon: LayoutDashboard },
  { id: "clients", labelKey: "trainerNav.mClients", icon: Users },
  { id: "schedule", labelKey: "trainerNav.mSchedule", icon: CalendarDays },
  { id: "exercises", labelKey: "trainerNav.mExercises", icon: Dumbbell },
  { id: "announcements", labelKey: "trainerNav.mAnnouncements", icon: Megaphone },
  { id: "notifications", labelKey: "trainerNav.mNotifications", icon: Bell },
  { id: "gym-settings", labelKey: "trainerNav.mGymSettings", icon: Settings2 },
];

const TrainerSidebar = ({ activeTab, onTabChange, unreadMessages = 0, unreadCounseling = 0 }: TrainerSidebarProps) => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const getBadgeCount = (tabId: TrainerTab) => {
    if (tabId === "messages") return unreadMessages;
    if (tabId === "counseling") return unreadCounseling;
    return 0;
  };

  // ジム設定でオフにしたタブはメニューから外す。ただし今開いているタブは、
  // 消えて操作の文脈を見失わないよう例外的に残す（他画面から遷移してきた場合など）。
  const isVisible = (tabId: TrainerTab) => tabId === activeTab || isNavTabVisible(tenant, tabId);
  const visibleDesktopTabs = desktopTabs.filter((tab) => isVisible(tab.id));
  const visibleMobileTabs = mobileTabs.filter((tab) => isVisible(tab.id));

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed left-0 top-14 bottom-0 w-60 flex-col gap-1 p-4 border-r border-border bg-card/60 backdrop-blur-xl z-30">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 px-3">{t("trainerNav.menu")}</p>
        {visibleDesktopTabs.map((tab) => {
          const active = activeTab === tab.id;
          const badgeCount = getBadgeCount(tab.id);
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                active
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <tab.icon className="w-4.5 h-4.5" />
              {t(tab.labelKey)}
              {badgeCount > 0 && (
                <span className="ml-auto bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </aside>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex">
          {visibleMobileTabs.map((tab) => {
            const active = activeTab === tab.id;
            const badgeCount = getBadgeCount(tab.id);
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-all duration-200 relative ${
                  active ? "text-accent" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="relative">
                  <tab.icon className={`w-5 h-5 ${active ? "scale-110" : ""} transition-transform`} />
                  {badgeCount > 0 && (
                    <span className="absolute -top-1 -right-2 bg-destructive text-destructive-foreground text-[8px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                      {badgeCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-semibold">{t(tab.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};

export default TrainerSidebar;
