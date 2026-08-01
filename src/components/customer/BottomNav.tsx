import { Home, CalendarDays, Utensils, Dumbbell, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CustomerTab } from "./CustomerView";
import { WORKOUT_LOG_ENABLED, MEALS_ENABLED } from "@/lib/featureFlags";

interface BottomNavProps {
  activeTab: CustomerTab;
  onTabChange: (tab: CustomerTab) => void;
  unreadChat?: number;
}

/**
 * お客様アプリの下部ナビ。
 *
 * ホーム・予約・設定は**常に出す**（消すとアプリが操作不能になるため）。
 * トレーニング記録と食事記録は業種によって不要なのでフラグで落とす
 * （src/lib/featureFlags.ts。理由はそちらのコメント参照）。
 * flex-1 で並べているので、タブが3つでも5つでも自然に幅が分かれる。
 */
const ALL_TABS: {
  id: CustomerTab;
  labelKey: string;
  icon: typeof Home;
  center?: boolean;
  enabled: boolean;
}[] = [
  { id: "home", labelKey: "nav.home", icon: Home, enabled: true },
  { id: "training", labelKey: "nav.training", icon: Dumbbell, enabled: WORKOUT_LOG_ENABLED },
  { id: "booking", labelKey: "nav.booking", icon: CalendarDays, center: true, enabled: true },
  { id: "meals", labelKey: "nav.meals", icon: Utensils, enabled: MEALS_ENABLED },
  { id: "settings", labelKey: "nav.settings", icon: Settings, enabled: true },
];

const tabs = ALL_TABS.filter((t) => t.enabled);

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
