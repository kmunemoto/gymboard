import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, CalendarDays, Clock } from "lucide-react";
import { ja } from "date-fns/locale";
import { formatJST } from "@/lib/timezone";

interface BookingCancelledDialogProps {
  open: boolean;
  onClose: () => void;
  onNewBooking: () => void;
  date: string; // yyyy-MM-dd
  startTime: string; // HH:mm
  endTime: string; // HH:mm
}

// Cancellation confirmation modal — mirrors BookingCompleteDialog layout but uses
// a neutral grey accent (#999) to visually distinguish from the success state.
const CANCEL_GREY = "#999999";

const BookingCancelledDialog = ({
  open,
  onClose,
  onNewBooking,
  date,
  startTime,
  endTime,
}: BookingCancelledDialogProps) => {
  const formattedDate = date ? formatJST(`${date}T00:00:00+09:00`, "M月d日（E）", { locale: ja }) : "";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm rounded-2xl p-6 gap-0 [&>button]:hidden">
        <div className="flex flex-col items-center text-center space-y-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center shadow-md"
            style={{ backgroundColor: CANCEL_GREY }}
          >
            <X className="w-9 h-9 text-white" strokeWidth={3} />
          </div>

          <DialogTitle className="text-xl font-bold">キャンセルを受け付けました</DialogTitle>
          <DialogDescription className="sr-only">予約キャンセル内容のご確認</DialogDescription>

          <div
            className="w-full rounded-xl p-4 space-y-2 border"
            style={{ backgroundColor: "rgba(153,153,153,0.05)", borderColor: "rgba(153,153,153,0.2)" }}
          >
            <div className="flex items-center justify-center gap-2 text-sm">
              <CalendarDays className="w-4 h-4 shrink-0" style={{ color: CANCEL_GREY }} />
              <span className="font-bold">{formattedDate}</span>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm">
              <Clock className="w-4 h-4 shrink-0" style={{ color: CANCEL_GREY }} />
              <span className="font-bold">{startTime}〜{endTime}</span>
            </div>
          </div>

          <Button
            onClick={onNewBooking}
            className="w-full h-12 rounded-xl text-base font-bold text-white hover:opacity-90"
            style={{ backgroundColor: CANCEL_GREY }}
          >
            新しい予約を取る
          </Button>

          <Button
            variant="outline"
            onClick={onClose}
            className="w-full h-11 rounded-xl text-sm font-semibold"
          >
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BookingCancelledDialog;