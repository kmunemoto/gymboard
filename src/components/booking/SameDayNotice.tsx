import { useTranslation } from "react-i18next";
import { Info, MessageCircle, MessageSquare, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/lib/nativeBridge";

/**
 * お客様の予約画面で、当日（今日）を開いたときの案内。CustomerBooking から切り出した部品
 * （あのファイルが行数の上限 `qualityRatchet.test.ts` に達しているため）。
 *
 * - laterToday … 当日の予約を、同じ日の後ろの時間へ動かせる（ジムの設定・2026-11-07。
 *                 `src/lib/sameDayReschedule.ts`）。後ろの空き時間は押せるので、そう案内する
 * - viewOnly  … 締切を過ぎて今日は見るだけ。電話・LINE・チャットで店へ（今まで通り）
 *
 * 両方当てはまることは無い（後ろへ動かせるときは「見るだけ」にしない）が、念のため laterToday を先に見る。
 */
interface Props {
  laterToday: boolean;
  viewOnly: boolean;
  phone?: string | null;
  lineUrl?: string | null;
  onOpenChat?: () => void;
}

const SameDayNotice = ({ laterToday, viewOnly, phone, lineUrl, onOpenChat }: Props) => {
  const { t } = useTranslation();

  if (laterToday) {
    return (
      <div className="mb-3 rounded-xl border border-accent/30 bg-accent/5 p-3" data-testid="later-today-hint">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <p className="text-xs text-foreground leading-relaxed">{t("booking.laterTodayHint")}</p>
        </div>
      </div>
    );
  }

  if (!viewOnly) return null;

  return (
    <div className="mb-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
      <div className="flex items-start gap-2">
        <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <p className="text-xs text-foreground leading-relaxed">
          {t("booking.sameDayViewOnlyNotice")}
        </p>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {phone && (
          <Button asChild variant="accent" size="sm" className="flex-1 min-w-[110px]">
            {/* 番号は画面に出さず、tel: リンクで発信のみ行う */}
            <a href={`tel:${phone}`}>
              <Phone className="w-3.5 h-3.5 mr-1.5" />
              {t("booking.callGym")}
            </a>
          </Button>
        )}
        {lineUrl && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 min-w-[110px]"
            onClick={() => openExternalUrl(lineUrl)}
          >
            <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
            {t("common.lineContact")}
          </Button>
        )}
        {onOpenChat && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 min-w-[110px]"
            onClick={onOpenChat}
          >
            <MessageCircle className="w-3.5 h-3.5 mr-1.5" />
            {t("booking.chatWithGym")}
          </Button>
        )}
      </div>
    </div>
  );
};

export default SameDayNotice;
