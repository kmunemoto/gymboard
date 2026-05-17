import { LayoutDashboard, Users, CalendarDays, MessageCircle, Dumbbell, Settings2, ClipboardList, Sword, PartyPopper, Megaphone, Castle } from "lucide-react";
import type { TrainerTab } from "./TrainerView";

interface TrainerSidebarProps {
  activeTab: TrainerTab;
  onTabChange: (tab: TrainerTab) => void;
  unreadMessages?: number;
  unreadCounseling?: number;
}

const desktopTabs: { id: TrainerTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { id: "clients", label: "顧客一覧", icon: Users },
  { id: "schedule", label: "予約管理", icon: CalendarDays },
  { id: "messages", label: "メッセージ", icon: MessageCircle },
  { id: "exercises", label: "種目設定", icon: Dumbbell },
  { id: "counseling", label: "カウンセリング", icon: ClipboardList },
  { id: "raid", label: "レイド管理", icon: Sword },
  { id: "events", label: "イベント管理", icon: PartyPopper },
  { id: "quest", label: "クエスト管理", icon: Castle },
  { id: "announcements", label: "お知らせ", icon: Megaphone },
  { id: "gym-settings", label: "ジム設定", icon: Settings2 },
];

const mobileTabs: { id: TrainerTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { id: "clients", label: "顧客一覧", icon: Users },
  { id: "schedule", label: "予約管理", icon: CalendarDays },
  { id: "exercises", label: "種目管理", icon: Dumbbell },
  { id: "counseling", label: "カウンセリング", icon: ClipboardList },
  { id: "raid", label: "レイド", icon: Sword },
  { id: "events", label: "イベント", icon: PartyPopper },
  { id: "quest", label: "クエスト", icon: Castle },
  { id: "announcements", label: "お知らせ", icon: Megaphone },
  { id: "gym-settings", label: "ジム設定", icon: Settings2 },
];

const TrainerSidebar = ({ activeTab, onTabChange, unreadMessages = 0, unreadCounseling = 0 }: TrainerSidebarProps) => {
  const getBadgeCount = (tabId: TrainerTab) => {
    if (tabId === "messages") return unreadMessages;
    if (tabId === "counseling") return unreadCounseling;
    return 0;
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed left-0 top-14 bottom-0 w-60 flex-col gap-1 p-4 border-r border-border bg-card/60 backdrop-blur-xl z-30">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 px-3">メニュー</p>
        {desktopTabs.map((t) => {
          const active = activeTab === t.id;
          const badgeCount = getBadgeCount(t.id);
          return (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                active
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <t.icon className="w-4.5 h-4.5" />
              {t.label}
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass border-t border-border">
        <div className="flex">
          {mobileTabs.map((t) => {
            const active = activeTab === t.id;
            const badgeCount = getBadgeCount(t.id);
            return (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-all duration-200 relative ${
                  active ? "text-accent" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="relative">
                  <t.icon className={`w-5 h-5 ${active ? "scale-110" : ""} transition-transform`} />
                  {badgeCount > 0 && (
                    <span className="absolute -top-1 -right-2 bg-destructive text-destructive-foreground text-[8px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                      {badgeCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-semibold">{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};

export default TrainerSidebar;
