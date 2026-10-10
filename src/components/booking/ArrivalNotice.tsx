import { DoorOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { arrivalFromTime } from "@/lib/arrivalGuide";

interface Props {
  /** その予約の開始時刻（HH:mm） */
  startTime: string | null | undefined;
  /** 店の設定（`tenants.arrival_lead_minutes`）。null・未設定なら何も出さない */
  lead: number | null | undefined;
  /** 理由の一文を省く（ホームのカードなど、狭い場所用） */
  compact?: boolean;
}

/**
 * 「ご来店は 13:55 以降にお願いします」（2026-10-10 宗本さん）。
 * 何をなぜ出すかは `src/lib/arrivalGuide.ts`。設定していない店・時刻が読めない予約では何も描かない。
 */
const ArrivalNotice = ({ startTime, lead, compact = false }: Props) => {
  const { t } = useTranslation();
  const time = arrivalFromTime(startTime, lead);
  if (!time) return null;
  return (
    <div
      data-testid="arrival-notice"
      className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-left"
    >
      <DoorOpen className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-bold">{t("booking.arrivalFrom", { time })}</p>
        {!compact && <p className="text-xs text-muted-foreground mt-0.5">{t("booking.arrivalWhy")}</p>}
      </div>
    </div>
  );
};

export default ArrivalNotice;
