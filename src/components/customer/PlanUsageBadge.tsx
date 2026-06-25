import { Infinity as InfinityIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PlanUsage } from "@/lib/planUsage";

// プラン消化状況の「あと何回」を強調表示するバッジ。
// 状態で色を変える: 残り2回以上=アクセント / 残り1回=警告 / 残り0=不可(赤) / 無制限 / 期限切れ。
// GymBoard 共通部品（予約画面・ホーム・トレーナーのお客様詳細などで再利用可能）。
const PlanUsageBadge = ({ usage }: { usage: PlanUsage }) => {
  const { t } = useTranslation();
  if (usage.isUnconfigured) return null;

  const boxBase = "flex flex-col items-center justify-center rounded-xl px-3 py-1 shrink-0 min-w-[68px]";

  if (usage.isExpired) {
    return (
      <div className={`${boxBase} bg-muted text-muted-foreground`}>
        <span className="text-xs font-bold">{t("booking.expiredBadge")}</span>
      </div>
    );
  }

  if (usage.isUnlimited) {
    return (
      <div className={`${boxBase} bg-accent/15 text-accent`}>
        <InfinityIcon className="w-5 h-5" />
        <span className="text-[10px] font-bold mt-0.5">{t("booking.unlimited")}</span>
      </div>
    );
  }

  const remaining = usage.remaining ?? 0;

  if (remaining === 0) {
    return (
      <div className={`${boxBase} bg-destructive/10 text-destructive`}>
        <span className="text-xs font-bold text-center">{t("booking.noSlotsLeft")}</span>
      </div>
    );
  }

  const tone = remaining === 1 ? "bg-warning/15 text-warning" : "bg-accent/15 text-accent";
  return (
    <div className={`${boxBase} ${tone}`}>
      <span className="text-2xl font-extrabold leading-none">{remaining}</span>
      <span className="text-[10px] font-bold mt-0.5">{t("booking.bookableUnit")}</span>
    </div>
  );
};

export default PlanUsageBadge;
