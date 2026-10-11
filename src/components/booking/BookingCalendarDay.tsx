import { useTranslation } from "react-i18next";
import type { DayRemainingBadge } from "@/lib/dayRemainingSlots";

/**
 * お客様の予約カレンダーの1日ぶん（日付・自分の予約の印・残り枠）。
 *
 * もとは CustomerBooking に直書きだった（自分の予約の丸印だけ）。残り枠を足すにあたり、
 * あのファイルは行数の上限（`qualityRatchet.test.ts`）に近いのでここへ出した。
 *
 * ## 見せ方（2026-10-06）
 *
 * | 状態 | 日付の下 |
 * |---|---|
 * | 空きあり | 「残N」（控えめな色） |
 * | 残りわずか（`FEW_REMAINING_SLOTS` 以下） | 「残N」をオレンジ・太字に |
 * | 最後の1枠（`LAST_REMAINING_SLOT`。2026-10-11） | 「残1」を赤・太字に（残2 と同じ色では「最後」が伝わらない） |
 * | 満枠（押せない） | 「満」 |
 * | 定休日・受付終了・範囲外・当日で締切後 | 何も出さない |
 *
 * 選んでいる日・今日のマスは背景に色が付くので、文字はその上で読める色（背景と同じ系統の
 * 前景色）にする。目立つ色のままだと色の上に色が乗って読めない。
 */
interface Props {
  date: Date;
  /** その日に自分の予約がある（これから） */
  ownUpcoming: boolean;
  /** その日に自分の予約があった（過去） */
  ownPast: boolean;
  /** 残り枠の表示。設定 OFF の店・出さない日は null */
  badge: DayRemainingBadge;
  /** 背景に色が付くマス（選択中・今日）か */
  onColoredCell: boolean;
}

const BookingCalendarDay = ({ date, ownUpcoming, ownPast, badge, onColoredCell }: Props) => {
  const { t } = useTranslation();
  const label =
    badge?.kind === "remaining"
      ? t("booking.remainingSlots", { count: badge.count })
      : badge?.kind === "full"
        ? t("booking.dayFullShort")
        : null;
  const tone = !badge || onColoredCell
    ? "opacity-90"
    : badge.kind === "remaining" && badge.last
      ? "text-destructive font-bold"
      : badge.kind === "remaining" && badge.few
        ? "text-warning font-bold"
        : "text-muted-foreground";
  return (
    <div className="relative flex flex-col items-center">
      <span className="relative z-[1]">{date.getDate()}</span>
      {label && (
        <span className={`relative z-[1] text-[9px] leading-none mt-0.5 whitespace-nowrap ${tone}`} data-testid="day-remaining">
          {label}
        </span>
      )}
      {(ownUpcoming || ownPast) && (
        <span
          className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full z-[1]"
          style={{ width: 6, height: 6, backgroundColor: ownUpcoming ? "#3FB6AC" : "#999" }}
        />
      )}
    </div>
  );
};

/** カレンダーの下の説明（残り枠を出している店だけ） */
export const RemainingSlotsLegend = () => {
  const { t } = useTranslation();
  return <p className="text-[11px] text-muted-foreground mt-2 text-center">{t("booking.remainingSlotsLegend")}</p>;
};

/**
 * 残り枠を出すときだけマスを高くする（36px → 44px）。日付と「残N」を縦に並べる余白が要る。
 * 指でも押しやすくなる。基本の classNames を上書きせずに足すため、子孫セレクタで当てる。
 */
export const TALL_CALENDAR_CLASS = "[&_td]:h-11 [&_td>button]:h-11";

export default BookingCalendarDay;
