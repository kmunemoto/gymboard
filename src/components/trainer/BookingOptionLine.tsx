import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { summarizeOptions, type BookingOptionSnapshot } from "@/lib/bookingOptions";

/**
 * 予定表で「この予約にはオプションが付いている」を示す1行。
 *
 * 実店舗の要望（2026-09-03 宗本さん）:「付きと出すか、その文字を出すスペースが
 * ないなら、オプション付きを色で区別するか」。
 *
 * 出す場所が3つ（週タイムライン・週グリッド・日別カード）あり、幅がまったく違うので
 * `variant` で出し分ける。**文字が出せる2つには文字を出し**、いちばん狭い
 * 週タイムラインだけは色と印で区別する（そちらは `WeekTimelineView` 側）。
 *
 * オプションが付いていない予約には**何も描かない**（既存の見た目を変えない）。
 */
interface Props {
  options: ReadonlyArray<BookingOptionSnapshot> | null | undefined;
  /** grid = 週の表（極小）／ card = 日別のカード（アイコン付き） */
  variant: "grid" | "card";
}

const BookingOptionLine = ({ options, variant }: Props) => {
  const { t } = useTranslation();
  const text = summarizeOptions(options, (m) => t("bookingOptions.pickerPlusMinutes", { count: m }));
  if (!text) return null;

  if (variant === "grid") {
    return <p className="truncate text-[9px] font-semibold">＋{text}</p>;
  }
  return (
    <p className="text-[10px] font-semibold mt-0.5 flex items-center gap-1">
      <Sparkles className="w-3 h-3 shrink-0" />
      {text}
    </p>
  );
};

export default BookingOptionLine;
