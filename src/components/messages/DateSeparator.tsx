import { useTranslation } from "react-i18next";
import { dateSeparator } from "@/lib/chatDate";

interface DateSeparatorProps {
  /** そのかたまりの先頭メッセージの created_at */
  at: string;
}

/**
 * 会話の途中に挟む日付の区切り。「今日」「昨日」「8/10(月)」。
 *
 * 日付の判定は必ず JST（`chatDate.ts`）。端末のタイムゾーンで切ると、
 * 海外にいるお客様の画面だけ区切りの位置がずれる。
 */
const DateSeparator = ({ at }: DateSeparatorProps) => {
  const { t } = useTranslation();
  const sep = dateSeparator(at);
  const label =
    sep.kind === "today"
      ? t("chat.today")
      : sep.kind === "yesterday"
        ? t("chat.yesterday")
        : sep.text;

  return (
    <div className="flex justify-center my-3">
      <span className="text-[10px] text-muted-foreground bg-muted px-3 py-1 rounded-full font-medium">
        {label}
      </span>
    </div>
  );
};

export default DateSeparator;
