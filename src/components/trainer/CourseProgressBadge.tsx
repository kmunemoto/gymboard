import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface CourseProgressBadgeProps {
  index: number;
  total: number | null;
  isUnlimited: boolean;
  isUnconfigured: boolean;
  isOverflow: boolean;
  /** 猶予で前サイクルへ繰り入れた回（大目に見た消化）。琥珀色＋「前回分」表示 */
  isGraceCarryover?: boolean;
  /** トレーナー側「予約一覧」用の小さい表示 */
  size?: "sm" | "md";
  className?: string;
}

/**
 * 予約カード等に表示するコース進捗チップ。
 * - 通常: 「今回 3/8 回目」
 * - 通い放題: 「今回 3 回目（通い放題）」
 * - 未設定: 「コース未設定」
 * - 超過: 「今回 9/8 回目（超過）」
 * - 猶予繰入: 「今回 8/8 回目（前回分）」（琥珀色）
 * - 残り少：警告色
 */
const CourseProgressBadge = ({
  index,
  total,
  isUnlimited,
  isUnconfigured,
  isOverflow,
  isGraceCarryover = false,
  size = "sm",
  className,
}: CourseProgressBadgeProps) => {
  const { t } = useTranslation();
  if (isUnconfigured) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground font-medium",
          size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5",
          className,
        )}
      >
        {t("courseBadge.unconfigured")}
      </span>
    );
  }

  if (isUnlimited) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-accent/15 text-accent font-bold border border-accent/30",
          size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5",
          className,
        )}
      >
        {t("courseBadge.unlimited", { index })}
      </span>
    );
  }

  // 猶予繰入（大目に見た消化）は琥珀色＋「前回分」で通常の消化と見分けられるようにする
  if (isGraceCarryover) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full font-bold bg-warning/15 text-warning border border-warning/40",
          size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5",
          className,
        )}
      >
        {t("courseBadge.graceCarryover", { index, total })}
      </span>
    );
  }

  // 通常 — すべてティファニーブルー（accent）で統一
  const style = "bg-accent/10 text-accent border border-accent/30";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-bold",
        style,
        size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5",
        className,
      )}
    >
      {t("courseBadge.normal", { index, total })}
    </span>
  );
};

export default CourseProgressBadge;