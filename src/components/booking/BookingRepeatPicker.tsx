import { useTranslation } from "react-i18next";
import { Repeat } from "lucide-react";

/**
 * 定期予約の回数を選ぶ欄（この回のみ／2〜4回分）。毎週同じ曜日・時間でまとめて取る。
 *
 * 確認カードから切り出した部品（`CustomerBooking.tsx` の行数上限のため）。
 * 状態は持たず、選ばれた回数と上限を受け取って描くだけ。
 *
 * 🔴 `cap` は「予約可能期間（1ヶ月先まで）に収まる回数」。これを超える回数は押せない。
 * 押せてしまうと、期間外の週が必ずスキップされ「4回分と言ったのに2件しか入らない」になる。
 *
 * 🔴 `optionNote` は、オプションが入らない週の扱いを伝えるためのもの。
 * `createRecurringBookings` は1件ずつ DB に投げて、断られた週を飛ばす。オプション分で
 * 断られた週は**トレーニングごと**消えるので、ON のまま気づかずに進むと、通えるはずの
 * 週まで予約が無くなる。
 */
interface Props {
  value: number;
  onChange: (weeks: number) => void;
  /** 予約可能期間に収まる回数の上限（`maxRepeatWeeksFor`）。 */
  cap: number;
  /** オプションを付けているか。付けているときだけ、スキップの注記を出す。 */
  optionNote: boolean;
}

const BookingRepeatPicker = ({ value, onChange, cap, optionNote }: Props) => {
  const { t } = useTranslation();
  return (
    <div className="mb-3 text-left">
      <p className="text-[11px] font-bold text-muted-foreground mb-1.5 flex items-center gap-1">
        <Repeat className="w-3 h-3" />
        {t("booking.repeatTitle")}
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            disabled={n > cap}
            className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
              n > cap
                ? "bg-secondary/50 text-muted-foreground/40 cursor-not-allowed"
                : value === n
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {n === 1 ? t("booking.repeatOnce") : t("booking.repeatTimes", { count: n })}
          </button>
        ))}
      </div>
      {cap < 4 && (
        <p className="text-[11px] text-muted-foreground mt-1.5">{t("booking.repeatLimitedByWindow")}</p>
      )}
      {value > 1 && (
        <p className="text-[11px] text-muted-foreground mt-1.5">
          {t("booking.repeatWeeklyDesc", { count: value })}
        </p>
      )}
      {value > 1 && optionNote && (
        <p className="text-[11px] text-muted-foreground mt-1.5">{t("bookingOptions.repeatNote")}</p>
      )}
    </div>
  );
};

export default BookingRepeatPicker;
