import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { normalizeBookingPageNote } from "@/lib/bookingPageNote";

interface Props {
  /** 店の設定（`tenants.booking_page_note`）。null・空なら何も出さない */
  note: string | null | undefined;
}

/**
 * 「予約画面のご案内」（2026-11-14 宗本さん）。何をなぜ出すかは `src/lib/bookingPageNote.ts`。
 * 店が書いた文は改行も含めてそのまま出す（店が書いた文を勝手に縮めない）。
 */
const BookingPageNote = ({ note }: Props) => {
  const { t } = useTranslation();
  const text = normalizeBookingPageNote(note);
  if (!text) return null;
  return (
    <div
      data-testid="booking-page-note"
      className="mt-3 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-left"
    >
      <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-bold">{t("booking.pageNoteTitle")}</p>
        <p className="text-sm mt-0.5 whitespace-pre-line break-words">{text}</p>
      </div>
    </div>
  );
};

export default BookingPageNote;
