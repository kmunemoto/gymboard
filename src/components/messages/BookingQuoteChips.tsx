import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import {
  type QuotableBooking,
  formatBookingQuote,
  formatQuoteChipLabel,
} from "@/lib/messageQuote";

interface BookingQuoteChipsProps {
  bookings: QuotableBooking[];
  onQuote: (quote: string) => void;
}

/**
 * 入力欄の上に出す「予約の引用」チップ。
 *
 * 押すと本文の先頭に `【8/13(水) 19:00 パーソナル60分】` が入る。
 * 引用できる予約が無いときは**何も出さない**（空の帯を残さない）。
 */
const BookingQuoteChips = ({ bookings, onQuote }: BookingQuoteChipsProps) => {
  const { t } = useTranslation();
  if (bookings.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-0.5">
      <CalendarClock
        className="w-3.5 h-3.5 text-muted-foreground shrink-0"
        aria-label={t("messageQuote.label")}
      />
      {bookings.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onQuote(formatBookingQuote(b))}
          title={formatBookingQuote(b)}
          className="shrink-0 px-2.5 py-1 rounded-full border border-border text-xs font-medium hover:bg-muted transition-colors"
        >
          {formatQuoteChipLabel(b)}
        </button>
      ))}
    </div>
  );
};

export default BookingQuoteChips;
