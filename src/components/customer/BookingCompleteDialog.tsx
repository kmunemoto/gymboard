import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, CalendarDays, Clock } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { formatJST } from "@/lib/timezone";

interface BookingCompleteDialogProps {
  open: boolean;
  onClose: () => void;
  date: string; // yyyy-MM-dd
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  planName: string;
}

const LOCATION = "京都市中京区毘沙門町533-1 プラザ御所南2階";

function buildCalendarUrl(date: string, startTime: string, endTime: string) {
  const dateClean = date.replace(/-/g, "");
  const startClean = startTime.replace(":", "") + "00";
  const endClean = endTime.replace(":", "") + "00";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "Salute御所南トレーニング",
    dates: `${dateClean}T${startClean}/${dateClean}T${endClean}`,
    ctz: "Asia/Tokyo",
    location: LOCATION,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const GoogleCalendarIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path fill="#4285F4" d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V9h14v11Z" />
    <path fill="#34A853" d="M12.5 12.5h-1v1h1v-1Z" />
    <text x="12" y="18" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor">31</text>
  </svg>
);

const BookingCompleteDialog = ({
  open,
  onClose,
  date,
  startTime,
  endTime,
  planName,
}: BookingCompleteDialogProps) => {
  // Always render in JST regardless of viewer timezone.
  const formattedDate = date ? formatJST(`${date}T00:00:00+09:00`, "M月d日（E）", { locale: ja }) : "";
  const calendarUrl = date ? buildCalendarUrl(date, startTime, endTime) : "#";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm rounded-2xl p-6 gap-0 [&>button]:hidden">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center shadow-md">
            <Check className="w-9 h-9 text-accent-foreground" strokeWidth={3} />
          </div>

          <DialogTitle className="text-xl font-bold">予約が完了しました！</DialogTitle>
          <DialogDescription className="sr-only">予約内容のご確認</DialogDescription>

          <div className="w-full bg-accent/5 border border-accent/20 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-center gap-2 text-sm">
              <CalendarDays className="w-4 h-4 text-accent shrink-0" />
              <span className="font-bold">{formattedDate}</span>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-accent shrink-0" />
              <span className="font-bold">{startTime}〜{endTime}</span>
            </div>
            <p className="text-xs text-muted-foreground pt-1 border-t border-accent/10">
              {planName}
            </p>
          </div>

          <a
            href={calendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 w-full h-11 rounded-xl text-sm font-semibold border-2 border-accent text-accent bg-background hover:bg-accent/5 transition-all duration-200"
          >
            <GoogleCalendarIcon className="w-5 h-5" />
            Googleカレンダーに追加
          </a>

          <Button
            onClick={onClose}
            className="w-full h-12 rounded-xl text-base font-bold bg-accent text-accent-foreground hover:bg-accent/90"
          >
            OK
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BookingCompleteDialog;