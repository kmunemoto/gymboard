import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, Undo2 } from "lucide-react";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatJST } from "@/lib/timezone";
import { undoBookingForfeit } from "@/hooks/bookingForfeitUndo";

/**
 * 顧客の詳細「予約」タブの、消化扱いにした当日キャンセル（status = 同日キャンセル済み）の印と「消化を取り消す」（2026-11-07）。
 *
 * - 印はスタッフ全員に出す（予定表には消化の予約が出ないので、ここが唯一見える場所）
 * - 「消化を取り消す」はオーナーにだけ出す（`canUndo`。回数＝お客様の支払いに関わるため。先生は今まで通り、
 *   キャンセルのときに「消化扱いにする」を選ぶだけ）
 * - 取り消すと予約の行が消える（消化しないキャンセルと同じ）。終わったら・もう消化でなかったら `onChanged` で一覧を読み直す
 *
 * 取り消しそのものは `src/hooks/bookingForfeitUndo.ts`。
 */
const ForfeitedBookingRow = ({ booking, canUndo, onChanged }: {
  booking: { id: string; date: string };
  canUndo: boolean;
  onChanged: () => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const undo = async () => {
    setBusy(true);
    const { error, gone } = await undoBookingForfeit(booking.id);
    setBusy(false);
    if (error) {
      toast.error(t("clientDetail.forfeitUndoFailed"));
      return;
    }
    if (gone) toast.error(t("clientDetail.forfeitUndoGone"));
    else toast.success(t("clientDetail.forfeitUndone"));
    setOpen(false);
    onChanged();
  };

  return (
    <div className="pl-12 flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
        <Ban className="w-3 h-3" />
        {t("clientDetail.forfeitBadge")}
      </span>
      {canUndo && (
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setOpen(true)} disabled={busy}>
          <Undo2 className="w-3 h-3" />
          {t("clientDetail.forfeitUndo")}
        </Button>
      )}
      <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clientDetail.forfeitUndoTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("clientDetail.forfeitUndoDesc", { when: formatJST(booking.date, "M月d日（E） HH:mm", { locale: ja }) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.back")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void undo(); }}
              disabled={busy}
            >
              {busy ? t("common.saving") : t("clientDetail.forfeitUndo")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ForfeitedBookingRow;
