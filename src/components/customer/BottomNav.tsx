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
 *
 * ── 🔴 予約の丸ボタンを中央に保つ（2026-08-06 / ピラボード発見）────────────
 *
 * 以前は全タブを `flex-1` で並べるだけだった。**タブが偶数個になると
 * 丸ボタンは構造的に中央に来ない。** N個・i番目（1始まり）の中心は
 * `((i - 1) + 0.5) / N` なので:
 *
 * | 記録 | 食事 | 並び | 予約 | 中心 |
 * |---|---|---|---|---|
 * | ON | ON | ホーム 記録 [予約] 食事 設定 | 3/5 | 50% ✅ |
 * | OFF | OFF | ホーム [予約] 設定 | 2/3 | 50% ✅ |
 * | **ON** | **OFF** | ホーム 記録 [予約] 設定 | 3/4 | **62.5%** ❌ |
 * | OFF | ON | ホーム [予約] 食事 設定 | 2/4 | **37.5%** ❌ |
 *
 * ジムボードは5タブ全ONなので**表に出ていなかっただけ**。
 * ピラボード（記録ON・食事OFF）は実機で画面幅の 12.5%（100px 以上）ズレていた。
 * 旧コメントの「3つでも5つでも自然に幅が分かれる」は**「4つ」が抜けていた**。
 *
 * ── 直し方 ────────────────────────────────────────────────────
 *
 * 左・中央・右の3グループに分け、**左右に同じ flex 係数**を与える。
 * 少ない側は**不可視のスペーサー**で埋めてスロット数を揃える。
 *
 * **中央も固定幅ではなく `flex: 1`。** 左右が `flex: sideSlots` で
 * 中の子が `flex-1` × sideSlots 個なので、**中央を含む全スロットが等幅**になる。
 * 固定幅（`w-20` 等）にすると中央だけ幅が違う。
 *
 * つまり3グループとも **「flex 係数 == 子要素数」** が成り立つ。
 * **これがこの実装の不変条件**で、`src/test/bottomNavCenter.test.tsx` が見張る。
 *
 * > ⚠️ ピラボードの敵対的レビューで、検査の穴が1つ見つかっている。
 * > 「左右の flex が等しい」だけを見ると、**両側を同時に `flex-1` に変える**改変を
 * > 素通りさせる（予約は中央のままなので目的は満たされて見えるが、
 * > 中央スロットだけ幅が変わる）。**「flex 係数 == スロット数」まで押さえること。**
 *
 * ⚠️ **スペーサーは中央側に置く。** 端に置くと隣のタブが中央寄りになり、
 * 端が空いて不自然になる（`ホーム 記録 [予約] ␣ 設定` が正しく、
 * `ホーム 記録 [予約] 設定 ␣` は不自然）。
 *
 * 5タブなら `sideSlots = 2` でスペーサー0個。**従来と同じ等幅5分割**になる。
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

type NavTab = (typeof ALL_TABS)[number];

const BottomNav = ({ activeTab, onTabChange }: BottomNavProps) => {
  const { t } = useTranslation();

  const centerIndex = tabs.findIndex((tab) => tab.center);
  const hasCenter = centerIndex >= 0;
  const leftTabs = hasCenter ? tabs.slice(0, centerIndex) : tabs;
  const rightTabs = hasCenter ? tabs.slice(centerIndex + 1) : [];
  const sideSlots = Math.max(leftTabs.length, rightTabs.length);

  // 「体の変化」写真タブ(photos)はトレーニング内のサブ画面なので、トレーニングを点灯扱いにする
  const isActive = (tab: NavTab) =>
    activeTab === tab.id || (tab.id === "training" && activeTab === "photos");

  /**
   * 幅を占めるだけの埋め草。
   * ⚠️ **button にしないこと。** ナビのラベル一覧（`nav button` を数える検査）に混ざる。
   */
  const spacers = (count: number) =>
    Array.from({ length: Math.max(0, count) }, (_, i) => (
      <div key={`spacer-${i}`} aria-hidden="true" className="flex-1 pointer-events-none" />
    ));

  const renderTab = (tab: NavTab) => {
    const active = isActive(tab);
    return (
      <button
        key={tab.id}
        onClick={() => onTabChange(tab.id)}
        className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-all duration-200 ${
          active ? "text-accent" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <tab.icon className={`w-5 h-5 ${active ? "scale-110" : ""} transition-transform`} />
        <span className="text-[10px] font-semibold">{t(tab.labelKey)}</span>
        {active && <div className="w-1 h-1 rounded-full bg-accent mt-0.5" />}
      </button>
    );
  };

  const renderCenterTab = (tab: NavTab) => {
    const active = isActive(tab);
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
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 glass border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="max-w-md mx-auto flex items-end">
        {hasCenter ? (
          <>
            {/* data-slots は「このグループが持つスロット数」。flex 係数と必ず一致させる */}
            <div
              data-nav-group="left"
              data-slots={sideSlots}
              style={{ flex: sideSlots }}
              className="flex items-end"
            >
              {leftTabs.map(renderTab)}
              {spacers(sideSlots - leftTabs.length)}
            </div>
            <div
              data-nav-group="center"
              data-slots={1}
              style={{ flex: 1 }}
              className="flex items-end"
            >
              {renderCenterTab(tabs[centerIndex])}
            </div>
            <div
              data-nav-group="right"
              data-slots={sideSlots}
              style={{ flex: sideSlots }}
              className="flex items-end"
            >
              {spacers(sideSlots - rightTabs.length)}
              {rightTabs.map(renderTab)}
            </div>
          </>
        ) : (
          // center: true のタブが無い構成（現状ありえないが、ナビを消さずに描く）
          tabs.map(renderTab)
        )}
      </div>
    </nav>
  );
};

export default BottomNav;
