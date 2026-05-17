import { Home, CalendarDays, Utensils, Dumbbell, Settings } from "lucide-react";
import type { CustomerTab } from "./CustomerView";

interface BottomNavProps {
  activeTab: CustomerTab;
  onTabChange: (tab: CustomerTab) => void;
  unreadChat?: number;
}

const tabs: { id: CustomerTab; label: string; icon: typeof Home; center?: boolean }[] = [
  { id: "home", label: "ホーム", icon: Home },
  { id: "training", label: "記録", icon: Dumbbell },
  { id: "booking", label: "予約", icon: CalendarDays, center: true },
  { id: "meals", label: "食事", icon: Utensils },
  { id: "settings", label: "設定", icon: Settings },
];

const BottomNav = ({ activeTab, onTabChange }: BottomNavProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 glass border-t border-border">
      <div className="max-w-md mx-auto flex items-end">
        {tabs.map((t) => {
          const active = activeTab === t.id;

          if (t.center) {
            return (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className="flex-1 flex flex-col items-center -mt-4 pb-2 pt-0.5"
              >
                <div
                  className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 bg-accent ${
                    active ? "scale-105" : ""
                  }`}
                >
                  <t.icon className="w-6 h-6 text-accent-foreground" strokeWidth={2.2} />
                </div>
                <span className={`text-[10px] font-bold mt-1 ${active ? "text-accent" : "text-muted-foreground"}`}>
                  {t.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-all duration-200 ${
                active
                  ? "text-accent"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className={`w-5 h-5 ${active ? "scale-110" : ""} transition-transform`} />
              <span className="text-[10px] font-semibold">{t.label}</span>
              {active && <div className="w-1 h-1 rounded-full bg-accent mt-0.5" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
