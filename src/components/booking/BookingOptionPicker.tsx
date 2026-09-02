import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock, Sparkles } from "lucide-react";
import type { BookingOption } from "@/lib/bookingOptions";

/**
 * 予約に付けるオプション（例: トレーニング後の30分ストレッチ）の選択欄。
 *
 * お客様の予約画面と店側の代理予約の**両方で同じものを出す**ため、ここ1箇所に置く
 * （`BookingQuestionFields` と同じ理由。画面ごとに書くと必ず片方が取り残される）。
 *
 * 見出し等の文言はここで i18n から引く（`BookingQuestionFields` が文言を props で
 * 受けるのは、あちらが**店の入力した質問文**を出す入れ物だから。ここは固定の UI 文言）。
 * 呼び出し側の行数を増やさないためでもある——お客様の予約画面も店側の予定表も
 * 行数の上限（qualityRatchet）ぎりぎりで、ここに文言を積むと入らない。
 *
 * 🔴 **選び直したら空き枠を計算し直すこと。** オプションを足すと占有が伸びるので
 * （60分 → 90分＋間15分＝105分）、一覧を作り直さないと「選べた時刻で DB に断られる」。
 * そのため、この欄は**時間を選ぶ前**に置く（選択済みの枠が無効になる事故を防ぐ）。
 */
interface Props {
  options: ReadonlyArray<BookingOption>;
  /** 選択中のオプション id。 */
  selectedIds: ReadonlyArray<string>;
  onToggle: (optionId: string) => void;
  disabled?: boolean;
  /** 呼び出し側の行数を増やさないため、余白はここで受ける。 */
  className?: string;
}

const BookingOptionPicker = ({ options, selectedIds, onToggle, disabled, className }: Props) => {
  const { t } = useTranslation();
  if (options.length === 0) return null;

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" />
        {t("bookingOptions.pickerTitle")}
      </p>
      <p className="text-xs text-muted-foreground">{t("bookingOptions.pickerHint")}</p>
      <div className="space-y-1.5">
        {options.map((o) => {
          const checked = selectedIds.includes(o.id);
          return (
            <label
              key={o.id}
              className={`flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${
                checked ? "border-primary bg-primary/5" : "border-border"
              } ${disabled ? "opacity-60" : "cursor-pointer"}`}
            >
              <Checkbox
                className="mt-0.5"
                checked={checked}
                disabled={disabled}
                onCheckedChange={() => onToggle(o.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold break-words">{o.name}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  {o.duration_minutes > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {t("bookingOptions.pickerPlusMinutes", { count: o.duration_minutes })}
                    </span>
                  )}
                  {/* 0 は「無料」ではなく「料金を表示しない」 */}
                  {o.price_yen > 0 && (
                    <span>{t("bookingOptions.pickerPrice", { price: o.price_yen.toLocaleString() })}</span>
                  )}
                </span>
                {o.description && (
                  <span className="mt-1 block text-xs text-muted-foreground break-words">
                    {o.description}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default BookingOptionPicker;
