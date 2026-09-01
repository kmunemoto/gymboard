import { useTranslation } from "react-i18next";
import { Ban, CalendarCheck, Users } from "lucide-react";
import type { ClosedDay } from "@/lib/bookingClosedDays";

interface Props {
  /** JST の日付（yyyy-MM-dd） */
  dateKey: string;
  /** その日が閉まっていれば理由つきの行。開いていれば null */
  closed: ClosedDay | null;
  /** その日に入っている件数（ブロック枠は含まない） */
  bookedCount: number;
  /** 店の1日の上限。未設定なら null */
  dailyLimit: number | null;
  saving: boolean;
  onClose: (dateKey: string) => void;
  onReopen: (dateKey: string) => void;
  compact?: boolean;
}

/**
 * その日の受付を止める／解除する、1タップのスイッチ。
 *
 * 実店舗の要望（2026-09-01 宗本さん）:「枠を1つずつブロックするのは面倒。
 * その日はもう受けない、を一発でやりたい。空いたらすぐ解除できるように」。
 *
 * 状態は3つ:
 *   受付中          … 押すと止まる
 *   受付停止中(手動) … 押すと戻る（＝すぐ解除できる、が要望の後半）
 *   上限に達した     … 自動。ここでは戻せない（戻すなら上限を上げるか、その日の予約を減らす）。
 *                      押せてしまうと「解除したのにまた閉まる」になるので、押せなくしてある。
 */
const DayReceptionToggle = ({
  dateKey, closed, bookedCount, dailyLimit, saving, onClose, onReopen, compact,
}: Props) => {
  const { t } = useTranslation();
  const size = compact ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-1";

  // 上限で自動的に閉まっている日。手では戻せないので、押せないラベルにする。
  if (closed && !closed.manual) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400 ${size}`}
        title={t("closedDays.atLimitHelp", { limit: dailyLimit ?? bookedCount })}
      >
        <Users className="w-3 h-3" />
        {t("closedDays.atLimit")}
      </span>
    );
  }

  if (closed) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => onReopen(dateKey)}
        aria-label={t("closedDays.reopenAria", { date: dateKey })}
        className={`inline-flex items-center gap-1 rounded-full font-bold transition-colors bg-destructive/15 text-destructive hover:bg-destructive/25 disabled:opacity-50 ${size}`}
      >
        <Ban className="w-3 h-3" />
        {t("closedDays.closedTapToReopen")}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      onClick={() => onClose(dateKey)}
      aria-label={t("closedDays.closeAria", { date: dateKey })}
      className={`inline-flex items-center gap-1 rounded-full font-semibold transition-colors text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 ${size}`}
    >
      <CalendarCheck className="w-3 h-3" />
      {dailyLimit
        ? t("closedDays.openWithCount", { count: bookedCount, limit: dailyLimit })
        : t("closedDays.stopReception")}
    </button>
  );
};

export default DayReceptionToggle;
