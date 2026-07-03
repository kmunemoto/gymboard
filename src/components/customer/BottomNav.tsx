import { Home, CalendarDays, Utensils, Dumbbell, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CustomerTab } from "./CustomerView";

interface BottomNavProps {
  activeTab: CustomerTab;
  onTabChange: (tab: CustomerTab) => void;
  unreadChat?: number;
}

const tabs: { id: CustomerTab; labelKey: string; icon: typeof Home; center?: boolean }[] = [
  { id: "home", labelKey: "nav.home", icon: Home },
  { id: "training", labelKey: "nav.training", icon: Dumbbell },
  { id: "booking", labelKey: "nav.booking", icon: CalendarDays, center: true },
  { id: "meals", labelKey: "nav.meals", icon: Utensils },
  { id: "settings", labelKey: "nav.settings", icon: Settings },
];

const BottomNav = ({ activeTab, onTabChange }: BottomNavProps) => {
  const { t } = useTranslation();
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 glass border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="max-w-md mx-auto flex items-end">
        {tabs.map((tab) => {
          // 「体の変化」写真タブ(photos)はトレーニング内のサブ画面なので、トレーニングを点灯扱いにする
          const active = activeTab === tab.id || (tab.id === "training" && activeTab === "photos");

          if (tab.center) {
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className="flex-1 flex flex-col items-center -mt-4 pb-2 pt-0.5"
              >
                <div
                  className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 bg-accent ${
                    active ? "scale-105" : ""
                  }`}
                >
                  <tab.icon className="w-6 h-6 text-accent-foreground" strokeWidth={2.2} />
                </div>
                <span className={`text-[10px] font-bold mt-1 ${active ? "text-accent" : "text-muted-foreground"}`}>
                  {t(tab.labelKey)}
                </span>
              </button>
            );
          }

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-all duration-200 ${
                active
                  ? "text-accent"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className={`w-5 h-5 ${active ? "scale-110" : ""} transition-transform`} />
              <span className="text-[10px] font-semibold">{t(tab.labelKey)}</span>
              {active && <div className="w-1 h-1 rounded-full bg-accent mt-0.5" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
