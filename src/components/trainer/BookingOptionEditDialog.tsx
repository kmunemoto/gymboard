import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { formatDate } from "@/lib/dateFormat";
import { toJSTDate } from "@/lib/timezone";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import BookingOptionPicker from "@/components/booking/BookingOptionPicker";
import { useBookingOptions } from "@/hooks/useBookingOptions";
import { updateBookingOptions } from "@/hooks/bookingOptionEdit";
import {
  buildOptionSnapshot,
  isOptionBlockedError,
  optionMinutesFor,
  type BookingOptionSnapshot,
} from "@/lib/bookingOptions";

/**
 * 既に入っている予約のオプションを、店側があとから足す／外す。
 *
 * 🔴 **足せるかどうかは DB が決める**（`guard_booking_option_change` / `GB008`）。
 * 「後ろがもう埋まってたら無理」（2026-09-03 宗本さん）。ここで先回りして判定しない
 * ——画面が持っている予約一覧はその日ぶんだけで、容量の帯やブロック枠まで含めた
 * 正しい判定は DB にしか無い。断られたら理由をそのまま出す。
 *
 * 外す方向（短くする）は必ず通る。占有が縮むだけなので誰ともぶつからない。
 */
interface Props {
  booking: {
    id: string;
    clientName: string;
    date: string;
    startTime: string;
    optionMinutes?: number;
    bookingOptions?: BookingOptionSnapshot[];
  } | null;
  onClose: () => void;
  /** 保存できたら呼ぶ（予定表の再取得） */
  onSaved: () => void;
}

const BookingOptionEditDialog = ({ booking, onClose, onSaved }: Props) => {
  const { t } = useTranslation();
  const { options } = useBookingOptions();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // ダイアログを開くたびに「いま付いているもの」から始める。
  // 控え（snapshot）の id は作成時のものなので、いま存在するオプションだけを選択に戻す
  // （店が消したオプションは選択肢に無い＝チェックのしようがない）。
  useEffect(() => {
    if (!booking) return;
    const alive = new Set(options.map((o) => o.id));
    setSelectedIds((booking.bookingOptions ?? []).map((o) => o.id).filter((id) => alive.has(id)));
  }, [booking, options]);

  const minutes = optionMinutesFor(options, selectedIds);
  const before = booking?.optionMinutes ?? 0;

  const handleSave = async () => {
    if (!booking) return;
    setSaving(true);
    const { error } = await updateBookingOptions(
      booking.id, minutes, buildOptionSnapshot(options, selectedIds),
    );
    setSaving(false);
    if (error) {
      // 🔴 SQLSTATE で見分ける。文言一致にすると、業種フォークが文言を変えた瞬間に
      //    静かに「保存できませんでした」だけになる。
      if (isOptionBlockedError(error)) {
        toast.error(t("bookingOptions.editBlocked"), {
          description: t("bookingOptions.editBlockedHelp"),
        });
      } else {
        console.error("オプションの変更に失敗:", error);
        toast.error(t("bookingOptions.editFailed"));
      }
      return;
    }
    toast.success(t("bookingOptions.editSaved"));
    onSaved();
    onClose();
  };

  return (
    <Dialog open={!!booking} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            {t("bookingOptions.editTitle")}
          </DialogTitle>
          {booking && (
            <p className="text-sm text-muted-foreground">
              {t("bookingOptions.editSubject", {
                name: booking.clientName,
                // 日付は「8月31日（月）」で出す。yyyy-MM-dd のまま出すと、
                // 店員が予定表と見比べるときに一拍おく必要がある
                date: formatDate(toJSTDate(`${booking.date}T00:00:00+09:00`), "monthDayDow"),
                time: booking.startTime,
              })}
            </p>
          )}
        </DialogHeader>

        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("bookingOptions.editNoOptions")}</p>
        ) : (
          <BookingOptionPicker
            options={options}
            selectedIds={selectedIds}
            onToggle={(id) =>
              setSelectedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
            disabled={saving}
          />
        )}

        {/* 伸ばすときだけ断られうる。先に伝えておく（押してから断られると理由が分からない） */}
        {minutes > before && (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            {t("bookingOptions.editLengthenNote")}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 h-11" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            className="flex-1 h-11"
            onClick={handleSave}
            disabled={saving || options.length === 0}
          >
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BookingOptionEditDialog;
